/**
 * OPS Web — PMF First-Touch UTM Capture
 *
 * Pure-function UTM/gclid/fbclid extractor + browser cookie reader/writer.
 * Used by the client-side <UtmCaptureEffect /> mounted in the root layout
 * so any UTM-tagged URL that lands on app.opsapp.co is recorded for the
 * trial_attributions backfill flow.
 *
 * First-touch is preserved: once the cookie is set, captureOnLanding() is a
 * no-op until TTL expiry. SSR-safe — every browser-API access is guarded.
 *
 * Cookie: __ops_first_touch (Path=/, SameSite=Lax, Expires=+30d).
 */

const COOKIE = "__ops_first_touch";
const TTL_DAYS = 30;

export interface FirstTouch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
  landing_url?: string;
  referrer?: string;
  captured_at: string;
}

/**
 * Pure: extract a FirstTouch from a URL string + referrer string.
 * Returns null only if `url` cannot be parsed by the URL constructor.
 *
 * `landing_url` is always set (the parsed URL.toString()). `captured_at` is
 * always set (ISO timestamp). All other fields are undefined when their
 * matching query param / referrer is missing.
 */
export function captureFirstTouchFromUrl(
  url: string,
  referrer: string
): FirstTouch | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const params = u.searchParams;
  const get = (k: string) => params.get(k) || undefined;
  return {
    utm_source: get("utm_source"),
    utm_medium: get("utm_medium"),
    utm_campaign: get("utm_campaign"),
    utm_content: get("utm_content"),
    utm_term: get("utm_term"),
    gclid: get("gclid"),
    fbclid: get("fbclid"),
    landing_url: u.toString(),
    referrer: referrer || undefined,
    captured_at: new Date().toISOString(),
  };
}

/**
 * Read the first-touch cookie. Returns null on SSR, missing cookie, or
 * malformed payload.
 */
export function readCookieFirstTouch(): FirstTouch | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  try {
    const value = match.substring(COOKIE.length + 1);
    return JSON.parse(decodeURIComponent(value)) as FirstTouch;
  } catch {
    return null;
  }
}

/**
 * Write the first-touch cookie. SSR-safe no-op when document is undefined.
 * Path=/, SameSite=Lax, Expires=+30d.
 */
export function writeCookieFirstTouch(touch: FirstTouch): void {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + TTL_DAYS * 86_400_000).toUTCString();
  const value = encodeURIComponent(JSON.stringify(touch));
  document.cookie = `${COOKIE}=${value}; Path=/; Expires=${expires}; SameSite=Lax`;
}

/**
 * Capture first-touch from the current `window.location` if no prior touch
 * cookie exists. Idempotent: subsequent calls are no-ops until TTL expiry,
 * preserving the original first-touch attribution.
 *
 * SSR-safe: returns immediately when window is undefined.
 */
export function captureOnLanding(): void {
  if (typeof window === "undefined") return;
  if (readCookieFirstTouch()) return;
  const touch = captureFirstTouchFromUrl(
    window.location.href,
    typeof document !== "undefined" ? document.referrer : ""
  );
  if (touch) writeCookieFirstTouch(touch);
}
