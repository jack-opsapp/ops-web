import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60_000);

const ARTIFACT_DIRECTORY = resolve(process.cwd(), "docs/artifacts/mcp-guide");

const VIEWPORTS = [
  { width: 375, height: 812, label: "phone" },
  { width: 768, height: 900, label: "tablet" },
  { width: 1024, height: 768, label: "laptop" },
  { width: 1440, height: 900, label: "desktop" },
] as const;

async function openGuide(page: Page, viewport: (typeof VIEWPORTS)[number]) {
  await page.setViewportSize(viewport);
  const response = await page.goto("/developers/mcp", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "OPS MCP server" })
  ).toBeVisible();
  await page.waitForLoadState("load");
}

test.describe("public MCP developer guide", () => {
  test.beforeAll(() => {
    mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });
  });

  for (const viewport of VIEWPORTS) {
    test(`renders the correct guide navigation without overflow at ${viewport.label}`, async ({
      page,
    }) => {
      await openGuide(page, viewport);

      const overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(
        overflow.clientWidth + 1
      );

      const desktopNavigation = page.getByRole("navigation", {
        name: "MCP guide",
      });
      const mobileSummary = page
        .locator("summary")
        .filter({ hasText: "On this page" });
      const mobileNavigation = page.getByRole("navigation", {
        name: "On this page",
      });

      if (viewport.width >= 1280) {
        await expect(desktopNavigation).toBeVisible();
        await expect(mobileSummary).toBeHidden();
        await expect(mobileNavigation).toBeHidden();
      } else {
        await expect(desktopNavigation).toBeHidden();
        await expect(mobileSummary).toBeVisible();
        await expect(mobileNavigation).toBeHidden();
        await mobileSummary.click();
        await expect(mobileNavigation).toBeVisible();
        await expect(
          mobileNavigation.getByRole("link", { name: "Request a tool" })
        ).toBeVisible();
      }

      // Keep framework development controls out of product screenshots.
      await page.locator("nextjs-portal").evaluateAll((elements) => {
        elements.forEach((element) => element.remove());
      });
      await page.screenshot({
        path: resolve(
          ARTIFACT_DIRECTORY,
          `guide-${viewport.width}x${viewport.height}.png`
        ),
      });
      await page.screenshot({
        path: resolve(
          ARTIFACT_DIRECTORY,
          `guide-${viewport.width}x${viewport.height}-full.png`
        ),
        fullPage: true,
      });
    });
  }

  test("marks MCP current in the shared developer header and cross-links REST", async ({
    page,
  }) => {
    await openGuide(page, VIEWPORTS[3]);

    const header = page.getByRole("banner");
    const references = header.getByRole("navigation", {
      name: "Developer references",
    });
    await expect(
      references.getByRole("link", { name: "REST API" })
    ).toHaveAttribute("href", "/developers/api");
    await expect(
      references.getByRole("link", { name: "MCP", exact: true })
    ).toHaveAttribute("href", "/developers/mcp");
    await expect(
      references.getByRole("link", { name: "MCP", exact: true })
    ).toHaveAttribute("aria-current", "page");
  });

  test("lands directly on the tool-request section", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[3]);
    const response = await page.goto("/developers/mcp#request-tool", {
      waitUntil: "load",
      timeout: 60_000,
    });

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/developers\/mcp#request-tool$/);
    await expect(page.locator("#request-tool")).toBeInViewport();
    await expect(
      page.getByRole("heading", { name: "Request a tool" })
    ).toBeVisible();
  });

  test("copies the endpoint and confirms the clipboard write", async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openGuide(page, VIEWPORTS[3]);

    const copyButton = page.getByRole("button", {
      name: "Copy: MCP endpoint",
    });
    await copyButton.click();

    await expect(copyButton).toContainText("Copied");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("https://app.opsapp.co/api/mcp");
  });

  test("uses the support mailto with an encoded tool-request subject", async ({
    page,
  }) => {
    await openGuide(page, VIEWPORTS[3]);

    await expect(
      page.getByRole("link", { name: "support@opsapp.co", exact: true })
    ).toHaveAttribute(
      "href",
      /^mailto:support@opsapp\.co\?subject=OPS%20MCP%20tool%20request&/
    );
  });

  test("removes copy and request-action transitions under reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openGuide(page, VIEWPORTS[3]);

    await expect(
      page.getByRole("button", { name: "Copy: MCP endpoint" })
    ).toHaveCSS("transition-property", "none");
    await expect(
      page.getByRole("link", { name: "Email the request" })
    ).toHaveCSS("transition-property", "none");
  });
});
