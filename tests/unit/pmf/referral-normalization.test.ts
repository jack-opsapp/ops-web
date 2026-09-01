import { describe, expect, it } from "vitest";
import { normalizeSelfReportedReferral } from "@/lib/admin/referral-normalization";

describe("normalizeSelfReportedReferral", () => {
  it.each([
    ["instagram", "organic_social"],
    ["facebook", "organic_social"],
    ["youtube", "organic_social"],
    ["google", "organic_search"],
    ["app_store", "app_store_browse"],
    ["word_of_mouth", "referral"],
    ["other", "other"],
  ] as const)("maps stable slug %s to %s", (raw, channel) => {
    expect(normalizeSelfReportedReferral(raw)).toMatchObject({
      rawSource: raw,
      normalizedSlug: raw,
      channel,
      isLegacy: false,
      reason: "stable_slug",
    });
  });

  it.each([
    ["Instagram", "instagram", "organic_social"],
    ["Word of Mouth (Onsite)", "word_of_mouth", "referral"],
    ["Other", "other", "other"],
  ] as const)(
    "normalizes legacy value %s at read time",
    (raw, normalizedSlug, channel) => {
      expect(normalizeSelfReportedReferral(raw)).toMatchObject({
        rawSource: raw,
        normalizedSlug,
        channel,
        isLegacy: true,
        reason: "legacy_label",
      });
    }
  );

  it("keeps ambiguous Internet Advertisement raw without inventing a slug", () => {
    expect(normalizeSelfReportedReferral("Internet Advertisement")).toEqual({
      rawSource: "Internet Advertisement",
      normalizedSlug: null,
      channel: null,
      isLegacy: true,
      confidence: null,
      reason: "legacy_ambiguous",
    });
  });

  it.each([null, undefined, "", "   "])(
    "keeps a blank or skipped answer explicit",
    (raw) => {
      expect(normalizeSelfReportedReferral(raw)).toEqual({
        rawSource: null,
        normalizedSlug: null,
        channel: null,
        isLegacy: false,
        confidence: null,
        reason: "blank",
      });
    }
  );
});
