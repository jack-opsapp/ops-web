/**
 * OAuth return-to sanitization.
 *
 * The email OAuth flows (Gmail + Microsoft 365) can carry a `returnTo` path
 * through the provider's opaque `state` parameter so the callback can land
 * the user back where they started (e.g. /pipeline) instead of /settings.
 *
 * Because `state` round-trips through an external provider, the value MUST
 * be treated as attacker-controlled. This module is the single allowlist:
 * only app-internal absolute paths survive. Anything else (full URLs,
 * protocol-relative //host tricks, backslash variants, header-splitting
 * characters) is rejected to null — callers then fall back to the default
 * /settings landing exactly as before.
 */

/**
 * Validate a candidate return path. Returns the path when it is a safe
 * app-internal absolute path, otherwise null.
 */
export function sanitizeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  // Must be an absolute app path: "/pipeline", "/pipeline?x=1", ...
  if (!value.startsWith("/")) return null;
  // "//evil.com" is protocol-relative — a full external redirect.
  if (value.startsWith("//")) return null;
  // Backslashes get normalized to slashes by some browsers ("/\evil.com").
  if (value.includes("\\")) return null;
  // CR/LF would allow response-header splitting in redirect Location values.
  if (value.includes("\n") || value.includes("\r")) return null;
  return value;
}

/**
 * Build the absolute redirect URL for a sanitized return path, appending
 * result params (e.g. connected=gmail / connect_error=1). Existing query
 * params on the return path survive. Defensively re-checks that the result
 * stays on the app origin; returns null if anything is off.
 */
export function buildReturnRedirect(
  appUrl: string,
  returnTo: string,
  params: Record<string, string>
): string | null {
  const safePath = sanitizeReturnTo(returnTo);
  if (!safePath) return null;

  let url: URL;
  try {
    url = new URL(safePath, appUrl);
  } catch {
    return null;
  }

  // Same-origin or nothing — belt and braces over the sanitizer.
  try {
    if (url.origin !== new URL(appUrl).origin) return null;
  } catch {
    return null;
  }

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
