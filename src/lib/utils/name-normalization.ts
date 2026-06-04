/**
 * Shared normalization utilities for duplicate detection and consolidation.
 * Used by both the import wizard (consolidation-utils.ts) and the
 * daily duplicate detection cron (duplicate-detection-service.ts).
 */

// Strips common business suffixes: Inc, Ltd, LLC, Corp, etc.
export const BUSINESS_SUFFIXES =
  /\b(inc\.?|ltd\.?|llc\.?|corp\.?|co\.?|limited|incorporated|corporation|enterprises?|services?|developments?|construction|contracting|group|solutions|holdings)\b/gi;

/**
 * Normalize a company/client name for fuzzy comparison.
 * Strips business suffixes, lowercases, removes non-alphanumeric, collapses whitespace.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(BUSINESS_SUFFIXES, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a phone number for exact comparison.
 * Strips all non-digit characters, returns last 10 digits (drops country code).
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Matches unit/suite/apt designators and everything after them
const UNIT_PATTERN =
  /[,\s]+(suite|ste|unit|apt|apartment|#)\s*\.?\s*\w+.*$/i;

// Canonical token map for directionals + common street types. Each token folds
// to one form so spelling variants ("W"/"West", "Ave"/"Avenue") compare equal.
// Mirrors the CASE expression in `private.normalize_address` (won-conversion
// migration 20260603020000) EXACTLY — keep the two in lockstep; the shared
// vectors in tests/unit/name-normalization.test.ts guard the parity.
const ADDRESS_TOKEN_CANON: Record<string, string> = {
  // directionals
  w: "west",
  e: "east",
  n: "north",
  s: "south",
  nw: "northwest",
  ne: "northeast",
  sw: "southwest",
  se: "southeast",
  // street types
  ave: "avenue",
  av: "avenue",
  st: "street",
  str: "street",
  rd: "road",
  blvd: "boulevard",
  boul: "boulevard",
  dr: "drive",
  cres: "crescent",
  cr: "crescent",
  hwy: "highway",
  pl: "place",
  ct: "court",
  ln: "lane",
  ter: "terrace",
  pkwy: "parkway",
  sq: "square",
};

/**
 * Normalize an address for comparison. Single source of truth shared with the
 * SQL `private.normalize_address` (the convert-time preflight + nightly
 * duplicate scan must agree — spec §6.1).
 *
 * 1. Lowercase, strip the unit/suite/apt designator and everything after it.
 * 2. Periods and commas become separators; whitespace collapses.
 * 3. Directionals and street types fold to one canonical token, so
 *    `1240 W 6th Ave` and `1240 West 6th Avenue` both become
 *    `1240 west 6th avenue`.
 */
export function normalizeAddress(address: string): string {
  const stripped = (address ?? "").toLowerCase().replace(UNIT_PATTERN, "");
  const collapsed = stripped
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed === "") return "";
  return collapsed
    .split(" ")
    .map((token) => ADDRESS_TOKEN_CANON[token] ?? token)
    .join(" ");
}

// Strips email prefixes and common filler words from titles
const TITLE_PREFIXES = /^(re:\s*|fwd?:\s*|fw:\s*)*/gi;
const TITLE_FILLER = /\b(new\s+)?(project|job)\s*[-:]\s*/gi;

// Auto-name placeholders are matching-invisible so two unnamed projects never
// produce a false `same_title` signal (spec §6.1, edge #5). Mirrors the CASE in
// `private.normalize_title` — keep in lockstep with the SQL + shared vectors.
const PLACEHOLDER_TITLE = /^(new project|proyecto nuevo)$/;
const CLIENT_PROJECT_TITLE = /'s project$/;

/**
 * Normalize a project/opportunity title for comparison. Single source of truth
 * shared with the SQL `private.normalize_title`.
 *
 * Strips email prefixes (RE:, FW:) and trade filler ("New Project -", "Job:"),
 * lowercases and collapses whitespace, then returns "" for the auto-name
 * placeholders (`New project` / `proyecto nuevo` / `{Client}'s Project`) so they
 * never match each other.
 */
export function normalizeTitle(title: string): string {
  const cleaned = (title ?? "")
    .replace(TITLE_PREFIXES, "")
    .replace(TITLE_FILLER, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return "";
  if (PLACEHOLDER_TITLE.test(cleaned)) return "";
  if (CLIENT_PROJECT_TITLE.test(cleaned)) return "";
  return cleaned;
}
