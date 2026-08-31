import type { AttributionChannel } from "./types";

export type AttributionBasis =
  | "verified_click_id"
  | "deterministic_first_party"
  | "utm_referrer"
  | "app_store"
  | "self_reported"
  | "direct"
  | "unknown";

export interface AttributionInput {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  landing_path?: string | null;
  referrer_domain?: string | null;
  /** Legacy inputs retained for admin/backfill callers. */
  landing_url?: string | null;
  referrer?: string | null;
}

export interface AttributionDecision {
  channel: AttributionChannel;
  basis: AttributionBasis;
  confidence: number;
  reason: string;
}

const OPS_DOMAIN = /(^|\.)opsapp\.co$/i;
const SEARCH_ENGINE_DOMAINS = [
  /(^|\.)google\.[a-z.]+$/i,
  /(^|\.)bing\.com$/i,
  /(^|\.)duckduckgo\.com$/i,
  /(^|\.)search\.yahoo\.com$/i,
];

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeDomain(input: AttributionInput): string {
  const candidate = normalize(input.referrer_domain ?? input.referrer);
  if (!candidate) return "";
  try {
    const url = candidate.includes("://")
      ? new URL(candidate)
      : new URL(`https://${candidate}`);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function decision(
  channel: AttributionChannel,
  basis: AttributionBasis,
  confidence: number,
  reason: string
): AttributionDecision {
  return { channel, basis, confidence, reason };
}

export function classifyAttribution(
  input: AttributionInput
): AttributionDecision {
  const source = normalize(input.utm_source);
  const medium = normalize(input.utm_medium);
  const referrerDomain = normalizeDomain(input);
  const externalReferrer = referrerDomain && !OPS_DOMAIN.test(referrerDomain);

  if (input.gclid) {
    return decision("google_ads", "verified_click_id", 1, "gclid_present");
  }
  if (input.fbclid) {
    return decision("meta_ads", "verified_click_id", 1, "fbclid_present");
  }
  if (source === "apple_search_ads" || source === "asa") {
    return decision(
      "apple_search_ads",
      "deterministic_first_party",
      0.95,
      "apple_search_ads_source"
    );
  }
  if (medium === "organic" || medium === "search") {
    if (
      source.includes("facebook") ||
      source.includes("meta") ||
      source.includes("instagram") ||
      source.includes("youtube")
    ) {
      return decision(
        "organic_social",
        "utm_referrer",
        0.9,
        "organic_social_utm"
      );
    }
    return decision(
      "organic_search",
      "utm_referrer",
      0.9,
      "organic_utm_medium"
    );
  }
  if (source.includes("google")) {
    return decision("google_ads", "utm_referrer", 0.85, "google_utm_source");
  }
  if (
    source.includes("facebook") ||
    source.includes("meta") ||
    source.includes("instagram")
  ) {
    return decision("meta_ads", "utm_referrer", 0.85, "meta_utm_source");
  }
  if (
    externalReferrer &&
    SEARCH_ENGINE_DOMAINS.some((pattern) => pattern.test(referrerDomain))
  ) {
    return decision(
      "organic_search",
      "utm_referrer",
      0.9,
      "search_engine_referrer"
    );
  }
  if (medium === "referral" || source === "referral" || externalReferrer) {
    return decision("referral", "utm_referrer", 0.8, "external_referrer");
  }
  if (!source && !medium) {
    return decision("direct", "direct", 1, "no_campaign_or_external_referrer");
  }
  return decision("unknown", "utm_referrer", 0.3, "unclassified_campaign");
}

export function deriveAttributionChannel(
  input: AttributionInput
): AttributionChannel {
  return classifyAttribution(input).channel;
}
