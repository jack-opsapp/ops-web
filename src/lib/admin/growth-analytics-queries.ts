import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import type { AttributionChannel } from "@/lib/pmf/types";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  growthMilestoneComparisonPeriods,
  summarizeGrowthMilestones,
} from "./growth-milestones";
import {
  EMPTY_COVERAGE,
  type GrowthAppStoreReport,
  type GrowthChannelPerformanceRow,
  type GrowthCoverage,
  type GrowthDataState,
  type GrowthOverview,
  type GrowthResponseEnvelope,
  type GrowthSearchReport,
  type GrowthSource,
  type GrowthSourceLane,
  type GrowthSourceStatus,
  type GrowthTrendPoint,
} from "./growth-analytics-types";

const ALLOWED_CHANNELS = new Set<AttributionChannel>([
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

export interface GrowthQueryFilters {
  startDate: string;
  endDate: string;
  channel: AttributionChannel | "all" | "auto";
}

type RawRow = Record<string, unknown>;

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Growth date must use YYYY-MM-DD");
  }
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Growth date was invalid");
  }
  return parsed;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

export function defaultGrowthFilters(now = new Date()): GrowthQueryFilters {
  const endDate = now.toISOString().slice(0, 10);
  return { startDate: addDays(endDate, -29), endDate, channel: "auto" };
}

export function parseGrowthFilters(
  searchParams: URLSearchParams,
  now = new Date()
): GrowthQueryFilters {
  const defaults = defaultGrowthFilters(now);
  const startDate = searchParams.get("from") ?? defaults.startDate;
  const endDate = searchParams.get("to") ?? defaults.endDate;
  const requestedChannel = searchParams.get("channel") ?? "auto";
  const channel =
    requestedChannel === "all" || requestedChannel === "auto"
      ? requestedChannel
      : ALLOWED_CHANNELS.has(requestedChannel as AttributionChannel)
        ? (requestedChannel as AttributionChannel)
        : null;
  if (!channel) throw new Error("Growth channel was invalid");
  growthMilestoneComparisonPeriods({ startDate, endDate });
  return { startDate, endDate, channel };
}

export function growthAnalyticsCacheKey(
  report: string,
  filters: GrowthQueryFilters
): string[] {
  return [
    "growth-analytics",
    report,
    filters.startDate,
    filters.endDate,
    filters.channel,
  ];
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function integer(value: unknown): number {
  return Math.round(number(value));
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function comparison(current: number, previous: number) {
  return {
    current,
    previous,
    delta: current - previous,
    changeRatio: previous > 0 ? (current - previous) / previous : null,
  };
}

function sum(rows: RawRow[], field: string): number {
  return rows.reduce((total, row) => total + number(row[field]), 0);
}

function sourceFailure(
  source: GrowthSource,
  detail: string,
  state: GrowthDataState = "failed"
): GrowthSourceStatus {
  return {
    source,
    state,
    asOf: null,
    finalizedThrough: null,
    coverage: EMPTY_COVERAGE,
    detail,
  };
}

function envelopeState(sources: GrowthSourceStatus[]): GrowthDataState {
  if (sources.some((source) => source.state === "failed")) return "failed";
  if (sources.some((source) => source.state === "missing")) return "missing";
  if (sources.some((source) => source.state === "stale")) return "stale";
  if (sources.some((source) => source.state === "partial")) return "partial";
  if (sources.some((source) => source.state === "provisional")) {
    return "provisional";
  }
  if (sources.every((source) => source.state === "empty")) return "empty";
  return "ready";
}

function oldestFinalized(sources: GrowthSourceStatus[]): string | null {
  const dates = sources
    .map((source) => source.finalizedThrough)
    .filter((value): value is string => Boolean(value))
    .sort();
  return dates[0] ?? null;
}

function asEnvelope<T>(input: {
  data: T | null;
  sources: GrowthSourceStatus[];
  coverage?: GrowthCoverage;
  now: Date;
}): GrowthResponseEnvelope<T> {
  return {
    data: input.data,
    state: envelopeState(input.sources),
    asOf: input.now.toISOString(),
    finalizedThrough: oldestFinalized(input.sources),
    coverage: input.coverage ?? EMPTY_COVERAGE,
    sources: input.sources,
  };
}

async function queryRows(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  operation: string
): Promise<RawRow[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${operation}: ${error.message}`);
  return Array.isArray(data) ? (data as RawRow[]) : [];
}

async function attributionCoverage(
  client: SupabaseClient,
  filters: GrowthQueryFilters
): Promise<GrowthCoverage> {
  const rows = await queryRows(
    client
      .from("growth_attribution_coverage")
      .select("total_trials, unknown_trials")
      .gte("reporting_date", filters.startDate)
      .lte("reporting_date", filters.endDate),
    "Growth attribution coverage"
  );
  const total = sum(rows, "total_trials");
  const unknown = sum(rows, "unknown_trials");
  const observed = Math.max(0, total - unknown);
  return {
    observed,
    total,
    ratio: ratio(observed, total),
    label: total > 0 ? "Known trial attribution" : "No trials in period",
  };
}

export function resolveGrowthChannel(
  requested: GrowthQueryFilters["channel"],
  coverage: GrowthCoverage
): AttributionChannel | "all" {
  if (requested !== "auto") return requested;
  return (coverage.ratio ?? 0) >= 0.8 ? "organic_search" : "all";
}

async function funnelRows(
  client: SupabaseClient,
  filters: GrowthQueryFilters,
  channel: AttributionChannel | "all"
): Promise<RawRow[]> {
  const periods = growthMilestoneComparisonPeriods(filters);
  if (channel === "all") {
    return queryRows(
      client
        .from("growth_funnel_daily")
        .select(
          "reporting_date, trials_started, classified_trials, first_project_companies, first_value_companies, paid_companies, revenue_cents"
        )
        .gte("reporting_date", periods.previous.startDate)
        .lte("reporting_date", periods.current.endDate)
        .order("reporting_date", { ascending: true }),
      "Growth funnel"
    );
  }
  return queryRows(
    client
      .from("growth_channel_performance")
      .select(
        "reporting_date, trials_started, first_project_companies, first_value_companies, paid_companies, revenue_cents"
      )
      .eq("canonical_channel", channel)
      .gte("reporting_date", periods.previous.startDate)
      .lte("reporting_date", periods.current.endDate)
      .order("reporting_date", { ascending: true }),
    "Growth channel funnel"
  );
}

function summarizeRows(rows: RawRow[]) {
  return summarizeGrowthMilestones(
    rows.map((row) => ({
      ...row,
      classified_trials: row.classified_trials ?? row.trials_started,
    }))
  );
}

function rowsInPeriod(
  rows: RawRow[],
  period: { startDate: string; endDate: string }
): RawRow[] {
  return rows.filter((row) => {
    const date = String(row.reporting_date ?? "");
    return date >= period.startDate && date <= period.endDate;
  });
}

async function channelPerformance(
  client: SupabaseClient,
  filters: GrowthQueryFilters
): Promise<GrowthChannelPerformanceRow[]> {
  const [businessRows, metricRows] = await Promise.all([
    queryRows(
      client
        .from("growth_channel_performance")
        .select(
          "canonical_channel, attribution_basis, trials_started, first_value_companies, paid_companies, revenue_cents"
        )
        .gte("reporting_date", filters.startDate)
        .lte("reporting_date", filters.endDate),
      "Growth channel performance"
    ),
    queryRows(
      client
        .from("channel_metrics")
        .select("canonical_channel, metric_type, metric_value")
        .gte("metric_date", filters.startDate)
        .lte("metric_date", filters.endDate),
      "Growth discovery metrics"
    ),
  ]);
  const channels = new Map<string, GrowthChannelPerformanceRow>();
  for (const row of businessRows) {
    const channel = String(row.canonical_channel) as AttributionChannel;
    const existing = channels.get(channel) ?? {
      channel,
      discovery: null,
      discoveryLabel: "Discovery unavailable",
      trials: 0,
      firstValue: 0,
      paid: 0,
      activationRate: null,
      revenueCents: 0,
      confidence: "unknown" as const,
    };
    existing.trials += integer(row.trials_started);
    existing.firstValue += integer(row.first_value_companies);
    existing.paid += integer(row.paid_companies);
    existing.revenueCents += integer(row.revenue_cents);
    const basis = String(row.attribution_basis ?? "unknown");
    existing.confidence = basis === "verified_click_id"
      ? "verified"
      : basis === "deterministic_first_party" || basis === "utm_referrer" || basis === "app_store"
        ? "deterministic"
        : basis === "self_reported"
          ? "reported"
          : basis === "direct"
            ? "direct"
            : existing.confidence;
    channels.set(channel, existing);
  }
  const discoveryPriority = ["sessions", "search_clicks", "first_time_downloads"];
  for (const [channel, value] of channels) {
    const matching = metricRows.filter(
      (row) => String(row.canonical_channel) === channel
    );
    const selectedType = discoveryPriority.find((metricType) =>
      matching.some((row) => String(row.metric_type) === metricType)
    );
    if (selectedType) {
      value.discovery = sum(
        matching.filter((row) => String(row.metric_type) === selectedType),
        "metric_value"
      );
      value.discoveryLabel = selectedType.replaceAll("_", " ");
    }
    value.activationRate = ratio(value.firstValue, value.trials);
  }
  return [...channels.values()].sort((left, right) =>
    right.firstValue - left.firstValue || right.trials - left.trials
  );
}

async function searchData(
  client: SupabaseClient,
  filters: GrowthQueryFilters
): Promise<GrowthSearchReport> {
  const [searchRows, gaRows] = await Promise.all([
    queryRows(
      client
        .from("search_console_daily")
        .select("query, page, clicks, impressions, position")
        .gte("reporting_date", filters.startDate)
        .lte("reporting_date", filters.endDate)
        .limit(100000),
      "Search Console facts"
    ),
    queryRows(
      client
        .from("ga4_daily_acquisition")
        .select("landing_path, sessions")
        .eq("property_key", "marketing")
        .eq("default_channel_group", "Organic Search")
        .gte("reporting_date", filters.startDate)
        .lte("reporting_date", filters.endDate)
        .limit(100000),
      "GA4 organic sessions"
    ),
  ]);
  const sessionsByPath = new Map<string, number>();
  for (const row of gaRows) {
    const path = String(row.landing_path ?? "/");
    sessionsByPath.set(path, (sessionsByPath.get(path) ?? 0) + integer(row.sessions));
  }
  const aggregate = (dimension: "page" | "query") => {
    const grouped = new Map<string, RawRow>();
    for (const row of searchRows) {
      const key = String(row[dimension] ?? "");
      const current = grouped.get(key) ?? {
        label: key || "—",
        page: dimension === "page" ? key : null,
        query: dimension === "query" ? key : null,
        clicks: 0,
        impressions: 0,
        weightedPosition: 0,
      };
      current.clicks = number(current.clicks) + integer(row.clicks);
      current.impressions = number(current.impressions) + integer(row.impressions);
      current.weightedPosition =
        number(current.weightedPosition) + number(row.position) * integer(row.impressions);
      grouped.set(key, current);
    }
    return [...grouped.values()]
      .map((row) => {
        const impressions = integer(row.impressions);
        const page = typeof row.page === "string" ? row.page : null;
        let path: string | null = null;
        if (page) {
          try { path = new URL(page).pathname; } catch { path = null; }
        }
        return {
          label: String(row.label),
          page,
          query: typeof row.query === "string" ? row.query : null,
          clicks: integer(row.clicks),
          impressions,
          ctr: ratio(integer(row.clicks), impressions),
          position: impressions > 0 ? number(row.weightedPosition) / impressions : null,
          sessions: path ? sessionsByPath.get(path) ?? 0 : null,
        };
      })
      .sort((left, right) => right.clicks - left.clicks || right.impressions - left.impressions)
      .slice(0, 50);
  };
  const impressions = sum(searchRows, "impressions");
  const clicks = sum(searchRows, "clicks");
  return {
    totals: {
      impressions,
      clicks,
      ctr: ratio(clicks, impressions),
      sessions: gaRows.length > 0 ? sum(gaRows, "sessions") : null,
    },
    pages: aggregate("page"),
    queries: aggregate("query"),
  };
}

async function appStoreData(
  client: SupabaseClient,
  filters: GrowthQueryFilters
): Promise<GrowthAppStoreReport> {
  const [conversionRows, pageViewRows] = await Promise.all([
    queryRows(
      client
        .from("asc_conversion_daily")
        .select("reporting_date, unique_impressions, total_downloads")
        .gte("reporting_date", filters.startDate)
        .lte("reporting_date", filters.endDate)
        .limit(100000),
      "App Store conversion facts"
    ),
    queryRows(
      client
        .from("asc_discovery_engagement")
        .select("reporting_date, counts")
        .ilike("engagement_type", "%page view%")
        .gte("reporting_date", filters.startDate)
        .lte("reporting_date", filters.endDate)
        .limit(100000),
      "App Store page-view facts"
    ),
  ]);
  const byDate = new Map<string, { date: string; impressions: number; productPageViews: number; firstTimeDownloads: number }>();
  for (const row of conversionRows) {
    const date = String(row.reporting_date);
    const current = byDate.get(date) ?? { date, impressions: 0, productPageViews: 0, firstTimeDownloads: 0 };
    current.impressions += integer(row.unique_impressions);
    current.firstTimeDownloads += integer(row.total_downloads);
    byDate.set(date, current);
  }
  for (const row of pageViewRows) {
    const date = String(row.reporting_date);
    const current = byDate.get(date) ?? { date, impressions: 0, productPageViews: 0, firstTimeDownloads: 0 };
    current.productPageViews += integer(row.counts);
    byDate.set(date, current);
  }
  const series = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const impressions = series.reduce((total, row) => total + row.impressions, 0);
  const firstTimeDownloads = series.reduce((total, row) => total + row.firstTimeDownloads, 0);
  return {
    totals: {
      impressions,
      productPageViews: series.reduce((total, row) => total + row.productPageViews, 0),
      firstTimeDownloads,
      conversionRate: ratio(firstTimeDownloads, impressions),
    },
    series,
    paidSplitState: "unavailable",
  };
}

async function latestSyncStatus(
  client: SupabaseClient,
  now: Date
): Promise<GrowthSourceStatus[]> {
  const expected: Array<{ source: GrowthSource; runSource: string; lag: number }> = [
    { source: "search_console", runSource: "search_console", lag: 3 },
    { source: "ga4_marketing", runSource: "ga4_marketing", lag: 2 },
    { source: "ga4_web_app", runSource: "ga4_web_app", lag: 2 },
    { source: "ga4_ios_qa", runSource: "ga4_ios_qa", lag: 2 },
  ];
  const rows = await queryRows(
    client
      .from("growth_data_health")
      .select("source, status, started_at, finished_at, source_max_date, row_count, error_message, metadata"),
    "Growth data health"
  );
  const statuses = expected.map(({ source, runSource, lag }) => {
    const row = rows.find((value) => String(value.source) === runSource);
    if (!row) return sourceFailure(source, "No completed source run", "missing");
    const finalized = typeof row.source_max_date === "string" ? row.source_max_date : null;
    const expectedDate = addDays(now.toISOString().slice(0, 10), -lag);
    const runStatus = String(row.status);
    const state: GrowthDataState = runStatus === "failed"
      ? "failed"
      : !finalized
        ? "partial"
        : finalized < expectedDate
          ? "stale"
          : "ready";
    return {
      source,
      state,
      asOf: typeof row.finished_at === "string" ? row.finished_at : null,
      finalizedThrough: finalized,
      coverage: {
        observed: integer(row.row_count),
        total: null,
        ratio: null,
        label: "Rows in latest run",
      },
      detail: state === "ready" ? "Source current" : String(row.error_message ?? "Source not current"),
    };
  });
  const { data: ascData, error: ascError } = await client
    .from("asc_sync_status")
    .select("status, last_synced_date, last_run_at, error")
    .eq("job_name", "app-store-sync")
    .maybeSingle();
  if (ascError) {
    statuses.push(sourceFailure("app_store", ascError.message));
  } else if (!ascData) {
    statuses.push(sourceFailure("app_store", "No App Store sync run", "missing"));
  } else {
    const finalized = typeof ascData.last_synced_date === "string" ? ascData.last_synced_date : null;
    const expectedDate = addDays(now.toISOString().slice(0, 10), -2);
    const state: GrowthDataState = ascData.status === "failed"
      ? "failed"
      : !finalized
        ? "provisional"
        : finalized < expectedDate
          ? "stale"
          : "ready";
    statuses.push({
      source: "app_store",
      state,
      asOf: ascData.last_run_at,
      finalizedThrough: finalized,
      coverage: EMPTY_COVERAGE,
      detail: state === "ready" ? "Source current" : ascData.error ?? "Source not current",
    });
  }
  return statuses;
}

export async function getGrowthHealth(
  options: { client?: SupabaseClient; now?: Date } = {}
): Promise<GrowthResponseEnvelope<{ statuses: GrowthSourceStatus[] }>> {
  const client = options.client ?? getAdminSupabase();
  const now = options.now ?? new Date();
  try {
    const statuses = await latestSyncStatus(client, now);
    const { error, count } = await client
      .from("growth_company_milestones")
      .select("company_id", { count: "exact", head: true });
    statuses.unshift(
      error
        ? sourceFailure("business_records", error.message)
        : {
            source: "business_records",
            state: (count ?? 0) > 0 ? "ready" : "empty",
            asOf: now.toISOString(),
            finalizedThrough: now.toISOString().slice(0, 10),
            coverage: { observed: count ?? 0, total: count ?? 0, ratio: 1, label: "Trial companies" },
            detail: (count ?? 0) > 0 ? "Business records available" : "No trial companies",
          }
    );
    return asEnvelope({ data: { statuses }, sources: statuses, now });
  } catch (error) {
    const status = sourceFailure("business_records", error instanceof Error ? error.message : String(error));
    return asEnvelope<{ statuses: GrowthSourceStatus[] }>({
      data: null,
      sources: [status],
      now,
    });
  }
}

export async function getGrowthSearchReport(
  filters: GrowthQueryFilters,
  options: { client?: SupabaseClient; now?: Date } = {}
): Promise<GrowthResponseEnvelope<GrowthSearchReport>> {
  const client = options.client ?? getAdminSupabase();
  const now = options.now ?? new Date();
  try {
    const [data, health] = await Promise.all([
      searchData(client, filters),
      latestSyncStatus(client, now),
    ]);
    const sources = health.filter((source) =>
      source.source === "search_console" || source.source === "ga4_marketing"
    );
    return asEnvelope<GrowthSearchReport>({
      data,
      sources: data.pages.length === 0 && sources.every((source) => source.state === "ready")
        ? sources.map((source) => ({ ...source, state: "empty" as const }))
        : sources,
      coverage: {
        observed: data.pages.length,
        total: null,
        ratio: null,
        label: "Visible search rows; privacy-suppressed queries excluded",
      },
      now,
    });
  } catch (error) {
    return asEnvelope<GrowthSearchReport>({
      data: null,
      sources: [sourceFailure("search_console", error instanceof Error ? error.message : String(error))],
      now,
    });
  }
}

export async function getGrowthAppStoreReport(
  filters: GrowthQueryFilters,
  options: { client?: SupabaseClient; now?: Date } = {}
): Promise<GrowthResponseEnvelope<GrowthAppStoreReport>> {
  const client = options.client ?? getAdminSupabase();
  const now = options.now ?? new Date();
  try {
    const [data, health] = await Promise.all([
      appStoreData(client, filters),
      latestSyncStatus(client, now),
    ]);
    let sources = health.filter((source) => source.source === "app_store");
    if (data.series.length === 0 && sources.every((source) => source.state === "ready")) {
      sources = sources.map((source) => ({ ...source, state: "empty" as const }));
    }
    return asEnvelope<GrowthAppStoreReport>({
      data,
      sources,
      coverage: {
        observed: data.series.length,
        total: filters.endDate >= filters.startDate
          ? growthMilestoneComparisonPeriods(filters).current.days
          : null,
        ratio: ratio(data.series.length, growthMilestoneComparisonPeriods(filters).current.days),
        label: "Reporting days present",
      },
      now,
    });
  } catch (error) {
    return asEnvelope<GrowthAppStoreReport>({
      data: null,
      sources: [sourceFailure("app_store", error instanceof Error ? error.message : String(error))],
      now,
    });
  }
}

export async function getGrowthOverview(
  filters: GrowthQueryFilters,
  options: { client?: SupabaseClient; now?: Date } = {}
): Promise<GrowthResponseEnvelope<GrowthOverview>> {
  const client = options.client ?? getAdminSupabase();
  const now = options.now ?? new Date();
  const periods = growthMilestoneComparisonPeriods(filters);
  let coverage: GrowthCoverage;
  try {
    coverage = await attributionCoverage(client, filters);
  } catch (error) {
    return asEnvelope<GrowthOverview>({
      data: null,
      sources: [sourceFailure("business_records", error instanceof Error ? error.message : String(error))],
      now,
    });
  }
  const channel = resolveGrowthChannel(filters.channel, coverage);
  const scopedFilters = { ...filters, channel };
  try {
    const [rows, channels, search, appStore, health, metricRows] = await Promise.all([
      funnelRows(client, scopedFilters, channel),
      channelPerformance(client, scopedFilters),
      getGrowthSearchReport(scopedFilters, { client, now }),
      getGrowthAppStoreReport(scopedFilters, { client, now }),
      getGrowthHealth({ client, now }),
      queryRows(
        client
          .from("channel_metrics")
          .select("metric_type, metric_value")
          .gte("metric_date", filters.startDate)
          .lte("metric_date", filters.endDate)
          .in("metric_type", ["spend_cents", "ad_spend_cents"]),
        "Growth paid spend"
      ),
    ]);
    const currentRows = rowsInPeriod(rows, periods.current);
    const previousRows = rowsInPeriod(rows, periods.previous);
    const current = summarizeRows(currentRows);
    const previous = summarizeRows(previousRows);
    const trend: GrowthTrendPoint[] = currentRows.map((row) => ({
      date: String(row.reporting_date),
      trials: integer(row.trials_started),
      firstValue: integer(row.first_value_companies),
      paid: integer(row.paid_companies),
    }));
    const sourceLanes: GrowthSourceLane[] = [
      {
        source: "web_search",
        metrics: [
          { key: "impressions", label: "Impressions", value: search.data?.totals.impressions ?? null },
          { key: "clicks", label: "Clicks", value: search.data?.totals.clicks ?? null },
          { key: "sessions", label: "Site sessions", value: search.data?.totals.sessions ?? null },
          { key: "trials", label: "Trials", value: current.trialsStarted },
        ],
        state: search.state,
        finalizedThrough: search.finalizedThrough,
        note: null,
      },
      {
        source: "app_store",
        metrics: [
          { key: "impressions", label: "Impressions", value: appStore.data?.totals.impressions ?? null },
          { key: "views", label: "Product page views", value: appStore.data?.totals.productPageViews ?? null },
          { key: "downloads", label: "First-time downloads", value: appStore.data?.totals.firstTimeDownloads ?? null },
          { key: "trials", label: "Trials", value: channels.filter((row) => row.channel.startsWith("app_store_")).reduce((total, row) => total + row.trials, 0) },
        ],
        state: appStore.state,
        finalizedThrough: appStore.finalizedThrough,
        note: appStore.data?.paidSplitState === "unavailable" ? "Paid split unavailable" : null,
      },
    ];
    const businessStatus: GrowthSourceStatus = {
      source: "business_records",
      state: current.trialsStarted > 0 ? "ready" : "empty",
      asOf: now.toISOString(),
      finalizedThrough: filters.endDate,
      coverage,
      detail: channel === "all" ? "All attributed channels" : `Channel: ${channel}`,
    };
    const sourceByName = new Map<GrowthSource, GrowthSourceStatus>();
    for (const source of [
      businessStatus,
      ...health.sources,
      ...search.sources,
      ...appStore.sources,
    ]) {
      sourceByName.set(source.source, source);
    }
    const sources = [...sourceByName.values()];
    const overview: GrowthOverview = {
      period: periods.current,
      previousPeriod: periods.previous,
      activatedCompanies: comparison(current.firstValueCompanies, previous.firstValueCompanies),
      attributionCoverage: coverage,
      funnel: [
        { key: "trial", value: current.trialsStarted, conversionFromTrial: 1 },
        { key: "first_project", value: current.firstProjectCompanies, conversionFromTrial: ratio(current.firstProjectCompanies, current.trialsStarted) },
        { key: "first_value", value: current.firstValueCompanies, conversionFromTrial: ratio(current.firstValueCompanies, current.trialsStarted) },
        { key: "paid", value: current.paidCompanies, conversionFromTrial: ratio(current.paidCompanies, current.trialsStarted) },
      ],
      trend,
      sourceLanes,
      channels,
      recentPaidSpendCents: Math.round(sum(metricRows, "metric_value")),
    };
    return asEnvelope({ data: overview, sources, coverage, now });
  } catch (error) {
    return asEnvelope<GrowthOverview>({
      data: null,
      sources: [sourceFailure("business_records", error instanceof Error ? error.message : String(error))],
      coverage,
      now,
    });
  }
}

export function getCachedGrowthOverview(filters: GrowthQueryFilters) {
  return unstable_cache(
    () => getGrowthOverview(filters),
    growthAnalyticsCacheKey("overview", filters),
    { revalidate: 300 }
  )();
}

export function getCachedGrowthSearchReport(filters: GrowthQueryFilters) {
  return unstable_cache(
    () => getGrowthSearchReport(filters),
    growthAnalyticsCacheKey("search", filters),
    { revalidate: 300 }
  )();
}

export function getCachedGrowthAppStoreReport(filters: GrowthQueryFilters) {
  return unstable_cache(
    () => getGrowthAppStoreReport(filters),
    growthAnalyticsCacheKey("app-store", filters),
    { revalidate: 300 }
  )();
}

export function getCachedGrowthHealth(filters: GrowthQueryFilters) {
  return unstable_cache(
    () => getGrowthHealth(),
    growthAnalyticsCacheKey("health", filters),
    { revalidate: 300 }
  )();
}
