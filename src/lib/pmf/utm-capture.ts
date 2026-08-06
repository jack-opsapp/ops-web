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

/**
 * Canonical first-touch cookie name. Shared verbatim with ops-site, which is
 * the primary writer (it sets Domain=.opsapp.co so the payload survives the
 * hop from opsapp.co to app.opsapp.co).
 */
export const FIRST_TOUCH_COOKIE = COOKIE;

/**
 * The marketing site's attribution cookie (`ops-site/src/lib/spec/attribution.ts`).
 *
 * ops-site is where nearly all first touches actually happen, and it writes
 * THIS name — scoped to `.opsapp.co` so it reaches app.opsapp.co. Its payload
 * is the same shape as FirstTouch apart from the timestamp key
 * (`first_touch_at` rather than `captured_at`). Reading only our own cookie
 * name would leave the great majority of signups unattributed.
 */
export const SITE_ATTRIBUTION_COOKIE = "ops_attribution";

/**
 * Per-field cap. A cookie is attacker-controllable, and these values land in
 * Postgres text columns and Stripe metadata (500-char limit), so bound them at
 * the parse boundary rather than trusting the payload.
 */
const MAX_FIELD_LEN = 512;

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
 *
 * Defends against malicious / corrupt cookies: the parsed JSON must be a
 * non-null, non-array object. Any non-string field is coerced to undefined
 * so downstream consumers never see e.g. `utm_source = 123`.
 */
export function readCookieFirstTouch(): FirstTouch | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  return parseFirstTouchValue(match.substring(COOKIE.length + 1));
}

/**
 * Pure: parse + sanitize one raw (URI-encoded) cookie value into a FirstTouch.
 * Returns null on malformed JSON or a non-object payload.
 *
 * Shared by the browser reader and the server reader so both apply identical
 * defences: any non-string field becomes undefined (so downstream never sees
 * e.g. `utm_source = 123`), and every value is length-capped.
 */
export function parseFirstTouchValue(rawValue: string): FirstTouch | null {
  try {
    const raw: unknown = JSON.parse(decodeURIComponent(rawValue));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const str = (v: unknown): string | undefined =>
      typeof v === "string" ? v.slice(0, MAX_FIELD_LEN) : undefined;
    return {
      utm_source: str(obj.utm_source),
      utm_medium: str(obj.utm_medium),
      utm_campaign: str(obj.utm_campaign),
      utm_content: str(obj.utm_content),
      utm_term: str(obj.utm_term),
      gclid: str(obj.gclid),
      fbclid: str(obj.fbclid),
      landing_url: str(obj.landing_url),
      referrer: str(obj.referrer),
      // ops-site's cookie names this field first_touch_at; accept either so
      // one parser serves both cookies.
      captured_at:
        str(obj.captured_at) ?? str(obj.first_touch_at) ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Server-side twin of readCookieFirstTouch, for route handlers.
 *
 * Reads BOTH attribution cookies: `ops_attribution` (written by ops-site,
 * where nearly every real first touch happens) and `__ops_first_touch`
 * (written by this app when a tagged URL hits app.opsapp.co directly).
 *
 * Takes the RAW `Cookie` header rather than a parsed store for two reasons:
 * duplicates of the same name can legitimately coexist (a host-only cookie
 * alongside a `.opsapp.co` one), and a parsed store surfaces only whichever
 * the browser happened to order first. Parsing every occurrence and returning
 * the EARLIEST `captured_at` keeps first-touch deterministic rather than
 * ordering-dependent — the touch that actually brought the customer in wins.
 *
 * Returns null when absent or when no occurrence parses.
 */
export function readServerFirstTouch(
  cookieHeader: string | null | undefined
): FirstTouch | null {
  if (!cookieHeader) return null;

  const candidates: FirstTouch[] = [];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    // Exact name match — never a suffix match like `not__ops_first_touch`.
    const name = trimmed.slice(0, eq);
    if (name !== COOKIE && name !== SITE_ATTRIBUTION_COOKIE) continue;
    const parsed = parseFirstTouchValue(trimmed.slice(eq + 1));
    if (parsed) candidates.push(parsed);
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, next) =>
    next.captured_at < earliest.captured_at ? next : earliest
  );
}

/**
 * Write the first-touch cookie. SSR-safe no-op when document is undefined.
 * Path=/, SameSite=Lax, Expires=+30d. Adds Secure when running on HTTPS so
 * the cookie isn't sent over plain HTTP. HttpOnly is intentionally omitted
 * because the JS reader (readCookieFirstTouch) needs access.
 */
export function writeCookieFirstTouch(touch: FirstTouch): void {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + TTL_DAYS * 86_400_000).toUTCString();
  const value = encodeURIComponent(JSON.stringify(touch));
  const isHttps =
    typeof window !== "undefined" && window.location.protocol === "https:";
  const secure = isHttps ? "; Secure" : "";
  document.cookie = `${COOKIE}=${value}; Path=/; Expires=${expires}; SameSite=Lax${secure}`;
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
