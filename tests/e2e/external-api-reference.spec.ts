import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60_000);

const ARTIFACT_DIRECTORY = resolve(
  process.cwd(),
  "docs/artifacts/external-api-reference"
);

const VIEWPORTS = [
  { width: 375, height: 812, label: "phone" },
  { width: 768, height: 900, label: "tablet" },
  { width: 1024, height: 768, label: "laptop" },
  { width: 1440, height: 900, label: "desktop" },
] as const;

async function openReference(page: Page, viewport: (typeof VIEWPORTS)[number]) {
  await page.setViewportSize(viewport);
  const response = await page.goto("/developers/api", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "External Lead API",
    })
  ).toBeVisible();
  await page.waitForLoadState("load");
}

test.describe("public external API reference", () => {
  test.beforeAll(() => {
    mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });
  });

  for (const viewport of VIEWPORTS) {
    test(`renders without page overflow at ${viewport.label}`, async ({
      page,
    }) => {
      await openReference(page, viewport);

      const overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(
        overflow.clientWidth + 1
      );

      if (viewport.width >= 1280) {
        await expect(
          page.getByRole("navigation", { name: "API reference" })
        ).toBeVisible();
        await expect(page.getByText("On this page")).toBeHidden();
      } else {
        await expect(page.getByText("On this page")).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "API reference" })
        ).toBeHidden();
      }

      await page.screenshot({
        path: resolve(
          ARTIFACT_DIRECTORY,
          `reference-${viewport.width}x${viewport.height}.png`
        ),
      });
      await page.screenshot({
        path: resolve(
          ARTIFACT_DIRECTORY,
          `reference-${viewport.width}x${viewport.height}-full.png`
        ),
        fullPage: true,
      });
    });
  }

  test("keeps navigation, contract detail, and examples readable together", async ({
    page,
  }) => {
    await openReference(page, VIEWPORTS[3]);

    const operation = page.locator('[data-operation-id="getIntakeConfig"]');
    const detail = operation.locator("> div > div").first();
    const example = operation.getByRole("region", {
      name: /request example/i,
    });
    const [detailBox, exampleBox] = await Promise.all([
      detail.boundingBox(),
      example.boundingBox(),
    ]);

    expect(detailBox).not.toBeNull();
    expect(exampleBox).not.toBeNull();
    expect((detailBox?.x ?? 0) + (detailBox?.width ?? 0)).toBeLessThanOrEqual(
      (exampleBox?.x ?? 0) + 1
    );

    await page
      .getByRole("navigation", { name: "API reference" })
      .getByRole("link", { name: /Read intake configuration/i })
      .click();
    await expect(page).toHaveURL(/#getIntakeConfig$/);
    await expect(
      operation.getByRole("heading", {
        name: "Read intake configuration",
      })
    ).toBeInViewport();
  });

  test("supports keyboard language selection and copy confirmation", async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openReference(page, VIEWPORTS[3]);

    const example = page
      .getByRole("region", { name: /request example/i })
      .first();
    const javascriptTab = example.getByRole("tab", { name: "JavaScript" });
    const typescriptTab = example.getByRole("tab", { name: "TypeScript" });
    await javascriptTab.click();
    await expect(javascriptTab).toHaveAttribute("aria-selected", "true");
    await javascriptTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(typescriptTab).toHaveAttribute("aria-selected", "true");
    await expect(typescriptTab).toBeFocused();

    const copyButton = example.getByRole("button", {
      name: "Copy TypeScript example",
    });
    await copyButton.click();
    await expect(copyButton).toBeFocused();
    await expect(example.getByText("Copied").first()).toBeVisible();
  });

  test("serves the same public OpenAPI artifact and honors reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openReference(page, VIEWPORTS[3]);

    const download = page.getByRole("link", { name: "Download OpenAPI" });
    await expect(download).toHaveCSS("transition-property", "none");

    const response = await page.request.get("/developers/api/openapi.json");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe(
      "application/vnd.oai.openapi+json;version=3.1; charset=utf-8"
    );
    const document = await response.json();
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths)).toHaveLength(6);
  });
});
