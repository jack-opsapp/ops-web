/**
 * OPS Admin — Website Analytics Queries (GA4 Data API)
 *
 * SERVER ONLY. Uses the shared GA4 client from ga4-client.ts.
 * Data latency: ~24-48 hours.
 */
import { getGA4Client, getPropertyId, buildDateRange } from "@/lib/analytics/ga4-client";
import type { WebsiteOverview, ChartDataPoint } from "@/lib/admin/types";

// ─── Website Overview ────────────────────────────────────────────────────────

export async function getWebsiteOverview(days = 30): Promise<WebsiteOverview> {
  const client = getGA4Client();
  const [response] = await client.runReport({
    property: getPropertyId(),
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "screenPageViews" },
      { name: "newUsers" },
      { name: "averageSessionDuration" },
      { name: "bounceRate" },
    ],
    dateRanges: [buildDateRange(days)],
  });

  const vals = response.rows?.[0]?.metricValues ?? [];
  return {
    sessions: parseInt(vals[0]?.value ?? "0", 10),
    activeUsers: parseInt(vals[1]?.value ?? "0", 10),
    pageviews: parseInt(vals[2]?.value ?? "0", 10),
    newUsers: parseInt(vals[3]?.value ?? "0", 10),
    avgSessionDuration: parseFloat(vals[4]?.value ?? "0"),
    bounceRate: parseFloat(vals[5]?.value ?? "0"),
  };
}

// ─── Sessions by Date ────────────────────────────────────────────────────────

export async function getSessionsByDate(days = 30): Promise<ChartDataPoint[]> {
  const client = getGA4Client();
  const [response] = await client.runReport({
    property: getPropertyId(),
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }],
    dateRanges: [buildDateRange(days)],
    orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
  });

  return (response.rows ?? []).map((row) => {
    const raw = row.dimensionValues?.[0]?.value ?? "";
    // Format YYYYMMDD → MM/DD
    const label = raw.length === 8
      ? `${raw.slice(4, 6)}/${raw.slice(6, 8)}`
      : raw;
    return {
      label,
      value: parseInt(row.metricValues?.[0]?.value ?? "0", 10),
    };
  });
}

// ─── Top Pages ───────────────────────────────────────────────────────────────

export async function getTopPages(days = 30, limit = 10) {
  const client = getGA4Client();
  const [response] = await client.runReport({
    property: getPropertyId(),
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }],
    dateRanges: [buildDateRange(days)],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });

  return (response.rows ?? []).map((row) => ({
    dimension: row.dimensionValues?.[0]?.value ?? "(not set)",
    count: parseInt(row.metricValues?.[0]?.value ?? "0", 10),
  }));
}

// ─── Top Referrers ───────────────────────────────────────────────────────────

export async function getTopReferrers(days = 30, limit = 10) {
  const client = getGA4Client();
  const [response] = await client.runReport({
    property: getPropertyId(),
    dimensions: [{ name: "sessionSource" }],
    metrics: [{ name: "sessions" }],
    dateRanges: [buildDateRange(days)],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  });

  return (response.rows ?? []).map((row) => ({
    dimension: row.dimensionValues?.[0]?.value ?? "(not set)",
    count: parseInt(row.metricValues?.[0]?.value ?? "0", 10),
  }));
}

// ─── Device Breakdown ────────────────────────────────────────────────────────

export async function getDeviceBreakdown(days = 30) {
  const client = getGA4Client();
  const [response] = await client.runReport({
    property: getPropertyId(),
    dimensions: [{ name: "deviceCategory" }],
    metrics: [{ name: "sessions" }],
    dateRanges: [buildDateRange(days)],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
  });

  return (response.rows ?? []).map((row) => ({
    dimension: row.dimensionValues?.[0]?.value ?? "(not set)",
    count: parseInt(row.metricValues?.[0]?.value ?? "0", 10),
  }));
}
