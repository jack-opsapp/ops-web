/**
 * Google Ads engine — the routine handoff (design spec §5.1).
 *
 * Three handlers behind `ADS_ENGINE_TOKEN`: `claim` leases one run and hands
 * over the brief; `proposals` validates typed proposals deterministically and
 * files the accepted ones as `proposed`; `release` closes the run with the
 * routine's summary. Pure: the repository, the clock and the brief builder are
 * injected, so the boundary is proved without a database. This module has no
 * path into Google, the apply layer, or the operator rail.
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBearerToken, secureTokenEquals } from "@/lib/social/auth";
import { BriefUnavailableError, type Brief } from "./brief";
import { STRUCTURAL_KINDS } from "./guardrails";
import { PROPOSAL_KINDS, type EngineSettings, type NormalizedProposal, type ProposalKind, type ValidationContext, type ValidationIssue } from "./types";
import { validateProposal } from "./validate-proposal";

const BODY_LIMIT_BYTES = 200_000;
export const MAX_SUBMISSIONS_PER_INDEX = 3;
const MAX_PROPOSALS_PER_BATCH = 40;

export interface EngineRunRecord {
  id: string;
  state: "claimed" | "released" | "expired";
  worker: string;
  claim_token: string;
  lease_until: string;
  duties: string[];
  brief_version: string | null;
  submission_counts: Record<string, number>;
  proposals_accepted: number;
  proposals_rejected: number;
}

export type EngineValidationInputs = Pick<
  ValidationContext,
  "settings" | "snapshot" | "metrics28d" | "tests" | "ledger" | "openProposals" | "funnel"
>;

export interface EngineHandoffRepository {
  claimRun(token: string, worker: string): Promise<EngineRunRecord | null>;
  readSettings(): Promise<EngineSettings>;
  hasLiveRun(): Promise<boolean>;
  findRun(id: string): Promise<EngineRunRecord | null>;
  checkpointRun(id: string, token: string, duties: string[], briefVersion: string): Promise<boolean>;
  recordSubmission(id: string, token: string, index: number, detail: Record<string, unknown>): Promise<number | null>;
  acceptProposal(
    runId: string,
    token: string,
    normalized: NormalizedProposal,
    index: number,
    mode: "propose" | "auto"
  ): Promise<string | null>;
  releaseRun(id: string, token: string, summary: string, outcome: string): Promise<string | null>;
  validationContext(): Promise<EngineValidationInputs>;
  structuralAcceptedInRun(runId: string): Promise<number>;
}

export interface EngineHandoffDependencies {
  repository: EngineHandoffRepository;
  now: () => Date;
  buildBrief: () => Promise<Brief>;
  allowedFinalUrls: string[];
}

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

const claimBodySchema = z.object({ worker: z.string().trim().min(1).max(120) }).strict();
const proposalsBodySchema = z
  .object({
    claim_token: z.string().uuid(),
    proposals: z.array(z.unknown()).min(1).max(MAX_PROPOSALS_PER_BATCH),
  })
  .strict();
const releaseBodySchema = z
  .object({
    claim_token: z.string().uuid(),
    outcome: z.enum(["done", "error", "nothing_to_do"]),
    summary: z.string().max(20_000).default(""),
  })
  .strict();
const itemIndexSchema = z.number().int().min(0).max(999);
const uuidSchema = z.string().uuid();

function issuesOf(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    code: "SCHEMA_INVALID",
    field: issue.path.join("."),
    message: issue.message,
  }));
}

function guard(request: NextRequest): NextResponse | null {
  if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  const configured = process.env.ADS_ENGINE_TOKEN?.trim() ?? "";
  if (configured.length < 32) return json({ code: "ADS_ENGINE_NOT_CONFIGURED" }, 503);
  const provided = readBearerToken(request.headers.get("authorization"));
  if (!provided || !secureTokenEquals(provided, configured)) return json({ code: "ADS_ENGINE_INVALID" }, 401);
  return null;
}

async function readBody(request: NextRequest): Promise<{ value: unknown } | { response: NextResponse }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BODY_LIMIT_BYTES) return { response: json({ code: "BODY_TOO_LARGE" }, 413) };
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { response: json({ code: "INVALID_JSON" }, 400) };
  }
  if (Buffer.byteLength(raw, "utf8") > BODY_LIMIT_BYTES) return { response: json({ code: "BODY_TOO_LARGE" }, 413) };
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

export type ProposalResult =
  | { index: number; accepted: true; id: string; kind: ProposalKind; mode: "propose" | "auto"; target: string; replay?: true }
  | { index: number; accepted: false; code: string; issues: ValidationIssue[] };

export function createEngineHandoffHandlers(d: EngineHandoffDependencies) {
  const { repository } = d;

  async function loadOwned(
    id: string,
    body: unknown,
    now: Date
  ): Promise<{ run: EngineRunRecord; token: string } | { response: NextResponse }> {
    if (!uuidSchema.safeParse(id).success) return { response: json({ code: "RUN_NOT_FOUND" }, 404) };
    const run = await repository.findRun(id);
    if (!run) return { response: json({ code: "RUN_NOT_FOUND" }, 404) };
    const token = ownerToken(body);
    if (!token || run.claim_token !== token || run.state !== "claimed" || Date.parse(run.lease_until) <= now.getTime())
      return { response: json({ code: "CLAIM_NOT_OWNED" }, 409) };
    return { run, token };
  }

  async function claim(request: NextRequest): Promise<NextResponse> {
    const denied = guard(request);
    if (denied) return denied;
    const body = await readBody(request);
    if ("response" in body) return body.response;
    const parsed = claimBodySchema.safeParse(body.value);
    if (!parsed.success) return json({ code: "SCHEMA_INVALID", issues: issuesOf(parsed.error) }, 422);

    const now = d.now();
    const run = await repository.claimRun(randomUUID(), parsed.data.worker);
    if (!run) {
      const settings = await repository.readSettings();
      const allOff = Object.values(settings.modes).every((mode) => mode === "off");
      if (allOff) return json({ run: null, reason: "engine_off" });
      if (await repository.hasLiveRun()) return json({ run: null, reason: "run_active" });
      return json({ run: null, reason: "idle" });
    }

    let brief: Brief;
    try {
      brief = await d.buildBrief();
    } catch (error) {
      if (error instanceof BriefUnavailableError) {
        await repository.releaseRun(run.id, run.claim_token, error.reason, "brief_unavailable");
        return json({ run: null, reason: "not_ready", detail: error.reason });
      }
      const message = error instanceof Error ? error.message : String(error);
      await repository.releaseRun(run.id, run.claim_token, `BRIEF_FAILED: ${message}`.slice(0, 2000), "error");
      return json({ code: "BRIEF_FAILED" }, 500);
    }

    if (!(await repository.checkpointRun(run.id, run.claim_token, brief.duties, brief.version)))
      return json({ run: null, reason: "idle" });

    return json({
      run: {
        id: run.id,
        claim_token: run.claim_token,
        lease_until: run.lease_until,
        current_time: now.toISOString(),
        worker: run.worker,
      },
      brief,
    });
  }

  async function proposals(request: NextRequest, id: string): Promise<NextResponse> {
    const denied = guard(request);
    if (denied) return denied;
    const body = await readBody(request);
    if ("response" in body) return body.response;
    const now = d.now();

    const owned = await loadOwned(id, body.value, now);
    if ("response" in owned) return owned.response;
    const { run, token } = owned;

    const parsed = proposalsBodySchema.safeParse(body.value);
    if (!parsed.success) return json({ code: "SCHEMA_INVALID", issues: issuesOf(parsed.error) }, 422);

    const inputs = await repository.validationContext();
    let structuralAccepted = await repository.structuralAcceptedInRun(run.id);
    const batchTargets = new Set<string>();
    const results: ProposalResult[] = [];

    for (const [position, item] of parsed.data.proposals.entries()) {
      const record = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
      const explicit = itemIndexSchema.safeParse(record.index);
      const index = explicit.success ? explicit.data : position;
      const { index: _index, ...envelope } = record;
      void _index;
      const kind = typeof envelope.kind === "string" && (PROPOSAL_KINDS as readonly string[]).includes(envelope.kind)
        ? (envelope.kind as ProposalKind)
        : null;

      const count = await repository.recordSubmission(run.id, token, index, {
        event: "submission",
        at: now.toISOString(),
        kind: kind ?? String(envelope.kind ?? ""),
      });
      if (count === null) return json({ code: "CLAIM_NOT_OWNED" }, 409);
      if (count > MAX_SUBMISSIONS_PER_INDEX) {
        results.push({ index, accepted: false, code: "SUBMISSIONS_EXHAUSTED", issues: [] });
        continue;
      }

      if (kind && inputs.settings.modes[kind] === "off") {
        results.push({
          index,
          accepted: false,
          code: "KIND_OFF",
          issues: [{ code: "KIND_OFF", field: "kind", message: `${kind} is switched off in the engine settings; skip it this run.` }],
        });
        continue;
      }

      const ctx: ValidationContext = {
        ...inputs,
        allowedFinalUrls: d.allowedFinalUrls,
        structuralAcceptedThisRun: structuralAccepted,
        now,
      };
      const verdict = validateProposal(envelope, ctx);

      if (!verdict.ok) {
        const ref = verdict.code === "DUPLICATE_PROPOSAL" ? verdict.issues[0]?.ref : undefined;
        const previous = ref ? inputs.openProposals.find((open) => open.id === ref && open.runId === run.id) : undefined;
        if (previous) {
          // The routine lost the answer to a batch it already won; read it back.
          results.push({ index, accepted: true, id: previous.id, kind: previous.kind, mode: inputs.settings.modes[previous.kind] === "auto" ? "auto" : "propose", target: previous.target, replay: true });
          continue;
        }
        results.push({ index, accepted: false, code: verdict.code, issues: verdict.issues });
        continue;
      }

      if (batchTargets.has(verdict.normalized.target)) {
        results.push({
          index,
          accepted: false,
          code: "DUPLICATE_PROPOSAL",
          issues: [{ code: "DUPLICATE_PROPOSAL", field: "kind", message: "The same change appears earlier in this batch." }],
        });
        continue;
      }

      const mode = inputs.settings.modes[verdict.normalized.kind] === "auto" ? "auto" : "propose";
      const proposalId = await repository.acceptProposal(run.id, token, verdict.normalized, index, mode);
      if (!proposalId) return json({ code: "CLAIM_NOT_OWNED" }, 409);
      batchTargets.add(verdict.normalized.target);
      if (STRUCTURAL_KINDS.has(verdict.normalized.kind)) structuralAccepted += 1;
      results.push({ index, accepted: true, id: proposalId, kind: verdict.normalized.kind, mode, target: verdict.normalized.target });
    }

    const exhausted = results.length > 0 && results.every((r) => !r.accepted && r.code === "SUBMISSIONS_EXHAUSTED");
    return json({ run_id: run.id, results }, exhausted ? 429 : 200);
  }

  async function release(request: NextRequest, id: string): Promise<NextResponse> {
    const denied = guard(request);
    if (denied) return denied;
    const body = await readBody(request);
    if ("response" in body) return body.response;
    const now = d.now();

    const owned = await loadOwned(id, body.value, now);
    if ("response" in owned) return owned.response;
    const { run, token } = owned;

    const parsed = releaseBodySchema.safeParse(body.value);
    if (!parsed.success) return json({ code: "SCHEMA_INVALID", issues: issuesOf(parsed.error) }, 422);

    const state = await repository.releaseRun(run.id, token, parsed.data.summary, parsed.data.outcome);
    if (!state) return json({ code: "CLAIM_NOT_OWNED" }, 409);
    return json({ state, outcome: parsed.data.outcome });
  }

  return { claim, proposals, release };
}
