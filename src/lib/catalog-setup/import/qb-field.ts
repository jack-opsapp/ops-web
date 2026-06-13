// QB JSON field accessors for the catalog-setup import lane.
//
// These mirror the private `str`/`num` accessors in
// `@/lib/api/services/qbo-normalize.ts` byte-for-byte in behavior. The plan
// (Task 5.3) asks to REUSE those helpers, but they are module-private there and
// this slice's hard rule forbids editing that shared file to export them.
// Re-stating the exact same pure semantics here keeps the mapper self-contained
// and dependency-free while preserving identical parsing rules — when the
// reconcile in Task 5.1 lands, consolidate to a single exported source.
//
// Pure, side-effect free. No Supabase, no fetch, no I/O.

/** A non-empty string, else null. (Mirrors qbo-normalize `str`.) */
export function qbStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** A finite number from a number or numeric string, else null. (Mirrors qbo-normalize `num`.) */
export function qbNum(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}
