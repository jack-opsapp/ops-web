import { describe, expect, it } from "vitest";

import {
  buildSourceAttribution,
  deriveAttributionLookupCandidates,
  resolveAttributionDictionaryEntry,
} from "@/lib/external-api/intake/source-attribution";

const COMPANY_ID = "c4f852a5-3530-4b2f-b5fa-0a747d32e44a";
const SOURCE_ID = "d960d8d5-1b5f-41c4-9c64-521ae14ae77e";
const OLD_HANDLE = "attr_abcdefghijklmnopqrstuv";

const keyRing = {
  activeKid: 2,
  keys: new Map([
    [1, Buffer.alloc(32, 1)],
    [2, Buffer.alloc(32, 2)],
  ]),
};

describe("source-scoped attribution dictionary", () => {
  it("finds and rekeys an existing opaque handle through a historical key", () => {
    const oldRing = {
      activeKid: 1,
      keys: new Map([[1, Buffer.alloc(32, 1)]]),
    };
    const oldLookup = deriveAttributionLookupCandidates(
      {
        companyId: COMPANY_ID,
        sourceId: SOURCE_ID,
        dimension: "utm_source",
        rawValue: "  Google  ",
      },
      oldRing
    )[0];

    const resolved = resolveAttributionDictionaryEntry(
      {
        companyId: COMPANY_ID,
        sourceId: SOURCE_ID,
        dimension: "utm_source",
        rawValue: "google",
        existing: [
          {
            publicHandle: OLD_HANDLE,
            lookupKeyVersion: oldLookup.kid,
            lookupDigest: oldLookup.digest,
            approvedLabel: "Google",
            labelApproved: true,
          },
        ],
      },
      keyRing
    );

    expect(resolved).toMatchObject({
      publicHandle: OLD_HANDLE,
      created: false,
      matchedLookupKeyVersion: 1,
      activeLookup: {
        kid: 2,
      },
      approvedLabel: "Google",
      rekeyRequired: true,
    });
    expect(JSON.stringify(resolved)).not.toContain("google");
  });

  it("never exposes unapproved labels or raw lookup material", () => {
    const resolved = resolveAttributionDictionaryEntry(
      {
        companyId: COMPANY_ID,
        sourceId: SOURCE_ID,
        dimension: "campaign",
        rawValue: "private-campaign-id-42",
        existing: [],
      },
      keyRing,
      () => Buffer.alloc(18, 7)
    );

    expect(resolved.publicHandle).toMatch(/^cmp_[A-Za-z0-9_-]{24}$/);
    expect(resolved.approvedLabel).toBeNull();
    expect(resolved.created).toBe(true);
    expect(JSON.stringify(resolved)).not.toContain("private-campaign-id-42");
  });

  it("scopes identical raw values by company, source, and dimension", () => {
    const base = {
      companyId: COMPANY_ID,
      sourceId: SOURCE_ID,
      dimension: "utm_campaign" as const,
      rawValue: "spring-builds",
    };
    const digest = deriveAttributionLookupCandidates(base, keyRing)[0].digest;

    expect(
      deriveAttributionLookupCandidates(
        { ...base, sourceId: "3b7f8349-d153-4b03-80c3-405270c99a39" },
        keyRing
      )[0].digest
    ).not.toBe(digest);
    expect(
      deriveAttributionLookupCandidates(
        { ...base, dimension: "utm_content" },
        keyRing
      )[0].digest
    ).not.toBe(digest);
  });
});

describe("analytics-safe source attribution", () => {
  it("keeps only approved labels, opaque handles, allowlisted providers, and presence", () => {
    const projection = buildSourceAttribution({
      clickProviderCode: "google_ads",
      clickId: "raw-gclid-must-never-leave-private-evidence",
      campaign: {
        present: true,
        publicHandle: "cmp_abcdefghijklmnopqrstuv",
        approvedLabel: null,
      },
      utm: {
        source: {
          present: true,
          publicHandle: OLD_HANDLE,
          approvedLabel: "Google",
        },
      },
      landingPage: {
        host: "example.ca",
        publicHandle: "path_abcdefghijklmnopqrstuv",
        approvedLabel: "Deck builds",
      },
    });

    expect(projection.click).toEqual({
      providerCode: "google_ads",
      captured: true,
    });
    expect(projection.utm.source).toEqual({
      present: true,
      handle: OLD_HANDLE,
      label: "Google",
    });
    expect(projection.utm.medium).toEqual({
      present: false,
      handle: null,
      label: null,
    });
    expect(projection.landingPage).toEqual({
      host: "example.ca",
      pathHandle: "path_abcdefghijklmnopqrstuv",
      routeLabel: "Deck builds",
    });
    expect(JSON.stringify(projection)).not.toContain("gclid");
  });
});
