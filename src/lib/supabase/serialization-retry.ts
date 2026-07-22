/**
 * Bounded, jittered retry for Postgres serialization failures (SQLSTATE
 * 40001) surfaced through PostgREST/supabase-js.
 *
 * The guarded commercial RPCs (convert_opportunity_to_project,
 * commit_lead_summary_snapshot, apply_email_opportunity_deferred_disposition)
 * raise 'meaningful correspondence projection pending' with errcode 40001
 * while a meaningful correspondence event awaits counter projection, and the
 * dedupe/lease triggers raise other 40001 sentinels under contention. Those
 * are retry invitations for a *near-future* success — but during the
 * 2026-07-22 outage a permanently stuck projection row turned zero-backoff
 * retries into a hot loop (~1,800 failed transactions/sec) that pinned
 * database CPU. Every worker retry of a 40001 must therefore be paced and
 * capped: exponential backoff with jitter, a hard attempt ceiling, and a
 * typed exhaustion error the caller records instead of retrying forever.
 */

export const MEANINGFUL_PROJECTION_PENDING_MESSAGE =
  "meaningful correspondence projection pending";

const SERIALIZATION_FAILURE_SQLSTATE = "40001";
const CAUSE_CHAIN_LIMIT = 8;

export interface SerializationRetryOptions {
  /** Total attempts including the first call. Defaults to 5. */
  maxAttempts?: number;
  /** First backoff ceiling in milliseconds. Defaults to 250. */
  baseDelayMs?: number;
  /** Upper bound for any single backoff in milliseconds. Defaults to 30_000. */
  maxDelayMs?: number;
  /** Prefixes retry/exhaustion log lines, e.g. "accept evaluation for <id>". */
  label?: string;
  /** Injection points for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    error: unknown;
  }) => void;
}

export class SerializationRetryExhaustedError extends Error {
  readonly name = "SerializationRetryExhaustedError";

  constructor(
    readonly attempts: number,
    readonly lastError: unknown,
    label?: string
  ) {
    // The final serialization error's message is preserved verbatim so
    // upstream classifiers (which match on the 40001 sentinel text after
    // supabase-js error codes are lost to Error re-wrapping) still recognize
    // the exhausted failure as serialization-shaped.
    super(
      `serialization retry exhausted after ${attempts} attempts${
        label ? ` (${label})` : ""
      }: ${errorMessage(lastError)}`
    );
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

/**
 * True when the error (or anything on its cause chain) is a Postgres
 * serialization failure: a PostgREST error with code 40001, a
 * ProjectConversionError carrying rpcCode 40001, or a message that embeds the
 * projection-pending sentinel after intermediate Error re-wrapping.
 */
export function isSerializationFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_CHAIN_LIMIT && current != null; depth++) {
    if (typeof current === "string") {
      return current.includes(MEANINGFUL_PROJECTION_PENDING_MESSAGE);
    }
    if (typeof current !== "object") return false;

    const candidate = current as {
      code?: unknown;
      rpcCode?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (candidate.code === SERIALIZATION_FAILURE_SQLSTATE) return true;
    if (candidate.rpcCode === SERIALIZATION_FAILURE_SQLSTATE) return true;
    if (
      typeof candidate.message === "string" &&
      candidate.message.includes(MEANINGFUL_PROJECTION_PENDING_MESSAGE)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `operation`, retrying only serialization failures with equal-jitter
 * exponential backoff (250ms base, doubling per attempt, 30s ceiling). Every
 * delay keeps a non-zero floor of half its exponential ceiling so retries can
 * never collapse back into a hot loop. Non-serialization errors are rethrown
 * immediately; once `maxAttempts` serialization failures accumulate, a
 * SerializationRetryExhaustedError is thrown for the caller to record and
 * park — never to retry blindly.
 */
export async function withSerializationRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: SerializationRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 5));
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 30_000);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      if (attempt >= maxAttempts) {
        throw new SerializationRetryExhaustedError(
          attempt,
          error,
          options.label
        );
      }

      const exponentialCeiling = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (attempt - 1)
      );
      const delayMs = Math.round(
        exponentialCeiling / 2 + random() * (exponentialCeiling / 2)
      );
      options.onRetry?.({ attempt, maxAttempts, delayMs, error });
      await sleep(delayMs);
    }
  }
}
