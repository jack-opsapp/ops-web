import { test, type Page } from "@playwright/test";
import {
  createFixtures,
  expect,
  mockWizardRoutes,
  seedCatalogWizardAuth,
  trackBrowserErrors,
} from "./helpers/catalog-setup-auth";

/**
 * OPS Web — Catalog Setup Wizard 13" viewport gate (CATALOG WIZARD P7-1).
 *
 * The wizard is a fullHeight:"bleed" route (no page scroll ≥md) — every pane
 * must hard-bound itself. This spec pins the two P0 regressions from the
 * 2026-07-21 responsive review at the most common laptop viewport (13" 1280×800
 * hardware → ~689px of usable browser viewport):
 *
 *   1. PICKER — "How do you want to start?" and EVERY source option sit fully
 *      inside the viewport with NO scrolling. (At review time the picker's
 *      scroll window measured 0px here — the wizard's entry point simply did
 *      not exist on a 13" laptop.)
 *   2. EDITOR — identity fields are visible the moment the editor opens, the
 *      deepest section is reachable by scrolling the editor's OWN scroll area,
 *      and the pinned footer (DONE) never leaves the viewport.
 *
 * Runs on the same deterministic harness as catalog-setup-wizard.spec.ts
 * (seeded auth, all reads mocked, writes intercepted — never prod). Same run
 * caveat in THIS worktree: start `npm run dev:webpack -- --port 3027` first,
 * then `E2E_PORT=3027 node_modules/.bin/playwright test
 * tests/e2e/catalog-setup-viewport.spec.ts --project=chromium --workers=1`.
 */

const VIEWPORT = { width: 1280, height: 689 };

async function gotoWizard(page: Page) {
  const errors = trackBrowserErrors(page);
  await page.setViewportSize(VIEWPORT);
  await seedCatalogWizardAuth(page);
  await mockWizardRoutes(page, createFixtures());
  // Enter via the 0/0 takeover (client-side push) — the harness auth is
  // client-seeded, so a direct document load of /catalog/setup 404s.
  await page.goto("/catalog", { waitUntil: "domcontentloaded", timeout: 60000 });
  await expect(page.getByTestId("catalog-setup-launcher")).toBeVisible({
    timeout: 20000,
  });
  await page.getByTestId("catalog-setup-start").click();
  await expect(page.getByTestId("setup-wizard-shell")).toBeVisible({
    timeout: 20000,
  });
  return errors;
}

/** True when the element's border box sits fully inside the viewport. */
async function fullyInViewport(page: Page, testId: string): Promise<boolean> {
  const box = await page.getByTestId(testId).first().boundingBox();
  if (!box) return false;
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= VIEWPORT.width &&
    box.y + box.height <= VIEWPORT.height + 0.5
  );
}

test.describe('Catalog Setup Wizard @ 1280×689 (13" laptop)', () => {
  test.describe.configure({ timeout: 90000 });

  test("picker: every source option is fully visible without scrolling", async ({
    page,
  }) => {
    await gotoWizard(page);

    await expect(page.getByText("How do you want to start?")).toBeVisible({
      timeout: 10000,
    });

    // The wired deterministic lanes (agent + QuickBooks are env-gated off in
    // this harness). Each option must sit FULLY inside the viewport — not just
    // "visible" (Playwright counts a clipped element as visible).
    for (const source of ["upload", "template", "manual"]) {
      await expect(page.getByTestId(`driver-source-${source}`)).toBeVisible();
      expect(
        await fullyInViewport(page, `driver-source-${source}`),
        `driver-source-${source} must sit fully inside ${VIEWPORT.width}×${VIEWPORT.height}`,
      ).toBe(true);
    }

    // The header strip stays compact — the 231px chrome that caused the
    // collapse must not creep back.
    const header = await page.getByTestId("wizard-header").boundingBox();
    expect(header).not.toBeNull();
    expect(header!.height).toBeLessThanOrEqual(130);

    // The single primary CTA (disabled, carrying its reason) is on screen.
    await expect(page.getByTestId("wizard-build-it")).toBeVisible();
  });

  test("editor: fields are visible on open and the footer stays reachable", async ({
    page,
  }) => {
    await gotoWizard(page);

    // "Add it yourself" seeds a blank row and opens it straight in the editor.
    await page.getByTestId("driver-source-manual").click();
    const editor = page.getByTestId("item-editor");
    await expect(editor).toBeVisible({ timeout: 10000 });

    // Identity fields are visible immediately — no scroll needed to start.
    const nameField = editor.getByLabel("name", { exact: true });
    await expect(nameField).toBeVisible();
    const nameBox = await nameField.boundingBox();
    expect(nameBox).not.toBeNull();
    expect(nameBox!.y).toBeGreaterThanOrEqual(0);
    expect(nameBox!.y + nameBox!.height).toBeLessThanOrEqual(VIEWPORT.height);

    // The FLAT price field is reachable.
    const price = editor.getByLabel("price", { exact: true }).first();
    await price.scrollIntoViewIfNeeded();
    await expect(price).toBeVisible();

    // The deepest section (RECIPE's add-material) is reachable by scrolling the
    // editor's own scroll area — the pane scrolls, the page does not.
    const addMaterial = editor.getByTestId("recipe-add-material");
    await addMaterial.scrollIntoViewIfNeeded();
    await expect(addMaterial).toBeVisible();
    expect(await fullyInViewport(page, "recipe-add-material")).toBe(true);

    // The footer (taxable + DONE) is pinned inside the pane — always on screen.
    await expect(editor.getByTestId("editor-done")).toBeVisible();
    expect(await fullyInViewport(page, "editor-done")).toBe(true);

    // Round-trip: DONE lands back on the sources — the pane swap never wedges.
    await editor.getByTestId("editor-done").click();
    await expect(page.getByTestId("driver-source-picker")).toBeVisible({
      timeout: 10000,
    });
  });
});
