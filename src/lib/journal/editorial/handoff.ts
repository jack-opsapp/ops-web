import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBearerToken, secureTokenEquals } from "../../social/auth";
import {
  JOURNAL_BRIEF_VERSION,
  JOURNAL_FORMAT,
  JOURNAL_LIMITS,
  isJournalApproved,
  journalEditorSchema,
} from "./brief";
import {
  JOURNAL_INDUSTRY_SLUGS,
  JournalDraftError,
  prepareJournalDraft,
  type JournalPolicyContext,
  type PreparedJournalDraft,
} from "./policy";
import type { JournalReference } from "./voice";

const BODY_LIMIT_BYTES = 200_000;
const MAX_ATTEMPTS = 3;
const MAX_SUBMISSIONS_PER_CLAIM = 3;
const RECENT_POSTS = 40;

export type JournalMode = "off" | "prepare" | "publish";

export interface JournalAssignmentRecord {
  id: string;
  identity: string;
  slot_date: string;
  slot_at: string;
  mode: "prepare" | "publish" | null;
  state: string;
  attempts: number;
  submissions: number;
  claim_token: string | null;
  lease_until: string | null;
  title: string | null;
  package: JournalPackage | null;
}

export interface JournalPackage extends PreparedJournalDraft {
  review: Record<string, unknown>;
  usage: unknown[];
  references: Array<{ path: string; sha256: string }>;
  brief_version: string;
}

/** What OPS keeps of one fetched page, and what the routine reads back. */
export interface JournalSourceRecord {
  id: string;
  url: string;
  final_url: string;
  content_type: string;
  title: string | null;
  site_name: string | null;
  published_hint: string | null;
  modified_hint: string | null;
  text: string;
  truncated: boolean;
  fetched_at: string;
}

export interface JournalSourceSnapshotInput {
  url: string;
  final_url: string;
  http_status: number;
  content_type: "text/html" | "text/plain" | "application/pdf";
  bytes: number;
  sha256: string;
  title: string | null;
  site_name: string | null;
  published_hint: string | null;
  modified_hint: string | null;
  text: string;
  truncated: boolean;
}

export interface JournalClaimContext {
  recentPosts: Array<{
    slug: string;
    title: string;
    published_at: string;
    summary: string | null;
    category: string | null;
  }>;
  backlogTopics: Array<{ id: string; topic: string }>;
  categories: Array<{ id: string; slug: string; name: string }>;
  fetchedSources: Array<{ id: string; url: string; title: string | null }>;
  maxSources: number;
}

export interface JournalHandoffRepository {
  claimAssignment(token: string, worker: string): Promise<JournalAssignmentRecord | null>;
  readMode(): Promise<JournalMode>;
  findAssignment(id: string): Promise<JournalAssignmentRecord | null>;
  claimContext(assignmentId: string): Promise<JournalClaimContext>;
  policyContext(
    assignmentId: string
  ): Promise<Omit<JournalPolicyContext, "productFacts" | "industrySlugs" | "now">>;
  findSource(assignmentId: string, url: string): Promise<JournalSourceRecord | null>;
  countClaimSources(assignmentId: string, token: string): Promise<number>;
  maxSources(): Promise<number>;
  storeSource(
    assignmentId: string,
    token: string,
    snapshot: JournalSourceSnapshotInput
  ): Promise<{ id: string; existing: boolean } | { code: string }>;
  recordAttempt(id: string, token: string, detail: Record<string, unknown>): Promise<boolean>;
  finishAssignment(
    id: string,
    token: string,
    state: "drafted" | "queued" | "blocked",
    code: string | null,
    pack: JournalPackage | null,
    slug: string | null,
    title: string | null
  ): Promise<string | null>;
}

export class JournalSourceFetchError extends Error {
  constructor(
    public readonly code: string,
    public readonly status?: number
  ) {
    super(code);
    this.name = "JournalSourceFetchError";
  }
}

export interface JournalHandoffDependencies {
  repository: JournalHandoffRepository;
  now: () => Date;
  /** OPS's own guarded fetch; throws JournalSourceFetchError on a refusal. */
  fetchSource: (url: string) => Promise<JournalSourceSnapshotInput>;
  loadBrief: () => JournalReference;
  loadGuide: () => JournalReference;
  loadFacts: () => JournalReference;
}

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

const claimBodySchema = z.object({ worker: z.string().trim().min(1).max(120) }).strict();
const sourceBodySchema = z
  .object({ claim_token: z.string().uuid(), url: z.string().trim().min(8).max(2048) })
  .strict();
const usageSchema = z
  .array(
    z
      .object({
        stage: z.enum(["writer", "editor"]),
        model: z.string().min(1).max(120),
        input: z.number().int().nonnegative().optional(),
        output: z.number().int().nonnegative().optional(),
      })
      .strict()
  )
  .max(12);
const releaseBodySchema = z
  .object({
    claim_token: z.string().uuid(),
    outcome: z.enum(["error", "unsupported"]),
    detail: z.string().max(2000).optional(),
  })
  .strict();
const uuidSchema = z.string().uuid();

function schemaInvalid(error: z.ZodError) {
  return json(
    {
      error: "DRAFT_REJECTED",
      code: "SCHEMA_INVALID",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    },
    422
  );
}

function guard(request: NextRequest): NextResponse | null {
  if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  const configured = process.env.JOURNAL_AUTHORING_TOKEN?.trim() ?? "";
  if (configured.length < 32) return json({ code: "JOURNAL_AUTHORING_NOT_CONFIGURED" }, 503);
  const provided = readBearerToken(request.headers.get("authorization"));
  if (!provided || !secureTokenEquals(provided, configured))
    return json({ code: "JOURNAL_AUTHORING_INVALID" }, 401);
  return null;
}

async function readBody(
  request: NextRequest
): Promise<{ value: unknown } | { response: NextResponse }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BODY_LIMIT_BYTES)
    return { response: json({ code: "BODY_TOO_LARGE" }, 413) };
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { response: json({ code: "INVALID_JSON" }, 400) };
  }
  if (Buffer.byteLength(raw, "utf8") > BODY_LIMIT_BYTES)
    return { response: json({ code: "BODY_TOO_LARGE" }, 413) };
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return { response: json({ code: "INVALID_JSON" }, 400) };
  }
}

function ownerToken(body: unknown): string | null {
  const token = (body as { claim_token?: unknown } | null)?.claim_token;
  return uuidSchema.safeParse(token).success ? (token as string) : null;
}

/** The URL OPS keys a snapshot by: parsed, fragment dropped. */
export function sourceKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sourcePayload(source: JournalSourceRecord, existing: boolean) {
  return {
    source_id: source.id,
    existing,
    url: source.url,
    final_url: source.final_url,
    content_type: source.content_type,
    title: source.title,
    site_name: source.site_name,
    published_hint: source.published_hint,
    modified_hint: source.modified_hint,
    fetched_at: source.fetched_at,
    truncated: source.truncated,
    text: source.text,
  };
}

export function createJournalHandoffHandlers(d: JournalHandoffDependencies) {
  const { repository } = d;

  async function claim(request: NextRequest): Promise<NextResponse> {
    const denied = guard(request);
    if (denied) return denied;
    const body = await readBody(request);
    if ("response" in body) return body.response;
    const parsed = claimBodySchema.safeParse(body.value);
    if (!parsed.success) return schemaInvalid(parsed.error);

    const assignment = await repository.claimAssignment(randomUUID(), parsed.data.worker);
    if (!assignment?.claim_token) {
      const mode = await repository.readMode();
      return json({ assignment: null, reason: mode === "off" ? "authoring_off" : "idle" });
    }
    const context = await repository.claimContext(assignment.id);
    const brief = d.loadBrief();
    const guide = d.loadGuide();
    const facts = d.loadFacts();
    return json({
      assignment: {
        id: assignment.id,
        identity: assignment.identity,
        kind: "weekly",
        mode: assignment.mode ?? "prepare",
        slot_date: assignment.slot_date,
        publishes_at: assignment.slot_at,
        attempt: assignment.attempts,
        attempts_remaining: Math.max(0, MAX_ATTEMPTS - assignment.attempts),
        claim_token: assignment.claim_token,
        lease_until: assignment.lease_until,
        current_time: d.now().toISOString(),
        brief_version: JOURNAL_BRIEF_VERSION,
        format: JOURNAL_FORMAT,
        limits: JOURNAL_LIMITS,
        max_sources: context.maxSources,
        categories: context.categories.map(({ slug, name }) => ({ slug, name })),
        industry_pages: JOURNAL_INDUSTRY_SLUGS.map((slug) => `/industries/${slug}`),
        recent_posts: context.recentPosts.slice(0, RECENT_POSTS),
        backlog_topics: context.backlogTopics,
        fetched_sources: context.fetchedSources,
        brief,
        guide,
        product_facts: facts,
      },
    });
  }

  async function loadOwned(
    id: string,
    body: unknown,
    now: Date
  ): Promise<{ assignment: JournalAssignmentRecord; token: string } | { response: NextResponse }> {
    if (!uuidSchema.safeParse(id).success)
      return { response: json({ code: "ASSIGNMENT_NOT_FOUND" }, 404) };
    const assignment = await repository.findAssignment(id);
    if (!assignment) return { response: json({ code: "ASSIGNMENT_NOT_FOUND" }, 404) };
    const token = ownerToken(body);
    if (
      !token ||
      assignment.claim_token !== token ||
      assignment.state !== "authoring" ||
      !assignment.lease_until ||
      Date.parse(assignment.lease_until) <= now.getTime()
    )
      return { response: json({ code: "CLAIM_NOT_OWNED" }, 409) };
    return { assignment, token };
  }

  async function source(request: NextRequest, id: string): Promise<NextResponse> {
    const denied = guard(request);
    if (denied) return denied;
    const body = await readBody(request);
    if ("response" in body) return body.response;
    const owned = await loadOwned(id, body.value, d.now());
    if ("response" in owned) return owned.response;
    const parsed = sourceBodySchema.safeParse(body.value);
    if (!parsed.success) return schemaInvalid(parsed.error);
    const key = sourceKey(parsed.data.url);
    if (!key) return json({ code: "SOURCE_URL_INVALID" }, 422);

    const existing = await repository.findSource(owned.assignment.id, key);
    if (existing) return json(sourcePayload(existing, true));
    if (
      (await repository.countClaimSources(owned.assignment.id, owned.token)) >=
      (await repository.maxSources())
    )
      return json({ code: "SOURCE_LIMIT" }, 429);

    let snapshot: JournalSourceSnapshotInput;
    try {
      snapshot = await d.fetchSource(key);
    } catch (error) {
      if (error instanceof JournalSourceFetchError)
        return json(
          { code: error.code, ...(error.status ? { status: error.status } : {}) },
          422
        );
      throw error;
    }
    const stored = await repository.storeSource(owned.assignment.id, owned.token, {
      ...snapshot,
      url: key,
    });
    if ("code" in stored)
      return json({ code: stored.code }, stored.code === "SOURCE_LIMIT" ? 429 : 409);
    const record = await repository.findSource(owned.assignment.id, key);
    if (!record) return json({ code: "CLAIM_NOT_OWNED" }, 409);
    return json(sourcePayload(record, stored.existing));
  }

  async function draft(request: NextRequest, id: string): Promise<NextResponse> {
    const denied = guard(request);
    if (denied) return denied;
    const body = await readBody(request);
    if ("response" in body) return body.response;
    const now = d.now();

    if (!uuidSchema.safeParse(id).success) return json({ code: "ASSIGNMENT_NOT_FOUND" }, 404);
    const existing = await repository.findAssignment(id);
    if (!existing) return json({ code: "ASSIGNMENT_NOT_FOUND" }, 404);
    const token = ownerToken(body.value);
    // A run that lost the response to a call it already won reads back the
    // same accepted draft instead of authoring a second one.
    if (token && existing.claim_token === token && existing.state === "drafted" && existing.package)
      return json({ state: "drafted", identity: existing.identity, title: existing.title });

    const owned = await loadOwned(id, body.value, now);
    if ("response" in owned) return owned.response;
    const { assignment } = owned;
    const claimToken = owned.token;

    if (assignment.submissions >= MAX_SUBMISSIONS_PER_CLAIM) {
      await repository.finishAssignment(assignment.id, claimToken, "queued", "SUBMISSIONS_EXHAUSTED", null, null, null);
      return json({ code: "SUBMISSIONS_EXHAUSTED" }, 429);
    }
    const envelope = (body.value ?? {}) as { candidate?: unknown; editor?: unknown; usage?: unknown };
    await repository.recordAttempt(assignment.id, claimToken, {
      event: "submission",
      at: now.toISOString(),
    });

    const editor = journalEditorSchema.safeParse(envelope.editor);
    if (!editor.success) return schemaInvalid(editor.error);
    const usage = usageSchema.safeParse(envelope.usage ?? []);
    if (!usage.success) return schemaInvalid(usage.error);

    const facts = d.loadFacts();
    let prepared: PreparedJournalDraft;
    try {
      prepared = prepareJournalDraft(envelope.candidate, {
        ...(await repository.policyContext(assignment.id)),
        productFacts: facts.content,
        industrySlugs: JOURNAL_INDUSTRY_SLUGS,
        now,
      });
    } catch (error) {
      if (error instanceof JournalDraftError) {
        await repository.recordAttempt(assignment.id, claimToken, {
          event: "rejected",
          code: error.code,
          issues: error.issues.slice(0, 5),
          at: now.toISOString(),
        });
        return json({ error: "DRAFT_REJECTED", code: error.code, issues: error.issues }, 422);
      }
      throw error;
    }

    const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - assignment.attempts);
    if (!isJournalApproved(editor.data)) {
      await repository.recordAttempt(assignment.id, claimToken, {
        event: "editor_rejected",
        reason: editor.data.reason,
        notes: editor.data.notes ?? null,
        at: now.toISOString(),
      });
      await repository.finishAssignment(assignment.id, claimToken, "queued", "EDITOR_REJECTED", null, null, null);
      return json({ state: "rejected", attempts_remaining: attemptsRemaining });
    }

    const brief = d.loadBrief();
    const guide = d.loadGuide();
    const pack: JournalPackage = {
      ...prepared,
      review: editor.data,
      usage: usage.data,
      references: [brief, guide, facts].map(({ path, sha256 }) => ({ path, sha256 })),
      brief_version: JOURNAL_BRIEF_VERSION,
    };
    const finalState = await repository.finishAssignment(
      assignment.id,
      claimToken,
      "drafted",
      null,
      pack,
      prepared.article.slug,
      prepared.article.title
    );
    if (finalState === "SLUG_TAKEN")
      return json(
        {
          error: "DRAFT_REJECTED",
          code: "SLUG_TAKEN",
          issues: [{ path: "slug", message: "another post or draft already uses this slug" }],
        },
        422
      );
    if (finalState !== "drafted") return json({ code: "CLAIM_NOT_OWNED" }, 409);
    return json({ state: "drafted", identity: assignment.identity, title: prepared.article.title });
  }

  async function release(request: NextRequest, id: string): Promise<NextResponse> {
    const denied = guard(request);
    if (denied) return denied;
    const body = await readBody(request);
    if ("response" in body) return body.response;
    const now = d.now();
    const owned = await loadOwned(id, body.value, now);
    if ("response" in owned) return owned.response;
    const parsed = releaseBodySchema.safeParse(body.value);
    if (!parsed.success) return schemaInvalid(parsed.error);
    const { assignment, token } = owned;
    await repository.recordAttempt(assignment.id, token, {
      event: "release",
      outcome: parsed.data.outcome,
      detail: parsed.data.detail ?? "",
      at: now.toISOString(),
    });
    const unsupported = parsed.data.outcome === "unsupported";
    const code = unsupported
      ? "UNSUPPORTED_TOPIC"
      : assignment.attempts >= MAX_ATTEMPTS
        ? "ATTEMPTS_EXHAUSTED"
        : "AUTHORING_ERROR";
    const finalState = await repository.finishAssignment(
      assignment.id,
      token,
      unsupported ? "blocked" : "queued",
      code,
      null,
      null,
      null
    );
    if (!finalState) return json({ code: "CLAIM_NOT_OWNED" }, 409);
    return json({ state: finalState, code });
  }

  return { claim, source, draft, release };
}
