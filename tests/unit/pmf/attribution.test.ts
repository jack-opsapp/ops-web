import { describe, it, expect } from "vitest";
import {
  classifyAttribution,
  deriveAttributionChannel,
} from "@/lib/pmf/attribution";

describe("deriveAttributionChannel", () => {
  it("google_ads when gclid present", () => {
    expect(deriveAttributionChannel({ gclid: "abc" })).toBe("google_ads");
  });
  it("google_ads when utm_source contains google", () => {
    expect(deriveAttributionChannel({ utm_source: "google_cpc" })).toBe(
      "google_ads"
    );
  });
  it("meta_ads when fbclid present", () => {
    expect(deriveAttributionChannel({ fbclid: "xyz" })).toBe("meta_ads");
  });
  it("meta_ads when utm_source facebook", () => {
    expect(deriveAttributionChannel({ utm_source: "facebook" })).toBe(
      "meta_ads"
    );
  });
  it("apple_search_ads on explicit match", () => {
    expect(deriveAttributionChannel({ utm_source: "apple_search_ads" })).toBe(
      "apple_search_ads"
    );
  });
  it("organic_search when medium=organic", () => {
    expect(deriveAttributionChannel({ utm_medium: "organic" })).toBe(
      "organic_search"
    );
  });
  it("keeps Google organic traffic out of the paid Google channel", () => {
    expect(
      deriveAttributionChannel({
        utm_source: "google",
        utm_medium: "organic",
      })
    ).toBe("organic_search");
  });
  it("classifies an organic social UTM separately from paid Meta", () => {
    expect(
      deriveAttributionChannel({
        utm_source: "instagram",
        utm_medium: "organic",
      })
    ).toBe("organic_social");
  });
  it("direct when nothing set", () => {
    expect(deriveAttributionChannel({})).toBe("direct");
  });
  it("gclid takes precedence over ambiguous utm_source", () => {
    expect(
      deriveAttributionChannel({ gclid: "abc", utm_source: "newsletter" })
    ).toBe("google_ads");
  });

  it.each([
    "google.com",
    "www.google.ca",
    "bing.com",
    "duckduckgo.com",
    "search.yahoo.com",
  ])("classifies %s as organic search", (referrer_domain) => {
    expect(deriveAttributionChannel({ referrer_domain })).toBe(
      "organic_search"
    );
  });

  it("classifies a non-search external referrer as referral", () => {
    expect(deriveAttributionChannel({ referrer_domain: "tradeforum.ca" })).toBe(
      "referral"
    );
  });

  it.each(["opsapp.co", "app.opsapp.co", "try.opsapp.co"])(
    "never classifies internal OPS domain %s as a referral",
    (referrer_domain) => {
      expect(deriveAttributionChannel({ referrer_domain })).toBe("direct");
    }
  );

  it("returns explicit basis, confidence, and reason for a direct touch", () => {
    expect(classifyAttribution({ landing_path: "/" })).toEqual({
      channel: "direct",
      basis: "direct",
      confidence: 1,
      reason: "no_campaign_or_external_referrer",
    });
  });

  it("marks click-id attribution as verified evidence", () => {
    expect(classifyAttribution({ gclid: "abc" })).toMatchObject({
      channel: "google_ads",
      basis: "verified_click_id",
      confidence: 1,
      reason: "gclid_present",
    });
  });
});
