import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBearerToken, secureTokenEquals } from "../auth";
import {
  chooseSource,
  prepareSubmission,
  type EditorialKind,
  type EditorialSource,
} from "./policy";
import {
  editorReviewSchema,
  isEditorialApproved,
  RECENT_HOOKS_LIMIT,
  type EditorialBrief,
} from "./brief";
import type { EditorialPackage } from "./worker";

const BODY_LIMIT_BYTES = 200_000;
const MAX_ATTEMPTS = 3;
const MAX_SUBMISSIONS_PER_CLAIM = 3;
// A claim that lands on withdrawn or exhausted work moves to the next row
// rather than answering "idle" and leaving the queue apparently empty.
const CLAIM_ATTEMPTS = 3;

// Failures prepareSubmission raises by name. Anything else is a shape problem.
const DETERMINISTIC_CODES = new Set([
  "EVIDENCE_INVALID",
  "IMAGE_REQUIRED",
  "DUPLICATE_HOOK",
  "MODEL_LINK_REJECTED",
  "UNSUPPORTED_NUMBER",
  "VOICE_REJECTED",
  "SLIDE_COUNT",
  "SCHEMA_INVALID",
]);

export interface EditorialAssignmentRecord {
  id: string;
  identity: string;
  kind: EditorialKind;
  mode: "prepare" | "publish" | null;
  state: string;
  attempts: number;
  submissions: number;
  claim_token: string | null;
  lease_until: string | null;
  blog_id: string | null;
  slot_date: string | null;
  source_snapshot: EditorialSource | null;
  package: EditorialPackage | null;
}

export interface EditorialAssignmentContext {
  sources: EditorialSource[];
  usedSourceIds: string[];
  recentHooks: string[];
}

export interface EditorialHandoffRepository {
  claimAssignment(
    token: string,
    worker: string
  ): Promise<EditorialAssignmentRecord | null>;
  readMode(): Promise<"off" | "prepare" | "publish">;
  findAssignment(id: string): Promise<EditorialAssignmentRecord | null>;
  findLiveBlogSource(id: string): Promise<EditorialSource | null>;
  assignmentContext(kind: EditorialKind): Promise<EditorialAssignmentContext>;
  checkpointAssignment(
    id: string,
    token: string,
    source: EditorialSource,
    briefVersion: string,
    guideSha256: string
  ): Promise<boolean>;
  recordAssignmentAttempt(
    id: string,
    token: string,
    detail: Record<string, unknown>
  ): Promise<boolean>;
  finishAssignment(
    id: string,
    token: string,
    state: "drafted" | "queued" | "blocked",
    code: string | null,
    pack: EditorialPackage | null
  ): Promise<string | null>;
}

export interface EditorialHandoffDependencies {
  repository: EditorialHandoffRepository;
  now: () => Date;
  loadBrief: (kind: EditorialKind) => EditorialBrief;
  loadGuide: () => { path: string; sha256: string; content: string };
}

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

const claimBodySchema = z
  .object({ worker: z.string().trim().min(1).max(120) })
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

function issuesOf(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function schemaInvalid(error: z.ZodError) {
  return json(
    {
      error: "DRAFT_REJECTED",
      code: "SCHEMA_INVALID",
      issues: issuesOf(error),
    },
    422
  );
}

function guard(request: NextRequest): NextResponse | null {
  if (request.method !== "POST")
    return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  const configured = process.env.SOCIAL_AUTHORING_TOKEN?.trim() ?? "";
  if (configured.length < 32)
    return json({ code: "SOCIAL_AUTHORING_NOT_CONFIGURED" }, 503);
  const provided = readBearerToken(request.headers.get("authorization"));
  if (!provided || !secureTokenEquals(provided, configured))
    return json({ code: "SOCIAL_AUTHORING_INVALID" }, 401);
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

function packageTitle(pack: EditorialPackage | null): string {
  return pack?.submission?.content?.title ?? "";
}

export function createEditorialHandoffHandlers(
  d: EditorialHandoffDependencies
) {
  const { repository } = d;

  // Resolves the article the routine will write from. A blog assignment is
  // bound to its own article forever; a recurring day picks the freshest live
  // article nothing has used recently.
  async function resolveSource(
    assignment: EditorialAssignmentRecord,
    context: EditorialAssignmentContext,
    now: Date
  ): Promise<{ source: EditorialSource } | { code: string }> {
    if (assignment.kind === "blog") {
      const source = assignment.blog_id
        ? await repository.findLiveBlogSource(assignment.blog_id)
        : null;
      return source ? { source } : { code: "SOURCE_WITHDRAWN" };
    }
    const source = chooseSource(
      context.sources,
      context.usedSourceIds,
      now,
      assignment.kind
    );
    return source ? { source } : { code: "NO_FRESH_SOURCE" };
  }

  async function claim(request: NextRequest): Promise<NextResponse> {
    const denied = guard(request);
    if (denied) return denied;
    const body = await readBody(request);
    if ("response" in body) return body.response;
    const parsed = claimBodySchema.safeParse(body.value);
    if (!parsed.success) return schemaInvalid(parsed.error);

    const now = d.now();
    for (let iteration = 0; iteration < CLAIM_ATTEMPTS; iteration += 1) {
      const assignment = await repository.claimAssignment(
        randomUUID(),
        parsed.data.worker
      );
      if (!assignment) {
        const mode = await repository.readMode();
        return json({
          assignment: null,
          reason: mode === "off" ? "authoring_off" : "idle",
        });
      }
      const token = assignment.claim_token;
      if (!token) return json({ assignment: null, reason: "idle" });

      const context = await repository.assignmentContext(assignment.kind);
      const resolved = await resolveSource(assignment, context, now);
      if ("code" in resolved) {
        await repository.finishAssignment(
          assignment.id,
          token,
          "blocked",
          resolved.code,
          null
        );
        continue;
      }

      const brief = d.loadBrief(assignment.kind);
      const guide = d.loadGuide();
      // The stored snapshot is the whole source, including is_live, because the
      // worker later compares it field by field before anything is published.
      if (
        !(await repository.checkpointAssignment(
          assignment.id,
          token,
          resolved.source,
          brief.version,
          guide.sha256
        ))
      )
        return json({ assignment: null, reason: "idle" });

      return json({
        assignment: {
          id: assignment.id,
          identity: assignment.identity,
          kind: assignment.kind,
          mode: assignment.mode ?? "prepare",
          attempt: assignment.attempts,
          attempts_remaining: Math.max(0, MAX_ATTEMPTS - assignment.attempts),
          claim_token: token,
          lease_until: assignment.lease_until,
          brief_version: brief.version,
          current_time: now.toISOString(),
          source: {
            id: resolved.source.id,
            title: resolved.source.title,
            slug: resolved.source.slug,
            url: `https://opsapp.co/journal/${resolved.source.slug}`,
            published_at: resolved.source.published_at,
            text: resolved.source.text,
            thumbnail_url: resolved.source.thumbnail_url,
          },
          recent_hooks: context.recentHooks.slice(0, RECENT_HOOKS_LIMIT),
          format: brief.format,
          limits: brief.limits,
          guide,
        },
      });
    }
    return json({ assignment: null, reason: "idle" });
  }

  async function loadOwned(
    id: string,
    body: unknown,
    now: Date
  ): Promise<
    | { assignment: EditorialAssignmentRecord; token: string }
    | { response: NextResponse }
  > {
    if (!uuidSchema.safeParse(id).success)
      return { response: json({ code: "ASSIGNMENT_NOT_FOUND" }, 404) };
    const assignment = await repository.findAssignment(id);
    if (!assignment)
      return { response: json({ code: "ASSIGNMENT_NOT_FOUND" }, 404) };
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

  async function draft(
    request: NextRequest,
    id: string
  ): Promise<NextResponse> {
    const denied = guard(request);
    if (denied) return denied;
    const body = await readBody(request);
    if ("response" in body) return body.response;
    const now = d.now();

    if (!uuidSchema.safeParse(id).success)
      return json({ code: "ASSIGNMENT_NOT_FOUND" }, 404);
    const existing = await repository.findAssignment(id);
    if (!existing) return json({ code: "ASSIGNMENT_NOT_FOUND" }, 404);
    const token = ownerToken(body.value);

    // A routine that lost the response to a call it already won reads back the
    // same accepted draft instead of authoring a second one.
    if (
      token &&
      existing.claim_token === token &&
      existing.state === "drafted" &&
      existing.package
    )
      return json({
        state: "drafted",
        identity: existing.identity,
        title: packageTitle(existing.package),
      });

    const owned = await loadOwned(id, body.value, now);
    if ("response" in owned) return owned.response;
    const { assignment } = owned;
    const claimToken = owned.token;

    if (assignment.submissions >= MAX_SUBMISSIONS_PER_CLAIM) {
      await repository.finishAssignment(
        assignment.id,
        claimToken,
        "queued",
        "SUBMISSIONS_EXHAUSTED",
        null
      );
      return json({ code: "SUBMISSIONS_EXHAUSTED" }, 429);
    }

    const source = assignment.source_snapshot;
    if (!source) {
      await repository.finishAssignment(
        assignment.id,
        claimToken,
        "queued",
        "SNAPSHOT_MISSING",
        null
      );
      return json({ code: "CLAIM_NOT_OWNED" }, 409);
    }

    const envelope = (body.value ?? {}) as {
      candidate?: unknown;
      editor?: unknown;
      usage?: unknown;
    };
    await repository.recordAssignmentAttempt(assignment.id, claimToken, {
      event: "submission",
      at: now.toISOString(),
    });

    const editor = editorReviewSchema.safeParse(envelope.editor);
    if (!editor.success) return schemaInvalid(editor.error);
    const usage = usageSchema.safeParse(envelope.usage ?? []);
    if (!usage.success) return schemaInvalid(usage.error);

    const context = await repository.assignmentContext(assignment.kind);
    let submission;
    try {
      submission = prepareSubmission(
        envelope.candidate,
        source,
        context.recentHooks,
        assignment.kind
      );
    } catch (error) {
      if (error instanceof z.ZodError) return schemaInvalid(error);
      const code =
        error instanceof Error && DETERMINISTIC_CODES.has(error.message)
          ? error.message
          : "SCHEMA_INVALID";
      return json({ error: "DRAFT_REJECTED", code, issues: [] }, 422);
    }

    const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - assignment.attempts);
    if (!isEditorialApproved(editor.data)) {
      await repository.recordAssignmentAttempt(assignment.id, claimToken, {
        event: "editor_rejected",
        reason: editor.data.reason,
        notes: editor.data.notes ?? null,
      });
      await repository.finishAssignment(
        assignment.id,
        claimToken,
        "queued",
        "EDITOR_REJECTED",
        null
      );
      return json({ state: "rejected", attempts_remaining: attemptsRemaining });
    }

    const brief = d.loadBrief(assignment.kind);
    const guide = d.loadGuide();
    const candidate = envelope.candidate as { evidence: unknown[] };
    const finalState = await repository.finishAssignment(
      assignment.id,
      claimToken,
      "drafted",
      null,
      {
        submission,
        evidence: candidate.evidence,
        review: editor.data,
        usage: usage.data,
        references: [{ path: guide.path, sha256: guide.sha256 }],
        brief_version: brief.version,
      }
    );
    if (finalState !== "drafted") return json({ code: "CLAIM_NOT_OWNED" }, 409);
    return json({
      state: "drafted",
      identity: assignment.identity,
      title: submission.content.title,
    });
  }

  async function release(
    request: NextRequest,
    id: string
  ): Promise<NextResponse> {
    const denied = guard(request);
    if (denied) return denied;
    const body = await readBody(request);
    if ("response" in body) return body.response;
    const now = d.now();

    const owned = await loadOwned(id, body.value, now);
    if ("response" in owned) return owned.response;
    const { assignment, token } = owned;

    const parsed = releaseBodySchema.safeParse(body.value);
    if (!parsed.success) return schemaInvalid(parsed.error);

    await repository.recordAssignmentAttempt(assignment.id, token, {
      event: "release",
      outcome: parsed.data.outcome,
      detail: parsed.data.detail ?? "",
      at: now.toISOString(),
    });

    const unsupported = parsed.data.outcome === "unsupported";
    const code = unsupported
      ? "UNSUPPORTED_FORMAT"
      : assignment.attempts >= MAX_ATTEMPTS
        ? "ATTEMPTS_EXHAUSTED"
        : "AUTHORING_ERROR";
    const finalState = await repository.finishAssignment(
      assignment.id,
      token,
      unsupported ? "blocked" : "queued",
      code,
      null
    );
    if (!finalState) return json({ code: "CLAIM_NOT_OWNED" }, 409);
    return json({ state: finalState, code });
  }

  return { claim, draft, release };
}
