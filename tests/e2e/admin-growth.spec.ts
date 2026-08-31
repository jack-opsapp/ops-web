import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/pmf-auth";

const hasAdminCredentials = Boolean(
  process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD
);

const source = (state: string) => ({
  source: "business_records",
  state,
  asOf: "2026-08-30T12:00:00.000Z",
  finalizedThrough: "2026-08-29",
  coverage: { observed: 8, total: 10, ratio: 0.8, label: "Known" },
  detail: "Current",
});

function envelope(state: string, data: unknown) {
  return {
    data,
    state,
    asOf: "2026-08-30T12:00:00.000Z",
    finalizedThrough: "2026-08-27",
    coverage: { observed: 8, total: 10, ratio: 0.8, label: "Known" },
    sources: [source(state)],
  };
}

function overview(state: string) {
  const empty = state === "empty";
  return {
    period: { startDate: "2026-08-01", endDate: "2026-08-30", days: 30 },
    previousPeriod: { startDate: "2026-07-02", endDate: "2026-07-31", days: 30 },
    activatedCompanies: {
      current: empty ? 0 : 4,
      previous: empty ? 0 : 2,
      delta: empty ? 0 : 2,
      changeRatio: empty ? null : 1,
    },
    attributionCoverage: { observed: 8, total: 10, ratio: 0.8, label: "Known" },
    funnel: [
      { key: "trial", value: empty ? 0 : 10, conversionFromTrial: empty ? null : 1 },
      { key: "first_project", value: empty ? 0 : 7, conversionFromTrial: empty ? null : 0.7 },
      { key: "first_value", value: empty ? 0 : 4, conversionFromTrial: empty ? null : 0.4 },
      { key: "paid", value: empty ? 0 : 2, conversionFromTrial: empty ? null : 0.2 },
    ],
    trend: empty ? [] : [{ date: "2026-08-30", trials: 2, firstValue: 1, paid: 1 }],
    sourceLanes: [
      {
        source: "web_search",
        metrics: [
          { key: "impressions", label: "Impressions", value: empty ? 0 : 100 },
          { key: "clicks", label: "Clicks", value: empty ? 0 : 20 },
          { key: "ctr", label: "CTR", value: empty ? null : 0.2 },
          { key: "sessions", label: "Site sessions", value: empty ? 0 : 16 },
          { key: "trials", label: "Trials", value: empty ? 0 : 3 },
        ],
        state,
        finalizedThrough: "2026-08-27",
        note: null,
      },
      {
        source: "app_store",
        metrics: [
          { key: "impressions", label: "Impressions", value: empty ? 0 : 80 },
          { key: "views", label: "Product page views", value: empty ? 0 : 30 },
          { key: "downloads", label: "First-time downloads", value: empty ? 0 : 12 },
          { key: "trials", label: "Trials", value: empty ? 0 : 2 },
        ],
        state: state === "ready" ? "provisional" : state,
        finalizedThrough: "2026-08-28",
        note: "paid_split_unavailable",
      },
    ],
    channels: empty
      ? []
      : [
          {
            channel: "organic_search",
            discovery: 16,
            discoveryLabel: "sessions",
            trials: 3,
            firstValue: 2,
            paid: 1,
            activationRate: 2 / 3,
            revenueCents: 4900,
            confidence: "deterministic",
          },
        ],
    recentPaidSpendCents: 0,
  };
}

const search = {
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

test.describe("founder growth surface", () => {
  test("redirects an unauthenticated visitor", async ({ page }) => {
    await page.goto("/admin/acquisition");
    await expect(page).toHaveURL(/\/(login|signin|$)/);
  });

  test.describe("admin proof", () => {
    test.skip(!hasAdminCredentials, "Requires a provisioned admin account");

    test("has no page overflow at the four required widths", async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto("/admin/acquisition");
      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator("[data-growth-state]")).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        );
        expect(overflow).toBeLessThanOrEqual(0);
      }
    });

    test("captures healthy, partial, failed, empty, and provisional states", async ({
      page,
    }, testInfo) => {
      let state = "ready";
      await page.route("**/api/admin/acquisition/**", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const data = pathname.endsWith("/overview")
          ? overview(state)
          : pathname.endsWith("/search")
            ? search
            : { statuses: [source(state)] };
        await route.fulfill({ json: envelope(state, data) });
      });
      await loginAsAdmin(page);
      await page.goto("/admin/acquisition");
      await page.setViewportSize({ width: 1440, height: 1000 });

      const states = ["ready", "partial", "failed", "empty", "provisional"];
      const channels = [
        "organic_search",
        "referral",
        "direct",
        "app_store_search",
        "all",
      ];
      for (const [index, nextState] of states.entries()) {
        state = nextState;
        await page.getByLabel("Channel lens").selectOption(channels[index]);
        await expect(page.locator(`[data-growth-state="${nextState}"]`)).toBeVisible();
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath(`growth-${nextState}.png`),
        });
      }
    });
  });
});
