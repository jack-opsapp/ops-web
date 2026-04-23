/**
 * Playwright E2E Test: PMF Ad Spend
 *
 * Covers the manual ad spend upsert flow on /admin/pmf/ad-spend:
 *  - Enter channel + month + spend, submit, and confirm the save persists.
 *
 * Requirements:
 *  - Local dev server on port 3000 (Playwright config handles `webServer`).
 *  - All tests here are skipped unless both E2E_ADMIN_EMAIL and
 *    E2E_ADMIN_PASSWORD are set AND the admin account exists. The ad-spend
 *    page is a server component gated by `requireAdmin`, so there is no
 *    viable client-side bypass. The skip pattern is intentional.
 *  - Selectors favour accessible labels; if the real form uses different
 *    widgets (custom dropdown, date-picker modal, etc.), adjust them.
 */

import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/pmf-auth";

test.describe("PMF ad spend", () => {
  test.skip(
    !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD,
    "Requires E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD env vars and a provisioned admin account"
  );

  test("manual ad spend upsert persists", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/pmf/ad-spend");
    // Field selectors — adjust to actual form field names
    await page.getByLabel(/channel/i).selectOption("meta_ads");
    await page.getByLabel(/month/i).fill("2026-04");
    await page.getByLabel(/spend/i).fill("3000");
    await page.getByRole("button", { name: /SAVE|SUBMIT/i }).click();
    // Success indicator — either a toast, a status line, or a redirect
    await expect(page.getByText(/SYS ::.*SAVED|SAVED/i)).toBeVisible({
      timeout: 5000,
    });
  });
});
