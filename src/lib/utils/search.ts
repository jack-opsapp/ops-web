/**
 * Shared list-search matching. One grammar across every list surface
 * (Projects is the same grammar server-side via ilike — see
 * `project-filter-to-sql.ts`): the query is split on whitespace and EVERY
 * token must appear somewhere in the row's searchable text, so multi-word
 * queries match across fields ("miramar housing", "charlie remodel") instead
 * of requiring one contiguous substring.
 */

/** Lower-cased whitespace tokens of a query; empty for blank input. */
export function searchTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * True when every whitespace token of `query` appears in `haystack`.
 * `haystack` must already be lower-cased (callers typically build it once per
 * row by joining the searchable fields).
 */
export function matchesAllTokens(haystack: string, query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  return tokens.every((token) => haystack.includes(token));
}
