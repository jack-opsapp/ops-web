import {
  REFERRAL_SOURCES,
  type ReferralSourceSlug,
} from "@/lib/data/referral-sources";
import type { AttributionChannel } from "@/lib/pmf/types";

export interface ReferralNormalization {
  rawSource: string | null;
  normalizedSlug: ReferralSourceSlug | null;
  channel: AttributionChannel | null;
  isLegacy: boolean;
  confidence: number | null;
  reason:
    | "blank"
    | "stable_slug"
    | "legacy_label"
    | "legacy_ambiguous";
}

const CHANNEL_BY_SLUG: Record<ReferralSourceSlug, AttributionChannel> = {
  instagram: "organic_social",
  facebook: "organic_social",
  youtube: "organic_social",
  google: "organic_search",
  app_store: "app_store_browse",
  word_of_mouth: "referral",
  other: "other",
};

const LEGACY_LABEL_TO_SLUG = new Map<string, ReferralSourceSlug>([
  ["instagram", "instagram"],
  ["facebook", "facebook"],
  ["youtube", "youtube"],
  ["google", "google"],
  ["app store", "app_store"],
  ["someone told me", "word_of_mouth"],
  ["word of mouth (onsite)", "word_of_mouth"],
  ["other", "other"],
]);

const STABLE_SLUGS = new Set<ReferralSourceSlug>(
  REFERRAL_SOURCES.map(({ slug }) => slug)
);

export function normalizeSelfReportedReferral(
  value: string | null | undefined
): ReferralNormalization {
  const rawSource = value?.trim() || null;
  if (!rawSource) {
    return {
      rawSource: null,
      normalizedSlug: null,
      channel: null,
      isLegacy: false,
      confidence: null,
      reason: "blank",
    };
  }

  if (STABLE_SLUGS.has(rawSource as ReferralSourceSlug)) {
    const normalizedSlug = rawSource as ReferralSourceSlug;
    return {
      rawSource,
      normalizedSlug,
      channel: CHANNEL_BY_SLUG[normalizedSlug],
      isLegacy: false,
      confidence: 0.55,
      reason: "stable_slug",
    };
  }

  const normalizedSlug = LEGACY_LABEL_TO_SLUG.get(rawSource.toLowerCase());
  if (normalizedSlug) {
    return {
      rawSource,
      normalizedSlug,
      channel: CHANNEL_BY_SLUG[normalizedSlug],
      isLegacy: true,
      confidence: 0.45,
      reason: "legacy_label",
    };
  }

  return {
    rawSource,
    normalizedSlug: null,
    channel: null,
    isLegacy: true,
    confidence: null,
    reason: "legacy_ambiguous",
  };
}
