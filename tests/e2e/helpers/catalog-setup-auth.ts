import { readFileSync } from "node:fs";
import { expect, type Page, type Route } from "@playwright/test";

/**
 * OPS Web — Catalog Setup Wizard E2E auth + route fixtures (Catalog Setup
 * initiative, Phase 6 Task 6.14).
 *
 * Mirrors the PROVEN deterministic harness of `won-conversion.spec.ts`: every
 * network dependency is fulfilled at the route layer with fixtures (no live
 * Supabase, no real Firebase, no backend), auth is seeded via localStorage +
 * the Firebase identitytoolkit/securetoken fallback, and the current user is a
 * company admin (in `adminIds` + `accountHolderId`) so the permissions store
 * resolves EVERY granular permission — including `catalog.run_setup` — without
 * mocking the roles tables.
 *
 * Why mocked (not a real login): the wizard's BUILD IT commit is a WRITE that
 * would otherwise reach Supabase via the `catalog_setup_save` RPC. The harness
 * intercepts `POST /api/catalog/setup/commit` at the route layer and records the
 * payload, returning a synthetic `{ ok, counts }` — it NEVER reaches prod. The
 * `wizard_analytics` Supabase insert is likewise intercepted at `/rest/v1/` so
 * the `completed` event can be asserted without writing real data.
 *
 * Exports:
 *   - seedCatalogWizardAuth(page)            — cookies + localStorage + Firebase
 *                                              fallback + the always-on route
 *                                              mocks (auth sync, feature flags,
 *                                              images, geocoding, mapbox).
 *   - mockWizardRoutes(page, fixtures)       — the wizard-specific routes: the
 *                                              commit recorder, the wizard_analytics
 *                                              insert recorder, and the catalog
 *                                              Supabase reads (products/stock/
 *                                              settings) wired to the fixture state.
 */

export const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
export const CURRENT_USER_ID = "00000000-0000-4000-8000-000000000101";
export const AUTH_TOKEN = "mock-id-token";
const FIREBASE_FALLBACK_API_KEY = "ops-e2e-api-key";

export const E2E_ORIGIN =
  process.env.E2E_BASE_URL ??
  `http://localhost:${process.env.E2E_PORT ?? "3000"}`;

type JsonRecord = Record<string, unknown>;

/** Mutable fixture state the spec inspects after driving the UI. */
export interface WizardFixtures {
  /** Whether the company already has products (drives the first-run takeover). */
  productCount?: number;
  /** Whether the company already has stock variants. */
  stockCount?: number;
  /**
   * Live `products` rows the upload dedupe matches against. Default empty (0/0
   * takeover); seed a SKU-matching row to exercise the re-import merge path.
   */
  existingProducts?: JsonRecord[];
  /** `company_inventory_settings.inventory_mode` — "off" hides the STOCK module. */
  inventoryMode?: "off" | "tracked";
  /** `company_settings.catalog_setup_completed_at` — non-null suppresses takeover. */
  catalogSetupCompletedAt?: string | null;
  /** Every POST /api/catalog/setup/commit the UI fired, in order. */
  commitCalls: { body: JsonRecord }[];
  /** Every wizard_analytics row inserted, in order. */
  analyticsInserts: JsonRecord[];
}

export function createFixtures(overrides: Partial<WizardFixtures> = {}): WizardFixtures {
  return {
    productCount: 0,
    stockCount: 0,
    inventoryMode: "off",
    catalogSetupCompletedAt: null,
    existingProducts: [],
    commitCalls: [],
    analyticsInserts: [],
    ...overrides,
  };
}

function firebaseApiKeys() {
  const keys = new Set<string>([FIREBASE_FALLBACK_API_KEY, "undefined"]);
  if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    keys.add(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  }
  try {
    const envLocal = readFileSync(".env.local", "utf8");
    const match = envLocal.match(/^NEXT_PUBLIC_FIREBASE_API_KEY=(.+)$/m);
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (value) keys.add(value);
  } catch {
    // Local env is optional in E2E. The fallback key keeps Firebase deterministic.
  }
  return [...keys];
}

export async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

function rangeSlice(route: Route, rows: JsonRecord[]) {
  const range = route.request().headers().range;
  const match = range?.match(/^(\d+)-(\d+)$/);
  const from = match ? Number(match[1]) : 0;
  const to = match ? Number(match[2]) : rows.length - 1;
  return { from, rows: rows.slice(from, to + 1) };
}

async function fulfillRange(route: Route, rows: JsonRecord[]) {
  const slice = rangeSlice(route, rows);
  const end =
    slice.rows.length > 0 ? slice.from + slice.rows.length - 1 : slice.from;
  await fulfillJson(route, slice.rows, 206, {
    "content-range": `${slice.from}-${end}/${rows.length}`,
    "range-unit": "items",
  });
}

function authUserPayload() {
  return {
    id: CURRENT_USER_ID,
    firstName: "E2E",
    lastName: "Owner",
    email: "e2e-owner@ops.test",
    phone: null,
    profileImageURL: null,
    role: "admin",
    companyId: COMPANY_ID,
    userType: "employee",
    latitude: null,
    longitude: null,
    locationName: null,
    homeAddress: null,
    clientId: null,
    isActive: true,
    userColor: null,
    devPermission: true,
    onboardingCompleted: { web: true },
    hasCompletedAppTutorial: true,
    isCompanyAdmin: true,
    specialPermissions: [],
    setupProgress: { steps: { identity: true, company: true } },
    stripeCustomerId: null,
    deviceToken: null,
    fabActions: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelationship: null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: null,
  };
}

function authCompanyPayload() {
  return {
    id: COMPANY_ID,
    name: "Maverick Projects",
    logoURL: null,
    externalId: null,
    companyCode: "E2E",
    companyDescription: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    latitude: null,
    longitude: null,
    openHour: null,
    closeHour: null,
    industries: [],
    companySize: null,
    companyAge: null,
    referralMethod: null,
    projectIds: [],
    teamIds: [],
    // Admin via BOTH paths so the permissions store grants ALL_PERMISSIONS
    // (catalog.run_setup included) without mocking the roles tables.
    adminIds: [CURRENT_USER_ID],
    accountHolderId: CURRENT_USER_ID,
    defaultProjectColor: "#6F94B0",
    teamMembersSynced: true,
    subscriptionStatus: "active",
    subscriptionPlan: "team",
    subscriptionEnd: null,
    subscriptionPeriod: null,
    maxSeats: 50,
    seatedEmployeeIds: [CURRENT_USER_ID],
    seatGraceStartDate: null,
    trialStartDate: null,
    trialEndDate: null,
    hasPrioritySupport: false,
    dataSetupPurchased: false,
    dataSetupCompleted: false,
    dataSetupScheduledDate: null,
    stripeCustomerId: null,
    preciseSchedulingEnabled: true,
    skipWeekendsInAutoSchedule: false,
    defaultWorkStart: "08:00",
    defaultWorkEnd: "17:00",
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: null,
  };
}

/**
 * Seed auth (cookies + localStorage + Firebase fallback) and install the
 * always-on route mocks the dashboard shell needs (sync-user, feature flags,
 * image proxy, geocoding). Call ONCE before goto, then mockWizardRoutes for the
 * wizard-specific reads/writes.
 */
export async function seedCatalogWizardAuth(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "ops-auth-token", value: AUTH_TOKEN, url: E2E_ORIGIN },
    { name: "__session", value: AUTH_TOKEN, url: E2E_ORIGIN },
  ]);

  await page.addInitScript(
    ({ apiKeys, authToken, company, user }) => {
      const now = Date.now();
      window.localStorage.setItem(
        "ops-auth-storage",
        JSON.stringify({
          state: {
            currentUser: user,
            company,
            token: authToken,
            isAuthenticated: true,
            role: user.role,
          },
          version: 0,
        }),
      );
      for (const apiKey of apiKeys) {
        window.localStorage.setItem(
          `firebase:authUser:${apiKey}:[DEFAULT]`,
          JSON.stringify({
            uid: user.id,
            email: user.email,
            emailVerified: true,
            displayName: `${user.firstName} ${user.lastName}`,
            isAnonymous: false,
            phoneNumber: null,
            photoURL: null,
            tenantId: null,
            providerId: "firebase",
            providerData: [
              {
                providerId: "password",
                uid: user.email,
                displayName: `${user.firstName} ${user.lastName}`,
                email: user.email,
                phoneNumber: null,
                photoURL: null,
              },
            ],
            stsTokenManager: {
              refreshToken: "mock-refresh-token",
              accessToken: authToken,
              expirationTime: now + 60 * 60 * 1000,
            },
            createdAt: String(now - 24 * 60 * 60 * 1000),
            lastLoginAt: String(now),
            apiKey,
            appName: "[DEFAULT]",
          }),
        );
      }
    },
    {
      apiKeys: firebaseApiKeys(),
      authToken: AUTH_TOKEN,
      company: authCompanyPayload(),
      user: authUserPayload(),
    },
  );

  // Tiny transparent PNG for the Next image proxy (avatars / logos).
  await page.route("**/_next/image**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });

  // Firebase identity bridge — the seeded localStorage user resolves, but the
  // SDK still hits these endpoints to look up / refresh the token.
  await page.route("**/identitytoolkit.googleapis.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("accounts:lookup")) {
      await fulfillJson(route, {
        users: [
          {
            localId: CURRENT_USER_ID,
            email: "e2e-owner@ops.test",
            displayName: "E2E Owner",
            emailVerified: true,
            providerUserInfo: [],
          },
        ],
      });
      return;
    }
    await fulfillJson(route, {
      kind: "identitytoolkit#VerifyCustomTokenResponse",
      idToken: AUTH_TOKEN,
      refreshToken: "mock-refresh-token",
      expiresIn: "3600",
      isNewUser: false,
      localId: CURRENT_USER_ID,
      email: "e2e-owner@ops.test",
      displayName: "E2E Owner",
    });
  });

  await page.route("**/securetoken.googleapis.com/**", async (route) => {
    await fulfillJson(route, {
      id_token: AUTH_TOKEN,
      refresh_token: "mock-refresh-token",
      expires_in: "3600",
      user_id: CURRENT_USER_ID,
    });
  });

  // Geocoding (none of the wizard surfaces need it, but the shell may probe).
  await page.route("**/api.mapbox.com/**", async (route) => {
    await fulfillJson(route, { type: "FeatureCollection", features: [] });
  });

  await page.route("**/api/auth/sync-user", async (route) => {
    await fulfillJson(route, {
      user: authUserPayload(),
      company: authCompanyPayload(),
    });
  });

  // No feature flags → every route is unlocked + every feature available
  // (isRouteUnlocked / canAccessFeature return true for unknown slugs). The
  // dashboard gate's `flagsReady` flips true on this empty payload.
  await page.route("**/api/feature-flags**", async (route) => {
    await fulfillJson(route, []);
  });
}

/**
 * Install the wizard-specific route mocks against a mutable fixture state.
 *
 *  - POST /api/catalog/setup/commit → recorded, returns synthetic success. NEVER
 *    reaches Supabase / the catalog_setup_save RPC.
 *  - POST /rest/v1/wizard_analytics → recorded (the `completed`/`shown` events).
 *  - Every other /rest/v1 read → empty (0 products, 0 stock) EXCEPT the two
 *    single-row settings reads, which return the fixture's inventory mode +
 *    completion flag so the takeover + STOCK module gate deterministically.
 */
export async function mockWizardRoutes(
  page: Page,
  fixtures: WizardFixtures,
): Promise<void> {
  // ── The commit (WRITE) — recorded, synthetic success, never to prod ──
  await page.route("**/api/catalog/setup/commit", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}") as JsonRecord;
    fixtures.commitCalls.push({ body });
    const cards = Array.isArray(body.cards) ? (body.cards as JsonRecord[]) : [];
    const products = cards.filter((c) => c.module === "sell").length;
    const stock = cards.filter((c) => c.module === "stock").length;
    const types = cards.filter((c) => c.module === "types").length;
    await fulfillJson(route, {
      ok: true,
      counts: { products, stock, types },
      warnings: [],
    });
  });

  // The agent route is off in this env (no NEXT_PUBLIC_CATALOG_AGENT_ENABLED) —
  // mock it as unavailable so an accidental hit is still deterministic.
  await page.route("**/api/catalog/setup/agent", async (route) => {
    await fulfillJson(route, { ok: false, error: "Guided setup unavailable" }, 503);
  });

  // ── Supabase REST: reads empty (0/0) + recorded analytics inserts ──
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.split("/rest/v1/")[1] ?? "";
    const table = decodeURIComponent(path.split("?")[0] ?? "");
    const method = request.method();

    if (table === "wizard_analytics" && method === "POST") {
      const raw = request.postData() || "{}";
      const parsed = JSON.parse(raw) as JsonRecord | JsonRecord[];
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) fixtures.analyticsInserts.push(row);
      await fulfillJson(route, rows, 201);
      return;
    }

    // HEAD count reads (useBaselineSeeded uses `head:true,count:exact`). The
    // prerequisite gate refuses to run the wizard until task_types AND
    // catalog_units exist; report a seeded baseline so the gate opens. The count
    // rides in the Content-Range total; the body is empty for a HEAD.
    if (method === "HEAD") {
      const total =
        table === "task_types" || table === "catalog_units" ? 1 : 0;
      await route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: {
          "content-range": `*/${total}`,
          "range-unit": "items",
          // Content-Range is a CORS-protected response header; the count read
          // (head:true,count:exact) only sees it cross-origin if it's exposed.
          "access-control-allow-origin": "*",
          "access-control-expose-headers": "content-range, range-unit",
        },
        body: "",
      });
      return;
    }

    // Other inserts/rpc → benign empty success.
    if (method !== "GET") {
      await fulfillJson(route, []);
      return;
    }

    if (table === "company_inventory_settings") {
      await fulfillRange(
        route,
        fixtures.inventoryMode === "tracked"
          ? [{ inventory_mode: "tracked", company_id: COMPANY_ID }]
          : [],
      );
      return;
    }

    if (table === "company_settings") {
      await fulfillRange(
        route,
        fixtures.catalogSetupCompletedAt
          ? [
              {
                company_id: COMPANY_ID,
                catalog_setup_completed_at: fixtures.catalogSetupCompletedAt,
              },
            ]
          : [],
      );
      return;
    }

    if (table === "products") {
      // Both the launcher's count read and the wizard's dedupe read hit this;
      // default empty keeps the 0/0 takeover, a seeded row drives the merge path.
      await fulfillRange(route, fixtures.existingProducts ?? []);
      return;
    }

    // Baseline primitives — the prerequisite gate refuses to run the wizard
    // until task_types AND catalog_units exist (useBaselineSeeded count reads).
    // A provisioned company always has these; seed one row each so the gate
    // opens (without them the wizard shell never renders).
    if (table === "task_types") {
      await fulfillRange(route, [
        { id: "00000000-0000-4000-8000-0000000000a1" },
      ]);
      return;
    }
    if (table === "catalog_units") {
      await fulfillRange(route, [
        {
          id: "00000000-0000-4000-8000-0000000000a2",
          display: "ea",
          abbreviation: "ea",
        },
      ]);
      return;
    }

    // catalog_* / everything else → empty so the 0/0 takeover shows.
    await fulfillRange(route, []);
  });

  await page.route("**/storage/v1/object/**", async (route) => {
    await fulfillJson(route, {});
  });
}

/** Capture browser console errors + page errors for diagnosis on failure. */
export function trackBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

/**
 * Desktop viewport — the wizard shell is a two-pane desktop layout (lg
 * breakpoint). Sub-768px collapses it; force ≥768 before interacting.
 */
export async function useDesktopViewport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Re-export expect so specs import one module. */
export { expect };
