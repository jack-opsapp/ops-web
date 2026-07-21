// src/lib/api/services/lead-summary-service.ts
// Activity-driven lead summary generation + refresh.
//
// The shipped email engine (ai-sync-reviewer via sync-engine) writes
// opportunities.ai_summary only when NEW email thread activity arrives, so
// leads born outside email (site visits, logged calls, manual creation) and
// leads whose last email predates the engine never receive or refresh a
// summary. This service closes both gaps from the database alone:
//
//   - mode "backfill": one-time manual pass over open leads with
//     ai_summary IS NULL (POST /api/cron/lead-summary-refresh).
//   - mode "refresh": recurring sweep that regenerates summaries whose
//     underlying context (activities, stage transitions, site visits) is
//     newer than ai_summary_updated_at (GET cron, env-gated).
//
// Deliberate boundaries, mirrored from the shipped engine:
//   - Same model lane: gpt-4o-mini on getSyncOpenAI() (OPENAI_API_KEY_SYNC),
//     temperature 0.1, strict JSON schema, singleton server-owned alias key,
//     refusal/finish_reason/contract checks with one contract retry.
//   - Same write path: ai_summary + ai_summary_updated_at ONLY. No stage
//     writes, no ai_stage_signals, no terminal flags, no notifications —
//     lifecycle remains owned by the email engine.
//   - Same tenant gate: AdminFeatureOverrideService phase_c.
//   - email_threads.ai_summary (the inbox thread summary feature) is consumed
//     as READ-ONLY context and never written.
//   - No provider mailbox operations: context comes from our own tables, so
//     this never contends for the per-connection mailbox lock and can never
//     read a reused contact-form platform thread.
//
// opportunities.last_activity_at has NO maintaining trigger in prod and is
// not trusted here; freshness is computed from the source tables. The
// 5-minute staleness epsilon exists because the engine records its stage
// transition seconds AFTER stamping ai_summary_updated_at in the same sync
// pass — without the epsilon every engine stage change would echo one wasted
// regeneration on the next sweep. opportunities.updated_at is deliberately
// ignored (our own summary write bumps it via trg_opp_timestamp, which would
// self-trigger an endless refresh loop).

import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { getSyncOpenAI } from "./openai-clients";

// ─── Tuning constants ────────────────────────────────────────────────────────

const ACTIVE_OPPORTUNITY_STAGES = [
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
] as const;

/** Engine stage-transition echo tolerance (see module doc). */
export const LEAD_SUMMARY_STALENESS_EPSILON_MS = 5 * 60 * 1000;

/** Structural cost cap per run; the stalest remainder is caught next run. */
const DEFAULT_MAX_LEADS_PER_RUN = 40;

const OPEN_OPPS_SCAN_LIMIT = 2000;
const ACTIVITY_FETCH_LIMIT = 10_000;
const TRANSITION_FETCH_LIMIT = 2000;
const SITE_VISIT_FETCH_LIMIT = 1000;
const THREAD_SUMMARY_FETCH_LIMIT = 500;

// Prompt budget caps (characters). Email body cap matches the shipped
// evaluateSingleBatch cap so per-message context parity holds.
const DESCRIPTION_CAP = 600;
const PRIOR_SUMMARY_CAP = 600;
const EMAIL_BODY_CAP = 500;
const ACTIVITY_CONTENT_CAP = 400;
const SITE_VISIT_NOTES_CAP = 400;
const SITE_VISIT_MEASUREMENTS_CAP = 300;
const THREAD_SUMMARY_CAP = 300;

const EMAILS_IN_PROMPT = 10;
const NON_EMAIL_ACTIVITIES_IN_PROMPT = 15;
const STAGE_MOVES_IN_PROMPT = 5;
const SITE_VISITS_IN_PROMPT = 3;
const THREAD_SUMMARIES_IN_PROMPT = 3;

const RESULT_LIST_CAP = 50;

const LEAD_SUMMARY_ERROR_PREFIX = "[lead-summary] generation failed: ";

// The model only ever sees this short server-owned alias — opportunity ids
// stay outside the prompt/output contract (mirrors ai-sync-reviewer).
const EVALUATION_KEY = "k0";

// ─── Error contract (mirrors ai-sync-reviewer) ──────────────────────────────

export class LeadSummaryModelContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`${LEAD_SUMMARY_ERROR_PREFIX}${message}`, options);
    this.name = "LeadSummaryModelContractError";
  }
}

export class LeadSummaryModelRefusalError extends Error {
  constructor(options?: ErrorOptions) {
    super(`${LEAD_SUMMARY_ERROR_PREFIX}model refused summary response`, options);
    this.name = "LeadSummaryModelRefusalError";
  }
}

// ─── Row shapes (narrow, service-role reads) ────────────────────────────────

interface OpportunityRow {
  id: string;
  company_id: string;
  title: string;
  stage: string;
  stage_entered_at: string;
  created_at: string;
  contact_name: string | null;
  address: string | null;
  source: string | null;
  description: string | null;
  estimated_value: number | null;
  detected_value: number | null;
  actual_value: number | null;
  ai_summary: string | null;
  ai_summary_updated_at: string | null;
}

const OPPORTUNITY_FIELDS =
  "id, company_id, title, stage, stage_entered_at, created_at, contact_name, address, source, description, estimated_value, detected_value, actual_value, ai_summary, ai_summary_updated_at";

interface ActivityRow {
  opportunity_id: string;
  type: string;
  direction: string | null;
  subject: string | null;
  content: string | null;
  body_text: string | null;
  outcome: string | null;
  duration_minutes: number | null;
  created_at: string;
}

interface StageTransitionRow {
  opportunity_id: string;
  from_stage: string | null;
  to_stage: string;
  transitioned_at: string;
}

interface SiteVisitRow {
  opportunity_id: string;
  status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  notes: string | null;
  internal_notes: string | null;
  measurements: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ThreadSummaryRow {
  opportunity_id: string;
  ai_summary: string | null;
  last_message_at: string | null;
}

export interface LeadSummaryContextSlices {
  activities: ActivityRow[];
  stageTransitions: StageTransitionRow[];
  siteVisits: SiteVisitRow[];
  threadSummaries: ThreadSummaryRow[];
}

// Matches the lead-lifecycle-cron-service convention: the cron targets tables
// through `any` chains so the route can inject the service-role client and
// tests can inject a chain-level mock.
export interface LeadSummarySupabaseLike {
  from: (table: string) => any;
}

// ─── Run contract ────────────────────────────────────────────────────────────

export interface LeadSummaryRunInput {
  supabase: LeadSummarySupabaseLike;
  mode: "refresh" | "backfill";
  /** Restrict the sweep to one company (still phase_c-verified). */
  companyId?: string;
  /** Report candidates without calling the model or writing. */
  dryRun?: boolean;
  maxLeadsPerRun?: number;
  now?: Date;
}

export interface LeadSummaryRunResult {
  mode: "refresh" | "backfill";
  dryRun: boolean;
  companiesConsidered: number;
  companiesEnabled: number;
  leadsScanned: number;
  candidates: number;
  summariesWritten: number;
  skippedInsufficientContext: number;
  failed: Array<{ opportunityId: string; error: string }>;
  /** Written leads (capped at RESULT_LIST_CAP) for observability. */
  written: Array<{ opportunityId: string; title: string }>;
  /** Candidate preview (capped) — populated in dry runs and real runs alike. */
  candidatesPreview: Array<{ opportunityId: string; title: string }>;
}

// ─── Pure helpers (exported for tests) ──────────────────────────────────────

function clip(value: string | null | undefined, cap: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > cap ? trimmed.slice(0, cap) : trimmed;
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export interface LeadContextAggregates {
  activityCount: number;
  siteVisitCount: number;
  /** Transitions with a non-null from_stage — real moves, not the creation row. */
  realStageMoveCount: number;
  /** Newest context timestamp across all sources + stage_entered_at (ms). */
  latestContextAtMs: number | null;
}

export function computeLeadContextAggregates(
  opportunity: Pick<OpportunityRow, "stage_entered_at">,
  slices: LeadSummaryContextSlices
): LeadContextAggregates {
  let latest: number | null = parseMs(opportunity.stage_entered_at);
  const consider = (value: string | null | undefined) => {
    const ms = parseMs(value);
    if (ms !== null && (latest === null || ms > latest)) latest = ms;
  };
  for (const activity of slices.activities) consider(activity.created_at);
  for (const transition of slices.stageTransitions) {
    consider(transition.transitioned_at);
  }
  for (const visit of slices.siteVisits) {
    consider(visit.updated_at);
    consider(visit.completed_at);
    consider(visit.created_at);
  }
  return {
    activityCount: slices.activities.length,
    siteVisitCount: slices.siteVisits.length,
    realStageMoveCount: slices.stageTransitions.filter(
      (transition) => transition.from_stage !== null
    ).length,
    latestContextAtMs: latest,
  };
}

/**
 * A lead qualifies for generation only when it carries at least one
 * substantive signal. A bare name-only lead produces no summary — writing one
 * would be fabrication, and the lead becomes eligible the moment real
 * activity lands.
 */
export function hasSubstantiveLeadContext(
  opportunity: Pick<OpportunityRow, "description">,
  aggregates: Pick<
    LeadContextAggregates,
    "activityCount" | "siteVisitCount" | "realStageMoveCount"
  >
): boolean {
  if (aggregates.activityCount > 0) return true;
  if (aggregates.siteVisitCount > 0) return true;
  if (aggregates.realStageMoveCount > 0) return true;
  return typeof opportunity.description === "string" &&
    opportunity.description.trim().length > 0;
}

export type LeadStalenessVerdict =
  | "fresh"
  | "stale"
  | "insufficient_context"
  | "not_applicable";

/**
 * Staleness decision for one open lead.
 *
 * - No summary yet → "stale" when substantive context exists (both modes),
 *   otherwise "insufficient_context".
 * - Summary present → backfill mode never touches it ("not_applicable");
 *   refresh mode regenerates when context is newer than the stamp plus the
 *   engine-echo epsilon. A summary with a NULL stamp (legacy seed rows) is
 *   treated as stale whenever substantive context exists so legacy rows heal.
 */
export function evaluateLeadStaleness(
  opportunity: Pick<
    OpportunityRow,
    "ai_summary" | "ai_summary_updated_at" | "description"
  >,
  aggregates: LeadContextAggregates,
  mode: "refresh" | "backfill",
  epsilonMs: number = LEAD_SUMMARY_STALENESS_EPSILON_MS
): LeadStalenessVerdict {
  const substantive = hasSubstantiveLeadContext(opportunity, aggregates);
  if (opportunity.ai_summary === null) {
    return substantive ? "stale" : "insufficient_context";
  }
  if (mode === "backfill") return "not_applicable";
  const stampMs = parseMs(opportunity.ai_summary_updated_at);
  if (stampMs === null) {
    return substantive ? "stale" : "insufficient_context";
  }
  if (
    aggregates.latestContextAtMs !== null &&
    aggregates.latestContextAtMs > stampMs + epsilonMs
  ) {
    return "stale";
  }
  return "fresh";
}

// ─── Prompt context bundle ───────────────────────────────────────────────────

export interface LeadSummaryContextBundle {
  tid: typeof EVALUATION_KEY;
  lead: {
    title: string;
    contact: string | null;
    address: string | null;
    stage: string;
    value: { amount: number; basis: "actual" | "estimated" | "detected" } | null;
    source: string | null;
    created: string;
    description: string | null;
    previous_summary: string | null;
  };
  stage_history: Array<{ from: string | null; to: string; at: string }>;
  site_visits: Array<{
    status: string;
    scheduled: string | null;
    completed: string | null;
    notes: string | null;
    internal_notes: string | null;
    measurements: string | null;
  }>;
  activity: Array<{
    at: string;
    type: string;
    dir: string | null;
    subject: string | null;
    content: string | null;
    outcome: string | null;
    duration_min: number | null;
  }>;
  emails: Array<{
    at: string;
    dir: string | null;
    subj: string | null;
    body: string | null;
  }>;
  email_thread_summaries: string[];
}

function resolveLeadValue(
  opportunity: OpportunityRow
): LeadSummaryContextBundle["lead"]["value"] {
  if (typeof opportunity.actual_value === "number") {
    return { amount: opportunity.actual_value, basis: "actual" };
  }
  if (typeof opportunity.estimated_value === "number") {
    return { amount: opportunity.estimated_value, basis: "estimated" };
  }
  if (typeof opportunity.detected_value === "number") {
    return { amount: opportunity.detected_value, basis: "detected" };
  }
  return null;
}

/**
 * Assemble the model-facing record for one lead, newest information last.
 * Returns null when the lead has no substantive context (defensive re-check —
 * candidates are pre-filtered by evaluateLeadStaleness).
 */
export function buildLeadSummaryContext(
  opportunity: OpportunityRow,
  slices: LeadSummaryContextSlices
): LeadSummaryContextBundle | null {
  const aggregates = computeLeadContextAggregates(opportunity, slices);
  if (!hasSubstantiveLeadContext(opportunity, aggregates)) return null;

  const byNewestFirst = (a: string | null, b: string | null) =>
    (parseMs(b) ?? 0) - (parseMs(a) ?? 0);

  const emails = slices.activities
    .filter((activity) => activity.type === "email")
    .sort((a, b) => byNewestFirst(a.created_at, b.created_at))
    .slice(0, EMAILS_IN_PROMPT)
    .reverse()
    .map((activity) => ({
      at: activity.created_at,
      dir: activity.direction,
      subj: clip(activity.subject, 200),
      body: clip(activity.body_text ?? activity.content, EMAIL_BODY_CAP),
    }));

  const nonEmailActivity = slices.activities
    .filter((activity) => activity.type !== "email")
    .sort((a, b) => byNewestFirst(a.created_at, b.created_at))
    .slice(0, NON_EMAIL_ACTIVITIES_IN_PROMPT)
    .reverse()
    .map((activity) => ({
      at: activity.created_at,
      type: activity.type,
      dir: activity.direction,
      subject: clip(activity.subject, 200),
      content: clip(activity.content ?? activity.body_text, ACTIVITY_CONTENT_CAP),
      outcome: clip(activity.outcome, 200),
      duration_min: activity.duration_minutes,
    }));

  const stageHistory = slices.stageTransitions
    .filter((transition) => transition.from_stage !== null)
    .sort((a, b) => byNewestFirst(a.transitioned_at, b.transitioned_at))
    .slice(0, STAGE_MOVES_IN_PROMPT)
    .reverse()
    .map((transition) => ({
      from: transition.from_stage,
      to: transition.to_stage,
      at: transition.transitioned_at,
    }));

  const siteVisits = slices.siteVisits
    .sort((a, b) =>
      byNewestFirst(
        a.completed_at ?? a.updated_at ?? a.created_at,
        b.completed_at ?? b.updated_at ?? b.created_at
      )
    )
    .slice(0, SITE_VISITS_IN_PROMPT)
    .reverse()
    .map((visit) => ({
      status: visit.status,
      scheduled: visit.scheduled_at,
      completed: visit.completed_at,
      notes: clip(visit.notes, SITE_VISIT_NOTES_CAP),
      internal_notes: clip(visit.internal_notes, SITE_VISIT_NOTES_CAP),
      measurements: clip(visit.measurements, SITE_VISIT_MEASUREMENTS_CAP),
    }));

  const threadSummaries = slices.threadSummaries
    .filter((thread) => typeof thread.ai_summary === "string")
    .sort((a, b) => byNewestFirst(a.last_message_at, b.last_message_at))
    .slice(0, THREAD_SUMMARIES_IN_PROMPT)
    .reverse()
    .map((thread) => clip(thread.ai_summary, THREAD_SUMMARY_CAP))
    .filter((summary): summary is string => summary !== null);

  return {
    tid: EVALUATION_KEY,
    lead: {
      title: opportunity.title,
      contact: opportunity.contact_name,
      address: opportunity.address,
      stage: opportunity.stage,
      value: resolveLeadValue(opportunity),
      source: opportunity.source,
      created: opportunity.created_at.slice(0, 10),
      description: clip(opportunity.description, DESCRIPTION_CAP),
      previous_summary: clip(opportunity.ai_summary, PRIOR_SUMMARY_CAP),
    },
    stage_history: stageHistory,
    site_visits: siteVisits,
    activity: nonEmailActivity,
    emails,
    email_thread_summaries: threadSummaries,
  };
}

// ─── Model call (mirrors ai-sync-reviewer.evaluateSingleBatch discipline) ────

/**
 * Generate the 1-2 sentence lead summary for one context bundle. The summary
 * field specification is copied verbatim from the shipped engine so both
 * writers produce interchangeable output.
 */
export async function generateLeadSummary(input: {
  companyName: string;
  bundle: LeadSummaryContextBundle;
}): Promise<string> {
  const systemPrompt = `You are analyzing a sales lead's full activity record for a trades business to generate a brief opportunity summary.

Company: ${input.companyName}

The record may include lead details, emails, logged calls, notes, meetings, site visits, and pipeline stage changes. Within each list, newest information comes last.

Return:
- tid: copy the exact short evaluation key supplied with the record
- summary: 1-2 sentence summary of this opportunity. Include: what the client needs, any pricing discussed, and current status. This becomes the at-a-glance description in the CRM pipeline. Be specific — mention addresses, materials, dollar amounts if known.

If a previous summary is provided, treat it as prior state: keep facts that still hold and fold in newer information rather than contradicting it. Never invent details that are not in the record.

Return exactly one result for the supplied evaluation key. Never omit, alter, invent, or duplicate the key.
RESPOND WITH JSON: { "results": [...] }. No explanation.`;

  const responseFormat = {
    type: "json_schema" as const,
    json_schema: {
      name: "lead_activity_summary",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["results"],
        properties: {
          results: {
            type: "array",
            minItems: 1,
            maxItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["tid", "summary"],
              properties: {
                tid: { type: "string", enum: [EVALUATION_KEY] },
                summary: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
    },
  };

  const attemptOnce = async (): Promise<string> => {
    const response = await getSyncOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(input.bundle) },
      ],
      temperature: 0.1,
      // Headroom for complete strict JSON for a singleton (shipped parity).
      max_tokens: 300,
      response_format: responseFormat,
    });

    const choice = response.choices[0];
    const message = choice?.message;
    if (message?.refusal != null) {
      throw new LeadSummaryModelRefusalError();
    }
    if (choice?.finish_reason !== "stop") {
      throw new LeadSummaryModelContractError(
        "model response did not complete with finish_reason stop"
      );
    }
    const content = message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new LeadSummaryModelContractError("model response was empty");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new LeadSummaryModelContractError(
        "model response was not valid JSON",
        { cause: err }
      );
    }

    const rawResults =
      parsed && typeof parsed === "object" && "results" in parsed
        ? (parsed as { results?: unknown }).results
        : null;
    if (!Array.isArray(rawResults) || rawResults.length !== 1) {
      throw new LeadSummaryModelContractError(
        "model response did not contain exactly one result"
      );
    }
    const result = rawResults[0];
    if (!result || typeof result !== "object") {
      throw new LeadSummaryModelContractError(
        "model response contained an invalid result"
      );
    }
    const record = result as Record<string, unknown>;
    if (record.tid !== EVALUATION_KEY) {
      throw new LeadSummaryModelContractError(
        "model response contained an unknown evaluation key"
      );
    }
    if (typeof record.summary !== "string" || !record.summary.trim()) {
      throw new LeadSummaryModelContractError(
        "model response omitted the summary"
      );
    }
    return record.summary.trim();
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await attemptOnce();
    } catch (error) {
      lastError = error;
      if (!(error instanceof LeadSummaryModelContractError) || attempt === 1) {
        throw error;
      }
    }
  }
  throw lastError;
}

// ─── Sweep runner ────────────────────────────────────────────────────────────

interface CompanySweepAccumulator {
  result: LeadSummaryRunResult;
  remainingBudget: number;
  nowIso: string;
  dryRun: boolean;
  mode: "refresh" | "backfill";
}

async function fetchContextSlices(
  supabase: LeadSummarySupabaseLike,
  companyId: string,
  opportunityIds: string[]
): Promise<Map<string, LeadSummaryContextSlices>> {
  const slicesByOpportunity = new Map<string, LeadSummaryContextSlices>();
  for (const opportunityId of opportunityIds) {
    slicesByOpportunity.set(opportunityId, {
      activities: [],
      stageTransitions: [],
      siteVisits: [],
      threadSummaries: [],
    });
  }
  if (opportunityIds.length === 0) return slicesByOpportunity;

  const warnOverflow = (table: string, fetched: number, limit: number) => {
    if (fetched >= limit) {
      console.warn(
        `[lead-summary] ${table} context fetch hit its ${limit}-row window for company ${companyId}; oldest rows beyond the window are not considered`
      );
    }
  };

  const { data: activityRows, error: activityError } = await supabase
    .from("activities")
    .select(
      "opportunity_id, type, direction, subject, content, body_text, outcome, duration_minutes, created_at"
    )
    .in("opportunity_id", opportunityIds)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_FETCH_LIMIT);
  if (activityError) {
    throw new Error(
      `[lead-summary] activities fetch failed for company ${companyId}: ${activityError.message ?? "unknown error"}`
    );
  }
  const activities = (activityRows ?? []) as ActivityRow[];
  warnOverflow("activities", activities.length, ACTIVITY_FETCH_LIMIT);
  for (const row of activities) {
    slicesByOpportunity.get(row.opportunity_id)?.activities.push(row);
  }

  const { data: transitionRows, error: transitionError } = await supabase
    .from("stage_transitions")
    .select("opportunity_id, from_stage, to_stage, transitioned_at")
    .in("opportunity_id", opportunityIds)
    .order("transitioned_at", { ascending: false })
    .limit(TRANSITION_FETCH_LIMIT);
  if (transitionError) {
    throw new Error(
      `[lead-summary] stage_transitions fetch failed for company ${companyId}: ${transitionError.message ?? "unknown error"}`
    );
  }
  const transitions = (transitionRows ?? []) as StageTransitionRow[];
  warnOverflow("stage_transitions", transitions.length, TRANSITION_FETCH_LIMIT);
  for (const row of transitions) {
    slicesByOpportunity.get(row.opportunity_id)?.stageTransitions.push(row);
  }

  const { data: siteVisitRows, error: siteVisitError } = await supabase
    .from("site_visits")
    .select(
      "opportunity_id, status, scheduled_at, completed_at, notes, internal_notes, measurements, created_at, updated_at"
    )
    .in("opportunity_id", opportunityIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(SITE_VISIT_FETCH_LIMIT);
  if (siteVisitError) {
    throw new Error(
      `[lead-summary] site_visits fetch failed for company ${companyId}: ${siteVisitError.message ?? "unknown error"}`
    );
  }
  const siteVisits = (siteVisitRows ?? []) as SiteVisitRow[];
  warnOverflow("site_visits", siteVisits.length, SITE_VISIT_FETCH_LIMIT);
  for (const row of siteVisits) {
    slicesByOpportunity.get(row.opportunity_id)?.siteVisits.push(row);
  }

  // READ-ONLY input from the inbox thread-summary feature. Never written here.
  const { data: threadRows, error: threadError } = await supabase
    .from("email_threads")
    .select("opportunity_id, ai_summary, last_message_at")
    .in("opportunity_id", opportunityIds)
    .not("ai_summary", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(THREAD_SUMMARY_FETCH_LIMIT);
  if (threadError) {
    throw new Error(
      `[lead-summary] email_threads fetch failed for company ${companyId}: ${threadError.message ?? "unknown error"}`
    );
  }
  const threadSummaries = (threadRows ?? []) as ThreadSummaryRow[];
  warnOverflow(
    "email_threads",
    threadSummaries.length,
    THREAD_SUMMARY_FETCH_LIMIT
  );
  for (const row of threadSummaries) {
    slicesByOpportunity.get(row.opportunity_id)?.threadSummaries.push(row);
  }

  return slicesByOpportunity;
}

async function sweepCompany(
  supabase: LeadSummarySupabaseLike,
  companyId: string,
  accumulator: CompanySweepAccumulator
): Promise<void> {
  const { result } = accumulator;

  const { data: companyRow, error: companyError } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) {
    throw new Error(
      `[lead-summary] company lookup failed for ${companyId}: ${companyError.message ?? "unknown error"}`
    );
  }
  const companyName =
    typeof companyRow?.name === "string" && companyRow.name.trim()
      ? companyRow.name.trim()
      : "Unknown company";

  let opportunityQuery = supabase
    .from("opportunities")
    .select(OPPORTUNITY_FIELDS)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .is("archived_at", null)
    .is("merged_into_opportunity_id", null)
    .in("stage", [...ACTIVE_OPPORTUNITY_STAGES]);
  if (accumulator.mode === "backfill") {
    opportunityQuery = opportunityQuery.is("ai_summary", null);
  }
  const { data: opportunityRows, error: opportunityError } =
    await opportunityQuery.limit(OPEN_OPPS_SCAN_LIMIT);
  if (opportunityError) {
    throw new Error(
      `[lead-summary] opportunity scan failed for company ${companyId}: ${opportunityError.message ?? "unknown error"}`
    );
  }
  const opportunities = (opportunityRows ?? []) as OpportunityRow[];
  if (opportunities.length >= OPEN_OPPS_SCAN_LIMIT) {
    console.warn(
      `[lead-summary] open-opportunity scan hit its ${OPEN_OPPS_SCAN_LIMIT}-row window for company ${companyId}`
    );
  }
  result.leadsScanned += opportunities.length;
  if (opportunities.length === 0) return;

  const slicesByOpportunity = await fetchContextSlices(
    supabase,
    companyId,
    opportunities.map((opportunity) => opportunity.id)
  );

  const candidates: Array<{
    opportunity: OpportunityRow;
    slices: LeadSummaryContextSlices;
    stampMs: number | null;
  }> = [];
  for (const opportunity of opportunities) {
    const slices = slicesByOpportunity.get(opportunity.id);
    if (!slices) continue;
    const aggregates = computeLeadContextAggregates(opportunity, slices);
    const verdict = evaluateLeadStaleness(
      opportunity,
      aggregates,
      accumulator.mode
    );
    if (verdict === "insufficient_context") {
      result.skippedInsufficientContext += 1;
      continue;
    }
    if (verdict !== "stale") continue;
    candidates.push({
      opportunity,
      slices,
      stampMs: parseMs(opportunity.ai_summary_updated_at),
    });
  }

  // Stalest first: never-stamped leads lead the queue, then oldest stamps.
  candidates.sort((a, b) => {
    const aStamp = a.stampMs ?? Number.NEGATIVE_INFINITY;
    const bStamp = b.stampMs ?? Number.NEGATIVE_INFINITY;
    return aStamp - bStamp;
  });

  result.candidates += candidates.length;
  for (const candidate of candidates) {
    if (result.candidatesPreview.length < RESULT_LIST_CAP) {
      result.candidatesPreview.push({
        opportunityId: candidate.opportunity.id,
        title: candidate.opportunity.title,
      });
    }
  }

  const toProcess = candidates.slice(
    0,
    Math.max(0, accumulator.remainingBudget)
  );
  accumulator.remainingBudget -= toProcess.length;
  if (accumulator.dryRun) return;

  for (const candidate of toProcess) {
    const bundle = buildLeadSummaryContext(candidate.opportunity, candidate.slices);
    if (!bundle) {
      // Defensive: pre-filtering guarantees context, but never fabricate.
      result.skippedInsufficientContext += 1;
      continue;
    }
    try {
      const summary = await generateLeadSummary({ companyName, bundle });
      const { error: updateError } = await supabase
        .from("opportunities")
        .update({
          ai_summary: summary,
          ai_summary_updated_at: accumulator.nowIso,
        })
        .eq("id", candidate.opportunity.id)
        .eq("company_id", companyId);
      if (updateError) {
        throw new Error(
          `summary write failed: ${updateError.message ?? "unknown error"}`
        );
      }
      result.summariesWritten += 1;
      if (result.written.length < RESULT_LIST_CAP) {
        result.written.push({
          opportunityId: candidate.opportunity.id,
          title: candidate.opportunity.title,
        });
      }
    } catch (error) {
      // One lead's failure never aborts the sweep; the lead stays stale and
      // is retried on the next run.
      result.failed.push({
        opportunityId: candidate.opportunity.id,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
}

export async function runLeadSummaryRefresh(
  input: LeadSummaryRunInput
): Promise<LeadSummaryRunResult> {
  const now = input.now ?? new Date();
  const result: LeadSummaryRunResult = {
    mode: input.mode,
    dryRun: input.dryRun === true,
    companiesConsidered: 0,
    companiesEnabled: 0,
    leadsScanned: 0,
    candidates: 0,
    summariesWritten: 0,
    skippedInsufficientContext: 0,
    failed: [],
    written: [],
    candidatesPreview: [],
  };

  let companyIds: string[];
  if (input.companyId) {
    companyIds = [input.companyId];
  } else {
    const { data, error } = await input.supabase
      .from("admin_feature_overrides")
      .select("company_id")
      .eq("feature_key", "phase_c")
      .eq("enabled", true);
    if (error) {
      throw new Error(
        `[lead-summary] phase_c company discovery failed: ${error.message ?? "unknown error"}`
      );
    }
    companyIds = [
      ...new Set(
        ((data ?? []) as Array<{ company_id: string }>).map(
          (row) => row.company_id
        )
      ),
    ];
  }
  result.companiesConsidered = companyIds.length;

  const accumulator: CompanySweepAccumulator = {
    result,
    remainingBudget: input.maxLeadsPerRun ?? DEFAULT_MAX_LEADS_PER_RUN,
    nowIso: now.toISOString(),
    dryRun: result.dryRun,
    mode: input.mode,
  };

  for (const companyId of companyIds) {
    // Authoritative per-company gate — identical to the shipped engine's.
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) continue;
    result.companiesEnabled += 1;
    await sweepCompany(input.supabase, companyId, accumulator);
    if (accumulator.remainingBudget <= 0 && !result.dryRun) break;
  }

  return result;
}
