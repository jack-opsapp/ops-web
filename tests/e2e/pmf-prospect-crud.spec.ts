/**
 * Playwright E2E Test: PMF Prospect CRUD
 *
 * Covers prospect creation flows on the /admin/pmf tracking dashboard:
 *  - Create a prospect and confirm it surfaces on the dashboard pipeline.
 *
 * Requirements:
 *  - Local dev server on port 3000 (Playwright config handles `webServer`).
 *  - All tests in this describe are skipped unless both E2E_ADMIN_EMAIL and
 *    E2E_ADMIN_PASSWORD are set AND the admin account exists. The admin
 *    surface is a server component gated by `requireAdmin`, so there is no
 *    viable client-side mock that reaches these pages.
 *  - Form selectors below favour accessible labels; if the real form uses
 *    different patterns (radio groups, combobox, custom selects), adjust the
 *    selectors to match.
 */

import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/pmf-auth";

test.describe("PMF prospect CRUD", () => {
  test.skip(
    !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD,
    "Requires E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD env vars and a provisioned admin account"
  );

  test("create prospect -> appears on dashboard pipeline", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/pmf/prospects/new");
    // The form field selectors may need adjustment to match the real modal/form.
    // Use `data-testid` where possible, fall back to labels.
    await page.getByLabel(/name/i).first().fill("Ada Lovelace");
    await page
      .getByLabel(/company/i)
      .first()
      .fill("Analytical Engine Co");
    // deal_type + source may be radios, selects, or buttons — adjust as needed.
    await page.getByRole("button", { name: /CREATE|SUBMIT/i }).click();
    await expect(page).toHaveURL(/\/admin\/pmf\/prospects\/[a-z0-9-]+/);
    await page.goto("/admin/pmf");
    await expect(page.getByText("Analytical Engine Co")).toBeVisible();
  });
});
