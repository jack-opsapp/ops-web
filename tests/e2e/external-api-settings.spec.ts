import { expect, test, type Page, type Route } from "@playwright/test";
import {
  createFixtures,
  fulfillJson,
  mockWizardRoutes,
  seedCatalogWizardAuth,
  trackBrowserErrors,
} from "./helpers/catalog-setup-auth";

const SOURCE_ID = "a45b37e7-c226-40f8-9c53-479838d3d170";
const FORM_ID = "0854859f-eab9-4e7c-874a-c9d176852b92";
const NOW = "2026-07-27T18:00:00.000Z";

type JsonRecord = Record<string, unknown>;

type SettingsState = {
  sources: JsonRecord[];
  credentials: JsonRecord[];
  secretsIssued: number;
};

function sourceFrom(body: JsonRecord) {
  return {
    sourceId: SOURCE_ID,
    integrationType: "website",
    siteLabel: body.siteLabel,
    canonicalHost: body.canonicalHost,
    defaultPhoneRegion: body.defaultPhoneRegion,
    allowedBrowserOrigins: body.allowedBrowserOrigins,
    defaultCoarseSource: "website",
    defaultIntakeOwnerId: null,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    forms: [
      {
        formId: FORM_ID,
        key: "default",
        label: "Default",
        isDefault: true,
        active: true,
      },
    ],
  };
}

function credentialFrom(body: JsonRecord, sequence: number) {
  const credentialClass = body.class === "analytics" ? "analytics" : "intake";
  const suffix = String(sequence).padStart(12, "0");
  return {
    credentialId: `a8531078-5dd0-4ac6-bf28-${suffix}`,
    name: body.name,
    class: credentialClass,
    scopes: body.scopes,
    sourceIds: body.sourceIds,
    prefix: `opsx_7_e2e${sequence}`,
    status: "active",
    createdByUserId: "00000000-0000-4000-8000-000000000101",
    createdAt: NOW,
    updatedAt: NOW,
    lastUsedAt: null,
    expiresAt: body.expiresAt,
    overlapUntil: null,
    rejectionCount: 0,
    recentRejectionCount: 0,
  };
}

async function mockWebsiteSettings(page: Page, state: SettingsState) {
  await page.route("**/api/settings/external-api**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/settings/external-api" && method === "GET") {
      await fulfillJson(route, {
        featureEnabled: true,
        sources: state.sources,
        credentials: state.credentials,
      });
      return;
    }

    if (path === "/api/settings/external-api/sources" && method === "POST") {
      const body = request.postDataJSON() as JsonRecord;
      const source = sourceFrom(body);
      state.sources.push(source);
      await fulfillJson(route, source, 201);
      return;
    }

    if (
      path === "/api/settings/external-api/credentials" &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as JsonRecord;
      state.secretsIssued += 1;
      const credential = credentialFrom(body, state.secretsIssued);
      state.credentials.unshift(credential);
      await fulfillJson(
        route,
        {
          credential,
          secret: `opsx_7_e2e${state.secretsIssued}_one_time_secret`,
        },
        201
      );
      return;
    }

    await fulfillJson(route, { error: { code: "unexpected_test_route" } }, 500);
  });
}

async function mockShellRoutes(page: Page) {
  await page.route("**/api/duplicates**", (route) =>
    fulfillJson(route, { duplicates: [], groups: [], total: 0 })
  );
  await page.route("**/api/notifications/setup-prompts**", (route) =>
    fulfillJson(route, { prompts: [] })
  );
  await page.route("**/api/integrations/email/signature**", (route) =>
    fulfillJson(route, { signature: null })
  );
  await page.route("**/api/dashboard-preferences**", (route) =>
    fulfillJson(route, {
      id: "external-api-settings-preferences",
      user_id: "00000000-0000-4000-8000-000000000101",
      company_id: "00000000-0000-4000-8000-000000000001",
      widget_instances: [],
      dashboard_layout: "default",
      scheduling_type: "both",
      map_default_zoom: 12,
      map_default_center: null,
      map_show_traffic: false,
      map_show_crew_labels: true,
      created_at: NOW,
      updated_at: NOW,
    })
  );
  await page.route("**/api/inbox/threads**", (route) =>
    fulfillJson(route, { threads: [], nextCursor: null, total: 0 })
  );
  await page.route("**/api/agent/queue**", (route) =>
    fulfillJson(route, { count: 0, items: [] })
  );
}

async function openWebsiteSettings(page: Page, state: SettingsState) {
  const browserErrors = trackBrowserErrors(page);
  await seedCatalogWizardAuth(page);
  await mockWizardRoutes(page, createFixtures());
  await mockShellRoutes(page);
  await mockWebsiteSettings(page, state);
  await page.goto("/settings?section=website", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await expect(
    page.getByRole("button", { name: "CONNECT WEBSITE" })
  ).toBeVisible({ timeout: 20_000 });
  return browserErrors;
}

test.describe("External API website settings", () => {
  test("keeps first-use setup focused and usable at laptop width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 689 });
    const state: SettingsState = {
      sources: [],
      credentials: [],
      secretsIssued: 0,
    };
    const browserErrors = await openWebsiteSettings(page, state);

    await expect(
      page.getByRole("heading", { name: "WEBSITE INTAKE" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "CREATE INTAKE KEY" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "CREATE ANALYTICS KEY" })
    ).toHaveCount(0);

    const bodyWidth = await page.locator("body").evaluate((body) => {
      const element = body as HTMLElement;
      return {
        client: element.clientWidth,
        scroll: element.scrollWidth,
      };
    });
    expect(bodyWidth.scroll).toBeLessThanOrEqual(bodyWidth.client);
    expect(browserErrors).toEqual([]);
  });

  test("configures one source and separate one-time credentials", async ({
    page,
  }) => {
    const state: SettingsState = {
      sources: [],
      credentials: [],
      secretsIssued: 0,
    };
    const browserErrors = await openWebsiteSettings(page, state);

    await page.getByRole("button", { name: "CONNECT WEBSITE" }).click();
    await page.getByLabel("SITE LABEL").fill("Main website");
    await page.getByLabel("WEBSITE HOST").fill("example.com");
    await page
      .getByLabel("ALLOWED BROWSER ORIGINS")
      .fill("https://example.com");
    await page.getByRole("button", { name: "CONNECT WEBSITE" }).last().click();

    await expect(
      page.getByRole("heading", { name: "WEBSITE SOURCE" })
    ).toBeVisible();
    await expect(page.getByText("example.com", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "CREATE INTAKE KEY" }).click();
    await page.getByLabel("KEY NAME").fill("Production intake");
    await page.getByRole("button", { name: "ISSUE INTAKE KEY" }).click();
    await expect(
      page.getByRole("textbox", { name: /^access key$/i })
    ).toHaveValue(/opsx_7_e2e1_one_time_secret/);
    await page.getByRole("button", { name: "DONE" }).click();
    await expect(
      page.locator('input[value="opsx_7_e2e1_one_time_secret"]')
    ).toHaveCount(0);

    await page.getByRole("button", { name: "CREATE ANALYTICS KEY" }).click();
    await page.getByLabel("KEY NAME").fill("Website analytics");
    await expect(
      page.getByText(
        "This key can read pseudonymous lead data for the entire company."
      )
    ).toBeVisible();
    await page.getByRole("button", { name: "ISSUE ANALYTICS KEY" }).click();
    await expect(
      page.getByRole("textbox", { name: /^access key$/i })
    ).toHaveValue(/opsx_7_e2e2_one_time_secret/);
    await page.getByRole("button", { name: "DONE" }).click();

    await expect(
      page.getByText("Production intake", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Website analytics", { exact: true })
    ).toBeVisible();
    expect(state.sources).toHaveLength(1);
    expect(state.credentials).toHaveLength(2);
    expect(browserErrors).toEqual([]);
  });
});
