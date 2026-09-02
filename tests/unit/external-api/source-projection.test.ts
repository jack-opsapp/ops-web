import { describe, expect, it } from "vitest";

import { buildExternalLeadSourceProjection } from "@/lib/external-api/analytics/source-projection";

const timing = {
  inquiryReceivedAt: "2026-07-27T10:14:38.123Z",
  leadCreatedAt: "2026-07-27T10:15:02.456Z",
  attributionCapturedAt: "2026-07-27T10:14:38.123Z",
  inquiryTimeQuality: "exact" as const,
};

describe("external lead source projection", () => {
  it("projects authenticated website configuration and opaque attribution only", () => {
    const projection = buildExternalLeadSourceProjection({
      opportunitySource: "website",
      timing,
      externalIntake: {
        sourceId: "src_AAAAAAAAAAAAAAAAAAAAAA",
        sourceLabel: "Main website",
        siteHost: "example.com",
        siteLabel: "Main website",
        formId: "frm_BBBBBBBBBBBBBBBBBBBBBB",
        formLabel: "Quote request",
        sourceChannel: "website",
        campaign: {
          present: true,
          handle: "cmp_CCCCCCCCCCCCCCCCCCCCCC",
          label: null,
        },
        utm: {
          source: {
            present: true,
            handle: "attr_DDDDDDDDDDDDDDDDDDDDDD",
            label: null,
          },
        },
        click: { providerCode: "google_ads", captured: true },
        landingPage: {
          host: "example.com",
          pathHandle: "path_EEEEEEEEEEEEEEEEEEEEEE",
          routeLabel: null,
        },
        referrer: null,
      },
    });

    expect(projection).toMatchObject({
      sourceChannel: "website",
      sourceIntegrationType: "external_intake",
      sourceId: "src_AAAAAAAAAAAAAAAAAAAAAA",
      formId: "frm_BBBBBBBBBBBBBBBBBBBBBB",
      siteHost: "example.com",
      timingSource: "authenticated_request",
      timingQuality: "exact",
      inquiryReceivedAt: "2026-07-27T10:14:00.000Z",
      leadCreatedAt: "2026-07-27T10:15:00.000Z",
      completeness: {
        authenticatedSite: true,
        configuredForm: true,
        campaignObserved: true,
        utmSetObserved: true,
        landingPageObserved: true,
        referrerObserved: false,
      },
    });

    const serialized = JSON.stringify(projection);
    for (const rawValue of [
      "spring-sale",
      "/quote?gclid=secret",
      "gclid-secret",
      "google / cpc",
    ]) {
      expect(serialized).not.toContain(rawValue);
    }
  });

  it.each([
    ["email", "email", "email_import"],
    ["referral", "referral", "referral"],
    ["phone", "phone", "phone"],
    ["walk_in", "walk_in", "walk_in"],
    ["social_media", "social", "social"],
    ["repeat_client", "repeat_business", "repeat_business"],
    ["voice_log", "manual", "manual"],
    [null, "other", "other"],
    ["unexpected_legacy_value", "other", "other"],
  ] as const)(
    "maps %s evidence without inventing source details",
    (opportunitySource, sourceChannel, sourceIntegrationType) => {
      const projection = buildExternalLeadSourceProjection({
        opportunitySource,
        timing: { ...timing, inquiryTimeQuality: "fallback" },
      });

      expect(projection).toMatchObject({
        sourceChannel,
        sourceIntegrationType,
        sourceId: null,
        sourceLabel: null,
        siteHost: null,
        formId: null,
        campaign: { present: false, handle: null, label: null },
        timingSource: "creation_fallback",
        timingQuality: "fallback",
        completeness: {
          authenticatedSite: false,
          configuredForm: false,
          campaignObserved: false,
          utmSetObserved: false,
          landingPageObserved: false,
          referrerObserved: false,
        },
      });
    }
  );

  it("keeps historical website evidence unauthenticated and unknown", () => {
    const projection = buildExternalLeadSourceProjection({
      opportunitySource: "website",
      timing: { ...timing, inquiryTimeQuality: "provider" },
    });

    expect(projection).toMatchObject({
      sourceChannel: "website",
      sourceIntegrationType: "other",
      sourceId: null,
      siteHost: null,
      formId: null,
      timingSource: "provider_message",
      timingQuality: "provider_derived",
      completeness: {
        channelKnown: true,
        authenticatedSite: false,
        configuredForm: false,
      },
    });
  });
});
