/**
 * Playwright E2E: Inbox redesign populated visual fixture
 *
 * Captures a populated selected-thread screenshot through the real dashboard
 * shell and production inbox route. The fixture intercepts only the inbox
 * and linked-context reads needed to render a stable selected thread.
 */

import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  inboxPopulatedFixture,
  installInboxPopulatedFixture,
  type InboxPopulatedInterceptKey,
} from "./fixtures/inbox-populated";

const SCREENSHOT_PATH = "output/inbox-p4-9-populated-verification.png";
const POPOVER_SCREENSHOT_PATH = "output/inbox-p5-1-popovers-verification.png";

const REQUIRED_INTERCEPTS: InboxPopulatedInterceptKey[] = [
  "api:threads",
  "api:thread-detail",
  "api:drafts",
  "api:attachments",
  "supabase:clients",
  "supabase:sub_clients",
  "supabase:email_threads",
  "supabase:opportunity_email_threads",
  "supabase:opportunities",
  "supabase:projects",
  "supabase:project_tasks",
  "supabase:project_photos",
  "supabase:estimates",
  "supabase:invoices",
];

async function openPopulatedInbox(page: import("@playwright/test").Page) {
  const inboxPath = `/inbox/${inboxPopulatedFixture.threadId}`;
  const routeOptions = {
    timeout: 45_000,
    waitUntil: "domcontentloaded" as const,
  };

  await page.goto(inboxPath, routeOptions);

  const threadListReady = await page
    .getByRole("complementary", { name: /thread list/i })
    .isVisible({ timeout: 12_000 })
    .catch(() => false);

  if (!threadListReady) {
    await page.goto(inboxPath, routeOptions);
  }

  await expect(page).toHaveURL(new RegExp(`${inboxPath}$`), {
    timeout: 20_000,
  });
}

async function removeNextDevOverlay(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      nextjs-toast,
      [data-nextjs-toast],
      [data-nextjs-dialog-overlay],
      [data-nextjs-dev-tools-button],
      [data-nextjs-build-indicator] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `,
  });

  await page.evaluate(() => {
    for (const selector of ["nextjs-portal", "nextjs-toast"]) {
      document
        .querySelectorAll(selector)
        .forEach((element) => element.remove());
    }
  });
}

test.describe("inbox redesign - populated visual verification", () => {
  test.setTimeout(60_000);

  test("captures dense snooze and recategorize popovers", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installInboxPopulatedFixture(page);

    await openPopulatedInbox(page);
    await expect(
      page
        .getByTestId("inbox-center")
        .getByRole("heading", { name: inboxPopulatedFixture.subject })
    ).toBeVisible();

    const center = page.getByTestId("inbox-center");

    await center.getByRole("button", { name: /more actions/i }).click();
    await expect(page.getByTestId("thread-detail-more-menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /mark read/i })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /copy thread link/i })
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /refresh thread/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("thread-detail-more-menu")).toBeHidden();

    await center.getByRole("button", { name: /archive thread/i }).click();
    await expect(page.getByText("// ARCHIVE")).toBeVisible();
    await expect(page.getByText("// THIS THREAD")).toBeVisible();
    await expect(page.getByText("// PIPELINE LEAD")).toBeVisible();
    await page.getByRole("button", { name: "CANCEL", exact: true }).click();
    await expect(page.getByText("// ARCHIVE")).toBeHidden();

    await center.getByRole("button", { name: /snooze thread/i }).click();
    await expect(page.getByText("// SNOOZE")).toBeVisible();
    await expect(page.getByText("[CUSTOM]")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "SET", exact: true })
    ).toBeVisible();
    const snoozePreset = page.getByRole("button", {
      name: /\[TOMORROW 8AM\]/,
    });
    await expect(snoozePreset).toBeVisible();
    const snoozePresetBox = await snoozePreset.boundingBox();
    expect(snoozePresetBox).not.toBeNull();
    expect(snoozePresetBox!.height).toBeLessThan(32);

    await page.keyboard.press("Escape");
    await expect(page.getByText("// SNOOZE")).toBeHidden();

    await center.getByRole("button", { name: /recategorize thread/i }).click();
    await expect(page.getByText("// RECATEGORIZE")).toBeVisible();
    await expect(page.getByText("// CLASSIFIER NOTE — OPTIONAL")).toBeVisible();
    const vendorRow = page.getByRole("button", { name: /VENDOR/i });
    await expect(vendorRow).toBeVisible();
    const vendorRowBox = await vendorRow.boundingBox();
    expect(vendorRowBox).not.toBeNull();
    expect(vendorRowBox!.height).toBeLessThan(32);

    await page.evaluate(() => document.fonts.ready);
    await removeNextDevOverlay(page);
    mkdirSync("output", { recursive: true });
    await page.screenshot({
      path: POPOVER_SCREENSHOT_PATH,
      fullPage: false,
    });
  });

  test("captures selected YOUR MOVE thread with linked context", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const routes = await installInboxPopulatedFixture(page);

    await openPopulatedInbox(page);

    await expect(
      page.getByRole("complementary", { name: /thread list/i })
    ).toBeVisible();
    await expect(
      page.getByTestId("inbox-center").getByRole("main")
    ).toBeVisible();
    const contextRail = page.getByRole("complementary", {
      name: /thread context/i,
    });
    await expect(contextRail).toBeVisible();

    await expect(
      page
        .getByTestId("inbox-center")
        .getByRole("heading", { name: inboxPopulatedFixture.subject })
    ).toBeVisible();
    await expect(
      page.getByText(inboxPopulatedFixture.clientName, { exact: true }).first()
    ).toBeVisible();
    await expect(page.getByTestId("floating-your-turn-badge")).toBeVisible();
    await expect(page.getByText(/\/\/ YOUR TURN/i)).toBeVisible();
    await expect(
      page.getByText(/Send final curb flashing selection/i)
    ).toBeVisible();

    await expect(page.getByTestId("message-bubble")).toHaveCount(3);
    await expect(page.getByText(/Need the final flashing call/i)).toBeVisible();
    await expect(
      page.getByText("attachment", { exact: true }).first()
    ).toBeVisible();

    await expect(page.getByPlaceholder(/\[type message/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "SEND", exact: true })
    ).toBeVisible();
    const floatingComposer = page.getByTestId("floating-composer-frame");
    await expect(floatingComposer).toBeVisible();
    await expect
      .poll(
        () =>
          floatingComposer.evaluate((el) => {
            const parent = el.parentElement;
            if (!parent) return 0;
            return Number.parseFloat(
              getComputedStyle(parent)
                .getPropertyValue("--inbox-floating-composer-height")
                .trim()
            );
          }),
        { timeout: 5_000 }
      )
      .toBeGreaterThan(0);

    const composerBox = await floatingComposer.boundingBox();
    const lastBubbleBox = await page
      .getByTestId("message-bubble")
      .last()
      .boundingBox();
    expect(composerBox).not.toBeNull();
    expect(lastBubbleBox).not.toBeNull();
    expect(lastBubbleBox!.y + lastBubbleBox!.height).toBeLessThanOrEqual(
      composerBox!.y
    );

    const workTab = contextRail.getByRole("tab", { name: /WORK\s+3/i });
    await expect(workTab).toBeVisible();
    await workTab.click();
    await expect(workTab).toHaveAttribute("aria-selected", "true");
    await expect(contextRail.getByTestId("work-view-leads")).toBeVisible();
    await expect(
      contextRail.getByText("Bay three curb flashing")
    ).toBeVisible();
    const activeLead = contextRail.getByTestId(
      `pipeline-opp-${inboxPopulatedFixture.opportunityId}`
    );
    await expect(activeLead).toBeVisible();
    await expect(
      activeLead.getByText("QUOTING", { exact: true })
    ).toBeVisible();
    await expect(activeLead.getByText("HIGH", { exact: true })).toBeVisible();
    await expect(activeLead.getByText("EMAIL", { exact: true })).toBeVisible();
    await expect(activeLead.getByText("[THIS THREAD]")).toBeVisible();
    const wonLead = contextRail.getByTestId(
      `pipeline-opp-${inboxPopulatedFixture.wonOpportunityId}`
    );
    await expect(wonLead).toBeVisible();
    await expect(wonLead.getByText("WON", { exact: true })).toBeVisible();
    await expect(contextRail.getByTestId("work-view-projects")).toBeVisible();
    await expect(
      contextRail.getByTestId(
        `project-group-${inboxPopulatedFixture.projectId}`
      )
    ).toBeVisible();
    await expect(
      contextRail.getByRole("tab", { name: /FILES\s+3/i })
    ).toBeVisible();
    const accountingTab = contextRail.getByRole("tab", {
      name: /ACCOUNTING\s+4/i,
    });
    await expect(accountingTab).toBeVisible();
    await accountingTab.click();
    await expect(accountingTab).toHaveAttribute("aria-selected", "true");
    const totals = contextRail.getByTestId("accounting-totals");
    await expect(totals).toBeVisible();
    await expect(
      contextRail.getByTestId("accounting-totals-estimates")
    ).toContainText("$18,400");
    await expect(
      contextRail.getByTestId("accounting-totals-invoices")
    ).toContainText("$14,400");
    await expect(
      contextRail.getByTestId("accounting-totals-outstanding")
    ).toContainText("$9,400");
    await expect(
      contextRail.getByTestId("accounting-totals-paid")
    ).toContainText("$3,200");
    await expect(
      contextRail.getByTestId("accounting-totals-overdue")
    ).toContainText("$1,800");
    await expect(
      contextRail.getByTestId("accounting-view-estimates")
    ).toBeVisible();
    await expect(
      contextRail.getByText("EST-2041", { exact: true })
    ).toBeVisible();
    await expect(
      contextRail.getByTestId("accounting-view-invoices")
    ).toBeVisible();
    await expect(
      contextRail.getByText("INV-1188", { exact: true })
    ).toBeVisible();
    await expect(
      contextRail.getByText("INV-1189", { exact: true })
    ).toBeVisible();
    await expect(
      contextRail.getByText("INV-1190", { exact: true })
    ).toBeVisible();

    await expect
      .poll(() => [...routes.seen].sort(), {
        timeout: 10_000,
      })
      .toEqual(expect.arrayContaining(REQUIRED_INTERCEPTS));

    await page.evaluate(() => document.fonts.ready);
    await removeNextDevOverlay(page);
    mkdirSync("output", { recursive: true });
    await page.screenshot({
      path: SCREENSHOT_PATH,
      fullPage: false,
    });
  });
});
