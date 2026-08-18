/**
 * Crew join-code minting.
 *
 * `company_code` is the key a crew member types to join their company
 * (`/api/auth/join-company`, `/api/auth/validate-code`, `/api/invites/[code]`).
 * A company without one cannot be joined at all, so it is part of a company's
 * correct final state, not an optional extra.
 *
 * `public.create_company_for_owner` — the iOS onboarding RPC — mints one at
 * creation. This mirrors that algorithm so the web signup path produces codes
 * indistinguishable from the iOS path: 8 characters drawn from a 32-symbol
 * alphabet with the look-alike glyphs (I, O, 0, 1) removed, retried against the
 * unique index `idx_companies_company_code` up to 20 times.
 *
 * The one deliberate divergence: entropy comes from the Web Crypto CSPRNG
 * rather than Postgres `random()`. The code is a bearer credential — anyone
 * holding it can join the company — so a predictable generator is a real
 * weakness. Alphabet, length, retry bound and collision handling are identical;
 * only the randomness source is stronger. 256 is an exact multiple of 32, so
 * the byte-to-symbol mapping carries no modulo bias.
 */

export const COMPANY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const COMPANY_CODE_LENGTH = 8;
export const COMPANY_CODE_MAX_ATTEMPTS = 20;

/** The partial unique index behind `companies.company_code`. */
export const COMPANY_CODE_UNIQUE_INDEX = "idx_companies_company_code";

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

export function generateCompanyCode(): string {
  const bytes = new Uint8Array(COMPANY_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);

  let code = "";
  for (let i = 0; i < COMPANY_CODE_LENGTH; i += 1) {
    code += COMPANY_CODE_ALPHABET[bytes[i] % COMPANY_CODE_ALPHABET.length];
  }
  return code;
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/**
 * True only for a collision on the company-code index.
 *
 * `companies` carries other unique constraints (`companies_pkey`,
 * `companies_bubble_id_key`); retrying a fresh code would not clear those, so
 * they must surface as real failures rather than be retried into a confusing
 * "exhausted" error. This mirrors the RPC, which re-raises when
 * `constraint_name` is distinct from the company-code index.
 */
export function isCompanyCodeCollision(error: PostgrestLikeError | null): boolean {
  if (!error || error.code !== UNIQUE_VIOLATION) return false;
  const haystack = `${error.message ?? ""} ${error.details ?? ""}`;
  return haystack.includes(COMPANY_CODE_UNIQUE_INDEX);
}
