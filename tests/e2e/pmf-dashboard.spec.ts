/**
 * Playwright E2E Test: PMF Dashboard
 *
 * Covers the /admin/pmf dashboard surface:
 *  - Unauthenticated users are redirected away from the admin-only route.
 *  - When admin credentials are available, asserts the dashboard renders the
 *    expected sections (Gate B primary markers, leading indicators, Tier A
 *    pipeline, Base SaaS MRR trend) and the countdown chip shows a day count.
 *
 * Requirements:
 *  - A local dev server on port 3000 (Playwright config handles `webServer`
 *    spin-up automatically via `npm run dev`).
 *  - Admin-scoped tests are skipped unless both E2E_ADMIN_EMAIL and
 *    E2E_ADMIN_PASSWORD are set AND the admin account exists in the auth
 *    system. The server-side `requireAdmin` middleware rejects any request
 *    without a valid signed token, so client-side Firebase mocks cannot bypass
 *    the gate. The skip is the correct pattern until a provisioned admin
 *    account is available.
 *  - The unauthenticated-redirect test runs in all environments and provides
 *    real coverage of the gate behaviour.
 */

import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/pmf-auth";

test.describe("PMF dashboard", () => {
  test("redirects unauthenticated user away from /admin/pmf", async ({
    page,
  }) => {
    await page.goto("/admin/pmf");
    // The middleware chain should redirect to /login (or similar). Match either:
    //  - a URL change to /login*
    //  - OR a 401/redirect response
    await expect(page).toHaveURL(/\/(login|signin|$)/);
  });

  test.describe("admin-only views", () => {
    test.skip(
      !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD,
      "Requires E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD env vars and a provisioned admin account"
    );

    test("renders dashboard sections for admin", async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto("/admin/pmf");
      await expect(page.getByText("PMF TRACKING DECK")).toBeVisible();
      await expect(page.getByText(/GATE B.*PRIMARY MARKERS/i)).toBeVisible();
      await expect(page.getByText("LEADING INDICATORS")).toBeVisible();
      await expect(page.getByText(/TIER A PIPELINE/i)).toBeVisible();
      await expect(page.getByText(/BASE SAAS.*MRR TREND/i)).toBeVisible();
    });

    test("renders countdown chip with day count", async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto("/admin/pmf");
      await expect(page.getByText(/GATE B[^\d]*\d+\s*DAYS/i)).toBeVisible();
    });
  });
});
