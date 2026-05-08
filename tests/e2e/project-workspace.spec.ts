/**
 * Playwright E2E Test: Project Workspace Modal
 *
 * Covers the full workspace lifecycle inside the floating-window shell:
 *   1. Operator opens the dashboard
 *   2. Clicks the FAB "New Project" action → workspace opens in
 *      creating mode
 *   3. Fills the title + trade + start/end dates on the IDENTITY tab
 *   4. Switches to the SCHEDULE tab; verifies dates round-trip
 *   5. Clicks CREATE; window meta updates, mode flips to viewing
 *   6. Activity tab is the default; verifies the project_created
 *      timeline row is rendered
 *   7. Clicks EDIT in the footer → mode flips to editing
 *   8. Edits the title; clicks SAVE; mode flips back to viewing; the
 *      title chrome reflects the new title
 *   9. Clicks EDIT → ARCHIVE → ConfirmModal opens → confirm
 *  10. Notification rail shows the archive notification (if the operator
 *      is in the recipient list — for self-archive, server filters out
 *      the actor)
 *  11. The project's status badge renders ARCHIVED
 *  12. Closing the window via the close traffic-light removes the
 *      window from the dock
 *
 * Requirements:
 *  - A local dev server on port 3000 (Playwright config spins it up
 *    automatically).
 *  - E2E_MANAGER_EMAIL + E2E_MANAGER_PASSWORD env vars set, and the
 *    referenced account provisioned with `projects.create`,
 *    `projects.edit`, `projects.archive`, and the financial perms.
 *  - The login flow currently mirrors the admin pattern from
 *    `pmf-auth.ts`. If the manager flow uses a different selector set
 *    (magic link / SSO), wire a manager-specific helper alongside.
 *
 * The full E2E is currently skipped — the worktree does not provision
 * a manager fixture account, and the existing E2E helpers only cover
 * admin login. This scaffold lands the steps so the spec is ready to
 * un-skip once the auth fixture lands.
 */

import { test, expect } from "@playwright/test";

const skipReason =
  "Requires E2E_MANAGER_EMAIL + E2E_MANAGER_PASSWORD env vars and a provisioned manager account with projects.create/edit/archive";

test.describe("Project workspace lifecycle", () => {
  test.describe("authenticated manager flow", () => {
    test.skip(
      !process.env.E2E_MANAGER_EMAIL || !process.env.E2E_MANAGER_PASSWORD,
      skipReason,
    );

    test("creates → edits → archives a project end-to-end", async ({ page }) => {
      // TODO(14.3): wire `loginAsManager` helper alongside `loginAsAdmin`
      // and call here.
      await page.goto("/dashboard");

      // Step 1–2: open creating workspace via the FAB.
      await page.getByRole("button", { name: /new project/i }).click();
      await expect(
        page.getByTestId("project-workspace-window"),
      ).toBeVisible();
      await expect(page.getByTestId("identity-tab-stub")).toBeVisible();

      // Step 3: fill required fields on Identity.
      const title = `E2E Project ${Date.now()}`;
      await page.getByLabel(/project title/i).fill(title);
      await page.getByLabel(/trade/i).selectOption("roofing");
      await page.getByLabel(/start date/i).fill("2026-06-01");
      await page.getByLabel(/end date/i).fill("2026-08-01");

      // Step 4: switch to Schedule, verify dates round-trip.
      await page.getByRole("button", { name: /schedule/i }).click();
      await expect(page.getByLabel(/start date/i)).toHaveValue("2026-06-01");
      await expect(page.getByLabel(/end date/i)).toHaveValue("2026-08-01");

      // Step 5: click CREATE.
      await page.getByRole("button", { name: /create/i }).click();
      // Mode swap — viewing body should now be visible.
      await expect(
        page.getByTestId("project-viewing-body"),
      ).toBeVisible({ timeout: 10000 });

      // Step 6: Activity tab default; project_created row should appear.
      await expect(page.getByTestId("viewing-body-activity")).toBeVisible();
      await expect(
        page.locator('[data-event-kind="project_created"]'),
      ).toBeVisible();

      // Step 7: EDIT.
      await page.getByRole("button", { name: /edit/i }).click();
      await expect(
        page.getByTestId("project-edit-create-form"),
      ).toBeVisible();

      // Step 8: change title + SAVE.
      const renamed = `${title} (renamed)`;
      await page.getByLabel(/project title/i).fill(renamed);
      await page.getByRole("button", { name: /save/i }).click();
      await expect(page.getByText(renamed)).toBeVisible();

      // Step 9: EDIT → ARCHIVE → confirm.
      await page.getByRole("button", { name: /edit/i }).click();
      await page.getByRole("button", { name: /archive/i }).click();
      await page.getByRole("button", { name: /confirm.*archive/i }).click();

      // Step 10–11: status badge renders ARCHIVED in the title bar.
      await expect(page.getByText(/ARCHIVED/i)).toBeVisible();

      // Step 12: close the window via the traffic-light.
      await page
        .getByRole("button", { name: /traffic\.close/i })
        .click();
      await expect(
        page.getByTestId("project-workspace-window"),
      ).not.toBeVisible();
    });
  });
});
