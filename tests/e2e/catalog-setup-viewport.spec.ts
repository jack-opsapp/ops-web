import { test, type Page } from "@playwright/test";
import {
  createFixtures,
  expect,
  fulfillJson,
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
type Box = { x: number; y: number; width: number; height: number };
const GUIDED_VIEWPORTS = [
  { width: 915, height: 685, label: "failing production capture" },
  { width: 1280, height: 720, label: "compact desktop" },
  { width: 1440, height: 900, label: "large desktop" },
  { width: 390, height: 844, label: "narrow responsive" },
] as const;

const FIRST_TURN_SESSION = {
  id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
  status: "interviewing",
  version: 1,
  inputRevision: 0,
  processedInputRevision: 0,
  facts: [],
  conversation: [
    {
      id: "assistant:1:first-service-line",
      role: "assistant",
      kind: "text",
      content: "What service do you want to set up first?",
      version: 1,
    },
  ],
  unresolvedQuestions: [
    {
      id: "first-service-line",
      prompt: "What service do you want to set up first?",
      answerKind: "text",
      factKeys: ["customer_products.first_service_line"],
      help: "Describe the service, or upload a CSV or Excel price sheet.",
    },
  ],
  proposedPlan: null,
  proposedPlanHash: null,
  readback: null,
};

const LONG_CONVERSATION_SESSION = {
  ...FIRST_TURN_SESSION,
  version: 9,
  conversation: [
    ...Array.from({ length: 4 }, (_, index) => [
      {
        id: `assistant:${index * 2 + 1}:history-${index}`,
        role: "assistant",
        kind: "text",
        content: `Earlier setup question ${index + 1}`,
        version: index * 2 + 1,
      },
      {
        id: `operator:${index * 2 + 2}:history-${index}`,
        role: "operator",
        kind: "text",
        content: `Earlier setup answer ${index + 1}`,
        version: index * 2 + 2,
      },
    ]).flat(),
    {
      id: "assistant:9:latest-service",
      role: "assistant",
      kind: "text",
      content: "Which service should be next in your catalog?",
      version: 9,
    },
  ],
  unresolvedQuestions: [
    {
      id: "latest-service",
      prompt: "Which service should be next in your catalog?",
      answerKind: "text",
      factKeys: ["customer_products.next_service_line"],
      help: "Use the name your crew and customers already recognize.",
    },
  ],
};

const MULTIPLE_CHOICE_SESSION = {
  ...FIRST_TURN_SESSION,
  version: 17,
  facts: Array.from({ length: 17 }, (_, index) => ({
    key: `confirmed.${index}`,
    value: true,
    status: "confirmed",
    source: { kind: "operator" },
  })),
  conversation: [
    {
      id: "assistant:17:membrane-inventory",
      role: "assistant",
      kind: "text",
      content:
        "How should OPS handle DekSmart membrane purchasing and inventory for vinyl decking?",
      version: 17,
    },
  ],
  unresolvedQuestions: [
    {
      id: "membrane-inventory",
      prompt:
        "How should OPS handle DekSmart membrane purchasing and inventory for vinyl decking?",
      answerKind: "single_choice",
      factKeys: ["materials.deksmart.inventory_method"],
      help: "This decides whether vinyl decking is only a quote product for now, or whether OPS should also create material quantity, purchasing, and inventory rules.",
      options: [
        "Do not track membrane inventory yet; staff purchase/order manually per job, and the product quote price is enough for now.",
        "Track membrane as inventory by sq ft; calculate needed material from quoted deck sq ft plus a staff-adjusted waste allowance.",
        "Track membrane as rolls/sheets; purchasing and inventory need roll/sheet dimensions, coverage, and cost details before setup can be ready.",
      ],
    },
  ],
};

async function gotoWizard(page: Page) {
  const errors = trackBrowserErrors(page);
  await page.setViewportSize(VIEWPORT);
  await seedCatalogWizardAuth(page);
  await mockWizardRoutes(page, createFixtures());
  // Enter via the 0/0 takeover (client-side push) — the harness auth is
  // client-seeded, so a direct document load of /catalog/setup 404s.
  await page.goto("/catalog", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
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

async function gotoGuidedFirstTurn(
  page: Page,
  viewport: (typeof GUIDED_VIEWPORTS)[number],
  session: unknown = FIRST_TURN_SESSION
) {
  const errors = trackBrowserErrors(page);
  await page.setViewportSize(viewport);
  await seedCatalogWizardAuth(page);
  await mockWizardRoutes(page, createFixtures());
  await page.route("**/api/catalog/setup/sessions", async (route) => {
    await fulfillJson(route, {
      session,
      agentAvailable: true,
      resumed: false,
    });
  });
  await page.goto("/catalog/setup", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  try {
    await expect(page.getByTestId("guided-catalog-interview")).toBeVisible({
      timeout: 20000,
    });
  } catch (failure) {
    const details = page.getByRole("button", { name: "Error Details" });
    if (await details.isVisible().catch(() => false)) {
      await details.click({ force: true });
    }
    const renderedError = await page.locator("body").innerText();
    throw new Error(
      [
        failure instanceof Error ? failure.message : String(failure),
        renderedError,
        ...errors,
      ].join("\n\n")
    );
  }
}

async function expectBoxInside(child: Box, parent: Box, label: string) {
  expect(child.x, `${label} left edge`).toBeGreaterThanOrEqual(parent.x - 0.5);
  expect(child.y, `${label} top edge`).toBeGreaterThanOrEqual(parent.y - 0.5);
  expect(child.x + child.width, `${label} right edge`).toBeLessThanOrEqual(
    parent.x + parent.width + 0.5
  );
  expect(child.y + child.height, `${label} bottom edge`).toBeLessThanOrEqual(
    parent.y + parent.height + 0.5
  );
}

test.describe("Guided Catalog Setup conversation viewports", () => {
  test.describe.configure({ timeout: 90000 });

  for (const viewport of GUIDED_VIEWPORTS) {
    test(`${viewport.width}×${viewport.height}: first question and controls remain fully visible`, async ({
      page,
    }) => {
      await gotoGuidedFirstTurn(page, viewport);

      const transcript = page.getByRole("log", {
        name: "Catalog setup conversation",
      });
      const interview = page.getByTestId("guided-catalog-interview");
      const transcriptBox = await transcript.boundingBox();
      const interviewBox = await interview.boundingBox();
      expect(transcriptBox).not.toBeNull();
      expect(interviewBox).not.toBeNull();
      expect(
        Math.abs(transcriptBox!.y - interviewBox!.y),
        "the transcript should start at the top of the full-bleed conversation"
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(
          transcriptBox!.y +
            transcriptBox!.height -
            (interviewBox!.y + interviewBox!.height)
        ),
        "the transcript should extend to the bottom of the full-bleed conversation"
      ).toBeLessThanOrEqual(0.5);

      for (const [locator, label] of [
        [page.getByText("PHASE C", { exact: true }), "PHASE C label"],
        [
          page.getByText("What service do you want to set up first?", {
            exact: true,
          }),
          "first question",
        ],
        [
          page.getByText(
            "Describe the service, or upload a CSV or Excel price sheet.",
            { exact: true }
          ),
          "optional helper",
        ],
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${label} has a border box`).not.toBeNull();
        await expectBoxInside(box!, transcriptBox!, label);
      }

      const composerSurface = page.getByTestId("guided-catalog-composer");
      const composerSurfaceBox = await composerSurface.boundingBox();
      expect(composerSurfaceBox).not.toBeNull();
      expect(
        composerSurfaceBox!.height,
        "the floating composer should remain visually subordinate"
      ).toBeLessThanOrEqual(viewport.width < 600 ? 116 : 92);
      expect(
        composerSurfaceBox!.y,
        "the composer should float over the transcript"
      ).toBeGreaterThan(transcriptBox!.y);
      expect(
        composerSurfaceBox!.y + composerSurfaceBox!.height,
        "the composer should remain inside the transcript viewport"
      ).toBeLessThanOrEqual(transcriptBox!.y + transcriptBox!.height + 0.5);

      const textbox = page.getByRole("textbox");
      const textboxBox = await textbox.boundingBox();
      expect(textboxBox).not.toBeNull();
      expect(
        textboxBox!.height,
        "the composer must stay compact and subordinate"
      ).toBeLessThanOrEqual(40);

      const sendAction = page.getByRole("button", {
        name: "SEND",
        exact: true,
      });
      const sendActionBox = await sendAction.boundingBox();
      expect(sendActionBox).not.toBeNull();
      expect(
        sendActionBox!.height,
        "the composer send action must remain in the dense-control tier"
      ).toBeLessThanOrEqual(32.5);
      expect(sendActionBox!.width).toBeLessThanOrEqual(80);
      const sendIconBox = await sendAction.locator("svg").boundingBox();
      expect(sendIconBox).not.toBeNull();
      expect(sendIconBox!.width).toBeLessThanOrEqual(16.5);
      expect(sendIconBox!.height).toBeLessThanOrEqual(16.5);

      const uploadAction = page.getByRole("button", {
        name: "UPLOAD PRICE SHEET",
        exact: true,
      });
      expect(
        await uploadAction.evaluate(
          (element) => getComputedStyle(element).borderTopWidth
        ),
        "the attachment action must remain a quiet ghost utility"
      ).toBe("0px");
      const uploadIconBox = await uploadAction.locator("svg").boundingBox();
      expect(uploadIconBox).not.toBeNull();
      expect(uploadIconBox!.width).toBeLessThanOrEqual(16.5);
      expect(uploadIconBox!.height).toBeLessThanOrEqual(16.5);
      await expect(
        composerSurface.getByRole("button", {
          name: "UPLOAD PRICE SHEET",
          exact: true,
        })
      ).toHaveCount(1);

      const outerScroll = page.getByTestId("guided-catalog-scroll-region");
      const outerState = await outerScroll.evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      expect(outerState.overflowY).toBe("hidden");
      expect(outerState.scrollTop).toBe(0);
      expect(outerState.scrollHeight).toBeLessThanOrEqual(
        outerState.clientHeight + 1
      );

      const transcriptState = await transcript.evaluate((element) => ({
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      expect(
        transcriptState.scrollHeight,
        "a short first turn should not need transcript scrolling"
      ).toBeLessThanOrEqual(transcriptState.clientHeight + 1);
      expect(transcriptState.scrollTop).toBe(0);

      for (const controlName of [
        "SEND",
        "UPLOAD PRICE SHEET",
        "[ start over ]",
        "[ use another method ]",
        "[ back to catalog ]",
      ]) {
        const control = page.getByRole("button", {
          name: controlName,
          exact: true,
        });
        const controlBox = await control.boundingBox();
        expect(controlBox, `${controlName} has a border box`).not.toBeNull();
        expect(controlBox!.y, `${controlName} top edge`).toBeGreaterThanOrEqual(
          0
        );
        expect(
          controlBox!.y + controlBox!.height,
          `${controlName} bottom edge`
        ).toBeLessThanOrEqual(viewport.height + 0.5);
      }

      for (const controlName of [
        "[ start over ]",
        "[ use another method ]",
        "[ back to catalog ]",
      ]) {
        const control = page.getByRole("button", {
          name: controlName,
          exact: true,
        });
        await expect(
          composerSurface.getByRole("button", {
            name: controlName,
            exact: true,
          }),
          `${controlName} should float outside the composer surface`
        ).toHaveCount(0);
        expect(
          await control.evaluate(
            (element) => getComputedStyle(element).borderTopWidth
          ),
          `${controlName} should use the chip treatment`
        ).toBe("1px");
      }

      await page.screenshot({
        path: `docs/artifacts/guided-catalog-setup/after-${viewport.width}x${viewport.height}.png`,
        fullPage: false,
      });
    });
  }

  test("915×685: a longer transcript keeps the newest exchange visible without moving the page", async ({
    page,
  }) => {
    await gotoGuidedFirstTurn(
      page,
      GUIDED_VIEWPORTS[0],
      LONG_CONVERSATION_SESSION
    );

    const transcript = page.getByRole("log", {
      name: "Catalog setup conversation",
    });
    const composer = page.getByTestId("guided-catalog-composer");
    const transcriptBox = await transcript.boundingBox();
    const composerBox = await composer.boundingBox();
    const latestMessage = page
      .locator('[data-message-role="assistant"]')
      .filter({ hasText: "Which service should be next in your catalog?" });
    const latestBox = await latestMessage.boundingBox();
    expect(transcriptBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(latestBox).not.toBeNull();
    await expectBoxInside(
      latestBox!,
      transcriptBox!,
      "latest assistant message"
    );
    expect(
      latestBox!.y + latestBox!.height,
      "the measured bottom spacer should keep the newest message clear of the floating composer"
    ).toBeLessThanOrEqual(composerBox!.y - 0.5);

    const transcriptState = await transcript.evaluate((element) => ({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(transcriptState.scrollHeight).toBeGreaterThan(
      transcriptState.clientHeight
    );
    expect(transcriptState.scrollTop).toBeGreaterThan(0);
    expect(
      await page
        .getByTestId("guided-catalog-scroll-region")
        .evaluate((element) => element.scrollTop)
    ).toBe(0);

    await page.screenshot({
      path: "docs/artifacts/guided-catalog-setup/after-long-915x685.png",
      fullPage: false,
    });
  });

  test("915×685: long quick answers stay readable in the transcript and controls keep dense geometry", async ({
    page,
  }) => {
    await gotoGuidedFirstTurn(
      page,
      GUIDED_VIEWPORTS[0],
      MULTIPLE_CHOICE_SESSION
    );

    const transcript = page.getByRole("log", {
      name: "Catalog setup conversation",
    });
    const composer = page.getByTestId("guided-catalog-composer");
    const quickAnswers = page.locator('[aria-label="Quick answers"]');
    const questionMessage = page
      .locator('[data-message-role="assistant"]')
      .filter({
        hasText:
          "How should OPS handle DekSmart membrane purchasing and inventory for vinyl decking?",
      });
    const transcriptBox = await transcript.boundingBox();
    const composerBox = await composer.boundingBox();
    const questionBox = await questionMessage.boundingBox();
    const quickAnswersBox = await quickAnswers.boundingBox();
    expect(transcriptBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(questionBox).not.toBeNull();
    expect(quickAnswersBox).not.toBeNull();

    const answerField = page.getByRole("textbox");
    await expect(answerField).toHaveAttribute(
      "placeholder",
      "Pick an option above, or type something else"
    );
    await answerField.focus();
    const answerTypography = await answerField.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontFamily: style.fontFamily,
        fontSize: Number.parseFloat(style.fontSize),
      };
    });
    expect(answerTypography.fontFamily).toContain("Mohave");
    expect(answerTypography.fontSize).toBe(14);
    const composerSurface = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backdropFilter: style.backdropFilter,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: Number.parseFloat(style.borderRadius),
        boxShadow: style.boxShadow,
      };
    });
    expect(composerSurface.borderRadius).toBeGreaterThanOrEqual(4.5);
    expect(composerSurface.borderRadius).toBeLessThanOrEqual(5.5);
    expect(composerSurface.backdropFilter).not.toBe("none");
    expect(composerSurface.backgroundColor).not.toBe("rgb(0, 0, 0)");
    expect(composerSurface.borderColor).toBe("rgba(255, 255, 255, 0.18)");
    expect(composerSurface.boxShadow).toBe("none");

    await expectBoxInside(
      questionBox!,
      transcriptBox!,
      "assistant question with quick answers"
    );
    expect(
      quickAnswersBox!.y + quickAnswersBox!.height,
      "expanded quick answers must clear the floating composer"
    ).toBeLessThanOrEqual(composerBox!.y - 0.5);

    const quickAnswerScroll = await quickAnswers.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(
      quickAnswerScroll.scrollHeight,
      "quick answers must expand instead of becoming a clipped nested scroll region"
    ).toBeLessThanOrEqual(quickAnswerScroll.clientHeight + 1);
    expect(quickAnswerScroll.overflowY).not.toBe("auto");
    expect(quickAnswerScroll.overflowY).not.toBe("scroll");

    const choiceButtons = quickAnswers.getByRole("button");
    await expect(choiceButtons).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      const choice = choiceButtons.nth(index);
      const choiceBox = await choice.boundingBox();
      expect(choiceBox, `choice ${index + 1} has a border box`).not.toBeNull();
      await expectBoxInside(
        choiceBox!,
        quickAnswersBox!,
        `choice ${index + 1}`
      );
      const typography = await choice.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontFamily: style.fontFamily,
          fontSize: Number.parseFloat(style.fontSize),
          textAlign: style.textAlign,
          textTransform: style.textTransform,
        };
      });
      expect(typography.fontFamily).toContain("Mohave");
      expect(typography.fontSize).toBeLessThanOrEqual(16);
      expect(typography.textAlign).toBe("left");
      expect(typography.textTransform).toBe("none");
    }

    const optionsToggle = questionMessage.getByRole("button", {
      name: /options/i,
    });
    await expect(optionsToggle).toHaveAttribute("aria-expanded", "true");
    await optionsToggle.click();
    await expect(optionsToggle).toHaveAttribute("aria-expanded", "false");
    await expect(quickAnswers).toBeHidden();
    await expect(
      questionMessage.getByText(
        "How should OPS handle DekSmart membrane purchasing and inventory for vinyl decking?",
        { exact: true }
      )
    ).toBeVisible();
    await optionsToggle.click();
    await expect(optionsToggle).toHaveAttribute("aria-expanded", "true");
    await expect(quickAnswers).toBeVisible();

    const send = page.getByRole("button", { name: "SEND", exact: true });
    const uploadRow = page
      .getByRole("button", { name: "UPLOAD PRICE SHEET", exact: true })
      .locator("xpath=..");
    const sendBox = await send.boundingBox();
    const uploadRowBox = await uploadRow.boundingBox();
    expect(sendBox).not.toBeNull();
    expect(uploadRowBox).not.toBeNull();
    expect(
      composerBox!.x + composerBox!.width - (sendBox!.x + sendBox!.width),
      "SEND needs a deliberate inset from the composer's right edge"
    ).toBeGreaterThanOrEqual(12);
    expect(
      uploadRowBox!.y - (sendBox!.y + sendBox!.height),
      "SEND needs a deliberate inset above the upload divider"
    ).toBeGreaterThanOrEqual(4);

    const footer = page.getByTestId("guided-catalog-footer-actions");
    const footerBox = await footer.boundingBox();
    const firstChip = footer.getByRole("button").first();
    const firstChipBox = await firstChip.boundingBox();
    expect(footerBox).not.toBeNull();
    expect(firstChipBox).not.toBeNull();
    expect(
      Math.abs(firstChipBox!.x - composerBox!.x),
      "footer chips should align to the left edge of the composer"
    ).toBeLessThanOrEqual(0.5);
    const chipSurface = await firstChip.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backdropFilter: style.backdropFilter,
        backgroundColor: style.backgroundColor,
      };
    });
    expect(chipSurface.backdropFilter).not.toBe("none");
    expect(chipSurface.backgroundColor).not.toBe("rgb(0, 0, 0)");

    await page.screenshot({
      path: "docs/artifacts/guided-catalog-setup/after-choices-915x685.png",
      fullPage: false,
    });
  });
});

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
        `driver-source-${source} must sit fully inside ${VIEWPORT.width}×${VIEWPORT.height}`
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
