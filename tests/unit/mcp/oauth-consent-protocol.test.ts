import { describe, expect, it } from "vitest";

import {
  buildConsentDecisionBody,
  parseConsentContext,
} from "@/app/oauth/authorize/_components/consent-protocol";

const CONTEXT = {
  clientName: "Claude",
  companyName: "MAVERICK PROJECTS LTD",
  scopes: [
    {
      scope: "ops.jobs.read",
      label: "See your jobs and their status",
    },
  ],
  consentCatalogRevision: "2026-08-22.mcp-consent-catalog.v1",
  exposureRevision: "2026-08-22.mcp-exposure.v1",
  consentPreview: "ops_mcp_cp_dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  expiresAt: "2026-08-23T07:05:00.000Z",
} as const;

describe("OAuth consent browser protocol", () => {
  it("accepts only a context carrying the exact visible consent revisions", () => {
    expect(parseConsentContext(CONTEXT)).toEqual(CONTEXT);

    for (const malformed of [
      { ...CONTEXT, consentCatalogRevision: undefined },
      { ...CONTEXT, consentCatalogRevision: "" },
      { ...CONTEXT, exposureRevision: undefined },
      { ...CONTEXT, exposureRevision: "" },
      { ...CONTEXT, consentPreview: undefined },
      { ...CONTEXT, consentPreview: "ops_mcp_cp_short" },
      { ...CONTEXT, expiresAt: undefined },
      { ...CONTEXT, expiresAt: "not-an-instant" },
    ]) {
      expect(parseConsentContext(malformed)).toBeNull();
    }
  });

  it("returns only the decision and opaque one-time preview", () => {
    expect(buildConsentDecisionBody("approve", CONTEXT)).toEqual({
      decision: "approve",
      consent_preview: CONTEXT.consentPreview,
    });
  });
});
