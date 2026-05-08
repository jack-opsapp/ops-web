/**
 * Playwright Visual Regression: Project Workspace Modal
 *
 * Captures pixel-perfect baselines for the seven workspace surfaces so
 * any future styling drift (canvas color, glass alpha, hairline,
 * accent-on-link, font-weight regression, etc.) trips the CI bar
 * automatically.
 *
 * Baselines:
 *   1. viewing dossier — default tab (Activity), compact map, sidebar
 *   2. viewing dossier with sidebar expanded (full sidebar interior
 *      visible)
 *   3. viewing dossier with map expanded (legend + toolbar + crumb)
 *   4. editing — Identity tab populated
 *   5. editing — Schedule tab populated
 *   6. creating — Identity tab empty
 *   7. archive ConfirmModal open
 *
 * Status: SKIPPED — this worktree does not provision the visual-test
 * infrastructure. Specifically:
 *   - No `playwright.visual.config.ts` with `expect.toHaveScreenshot`
 *     thresholds + per-OS / per-browser tolerance configured
 *   - No `tests/visual/__screenshots__/` baseline directory committed
 *   - No manager auth fixture (the workspace requires an authenticated
 *     project to render — same gap as Phase 14.3's E2E spec)
 *   - No deterministic seed for project fixtures (timestamps, ids, and
 *     time-since dates would otherwise drift the snapshot every run)
 *
 * Wiring path for future un-skip:
 *   - Add `tests/visual` to `playwright.config.ts.testDir` OR ship a
 *     dedicated `playwright.visual.config.ts` (preferred — visual runs
 *     are slower + want a different reporter).
 *   - Add `loginAsManager` (mirrors loginAsAdmin) — see e2e scaffold at
 *     tests/e2e/project-workspace.spec.ts.
 *   - Seed a deterministic project + activity timeline for the viewing
 *     baselines (frozen createdAt / updated dates + no Mapbox network
 *     dependency in CI — block the request and use a stub tile, or
 *     omit lat/lon so the placeholder renders).
 *   - Run `pnpm playwright test tests/visual --update-snapshots` once
 *     locally to commit the seven baselines into
 *     `tests/visual/__screenshots__/project-workspace.spec.ts/`.
 */

import { test, expect } from "@playwright/test";

const skipReason =
  "Visual regression infra not provisioned: needs playwright.visual.config.ts + loginAsManager fixture + deterministic project seeding";

test.describe("Project workspace — visual regression", () => {
  test.skip(true, skipReason);

  // ── 1. Viewing dossier — default Activity tab ───────────────────────
  test("viewing dossier baseline", async ({ page }) => {
    // TODO(14.4): loginAsManager(page); openProjectWorkspace(page, "p-baseline-1");
    await page.goto("/dashboard");
    const window = page.getByTestId("project-workspace-window");
    await expect(window).toHaveScreenshot("viewing-dossier.png");
  });

  // ── 2. Viewing dossier with sidebar expanded ────────────────────────
  test("viewing dossier — sidebar expanded baseline", async ({ page }) => {
    // TODO(14.4): expand the sidebar before snapshot.
    await page.goto("/dashboard");
    const window = page.getByTestId("project-workspace-window");
    await expect(window).toHaveScreenshot("viewing-sidebar-expanded.png");
  });

  // ── 3. Viewing dossier with map expanded ────────────────────────────
  test("viewing dossier — map expanded baseline", async ({ page }) => {
    // TODO(14.4): click MAP-EXPAND-HINT before snapshot. Disable Mapbox
    // tile fetching to avoid CI flake — use route blocking + a stub
    // texture if needed.
    await page.goto("/dashboard");
    const window = page.getByTestId("project-workspace-window");
    await expect(window).toHaveScreenshot("viewing-map-expanded.png");
  });

  // ── 4. Editing — Identity tab populated ─────────────────────────────
  test("editing — identity tab baseline", async ({ page }) => {
    await page.goto("/dashboard");
    const window = page.getByTestId("project-workspace-window");
    await expect(window).toHaveScreenshot("editing-identity.png");
  });

  // ── 5. Editing — Schedule tab populated ─────────────────────────────
  test("editing — schedule tab baseline", async ({ page }) => {
    await page.goto("/dashboard");
    const window = page.getByTestId("project-workspace-window");
    await expect(window).toHaveScreenshot("editing-schedule.png");
  });

  // ── 6. Creating — Identity tab empty ────────────────────────────────
  test("creating — identity tab baseline", async ({ page }) => {
    await page.goto("/dashboard");
    const window = page.getByTestId("project-workspace-window");
    await expect(window).toHaveScreenshot("creating-identity.png");
  });

  // ── 7. Archive ConfirmModal open ────────────────────────────────────
  test("archive confirm modal baseline", async ({ page }) => {
    await page.goto("/dashboard");
    const modal = page.getByRole("dialog");
    await expect(modal).toHaveScreenshot("archive-confirm-modal.png");
  });
});
