import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * OPS Web — Won → Project Conversion browser gate (won-conversion initiative, Phase 7).
 *
 * Covers the spec §9 Won-dialog flows end-to-end against the REAL Phase-3
 * `stage-transition-dialog` + `use-stage-transition` hook, driven through the
 * pipeline TABLE surface.
 *
 * Harness: mirrors the PROVEN deterministic harness of `pipeline-table.spec.ts`
 * — every network dependency is fulfilled at the route layer with fixtures (no
 * live Supabase, no real Firebase, no backend), auth is seeded the same way, and
 * the current user is a company admin so `pipeline.manage` is satisfied without
 * mocking the roles tables. On top of that, this spec owns the two service-role
 * conversion routes:
 *   - GET  /api/opportunities/[id]/preflight  → the per-scenario dedup payload
 *   - POST /api/opportunities/[id]/convert    → recorded; returns a success blob
 *
 * Why mocked (not `loginAsAdmin`): the convert flow is a WRITE. A real-login
 * spec would mutate prod data (ops-web has no isolated app backend), and prod is
 * low-tenant + protected. The mocked harness exercises the exact UI + the exact
 * request shapes the service sends, deterministically, and never writes real
 * data — so it actually RUNS rather than skipping for want of creds.
 *
 * Covered (spec §9): clean create (auto-name preview + single atomic convert,
 * no link/title), duplicate-exists → open (no convert), candidate → link & win
 * (convert with linkToProjectId), client-has-others → create new (convert, no
 * link), rename → hand-set title (convert with titleOverride), and convert an
 * already-won/unconverted deal via the table `// CONVERT` affordance.
 *
 * The manual project-create-form auto-naming flows (blank name → auto, rename →
 * frozen, required-gate) are covered at the integration level in
 * `tests/integration/project-workspace-creating.test.tsx`.
 */

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CURRENT_USER_ID = "00000000-0000-4000-8000-000000000101";
const MEMBER_ONE_ID = "00000000-0000-4000-8000-000000000102";
const CLIENT_ID = "00000000-0000-4000-8000-000000000201";
const EXISTING_PROJECT_ID = "00000000-0000-4000-8000-000000000401";
const CANDIDATE_PROJECT_ID = "00000000-0000-4000-8000-000000000402";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-000000000403";
const NEW_PROJECT_ID = "00000000-0000-4000-8000-000000000404";
const AUTH_TOKEN = "mock-id-token";
const FIREBASE_FALLBACK_API_KEY = "ops-e2e-api-key";
const E2E_ORIGIN =
  process.env.E2E_BASE_URL ??
  `http://localhost:${process.env.E2E_PORT ?? "3000"}`;

const OPPORTUNITY_COUNT = 6;
// Street lines chosen so the auto-name preview (substring before the first
// comma) is deterministic and assertable.
const DEAL_ADDRESSES = [
  "1240 W 6th Ave",
  "88 Maple St",
  "300 King Rd",
  "55 Oak Blvd",
  "12 Pine Way",
  "9 Cedar Ct",
];

type JsonRecord = Record<string, unknown>;

type WonFlowState = {
  opportunityRows: JsonRecord[];
  /** opp id → ConversionPreflight payload the preflight route returns. */
  preflightById: Record<string, JsonRecord>;
  /** Every POST /convert the UI fired, in order. */
  convertCalls: { id: string; body: JsonRecord }[];
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

/** ConversionPreflight (camelCase — what the service returns to the browser). */
function emptyPreflight(suggestedName = ""): JsonRecord {
  return {
    existingLinkedProject: null,
    duplicateCandidates: [],
    otherClientProjects: [],
    suggestedName,
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

function tableCell(page: Page, rowId: string, columnId: string) {
  return page.locator(
    `[data-pipeline-table-row-id="${rowId}"][data-pipeline-table-column-id="${columnId}"]`,
  );
}

function createOpportunityRow(index: number): JsonRecord {
  const now = new Date();
  now.setUTCHours(12, 0, 0, 0);
  return {
    id: opportunityId(index),
    company_id: COMPANY_ID,
    client_id: CLIENT_ID,
    title: `Won Flow Deal ${String(index).padStart(3, "0")}`,
    description: null,
    contact_name: "Dana Client",
    contact_email: "ops-client@example.com",
    contact_phone: "555-0100",
    // All active + convertible (Change stage → Won works). The already-won
    // test overrides its target deal to stage 'won'.
    stage: "negotiation",
    source: "referral",
    assigned_to: index === 1 ? MEMBER_ONE_ID : null,
    priority: "high",
    estimated_value: 10000 + index * 1000,
    actual_value: null,
    win_probability: 60,
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
    address: DEAL_ADDRESSES[index - 1] ?? `${100 + index} Gate Road`,
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

function createState(): WonFlowState {
  return {
    opportunityRows: Array.from({ length: OPPORTUNITY_COUNT }, (_unused, i) =>
      createOpportunityRow(i + 1),
    ),
    preflightById: {},
    convertCalls: [],
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
  headers: Record<string, string> = {},
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
  const end = slice.rows.length > 0 ? slice.from + slice.rows.length - 1 : slice.from;
  await fulfillJson(route, slice.rows, 206, {
    "content-range": `${slice.from}-${end}/${rows.length}`,
    "range-unit": "items",
  });
}

async function handleRestRoute(route: Route, state: WonFlowState) {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.split("/rest/v1/")[1] ?? "";
  const table = decodeURIComponent(path.split("?")[0] ?? "");
  const method = request.method();

  if (table.startsWith("rpc/")) {
    await fulfillJson(route, {});
    return;
  }

  if (table === "opportunities") {
    if (method === "PATCH") {
      const patch = JSON.parse(request.postData() || "{}") as JsonRecord;
      const id = eqParam(url, "id");
      let updated: JsonRecord | null = null;
      state.opportunityRows = state.opportunityRows.map((row) => {
        if (String(row.id) !== id) return row;
        updated = { ...row, ...patch, updated_at: new Date().toISOString() };
        return updated;
      });
      await fulfillJson(route, updated ? [updated] : []);
      return;
    }
    await fulfillRange(route, state.opportunityRows);
    return;
  }

  if (table === "opportunity_views") {
    await fulfillRange(route, [
      {
        id: uuid(301),
        company_id: COMPANY_ID,
        name: "All Deals",
        icon: null,
        permission_key: null,
        columns: [
          { id: "deal" },
          { id: "stage" },
          { id: "client" },
          { id: "value" },
        ],
        filters: {},
        sort: [{ field: "value", direction: "desc" }],
        density: "compact",
        zoom_level: 1,
        is_default: true,
        is_archived: false,
        sort_position: 0,
        updated_at: "2026-05-14T12:00:00.000Z",
        owner_type: "user",
        owner_id: CURRENT_USER_ID,
      },
    ]);
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
        address: "1240 W 6th Ave",
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

  // Everything else (activities, follow_ups, stage_transitions, notifications,
  // projects, project_tasks, pipeline_stage_configs, …) resolves empty.
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

async function installMocks(page: Page, state: WonFlowState) {
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
      // Mount the pipeline in TABLE mode deterministically.
      window.localStorage.setItem(
        "opsPipeline:v4",
        JSON.stringify({
          state: {
            mode: "table",
            focusedStage: "new_lead",
            sortBy: "value",
            stageSortOverrides: { __map: [] },
          },
          version: 4,
        }),
      );
    },
    {
      apiKeys: firebaseApiKeys(),
      authToken: AUTH_TOKEN,
      company: authCompanyPayload(),
      user: authUserPayload(),
    },
  );

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

  // Mapbox geocoding (the dialog's editable address autocomplete) → no features.
  await page.route("**/api.mapbox.com/**", async (route) => {
    await fulfillJson(route, { type: "FeatureCollection", features: [] });
  });

  await page.route("**/api/auth/sync-user", async (route) => {
    await fulfillJson(route, {
      user: authUserPayload(),
      company: authCompanyPayload(),
    });
  });

  await page.route("**/api/feature-flags**", async (route) => {
    // The TABLE surface + the mode switcher are gated behind this flag.
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

  // ── The two conversion routes this spec owns ──
  await page.route("**/api/opportunities/*/preflight", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
    await fulfillJson(route, state.preflightById[id] ?? emptyPreflight());
  });

  await page.route("**/api/opportunities/*/convert", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
    const body = JSON.parse(route.request().postData() || "{}") as JsonRecord;
    state.convertCalls.push({ id, body });
    const linked = typeof body.linkToProjectId === "string";
    await fulfillJson(route, {
      ok: true,
      converted: true,
      already_converted: false,
      project_id: linked ? (body.linkToProjectId as string) : NEW_PROJECT_ID,
      disposition_id: uuid(500001),
      relinked_estimates: 0,
      materialized_tasks: 0,
      attached_photos: 0,
      linked_existing: linked,
      won: true,
    });
  });

  await page.route("**/rest/v1/**", (route) => handleRestRoute(route, state));
  await page.route("**/storage/v1/object/**", async (route) => {
    await fulfillJson(route, {});
  });
}

async function openPipelineTable(page: Page, state: WonFlowState) {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await installMocks(page, state);

  await page.goto("/pipeline", { waitUntil: "domcontentloaded", timeout: 60000 });
  await expect(page.getByRole("group", { name: "Pipeline view" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator('[data-pipeline-mode-surface="table"]')).toBeVisible({
    timeout: 15000,
  });
  await expect(tableCell(page, opportunityId(1), "deal")).toContainText(
    "Won Flow Deal 001",
    { timeout: 15000 },
  );
}

/** Open the Won dialog for an active deal via the stage cell's stage picker. */
async function openWonDialog(page: Page, index: number) {
  await tableCell(page, opportunityId(index), "stage")
    .getByRole("button", { name: "Change stage" })
    .click();
  await page.getByRole("option", { name: "Won" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return dialog;
}

test.describe("Won → Project conversion (Won dialog)", () => {
  test.describe.configure({ mode: "serial", timeout: 90000 });

  test("clean create: shows the auto-name preview and fires ONE convert with no link/title", async ({
    page,
  }) => {
    const state = createState();
    state.preflightById[opportunityId(1)] = emptyPreflight();
    await openPipelineTable(page, state);

    const dialog = await openWonDialog(page, 1);

    // Auto-name preview = the street line derived from the opp address
    // (`1240 W 6th Ave`, no comma → whole string). The operator never typed it.
    await expect(dialog.getByTestId("won-name-preview")).toContainText(
      "1240 W 6th Ave",
    );
    // The single primary CTA is the create label, enabled once preflight settles.
    const confirm = dialog.getByTestId("won-confirm-cta");
    await expect(confirm).toBeEnabled();
    await expect(confirm).toContainText(/mark won/i);

    await confirm.click();

    await expect
      .poll(() => state.convertCalls.length, { timeout: 10000 })
      .toBe(1);
    const call = state.convertCalls[0];
    expect(call.id).toBe(opportunityId(1));
    // Auto-named (no titleOverride) and a brand-new project (no linkToProjectId)
    // — one atomic win+convert.
    expect(call.body.titleOverride ?? null).toBeNull();
    expect(call.body.linkToProjectId ?? null).toBeNull();
  });

  test("duplicate-exists: offers OPEN PROJECT and writes nothing", async ({ page }) => {
    const state = createState();
    state.preflightById[opportunityId(2)] = {
      ...emptyPreflight(),
      existingLinkedProject: { id: EXISTING_PROJECT_ID, title: "88 Maple St" },
    };
    await openPipelineTable(page, state);

    const dialog = await openWonDialog(page, 2);

    await expect(dialog.getByTestId("won-existing-linked")).toBeVisible();
    const confirm = dialog.getByTestId("won-confirm-cta");
    await expect(confirm).toContainText(/open project/i);
    await confirm.click();

    // Opening the already-linked project must NOT create/convert anything.
    await page.waitForTimeout(800);
    expect(state.convertCalls).toHaveLength(0);
  });

  test("duplicate candidate: selecting one switches the CTA to LINK & WIN and converts with linkToProjectId", async ({
    page,
  }) => {
    const state = createState();
    state.preflightById[opportunityId(3)] = {
      ...emptyPreflight(),
      duplicateCandidates: [
        {
          projectId: CANDIDATE_PROJECT_ID,
          title: "300 King Rd",
          address: "300 King Rd",
          confidence: "high",
          signals: ["same_client", "same_address"],
        },
      ],
    };
    await openPipelineTable(page, state);

    const dialog = await openWonDialog(page, 3);

    // Selecting the candidate flips the primary action from create → link.
    await dialog.getByTestId(`won-candidate-${CANDIDATE_PROJECT_ID}`).click();
    const confirm = dialog.getByTestId("won-confirm-cta");
    await expect(confirm).toContainText(/link & win/i);
    await confirm.click();

    await expect
      .poll(() => state.convertCalls.length, { timeout: 10000 })
      .toBe(1);
    const call = state.convertCalls[0];
    expect(call.id).toBe(opportunityId(3));
    expect(call.body.linkToProjectId).toBe(CANDIDATE_PROJECT_ID);
  });

  test("client-has-others: surfaces the others list but still creates a new project", async ({
    page,
  }) => {
    const state = createState();
    state.preflightById[opportunityId(4)] = {
      ...emptyPreflight(),
      otherClientProjects: [
        {
          projectId: OTHER_PROJECT_ID,
          title: "Older Job",
          address: "7 Birch Ln",
          status: "in_progress",
        },
      ],
    };
    await openPipelineTable(page, state);

    const dialog = await openWonDialog(page, 4);

    // The informational "other projects" disclosure is present…
    await expect(dialog.getByTestId("won-other-projects-toggle")).toBeVisible();
    // …but with no candidate selected the default action is still create-new.
    const confirm = dialog.getByTestId("won-confirm-cta");
    await expect(confirm).toContainText(/mark won/i);
    await confirm.click();

    await expect
      .poll(() => state.convertCalls.length, { timeout: 10000 })
      .toBe(1);
    expect(state.convertCalls[0].body.linkToProjectId ?? null).toBeNull();
  });

  test("rename: a hand-typed name converts with titleOverride (frozen)", async ({
    page,
  }) => {
    const state = createState();
    state.preflightById[opportunityId(5)] = emptyPreflight();
    await openPipelineTable(page, state);

    const dialog = await openWonDialog(page, 5);

    await dialog.getByTestId("won-rename-toggle").click();
    await dialog.getByTestId("won-rename-input").fill("Pine Way Reroof");
    await dialog.getByTestId("won-confirm-cta").click();

    await expect
      .poll(() => state.convertCalls.length, { timeout: 10000 })
      .toBe(1);
    const call = state.convertCalls[0];
    expect(call.id).toBe(opportunityId(5));
    expect(call.body.titleOverride).toBe("Pine Way Reroof");
  });

  test("convert an already-won deal via the table // CONVERT affordance", async ({
    page,
  }) => {
    const state = createState();
    // Deal 6 was won (e.g. via estimate approval) but never converted.
    state.opportunityRows[5] = {
      ...state.opportunityRows[5],
      stage: "won",
      project_id: null,
      actual_close_date: isoDaysFromNow(-1),
    };
    state.preflightById[opportunityId(6)] = emptyPreflight();
    await openPipelineTable(page, state);

    // Won/lost deals are hidden by default — reveal them via the toolbar toggle
    // so the already-won row appears.
    await page.getByRole("button", { name: "Show closed" }).click();
    await expect(tableCell(page, opportunityId(6), "deal")).toBeVisible({
      timeout: 10000,
    });

    // The won/unconverted row's stage cell offers `// CONVERT` in its menu.
    await tableCell(page, opportunityId(6), "stage")
      .getByTestId("cell-stage-trigger")
      .click();
    await page.getByTestId("cell-stage-convert").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.getByTestId("won-confirm-cta").click();

    await expect
      .poll(() => state.convertCalls.length, { timeout: 10000 })
      .toBe(1);
    expect(state.convertCalls[0].id).toBe(opportunityId(6));
  });
});
