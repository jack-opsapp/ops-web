import { describe, expect, it, vi } from "vitest";

import { getExternalLeadMetrics } from "@/lib/external-api/analytics/metrics-service";
import type { ExternalApiRequestActor } from "@/lib/external-api/auth/credential-auth";

const actor: ExternalApiRequestActor = {
  principalId: "11111111-1111-4111-8111-111111111111",
  credentialId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  credentialClass: "analytics",
  scopes: ["analytics.leads.read"],
  allowedSourceIds: [],
  authorizationEpoch: 7,
  digestVersion: 1,
  credentialDigest:
    "\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  visiblePrefix: "opsx_1_abcdefghijkl",
};

describe("external API revocation before cache", () => {
  it("never reads the private analytics cache when live authorization is denied", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "external_analytics_credential_invalid" },
    });
    const cache = {
      get: vi.fn(),
      set: vi.fn(),
    };

    await expect(
      getExternalLeadMetrics(
        {
          actor,
          auditRequestId: "44444444-4444-4444-8444-444444444444",
          requestReceivedAt: "2026-07-27T18:00:00.000Z",
          query: {
            preset: "30d",
            metricIds: ["leads_received"],
            definitionVersion: "1",
            groupBy: [],
          },
        },
        { client: { rpc }, cache }
      )
    ).rejects.toMatchObject({ code: "invalid_credentials" });

    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });
});
