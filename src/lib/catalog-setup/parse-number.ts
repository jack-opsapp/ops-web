// Permissive numeric parse — a faithful port of the identical private
// `parseNumber` in BOTH iOS mappers (CatalogCSVMapper.swift line 321,
// ProductsCSVMapper.swift line 315). It is the shared numeric primitive for
// every spreadsheet-import column (price, cost, quantity, thresholds).
//
// Behaviour pinned to the Swift original:
//   - tolerate a leading `$`, thousands `,`, and surrounding whitespace
//   - blank / whitespace-only / undefined / null → { value: null } with NO
//     error (the Swift comment: "Returns nil for blank input"; the mapper
//     callers add the "required" error themselves when a required column is
//     blank — this primitive stays silent)
//   - negative → { value: null, error: "negative" }
//   - otherwise unparseable → { value: null, error: "not_a_number" }
//
// Unlike the Swift version (which mutates an `errors` array and returns
// `Double?`), this returns a discriminated result so the caller decides how to
// surface the error — keeping the function pure and trivially testable.

export type ParseNumberError = "negative" | "not_a_number";

export interface ParseNumberResult {
  value: number | null;
  error?: ParseNumberError;
}

export function parseNumber(
  raw: string | undefined | null,
): ParseNumberResult {
  if (raw == null) return { value: null };
  // Mirror Swift's `trimmingCharacters(in: .whitespacesAndNewlines)` +
  // `$` and `,` stripping.
  const cleaned = raw.trim().replace(/\$/g, "").replace(/,/g, "");
  if (cleaned === "") return { value: null };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, error: "not_a_number" };
  if (n < 0) return { value: null, error: "negative" };
  return { value: n };
}
