import { test, type Page } from "@playwright/test";
import {
  createFixtures,
  expect,
  mockWizardRoutes,
  seedCatalogWizardAuth,
  trackBrowserErrors,
  useDesktopViewport,
  type WizardFixtures,
} from "./helpers/catalog-setup-auth";

/**
 * OPS Web — Catalog Setup Wizard browser gate (Catalog Setup initiative, Phase 6
 * Task 6.14).
 *
 * Drives the REAL first-run takeover (`CatalogSetupLauncher`) and the REAL
 * `/catalog/setup` wizard (`CatalogSetupRoute` → `SetupWizardShell` →
 * DriverPane / CanvasPane / StagingCardView) end-to-end against the proven
 * deterministic harness (helpers/catalog-setup-auth.ts): seeded admin auth, all
 * Supabase reads empty (0 products / 0 stock) so the takeover shows, and the
 * commit + wizard_analytics WRITES intercepted at the route layer (recorded,
 * synthetic success — NEVER to prod).
 *
 * Scenarios:
 *   1. Happy path — takeover → start → manual SELL cards → accept ≥2 → BUILD IT,
 *      asserting the intercepted commit body (accepted cards, stable sessionId,
 *      mode) and that a wizard_analytics `completed` insert was attempted.
 *   2. Resume — accept 1 card, reload, assert the staged card restores (persisted
 *      Zustand) and the commit route was never called pre-reload.
 *   3. Dedupe — test.fixme: the wired /catalog/setup route never surfaces a
 *      duplicate/merge card (it passes no existingRows and the agent lane that
 *      could emit merge cards is off in this env), so it isn't deterministically
 *      reachable through the real UI.
 *   4. Offline — setOffline(true) → offline banner shows + BUILD IT is held
 *      (commit not called); setOffline(false) → BUILD IT recovers and commits.
 *
 * SKIPPED: the agent-off / guided-describe scenario — the OpenAI key is not set
 * in this env (NEXT_PUBLIC_CATALOG_AGENT_ENABLED is unset), so the describe lane
 * never mounts. Manual is the floor and is what we exercise here.
 *
 * Running (THIS worktree): playwright.config's webServer auto-start uses turbopack,
 * which panics on the worktree's symlinked node_modules. Start a webpack dev server
 * first (`npm run dev:webpack -- --port 3027`) and run against it:
 *   E2E_PORT=3027 node_modules/.bin/playwright test tests/e2e/catalog-setup-wizard.spec.ts --project=chromium --workers=1
 * In the primary (non-symlinked) checkout, `npm run test:e2e -- catalog-setup-wizard`
 * auto-starts the server normally.
 */

const FIRST_SELL_NAME = "Vehicle wrap";
const SECOND_SELL_NAME = "Decal install";

/** Land on /catalog with a 0/0 company and wait for the first-run takeover. */
async function gotoCatalogTakeover(page: Page, fixtures: WizardFixtures) {
  const errors = trackBrowserErrors(page);
  await useDesktopViewport(page);
  await seedCatalogWizardAuth(page);
  await mockWizardRoutes(page, fixtures);

  await page.goto("/catalog", { waitUntil: "domcontentloaded", timeout: 60000 });
  await expect(page.getByTestId("catalog-setup-launcher")).toBeVisible({
    timeout: 20000,
  });
  return errors;
}

/** Enter the wizard from the takeover and pick the manual source. */
async function enterWizardManual(page: Page) {
  await page.getByTestId("catalog-setup-start").click();
  await expect(page.getByTestId("setup-wizard-shell")).toBeVisible({
    timeout: 20000,
  });
  // The picker offers only the wired lanes (manual). Choosing it seeds one blank
  // SELL row on the canvas and swaps the left pane to the conversation.
  await expect(page.getByTestId("driver-source-manual")).toBeVisible({
    timeout: 10000,
  });
  await page.getByTestId("driver-source-manual").click();
  await expect(page.getByTestId("canvas-section-sell")).toBeVisible();
}

/**
 * Fill the currently-open ItemEditor's name + flat price, then DONE. The editor
 * opens automatically when a blank row is added (route's first manual card opens
 * the conversation but NOT the editor; the canvas "add a line" affordance opens
 * the editor). This helper assumes the editor is open.
 */
async function fillOpenEditor(page: Page, name: string, price: string) {
  const editor = page.getByTestId("item-editor");
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.getByLabel("name", { exact: true }).fill(name);
  // FLAT pricing is the default; the single price field is labelled "price".
  await editor.getByLabel("price", { exact: true }).first().fill(price);
  await editor.getByTestId("editor-done").click();
  await expect(editor).toBeHidden({ timeout: 10000 });
}

/**
 * Add a fresh SELL line via the canvas "add a line" affordance (opens the
 * editor), fill it, and accept it. Returns once the card is in the accepted
 * (olive) state on the canvas.
 */
async function addAndAcceptSellCard(page: Page, name: string, price: string) {
  const before = await page.getByTestId("staging-card").count();
  await page.getByTestId("canvas-add-sell").click();
  await fillOpenEditor(page, name, price);
  // The new card is the latest one; locate it by its rendered name.
  const card = page
    .locator('[data-testid="staging-card"]')
    .filter({ hasText: name })
    .first();
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.getByTestId("staging-card-accept").click();
  // Filling the editor sets the card "edited"; accepting promotes it to
  // "accepted" — either is a committable ("added") state.
  await expect(card).toHaveAttribute("data-state", "accepted", { timeout: 10000 });
  // Sanity: a card was added.
  expect(await page.getByTestId("staging-card").count()).toBeGreaterThan(before);
}

test.describe("Catalog Setup Wizard", () => {
  test.describe.configure({ timeout: 90000 });

  test("happy path: takeover → manual SELL cards → BUILD IT commits accepted cards + fires completed analytics", async ({
    page,
  }) => {
    const fixtures = createFixtures();
    await gotoCatalogTakeover(page, fixtures);

    await enterWizardManual(page);

    // The route seeds one blank SELL card on manual pick. Reject it (it has no
    // name/price) and build two complete cards via the canvas affordance so the
    // commit payload is fully controlled.
    const seeded = page.getByTestId("staging-card").first();
    await expect(seeded).toBeVisible({ timeout: 10000 });
    await seeded.getByTestId("staging-card-reject").click();

    await addAndAcceptSellCard(page, FIRST_SELL_NAME, "1200");
    await addAndAcceptSellCard(page, SECOND_SELL_NAME, "150");

    // Running totals reflect two added rows; BUILD IT enables.
    await expect(page.getByTestId("running-totals-added")).toContainText("2");
    const buildIt = page.getByTestId("wizard-build-it");
    await expect(buildIt).toBeEnabled({ timeout: 10000 });

    await buildIt.click();

    // The commit was recorded with exactly the accepted SELL cards.
    await expect
      .poll(() => fixtures.commitCalls.length, { timeout: 15000 })
      .toBe(1);
    const body = fixtures.commitCalls[0].body;
    const cards = (body.cards as Record<string, unknown>[]) ?? [];
    const accepted = cards.filter(
      (c) => c.state === "accepted" || c.state === "edited",
    );
    const names = accepted.map((c) => (c.fields as { name?: string })?.name);
    expect(names).toContain(FIRST_SELL_NAME);
    expect(names).toContain(SECOND_SELL_NAME);
    // Idempotency: a stable sessionId travels with the commit; the hook sends no
    // explicit mode (the route defaults it to "edit" so re-runs merge).
    expect(typeof body.sessionId).toBe("string");
    expect((body.sessionId as string).length).toBeGreaterThan(0);
    expect(body.token).toBeTruthy();

    // Success path: toast + redirect back to /catalog.
    await expect(page).toHaveURL(/\/catalog(\?|$)/, { timeout: 15000 });

    // A wizard_analytics `completed` insert was attempted.
    await expect
      .poll(
        () =>
          fixtures.analyticsInserts.some((r) => r.event === "completed")
            ? 1
            : 0,
        { timeout: 15000 },
      )
      .toBe(1);
  });

  test("resume: an accepted card survives a reload (persisted Zustand) and nothing commits pre-reload", async ({
    page,
  }) => {
    const fixtures = createFixtures();
    await gotoCatalogTakeover(page, fixtures);

    await enterWizardManual(page);

    // Reject the seeded blank, then build + accept one complete card.
    await page
      .getByTestId("staging-card")
      .first()
      .getByTestId("staging-card-reject")
      .click();
    await addAndAcceptSellCard(page, FIRST_SELL_NAME, "1200");
    await expect(page.getByTestId("running-totals-added")).toContainText("1");

    // Nothing has committed — the operator hasn't pressed BUILD IT.
    expect(fixtures.commitCalls).toHaveLength(0);

    // Reload the wizard route directly — the persisted store rehydrates the canvas.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("setup-wizard-shell")).toBeVisible({
      timeout: 20000,
    });

    const restored = page
      .locator('[data-testid="staging-card"]')
      .filter({ hasText: FIRST_SELL_NAME })
      .first();
    await expect(restored).toBeVisible({ timeout: 15000 });
    await expect(restored).toHaveAttribute("data-state", "accepted");
    await expect(page.getByTestId("running-totals-added")).toContainText("1");

    // Still nothing committed after the reload.
    expect(fixtures.commitCalls).toHaveLength(0);
  });

  test.fixme(
    "dedupe: a matched duplicate renders in merge mode and BUILD IT sends a merge, not a second create",
    async () => {
      // The wired /catalog/setup route surfaces NO merge cards: CatalogSetupRoute
      // passes no `existingRows` to SetupWizardShell, and the only source that
      // emits merge-state cards (the guided agent) is disabled in this env. A
      // merge card is therefore not deterministically reachable through the real
      // UI — exercising it would require faking store state, which this harness
      // refuses. Re-enable once the import/QuickBooks dedupe lane lands and the
      // route wires existingRows + merge cards.
    },
  );

  test("offline: BUILD IT is held while offline, then recovers when back online", async ({
    page,
  }) => {
    const fixtures = createFixtures();
    await gotoCatalogTakeover(page, fixtures);

    await enterWizardManual(page);

    await page
      .getByTestId("staging-card")
      .first()
      .getByTestId("staging-card-reject")
      .click();
    await addAndAcceptSellCard(page, FIRST_SELL_NAME, "1200");
    const buildIt = page.getByTestId("wizard-build-it");
    await expect(buildIt).toBeEnabled({ timeout: 10000 });

    // ── Go offline: the banner appears and BUILD IT is held ──
    await page.context().setOffline(true);
    // The banner reacts to the browser `offline` event.
    await expect(page.getByTestId("catalog-setup-offline-banner")).toBeVisible({
      timeout: 10000,
    });

    await buildIt.click();
    // Held: the commit route is NOT called while offline.
    await page.waitForTimeout(1000);
    expect(fixtures.commitCalls).toHaveLength(0);

    // ── Back online: the banner clears and BUILD IT commits ──
    await page.context().setOffline(false);
    await expect(
      page.getByTestId("catalog-setup-offline-banner"),
    ).toBeHidden({ timeout: 10000 });

    await expect(buildIt).toBeEnabled({ timeout: 10000 });
    await buildIt.click();
    await expect
      .poll(() => fixtures.commitCalls.length, { timeout: 15000 })
      .toBe(1);
  });
});
