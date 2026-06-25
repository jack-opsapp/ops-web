import { unstable_cache } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { bucketizeAggregate } from "@/lib/admin/date-utils";
import type { Granularity, ChartDataPoint, DonutSegment } from "@/lib/admin/types";

const db = () => getAdminSupabase();

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AscSyncStatus {
  job_name: string;
  status: "idle" | "running" | "complete" | "failed";
  last_synced_date: string | null;
  last_run_at: string | null;
  error: string | null;
}

export interface AscKpis {
  conversionRate: number | null;
  impressions: number;
  pageViews: number;
  downloads: number;
  prev: { conversionRate: number | null; impressions: number; pageViews: number; downloads: number };
  finalizedThrough: string; // current_date - 2 (YYYY-MM-DD)
  hasData: boolean;
}

export interface AscTrafficSeries {
  impressions: ChartDataPoint[];
  pageViews: ChartDataPoint[];
  downloads: ChartDataPoint[];
}

export interface AscTerritoryRow {
  territory: string;
  impressions: number;
  pageViews: number;
  downloads: number;
  conversionRate: number | null;
  sparkline: ChartDataPoint[];
}

export interface AscIngestState {
  configured: boolean;
  hasFacts: boolean;
  hasProcessedInstance: boolean;
  bootstrapAt: string | null;
}

// Neutral data palette — never the steel-blue accent (#6F94B0 is CTA/focus only).
const DATA_PALETTE = ["#B5B5B5", "#9DB582", "#C4A868", "#B58289", "#8A8A8A", "#6A6A6A", "#EDEDED"];

// ─── Sync status (mirrors ads_sync_status helpers) ───────────────────────────

export async function getAscSyncStatus(job = "app-store-sync"): Promise<AscSyncStatus | null> {
  const { data } = await db().from("asc_sync_status").select("*").eq("job_name", job).maybeSingle();
  return (data as AscSyncStatus | null) ?? null;
}

export async function updateAscSyncStatus(
  job: string,
  patch: Partial<Omit<AscSyncStatus, "job_name">>,
): Promise<void> {
  await db()
    .from("asc_sync_status")
    .upsert(
      { job_name: job, ...patch, last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "job_name" },
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Cache key that ALWAYS includes the dynamic args (never collide dated variants). */
export function ascCacheKey(...parts: (string | number)[]): string[] {
  return ["asc", ...parts.map(String)];
}

function toDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Most recent finalized reporting date = today - 2 (UTC), as YYYY-MM-DD. */
function finalizedThrough(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}

/** Immediately-preceding range of equal length (for period-over-period deltas). */
function prevRange(fromIso: string, toIso: string): { from: string; to: string } {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  const span = Math.max(to - from, 86_400_000);
  return { from: new Date(from - span).toISOString(), to: new Date(from - 1).toISOString() };
}

type ConvRow = { reporting_date: string; unique_impressions: number; total_downloads: number; territory: string | null; channel: string | null };
type PvRow = { reporting_date: string; counts: number; territory: string | null };

async function fetchConvRows(fromIso: string, toIso: string): Promise<ConvRow[]> {
  const { data, error } = await db()
    .from("asc_conversion_daily")
    .select("reporting_date, unique_impressions, total_downloads, territory, channel")
    .gte("reporting_date", toDate(fromIso))
    .lte("reporting_date", toDate(toIso))
    .limit(100000);
  if (error) throw new Error(`asc_conversion_daily: ${error.message}`);
  return (data ?? []) as ConvRow[];
}

async function fetchPageViewRows(fromIso: string, toIso: string): Promise<PvRow[]> {
  const { data, error } = await db()
    .from("asc_discovery_engagement")
    .select("reporting_date, counts, territory")
    .ilike("engagement_type", "%page view%")
    .gte("reporting_date", toDate(fromIso))
    .lte("reporting_date", toDate(toIso))
    .limit(100000);
  if (error) throw new Error(`asc_discovery_engagement: ${error.message}`);
  return (data ?? []) as PvRow[];
}

const sum = (rows: { [k: string]: unknown }[], k: string) =>
  rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

const rate = (downloads: number, impressions: number): number | null =>
  impressions > 0 ? downloads / impressions : null;

// ─── KPIs ────────────────────────────────────────────────────────────────────

async function _kpis(fromIso: string, toIso: string): Promise<AscKpis> {
  const prev = prevRange(fromIso, toIso);
  const [conv, pv, convPrev, pvPrev] = await Promise.all([
    fetchConvRows(fromIso, toIso),
    fetchPageViewRows(fromIso, toIso),
    fetchConvRows(prev.from, prev.to),
    fetchPageViewRows(prev.from, prev.to),
  ]);

  const impressions = sum(conv, "unique_impressions");
  const downloads = sum(conv, "total_downloads");
  const pageViews = sum(pv, "counts");
  const pImp = sum(convPrev, "unique_impressions");
  const pDl = sum(convPrev, "total_downloads");
  const pPv = sum(pvPrev, "counts");

  return {
    conversionRate: rate(downloads, impressions),
    impressions,
    pageViews,
    downloads,
    prev: { conversionRate: rate(pDl, pImp), impressions: pImp, pageViews: pPv, downloads: pDl },
    finalizedThrough: finalizedThrough(),
    hasData: conv.length > 0 || pv.length > 0,
  };
}

export const getAscKpis = (from: string, to: string) =>
  unstable_cache(() => _kpis(from, to), ascCacheKey("kpis", from, to), { revalidate: 300 })();

// ─── Conversion-rate series ──────────────────────────────────────────────────

async function _conversionSeries(fromIso: string, toIso: string, g: Granularity): Promise<ChartDataPoint[]> {
  const conv = await fetchConvRows(fromIso, toIso);
  const imp = bucketizeAggregate(conv, fromIso, toIso, g, "reporting_date", "unique_impressions");
  const dl = bucketizeAggregate(conv, fromIso, toIso, g, "reporting_date", "total_downloads");
  // bucketize fills every bucket with aligned labels → safe to zip by index.
  return imp.map((p, i) => ({ label: p.label, value: rate(dl[i]?.value ?? 0, p.value) ?? 0 }));
}

export const getAscConversionSeries = (from: string, to: string, g: Granularity) =>
  unstable_cache(() => _conversionSeries(from, to, g), ascCacheKey("conv", from, to, g), { revalidate: 300 })();

// ─── Traffic series (impressions / page views / downloads) ───────────────────

async function _trafficSeries(fromIso: string, toIso: string, g: Granularity): Promise<AscTrafficSeries> {
  const [conv, pv] = await Promise.all([fetchConvRows(fromIso, toIso), fetchPageViewRows(fromIso, toIso)]);
  return {
    impressions: bucketizeAggregate(conv, fromIso, toIso, g, "reporting_date", "unique_impressions"),
    downloads: bucketizeAggregate(conv, fromIso, toIso, g, "reporting_date", "total_downloads"),
    pageViews: bucketizeAggregate(pv, fromIso, toIso, g, "reporting_date", "counts"),
  };
}

export const getAscTrafficSeries = (from: string, to: string, g: Granularity) =>
  unstable_cache(() => _trafficSeries(from, to, g), ascCacheKey("traffic", from, to, g), { revalidate: 300 })();

// ─── Source breakdown (downloads by canonical channel) ───────────────────────

async function _sourceBreakdown(fromIso: string, toIso: string): Promise<DonutSegment[]> {
  const conv = await fetchConvRows(fromIso, toIso);
  const byChannel = new Map<string, number>();
  for (const r of conv) {
    const ch = r.channel ?? "unavailable";
    byChannel.set(ch, (byChannel.get(ch) ?? 0) + (Number(r.total_downloads) || 0));
  }
  return [...byChannel.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({ name, value, color: DATA_PALETTE[i % DATA_PALETTE.length] }));
}

export const getAscSourceBreakdown = (from: string, to: string) =>
  unstable_cache(() => _sourceBreakdown(from, to), ascCacheKey("source", from, to), { revalidate: 300 })();

// ─── Territories ─────────────────────────────────────────────────────────────

async function _territories(fromIso: string, toIso: string, g: Granularity): Promise<AscTerritoryRow[]> {
  const [conv, pv] = await Promise.all([fetchConvRows(fromIso, toIso), fetchPageViewRows(fromIso, toIso)]);
  const pvByTerritory = new Map<string, PvRow[]>();
  for (const r of pv) {
    const t = r.territory ?? "—";
    (pvByTerritory.get(t) ?? pvByTerritory.set(t, []).get(t)!).push(r);
  }
  const convByTerritory = new Map<string, ConvRow[]>();
  for (const r of conv) {
    const t = r.territory ?? "—";
    (convByTerritory.get(t) ?? convByTerritory.set(t, []).get(t)!).push(r);
  }

  const rows: AscTerritoryRow[] = [];
  for (const [territory, crows] of convByTerritory) {
    const impressions = sum(crows, "unique_impressions");
    const downloads = sum(crows, "total_downloads");
    const pageViews = sum(pvByTerritory.get(territory) ?? [], "counts");
    rows.push({
      territory,
      impressions,
      pageViews,
      downloads,
      conversionRate: rate(downloads, impressions),
      sparkline: bucketizeAggregate(crows, fromIso, toIso, g, "reporting_date", "total_downloads"),
    });
  }
  return rows.sort((a, b) => b.downloads - a.downloads);
}

export const getAscTerritories = (from: string, to: string, g: Granularity) =>
  unstable_cache(() => _territories(from, to, g), ascCacheKey("territories", from, to, g), { revalidate: 300 })();

// ─── Ingest state (drives SETUP REQUIRED / AWAITING FIRST REPORT panels) ─────

export async function getAscIngestState(configured: boolean): Promise<AscIngestState> {
  if (!configured) return { configured: false, hasFacts: false, hasProcessedInstance: false, bootstrapAt: null };
  const client = db();
  const [de, dl, processed, boot] = await Promise.all([
    client.from("asc_discovery_engagement").select("id", { count: "exact", head: true }),
    client.from("asc_downloads").select("id", { count: "exact", head: true }),
    client.from("asc_report_instances").select("id", { count: "exact", head: true }).eq("state", "processed"),
    client.from("asc_report_requests").select("created_at").order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ]);
  return {
    configured: true,
    hasFacts: (de.count ?? 0) > 0 || (dl.count ?? 0) > 0,
    hasProcessedInstance: (processed.count ?? 0) > 0,
    bootstrapAt: (boot.data as { created_at: string } | null)?.created_at ?? null,
  };
}
