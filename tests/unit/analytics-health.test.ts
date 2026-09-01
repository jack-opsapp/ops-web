import { describe, expect, it } from "vitest";
import {
  ANALYTICS_PROPERTY_REGISTRY,
  evaluateAnalyticsHealth,
  resolveAnalyticsPropertyConfiguration,
  type AnalyticsHealthInput,
  type AnalyticsHealthSnapshot,
} from "@/lib/admin/analytics-health";

const NOW = new Date("2026-08-30T10:24:00.000Z");

const HEALTHY_SNAPSHOT: AnalyticsHealthSnapshot = {
  searchConsole: { status: "complete", finalizedThrough: "2026-08-27" },
  ga4Marketing: { status: "complete", finalizedThrough: "2026-08-28" },
  ga4WebApp: { status: "complete", finalizedThrough: "2026-08-28" },
  appStore: {
    status: "complete",
    finalizedThrough: "2026-08-28",
    commerceReportCount: 1,
    downloadRowCount: 8,
  },
  webProduct: {
    warehouseSessions: 12,
    latestEventAt: "2026-08-29T18:00:00.000Z",
  },
  eventQuality: {
    schemaInvalidCount: 0,
    duplicateEventIdCount: 0,
    piiFindingCount: 0,
  },
  attribution: {
    unknownCount: 3,
    reasons: [{ reason: "no_source_evidence", count: 3 }],
  },
  reconciliation: {
    trialDelta: 0,
    activationDelta: 0,
    paidDelta: 0,
    revenueCentsDelta: 0,
  },
};

const HEALTHY_INPUT: AnalyticsHealthInput = {
  now: NOW,
  snapshot: HEALTHY_SNAPSHOT,
  propertyPermissions: {
    marketing: "granted",
    web_app: "granted",
    ios_app: "granted",
  },
  environment: {
    GA4_MARKETING_PROPERTY_ID: "475051117",
    GA4_WEB_APP_PROPERTY_ID: "539494652",
    GA4_IOS_PROPERTY_ID: "514229717",
    GA4_MARKETING_MEASUREMENT_ID: "G-HKM7RWVTDV",
    GA4_WEB_APP_MEASUREMENT_ID: "G-JJP5SN122V",
    NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-JJP5SN122V",
  },
};

function evaluate(
  patch: Partial<AnalyticsHealthInput> = {},
  snapshotPatch: Partial<AnalyticsHealthSnapshot> = {}
) {
  return evaluateAnalyticsHealth({
    ...HEALTHY_INPUT,
    ...patch,
    snapshot: { ...HEALTHY_SNAPSHOT, ...snapshotPatch },
  });
}

describe("analytics property registry", () => {
  it("binds every source to the verified property identity", () => {
    expect(ANALYTICS_PROPERTY_REGISTRY).toEqual({
      marketing: {
        propertyId: "475051117",
        measurementId: "G-HKM7RWVTDV",
      },
      web_app: {
        propertyId: "539494652",
        measurementId: "G-JJP5SN122V",
      },
      ios_app: { propertyId: "514229717", measurementId: null },
    });
  });

  it("rejects valid-looking IDs when they are mapped to the wrong property", () => {
    const configuration = resolveAnalyticsPropertyConfiguration({
      ...HEALTHY_INPUT.environment,
      GA4_MARKETING_MEASUREMENT_ID: "G-JJP5SN122V",
    });
    expect(configuration.marketing).toEqual(
      expect.objectContaining({ valid: false, reason: "measurement_mismatch" })
    );
  });

  it("accepts canonical measurement IDs after environment whitespace is trimmed", () => {
    const configuration = resolveAnalyticsPropertyConfiguration({
      ...HEALTHY_INPUT.environment,
      GA4_MARKETING_MEASUREMENT_ID: "  G-HKM7RWVTDV\n",
      GA4_WEB_APP_MEASUREMENT_ID: "G-JJP5SN122V\n",
      NEXT_PUBLIC_GA_MEASUREMENT_ID: " G-JJP5SN122V ",
    });

    expect(configuration.marketing.valid).toBe(true);
    expect(configuration.web_app.valid).toBe(true);
  });
});

describe("analytics health evaluation", () => {
  it("keeps every independent source healthy when all contracts hold", () => {
    const result = evaluate();
    expect(result.overall).toBe("healthy");
    expect(result.sources.every((source) => source.state === "healthy")).toBe(
      true
    );
  });

  it("fails each inaccessible GA property without converting it to zero", () => {
    const result = evaluate({
      propertyPermissions: {
        marketing: "denied",
        web_app: "granted",
        ios_app: "granted",
      },
    });
    expect(
      result.sources.find((source) => source.source === "ga_marketing")
    ).toEqual(expect.objectContaining({ state: "failed" }));
    expect(result.failedChecks).toContain("ga_marketing.property_permission");
  });

  it("treats the source-finalization window as expected latency, not failure", () => {
    const result = evaluate(
      { now: new Date("2026-08-30T09:30:00.000Z") },
      {
        searchConsole: {
          status: "complete",
          finalizedThrough: "2026-08-26",
        },
      }
    );
    expect(
      result.sources.find((source) => source.source === "search_console")
    ).toEqual(expect.objectContaining({ state: "expected_latency" }));
    expect(result.notifySources).toEqual([]);
  });

  it("treats an in-progress source walk as expected latency before cutoff", () => {
    const result = evaluate(
      { now: new Date("2026-08-30T09:30:00.000Z") },
      {
        ga4WebApp: {
          status: "running",
          finalizedThrough: "2026-08-27",
        },
        appStore: {
          status: "running",
          finalizedThrough: "2026-08-27",
          commerceReportCount: 1,
          downloadRowCount: 8,
        },
      }
    );

    expect(
      result.sources.find((source) => source.source === "ga_web_app")
    ).toEqual(expect.objectContaining({ state: "expected_latency" }));
    expect(
      result.sources.find((source) => source.source === "app_store")
    ).toEqual(expect.objectContaining({ state: "expected_latency" }));
    expect(result.notifySources).toEqual([]);
  });

  it("fails stale sources after their expected availability window", () => {
    const result = evaluate({}, {
      searchConsole: { status: "complete", finalizedThrough: "2026-08-26" },
      ga4Marketing: { status: "complete", finalizedThrough: "2026-08-27" },
    });
    expect(result.failedChecks).toEqual(
      expect.arrayContaining([
        "search_console.finalized_through",
        "ga_marketing.finalized_through",
      ])
    );
  });

  it("fails when Apple exposes no commerce report or its download warehouse is empty", () => {
    const failed = evaluate({}, {
      appStore: {
        status: "complete",
        finalizedThrough: null,
        commerceReportCount: 1,
        downloadRowCount: 0,
      },
    });
    expect(failed.failedChecks).toContain("app_store.downloads_present");

    const missingCommerce = evaluate({}, {
      appStore: {
        status: "complete",
        finalizedThrough: null,
        commerceReportCount: 0,
        downloadRowCount: 0,
      },
    });
    expect(missingCommerce.failedChecks).toContain(
      "app_store.commerce_report_present"
    );
  });

  it("requires fresh product events only when the web property has sessions", () => {
    const failed = evaluate({}, {
      webProduct: {
        warehouseSessions: 2,
        latestEventAt: "2026-08-20T00:00:00.000Z",
      },
    });
    expect(failed.failedChecks).toContain("web_product.event_freshness");

    const idle = evaluate({}, {
      webProduct: { warehouseSessions: 0, latestEventAt: null },
    });
    expect(idle.failedChecks).not.toContain("web_product.event_freshness");
  });

  it("fails invalid, duplicate, and PII-bearing product events", () => {
    const result = evaluate({}, {
      eventQuality: {
        schemaInvalidCount: 2,
        duplicateEventIdCount: 1,
        piiFindingCount: 4,
      },
    });
    expect(result.failedChecks).toEqual(
      expect.arrayContaining([
        "privacy.schema_invalid_events",
        "privacy.duplicate_event_ids",
        "privacy.pii_findings",
      ])
    );
  });

  it("requires every unknown attribution to carry an explicit reason", () => {
    const result = evaluate({}, {
      attribution: {
        unknownCount: 3,
        reasons: [{ reason: "no_source_evidence", count: 2 }],
      },
    });
    expect(result.failedChecks).toContain("attribution.unknown_reason_coverage");
  });

  it("fails any non-zero business-source reconciliation delta", () => {
    const result = evaluate({}, {
      reconciliation: {
        trialDelta: 1,
        activationDelta: 0,
        paidDelta: -1,
        revenueCentsDelta: 25,
      },
    });
    expect(result.failedChecks).toEqual(
      expect.arrayContaining([
        "business_truth.trial_delta",
        "business_truth.paid_delta",
        "business_truth.revenue_delta",
      ])
    );
  });
});
