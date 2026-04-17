/**
 * OPS Web - App URL Helper
 *
 * Single source of truth for the public-facing application URL.
 *
 * Historically the codebase used two env vars for the same value:
 *   - NEXT_PUBLIC_BASE_URL  (OAuth redirects, cron→API loopback, webhook URLs)
 *   - NEXT_PUBLIC_APP_URL   (outbound email links, portal URLs, invites)
 *
 * They always resolved to the same domain, but a misconfigured environment
 * could set only one of them — the other would silently fall back to
 * "http://localhost:3000" and generate broken links in production. This
 * helper normalizes the resolution order and gives every caller one place
 * to import from so the fallback path is consistent.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_APP_URL (preferred — more semantic)
 *   2. NEXT_PUBLIC_BASE_URL (legacy)
 *   3. http://localhost:3000 (dev fallback only)
 */

const LOCAL_FALLBACK = "http://localhost:3000";

/**
 * Return the canonical app URL with no trailing slash.
 *
 * Safe to call at the top level of a module — reads from process.env on
 * every invocation so serverless cold starts pick up the latest value.
 */
export function getAppUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    LOCAL_FALLBACK;
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
