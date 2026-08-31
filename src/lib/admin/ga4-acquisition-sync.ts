import type { AttributionChannel } from "@/lib/pmf/types";
import { templateAnalyticsPathname } from "@/lib/analytics/event-sanitizer";
import {
  fetchGA4AcquisitionDate,
  fetchGA4ConversionQA,
  numericPropertyId,
  type GA4ReportRow,
} from "@/lib/analytics/ga4-acquisition-client";
import {
  AnalyticsSyncStore,
  type LatestSyncState,
  type StoredChannelMapRule,
} from "./analytics-sync-store";
import {
  addDays,
  pacificDate,
  subtractMonths,
} from "./search-console-sync";

const BACKFILL_DAYS_PER_RUN = 14;
const PROPERTY_KEYS = ["marketing", "web_app"] as const;

export type ChannelMapRule = StoredChannelMapRule;
export type GA4AcquisitionPropertyKey = (typeof PROPERTY_KEYS)[number];

export interface GA4DailyAcquisitionFact {
  property_key: GA4AcquisitionPropertyKey;
  property_id: string;
  reporting_date: string;
  default_channel_group: string;
  source: string;
  medium: string;
  campaign: string;
  landing_path: string;
  sessions: number;
  engaged_sessions: number;
  new_users: number;
  total_users: number;
  key_events: number;
  source_updated_at: string;
  updated_at: string;
}

export interface GA4SyncPlan {
  dates: string[];
  latestFinalizedDate: string;
  nextCursor: string | null;
  backfillComplete: boolean;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function classifyGA4Channel(
  rules: ChannelMapRule[],
  input: Pick<
    GA4DailyAcquisitionFact,
    "default_channel_group" | "source" | "medium"
  >
): AttributionChannel {
  const channel = normalize(input.default_channel_group);
  const source = normalize(input.source);
  const medium = normalize(input.medium);
  const match = [...rules]
    .sort((left, right) => left.priority - right.priority)
    .find((rule) => {
      const ruleChannel = normalize(rule.raw_channel);
      const ruleSource = normalize(rule.raw_source);
      const ruleMedium = normalize(rule.raw_medium);
      return (
        (!ruleChannel || ruleChannel === channel) &&
        (!ruleSource || source === ruleSource || source.includes(ruleSource)) &&
        (!ruleMedium || ruleMedium === medium)
      );
    });
  const canonical = match?.canonical_channel ?? "unknown";
  const allowed: Set<string> = new Set([
    "google_ads",
    "meta_ads",
    "apple_search_ads",
    "organic_search",
    "organic_social",
    "app_store_search",
    "app_store_browse",
    "direct",
    "referral",
    "other",
    "unknown",
  ]);
  return allowed.has(canonical) ? (canonical as AttributionChannel) : "unknown";
}

export function planGA4Sync(input: {
  today: string;
  latestState: LatestSyncState | null;
  backfillStartDate?: string;
  backfillDaysPerRun?: number;
}): GA4SyncPlan {
  const latestFinalizedDate = addDays(input.today, -2);
  const trailing = Array.from({ length: 7 }, (_, index) =>
    addDays(input.today, -8 + index)
  );
  const alreadyComplete = input.latestState?.metadata.backfill_complete === true;
  const start =
    input.latestState?.cursor ??
    input.backfillStartDate ??
    subtractMonths(latestFinalizedDate, 14);
  const backfill: string[] = [];
  let cursor = start;
  if (!alreadyComplete) {
    const limit = input.backfillDaysPerRun ?? BACKFILL_DAYS_PER_RUN;
    while (cursor <= latestFinalizedDate && backfill.length < limit) {
      backfill.push(cursor);
      cursor = addDays(cursor, 1);
    }
  }
  const backfillComplete = alreadyComplete || cursor > latestFinalizedDate;
  return {
    dates: [...new Set([...backfill, ...trailing])].sort(),
    latestFinalizedDate,
    nextCursor: backfillComplete ? null : cursor,
    backfillComplete,
  };
}

function parseApiDate(value: string | undefined): string {
  if (!value || !/^\d{8}$/.test(value)) throw new Error("GA4 row date was invalid");
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function dimension(row: GA4ReportRow, index: number): string {
  return row.dimensionValues?.[index]?.value ?? "(not set)";
}

function metric(row: GA4ReportRow, index: number): number {
  const value = Number(row.metricValues?.[index]?.value ?? 0);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("GA4 row metric was invalid");
  }
  return Math.round(value);
}

function sanitizeLandingPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "(not set)") return "/(not-set)";
  let path = trimmed;
  try {
    if (/^https?:\/\//i.test(trimmed)) path = new URL(trimmed).pathname;
  } catch {
    return "/(invalid)";
  }
  path = path.split(/[?#]/, 1)[0] || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  return templateAnalyticsPathname(path).slice(0, 2_048);
}

export function toGA4AcquisitionFact(
  row: GA4ReportRow,
  propertyKey: GA4AcquisitionPropertyKey,
  propertyId: string,
  reportingDate: string,
  nowIso: string
): GA4DailyAcquisitionFact {
  const rowDate = parseApiDate(dimension(row, 0));
  if (rowDate !== reportingDate) throw new Error("GA4 row date did not match request");
  return {
    property_key: propertyKey,
    property_id: propertyId,
    reporting_date: reportingDate,
    default_channel_group: dimension(row, 1),
    source: dimension(row, 2),
    medium: dimension(row, 3),
    campaign: dimension(row, 4),
    landing_path: sanitizeLandingPath(dimension(row, 5)),
    sessions: metric(row, 0),
    engaged_sessions: metric(row, 1),
    new_users: metric(row, 2),
    total_users: metric(row, 3),
    key_events: metric(row, 4),
    source_updated_at: nowIso,
    updated_at: nowIso,
  };
}

export function aggregateGA4AcquisitionFacts(
  facts: GA4DailyAcquisitionFact[]
): GA4DailyAcquisitionFact[] {
  const grouped = new Map<string, GA4DailyAcquisitionFact>();
  for (const fact of facts) {
    const key = JSON.stringify([
      fact.property_key,
      fact.property_id,
      fact.reporting_date,
      fact.default_channel_group,
      fact.source,
      fact.medium,
      fact.campaign,
      fact.landing_path,
    ]);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...fact });
      continue;
    }
    current.sessions += fact.sessions;
    current.engaged_sessions += fact.engaged_sessions;
    current.new_users += fact.new_users;
    current.total_users += fact.total_users;
    current.key_events += fact.key_events;
  }
  return [...grouped.values()];
}

function metricRows(
  facts: GA4DailyAcquisitionFact[],
  rules: ChannelMapRule[],
  nowIso: string
): Record<string, unknown>[] {
  const metricFields = [
    ["sessions", "sessions"],
    ["engaged_sessions", "engaged_sessions"],
    ["new_users", "new_users"],
    ["total_users", "total_users"],
    ["key_events", "key_events"],
  ] as const;
  return facts.flatMap((fact) => {
    const sourceKey = [
      "ga4",
      fact.property_key,
      fact.default_channel_group,
      fact.source,
      fact.medium,
      fact.campaign,
      fact.landing_path,
    ].join(":");
    const dimensions = {
      property_key: fact.property_key,
      property_id: fact.property_id,
      default_channel_group: fact.default_channel_group,
      source: fact.source,
      medium: fact.medium,
      landing_path: fact.landing_path,
    };
    return metricFields.map(([metricType, field]) => ({
      metric_date: fact.reporting_date,
      canonical_channel: classifyGA4Channel(rules, fact),
      sub_channel: fact.source,
      campaign: fact.campaign,
      territory: null,
      metric_type: metricType,
      metric_value: fact[field],
      currency: null,
      source_system: "ga4",
      source_grain: "property_date_channel_source_medium_campaign_landing",
      source_key: sourceKey,
      dimensions,
      as_of: nowIso,
      updated_at: nowIso,
    }));
  });
}

async function syncProperty(input: {
  store: AnalyticsSyncStore;
  propertyKey: GA4AcquisitionPropertyKey;
  propertyId: string;
  today: string;
  nowIso: string;
  channelRules: ChannelMapRule[];
  fetchDate: typeof fetchGA4AcquisitionDate;
  signal?: AbortSignal;
}): Promise<{
  propertyKey: GA4AcquisitionPropertyKey;
  dates: string[];
  rowCount: number;
  finalizedThrough: string;
}> {
  const source = input.propertyKey === "marketing" ? "ga4_marketing" : "ga4_web_app";
  // Open the durable run record before the cursor read and the plan, so a
  // state-read failure is recorded against this property instead of vanishing
  // into the route's 500 (bug 6d61591c's defect class, GA4 side).
  const runId = await input.store.begin(source, {
    phase: "preflight",
    property_key: input.propertyKey,
    property_id: input.propertyId,
  });
  let rowCount = 0;
  try {
    const latestState = await input.store.latest(source);
    const plan = planGA4Sync({ today: input.today, latestState });
    await input.store.annotate(runId, {
      property_key: input.propertyKey,
      property_id: input.propertyId,
      requested_dates: plan.dates,
    });
    for (const reportingDate of plan.dates) {
      if (input.signal?.aborted) throw new Error("GA4 sync lease lost");
      const rows = await input.fetchDate(input.propertyKey, reportingDate);
      const facts = aggregateGA4AcquisitionFacts(
        rows.map((row) =>
          toGA4AcquisitionFact(
            row,
            input.propertyKey,
            input.propertyId,
            reportingDate,
            input.nowIso
          )
        )
      );
      rowCount += await input.store.replaceGA4Date({
        propertyKey: input.propertyKey,
        propertyId: input.propertyId,
        reportingDate,
        rows: facts as unknown as Record<string, unknown>[],
        metrics: metricRows(facts, input.channelRules, input.nowIso),
      });
    }
    await input.store.complete(runId, {
      sourceMaxDate: plan.latestFinalizedDate,
      rowCount,
      cursor: plan.nextCursor,
      metadata: {
        property_key: input.propertyKey,
        property_id: input.propertyId,
        dates: plan.dates,
        backfill_complete: plan.backfillComplete,
      },
    });
    return {
      propertyKey: input.propertyKey,
      dates: plan.dates,
      rowCount,
      finalizedThrough: plan.latestFinalizedDate,
    };
  } catch (error) {
    await input.store.fail(runId, error);
    throw error;
  }
}

async function syncIOSConversionQA(input: {
  store: AnalyticsSyncStore;
  today: string;
  propertyId: string;
  fetchConversionQA: typeof fetchGA4ConversionQA;
}): Promise<void> {
  const startDate = addDays(input.today, -8);
  const endDate = addDays(input.today, -2);
  const runId = await input.store.begin("ga4_ios_qa", {
    property_key: "ios_app",
    property_id: input.propertyId,
    start_date: startDate,
    end_date: endDate,
  });
  try {
    const rows = await input.fetchConversionQA(startDate, endDate);
    const conversionCounts: Record<string, number> = {};
    for (const row of rows) {
      const eventName = dimension(row, 1);
      conversionCounts[eventName] =
        (conversionCounts[eventName] ?? 0) + metric(row, 0);
    }
    await input.store.complete(runId, {
      sourceMaxDate: endDate,
      rowCount: rows.length,
      cursor: null,
      metadata: {
        property_key: "ios_app",
        property_id: input.propertyId,
        conversion_counts: conversionCounts,
        product_truth: false,
      },
    });
  } catch (error) {
    await input.store.fail(runId, error);
    throw error;
  }
}

export async function runGA4AcquisitionSync(options: {
  store?: AnalyticsSyncStore;
  now?: Date;
  propertyIds?: Record<"marketing" | "web_app" | "ios_app", string>;
  channelRules?: ChannelMapRule[];
  fetchDate?: typeof fetchGA4AcquisitionDate;
  fetchConversionQA?: typeof fetchGA4ConversionQA;
  signal?: AbortSignal;
} = {}): Promise<{
  properties: Array<Awaited<ReturnType<typeof syncProperty>>>;
}> {
  const store = options.store ?? new AnalyticsSyncStore();
  const now = options.now ?? new Date();
  const today = pacificDate(now);
  // Property-id resolution and the channel map are both fallible and both run
  // before any per-source run record could exist. Recording a failed run for
  // every source keeps a preflight throw diagnosable in analytics_sync_runs
  // rather than only in the route's 500 (bug 6d61591c).
  let propertyIds: Record<"marketing" | "web_app" | "ios_app", string>;
  let channelRules: ChannelMapRule[];
  try {
    propertyIds = options.propertyIds ?? {
      marketing: numericPropertyId("marketing"),
      web_app: numericPropertyId("web_app"),
      ios_app: numericPropertyId("ios_app"),
    };
    channelRules = options.channelRules ?? (await store.channelMap("ga4"));
  } catch (preflightError) {
    // Best-effort per-source failure records; a bookkeeping write failure must
    // never mask the preflight error itself.
    for (const source of ["ga4_marketing", "ga4_web_app", "ga4_ios_qa"] as const) {
      try {
        const runId = await store.begin(source, { phase: "preflight" });
        await store.fail(runId, preflightError);
      } catch (recordError) {
        console.error(
          `[ga4-acquisition-sync] failed to record ${source} preflight failure:`,
          recordError
        );
      }
    }
    throw preflightError;
  }
  const results: Array<Awaited<ReturnType<typeof syncProperty>>> = [];
  const failures: unknown[] = [];

  for (const propertyKey of PROPERTY_KEYS) {
    try {
      results.push(
        await syncProperty({
          store,
          propertyKey,
          propertyId: propertyIds[propertyKey],
          today,
          nowIso: now.toISOString(),
          channelRules,
          fetchDate: options.fetchDate ?? fetchGA4AcquisitionDate,
          signal: options.signal,
        })
      );
    } catch (error) {
      failures.push(error);
    }
  }

  try {
    await syncIOSConversionQA({
      store,
      today,
      propertyId: propertyIds.ios_app,
      fetchConversionQA: options.fetchConversionQA ?? fetchGA4ConversionQA,
    });
  } catch (error) {
    failures.push(error);
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "One or more GA4 properties failed to sync");
  }
  return { properties: results };
}
