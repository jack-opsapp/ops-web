/**
 * "How'd you find us" option set (Unified Attribution P2).
 *
 * This is the only acquisition signal that survives the App Store boundary —
 * no click id crosses an install — so it is asked on BOTH web and iOS with an
 * identical vocabulary. Keep this list in step with
 * `ops-ios/OPS/Onboarding/Models/ReferralSource.swift`.
 *
 * Stored value is the SLUG, not the label. Copy is expected to change; slugs
 * are not, so historical aggregation survives a rewording.
 *
 * Note: seven Bubble-era companies carry free-text values ("Instagram",
 * "Word of Mouth (Onsite)", "Internet Advertisement", "Other"). Those are
 * deliberately NOT migrated — "Internet Advertisement" cannot be mapped to a
 * slug without guessing, and rewriting self-reported customer data on a guess
 * is wrong. Normalize at read time when the attribution dashboard is built.
 */

export const REFERRAL_SOURCES = [
  { slug: "instagram", label: "Instagram" },
  { slug: "facebook", label: "Facebook" },
  { slug: "youtube", label: "YouTube" },
  { slug: "google", label: "Google" },
  { slug: "app_store", label: "App Store" },
  { slug: "word_of_mouth", label: "Someone told me" },
  { slug: "other", label: "Other" },
] as const;

export type ReferralSourceSlug = (typeof REFERRAL_SOURCES)[number]["slug"];

export const REFERRAL_SOURCE_SLUGS: readonly string[] = REFERRAL_SOURCES.map(
  (s) => s.slug
);

/**
 * Guard for anything arriving from a client. The API route persists
 * `companies.referral_method` only for values that pass this — a raw client
 * string must never reach the column.
 */
export function isReferralSourceSlug(value: unknown): value is ReferralSourceSlug {
  return typeof value === "string" && REFERRAL_SOURCE_SLUGS.includes(value);
}
