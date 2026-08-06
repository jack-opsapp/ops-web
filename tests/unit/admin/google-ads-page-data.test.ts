/**
 * Unit tests for the shared /admin/google-ads data assembly.
 *
 * Pins the 2026-08-05 range redesign: warehouse-first sourcing with live
 * fill-ins (keywords + conversion actions are never warehoused), fully-live
 * fallback for unsynced windows, "all" spanning from the first day of real
 * warehouse activity, and history bounds attached to every response so the
 * page can orient the operator when ads are paused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const history = {
  hasHistoryData: vi.fn(),
  getHistoryBounds: vi.fn(),
  getAccountSummaryFromHistory: vi.fn(),
  getCampaignsFromHistory: vi.fn(),
  getSearchTermsFromHistory: vi.fn(),
  getDailySpendFromHistory: vi.fn(),
};
vi.mock("@/lib/admin/ads-history-queries", () => history);

const live = {
  isGoogleAdsConfigured: vi.fn(),
  getCachedAccountSummaryForRange: vi.fn(),
  getCachedCampaignPerformanceForRange: vi.fn(),
  getCachedKeywordPerformanceForRange: vi.fn(),
  getCachedSearchTermsForRange: vi.fn(),
  getCachedCostPerConversionForRange: vi.fn(),
  getCachedDailySpendForRange: vi.fn(),
};
vi.mock("@/lib/analytics/google-ads-client", () => live);

const SUMMARY = {
  totalSpend: 4777.8,
  totalClicks: 8495,
  totalImpressions: 100000,
  totalConversions: 355,
  avgCpa: 13.46,
  avgCtr: 0.08,
};

async function importAssembly() {
  return import("@/lib/admin/google-ads-page-data");
}

beforeEach(() => {
  vi.resetModules();
  Object.values(history).forEach((fn) => fn.mockReset());
  Object.values(live).forEach((fn) => fn.mockReset());

  live.isGoogleAdsConfigured.mockReturnValue(true);
  history.getHistoryBounds.mockResolvedValue({ firstDay: "2025-02-20", lastDay: "2026-03-09" });
  history.hasHistoryData.mockResolvedValue(true);
  history.getAccountSummaryFromHistory.mockResolvedValue(SUMMARY);
  history.getCampaignsFromHistory.mockResolvedValue([{ name: "c1" }]);
  history.getSearchTermsFromHistory.mockResolvedValue([{ searchTerm: "deck builder" }]);
  history.getDailySpendFromHistory.mockResolvedValue([{ date: "2025-06-01", spend: 10 }]);
  live.getCachedKeywordPerformanceForRange.mockResolvedValue([{ keyword: "deck software" }]);
  live.getCachedCostPerConversionForRange.mockResolvedValue([{ actionName: "signup" }]);
  live.getCachedAccountSummaryForRange.mockResolvedValue(SUMMARY);
  live.getCachedCampaignPerformanceForRange.mockResolvedValue([]);
  live.getCachedSearchTermsForRange.mockResolvedValue([]);
  live.getCachedDailySpendForRange.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveAdsRange", () => {
  it("spans 'all' from the first day of warehouse activity", async () => {
    const { resolveAdsRange } = await importAssembly();
    const range = await resolveAdsRange("all", { firstDay: "2025-02-20", lastDay: "2026-03-09" });
    expect(range.startDate).toBe("2025-02-20");
    // End is yesterday — just assert it is a well-formed recent date.
    expect(range.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to two years for 'all' when no history exists", async () => {
    const { resolveAdsRange } = await importAssembly();
    const range = await resolveAdsRange("all", null);
    const start = new Date(`${range.startDate}T00:00:00Z`);
    const end = new Date(`${range.endDate}T00:00:00Z`);
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(729);
    expect(days).toBeLessThanOrEqual(732);
  });

  it("resolves 90d to a 90-day inclusive span", async () => {
    const { resolveAdsRange } = await importAssembly();
    const range = await resolveAdsRange("90d", null);
    const start = new Date(`${range.startDate}T00:00:00Z`);
    const end = new Date(`${range.endDate}T00:00:00Z`);
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(89);
  });
});

describe("defaultAdsPreset", () => {
  it("opens on ALL when the account has been quiet for the whole default window", async () => {
    const { defaultAdsPreset } = await importAssembly();
    expect(defaultAdsPreset({ firstDay: "2025-02-20", lastDay: "2026-03-09" })).toBe("all");
  });

  it("opens on 30d when there is activity inside the last 30 days", async () => {
    const { defaultAdsPreset } = await importAssembly();
    const recent = new Date();
    recent.setUTCDate(recent.getUTCDate() - 3);
    const lastDay = recent.toISOString().split("T")[0];
    expect(defaultAdsPreset({ firstDay: "2025-02-20", lastDay })).toBe("30d");
  });

  it("opens on 30d before any history has been imported", async () => {
    const { defaultAdsPreset } = await importAssembly();
    expect(defaultAdsPreset(null)).toBe("30d");
  });
});

describe("getInitialAdsView", () => {
  it("fetches bounds once and serves the chosen preset", async () => {
    const { getInitialAdsView } = await importAssembly();
    const view = await getInitialAdsView();

    expect(view.preset).toBe("all");
    expect(view.data.summary).toEqual(SUMMARY);
    // ALL resolved from warehouse bounds — history queried with the first activity day
    expect(history.getAccountSummaryFromHistory).toHaveBeenCalledWith("2025-02-20", expect.any(String));
    // Bounds fetched exactly once (passed through, not re-fetched)
    expect(history.getHistoryBounds).toHaveBeenCalledTimes(1);
  });
});

describe("getGoogleAdsPageData", () => {
  it("serves synced windows from the warehouse with live keyword/conversion fill-ins", async () => {
    const { getGoogleAdsPageData } = await importAssembly();
    const data = await getGoogleAdsPageData("all");

    expect(data.summary).toEqual(SUMMARY);
    expect(history.getAccountSummaryFromHistory).toHaveBeenCalledWith("2025-02-20", expect.any(String));
    expect(live.getCachedKeywordPerformanceForRange).toHaveBeenCalled();
    expect(live.getCachedCostPerConversionForRange).toHaveBeenCalled();
    // Warehouse path must not run the live equivalents of warehouse data
    expect(live.getCachedAccountSummaryForRange).not.toHaveBeenCalled();
    expect(data.keywords).toEqual([{ keyword: "deck software" }]);
    expect(data.conversions).toEqual([{ actionName: "signup" }]);
    expect(data.history).toEqual({ firstDay: "2025-02-20", lastDay: "2026-03-09" });
  });

  it("goes fully live for windows with no synced rows", async () => {
    history.hasHistoryData.mockResolvedValue(false);
    const { getGoogleAdsPageData } = await importAssembly();
    const data = await getGoogleAdsPageData("30d");

    expect(live.getCachedAccountSummaryForRange).toHaveBeenCalled();
    expect(history.getAccountSummaryFromHistory).not.toHaveBeenCalled();
    // History bounds still attached so the page can show the paused line
    expect(data.history).toEqual({ firstDay: "2025-02-20", lastDay: "2026-03-09" });
  });

  it("returns the not-configured envelope without touching any source", async () => {
    live.isGoogleAdsConfigured.mockReturnValue(false);
    const { getGoogleAdsPageData } = await importAssembly();
    const data = await getGoogleAdsPageData("30d");

    expect(data.adsAvailable).toBe(false);
    expect(history.getHistoryBounds).not.toHaveBeenCalled();
    expect(live.getCachedAccountSummaryForRange).not.toHaveBeenCalled();
  });

  it("survives a failing warehouse read via safe() fallbacks", async () => {
    history.getAccountSummaryFromHistory.mockRejectedValue(new Error("db down"));
    const { getGoogleAdsPageData } = await importAssembly();
    const data = await getGoogleAdsPageData("all");

    expect(data.adsAvailable).toBe(true);
    expect(data.summary).toBeNull();
    expect(data.campaigns).toEqual([{ name: "c1" }]);
  });
});
