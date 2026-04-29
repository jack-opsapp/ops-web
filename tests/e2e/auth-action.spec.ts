import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("Auth action handler", () => {
  test("malformed link → broken-link", async ({ page }) => {
    await page.goto(`${BASE}/auth/action`);
    await expect(
      page.getByRole("heading", { name: /broken|malformed/i }),
    ).toBeVisible();
  });

  test("missing oobCode → broken", async ({ page }) => {
    await page.goto(`${BASE}/auth/action?mode=resetPassword`);
    await expect(
      page.getByRole("heading", { name: /broken/i }),
    ).toBeVisible();
  });

  test("unknown mode → broken", async ({ page }) => {
    await page.goto(`${BASE}/auth/action?mode=banana&oobCode=x`);
    await expect(
      page.getByRole("heading", { name: /broken/i }),
    ).toBeVisible();
  });

  test("valid reset → form → success", async ({ page }) => {
    test.skip(
      !process.env.E2E_FIREBASE_TEST_OOB_CODE,
      "set E2E_FIREBASE_TEST_OOB_CODE for live",
    );
    const code = process.env.E2E_FIREBASE_TEST_OOB_CODE!;
    await page.goto(`${BASE}/auth/action?mode=resetPassword&oobCode=${code}`);
    await expect(page.getByLabel(/new password/i)).toBeVisible({
      timeout: 10_000,
    });
    await page
      .getByLabel(/new password/i)
      .fill("ZebraCorrectHorseBattery2026!");
    await page.getByRole("button", { name: /set password/i }).click();
    await expect(page.getByText(/password reset/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("/open?from=password-reset shows iOS CTA", async ({ page }) => {
    await page.goto(`${BASE}/open?from=password-reset`);
    await expect(page.getByRole("link", { name: /open ops/i })).toBeVisible();
  });
});
