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

  test("stacks the tool-request form beneath its introduction at every supported width", async ({
    page,
  }) => {
    for (const viewport of VIEWPORTS) {
      await openGuide(page, viewport);

      const section = page.locator("#request-tool");
      const layout = section.locator(":scope > div");
      const introduction = section
        .getByRole("heading", { name: "Request a tool" })
        .locator("..");
      const formSurface = section
        .getByRole("form", { name: "Request a tool" })
        .locator("..");
      const [layoutBox, introductionBox, formBox] = await Promise.all([
        layout.boundingBox(),
        introduction.boundingBox(),
        formSurface.boundingBox(),
      ]);

      expect(layoutBox, `${viewport.label}: layout box`).not.toBeNull();
      expect(
        introductionBox,
        `${viewport.label}: introduction box`
      ).not.toBeNull();
      expect(formBox, `${viewport.label}: form box`).not.toBeNull();

      expect(formBox!.y).toBeGreaterThanOrEqual(
        introductionBox!.y + introductionBox!.height
      );
      expect(Math.abs(formBox!.x - layoutBox!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(formBox!.width - layoutBox!.width)).toBeLessThanOrEqual(
        1
      );
    }
  });

  test("copies the endpoint and confirms the clipboard write", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            window.sessionStorage.setItem("ops-mcp-test-clipboard", value);
          },
        },
      });
    });
    await openGuide(page, VIEWPORTS[3]);

    const copyButton = page.getByRole("button", {
      name: "Copy: MCP endpoint",
    });
    await copyButton.click();

    await expect(copyButton).toContainText("Copied");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.sessionStorage.getItem("ops-mcp-test-clipboard")
        )
      )
      .toBe("https://app.opsapp.co/api/mcp");
  });

  test("submits a tool request through the embedded form", async ({ page }) => {
    let submitted: Record<string, unknown> | null = null;
    await page.route("**/api/developers/mcp/tool-requests", async (route) => {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          submissionId: submitted.submissionId,
          replayed: false,
        }),
      });
    });
    await openGuide(page, VIEWPORTS[3]);

    await page
      .getByRole("textbox", { name: "Work email" })
      .fill("owner@example.com");
    await page
      .getByRole("textbox", { name: "What should the tool do?" })
      .fill("Show the latest site visit evidence that still needs follow-up.");
    await page.getByRole("button", { name: "Send request" }).click();

    const status = page
      .getByRole("status")
      .filter({ hasText: "Request received" });
    await expect(status).toBeVisible();
    await expect(status).toContainText(
      "OPS will review it and use your email if more detail is needed."
    );
    expect(submitted).toEqual({
      submissionId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      ),
      email: "owner@example.com",
      details:
        "Show the latest site visit evidence that still needs follow-up.",
      website: "",
    });
    await expect(page.locator('#request-tool a[href^="mailto:"]')).toHaveCount(
      0
    );
  });

  test("validates the embedded request form without leaving the guide", async ({
    page,
  }) => {
    await openGuide(page, VIEWPORTS[3]);

    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByText("Enter your work email.")).toBeVisible();
    await expect(
      page.getByText("Describe the tool you need in at least 20 characters.")
    ).toBeVisible();
    await expect(page).toHaveURL(/\/developers\/mcp$/);
  });

  test("announces rate limiting without clearing the request", async ({
    page,
  }) => {
    await page.route("**/api/developers/mcp/tool-requests", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "60" },
        body: JSON.stringify({ error: "rate_limited" }),
      });
    });
    await openGuide(page, VIEWPORTS[3]);
    const email = page.getByRole("textbox", { name: "Work email" });
    const details = page.getByRole("textbox", {
      name: "What should the tool do?",
    });
    await email.fill("owner@example.com");
    await details.fill(
      "Show the latest site visit evidence that still needs follow-up."
    );
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(
      page.getByRole("form", { name: "Request a tool" }).getByRole("alert")
    ).toContainText("Too many requests. Try again later.");
    await expect(email).toHaveValue("owner@example.com");
    await expect(details).toHaveValue(
      "Show the latest site visit evidence that still needs follow-up."
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
    await expect(page.getByRole("button", { name: "Send request" })).toHaveCSS(
      "transition-property",
      "none"
    );
  });
});
