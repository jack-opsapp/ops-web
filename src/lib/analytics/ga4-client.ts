/**
 * OPS Admin — Google Analytics Data API (GA4) Client
 *
 * SERVER ONLY. Never import from client components.
 * Data latency: ~24-48 hours. Use Firebase Admin for real-time auth metrics.
 */
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import type { protos } from "@google-analytics/data";

type Row = protos.google.analytics.data.v1beta.IRow;

// ─── Singleton client ─────────────────────────────────────────────────────────

let _ga4Client: BetaAnalyticsDataClient | null = null;

export function getGA4Client(): BetaAnalyticsDataClient {
  if (_ga4Client) return _ga4Client;

  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    throw new Error("Missing FIREBASE_ADMIN_SERVICE_ACCOUNT env var");
  }

  _ga4Client = new BetaAnalyticsDataClient({
    credentials: JSON.parse(serviceAccountJson),
  });

  return _ga4Client;
}

export function getPropertyId(): string {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error("Missing GA4_PROPERTY_ID env var");
  return `properties/${id}`;
}

// ─── Helpers (pure, testable) ─────────────────────────────────────────────────

export function buildDateRange(days: number) {
  return { startDate: `${days}daysAgo`, endDate: "today" };
}

export function processEventCountRows(rows: Row[]) {
  return rows.map((row) => ({
    dimension: row.dimensionValues?.[0]?.value ?? "(not set)",
    count: parseInt(row.metricValues?.[0]?.value ?? "0", 10),
  }));
}

// ─── Report Queries ───────────────────────────────────────────────────────────

/**
 * Get event counts by platform for a specific event name.
 */
export async function getEventByPlatform(eventName: string, days = 30) {
  const client = getGA4Client();
  const [response] = await client.runReport({
    property: getPropertyId(),
    dimensions: [{ name: "platform" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: eventName },
      },
    },
    dateRanges: [buildDateRange(days)],
  });
  return processEventCountRows(response.rows ?? []);
}

/**
 * Get event counts by date (YYYY-MM-DD) for a specific event.
 */
export async function getEventByDate(eventName: string, days = 30) {
  const client = getGA4Client();
  const [response] = await client.runReport({
    property: getPropertyId(),
    dimensions: [{ name: "date" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: eventName },
      },
    },
    dateRanges: [buildDateRange(days)],
    orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
  });
  return processEventCountRows(response.rows ?? []);
}

/**
 * Get funnel step counts for the onboarding funnel.
 */
export async function getOnboardingFunnel(days = 90, platform?: string) {
  const steps = [
    { step: "Sign Up", eventName: "sign_up" },
    { step: "Begin Trial", eventName: "begin_trial" },
    { step: "Complete Onboarding", eventName: "complete_onboarding" },
    { step: "First Project", eventName: "create_first_project" },
  ];

  const client = getGA4Client();
  const results = await Promise.all(
    steps.map(async ({ step, eventName }) => {
      const dimensionFilter: protos.google.analytics.data.v1beta.IFilterExpression = {
        filter: {
          fieldName: "eventName",
          stringFilter: { matchType: "EXACT", value: eventName },
        },
      };

      const filters: protos.google.analytics.data.v1beta.IFilterExpression[] = [dimensionFilter];

      if (platform && platform !== "ALL") {
        filters.push({
          filter: {
            fieldName: "platform",
            stringFilter: { matchType: "EXACT", value: platform },
          },
        });
      }

      const [response] = await client.runReport({
        property: getPropertyId(),
        metrics: [{ name: "eventCount" }],
        dimensionFilter: filters.length > 1 ? { andGroup: { expressions: filters } } : dimensionFilter,
        dateRanges: [buildDateRange(days)],
      });

      const count = parseInt(response.rows?.[0]?.metricValues?.[0]?.value ?? "0", 10);
      return { step, eventName, count };
    })
  );

  return results;
}

/**
 * Get top screens by view count.
 */
export async function getTopScreens(days = 30, limit = 10) {
  const client = getGA4Client();
  const [response] = await client.runReport({
    property: getPropertyId(),
    dimensions: [{ name: "customEvent:screen_name" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: "screen_view" },
      },
    },
    dateRanges: [buildDateRange(days)],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit,
  });
  return processEventCountRows(response.rows ?? []);
}

/**
 * Get sign-up counts per week broken down by platform.
 */
export async function getSignupsByWeek(weeks = 12) {
  const client = getGA4Client();
  const [response] = await client.runReport({
    property: getPropertyId(),
    dimensions: [{ name: "yearWeek" }, { name: "platform" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: "sign_up" },
      },
    },
    dateRanges: [buildDateRange(weeks * 7)],
    orderBys: [{ dimension: { dimensionName: "yearWeek" }, desc: false }],
  });
  return response.rows ?? [];
}

/**
 * Get form abandonment breakdown by form type.
 */
export async function getFormAbandonment(days = 30) {
  const client = getGA4Client();
  const [response] = await client.runReport({
    property: getPropertyId(),
    dimensions: [{ name: "customEvent:form_type" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: "form_abandoned" },
      },
    },
    dateRanges: [buildDateRange(days)],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
  });
  return processEventCountRows(response.rows ?? []);
}
