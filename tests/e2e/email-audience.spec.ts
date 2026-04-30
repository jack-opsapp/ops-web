import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// Admin-gated. Skipped unless E2E admin credentials are wired into the
// auth fixture by tests/e2e/helpers/* (PR 5+ adds this fixture).
test.describe.skip("Audience builder E2E (requires admin login fixture)", () => {
  test("build → preview → save template → use in campaign", async ({ page }) => {
    await page.goto(`${BASE}/admin/email`);
    await page.getByRole("tab", { name: /audience/i }).click();
    await page.getByRole("button", { name: /add condition/i }).click();
    // Default condition is pre-populated (subscription_status = trialing).
    await expect(page.locator("text=RECIPIENTS")).toBeVisible();
    // Wait for live count to settle (font-cakemono digit).
    await expect(page.locator("text=/\\d+/").first()).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("button", { name: /save as template/i }).click();
    await page.getByLabel(/name/i).fill("E2E Trialing Users");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/E2E Trialing Users/)).toBeVisible();
  });
});
