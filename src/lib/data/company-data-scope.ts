/**
 * OPS Web — Company Data Scope Resolver
 *
 * Thirty-one tables in the company-data manifest carry no `company_id`; they
 * belong to a company only through a foreign key to a parent that does. A
 * `company_id`-only sweep cannot see them at all — which is why account
 * deletion used to leave them behind and export used to omit them.
 *
 * This resolves "which rows of <table> belong to this company" by walking the
 * manifest's parent chain, memoising each answer, and chunking the resulting id
 * lists so the PostgREST `in.()` filters stay inside URL limits.
 *
 * Every failure throws `CompanyDataStepError` naming the table and what was
 * being attempted. Nothing here returns an empty result to paper over an error
 * — that swallowing is the defect this module exists to remove.
 *
 * NEVER import this from client-side code.
 */

import {
  chunkIds,
  manifestByTable,
  type ManifestEntry,
} from "./company-data-manifest";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The shape a PostgREST error arrives in. Every field is optional in practice. */
export interface PostgrestFailure {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** Trimmed text, or "" for null / undefined / whitespace. */
function text(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/** "" for a field that carries nothing, so it never lands in a JSON payload. */
function optional(value?: string | null): string | undefined {
  return text(value) || undefined;
}

/**
 * Everything the driver actually gave us, in one line.
 *
 * A live rehearsal of the cascade returned `"message": ""` and nothing else,
 * which cost hours of diagnosis. The cause is structural, not incidental: the
 * count step issues `select("*", { count: "exact", head: true })`, and a HEAD
 * response carries no body — so PostgREST's JSON error payload never arrives
 * and supabase-js hands back a failure whose every field is blank. `??` does
 * not catch an empty string, so the old composition passed it straight through.
 *
 * `details` and `hint` are folded in because PostgREST puts the actionable part
 * of a permission or constraint failure there, and the code is always appended
 * when present — a bare `42501` in a log line is what turns "it broke" into
 * "the role has no grant". When there is genuinely nothing to report, the
 * fallback says so AND names the reason the payload is empty.
 */
export function describeDatabaseFailure(failure: PostgrestFailure): string {
  const parts = [
    text(failure.message),
    text(failure.details),
    text(failure.hint),
  ].filter(Boolean);
  const code = text(failure.code);

  if (parts.length > 0) {
    return code ? `${parts.join(" — ")} [${code}]` : parts.join(" — ");
  }

  return code
    ? `database error [${code}] (the driver returned no message, details or hint)`
    : "unknown database error (the driver returned an empty payload — a count " +
        "is a HEAD request, which carries no body, so a permission failure arrives blank)";
}

/** A named, non-swallowable failure of one cascade or export step. */
export class CompanyDataStepError extends Error {
  readonly table: string;
  readonly operation: string;
  /** The underlying database message, without the step prefix. Never empty. */
  readonly databaseMessage: string;
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;

  constructor(table: string, operation: string, failure: PostgrestFailure) {
    const databaseMessage = describeDatabaseFailure(failure);
    super(`${operation} ${table} failed: ${databaseMessage}`);
    this.name = "CompanyDataStepError";
    this.table = table;
    this.operation = operation;
    this.databaseMessage = databaseMessage;
    this.code = optional(failure.code);
    this.details = optional(failure.details);
    this.hint = optional(failure.hint);
  }
}

type QueryClient = { from: (table: string) => any };

function toIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (row as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string" || typeof id === "number")
    .map(String);
}

/**
 * Resolves and memoises the set of row ids a company owns, per table.
 *
 * Ids are always collected BEFORE anything is deleted — a parent that has
 * already been tombstoned or purged can no longer name its children. The
 * collection query deliberately omits any `deleted_at` filter so children of
 * previously soft-deleted parents are swept too.
 */
export class CompanyDataScope {
  private readonly cache = new Map<string, string[]>();
  private readonly resolving = new Set<string>();

  constructor(
    private readonly db: QueryClient,
    private readonly companyId: string
  ) {}

  async idsFor(table: string): Promise<string[]> {
    const cached = this.cache.get(table);
    if (cached) return cached;

    if (this.resolving.has(table)) {
      throw new CompanyDataStepError(table, "collect ids for", {
        message: `manifest parent chain is cyclic at ${table}`,
      });
    }

    const entry: ManifestEntry | undefined = manifestByTable().get(table);
    if (!entry) {
      throw new CompanyDataStepError(table, "collect ids for", {
        message: `${table} is not classified in the company data manifest`,
      });
    }

    this.resolving.add(table);
    try {
      const ids =
        entry.scope === "company"
          ? await this.companyScopedIds(table, entry.companyColumn)
          : await this.parentScopedIds(entry.table, entry.parentTable, entry.parentColumn);
      this.cache.set(table, ids);
      return ids;
    } finally {
      this.resolving.delete(table);
    }
  }

  private async companyScopedIds(
    table: string,
    companyColumn: string
  ): Promise<string[]> {
    const { data, error } = await this.db
      .from(table)
      .select("id")
      .eq(companyColumn, this.companyId);
    if (error) throw new CompanyDataStepError(table, "collect ids for", error);
    return toIds(data);
  }

  private async parentScopedIds(
    table: string,
    parentTable: string,
    parentColumn: string
  ): Promise<string[]> {
    const parentIds = await this.idsFor(parentTable);
    if (parentIds.length === 0) return [];

    const ids: string[] = [];
    for (const chunk of chunkIds(parentIds)) {
      const { data, error } = await this.db
        .from(table)
        .select("id")
        .in(parentColumn, chunk);
      if (error) throw new CompanyDataStepError(table, "collect ids for", error);
      ids.push(...toIds(data));
    }
    return ids;
  }
}

/**
 * Run `fn` once per `in.()`-sized chunk of the parent ids an entry hangs off.
 * Yields nothing when the parent owns no rows, so a child table of an empty
 * parent is never queried at all.
 */
export async function forEachParentChunk<T>(
  scope: CompanyDataScope,
  parentTable: string,
  fn: (chunk: string[]) => Promise<T>
): Promise<T[]> {
  const parentIds = await scope.idsFor(parentTable);
  const results: T[] = [];
  for (const chunk of chunkIds(parentIds)) {
    results.push(await fn(chunk));
  }
  return results;
}
