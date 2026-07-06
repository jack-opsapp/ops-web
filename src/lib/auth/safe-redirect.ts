/**
 * Sanitize a post-auth `redirect` target down to a same-origin, root-relative
 * path.
 *
 * The `redirect` query param on `/login` is attacker-controllable — anyone can
 * craft `/login?redirect=…` and hand the link to a victim. After a successful
 * sign-in both the middleware and the login page navigate to that value, so an
 * unchecked value is an open redirect: `?redirect=https://evil.com` would carry
 * a freshly-authenticated user straight off-site. We only ever want to return a
 * user to a location *inside* the app, so anything that is not an unambiguous
 * root-relative path collapses to `fallback`.
 *
 * This is deliberately distinct from `validateContinueUrl`, which vets the
 * *absolute* magic-link `continueUrl` against a host allowlist. That guard
 * requires a parseable absolute URL; this one requires a relative path and
 * rejects everything absolute.
 *
 * @param raw      The untrusted redirect value (typically `searchParams.get`).
 * @param fallback Where to send the user when `raw` is missing or unsafe.
 * @returns A path guaranteed to start with a single `/` (or the `fallback`).
 */
export function safeRedirectPath(
  raw: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (!raw) return fallback;

  // Must be root-relative: a single leading slash.
  if (raw[0] !== "/") return fallback;

  // Reject scheme-relative URLs ("//evil.com") — the browser treats the leading
  // "//" as protocol-relative and navigates off-origin.
  if (raw[1] === "/") return fallback;

  // A backslash is never part of a legitimate encoded path or query and is a
  // classic parser-confusion vector ("/\evil.com" → "//evil.com" in browsers).
  if (raw.includes("\\")) return fallback;

  // Raw control characters (CR/LF/TAB/DEL) can be used to slip past the checks
  // above once a client strips them; a real path or query percent-encodes them.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return fallback;
  }

  return raw;
}
