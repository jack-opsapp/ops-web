/**
 * Playwright E2E — /inbox route gating
 *
 * Verifies that the server-side gate on /inbox (and /inbox/[threadId]) redirects
 * to /pipeline when the company's inbox_ui flag is off, and renders the inbox
 * surface when it is on.
 *
 * Requirements:
 *   - A local dev server (Playwright webServer in playwright.config.ts).
 *   - Gate-disabled tests: skipped unless E2E_USER_EMAIL + E2E_USER_PASSWORD
 *     are set AND the test account's company has inbox_ui = false (the default).
 *   - Gate-enabled test: additionally requires E2E_INBOX_USER_EMAIL +
 *     E2E_INBOX_USER_PASSWORD for a company with inbox_ui = true.
 *
 * These tests will run fully in T13 / CI once credentials are provisioned.
 * The skip guards are the correct pattern — do NOT remove them.
 */

import { test, expect } from "@playwright/test";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loginAs(
  page: import("@playwright/test").Page,
  email: string,
  password: string
) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  // Wait for redirect away from /login to confirm successful auth
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 15_000,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("/inbox server-side gate", () => {
  // ── Unauthenticated: no skip guard, always runs ───────────────────────────

  test("unauthenticated user visiting /inbox is redirected away", async ({
    page,
  }) => {
    await page.goto("/inbox");
    // Should land on /login (unauthenticated dashboard access → login redirect)
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated user visiting /inbox/<threadId> is redirected away", async ({
    page,
  }) => {
    await page.goto("/inbox/thread-abc123");
    await expect(page).toHaveURL(/\/login/);
  });

  // ── Gate OFF: inbox_ui = false (default) ─────────────────────────────────

  test.describe("inbox_ui flag OFF", () => {
    test.skip(
      !process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD,
      "Requires E2E_USER_EMAIL + E2E_USER_PASSWORD for a company with inbox_ui disabled"
    );

    test("authenticated user is redirected to /pipeline when inbox_ui is off", async ({
      page,
    }) => {
      await loginAs(
        page,
        process.env.E2E_USER_EMAIL!,
        process.env.E2E_USER_PASSWORD!
      );
      await page.goto("/inbox");
      await expect(page).toHaveURL(/\/pipeline/);
    });

    test("authenticated user visiting /inbox/<threadId> is redirected to /pipeline when inbox_ui is off", async ({
      page,
    }) => {
      await loginAs(
        page,
        process.env.E2E_USER_EMAIL!,
        process.env.E2E_USER_PASSWORD!
      );
      await page.goto("/inbox/some-thread-id");
      await expect(page).toHaveURL(/\/pipeline/);
    });
  });

  // ── Gate ON: inbox_ui = true ──────────────────────────────────────────────

  test.describe("inbox_ui flag ON", () => {
    test.skip(
      !process.env.E2E_INBOX_USER_EMAIL || !process.env.E2E_INBOX_USER_PASSWORD,
      "Requires E2E_INBOX_USER_EMAIL + E2E_INBOX_USER_PASSWORD for a company with inbox_ui enabled"
    );

    test("authenticated user with inbox_ui ON can access /inbox", async ({
      page,
    }) => {
      await loginAs(
        page,
        process.env.E2E_INBOX_USER_EMAIL!,
        process.env.E2E_INBOX_USER_PASSWORD!
      );
      await page.goto("/inbox");
      // Should stay on /inbox — not redirected
      await expect(page).toHaveURL(/\/inbox/);
    });
  });
});
