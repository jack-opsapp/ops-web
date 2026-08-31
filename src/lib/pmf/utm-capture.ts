export const FIRST_TOUCH_COOKIE = "__ops_first_touch";
export const SITE_ATTRIBUTION_COOKIE = "ops_attribution";
export const FIRST_TOUCH_VERSION = 1 as const;
export const FIRST_TOUCH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const FIRST_TOUCH_MAX_ENCODED_BYTES = 3500;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAMPAIGN_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
const CLICK_ID_KEYS = ["gclid", "fbclid"] as const;

export interface FirstTouch {
  version: typeof FIRST_TOUCH_VERSION;
  anonymous_id: string;
  captured_at: string;
  landing_path: string;
  referrer_domain?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
}

interface ParseOptions {
  legacyAnonymousId?: string;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\ud800-\udfff]/g, "")
    .trim()
    .slice(0, maxLength);
  return cleaned || undefined;
}

function canonicalPath(value: unknown): string | null {
  const text = cleanText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text, "https://app.opsapp.co");
    return url.pathname.startsWith("/") ? url.pathname : null;
  } catch {
    return null;
  }
}

function canonicalTimestamp(value: unknown): string | null {
  const text = cleanText(value, 64);
  if (!text) return null;
  const timestamp = new Date(text);
  if (!Number.isFinite(timestamp.getTime())) return null;
  return timestamp.toISOString();
}

function isOpsDomain(hostname: string): boolean {
  return hostname === "opsapp.co" || hostname.endsWith(".opsapp.co");
}

export function canonicalReferrerDomain(value: unknown): string | undefined {
  const text = cleanText(value, 2048);
  if (!text) return undefined;
  try {
    const hostname = new URL(text).hostname.toLowerCase().replace(/^www\./, "");
    if (!hostname || isOpsDomain(hostname)) return undefined;
    return hostname.slice(0, 253);
  } catch {
    return undefined;
  }
}

function decodeCookiePayload(rawValue: string): string | null {
  let current = rawValue;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const trimmed = current.trim();
    if (trimmed.startsWith("{")) return trimmed;
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return null;
      current = decoded;
    } catch {
      return null;
    }
  }
  return null;
}

function deterministicLegacyId(value: string): string {
  const seeds = [2166136261, 2246822519, 3266489917, 668265263];
  const chunks = seeds.map((seed) => {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  });
  const hex = chunks.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function parseFirstTouchValue(
  rawValue: string,
  options: ParseOptions = {}
): FirstTouch | null {
  try {
    const decoded = decodeCookiePayload(rawValue);
    if (!decoded) return null;
    const unknownPayload: unknown = JSON.parse(decoded);
    if (
      !unknownPayload ||
      typeof unknownPayload !== "object" ||
      Array.isArray(unknownPayload)
    ) {
      return null;
    }
    const payload = unknownPayload as Record<string, unknown>;
    const anonymousId = cleanText(
      payload.anonymous_id ?? options.legacyAnonymousId,
      36
    );
    if (!anonymousId || !UUID_PATTERN.test(anonymousId)) return null;

    const capturedAt = canonicalTimestamp(
      payload.captured_at ?? payload.first_touch_at
    );
    const landingPath = canonicalPath(
      payload.landing_path ?? payload.landing_url
    );
    if (!capturedAt || !landingPath) return null;

    const parsed: FirstTouch = {
      version: FIRST_TOUCH_VERSION,
      anonymous_id: anonymousId,
      captured_at: capturedAt,
      landing_path: landingPath,
    };
    const rawReferrerDomain = cleanText(payload.referrer_domain, 253)
      ?.toLowerCase()
      .replace(/^www\./, "");
    const referrerDomain =
      rawReferrerDomain && !isOpsDomain(rawReferrerDomain)
        ? rawReferrerDomain
        : canonicalReferrerDomain(payload.referrer);
    if (referrerDomain) parsed.referrer_domain = referrerDomain;

    for (const key of CAMPAIGN_KEYS) {
      const value = cleanText(payload[key], 256);
      if (value) parsed[key] = value;
    }
    for (const key of CLICK_ID_KEYS) {
      const value = cleanText(payload[key], 512);
      if (value) parsed[key] = value;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function captureFirstTouchFromUrl(
  url: string,
  referrer: string,
  options: { capturedAt?: string; anonymousId?: string } = {}
): FirstTouch | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  const capturedAt = canonicalTimestamp(
    options.capturedAt ?? new Date().toISOString()
  );
  const anonymousId = options.anonymousId ?? crypto.randomUUID();
  if (!capturedAt || !UUID_PATTERN.test(anonymousId)) return null;

  const touch: FirstTouch = {
    version: FIRST_TOUCH_VERSION,
    anonymous_id: anonymousId,
    captured_at: capturedAt,
    landing_path: parsedUrl.pathname,
  };
  const referrerDomain = canonicalReferrerDomain(referrer);
  if (referrerDomain) touch.referrer_domain = referrerDomain;
  for (const key of CAMPAIGN_KEYS) {
    const value = cleanText(parsedUrl.searchParams.get(key), 256);
    if (value) touch[key] = value;
  }
  for (const key of CLICK_ID_KEYS) {
    const value = cleanText(parsedUrl.searchParams.get(key), 512);
    if (value) touch[key] = value;
  }
  return touch;
}

function browserCookieValue(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt < 0 || trimmed.slice(0, equalsAt) !== name) continue;
    return trimmed.slice(equalsAt + 1);
  }
  return undefined;
}

export function readCookieFirstTouch(): FirstTouch | null {
  const canonical = browserCookieValue(FIRST_TOUCH_COOKIE);
  if (canonical) {
    const parsed = parseFirstTouchValue(canonical, {
      legacyAnonymousId: deterministicLegacyId(canonical),
    });
    if (parsed) return parsed;
  }
  const legacy = browserCookieValue(SITE_ATTRIBUTION_COOKIE);
  return legacy
    ? parseFirstTouchValue(legacy, {
        legacyAnonymousId: deterministicLegacyId(legacy),
      })
    : null;
}

function encodedPayloadLength(touch: FirstTouch): number {
  return encodeURIComponent(JSON.stringify(touch)).length;
}

function cookieSafeTouch(touch: FirstTouch): FirstTouch {
  if (encodedPayloadLength(touch) <= FIRST_TOUCH_MAX_ENCODED_BYTES) {
    return touch;
  }

  const bounded: FirstTouch = {
    version: touch.version,
    anonymous_id: touch.anonymous_id,
    captured_at: touch.captured_at,
    landing_path: touch.landing_path.slice(0, 256),
  };
  const prioritized = [
    ["gclid", 256],
    ["fbclid", 256],
    ["utm_source", 128],
    ["utm_medium", 128],
    ["utm_campaign", 128],
    ["referrer_domain", 253],
    ["utm_content", 96],
    ["utm_term", 96],
  ] as const;

  for (const [key, maxLength] of prioritized) {
    const value = touch[key]?.slice(0, maxLength);
    if (!value) continue;
    const candidate = { ...bounded, [key]: value };
    if (encodedPayloadLength(candidate) <= FIRST_TOUCH_MAX_ENCODED_BYTES) {
      bounded[key] = value;
    }
  }
  return bounded;
}

export function encodeFirstTouchPayload(touch: FirstTouch): string {
  return encodeURIComponent(JSON.stringify(cookieSafeTouch(touch)));
}

export function writeCookieFirstTouch(touch: FirstTouch): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const value = encodeFirstTouchPayload(touch);
  const isOpsProductionHost =
    window.location.hostname === "opsapp.co" ||
    window.location.hostname.endsWith(".opsapp.co");
  const domain = isOpsProductionHost ? "; Domain=.opsapp.co" : "";
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${FIRST_TOUCH_COOKIE}=${value}; Path=/; ` +
    `Max-Age=${FIRST_TOUCH_MAX_AGE_SECONDS}; SameSite=Lax${domain}${secure}`;
}

export function captureOnLanding(): void {
  if (typeof window === "undefined") return;
  if (readCookieFirstTouch()) return;
  const touch = captureFirstTouchFromUrl(
    window.location.href,
    typeof document !== "undefined" ? document.referrer : ""
  );
  if (touch) writeCookieFirstTouch(touch);
}

export function readServerFirstTouch(
  cookieHeader: string | null | undefined
): FirstTouch | null {
  if (!cookieHeader) return null;
  const candidates: FirstTouch[] = [];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt < 0) continue;
    const name = trimmed.slice(0, equalsAt);
    const value = trimmed.slice(equalsAt + 1);
    if (name === FIRST_TOUCH_COOKIE) {
      const parsed = parseFirstTouchValue(value, {
        legacyAnonymousId: deterministicLegacyId(value),
      });
      if (parsed) candidates.push(parsed);
    } else if (name === SITE_ATTRIBUTION_COOKIE) {
      const parsed = parseFirstTouchValue(value, {
        legacyAnonymousId: deterministicLegacyId(value),
      });
      if (parsed) candidates.push(parsed);
    }
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, candidate) =>
    candidate.captured_at < earliest.captured_at ? candidate : earliest
  );
}
