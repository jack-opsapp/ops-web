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

/**
 * Normalize an address for comparison.
 * Lowercases, strips unit/suite/apt designators, normalizes whitespace.
 */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(UNIT_PATTERN, "")
    .replace(/\.(?=\s|$)/g, "") // strip trailing periods (St. → St)
    .replace(/\s+/g, " ")
    .trim();
}

// Strips email prefixes and common filler words from titles
const TITLE_PREFIXES = /^(re:\s*|fwd?:\s*|fw:\s*)*/gi;
const TITLE_FILLER = /\b(new\s+)?(project|job)\s*[-:]\s*/gi;

/**
 * Normalize a project/opportunity title for comparison.
 * Strips email prefixes (RE:, FW:), common filler ("New Project -"), lowercases.
 */
export function normalizeTitle(title: string): string {
  return title
    .replace(TITLE_PREFIXES, "")
    .replace(TITLE_FILLER, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
