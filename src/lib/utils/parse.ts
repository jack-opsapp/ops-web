/**
 * Safely parse a value that should be a string array.
 * Handles string[], null, undefined, and malformed data from Supabase JSONB columns.
 */
export function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  return [];
}
