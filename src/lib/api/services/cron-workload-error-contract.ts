/**
 * Adds trusted origin to a failure raised at a Supabase/PostgREST boundary.
 * HTTP and transport error shapes are shared by Gmail, OpenAI, OneSignal, and
 * Cloudflare, so they are pressure only when this database context is present.
 *
 * This contract intentionally stays runtime-agnostic because shared services
 * can be imported by both server and client module graphs.
 */
export class CronDatabaseOperationError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "CronDatabaseOperationError";
  }
}

/**
 * Preserve the database-specific parts of a Supabase/PostgREST response
 * without attaching returned row data to an exception. HTTP status lives on
 * the outer response, while SQL/network detail lives under `error`.
 */
export function supabaseDatabaseOperationCause(response: unknown): unknown {
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    !("error" in response)
  ) {
    return response;
  }
  const envelope = response as Record<string, unknown>;
  if (!("status" in envelope) && !("statusText" in envelope)) {
    return envelope.error;
  }
  return Object.freeze({
    error: envelope.error,
    status: envelope.status,
    statusText: envelope.statusText,
  });
}

type PressureEvidence = {
  key: string;
  value: string;
  databaseContext: boolean;
};

// PGRST2xx contract errors also say "in the schema cache". Match only
// availability language so a missing function or column cannot open circuits.
const SCHEMA_CACHE_AVAILABILITY_PATTERN =
  /schema cache (?:is )?(?:unavailable|unreachable)|schema cache (?:failed to load|load failed)|(?:could not|failed to) load the schema cache/;

function collectPressureEvidence(
  value: unknown,
  seen: Set<unknown>,
  depth: number,
  databaseContext = false
): PressureEvidence[] {
  if (depth > 6 || value === null || value === undefined || seen.has(value)) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number") {
    return [
      {
        key: "value",
        value: String(value),
        databaseContext,
      },
    ];
  }
  if (typeof value !== "object") return [];

  seen.add(value);
  const record = value as Record<string, unknown>;
  const nestedDatabaseContext =
    databaseContext || value instanceof CronDatabaseOperationError;
  const evidence: PressureEvidence[] = [];
  for (const key of [
    "code",
    "status",
    "statusCode",
    "name",
    "message",
    "details",
    "hint",
  ]) {
    const candidate = record[key];
    if (typeof candidate === "string" || typeof candidate === "number") {
      evidence.push({
        key,
        value: String(candidate),
        databaseContext: nestedDatabaseContext,
      });
    }
  }
  for (const key of ["cause", "error"]) {
    if (key in record) {
      evidence.push(
        ...collectPressureEvidence(
          record[key],
          seen,
          depth + 1,
          nestedDatabaseContext
        )
      );
    }
  }
  return evidence;
}

export function isDatabasePressureError(error: unknown): boolean {
  const evidence = collectPressureEvidence(error, new Set(), 0);
  return evidence.some((item) => {
    const normalized = item.value.trim().toLowerCase();
    const isCode = item.key === "code";
    const isStatus = item.key === "status" || item.key === "statusCode";
    return (
      (isCode &&
        /^(?:57014|53\d{3}|55p03|57p0[123]|58030|08[a-z0-9]{3}|pgrst00[0-3])$/i.test(
          normalized
        )) ||
      (item.databaseContext &&
        isCode &&
        /^(?:eai_again|econnrefused|econnreset|enotfound|etimedout|und_err_connect_timeout)$/i.test(
          normalized
        )) ||
      (item.databaseContext &&
        (isCode || isStatus) &&
        /^(?:502|503|504|521|522|524|525)$/.test(normalized)) ||
      SCHEMA_CACHE_AVAILABILITY_PATTERN.test(normalized) ||
      /could not query the database|cannot connect to the database|remaining connection slots/.test(
        normalized
      ) ||
      (item.databaseContext &&
        /statement timeout|out of memory|disk full|database is unavailable|connection (?:terminated|timed out|timeout|refused|failure)|connect (?:etimedout|timeout)|upstream request timeout|gateway timeout|ssl handshake failed|web server is down|cloudflare.*(?:521|522|525)/.test(
          normalized
        )) ||
      (item.databaseContext &&
        /\b(?:eai_again|econnrefused|econnreset|enotfound|etimedout|und_err_connect_timeout)\b/.test(
          normalized
        ))
    );
  });
}
