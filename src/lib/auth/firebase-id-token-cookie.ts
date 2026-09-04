export const OPS_AUTH_COOKIE_NAME = "ops-auth-token";
export const LEGACY_SESSION_COOKIE_NAME = "__session";
export const ADMIN_RETURN_TO_HEADER = "x-ops-admin-return-to";

const FIREBASE_TOKEN_REFRESH_SKEW_SECONDS = 60;
const FIREBASE_TOKEN_COOKIE_MAX_AGE_SECONDS = 60 * 60;

/**
 * Read a Firebase ID token's unverified expiry for cookie lifetime and routing.
 *
 * This is deliberately only a freshness hint. It does not authenticate the
 * token; protected server code must still verify the Firebase signature and
 * claims before granting access.
 */
export function getFirebaseIdTokenCookieMaxAge(
  token: string,
  nowMs = Date.now()
): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "="
    );
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return null;
    }

    const remainingSeconds =
      Math.floor(payload.exp) -
      Math.floor(nowMs / 1000) -
      FIREBASE_TOKEN_REFRESH_SKEW_SECONDS;
    if (remainingSeconds <= 0) return null;

    return Math.min(remainingSeconds, FIREBASE_TOKEN_COOKIE_MAX_AGE_SECONDS);
  } catch {
    return null;
  }
}

/** Canonical cookies always win; legacy is only a migration fallback. */
export function selectFirebaseIdTokenCookie(
  canonicalToken: string | null | undefined,
  legacyToken: string | null | undefined
): string | null {
  return canonicalToken || legacyToken || null;
}
