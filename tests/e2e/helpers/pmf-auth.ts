import type { Page } from "@playwright/test";

/**
 * Logs in an admin user via the standard form. Requires E2E_ADMIN_EMAIL and
 * E2E_ADMIN_PASSWORD env vars to be set, and a provisioned admin account in
 * Firebase Auth that also has admin status in the OPS backend.
 *
 * If your admin login is a different flow (magic link, SSO, etc.), adjust the
 * selectors here to match.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "loginAsAdmin requires E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD env vars"
    );
  }
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in|submit/i }).click();
  // Wait for navigation away from login
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 15000,
  });
}
