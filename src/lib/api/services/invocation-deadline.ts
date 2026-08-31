import "server-only";

/**
 * Wall-clock budget for one serverless invocation.
 *
 * Vercel kills the function at maxDuration (300s) with no signal. Everything
 * that must be durable — the provider checkpoint, lease completion, the HTTP
 * response — has to happen BEFORE that kill (bug 63ff8830: four 504s replayed
 * the same Gmail history range because the checkpoint only ran at the end of
 * the cycle). The margin is generous by design: a checkpoint write is
 * milliseconds; the margin also covers lease completion and response
 * serialization under database pressure.
 */
export interface InvocationDeadline {
  /** Epoch ms after which no new work may start. */
  readonly deadlineAt: number;
  remainingMs(now?: number): number;
  /** True when fewer than reserveMs remain before the deadline. */
  expired(reserveMs?: number, now?: number): boolean;
}

export const EMAIL_SYNC_MAX_RUNTIME_MS = 300_000;
/** Headroom kept free for checkpoint + lease completion + response. */
export const EMAIL_SYNC_DEADLINE_SAFETY_MARGIN_MS = 45_000;
/** Do not START a connection's sync with less than this remaining. */
export const EMAIL_SYNC_MIN_CONNECTION_BUDGET_MS = 45_000;
/** Stop admitting new messages to the per-cycle processing loop below this —
 * the reserve covers drafts reconcile, Step 5/6 AI for the processed subset,
 * summary refresh, and the checkpoint itself. */
export const EMAIL_SYNC_POST_LOOP_RESERVE_MS = 90_000;
/** Reserve required to begin AI classification / summary refresh stages. */
export const EMAIL_SYNC_AI_STAGE_RESERVE_MS = 60_000;
/** Do not start a route-level drain phase below this. */
export const EMAIL_SYNC_PHASE_FLOOR_MS = 20_000;

export function createInvocationDeadline(input: {
  maxRuntimeMs: number;
  safetyMarginMs: number;
  startedAtMs?: number;
}): InvocationDeadline {
  if (
    !Number.isFinite(input.maxRuntimeMs) ||
    !Number.isFinite(input.safetyMarginMs) ||
    input.maxRuntimeMs <= 0 ||
    input.safetyMarginMs < 0 ||
    input.safetyMarginMs >= input.maxRuntimeMs
  ) {
    throw new Error("invocation deadline configuration is invalid");
  }
  const startedAt = input.startedAtMs ?? Date.now();
  const deadlineAt = startedAt + input.maxRuntimeMs - input.safetyMarginMs;
  return {
    deadlineAt,
    remainingMs(now = Date.now()) {
      return Math.max(0, deadlineAt - now);
    },
    expired(reserveMs = 0, now = Date.now()) {
      return deadlineAt - now <= reserveMs;
    },
  };
}
