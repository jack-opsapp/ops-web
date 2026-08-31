import {
  fetchSearchConsoleDate,
  getSearchConsoleSiteUrl,
  type SearchConsoleApiRow,
} from "@/lib/analytics/search-console-client";
import {
  AnalyticsSyncStore,
  type LatestSyncState,
} from "./analytics-sync-store";

const DAY_MS = 86_400_000;
const BACKFILL_DAYS_PER_RUN = 14;

export interface SearchConsoleDailyFact {
  site_url: string;
  reporting_date: string;
  query: string;
  page: string;
  country: string;
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  source_updated_at: string;
  updated_at: string;
}

export interface SearchConsoleSyncPlan {
  dates: string[];
  latestFinalizedDate: string;
  nextCursor: string | null;
  backfillComplete: boolean;
}

function parseDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
  return new Date(`${date}T12:00:00.000Z`);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return formatDate(new Date(parseDate(date).getTime() + days * DAY_MS));
}

export function pacificDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function subtractMonths(date: string, months: number): string {
  const parsed = parseDate(date);
  parsed.setUTCMonth(parsed.getUTCMonth() - months);
  return formatDate(parsed);
}

export function planSearchConsoleSync(input: {
  today: string;
  latestState: LatestSyncState | null;
  backfillStartDate?: string;
  backfillDaysPerRun?: number;
}): SearchConsoleSyncPlan {
  const latestFinalizedDate = addDays(input.today, -3);
  const trailing = Array.from({ length: 5 }, (_, index) =>
    addDays(input.today, -7 + index)
  );
  const alreadyComplete = input.latestState?.metadata.backfill_complete === true;
  const start =
    input.latestState?.cursor ??
    input.backfillStartDate ??
    subtractMonths(latestFinalizedDate, 16);
  const limit = input.backfillDaysPerRun ?? BACKFILL_DAYS_PER_RUN;
  const backfill: string[] = [];
  let cursor = start;
  if (!alreadyComplete) {
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

function sanitizePage(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    throw new Error("Search Console row contained an invalid page URL");
  }
}

function finiteNonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function toSearchConsoleFact(
  row: SearchConsoleApiRow,
  siteUrl: string,
  reportingDate: string,
  nowIso: string
): SearchConsoleDailyFact {
  if (!Array.isArray(row.keys) || row.keys.length !== 5) {
    throw new Error("Search Console row had an unexpected dimension shape");
  }
  const [date, query, page, country, device] = row.keys;
  if (date !== reportingDate || !page) {
    throw new Error("Search Console row did not match the requested date");
  }
  return {
    site_url: siteUrl,
    reporting_date: reportingDate,
    query: query ?? "",
    page: sanitizePage(page),
    country: country ?? "",
    device: device ?? "",
    clicks: Math.round(finiteNonNegative(row.clicks)),
    impressions: Math.round(finiteNonNegative(row.impressions)),
    ctr: Math.min(1, finiteNonNegative(row.ctr)),
    position: finiteNonNegative(row.position),
    source_updated_at: nowIso,
    updated_at: nowIso,
  };
}

export function aggregateSearchConsoleFacts(
  facts: SearchConsoleDailyFact[]
): SearchConsoleDailyFact[] {
  const grouped = new Map<string, SearchConsoleDailyFact>();
  for (const fact of facts) {
    const key = JSON.stringify([
      fact.site_url,
      fact.reporting_date,
      fact.query,
      fact.page,
      fact.country,
      fact.device,
    ]);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...fact });
      continue;
    }
    const impressions = current.impressions + fact.impressions;
    const weightedPosition =
      current.position * current.impressions + fact.position * fact.impressions;
    current.clicks += fact.clicks;
    current.impressions = impressions;
    current.ctr = impressions > 0 ? current.clicks / impressions : 0;
    current.position = impressions > 0 ? weightedPosition / impressions : 0;
  }
  return [...grouped.values()];
}

function metricRows(
  facts: SearchConsoleDailyFact[],
  reportingDate: string,
  nowIso: string
): Record<string, unknown>[] {
  return facts.flatMap((fact) => {
    const sourceKey = [
      "search_console",
      fact.site_url,
      fact.query,
      fact.page,
      fact.country,
      fact.device,
    ].join(":");
    const dimensions = {
      site_url: fact.site_url,
      query: fact.query,
      page: fact.page,
      country: fact.country,
      device: fact.device,
    };
    return [
      {
        metric_date: reportingDate,
        canonical_channel: "organic_search",
        sub_channel: "google_search",
        campaign: null,
        territory: fact.country || null,
        metric_type: "search_clicks",
        metric_value: fact.clicks,
        currency: null,
        source_system: "search_console",
        source_grain: "date_query_page_country_device",
        source_key: sourceKey,
        dimensions,
        as_of: nowIso,
        updated_at: nowIso,
      },
      {
        metric_date: reportingDate,
        canonical_channel: "organic_search",
        sub_channel: "google_search",
        campaign: null,
        territory: fact.country || null,
        metric_type: "search_impressions",
        metric_value: fact.impressions,
        currency: null,
        source_system: "search_console",
        source_grain: "date_query_page_country_device",
        source_key: sourceKey,
        dimensions,
        as_of: nowIso,
        updated_at: nowIso,
      },
    ];
  });
}

export async function runSearchConsoleSync(options: {
  store?: AnalyticsSyncStore;
  now?: Date;
  siteUrl?: string;
  backfillStartDate?: string;
  fetchDate?: typeof fetchSearchConsoleDate;
  signal?: AbortSignal;
} = {}): Promise<{
  dates: string[];
  rowCount: number;
  finalizedThrough: string;
  backfillComplete: boolean;
}> {
  const store = options.store ?? new AnalyticsSyncStore();
  const now = options.now ?? new Date();
  // The durable run record opens before ANY fallible preflight so a missing
  // env var or state-read failure is recorded with its reason instead of
  // surfacing only as an HTTP 500 with no analytics_sync_runs row
  // (bug 6d61591c: SEARCH_CONSOLE_SITE_URL was absent on 2026-08-31 and the
  // throw happened before begin(), leaving the failure undiagnosable).
  const runId = await store.begin("search_console", { phase: "preflight" });
  let rowCount = 0;
  try {
    const siteUrl = options.siteUrl ?? getSearchConsoleSiteUrl();
    const latestState = await store.latest("search_console");
    const plan = planSearchConsoleSync({
      today: pacificDate(now),
      latestState,
      backfillStartDate: options.backfillStartDate,
    });
    await store.annotate(runId, {
      site_url: siteUrl,
      requested_dates: plan.dates,
    });
    for (const reportingDate of plan.dates) {
      if (options.signal?.aborted) throw new Error("Search Console lease lost");
      const rows = await (options.fetchDate ?? fetchSearchConsoleDate)(
        reportingDate,
        { siteUrl }
      );
      const nowIso = now.toISOString();
      const facts = aggregateSearchConsoleFacts(
        rows.map((row) =>
          toSearchConsoleFact(row, siteUrl, reportingDate, nowIso)
        )
      );
      rowCount += await store.replaceSearchConsoleDate({
        siteUrl,
        reportingDate,
        rows: facts as unknown as Record<string, unknown>[],
        metrics: metricRows(facts, reportingDate, nowIso),
      });
    }
    await store.complete(runId, {
      sourceMaxDate: plan.latestFinalizedDate,
      rowCount,
      cursor: plan.nextCursor,
      metadata: {
        site_url: siteUrl,
        dates: plan.dates,
        backfill_complete: plan.backfillComplete,
      },
    });
    return {
      dates: plan.dates,
      rowCount,
      finalizedThrough: plan.latestFinalizedDate,
      backfillComplete: plan.backfillComplete,
    };
  } catch (error) {
    await store.fail(runId, error);
    throw error;
  }
}
