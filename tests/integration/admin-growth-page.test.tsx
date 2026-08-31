import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  GrowthDataState,
  GrowthOverview,
  GrowthResponseEnvelope,
  GrowthSearchReport,
  GrowthSourceStatus,
} from "@/lib/admin/growth-analytics-types";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallbackOrParams?: string | Record<string, unknown>) =>
      typeof fallbackOrParams === "string" ? fallbackOrParams : key,
  }),
  useLocale: () => ({ locale: "en" }),
}));

import { GrowthOverview as GrowthOverviewView } from "@/app/admin/acquisition/_components/growth-overview";

const source = (state: GrowthDataState): GrowthSourceStatus => ({
  source: "business_records",
  state,
  asOf: "2026-08-30T12:00:00.000Z",
  finalizedThrough: "2026-08-29",
  coverage: { observed: 8, total: 10, ratio: 0.8, label: "Known" },
  detail: "Current",
});

const overviewData: GrowthOverview = {
  period: { startDate: "2026-08-01", endDate: "2026-08-30", days: 30 },
  previousPeriod: { startDate: "2026-07-02", endDate: "2026-07-31", days: 30 },
  activatedCompanies: { current: 4, previous: 2, delta: 2, changeRatio: 1 },
  attributionCoverage: { observed: 8, total: 10, ratio: 0.8, label: "Known" },
  funnel: [
    { key: "trial", value: 10, conversionFromTrial: 1 },
    { key: "first_project", value: 7, conversionFromTrial: 0.7 },
    { key: "first_value", value: 4, conversionFromTrial: 0.4 },
    { key: "paid", value: 2, conversionFromTrial: 0.2 },
  ],
  trend: [{ date: "2026-08-30", trials: 2, activated: 1, paid: 1 }],
  sourceLanes: [
    {
      source: "web_search",
      metrics: [
        { key: "impressions", label: "Impressions", value: 100 },
        { key: "clicks", label: "Clicks", value: 20 },
        { key: "ctr", label: "CTR", value: 0.2 },
        { key: "sessions", label: "Site sessions", value: 16 },
        { key: "trials", label: "Trials", value: 3 },
      ],
      state: "ready",
      finalizedThrough: "2026-08-27",
      note: null,
    },
    {
      source: "app_store",
      metrics: [
        { key: "impressions", label: "Impressions", value: 80 },
        { key: "views", label: "Product page views", value: 30 },
        { key: "downloads", label: "First-time downloads", value: 12 },
        { key: "trials", label: "Trials", value: 2 },
      ],
      state: "provisional",
      finalizedThrough: "2026-08-28",
      note: "paid_split_unavailable",
    },
  ],
  channels: [
    {
      channel: "organic_search",
      discovery: 16,
      discoveryLabel: "sessions",
      trials: 3,
      activated: 2,
      firstValue: 2,
      paid: 1,
      activationRate: 2 / 3,
      revenueCents: 4900,
      confidence: "deterministic",
    },
  ],
  recentPaidSpendCents: 0,
};

const searchData: GrowthSearchReport = {
  totals: { impressions: 100, clicks: 20, ctr: 0.2, sessions: 16 },
  pages: [
    {
      label: "/journal",
      page: "https://opsapp.co/journal",
      query: null,
      clicks: 20,
      impressions: 100,
      ctr: 0.2,
      position: 3.2,
      sessions: 16,
    },
  ],
  queries: [],
};

function envelope<T>(state: GrowthDataState, data: T | null): GrowthResponseEnvelope<T> {
  return {
    data,
    state,
    asOf: "2026-08-30T12:00:00.000Z",
    finalizedThrough: "2026-08-27",
    coverage: { observed: 8, total: 10, ratio: 0.8, label: "Known" },
    sources: [source(state)],
  };
}

function renderState(state: GrowthDataState, data: GrowthOverview | null = overviewData) {
  render(
    <GrowthOverviewView
      initialFilters={{
        startDate: "2026-08-01",
        endDate: "2026-08-30",
        channel: "auto",
      }}
      initialHealth={envelope(state, { statuses: [source(state)] })}
      initialOverview={envelope(state, data)}
      initialSearch={envelope(state, searchData)}
    />
  );
}

describe("founder growth page", () => {
  it("keeps the outcome, source lanes, funnel, channel table, and health in one hierarchy", () => {
    renderState("ready");

    expect(document.querySelector('[data-growth-state="ready"]')).toBeInTheDocument();
    expect(screen.getByText("activatedCompanies")).toBeInTheDocument();
    expect(screen.getByText("sourceLanes")).toBeInTheDocument();
    expect(screen.getByText("companyFunnel")).toBeInTheDocument();
    expect(screen.getByText("channelPerformance")).toBeInTheDocument();
    expect(screen.getByText("dataHealth")).toBeInTheDocument();
    expect(screen.queryByText("paidSpend")).not.toBeInTheDocument();
  });

  it.each(["partial", "failed", "empty", "provisional"] as const)(
    "marks the %s state without hiding verified figures",
    (state) => {
      renderState(state);

      expect(document.querySelector(`[data-growth-state="${state}"]`)).toBeInTheDocument();
      expect(screen.getByText(`state${state[0].toUpperCase()}${state.slice(1)}Message`)).toBeInTheDocument();
      expect(screen.getByText("activatedCompanies")).toBeInTheDocument();
      expect(screen.getByText("dataHealth")).toBeInTheDocument();
    }
  );

  it("never substitutes zeroes when the normalized report is unavailable", () => {
    renderState("missing", null);

    expect(screen.getByText("unavailable")).toBeInTheDocument();
    expect(screen.queryByText("activatedCompanies")).not.toBeInTheDocument();
    expect(screen.getByText("dataHealth")).toBeInTheDocument();
  });
});
