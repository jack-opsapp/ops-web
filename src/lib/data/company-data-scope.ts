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

/** The shape a PostgREST error arrives in. */
export interface PostgrestFailure {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

/** A named, non-swallowable failure of one cascade or export step. */
export class CompanyDataStepError extends Error {
  readonly table: string;
  readonly operation: string;
  readonly code?: string;
  readonly details?: string;

  constructor(table: string, operation: string, failure: PostgrestFailure) {
    super(
      `${operation} ${table} failed: ${failure.message ?? "unknown database error"}`
    );
    this.name = "CompanyDataStepError";
    this.table = table;
    this.operation = operation;
    this.code = failure.code;
    this.details = failure.details;
  }

  /** The underlying database message, without the step prefix. */
  get databaseMessage(): string {
    return this.message.slice(this.message.indexOf("failed: ") + 8);
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
