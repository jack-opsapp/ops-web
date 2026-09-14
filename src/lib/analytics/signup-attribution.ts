import {
  classifyAttribution,
  type AttributionDecision,
} from "@/lib/pmf/attribution";
import {
  FIRST_TOUCH_MAX_AGE_SECONDS,
  readServerFirstTouch,
} from "@/lib/pmf/utm-capture";

/** Classified diagnostic context, not authorization or canonical trial truth.
 * No raw click IDs, anonymous IDs, URLs, referrers, or campaign text are retained.
 */
export interface SignupAttribution extends AttributionDecision {
  version: 1;
  recorded_at: string;
}

export function isProductionAnalyticsRequest(req: Request): boolean {
  if (process.env.VERCEL_ENV !== "production") return false;
  try {
    if (new URL(req.url).origin !== "https://app.opsapp.co") return false;
    return [req.headers.get("origin"), req.headers.get("referer")].every(
      (value) => !value || new URL(value).origin === "https://app.opsapp.co"
    );
  } catch {
    return false;
  }
}

export function buildSignupAttribution(
  req: Request,
  now = Date.now()
): SignupAttribution | null {
  if (!isProductionAnalyticsRequest(req)) return null;
  const base = {
    version: 1 as const,
    recorded_at: new Date(now).toISOString(),
  };
  const unknown = (reason: string): SignupAttribution => ({
    ...base,
    channel: "unknown",
    basis: "unknown",
    confidence: 0,
    reason,
  });
  const touch = readServerFirstTouch(req.headers.get("cookie"));
  if (!touch) return unknown("missing_first_touch");
  const age = now - Date.parse(touch.captured_at);
  if (age > FIRST_TOUCH_MAX_AGE_SECONDS * 1000)
    return unknown("expired_first_touch");
  if (age < -5 * 60 * 1000) return unknown("future_first_touch");
  return { ...base, ...classifyAttribution(touch) };
}
