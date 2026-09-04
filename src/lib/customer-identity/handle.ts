/**
 * OPS Web - Customer identity: public handle grammar
 *
 * The one definition of what a `companies.public_handle` looks like, shared
 * by the hosted pages (server components) and the broker routes. Page-safe:
 * no server-only import, no I/O.
 *
 * Mirrors the CHECK constraint from the P1 migration
 * (`20260902010242_customer_identity_foundation.sql`): lowercase
 * alphanumerics with single hyphens, 3–48 characters.
 */

export const PUBLIC_HANDLE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const PUBLIC_HANDLE_MIN_LENGTH = 3;
export const PUBLIC_HANDLE_MAX_LENGTH = 48;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Exact or nothing: no trimming, no case folding. A uuid-shaped string is
 * refused even though it fits the grammar — a company is addressed by its
 * handle, never by its id (design I4), and the backfill can never mint one.
 */
export function parsePublicHandle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if (
    input.length < PUBLIC_HANDLE_MIN_LENGTH ||
    input.length > PUBLIC_HANDLE_MAX_LENGTH
  ) {
    return null;
  }
  if (CANONICAL_UUID_PATTERN.test(input)) return null;
  return PUBLIC_HANDLE_PATTERN.test(input) ? input : null;
}

export function isValidPublicHandle(handle: string): boolean {
  return parsePublicHandle(handle) !== null;
}
