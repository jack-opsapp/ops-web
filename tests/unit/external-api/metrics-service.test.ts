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
  authorizationEpoch: 3,
  digestVersion: 1,
  credentialDigest:
    "\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  visiblePrefix: "opsx_1_abcdefghijkl",
};

const context = {
  high_water_sequence: "12",
  data_through: "2026-07-27T12:00:00.000Z",
  from: "2026-06-28T07:00:00.000Z",
  to: "2026-07-28T07:00:00.000Z",
  from_local_date: "2026-06-28",
  to_local_date: "2026-07-28",
  timezone: "America/Vancouver",
  currency: "CAD",
};

const metricsResult = {
  from: context.from,
  to: context.to,
  timezone: context.timezone,
  generatedAt: "2026-07-27T12:00:01.000Z",
  dataThrough: context.data_through,
  metricDefinitionVersion: "1",
  currency: null,
  includedMetricIds: ["leads_received"] as const,
  results: [
    {
      metricId: "leads_received" as const,
      definitionVersion: "1",
      basis: "received_cohort" as const,
      population:
        "Canonical non-merged leads received in the half-open interval",
      value: 8,
      unit: "count" as const,
      numerator: 8,
      denominator: null,
      includedCount: 8,
      missingEvidenceCount: 0,
      grouping: null,
      currency: null,
      suppressed: false,
      cohortCount: 8,
      evidenceCoveragePercent: 100,
    },
  ],
};

describe("external lead metrics service", () => {
  it("revalidates authorization before returning a private cache hit", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: context,
      error: null,
    });
    const cache = {
      get: vi.fn().mockResolvedValue({
        outcome: "hit" as const,
        value: metricsResult,
      }),
      set: vi.fn(),
    };

    const result = await getExternalLeadMetrics(
      {
        actor,
        auditRequestId: "44444444-4444-4444-8444-444444444444",
        requestReceivedAt: "2026-07-27T12:00:00.000Z",
        query: {
          preset: "30d",
          metricIds: ["leads_received"],
          definitionVersion: "1",
          groupBy: [],
        },
      },
      { client: { rpc }, cache, now: () => new Date("2026-07-27T12:00:01Z") }
    );

    expect(result.cacheResult).toBe("hit");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "authorize_external_lead_metrics_as_system",
      expect.objectContaining({
        p_company_id: actor.companyId,
        p_definition_version: "1",
        p_preset: "30d",
      })
    );
  });

  it("rejects unsupported versions and missing additive financial scope safely", async () => {
    await expect(
      getExternalLeadMetrics({
        actor,
        auditRequestId: "55555555-5555-4555-8555-555555555555",
        requestReceivedAt: "2026-07-27T12:00:00.000Z",
        query: {
          preset: "30d",
          metricIds: ["leads_received"],
          definitionVersion: "2",
          groupBy: [],
        },
      })
    ).rejects.toMatchObject({ code: "definition_version_unsupported" });

    await expect(
      getExternalLeadMetrics({
        actor,
        auditRequestId: "66666666-6666-4666-8666-666666666666",
        requestReceivedAt: "2026-07-27T12:00:00.000Z",
        query: {
          preset: "30d",
          metricIds: ["invoiced_event_total"],
          definitionVersion: "1",
          groupBy: [],
        },
      })
    ).rejects.toMatchObject({ code: "insufficient_scope" });
  });

  it("requires date-only custom boundaries for DATE-based financial metrics", async () => {
    await expect(
      getExternalLeadMetrics({
        actor: {
          ...actor,
          scopes: ["analytics.leads.read", "analytics.financial.read"],
        },
        auditRequestId: "77777777-7777-4777-8777-777777777777",
        requestReceivedAt: "2026-07-27T12:00:00.000Z",
        query: {
          preset: "custom",
          from: "2026-07-01T07:30:00.000Z",
          to: "2026-07-08T07:00:00.000Z",
          metricIds: ["paid_event_total"],
          definitionVersion: "1",
          groupBy: [],
        },
      })
    ).rejects.toMatchObject({ code: "date_alignment_required" });
  });

  it("calculates once after authorization and caches by the exact high-water", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: context, error: null })
      .mockResolvedValueOnce({ data: metricsResult, error: null });
    const cache = {
      get: vi.fn().mockResolvedValue({ outcome: "miss" as const, value: null }),
      set: vi.fn().mockResolvedValue(true),
    };

    const result = await getExternalLeadMetrics(
      {
        actor,
        auditRequestId: "88888888-8888-4888-8888-888888888888",
        requestReceivedAt: "2026-07-27T12:00:00.000Z",
        query: {
          preset: "30d",
          metricIds: ["leads_received"],
          definitionVersion: "1",
          groupBy: [],
        },
      },
      { client: { rpc }, cache, now: () => new Date("2026-07-27T12:00:01Z") }
    );

    expect(result.result).toEqual(metricsResult);
    expect(rpc.mock.calls[1]).toEqual([
      "read_external_lead_metrics_v1_as_system",
      expect.objectContaining({
        p_high_water_sequence: "12",
        p_from: context.from,
        p_to: context.to,
        p_metric_ids: ["leads_received"],
      }),
    ]);
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^ops:external:v1:private:/),
      metricsResult,
      60
    );
  });
});
