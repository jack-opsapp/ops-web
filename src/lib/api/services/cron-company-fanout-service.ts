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
  order(
    column: string,
    options: { ascending: boolean }
  ): PhaseCCompanyQuery;
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

  let query = (supabase.from(
    "admin_feature_overrides"
  ) as PhaseCCompanyQuery)
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
}

export interface BoundedPhaseCCompanyFanoutResult<T> {
  companyIds: string[];
  results: T[];
  cursor: {
    previous: string | null;
    next: string | null;
  };
}

export async function runBoundedPhaseCCompanyFanout<T>({
  supabase,
  workloadKey,
  lease,
  companyLimit,
  processCompany,
  onCompanyError,
}: RunBoundedPhaseCCompanyFanoutOptions<T>): Promise<
  BoundedPhaseCCompanyFanoutResult<T>
> {
  validateCompanyLimit(companyLimit);

  const previousCursor = await readCronWorkloadCursor(
    supabase,
    workloadKey,
    lease
  );
  const companyIds = await listBoundedPhaseCCompanyIds(
    supabase,
    companyLimit,
    previousCursor
  );
  const results: T[] = [];

  for (const companyId of companyIds) {
    try {
      results.push(await processCompany(companyId));
    } catch (error) {
      if (isDatabasePressureError(error)) throw error;
      results.push(onCompanyError(companyId, error));
    }
  }

  const nextCursor =
    companyIds.length === companyLimit
      ? (companyIds.at(-1) ?? null)
      : null;
  await advanceCronWorkloadCursor(
    supabase,
    workloadKey,
    lease,
    previousCursor,
    nextCursor
  );

  return {
    companyIds,
    results,
    cursor: {
      previous: previousCursor,
      next: nextCursor,
    },
  };
}
