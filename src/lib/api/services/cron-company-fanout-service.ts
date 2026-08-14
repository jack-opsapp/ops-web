import "server-only";

import {
  advanceCronWorkloadCursor,
  readCronWorkloadCursor,
  type CronWorkloadCursorClient,
} from "./cron-workload-cursor-service";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
  type CronWorkloadLease,
} from "./cron-workload-control-service";

const MAX_COMPANIES_PER_RUN = 100;
const RETRY_CURSOR_PREFIX = "phase-c-fanout:v2:";

type PhaseCCompanyRow = {
  company_id: unknown;
};

type PhaseCCompanyQueryResult = {
  data: PhaseCCompanyRow[] | null;
  error: unknown;
};

interface PhaseCCompanyQuery {
  select(columns: string): PhaseCCompanyQuery;
  eq(column: string, value: unknown): PhaseCCompanyQuery;
  gt(column: string, value: unknown): PhaseCCompanyQuery;
  order(column: string, options: { ascending: boolean }): PhaseCCompanyQuery;
  limit(limit: number): PromiseLike<PhaseCCompanyQueryResult>;
}

export interface CronCompanyFanoutClient extends CronWorkloadCursorClient {
  from(relation: string): unknown;
}

export function throwCronDatabaseOperationError(
  operation: string,
  cause: unknown
): never {
  if (cause instanceof CronDatabaseOperationError) throw cause;
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : typeof cause === "object" &&
          cause !== null &&
          "message" in cause &&
          typeof cause.message === "string"
        ? cause.message
        : null;
  throw new CronDatabaseOperationError(
    causeMessage ? `${operation}: ${causeMessage}` : operation,
    { cause }
  );
}

function validateCompanyLimit(limit: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_COMPANIES_PER_RUN
  ) {
    throw new RangeError(
      `cron company fan-out limit must be between 1 and ${MAX_COMPANIES_PER_RUN}`
    );
  }
}

export async function listBoundedPhaseCCompanyIds(
  supabase: Pick<CronCompanyFanoutClient, "from">,
  limit: number,
  afterCompanyId: string | null = null
): Promise<string[]> {
  validateCompanyLimit(limit);

  let query = (supabase.from("admin_feature_overrides") as PhaseCCompanyQuery)
    .select("company_id")
    .eq("feature_key", "phase_c")
    .eq("enabled", true)
    .order("company_id", { ascending: true });

  if (afterCompanyId) {
    query = query.gt("company_id", afterCompanyId);
  }

  let result: PhaseCCompanyQueryResult;
  try {
    result = await query.limit(limit);
  } catch (cause) {
    throwCronDatabaseOperationError(
      "bounded Phase C company selection was unreachable",
      cause
    );
  }

  if (result.error) {
    throwCronDatabaseOperationError(
      "bounded Phase C company selection failed",
      result.error
    );
  }

  const companyIds: string[] = [];
  const seen = new Set<string>();
  for (const row of result.data ?? []) {
    if (
      typeof row.company_id !== "string" ||
      row.company_id.trim().length === 0
    ) {
      throwCronDatabaseOperationError(
        "bounded Phase C company selection returned invalid data",
        new Error("invalid company id")
      );
    }
    if (seen.has(row.company_id)) continue;
    seen.add(row.company_id);
    companyIds.push(row.company_id);
    if (companyIds.length === limit) break;
  }

  return companyIds;
}

export interface RunBoundedPhaseCCompanyFanoutOptions<T> {
  supabase: CronCompanyFanoutClient;
  workloadKey: string;
  lease: CronWorkloadLease;
  companyLimit: number;
  processCompany: (companyId: string) => Promise<T>;
  onCompanyError: (companyId: string, error: unknown) => T;
  retryPolicy?: {
    maxAttempts: number;
    classifyResult: (result: T) => "success" | "permanent" | "retryable";
  };
}

export interface CronCompanyFanoutRetryState {
  status: "none" | "scheduled" | "exhausted";
  scheduled: Array<{ companyId: string; attempt: number }>;
  exhausted: Array<{ companyId: string; attempts: number }>;
  permanentCompanyIds: string[];
}

export interface BoundedPhaseCCompanyFanoutResult<T> {
  companyIds: string[];
  results: T[];
  cursor: {
    previous: string | null;
    next: string | null;
  };
  retry?: CronCompanyFanoutRetryState;
  failureCause?: unknown;
}

interface RetryCursorEnvelope {
  v: 2;
  pageCursor: string | null;
  pending: Array<{ companyId: string; attempts: number }>;
}

function validateRetryPolicy(
  retryPolicy: RunBoundedPhaseCCompanyFanoutOptions<unknown>["retryPolicy"]
): void {
  if (
    retryPolicy &&
    (!Number.isSafeInteger(retryPolicy.maxAttempts) ||
      retryPolicy.maxAttempts < 2 ||
      retryPolicy.maxAttempts > 10)
  ) {
    throw new RangeError(
      "cron company retry attempts must be between 2 and 10"
    );
  }
}

function validCursorCompanyId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function decodeRetryCursor(
  cursor: string | null,
  maxAttempts: number
): RetryCursorEnvelope | null {
  if (!cursor?.startsWith(RETRY_CURSOR_PREFIX)) return null;

  try {
    const parsed = JSON.parse(cursor.slice(RETRY_CURSOR_PREFIX.length)) as {
      v?: unknown;
      pageCursor?: unknown;
      pending?: unknown;
    };
    if (
      parsed.v !== 2 ||
      !(
        parsed.pageCursor === null || validCursorCompanyId(parsed.pageCursor)
      ) ||
      !Array.isArray(parsed.pending) ||
      parsed.pending.length === 0 ||
      parsed.pending.length > MAX_COMPANIES_PER_RUN
    ) {
      throw new Error("invalid retry cursor shape");
    }

    const seen = new Set<string>();
    const pending = parsed.pending.map((entry) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        !validCursorCompanyId((entry as Record<string, unknown>).companyId) ||
        !Number.isSafeInteger((entry as Record<string, unknown>).attempts) ||
        ((entry as Record<string, unknown>).attempts as number) < 0 ||
        ((entry as Record<string, unknown>).attempts as number) >= maxAttempts
      ) {
        throw new Error("invalid retry cursor entry");
      }
      const companyId = (entry as { companyId: string }).companyId;
      if (seen.has(companyId)) throw new Error("duplicate retry company");
      seen.add(companyId);
      return {
        companyId,
        attempts: (entry as { attempts: number }).attempts,
      };
    });

    return {
      v: 2,
      pageCursor: parsed.pageCursor as string | null,
      pending,
    };
  } catch (cause) {
    throw new CronDatabaseOperationError(
      `cron company retry cursor was invalid: ${
        cause instanceof Error ? cause.message : "unknown error"
      }`,
      { cause }
    );
  }
}

function encodeRetryCursor(envelope: RetryCursorEnvelope): string {
  const encoded = `${RETRY_CURSOR_PREFIX}${JSON.stringify(envelope)}`;
  if (encoded.length > 512) {
    throw new CronDatabaseOperationError(
      "cron company retry cursor exceeded the durable cursor limit",
      { cause: new Error("retry cursor exceeds 512 characters") }
    );
  }
  return encoded;
}

function canEncodeRetryCursor(envelope: RetryCursorEnvelope): boolean {
  return `${RETRY_CURSOR_PREFIX}${JSON.stringify(envelope)}`.length <= 512;
}

export async function runBoundedPhaseCCompanyFanout<T>({
  supabase,
  workloadKey,
  lease,
  companyLimit,
  processCompany,
  onCompanyError,
  retryPolicy,
}: RunBoundedPhaseCCompanyFanoutOptions<T>): Promise<
  BoundedPhaseCCompanyFanoutResult<T>
> {
  validateCompanyLimit(companyLimit);
  validateRetryPolicy(retryPolicy);

  const storedPreviousCursor = await readCronWorkloadCursor(
    supabase,
    workloadKey,
    lease
  );
  const retryCursor = retryPolicy
    ? decodeRetryCursor(storedPreviousCursor, retryPolicy.maxAttempts)
    : null;
  const pageCursor = retryCursor
    ? retryCursor.pageCursor
    : storedPreviousCursor;
  const pending = retryCursor?.pending ?? [];
  // Retry one poison company per invocation, reserving the rest of the bounded
  // page for fresh companies. This keeps retries fair without exceeding the
  // workload's existing per-run company ceiling.
  const retryEntries = retryPolicy ? pending.slice(0, 1) : [];
  const remainingPending = retryPolicy ? pending.slice(1) : [];
  const freshCapacity = companyLimit - retryEntries.length;
  const pageCompanyIds =
    freshCapacity > 0
      ? await listBoundedPhaseCCompanyIds(supabase, freshCapacity, pageCursor)
      : [];
  const pendingCompanyIds = new Set(pending.map((entry) => entry.companyId));
  const companyEntries = [
    ...retryEntries.map((entry) => ({ ...entry, source: "retry" as const })),
    ...pageCompanyIds
      .filter((companyId) => !pendingCompanyIds.has(companyId))
      .map((companyId) => ({
        companyId,
        attempts: 0,
        source: "page" as const,
      })),
  ];
  const companyIds: string[] = [];
  const results: T[] = [];
  const nextPending = remainingPending.map((entry) => ({ ...entry }));
  const exhausted: Array<{ companyId: string; attempts: number }> = [];
  const permanentCompanyIds: string[] = [];
  let failureCause: unknown;
  let databasePressureCause: unknown;
  let nextPageCursor = pageCursor;
  let traversedPageRows = 0;

  const scheduleRetry = (companyId: string, attempts: number): void => {
    const existing = nextPending.find((entry) => entry.companyId === companyId);
    if (existing) {
      existing.attempts = Math.max(existing.attempts, attempts);
      return;
    }
    nextPending.push({ companyId, attempts });
  };

  for (let index = 0; index < companyEntries.length; index += 1) {
    const entry = companyEntries[index];
    if (
      retryPolicy &&
      entry.source === "page" &&
      !canEncodeRetryCursor({
        v: 2,
        pageCursor: entry.companyId,
        pending: [...nextPending, { companyId: entry.companyId, attempts: 1 }],
      })
    ) {
      break;
    }
    companyIds.push(entry.companyId);
    let result: T;
    try {
      result = await processCompany(entry.companyId);
    } catch (error) {
      const databasePressure = isDatabasePressureError(error);
      if (!retryPolicy && databasePressure) throw error;
      failureCause ??= error;
      if (databasePressure) databasePressureCause ??= error;
      result = onCompanyError(entry.companyId, error);
      results.push(result);

      if (retryPolicy) {
        const attempt = databasePressure ? entry.attempts : entry.attempts + 1;
        if (!databasePressure && attempt >= retryPolicy.maxAttempts) {
          exhausted.push({ companyId: entry.companyId, attempts: attempt });
        } else {
          scheduleRetry(entry.companyId, attempt);
        }
      }
      if (entry.source === "page") {
        nextPageCursor = entry.companyId;
        traversedPageRows += 1;
      }
      if (databasePressure) break;
      continue;
    }

    results.push(result);
    if (entry.source === "page") {
      nextPageCursor = entry.companyId;
      traversedPageRows += 1;
    }
    if (!retryPolicy) continue;

    const disposition = retryPolicy.classifyResult(result);
    if (disposition === "permanent") {
      permanentCompanyIds.push(entry.companyId);
    } else if (disposition === "retryable") {
      const attempt = entry.attempts + 1;
      if (attempt >= retryPolicy.maxAttempts) {
        exhausted.push({ companyId: entry.companyId, attempts: attempt });
      } else {
        scheduleRetry(entry.companyId, attempt);
      }
    }
  }

  // Pending companies encountered after wrap-around are already durably
  // represented, so the page cursor may safely traverse them without replay.
  if (
    traversedPageRows ===
    companyEntries.filter((entry) => entry.source === "page").length
  ) {
    const lastTraversedRow = pageCompanyIds.at(-1);
    if (lastTraversedRow) nextPageCursor = lastTraversedRow;
    if (pageCompanyIds.length < freshCapacity) nextPageCursor = null;
  }

  const scheduled = nextPending.map(({ companyId, attempts }) => ({
    companyId,
    attempt: attempts,
  }));

  const storedNextCursor =
    retryPolicy && scheduled.length > 0
      ? encodeRetryCursor({
          v: 2,
          pageCursor: nextPageCursor,
          pending: scheduled.map(({ companyId, attempt }) => ({
            companyId,
            attempts: attempt,
          })),
        })
      : nextPageCursor;
  await advanceCronWorkloadCursor(
    supabase,
    workloadKey,
    lease,
    storedPreviousCursor,
    storedNextCursor
  );

  const retry: CronCompanyFanoutRetryState | undefined = retryPolicy
    ? {
        status:
          scheduled.length > 0
            ? "scheduled"
            : exhausted.length > 0
              ? "exhausted"
              : "none",
        scheduled,
        exhausted,
        permanentCompanyIds,
      }
    : undefined;

  return {
    companyIds,
    results,
    cursor: {
      previous: pageCursor,
      next: nextPageCursor,
    },
    ...(retry ? { retry } : {}),
    ...((databasePressureCause ?? failureCause) !== undefined
      ? { failureCause: databasePressureCause ?? failureCause }
      : {}),
  };
}
