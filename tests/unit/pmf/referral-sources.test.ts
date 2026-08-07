/**
 * Unit tests for src/lib/data/referral-sources.ts
 *
 * The slug vocabulary is shared verbatim with iOS. If it drifts, the two
 * platforms' answers stop aggregating and the acquisition signal is quietly
 * split in two — so the exact slug set is pinned here.
 */

import { describe, it, expect } from "vitest";
import {
  REFERRAL_SOURCES,
  REFERRAL_SOURCE_SLUGS,
  isReferralSourceSlug,
} from "@/lib/data/referral-sources";

describe("REFERRAL_SOURCES", () => {
  it("pins the exact slug vocabulary shared with iOS", () => {
    expect(REFERRAL_SOURCE_SLUGS).toEqual([
      "instagram",
      "facebook",
      "youtube",
      "google",
      "app_store",
      "word_of_mouth",
      "other",
    ]);
  });

  it("has unique slugs", () => {
    expect(new Set(REFERRAL_SOURCE_SLUGS).size).toBe(REFERRAL_SOURCE_SLUGS.length);
  });

  it("gives every option a non-empty label", () => {
    for (const src of REFERRAL_SOURCES) {
      expect(src.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses lower_snake_case slugs so they are stable storage keys", () => {
    for (const slug of REFERRAL_SOURCE_SLUGS) {
      expect(slug).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});

describe("isReferralSourceSlug", () => {
  it("accepts every known slug", () => {
    for (const slug of REFERRAL_SOURCE_SLUGS) {
      expect(isReferralSourceSlug(slug)).toBe(true);
    }
  });

  it("rejects labels — only slugs are storable", () => {
    expect(isReferralSourceSlug("Instagram")).toBe(false);
    expect(isReferralSourceSlug("Someone told me")).toBe(false);
  });

  it("rejects legacy free-text values so they cannot be re-introduced", () => {
    expect(isReferralSourceSlug("Word of Mouth (Onsite)")).toBe(false);
    expect(isReferralSourceSlug("Internet Advertisement")).toBe(false);
  });

  it("rejects empty, null, and non-string input", () => {
    expect(isReferralSourceSlug("")).toBe(false);
    expect(isReferralSourceSlug(null)).toBe(false);
    expect(isReferralSourceSlug(undefined)).toBe(false);
    expect(isReferralSourceSlug(42)).toBe(false);
    expect(isReferralSourceSlug({ slug: "google" })).toBe(false);
  });
});
