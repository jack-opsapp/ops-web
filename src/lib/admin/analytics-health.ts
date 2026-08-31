import { parseMeasurementId } from "@/lib/analytics/ga-config";
import {
  ANALYTICS_PROPERTY_REGISTRY,
  type AnalyticsPropertyKey,
} from "@/lib/analytics/property-registry";

export { ANALYTICS_PROPERTY_REGISTRY };
export type { AnalyticsPropertyKey };
export type AnalyticsHealthSource =
  | "ga_marketing"
  | "ga_web_app"
  | "ga_ios_app"
  | "search_console"
  | "app_store"
  | "web_product"
  | "attribution"
  | "business_truth"
  | "privacy";
export type AnalyticsHealthState =
  | "healthy"
  | "failed"
  | "expected_latency";
export type AnalyticsPropertyPermission =
  | "granted"
  | "denied"
  | "unavailable";

interface WarehouseSourceSnapshot {
  status: "complete" | "partial" | "failed" | "running" | "missing";
  finalizedThrough: string | null;
}

export interface AnalyticsHealthSnapshot {
  searchConsole: WarehouseSourceSnapshot;
  ga4Marketing: WarehouseSourceSnapshot;
  ga4WebApp: WarehouseSourceSnapshot;
  appStore: WarehouseSourceSnapshot & {
    commerceReportCount: number;
    downloadRowCount: number;
  };
  webProduct: {
    warehouseSessions: number;
    latestEventAt: string | null;
  };
  eventQuality: {
    schemaInvalidCount: number;
    duplicateEventIdCount: number;
    piiFindingCount: number;
  };
  attribution: {
    unknownCount: number;
    reasons: Array<{ reason: string; count: number }>;
  };
  reconciliation: {
    trialDelta: number;
    activationDelta: number;
    paidDelta: number;
    revenueCentsDelta: number;
  };
}

export interface AnalyticsHealthInput {
  now: Date;
  snapshot: AnalyticsHealthSnapshot;
  propertyPermissions: Record<
    AnalyticsPropertyKey,
    AnalyticsPropertyPermission
  >;
  environment: Record<string, string | undefined>;
}

export interface AnalyticsHealthCheck {
  key: string;
  state: AnalyticsHealthState | "not_applicable";
  observed: string | number | null;
  expected: string | number | null;
}

export interface AnalyticsSourceHealth {
  source: AnalyticsHealthSource;
  state: AnalyticsHealthState;
  checks: AnalyticsHealthCheck[];
}

export interface AnalyticsHealthEvaluation {
  overall: AnalyticsHealthState;
  checkedAt: string;
  sources: AnalyticsSourceHealth[];
  failedChecks: string[];
  notifySources: AnalyticsHealthSource[];
}

type ConfigurationReason =
  | "configured"
  | "missing_property_id"
  | "property_mismatch"
  | "missing_measurement_id"
  | "invalid_measurement_id"
  | "measurement_mismatch"
  | "public_measurement_mismatch";

interface PropertyConfiguration {
  valid: boolean;
  reason: ConfigurationReason;
}

const PROPERTY_ENVIRONMENT_KEYS: Record<AnalyticsPropertyKey, string> = {
  marketing: "GA4_MARKETING_PROPERTY_ID",
  web_app: "GA4_WEB_APP_PROPERTY_ID",
  ios_app: "GA4_IOS_PROPERTY_ID",
};

const MEASUREMENT_ENVIRONMENT_KEYS = {
  marketing: "GA4_MARKETING_MEASUREMENT_ID",
  web_app: "GA4_WEB_APP_MEASUREMENT_ID",
} as const;

const SOURCE_ORDER: AnalyticsHealthSource[] = [
  "ga_marketing",
  "ga_web_app",
  "ga_ios_app",
  "search_console",
  "app_store",
  "web_product",
  "attribution",
  "business_truth",
  "privacy",
];

function configurationFor(
  key: AnalyticsPropertyKey,
  environment: Record<string, string | undefined>
): PropertyConfiguration {
  const registry = ANALYTICS_PROPERTY_REGISTRY[key];
  const propertyValue = environment[PROPERTY_ENVIRONMENT_KEYS[key]];
  if (!propertyValue) return { valid: false, reason: "missing_property_id" };
  if (propertyValue !== registry.propertyId) {
    return { valid: false, reason: "property_mismatch" };
  }
  if (key === "ios_app") {
    return { valid: true, reason: "configured" };
  }

  const measurementKey = MEASUREMENT_ENVIRONMENT_KEYS[key];
  const rawMeasurement = environment[measurementKey];
  if (!rawMeasurement) {
    return { valid: false, reason: "missing_measurement_id" };
  }
  const measurement = parseMeasurementId(rawMeasurement);
  if (!measurement) {
    return { valid: false, reason: "invalid_measurement_id" };
  }
  if (measurement !== registry.measurementId) {
    return { valid: false, reason: "measurement_mismatch" };
  }
  if (
    key === "web_app" &&
    parseMeasurementId(environment.NEXT_PUBLIC_GA_MEASUREMENT_ID) !==
      registry.measurementId
  ) {
    return { valid: false, reason: "public_measurement_mismatch" };
  }
  return { valid: true, reason: "configured" };
}

export function resolveAnalyticsPropertyConfiguration(
  environment: Record<string, string | undefined>
): Record<AnalyticsPropertyKey, PropertyConfiguration> {
  return {
    marketing: configurationFor("marketing", environment),
    web_app: configurationFor("web_app", environment),
    ios_app: configurationFor("ios_app", environment),
  };
}

function addDays(value: Date, days: number): string {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function beforeFinalizationWindow(now: Date): boolean {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes < 10 * 60 + 15;
}

function check(
  key: string,
  passed: boolean,
  observed: AnalyticsHealthCheck["observed"],
  expected: AnalyticsHealthCheck["expected"]
): AnalyticsHealthCheck {
  return { key, state: passed ? "healthy" : "failed", observed, expected };
}

function freshnessCheck(input: {
  key: string;
  actual: string | null;
  expected: string;
  now: Date;
}): AnalyticsHealthCheck {
  const passed = input.actual !== null && input.actual >= input.expected;
  return {
    key: input.key,
    state: passed
      ? "healthy"
      : beforeFinalizationWindow(input.now)
        ? "expected_latency"
        : "failed",
    observed: input.actual,
    expected: input.expected,
  };
}

function syncStatusCheck(input: {
  key: string;
  status: WarehouseSourceSnapshot["status"];
  now: Date;
}): AnalyticsHealthCheck {
  return {
    key: input.key,
    state:
      input.status === "complete"
        ? "healthy"
        : (input.status === "running" || input.status === "partial") &&
            beforeFinalizationWindow(input.now)
          ? "expected_latency"
          : "failed",
    observed: input.status,
    expected: "complete",
  };
}

function sourceState(checks: AnalyticsHealthCheck[]): AnalyticsHealthState {
  if (checks.some((item) => item.state === "failed")) return "failed";
  if (checks.some((item) => item.state === "expected_latency")) {
    return "expected_latency";
  }
  return "healthy";
}

function source(
  sourceKey: AnalyticsHealthSource,
  checks: AnalyticsHealthCheck[]
): AnalyticsSourceHealth {
  return { source: sourceKey, state: sourceState(checks), checks };
}

function warehouseChecks(input: {
  source: AnalyticsHealthSource;
  snapshot: WarehouseSourceSnapshot;
  expectedDate: string;
  now: Date;
}): AnalyticsSourceHealth {
  return source(input.source, [
    syncStatusCheck({
      key: `${input.source}.sync_status`,
      status: input.snapshot.status,
      now: input.now,
    }),
    freshnessCheck({
      key: `${input.source}.finalized_through`,
      actual: input.snapshot.finalizedThrough,
      expected: input.expectedDate,
      now: input.now,
    }),
  ]);
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function zero(value: number): boolean {
  return Number.isFinite(value) && value === 0;
}

export function evaluateAnalyticsHealth(
  input: AnalyticsHealthInput
): AnalyticsHealthEvaluation {
  const configuration = resolveAnalyticsPropertyConfiguration(
    input.environment
  );
  const expectedD2 = addDays(input.now, -2);
  const expectedD3 = addDays(input.now, -3);

  const sources: AnalyticsSourceHealth[] = [
    source("ga_marketing", [
      check(
        "ga_marketing.property_configuration",
        configuration.marketing.valid,
        configuration.marketing.reason,
        "configured"
      ),
      check(
        "ga_marketing.property_permission",
        input.propertyPermissions.marketing === "granted",
        input.propertyPermissions.marketing,
        "granted"
      ),
      ...warehouseChecks({
        source: "ga_marketing",
        snapshot: input.snapshot.ga4Marketing,
        expectedDate: expectedD2,
        now: input.now,
      }).checks,
    ]),
    source("ga_web_app", [
      check(
        "ga_web_app.property_configuration",
        configuration.web_app.valid,
        configuration.web_app.reason,
        "configured"
      ),
      check(
        "ga_web_app.property_permission",
        input.propertyPermissions.web_app === "granted",
        input.propertyPermissions.web_app,
        "granted"
      ),
      ...warehouseChecks({
        source: "ga_web_app",
        snapshot: input.snapshot.ga4WebApp,
        expectedDate: expectedD2,
        now: input.now,
      }).checks,
    ]),
    source("ga_ios_app", [
      check(
        "ga_ios_app.property_configuration",
        configuration.ios_app.valid,
        configuration.ios_app.reason,
        "configured"
      ),
      check(
        "ga_ios_app.property_permission",
        input.propertyPermissions.ios_app === "granted",
        input.propertyPermissions.ios_app,
        "granted"
      ),
    ]),
    warehouseChecks({
      source: "search_console",
      snapshot: input.snapshot.searchConsole,
      expectedDate: expectedD3,
      now: input.now,
    }),
    source("app_store", [
      syncStatusCheck({
        key: "app_store.sync_status",
        status: input.snapshot.appStore.status,
        now: input.now,
      }),
      input.snapshot.appStore.commerceReportCount > 0
        ? freshnessCheck({
            key: "app_store.finalized_through",
            actual: input.snapshot.appStore.finalizedThrough,
            expected: expectedD2,
            now: input.now,
          })
        : {
            key: "app_store.finalized_through",
            state: "not_applicable",
            observed: null,
            expected: expectedD2,
          },
      check(
        "app_store.downloads_present",
        input.snapshot.appStore.commerceReportCount === 0 ||
          input.snapshot.appStore.downloadRowCount > 0,
        input.snapshot.appStore.downloadRowCount,
        input.snapshot.appStore.commerceReportCount > 0 ? 1 : 0
      ),
    ]),
    source("web_product", [
      input.snapshot.webProduct.warehouseSessions > 0
        ? freshnessCheck({
            key: "web_product.event_freshness",
            actual: input.snapshot.webProduct.latestEventAt?.slice(0, 10) ?? null,
            expected: expectedD2,
            now: input.now,
          })
        : {
            key: "web_product.event_freshness",
            state: "not_applicable",
            observed: input.snapshot.webProduct.latestEventAt,
            expected: expectedD2,
          },
    ]),
    source("attribution", [
      check(
        "attribution.unknown_count",
        nonNegativeInteger(input.snapshot.attribution.unknownCount),
        input.snapshot.attribution.unknownCount,
        0
      ),
      check(
        "attribution.unknown_reason_coverage",
        input.snapshot.attribution.reasons.every(
          (item) =>
            item.reason.trim().length > 0 &&
            item.reason !== "unexplained" &&
            nonNegativeInteger(item.count)
        ) &&
          input.snapshot.attribution.reasons.reduce(
            (total, item) => total + item.count,
            0
          ) === input.snapshot.attribution.unknownCount,
        input.snapshot.attribution.reasons.reduce(
          (total, item) => total + item.count,
          0
        ),
        input.snapshot.attribution.unknownCount
      ),
    ]),
    source("business_truth", [
      check(
        "business_truth.trial_delta",
        zero(input.snapshot.reconciliation.trialDelta),
        input.snapshot.reconciliation.trialDelta,
        0
      ),
      check(
        "business_truth.activation_delta",
        zero(input.snapshot.reconciliation.activationDelta),
        input.snapshot.reconciliation.activationDelta,
        0
      ),
      check(
        "business_truth.paid_delta",
        zero(input.snapshot.reconciliation.paidDelta),
        input.snapshot.reconciliation.paidDelta,
        0
      ),
      check(
        "business_truth.revenue_delta",
        zero(input.snapshot.reconciliation.revenueCentsDelta),
        input.snapshot.reconciliation.revenueCentsDelta,
        0
      ),
    ]),
    source("privacy", [
      check(
        "privacy.schema_invalid_events",
        zero(input.snapshot.eventQuality.schemaInvalidCount),
        input.snapshot.eventQuality.schemaInvalidCount,
        0
      ),
      check(
        "privacy.duplicate_event_ids",
        zero(input.snapshot.eventQuality.duplicateEventIdCount),
        input.snapshot.eventQuality.duplicateEventIdCount,
        0
      ),
      check(
        "privacy.pii_findings",
        zero(input.snapshot.eventQuality.piiFindingCount),
        input.snapshot.eventQuality.piiFindingCount,
        0
      ),
    ]),
  ].sort(
    (left, right) =>
      SOURCE_ORDER.indexOf(left.source) - SOURCE_ORDER.indexOf(right.source)
  );

  const failedChecks = sources.flatMap((item) =>
    item.checks
      .filter((healthCheck) => healthCheck.state === "failed")
      .map((healthCheck) => healthCheck.key)
  );
  const notifySources = sources
    .filter((item) => item.state === "failed")
    .map((item) => item.source);
  const overall = sources.some((item) => item.state === "failed")
    ? "failed"
    : sources.some((item) => item.state === "expected_latency")
      ? "expected_latency"
      : "healthy";

  return {
    overall,
    checkedAt: input.now.toISOString(),
    sources,
    failedChecks,
    notifySources,
  };
}
