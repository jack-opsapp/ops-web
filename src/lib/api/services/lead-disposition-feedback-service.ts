/**
 * OPS Web — Lead disposition feedback service (Phase C).
 *
 * Thin, typed client over the two deployed SECURITY DEFINER RPCs that own the
 * discard contract end-to-end:
 *
 *   - `apply_lead_disposition_feedback` writes the learning-evidence row AND
 *     the mapped lifecycle change in ONE transaction. The reason → outcome
 *     mapping is server-owned (spam/vendor_sales/… → `discarded`, `not_a_fit`
 *     → `lost` + disqualified, `duplicate`/`other` → review, no lifecycle
 *     change), so the client never derives the target stage itself.
 *   - `undo_lead_disposition_feedback` retracts that evidence and restores the
 *     prior stage/lost fields. Idempotent — a double-undo replays safely.
 *
 * Both refuse terminal (won/lost/discarded) and merged opportunities, and both
 * resolve the actor + edit permission from the JWT, so no caller can widen the
 * blast radius by passing extra arguments.
 *
 * PostgREST returns `returns table` functions as an ARRAY of rows — the row is
 * normalized here so callers never see the wire shape.
 *
 * The typed-RPC client interface mirrors `ProjectViewsService`: these functions
 * are intentionally NOT in `database.types.ts` (generated types lag behind the
 * deployed contract), so the Supabase client is narrowed locally instead.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

/** The nine operator-selectable Phase C reasons. */
export type LeadDiscardReasonCode =
  | "spam"
  | "job_applicant"
  | "vendor_sales"
  | "internal"
  | "platform_notification"
  | "test_traffic"
  | "duplicate"
  | "not_a_fit"
  | "other";

/**
 * `legacy_unspecified` is the Phase-C-OFF audit reason. The server accepts it
 * ONLY when Phase C is off, and never treats it as learning evidence.
 */
export type LeadDispositionReasonCode =
  | LeadDiscardReasonCode
  | "legacy_unspecified";

/** Server-owned lifecycle outcome for the applied reason. */
export type LeadDispositionOutcome =
  | "discarded"
  | "lost"
  | "duplicate_review"
  | "review_deferred";

export interface LeadDispositionFeedbackResult {
  feedbackId: string;
  outcome: LeadDispositionOutcome;
  priorStage: string;
  currentStage: string;
  /** False for `duplicate`/`other` — the lead stays exactly where it is. */
  lifecycleChanged: boolean;
  /** True when the idempotency key replayed a prior write. */
  idempotentReplay: boolean;
}

export type LeadDispositionFeedbackErrorCode =
  | "terminal_or_merged"
  | "phase_c_disabled"
  | "invalid_reason"
  | "access_denied"
  | "not_found"
  | "undo_conflict"
  | "unknown";

export class LeadDispositionFeedbackError extends Error {
  constructor(
    public readonly code: LeadDispositionFeedbackErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LeadDispositionFeedbackError";
  }
}

// ─── Wire contract ────────────────────────────────────────────────────────────

interface LeadDispositionFeedbackRow {
  feedback_id: string;
  outcome: LeadDispositionOutcome;
  prior_stage: string;
  current_stage: string;
  current_stage_entered_at: string | null;
  current_stage_manually_set: boolean | null;
  current_lost_reason: string | null;
  current_lost_notes: string | null;
  current_actual_close_date: string | null;
  lifecycle_changed: boolean;
  idempotent_replay: boolean;
}

type LeadDispositionRpcArgs = {
  apply_lead_disposition_feedback: {
    p_opportunity_id: string;
    p_reason_code: LeadDispositionReasonCode;
    p_optional_note: string | null;
    p_idempotency_key: string;
  };
  undo_lead_disposition_feedback: {
    p_feedback_id: string;
    p_idempotency_key: string;
  };
};

type LeadDispositionRpcName = keyof LeadDispositionRpcArgs;

type LeadDispositionRpcError = { code?: string; message?: string };

type LeadDispositionRpcClient = {
  rpc: <Name extends LeadDispositionRpcName>(
    name: Name,
    args: LeadDispositionRpcArgs[Name]
  ) => Promise<{
    data: LeadDispositionFeedbackRow | LeadDispositionFeedbackRow[] | null;
    error: LeadDispositionRpcError | null;
  }>;
};

/**
 * Server error messages arrive wrapped in Postgres framing, so match on
 * SUBSTRINGS of the raised message. Order matters only where one token is a
 * prefix of another — none of these are, so the table reads top to bottom.
 */
const ERROR_CODE_BY_TOKEN: ReadonlyArray<
  [token: string, code: LeadDispositionFeedbackErrorCode]
> = [
  ["opportunity_terminal_or_merged", "terminal_or_merged"],
  ["phase_c_disabled", "phase_c_disabled"],
  ["invalid_phase_c_reason", "invalid_reason"],
  ["invalid_idempotency_key", "invalid_reason"],
  ["feedback_note_too_long", "invalid_reason"],
  ["idempotency_key_reused", "invalid_reason"],
  ["opportunity_access_denied", "access_denied"],
  ["actor_not_found", "access_denied"],
  ["opportunity_not_found", "not_found"],
  ["feedback_not_found", "not_found"],
  ["feedback_undo_conflict", "undo_conflict"],
];

function normalizeError(
  error: LeadDispositionRpcError | null
): LeadDispositionFeedbackError {
  const message = error?.message ?? "Lead disposition feedback failed";
  for (const [token, code] of ERROR_CODE_BY_TOKEN) {
    if (message.includes(token)) {
      return new LeadDispositionFeedbackError(code, message);
    }
  }
  return new LeadDispositionFeedbackError("unknown", message);
}

function mapRow(
  data: LeadDispositionFeedbackRow | LeadDispositionFeedbackRow[] | null
): LeadDispositionFeedbackResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new LeadDispositionFeedbackError(
      "unknown",
      "Lead disposition feedback returned no row"
    );
  }
  return {
    feedbackId: row.feedback_id,
    outcome: row.outcome,
    priorStage: row.prior_stage,
    currentStage: row.current_stage,
    lifecycleChanged: row.lifecycle_changed,
    idempotentReplay: row.idempotent_replay,
  };
}

async function callFeedbackRpc<Name extends LeadDispositionRpcName>(
  name: Name,
  args: LeadDispositionRpcArgs[Name]
): Promise<LeadDispositionFeedbackResult> {
  const supabase = requireSupabase() as unknown as LeadDispositionRpcClient;
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw normalizeError(error);
  return mapRow(data);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record the operator's discard reason and apply the mapped lifecycle change
 * atomically. `idempotencyKey` must be 8–128 chars — always a fresh
 * `crypto.randomUUID()` per capture, reused only when retrying that capture.
 */
export async function applyLeadDispositionFeedback(input: {
  opportunityId: string;
  reasonCode: LeadDispositionReasonCode;
  optionalNote?: string | null;
  idempotencyKey: string;
}): Promise<LeadDispositionFeedbackResult> {
  return callFeedbackRpc("apply_lead_disposition_feedback", {
    p_opportunity_id: input.opportunityId,
    p_reason_code: input.reasonCode,
    p_optional_note: input.optionalNote ?? null,
    p_idempotency_key: input.idempotencyKey,
  });
}

/**
 * Retract a feedback row and restore the pre-discard lifecycle. Raises
 * `undo_conflict` when the opportunity moved on after the discard — the
 * operator's undo must not silently stomp a newer state.
 */
export async function undoLeadDispositionFeedback(input: {
  feedbackId: string;
  idempotencyKey: string;
}): Promise<LeadDispositionFeedbackResult> {
  return callFeedbackRpc("undo_lead_disposition_feedback", {
    p_feedback_id: input.feedbackId,
    p_idempotency_key: input.idempotencyKey,
  });
}
