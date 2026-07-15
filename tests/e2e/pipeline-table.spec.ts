import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * OPS Web — Pipeline Table View browser gate (Task 8.5).
 *
 * Mirrors the PROVEN harness of `projects-table-v2-phase4.spec.ts` /
 * `phase5.spec.ts`: every network dependency is fulfilled at the route layer
 * with deterministic fixtures — no live Supabase, no real Firebase, no backend.
 * Auth is seeded the same way (auth-store + Firebase localStorage, the
 * identitytoolkit / securetoken endpoints, `/api/auth/sync-user`), and the
 * `pipeline_table_view` feature flag is forced ON through `/api/feature-flags`.
 *
 * Because the auth payload makes the current user a company admin
 * (`adminIds: [CURRENT_USER_ID]` + `accountHolderId: CURRENT_USER_ID`), the
 * permission store short-circuits to grant ALL permissions — so `pipeline.view`
 * and `pipeline.manage` are both satisfied without mocking the roles tables,
 * exactly as the projects phase4 spec relies on.
 *
 * Env gating: like the projects specs, this runs against the dev server the
 * Playwright config boots. It needs a browser + the dev server; in a creds-less
 * CI it is skipped the same way the other browser-gated specs are (no special
 * env required beyond what `playwright.config.ts` already provides).
 *
 * Covered flows (per the task's priority order — the table-defining ones):
 *   1. Flag ON → /pipeline in TABLE mode renders the table with a known deal.
 *   2. FOCUSED ↔ TABLE via the mode switcher (crossfade surfaces swap).
 *   3. Grouping toggle → per-stage group headers with rollups.
 *   4. Inline value edit commits optimistically (we own the mocked PATCH).
 *   5. Stage → Won opens the Won dialog (not completed).
 *   6. Saved-view tab switch reflects the active view.
 *   7. Bulk: select rows → bulk bar appears with the exact count.
 */

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CURRENT_USER_ID = "00000000-0000-4000-8000-000000000101";
const MEMBER_ONE_ID = "00000000-0000-4000-8000-000000000102";
const CLIENT_ID = "00000000-0000-4000-8000-000000000201";
const DEFAULT_VIEW_ID = "00000000-0000-4000-8000-000000000301";
const SECONDARY_VIEW_ID = "00000000-0000-4000-8000-000000000302";
const OPPORTUNITY_COUNT = 6;
const AUTH_TOKEN = "mock-id-token";
const FIREBASE_FALLBACK_API_KEY = "ops-e2e-api-key";
const E2E_ORIGIN =
  process.env.E2E_BASE_URL ??
  `http://localhost:${process.env.E2E_PORT ?? "3000"}`;

type JsonRecord = Record<string, unknown>;

type PipelineTableState = {
  opportunityRows: JsonRecord[];
  views: JsonRecord[];
  opportunityPatchCalls: JsonRecord[];
};

function uuid(sequence: number) {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function opportunityId(index: number) {
  return uuid(1000 + index);
}

function isoDaysFromNow(days: number) {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
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
    // Local env is optional in E2E. The fallback key keeps Firebase storage deterministic.
  }

  return [...keys];
}

/** A pipeline-table cell locator, mirroring the projects spec's `tableCell`. */
function tableCell(page: Page, rowId: string, columnId: string) {
  return page.locator(
    `[data-pipeline-table-row-id="${rowId}"][data-pipeline-table-column-id="${columnId}"]`
  );
}

function tableCheckbox(page: Page, rowId: string) {
  return tableCell(page, rowId, "select").getByRole("checkbox");
}

/** Spread the deal titles across stages so grouping yields >1 header. */
function stageForIndex(index: number) {
  // Two `new_lead`, two `qualifying`, then the rest `quoting` — enough variety
  // for the grouping assertion while keeping the first deal a stable `new_lead`.
  if (index <= 2) return "new_lead";
  if (index <= 4) return "qualifying";
  return "quoting";
}

function createOpportunityRow(index: number): JsonRecord {
  const now = new Date();
  now.setUTCHours(12, 0, 0, 0);
  return {
    id: opportunityId(index),
    company_id: COMPANY_ID,
    client_id: CLIENT_ID,
    title: `Pipeline Deal ${String(index).padStart(3, "0")}`,
    description: null,
    contact_name: "Dana Client",
    contact_email: "ops-client@example.com",
    contact_phone: "555-0100",
    stage: stageForIndex(index),
    source: "referral",
    assigned_to: index === 1 ? MEMBER_ONE_ID : null,
    priority: "high",
    estimated_value: 10000 + index * 1000,
    actual_value: null,
    win_probability: 50,
    expected_close_date: isoDaysFromNow(14),
    actual_close_date: null,
    stage_entered_at: isoDaysFromNow(-index),
    project_id: null,
    lost_reason: null,
    lost_notes: null,
    source_email_id: null,
    correspondence_count: index,
    outbound_count: 0,
    inbound_count: 0,
    last_inbound_at: null,
    last_outbound_at: null,
    last_message_direction: null,
    ai_summary: null,
    ai_stage_confidence: null,
    ai_stage_signals: null,
    detected_value: null,
    quote_delivery_method: null,
    address: `${100 + index} Gate Road`,
    latitude: null,
    longitude: null,
    last_activity_at: isoDaysFromNow(-1),
    next_follow_up_at: isoDaysFromNow(7),
    tags: [],
    created_at: isoDaysFromNow(-30),
    updated_at: now.toISOString(),
    deleted_at: null,
    archived_at: null,
  };
}

function viewRow(input: {
  id: string;
  name: string;
  sortPosition: number;
  isDefault?: boolean;
}): JsonRecord {
  return {
    id: input.id,
    company_id: COMPANY_ID,
    name: input.name,
    icon: null,
    permission_key: null,
    columns: [
      { id: "deal" },
      { id: "stage" },
      { id: "client" },
      { id: "value" },
      // Legacy saved views may still contain these retired probability-derived
      // columns. The client must filter them rather than rendering the metrics
      // or breaking the view.
      { id: "win_probability" },
      { id: "weighted" },
    ],
    filters: {},
    sort: [{ field: "value", direction: "desc" }],
    density: "compact",
    zoom_level: 1,
    is_default: input.isDefault ?? false,
    is_archived: false,
    sort_position: input.sortPosition,
    updated_at: "2026-05-14T12:00:00.000Z",
    owner_type: "user",
    owner_id: CURRENT_USER_ID,
  };
}

function createState(): PipelineTableState {
  return {
    opportunityRows: Array.from(
      { length: OPPORTUNITY_COUNT },
      (_unused, index) => createOpportunityRow(index + 1)
    ),
    views: [
      viewRow({
        id: DEFAULT_VIEW_ID,
        name: "All Deals",
        sortPosition: 0,
        isDefault: true,
      }),
      viewRow({ id: SECONDARY_VIEW_ID, name: "Hot List", sortPosition: 1 }),
    ],
    opportunityPatchCalls: [],
  };
}

function teamRows() {
  return [
    {
      id: CURRENT_USER_ID,
      first_name: "E2E",
      last_name: "Manager",
      email: "e2e-manager@ops.test",
      role: "admin",
      profile_image_url: null,
      user_color: null,
      company_id: COMPANY_ID,
      is_active: true,
      deleted_at: null,
    },
    {
      id: MEMBER_ONE_ID,
      first_name: "Avery",
      last_name: "Crew",
      email: "avery@ops.test",
      role: "crew",
      profile_image_url: null,
      user_color: null,
      company_id: COMPANY_ID,
      is_active: true,
      deleted_at: null,
    },
  ];
}

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

function eqParam(url: URL, key: string) {
  const value = url.searchParams.get(key);
  return value?.startsWith("eq.") ? value.slice(3) : null;
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

function visibleViews(state: PipelineTableState) {
  return [...state.views]
    .filter((view) => view.is_archived !== true)
    .sort((a, b) => {
      const ap = Number(a.sort_position ?? 0);
      const bp = Number(b.sort_position ?? 0);
      if (ap !== bp) return ap - bp;
      return String(a.name).localeCompare(String(b.name));
    });
}

async function handleRestRoute(route: Route, state: PipelineTableState) {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.split("/rest/v1/")[1] ?? "";
  const table = decodeURIComponent(path.split("?")[0] ?? "");
  const method = request.method();

  // No RPCs fire on the read-only happy path covered here; any that slip through
  // (e.g. a notification log) resolve to an empty object so nothing 404s.
  if (table.startsWith("rpc/")) {
    await fulfillJson(route, {});
    return;
  }

  if (table === "opportunity_views") {
    await fulfillRange(route, visibleViews(state));
    return;
  }

  if (table === "opportunities") {
    if (method === "PATCH") {
      const patch = JSON.parse(request.postData() || "{}") as JsonRecord;
      const id = eqParam(url, "id");
      state.opportunityPatchCalls.push({ id, patch });
      const nextUpdatedAt = new Date().toISOString();
      let updated: JsonRecord | null = null;
      state.opportunityRows = state.opportunityRows.map((row) => {
        if (String(row.id) !== id) return row;
        updated = { ...row, ...patch, updated_at: nextUpdatedAt };
        return updated;
      });
      // PostgREST returns the updated representation (the service `.select()`s it).
      await fulfillJson(route, updated ? [updated] : []);
      return;
    }
    await fulfillRange(route, state.opportunityRows);
    return;
  }

  if (table === "clients") {
    await fulfillRange(route, [
      {
        id: CLIENT_ID,
        company_id: COMPANY_ID,
        name: "Maverick Builders",
        email: "ops-client@example.com",
        phone_number: "555-0100",
        address: "100 Gate Road",
        profile_image_url: null,
        notes: null,
        created_at: "2026-05-01T12:00:00.000Z",
        deleted_at: null,
      },
    ]);
    return;
  }

  if (table === "users") {
    await fulfillRange(route, teamRows());
    return;
  }

  if (table === "email_connections") {
    // Return one connected mailbox so the pipeline's "Connect Gmail" banner —
    // a pointer-events HUD that overlays the top toolbar — never renders. With
    // it absent, the toolbar + frozen top rows are unobstructed for clicking.
    await fulfillRange(route, [
      {
        id: uuid(600001),
        company_id: COMPANY_ID,
        type: "gmail",
        user_id: CURRENT_USER_ID,
        email: "e2e-manager@ops.test",
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        expires_at: isoDaysFromNow(1),
        history_id: null,
        sync_enabled: true,
        last_synced_at: isoDaysFromNow(-1),
        sync_interval_minutes: 60,
        sync_filters: null,
        status: "active",
        created_at: "2026-05-01T12:00:00.000Z",
        updated_at: "2026-05-01T12:00:00.000Z",
      },
    ]);
    return;
  }

  if (table === "pipeline_stage_configs") {
    // Empty → the adapter falls back to PIPELINE_STAGES_DEFAULT for thresholds.
    await fulfillRange(route, []);
    return;
  }

  if (
    table === "activities" ||
    table === "follow_ups" ||
    table === "stage_transitions" ||
    table === "notifications" ||
    table === "projects" ||
    table === "project_tasks"
  ) {
    await fulfillRange(route, []);
    return;
  }

  await fulfillRange(route, []);
}

function authUserPayload() {
  return {
    id: CURRENT_USER_ID,
    firstName: "E2E",
    lastName: "Manager",
    email: "e2e-manager@ops.test",
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
    adminIds: [CURRENT_USER_ID],
    accountHolderId: CURRENT_USER_ID,
    defaultProjectColor: "#6F94B0",
    teamMembersSynced: true,
    subscriptionStatus: "active",
    subscriptionPlan: "team",
    subscriptionEnd: null,
    subscriptionPeriod: null,
    maxSeats: 50,
    seatedEmployeeIds: [CURRENT_USER_ID, MEMBER_ONE_ID],
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

async function installPipelineMocks(
  page: Page,
  state: PipelineTableState,
  options: { initialMode: "focused" | "table" }
) {
  await page.context().addCookies([
    { name: "ops-auth-token", value: AUTH_TOKEN, url: E2E_ORIGIN },
    { name: "__session", value: AUTH_TOKEN, url: E2E_ORIGIN },
  ]);

  await page.addInitScript(
    ({ apiKeys, authToken, company, user, initialMode }) => {
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
        })
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
          })
        );
      }
      // Seed the persisted pipeline mode so the page mounts the requested
      // surface deterministically. `opsPipeline:v4` is the mode store's key
      // (zustand persist) — `mode` is one of the partialized fields.
      window.localStorage.setItem(
        "opsPipeline:v4",
        JSON.stringify({
          state: {
            mode: initialMode,
            focusedStage: "new_lead",
            sortBy: "value",
            stageSortOverrides: { __map: [] },
          },
          version: 4,
        })
      );
    },
    {
      apiKeys: firebaseApiKeys(),
      authToken: AUTH_TOKEN,
      company: authCompanyPayload(),
      user: authUserPayload(),
      initialMode: options.initialMode,
    }
  );

  await page.route("**/_next/image**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64"
      ),
    });
  });

  await page.route("**/identitytoolkit.googleapis.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("accounts:lookup")) {
      await fulfillJson(route, {
        users: [
          {
            localId: CURRENT_USER_ID,
            email: "e2e-manager@ops.test",
            displayName: "E2E Manager",
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
      email: "e2e-manager@ops.test",
      displayName: "E2E Manager",
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

  await page.route("**/api/dev/bypass-token", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        key: "e2e",
        email: "e2e-manager@ops.test",
        label: "E2E Manager",
        available: [],
      });
      return;
    }
    await fulfillJson(route, {
      token: "mock-custom-token",
      email: "e2e-manager@ops.test",
    });
  });

  await page.route("**/api/auth/sync-user", async (route) => {
    await fulfillJson(route, {
      user: authUserPayload(),
      company: authCompanyPayload(),
    });
  });

  await page.route("**/api/feature-flags**", async (route) => {
    await fulfillJson(route, [
      {
        slug: "pipeline_table_view",
        enabled: true,
        hasOverride: false,
        routes: [],
        permissions: [],
      },
    ]);
  });

  await page.route("**/api/dashboard-preferences**", async (route) => {
    await fulfillJson(route, {
      id: "pipeline-dashboard-preferences",
      user_id: CURRENT_USER_ID,
      company_id: COMPANY_ID,
      widget_instances: [],
      dashboard_layout: "default",
      scheduling_type: "both",
      map_default_zoom: 12,
      map_default_center: null,
      map_show_traffic: false,
      map_show_crew_labels: true,
      created_at: "2026-05-14T12:00:00.000Z",
      updated_at: "2026-05-14T12:00:00.000Z",
    });
  });

  await page.route("**/api/duplicates**", async (route) => {
    await fulfillJson(route, { duplicates: [], groups: [], total: 0 });
  });

  await page.route("**/api/inbox/threads**", async (route) => {
    await fulfillJson(route, { threads: [], nextCursor: null, total: 0 });
  });

  await page.route("**/api/agent/queue**", async (route) => {
    await fulfillJson(route, { count: 0, items: [] });
  });

  await page.route("**/api/notifications/dispatch", async (route) => {
    await fulfillJson(route, { ok: true });
  });

  await page.route("**/rest/v1/**", (route) => handleRestRoute(route, state));
  await page.route("**/storage/v1/object/**", async (route) => {
    await fulfillJson(route, {});
  });
}

async function openPipeline(
  page: Page,
  state: PipelineTableState,
  options: { initialMode: "focused" | "table" } = { initialMode: "table" }
) {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => {
    browserErrors.push(error.stack ?? error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await installPipelineMocks(page, state, options);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/pipeline", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    try {
      // The mode switcher is mounted unconditionally on the desktop pipeline,
      // so it is the most stable "the page is alive" anchor.
      await expect(
        page.getByRole("group", { name: "Pipeline view" })
      ).toBeVisible({
        timeout: 15000,
      });
      return;
    } catch (error) {
      lastError = error;
      const notFound = await page
        .getByRole("heading", { name: "404" })
        .isVisible()
        .catch(() => false);
      if (!notFound || attempt === 1) break;
    }
  }

  throw new Error(
    [
      "Pipeline did not render.",
      `Current URL: ${page.url()}`,
      `Browser errors: ${browserErrors.slice(0, 6).join(" | ") || "none captured"}`,
    ].join("\n"),
    { cause: lastError }
  );
}

/** Wait for the table surface to be present with its first known deal. */
async function expectTableRendered(page: Page) {
  await expect(
    page.locator('[data-pipeline-mode-surface="table"]')
  ).toBeVisible({
    timeout: 15000,
  });
  await expect(tableCell(page, opportunityId(1), "deal")).toContainText(
    "Pipeline Deal 001",
    { timeout: 15000 }
  );
}

test.describe("Pipeline Table View browser gate", () => {
  test.describe.configure({ mode: "serial", timeout: 90000 });

  test("renders the table in TABLE mode with mocked opportunities (flag ON)", async ({
    page,
  }) => {
    const state = createState();
    await openPipeline(page, state, { initialMode: "table" });

    await expectTableRendered(page);

    // The grid exposes its tactical aria-label, and multiple mocked rows render.
    await expect(
      page.getByRole("grid", { name: "Pipeline table" })
    ).toBeVisible();
    await expect(tableCell(page, opportunityId(2), "deal")).toContainText(
      "Pipeline Deal 002"
    );
    await expect(tableCell(page, opportunityId(6), "deal")).toContainText(
      "Pipeline Deal 006"
    );
    await expect(
      page.locator('[data-pipeline-table-column-id="win_probability"]')
    ).toHaveCount(0);
    await expect(
      page.locator('[data-pipeline-table-column-id="weighted"]')
    ).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Win %" })).toHaveCount(
      0
    );
    await expect(
      page.getByRole("columnheader", { name: "Weighted" })
    ).toHaveCount(0);
  });

  test("switches FOCUSED ↔ TABLE through the mode switcher", async ({
    page,
  }) => {
    const state = createState();
    // Start in FOCUSED so the table is absent first, then switch it in.
    await openPipeline(page, state, { initialMode: "focused" });

    await expect(
      page.locator('[data-pipeline-mode-surface="focused"]')
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.locator('[data-pipeline-mode-surface="table"]')
    ).toHaveCount(0);

    // Scope to the PipelineModeSwitcher group: the focused board also renders
    // its own inline `[ MODE: TABLE ▸ ]` shortcut, so an unscoped "Table" button
    // query is ambiguous. The switcher group is the stable, mode-independent
    // control.
    const modeSwitcher = page.getByRole("group", { name: "Pipeline view" });
    await modeSwitcher
      .getByRole("button", { name: "Table", exact: true })
      .click();
    await expectTableRendered(page);
    await expect(
      page.locator('[data-pipeline-mode-surface="focused"]')
    ).toHaveCount(0);

    // And back to FOCUSED — the table surface unmounts.
    await modeSwitcher
      .getByRole("button", { name: "Focused", exact: true })
      .click();
    await expect(
      page.locator('[data-pipeline-mode-surface="focused"]')
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.locator('[data-pipeline-mode-surface="table"]')
    ).toHaveCount(0);
  });

  test("groups rows under stage headers with rollups", async ({ page }) => {
    const state = createState();
    await openPipeline(page, state, { initialMode: "table" });
    await expectTableRendered(page);

    // Toggle grouping on (toolbar button, aria-label "Group").
    await page.getByRole("button", { name: "Group" }).click();

    // Stage group-header rows are `role="row"` with an aria-label naming the
    // stage + deal count. We seeded two `new_lead` + two `qualifying` deals.
    const newLeadHeader = page.getByRole("row", {
      name: /New Lead stage, 2 deals/i,
    });
    await expect(newLeadHeader).toBeVisible({ timeout: 10000 });
    await expect(newLeadHeader).toContainText("// 2");

    await expect(
      page.getByRole("row", { name: /Qualifying stage, 2 deals/i })
    ).toBeVisible();
  });

  test("commits an inline value edit optimistically", async ({ page }) => {
    const state = createState();
    await openPipeline(page, state, { initialMode: "table" });
    await expectTableRendered(page);

    // The value cell is inline-editable: clicking it opens an input labelled
    // "Value". Deal 001 seeds estimated_value = 11000.
    const valueCell = tableCell(page, opportunityId(1), "value");
    await valueCell.click();

    const valueInput = page.getByRole("textbox", { name: "Value" });
    await expect(valueInput).toBeVisible({ timeout: 10000 });
    await valueInput.fill("25000");
    await valueInput.press("Enter");

    // We own the mocked PATCH; assert it fired against the right row + column.
    await expect
      .poll(() => state.opportunityPatchCalls.length, { timeout: 10000 })
      .toBeGreaterThan(0);
    const lastPatch = state.opportunityPatchCalls.at(-1);
    expect(lastPatch?.id).toBe(opportunityId(1));
    expect(lastPatch?.patch).toMatchObject({ estimated_value: 25000 });

    // Optimistic update: the cell reflects the new (formatted) value.
    await expect(valueCell).toContainText("25,000");
  });

  test("opens the Won dialog from a stage change", async ({ page }) => {
    const state = createState();
    await openPipeline(page, state, { initialMode: "table" });
    await expectTableRendered(page);

    // The stage cell is an actionable listbox trigger ("Change stage").
    await tableCell(page, opportunityId(1), "stage")
      .getByRole("button", { name: "Change stage" })
      .click();

    // Choosing "Won" routes through the shared transition hook → opens the
    // terminal Won dialog (no network write until confirmed).
    await page.getByRole("option", { name: "Won" }).click();

    const wonDialog = page.getByRole("dialog");
    await expect(wonDialog).toBeVisible({ timeout: 10000 });
    // Stable copy: the won description + the deal title both render.
    await expect(wonDialog).toContainText("Congratulations on closing");
    await expect(wonDialog).toContainText("Pipeline Deal 001");

    // We intentionally do NOT confirm — opening the dialog is the assertion.
    expect(state.opportunityPatchCalls).toHaveLength(0);
  });

  test("reflects a saved-view tab switch", async ({ page }) => {
    const state = createState();
    await openPipeline(page, state, { initialMode: "table" });
    await expectTableRendered(page);

    // Both mocked views render as tabs.
    const defaultTab = page.getByRole("button", { name: /^All Deals$/ });
    const secondaryTab = page.getByRole("button", { name: /^Hot List$/ });
    await expect(defaultTab).toBeVisible();
    await expect(secondaryTab).toBeVisible();

    // The default view is active (its active state mirrors the projects tabs:
    // `bg-surface-active`). Switching to the secondary reflects the change.
    // The switch is triggered with `dispatchEvent('click')` rather than a real
    // pointer click: the floating pipeline HUD (an absolutely-positioned layer)
    // overlaps the tab strip in the test viewport and intercepts pointer
    // hit-testing, so a geometric click lands on the overlay. Dispatching the
    // DOM click fires the tab's React `onClick` directly — exactly the
    // handler → store → re-render path this assertion is about.
    await expect(defaultTab).toHaveClass(/bg-surface-active/);
    await secondaryTab.dispatchEvent("click");
    await expect(secondaryTab).toHaveClass(/bg-surface-active/);
    await expect(defaultTab).not.toHaveClass(/bg-surface-active/);

    // Rows persist across the view switch (same in-memory opportunity set).
    await expect(tableCell(page, opportunityId(1), "deal")).toContainText(
      "Pipeline Deal 001"
    );
  });

  test("shows the bulk bar with the exact selected count", async ({ page }) => {
    const state = createState();
    await openPipeline(page, state, { initialMode: "table" });
    await expectTableRendered(page);

    await tableCheckbox(page, opportunityId(1)).click();
    await expect(page.getByText("// 1 SELECTED")).toBeVisible({
      timeout: 10000,
    });

    await tableCheckbox(page, opportunityId(2)).click();
    await expect(page.getByText("// 2 SELECTED")).toBeVisible();

    // Clearing collapses the bar.
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("// 2 SELECTED")).toBeHidden();
  });
});
