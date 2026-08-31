import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getGA4Client } from "@/lib/analytics/ga4-client";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { AnalyticsSyncStore } from "./analytics-sync-store";
import {
  ANALYTICS_PROPERTY_REGISTRY,
  evaluateAnalyticsHealth,
  type AnalyticsHealthEvaluation,
  type AnalyticsHealthSnapshot,
  type AnalyticsPropertyKey,
  type AnalyticsPropertyPermission,
} from "./analytics-health";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KEYS = ["marketing", "web_app", "ios_app"] as const;

type RawObject = Record<string, unknown>;

function object(value: unknown, label: string): RawObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Analytics health snapshot ${label} was invalid`);
  }
  return value as RawObject;
}

function status(value: unknown):
  | "complete"
  | "partial"
  | "failed"
  | "running"
  | "missing" {
  if (
    value === "complete" ||
    value === "partial" ||
    value === "failed" ||
    value === "running" ||
    value === "missing"
  ) {
    return value;
  }
  throw new Error("Analytics health snapshot status was invalid");
}

function date(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Analytics health snapshot date was invalid");
  }
  return value;
}

function timestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("Analytics health snapshot timestamp was invalid");
  }
  return value;
}

function integer(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Analytics health snapshot ${label} was invalid`);
  }
  return parsed;
}

function sourceSnapshot(value: unknown) {
  const source = object(value, "source");
  return {
    status: status(source.status),
    finalizedThrough: date(source.finalized_through),
  };
}

export function parseAnalyticsHealthSnapshot(
  value: unknown
): AnalyticsHealthSnapshot {
  const root = object(value, "root");
  const appStore = object(root.app_store, "app_store");
  const webProduct = object(root.web_product, "web_product");
  const eventQuality = object(root.event_quality, "event_quality");
  const attribution = object(root.attribution, "attribution");
  const reconciliation = object(root.reconciliation, "reconciliation");
  if (!Array.isArray(attribution.reasons)) {
    throw new Error("Analytics health snapshot attribution reasons were invalid");
  }

  return {
    searchConsole: sourceSnapshot(root.search_console),
    ga4Marketing: sourceSnapshot(root.ga4_marketing),
    ga4WebApp: sourceSnapshot(root.ga4_web_app),
    appStore: {
      ...sourceSnapshot(appStore),
      commerceReportCount: integer(
        appStore.commerce_report_count,
        "commerce report count"
      ),
      downloadRowCount: integer(
        appStore.download_row_count,
        "download row count"
      ),
    },
    webProduct: {
      warehouseSessions: integer(
        webProduct.warehouse_sessions,
        "web sessions"
      ),
      latestEventAt: timestamp(webProduct.latest_event_at),
    },
    eventQuality: {
      schemaInvalidCount: integer(
        eventQuality.schema_invalid_count,
        "invalid event count"
      ),
      duplicateEventIdCount: integer(
        eventQuality.duplicate_event_id_count,
        "duplicate event count"
      ),
      piiFindingCount: integer(
        eventQuality.pii_finding_count,
        "PII finding count"
      ),
    },
    attribution: {
      unknownCount: integer(attribution.unknown_count, "unknown attribution"),
      reasons: attribution.reasons.map((rawReason) => {
        const reason = object(rawReason, "attribution reason");
        if (typeof reason.reason !== "string") {
          throw new Error("Analytics health attribution reason was invalid");
        }
        return {
          reason: reason.reason,
          count: integer(reason.count, "attribution reason count"),
        };
      }),
    },
    reconciliation: {
      trialDelta: integer(reconciliation.trial_delta, "trial delta"),
      activationDelta: integer(
        reconciliation.activation_delta,
        "activation delta"
      ),
      paidDelta: integer(reconciliation.paid_delta, "paid delta"),
      revenueCentsDelta: integer(
        reconciliation.revenue_cents_delta,
        "revenue delta"
      ),
    },
  };
}

async function propertyPermissions(): Promise<
  Record<AnalyticsPropertyKey, AnalyticsPropertyPermission>
> {
  const client = getGA4Client();
  const entries = await Promise.all(
    SOURCE_KEYS.map(async (key) => {
      try {
        await client.runReport({
          property: `properties/${ANALYTICS_PROPERTY_REGISTRY[key].propertyId}`,
          dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }],
          metrics: [{ name: "activeUsers" }],
          limit: 1,
        });
        return [key, "granted"] as const;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const permission: AnalyticsPropertyPermission =
          /permission|denied|forbidden|403/i.test(message)
            ? "denied"
            : "unavailable";
        return [key, permission] as const;
      }
    })
  );
  return Object.fromEntries(entries) as Record<
    AnalyticsPropertyKey,
    AnalyticsPropertyPermission
  >;
}

function alertIdentity(environment: NodeJS.ProcessEnv): {
  userId: string;
  companyId: string;
} {
  const userId = environment.OPS_PLATFORM_ALERT_USER_ID?.trim() ?? "";
  const companyId = environment.OPS_PLATFORM_ALERT_COMPANY_ID?.trim() ?? "";
  if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(companyId)) {
    throw new Error("OPS analytics alert identity is not configured");
  }
  return { userId, companyId };
}

async function snapshot(client: SupabaseClient): Promise<AnalyticsHealthSnapshot> {
  const { data, error } = await client.rpc(
    "get_growth_analytics_health_snapshot"
  );
  if (error) throw new Error(`Analytics health snapshot failed: ${error.message}`);
  return parseAnalyticsHealthSnapshot(data);
}

async function persistEvaluation(
  client: SupabaseClient,
  evaluation: AnalyticsHealthEvaluation,
  identity: { userId: string; companyId: string }
): Promise<unknown[]> {
  const transitions: unknown[] = [];
  for (const source of evaluation.sources) {
    const { data, error } = await client.rpc("apply_analytics_health_source", {
      p_source: source.source,
      p_state: source.state,
      p_details: {
        checked_at: evaluation.checkedAt,
        state: source.state,
        checks: source.checks.map((item) => ({
          key: item.key,
          state: item.state,
          observed: item.observed,
          expected: item.expected,
        })),
      },
      p_user_id: identity.userId,
      p_company_id: identity.companyId,
    });
    if (error) {
      throw new Error(
        `Analytics health transition failed for ${source.source}: ${error.message}`
      );
    }
    transitions.push(data);
  }
  return transitions;
}

export async function runAnalyticsHealth(options: {
  client?: SupabaseClient;
  now?: Date;
  environment?: NodeJS.ProcessEnv;
} = {}): Promise<{
  evaluation: AnalyticsHealthEvaluation;
  transitions: unknown[];
}> {
  const client = options.client ?? getAdminSupabase();
  const now = options.now ?? new Date();
  const environment = options.environment ?? process.env;
  const identity = alertIdentity(environment);
  const store = new AnalyticsSyncStore(client);
  const runId = await store.begin("analytics_health", {
    checked_at: now.toISOString(),
  });

  try {
    const [healthSnapshot, permissions] = await Promise.all([
      snapshot(client),
      propertyPermissions(),
    ]);
    const evaluation = evaluateAnalyticsHealth({
      now,
      snapshot: healthSnapshot,
      propertyPermissions: permissions,
      environment,
    });
    const transitions = await persistEvaluation(client, evaluation, identity);
    await store.complete(runId, {
      sourceMaxDate: now.toISOString().slice(0, 10),
      rowCount: evaluation.sources.length,
      cursor: null,
      metadata: {
        overall: evaluation.overall,
        failed_checks: evaluation.failedChecks,
        expected_latency_sources: evaluation.sources
          .filter((source) => source.state === "expected_latency")
          .map((source) => source.source),
      },
    });
    return { evaluation, transitions };
  } catch (error) {
    await store.fail(runId, error);
    throw error;
  }
}
