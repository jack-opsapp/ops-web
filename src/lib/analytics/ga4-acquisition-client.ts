import type { protos } from "@google-analytics/data";
import { getGA4Client } from "./ga4-client";
import {
  getGA4PropertyId,
  type GA4PropertyKey,
} from "./ga4-properties";

type ReportRequest = protos.google.analytics.data.v1beta.IRunReportRequest;
type ReportRow = protos.google.analytics.data.v1beta.IRow;
export type GA4ReportRow = ReportRow;

export const GA4_ACQUISITION_DIMENSIONS = [
  "date",
  "sessionDefaultChannelGroup",
  "sessionSource",
  "sessionMedium",
  "sessionCampaignName",
  "landingPage",
] as const;

export const GA4_ACQUISITION_METRICS = [
  "sessions",
  "engagedSessions",
  "newUsers",
  "totalUsers",
  "keyEvents",
] as const;

export const GA4_REPORT_LIMIT = 100_000;

export interface GA4ReportClient {
  runReport(request: ReportRequest): Promise<[{
    rows?: ReportRow[] | null;
    rowCount?: number | null;
  }]>;
}

export function buildGA4AcquisitionRequest(
  propertyKey: "marketing" | "web_app",
  reportingDate: string,
  offset = 0,
  limit = GA4_REPORT_LIMIT
): ReportRequest {
  return {
    property: getGA4PropertyId(propertyKey),
    dateRanges: [{ startDate: reportingDate, endDate: reportingDate }],
    dimensions: GA4_ACQUISITION_DIMENSIONS.map((name) => ({ name })),
    metrics: GA4_ACQUISITION_METRICS.map((name) => ({ name })),
    orderBys: GA4_ACQUISITION_DIMENSIONS.map((name) => ({
      dimension: { dimensionName: name },
      desc: false,
    })),
    keepEmptyRows: true,
    limit,
    offset,
  };
}

export async function fetchGA4AcquisitionDate(
  propertyKey: "marketing" | "web_app",
  reportingDate: string,
  options: { client?: GA4ReportClient; limit?: number } = {}
): Promise<ReportRow[]> {
  const client = options.client ?? getGA4Client();
  const limit = options.limit ?? GA4_REPORT_LIMIT;
  const rows: ReportRow[] = [];
  for (let offset = 0; ; offset += limit) {
    const [response] = await client.runReport(
      buildGA4AcquisitionRequest(propertyKey, reportingDate, offset, limit)
    );
    const page = response.rows ?? [];
    rows.push(...page);
    const rowCount = Number(response.rowCount ?? rows.length);
    if (page.length < limit || rows.length >= rowCount) break;
  }
  return rows;
}

const FIREBASE_CONVERSION_EVENTS = [
  "sign_up",
  "begin_trial",
  "complete_onboarding",
  "create_first_project",
  "purchase",
] as const;

export async function fetchGA4ConversionQA(
  startDate: string,
  endDate: string,
  options: { client?: GA4ReportClient } = {}
): Promise<ReportRow[]> {
  const client = options.client ?? getGA4Client();
  const [response] = await client.runReport({
    property: getGA4PropertyId("ios_app"),
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "date" }, { name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        inListFilter: { values: [...FIREBASE_CONVERSION_EVENTS] },
      },
    },
    orderBys: [
      { dimension: { dimensionName: "date" }, desc: false },
      { dimension: { dimensionName: "eventName" }, desc: false },
    ],
    limit: 100_000,
  });
  return response.rows ?? [];
}

export function numericPropertyId(propertyKey: GA4PropertyKey): string {
  return getGA4PropertyId(propertyKey).replace(/^properties\//, "");
}
