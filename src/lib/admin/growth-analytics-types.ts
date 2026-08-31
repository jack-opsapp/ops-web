import type { AttributionChannel } from "@/lib/pmf/types";

export type GrowthDataState =
  | "ready"
  | "empty"
  | "partial"
  | "failed"
  | "missing"
  | "stale"
  | "provisional";

export type GrowthSource =
  | "business_records"
  | "search_console"
  | "ga4_marketing"
  | "ga4_web_app"
  | "ga4_ios_qa"
  | "app_store";

export interface GrowthCoverage {
  observed: number | null;
  total: number | null;
  ratio: number | null;
  label: string;
}

export interface GrowthSourceStatus {
  source: GrowthSource;
  state: GrowthDataState;
  asOf: string | null;
  finalizedThrough: string | null;
  coverage: GrowthCoverage;
  detail: string;
}

export interface GrowthResponseEnvelope<T> {
  data: T | null;
  state: GrowthDataState;
  asOf: string;
  finalizedThrough: string | null;
  coverage: GrowthCoverage;
  sources: GrowthSourceStatus[];
}

export interface GrowthPeriod {
  startDate: string;
  endDate: string;
  days: number;
}

export interface GrowthMetricComparison {
  current: number | null;
  previous: number | null;
  delta: number | null;
  changeRatio: number | null;
}

export interface GrowthFunnelStage {
  key: "trial" | "first_project" | "first_value" | "paid";
  value: number;
  conversionFromTrial: number | null;
}

export interface GrowthTrendPoint {
  date: string;
  trials: number;
  firstValue: number;
  paid: number;
}

export interface GrowthSourceLane {
  source: "web_search" | "app_store";
  metrics: Array<{
    key: string;
    label: string;
    value: number | null;
  }>;
  state: GrowthDataState;
  finalizedThrough: string | null;
  note: string | null;
}

export interface GrowthChannelPerformanceRow {
  channel: AttributionChannel;
  discovery: number | null;
  discoveryLabel: string;
  trials: number;
  firstValue: number;
  paid: number;
  activationRate: number | null;
  revenueCents: number;
  confidence: "verified" | "deterministic" | "reported" | "direct" | "unknown";
}

export interface GrowthOverview {
  period: GrowthPeriod;
  previousPeriod: GrowthPeriod;
  activatedCompanies: GrowthMetricComparison;
  attributionCoverage: GrowthCoverage;
  funnel: GrowthFunnelStage[];
  trend: GrowthTrendPoint[];
  sourceLanes: GrowthSourceLane[];
  channels: GrowthChannelPerformanceRow[];
  recentPaidSpendCents: number;
}

export interface GrowthSearchRow {
  label: string;
  page: string | null;
  query: string | null;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  sessions: number | null;
}

export interface GrowthSearchReport {
  totals: {
    impressions: number;
    clicks: number;
    ctr: number | null;
    sessions: number | null;
  };
  pages: GrowthSearchRow[];
  queries: GrowthSearchRow[];
}

export interface GrowthAppStoreReport {
  totals: {
    impressions: number;
    productPageViews: number;
    firstTimeDownloads: number;
    conversionRate: number | null;
  };
  series: Array<{
    date: string;
    impressions: number;
    productPageViews: number;
    firstTimeDownloads: number;
  }>;
  paidSplitState: "available" | "unavailable";
}

export const EMPTY_COVERAGE: GrowthCoverage = {
  observed: null,
  total: null,
  ratio: null,
  label: "Coverage unavailable",
};
