import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const MANAGER_USER_ID = "00000000-0000-4000-8000-000000000101";
const CREW_USER_ID = "00000000-0000-4000-8000-000000000102";
const CLIENT_ID = "00000000-0000-4000-8000-000000000201";
const DEFAULT_VIEW_ID = "00000000-0000-4000-8000-000000000301";
const PERSONAL_VIEW_ID = "00000000-0000-4000-8000-000000000302";
const COMPANY_VIEW_ID = "00000000-0000-4000-8000-000000000303";
const INACCESSIBLE_VIEW_ID = "00000000-0000-4000-8000-000000000399";
const PROJECT_COUNT = 18;
const AUTH_TOKEN = "mock-id-token";
const FIREBASE_FALLBACK_API_KEY = "ops-e2e-api-key";
const E2E_ORIGIN =
  process.env.E2E_BASE_URL ??
  `http://localhost:${process.env.E2E_PORT ?? "3000"}`;

type JsonRecord = Record<string, unknown>;
type Density = "compact" | "comfortable" | "spacious";
type OwnerType = "user" | "company";
type UserMode = "manager" | "non-manager";

type ProjectViewRow = {
  id: string;
  company_id: string;
  name: string;
  icon: string | null;
  permission_key: string | null;
  columns: Array<{ id: string }> | string[];
  filters: JsonRecord;
  sort: Array<{ field: string; direction: "asc" | "desc" }>;
  density: Density;
  zoom_level: number;
  is_default: boolean;
  is_archived: boolean;
  sort_position: number;
  updated_at: string;
  owner_type: OwnerType;
  owner_id: string;
};

type Phase5State = {
  userMode: UserMode;
  views: ProjectViewRow[];
  tableRows: JsonRecord[];
  projectRows: JsonRecord[];
  createCalls: JsonRecord[];
  renameCalls: JsonRecord[];
  archiveCalls: JsonRecord[];
  resetCalls: JsonRecord[];
  shareCalls: JsonRecord[];
  updateDefinitionCalls: JsonRecord[];
  directProjectViewsDmlCalls: JsonRecord[];
  failNextDuplicateName: boolean;
  failNextPermissionDenied: boolean;
};

const DEFAULT_COLUMNS = [
  "name",
  "status",
  "client",
  "end_date",
  "next_task",
  "progress",
] as const;

const SEEDED_DEFAULT_DEFINITION = {
  columns: DEFAULT_COLUMNS.map((id) => ({ id })),
  filters: { field: "status", op: "not_in", value: ["closed", "archived"] },
  sort: [{ field: "updated_at", direction: "desc" as const }],
  density: "comfortable" as const,
  zoom_level: 1,
};

function uuid(sequence: number) {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function projectId(index: number) {
  return uuid(1000 + index);
}

function currentUserId(state: Phase5State) {
  return state.userMode === "manager" ? MANAGER_USER_ID : CREW_USER_ID;
}

function currentUserEmail(state: Phase5State) {
  return state.userMode === "manager" ? "e2e-manager@ops.test" : "e2e-crew@ops.test";
}

function currentUserRole(state: Phase5State) {
  return state.userMode === "manager" ? "admin" : "crew";
}

function updatedAt(index: number) {
  const value = new Date(Date.UTC(2026, 4, 14, 12, 0, 0));
  value.setSeconds(PROJECT_COUNT - index);
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

function tableCell(page: Page, rowId: string, columnId: string) {
  return page.locator(
    `[data-project-table-row-id="${rowId}"][data-project-table-column-id="${columnId}"]`,
  );
}

function viewTab(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^${name}$`, "i") });
}

function createProjectTableRow(index: number): JsonRecord {
  const status = index % 7 === 0 ? "completed" : "in_progress";
  return {
    id: projectId(index),
    company_id: COMPANY_ID,
    title: `Phase 5 Project ${String(index).padStart(3, "0")}`,
    status,
    client_id: CLIENT_ID,
    client_name: "Maverick Builders",
    client_email: "ops-client@example.com",
    client_phone: "555-0100",
    address: `${100 + index} Gate Road`,
    team_member_ids: [],
    start_date: "2026-06-01",
    end_date: "2026-06-15",
    duration: 14,
    progress: index % 7 === 0 ? 1 : 0.42,
    next_task: `Task ${index}.1`,
    task_count: 2,
    task_completed_count: index % 7 === 0 ? 2 : 0,
    days_in_status: index,
    estimate_total: 12000 + index,
    invoice_total: 8000 + index,
    paid_total: 5000 + index,
    value: 16000 + index,
    project_cost: 7000 + index,
    margin: 0.38,
    photo_count: 0,
    updated_at: updatedAt(index),
  };
}

function createProjectRow(row: JsonRecord): JsonRecord {
  return {
    id: row.id,
    title: row.title,
    address: row.address,
    latitude: null,
    longitude: null,
    start_date: row.start_date,
    end_date: row.end_date,
    duration: row.duration,
    status: row.status,
    notes: null,
    company_id: COMPANY_ID,
    client_id: CLIENT_ID,
    all_day: true,
    team_member_ids: row.team_member_ids,
    description: null,
    project_images: [],
    trade: "roofing",
    visibility: "all",
    opportunity_id: null,
    created_at: "2026-05-01T12:00:00.000Z",
    deleted_at: null,
  };
}

function viewRow(input: {
  id: string;
  name: string;
  ownerType: OwnerType;
  ownerId: string;
  sortPosition: number;
  isDefault?: boolean;
  columns?: Array<{ id: string }> | string[];
  filters?: JsonRecord;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  density?: Density;
  zoomLevel?: number;
}): ProjectViewRow {
  return {
    id: input.id,
    company_id: COMPANY_ID,
    name: input.name,
    icon: null,
    permission_key: null,
    columns: input.columns ?? SEEDED_DEFAULT_DEFINITION.columns.map((column) => ({ ...column })),
    filters: input.filters ?? { ...SEEDED_DEFAULT_DEFINITION.filters },
    sort: input.sort ?? SEEDED_DEFAULT_DEFINITION.sort.map((sort) => ({ ...sort })),
    density: input.density ?? SEEDED_DEFAULT_DEFINITION.density,
    zoom_level: input.zoomLevel ?? SEEDED_DEFAULT_DEFINITION.zoom_level,
    is_default: input.isDefault ?? false,
    is_archived: false,
    sort_position: input.sortPosition,
    updated_at: "2026-05-14T12:00:00.000Z",
    owner_type: input.ownerType,
    owner_id: input.ownerId,
  };
}

function createState(userMode: UserMode = "manager"): Phase5State {
  const userId = userMode === "manager" ? MANAGER_USER_ID : CREW_USER_ID;
  const tableRows = Array.from({ length: PROJECT_COUNT }, (_unused, index) =>
    createProjectTableRow(index + 1),
  );

  return {
    userMode,
    views: [
      viewRow({
        id: DEFAULT_VIEW_ID,
        name: "My Active Work",
        ownerType: "user",
        ownerId: userId,
        sortPosition: 0,
        isDefault: true,
      }),
      viewRow({
        id: PERSONAL_VIEW_ID,
        name: "Crew Closeout",
        ownerType: "user",
        ownerId: userId,
        sortPosition: 1,
      }),
      viewRow({
        id: COMPANY_VIEW_ID,
        name: "Company Dispatch",
        ownerType: "company",
        ownerId: COMPANY_ID,
        sortPosition: 2,
        sort: [{ field: "name", direction: "asc" }],
      }),
    ],
    tableRows,
    projectRows: tableRows.map(createProjectRow),
    createCalls: [],
    renameCalls: [],
    archiveCalls: [],
    resetCalls: [],
    shareCalls: [],
    updateDefinitionCalls: [],
    directProjectViewsDmlCalls: [],
    failNextDuplicateName: false,
    failNextPermissionDenied: false,
  };
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
  return {
    from,
    rows: rows.slice(from, to + 1),
  };
}

async function fulfillRange(route: Route, rows: JsonRecord[]) {
  const slice = rangeSlice(route, rows);
  const end = slice.rows.length > 0 ? slice.from + slice.rows.length - 1 : slice.from;
  await fulfillJson(route, slice.rows, 206, {
    "content-range": `${slice.from}-${end}/${rows.length}`,
    "range-unit": "items",
  });
}

function bodyAsRecord(route: Route): JsonRecord {
  return JSON.parse(route.request().postData() || "{}") as JsonRecord;
}

function definitionColumns(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      if (typeof item === "string") return { id: item };
      if (item && typeof item === "object" && "id" in item) {
        return { id: String((item as { id: unknown }).id) };
      }
      return null;
    })
    .filter((item): item is { id: string } => item !== null);
}

function applyDefinition(view: ProjectViewRow, definition: JsonRecord | undefined) {
  if (!definition) return view;
  const next = { ...view };
  const columns = definitionColumns(definition.columns);
  if (columns && columns.length > 0) next.columns = columns;
  if (definition.filters && typeof definition.filters === "object") {
    next.filters = definition.filters as JsonRecord;
  }
  if (Array.isArray(definition.sort)) {
    next.sort = definition.sort as ProjectViewRow["sort"];
  }
  if (
    definition.density === "compact" ||
    definition.density === "comfortable" ||
    definition.density === "spacious"
  ) {
    next.density = definition.density;
  }
  if (typeof definition.zoom_level === "number") {
    next.zoom_level = definition.zoom_level;
  }
  next.updated_at = new Date().toISOString();
  return next;
}

function insertOrReplaceView(state: Phase5State, view: ProjectViewRow) {
  const index = state.views.findIndex((candidate) => candidate.id === view.id);
  if (index === -1) {
    state.views.push(view);
  } else {
    state.views[index] = view;
  }
}

function visibleViews(state: Phase5State): JsonRecord[] {
  const userId = currentUserId(state);
  return state.views
    .filter((view) => {
      if (view.is_archived || view.company_id !== COMPANY_ID) return false;
      if (view.permission_key && state.userMode !== "manager") return false;
      if (view.owner_type === "company" || view.is_default) return true;
      return view.owner_id === userId;
    })
    .sort((a, b) => {
      if (a.sort_position !== b.sort_position) return a.sort_position - b.sort_position;
      return a.name.localeCompare(b.name);
    }) as JsonRecord[];
}

async function failRpc(route: Route, code: string, message: string, status: number) {
  await fulfillJson(route, { code, message }, status);
}

async function handleProjectViewRpc(route: Route, state: Phase5State, rpcName: string) {
  const body = bodyAsRecord(route);

  if (state.failNextDuplicateName) {
    state.failNextDuplicateName = false;
    await failRpc(route, "23505", "View name already exists.", 409);
    return;
  }

  if (state.failNextPermissionDenied) {
    state.failNextPermissionDenied = false;
    await failRpc(route, "42501", "Permission required to manage this view.", 403);
    return;
  }

  if (rpcName === "create_project_table_view") {
    state.createCalls.push(body);
    const sourceId = typeof body.p_source_view_id === "string" ? body.p_source_view_id : null;
    const source = sourceId ? state.views.find((view) => view.id === sourceId) : null;
    const created = applyDefinition(
      {
        ...(source ?? state.views[0]),
        id: uuid(7000 + state.createCalls.length),
        name: String(body.p_name),
        is_default: false,
        is_archived: false,
        sort_position: state.views.length + 1,
        owner_type: "user",
        owner_id: currentUserId(state),
        permission_key: null,
        updated_at: new Date().toISOString(),
      },
      body.p_definition as JsonRecord | undefined,
    );
    insertOrReplaceView(state, created);
    await fulfillJson(route, created);
    return;
  }

  if (rpcName === "rename_project_table_view") {
    state.renameCalls.push(body);
    const view = state.views.find((candidate) => candidate.id === body.p_view_id);
    if (!view) {
      await failRpc(route, "42501", "Permission required to manage this view.", 403);
      return;
    }
    const renamed = { ...view, name: String(body.p_name), updated_at: new Date().toISOString() };
    insertOrReplaceView(state, renamed);
    await fulfillJson(route, renamed);
    return;
  }

  if (rpcName === "archive_project_table_view") {
    state.archiveCalls.push(body);
    const view = state.views.find((candidate) => candidate.id === body.p_view_id);
    if (!view || view.owner_type === "company" || view.is_default) {
      await failRpc(route, "42501", "Permission required to archive this view.", 403);
      return;
    }
    const archived = { ...view, is_archived: true, updated_at: new Date().toISOString() };
    insertOrReplaceView(state, archived);
    await fulfillJson(route, archived);
    return;
  }

  if (rpcName === "reset_project_table_view") {
    state.resetCalls.push(body);
    const view = state.views.find((candidate) => candidate.id === body.p_view_id);
    if (!view?.is_default) {
      await failRpc(route, "42501", "Permission required to reset this view.", 403);
      return;
    }
    const reset = {
      ...view,
      ...SEEDED_DEFAULT_DEFINITION,
      updated_at: new Date().toISOString(),
    };
    insertOrReplaceView(state, reset);
    await fulfillJson(route, reset);
    return;
  }

  if (rpcName === "share_project_table_view") {
    state.shareCalls.push(body);
    if (state.userMode !== "manager") {
      await failRpc(route, "42501", "Permission required to share this view.", 403);
      return;
    }
    const view = state.views.find((candidate) => candidate.id === body.p_view_id);
    if (!view) {
      await failRpc(route, "42501", "Permission required to share this view.", 403);
      return;
    }
    const shared = {
      ...view,
      owner_type: "company" as const,
      owner_id: COMPANY_ID,
      updated_at: new Date().toISOString(),
    };
    insertOrReplaceView(state, shared);
    await fulfillJson(route, shared);
    return;
  }

  if (rpcName === "update_project_table_view_definition") {
    state.updateDefinitionCalls.push(body);
    const view = state.views.find((candidate) => candidate.id === body.p_view_id);
    if (!view) {
      await failRpc(route, "42501", "Permission required to update this view.", 403);
      return;
    }
    const updated = applyDefinition(view, body.p_definition as JsonRecord | undefined);
    insertOrReplaceView(state, updated);
    await fulfillJson(route, updated);
    return;
  }

  await fulfillJson(route, {});
}

function filteredTableRows(state: Phase5State, url: URL) {
  let rows = [...state.tableRows];
  const projectIdValue = eqParam(url, "project_id");
  if (projectIdValue) rows = rows.filter((row) => row.id === projectIdValue);

  const statusFilter = url.searchParams.get("status") ?? "";
  if (statusFilter.startsWith("not.in.")) {
    const blocked = new Set(statusFilter.match(/\((.*)\)/)?.[1]?.split(",") ?? []);
    rows = rows.filter((row) => !blocked.has(String(row.status)));
  } else if (statusFilter.startsWith("in.")) {
    const allowed = new Set(statusFilter.match(/\((.*)\)/)?.[1]?.split(",") ?? []);
    rows = rows.filter((row) => allowed.has(String(row.status)));
  }

  const orFilter = url.searchParams.get("or");
  const searchMatch = orFilter?.match(/ilike\.\%([^%]+)\%/);
  const search = searchMatch?.[1]?.replaceAll("\\", "").toLowerCase() ?? "";
  if (search) {
    rows = rows.filter((row) =>
      [row.title, row.client_name, row.address]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(search)),
    );
  }

  const order = url.searchParams.get("order") ?? "";
  if (order.includes("title.asc")) {
    rows.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  } else if (order.includes("title.desc")) {
    rows.sort((a, b) => String(b.title).localeCompare(String(a.title)));
  } else if (order.includes("status.asc")) {
    rows.sort((a, b) => String(a.status).localeCompare(String(b.status)));
  } else {
    rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  return rows;
}

async function handleRestRoute(route: Route, state: Phase5State) {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.split("/rest/v1/")[1] ?? "";
  const table = decodeURIComponent(path.split("?")[0] ?? "");
  const method = request.method();

  if (table.startsWith("rpc/")) {
    await handleProjectViewRpc(route, state, table.slice(4));
    return;
  }

  if (table === "project_views") {
    if (method !== "GET") {
      state.directProjectViewsDmlCalls.push({
        method,
        body: request.postData(),
      });
      await fulfillJson(route, { code: "PGRST101", message: "Direct DML is not mocked." }, 405);
      return;
    }
    await fulfillRange(route, visibleViews(state));
    return;
  }

  if (table === "project_table_rows") {
    await fulfillRange(route, filteredTableRows(state, url));
    return;
  }

  if (table === "projects") {
    await fulfillRange(route, state.projectRows);
    return;
  }

  if (table === "users") {
    await fulfillRange(route, [
      {
        id: MANAGER_USER_ID,
        first_name: "E2E",
        last_name: "Manager",
        email: "e2e-manager@ops.test",
        role: "admin",
        company_id: COMPANY_ID,
        is_active: true,
        deleted_at: null,
      },
      {
        id: CREW_USER_ID,
        first_name: "E2E",
        last_name: "Crew",
        email: "e2e-crew@ops.test",
        role: "crew",
        company_id: COMPANY_ID,
        is_active: true,
        deleted_at: null,
      },
    ]);
    return;
  }

  if (table === "user_roles") {
    const rolePermissions = [
      { permission: "projects.view", scope: "all" },
      ...(state.userMode === "manager"
        ? [{ permission: "projects.manage_views", scope: "all" }]
        : []),
    ];
    await fulfillJson(route, {
      role_id: state.userMode === "manager" ? "phase5-manager-role" : "phase5-crew-role",
      roles: {
        id: state.userMode === "manager" ? "phase5-manager-role" : "phase5-crew-role",
        name: state.userMode === "manager" ? "Manager" : "Crew",
        role_permissions: rolePermissions,
      },
    });
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

  if (table === "project_tasks" || table === "project_photos" || table === "notifications") {
    await fulfillRange(route, []);
    return;
  }

  await fulfillRange(route, []);
}

function authUserPayload(state: Phase5State) {
  const userId = currentUserId(state);
  const manager = state.userMode === "manager";
  return {
    id: userId,
    firstName: "E2E",
    lastName: manager ? "Manager" : "Crew",
    email: currentUserEmail(state),
    phone: null,
    profileImageURL: null,
    role: currentUserRole(state),
    companyId: COMPANY_ID,
    userType: "employee",
    latitude: null,
    longitude: null,
    locationName: null,
    homeAddress: null,
    clientId: null,
    isActive: true,
    userColor: null,
    devPermission: manager,
    onboardingCompleted: { web: true },
    hasCompletedAppTutorial: true,
    isCompanyAdmin: false,
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
    adminIds: [],
    accountHolderId: uuid(990001),
    defaultProjectColor: "#6F94B0",
    teamMembersSynced: true,
    subscriptionStatus: "active",
    subscriptionPlan: "team",
    subscriptionEnd: null,
    subscriptionPeriod: null,
    maxSeats: 50,
    seatedEmployeeIds: [MANAGER_USER_ID, CREW_USER_ID],
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

async function installPhase5Mocks(page: Page, state: Phase5State) {
  await page.context().addCookies([
    {
      name: "ops-auth-token",
      value: AUTH_TOKEN,
      url: E2E_ORIGIN,
    },
    {
      name: "__session",
      value: AUTH_TOKEN,
      url: E2E_ORIGIN,
    },
  ]);

  await page.addInitScript(
    ({ apiKeys, authToken, company, user, viewId }) => {
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
      window.localStorage.setItem("ops_projects_view_mode", "spreadsheet");
      window.localStorage.setItem("ops_projects_table_v2_view_id", viewId);
    },
    {
      apiKeys: firebaseApiKeys(),
      authToken: AUTH_TOKEN,
      company: authCompanyPayload(),
      user: authUserPayload(state),
      viewId: DEFAULT_VIEW_ID,
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
            localId: currentUserId(state),
            email: currentUserEmail(state),
            displayName: state.userMode === "manager" ? "E2E Manager" : "E2E Crew",
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
      localId: currentUserId(state),
      email: currentUserEmail(state),
      displayName: state.userMode === "manager" ? "E2E Manager" : "E2E Crew",
    });
  });

  await page.route("**/securetoken.googleapis.com/**", async (route) => {
    await fulfillJson(route, {
      id_token: AUTH_TOKEN,
      refresh_token: "mock-refresh-token",
      expires_in: "3600",
      user_id: currentUserId(state),
    });
  });

  await page.route("**/api/dev/bypass-token", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        key: "e2e",
        email: currentUserEmail(state),
        label: state.userMode === "manager" ? "E2E Manager" : "E2E Crew",
        available: [],
      });
      return;
    }
    await fulfillJson(route, {
      token: "mock-custom-token",
      email: currentUserEmail(state),
    });
  });

  await page.route("**/api/auth/sync-user", async (route) => {
    await fulfillJson(route, {
      user: authUserPayload(state),
      company: authCompanyPayload(),
    });
  });

  await page.route("**/api/feature-flags**", async (route) => {
    await fulfillJson(route, [
      {
        slug: "projects_table_v2",
        enabled: true,
        hasOverride: false,
        routes: [],
        permissions: [],
      },
    ]);
  });

  await page.route("**/api/dashboard-preferences**", async (route) => {
    await fulfillJson(route, {
      id: "phase5-dashboard-preferences",
      user_id: currentUserId(state),
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

  await page.route("**/rest/v1/**", (route) => handleRestRoute(route, state));
  await page.route("**/storage/v1/object/**", async (route) => {
    await fulfillJson(route, {});
  });
}

async function openProjectsTable(page: Page, state: Phase5State, path = "/projects") {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => {
    browserErrors.push(error.stack ?? error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await installPhase5Mocks(page, state);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
      await expect(tableCell(page, projectId(1), "name")).toContainText(
        "Phase 5 Project 001",
        { timeout: 15000 },
      );
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
      "Projects Table V2 Phase 5 did not render.",
      `Current URL: ${page.url()}`,
      `Browser errors: ${browserErrors.slice(0, 6).join(" | ") || "none captured"}`,
    ].join("\n"),
    { cause: lastError },
  );
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "View actions" }).click();
}

async function rowHeight(page: Page) {
  const cell = tableCell(page, projectId(1), "name");
  await expect(cell).toBeVisible({ timeout: 10000 });
  await expect
    .poll(
      () =>
        cell.evaluate((node) =>
          Math.round((node as HTMLElement).getBoundingClientRect().height),
        ),
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
  return cell.evaluate((node) =>
    Math.round((node as HTMLElement).getBoundingClientRect().height),
  );
}

async function expectNoDirectProjectViewsDml(state: Phase5State) {
  await expect.poll(() => state.directProjectViewsDmlCalls.length).toBe(0);
}

test.describe("Projects Table V2 Phase 5 browser gate", () => {
  test.describe.configure({ mode: "serial", timeout: 90000 });

  test("creates a personal view, duplicates the default view, and renders duplicate-name errors through RPC mocks", async ({
    page,
  }) => {
    const state = createState();
    await openProjectsTable(page, state);

    await page.getByRole("button", { name: "+ New view" }).click();
    const createDialog = page.getByRole("dialog", { name: "// NEW VIEW" });
    await createDialog.getByLabel("View name").fill("Install week");
    await createDialog.getByRole("radio", { name: "Clone current view" }).check();
    await createDialog.getByRole("button", { name: "Create" }).click();

    await expect(viewTab(page, "Install week")).toHaveClass(/bg-surface-active/);
    await expect.poll(() => state.createCalls.length, { timeout: 10000 }).toBe(1);
    expect(state.createCalls[0]).toMatchObject({
      p_name: "Install week",
      p_source_view_id: DEFAULT_VIEW_ID,
    });
    expect(state.views.at(-1)).toMatchObject({
      name: "Install week",
      owner_type: "user",
      owner_id: MANAGER_USER_ID,
      permission_key: null,
    });

    await viewTab(page, "My Active Work").click();
    await openSettings(page);
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    const duplicateDialog = page.getByRole("dialog", { name: "// DUPLICATE VIEW" });
    await expect(duplicateDialog.getByLabel("View name")).toHaveValue("My Active Work copy");
    await duplicateDialog.getByRole("button", { name: "Create" }).click();

    await expect(viewTab(page, "My Active Work copy")).toHaveClass(/bg-surface-active/);
    await expect.poll(() => state.createCalls.length, { timeout: 10000 }).toBe(2);
    expect(state.createCalls[1]).toMatchObject({
      p_name: "My Active Work copy",
      p_source_view_id: DEFAULT_VIEW_ID,
    });

    state.failNextDuplicateName = true;
    await openSettings(page);
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await page.getByRole("dialog", { name: "// DUPLICATE VIEW" }).getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("View name already exists.")).toBeVisible();
    await expectNoDirectProjectViewsDml(state);
  });

  test("renames a personal view, renders permission-denied errors, archives it, and falls back to default", async ({
    page,
  }) => {
    const state = createState();
    await openProjectsTable(page, state);

    await viewTab(page, "Crew Closeout").click();
    state.failNextPermissionDenied = true;
    await openSettings(page);
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const renameDialog = page.getByRole("dialog", { name: "// RENAME VIEW" });
    await renameDialog.getByLabel("View name").fill("Crew Ready");
    await renameDialog.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText("Permission required to manage this view.")).toBeVisible();

    await renameDialog.getByRole("button", { name: "Save name" }).click();
    await expect(viewTab(page, "Crew Ready")).toHaveClass(/bg-surface-active/);
    await expect.poll(() => state.renameCalls.length, { timeout: 10000 }).toBe(1);
    expect(state.renameCalls[0]).toMatchObject({
      p_view_id: PERSONAL_VIEW_ID,
      p_name: "Crew Ready",
    });

    await openSettings(page);
    await page.getByRole("menuitem", { name: "Archive" }).click();
    const archiveDialog = page.getByRole("alertdialog", { name: "// ARCHIVE VIEW" });
    await archiveDialog.getByRole("button", { name: "Archive" }).click();

    await expect.poll(() => state.archiveCalls.length, { timeout: 10000 }).toBe(1);
    expect(state.archiveCalls[0]).toMatchObject({ p_view_id: PERSONAL_VIEW_ID });
    await expect(viewTab(page, "My Active Work")).toHaveClass(/bg-surface-active/);
    await expect(page.getByRole("button", { name: /Crew Ready/i })).toHaveCount(0);
    await expectNoDirectProjectViewsDml(state);
  });

  test("resets the seeded default view after persisted density and sort changes", async ({
    page,
  }) => {
    const state = createState();
    await openProjectsTable(page, state);

    await page.getByRole("button", { name: "Compact" }).click();
    await expect.poll(() => state.views[0].density, { timeout: 10000 }).toBe("compact");

    await page.locator(".sticky.top-0").getByRole("button", { name: /^Name$/ }).click();
    await page.getByRole("button", { name: "Save view" }).click();
    await expect
      .poll(() => state.updateDefinitionCalls.at(-1)?.p_definition, { timeout: 10000 })
      .toMatchObject({
        sort: [{ field: "name", direction: "asc" }],
      });

    await openSettings(page);
    await page.getByRole("menuitem", { name: "Reset to defaults" }).click();
    await page.getByRole("alertdialog", { name: "// RESET VIEW" }).getByRole("button", { name: "Reset" }).click();

    await expect.poll(() => state.resetCalls.length, { timeout: 10000 }).toBe(1);
    expect(state.views[0]).toMatchObject({
      id: DEFAULT_VIEW_ID,
      density: "comfortable",
      zoom_level: 1,
      is_default: true,
      owner_type: "user",
      owner_id: MANAGER_USER_ID,
      permission_key: null,
      is_archived: false,
      sort: [{ field: "updated_at", direction: "desc" }],
    });
    await expect(page.getByText("100%").first()).toBeVisible();
    await expect.poll(() => rowHeight(page), { timeout: 10000 }).toBeGreaterThanOrEqual(42);
    await expectNoDirectProjectViewsDml(state);
  });

  test("loads a deep-linked view and falls back from an inaccessible view id with unavailable state", async ({
    page,
  }) => {
    const state = createState();
    await openProjectsTable(page, state, `/projects?view=${COMPANY_VIEW_ID}`);

    await expect(viewTab(page, "Company Dispatch")).toHaveClass(/bg-surface-active/);
    expect(new URL(page.url()).searchParams.get("view")).toBe(COMPANY_VIEW_ID);

    await page.goto(`/projects?view=${INACCESSIBLE_VIEW_ID}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await expect(tableCell(page, projectId(1), "name")).toBeVisible({ timeout: 15000 });
    await expect(viewTab(page, "My Active Work")).toHaveClass(/bg-surface-active/);
    await expect(page.getByText("// VIEW UNAVAILABLE")).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"), { timeout: 10000 })
      .toBe(DEFAULT_VIEW_ID);
    await expectNoDirectProjectViewsDml(state);
  });

  test("hides share controls for non-managers", async ({ page }) => {
    const nonManagerState = createState("non-manager");
    await openProjectsTable(page, nonManagerState);
    await openSettings(page);
    await expect(page.getByRole("menuitem", { name: "Share with team" })).toHaveCount(0);
    await expectNoDirectProjectViewsDml(nonManagerState);
  });

  test("lets managers persist company views", async ({ page }) => {
    const managerState = createState("manager");
    await openProjectsTable(page, managerState);
    await viewTab(page, "Crew Closeout").click();
    await openSettings(page);
    await expect(page.getByRole("menuitem", { name: "Share with team" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Share with team" }).click();

    await expect.poll(() => managerState.shareCalls.length, { timeout: 10000 }).toBe(1);
    expect(managerState.views.find((view) => view.id === PERSONAL_VIEW_ID)).toMatchObject({
      owner_type: "company",
      owner_id: COMPANY_ID,
    });

    await openSettings(page);
    await expect(page.getByText("Company", { exact: true })).toBeVisible();
    await expectNoDirectProjectViewsDml(managerState);
  });

  test("changes compact, comfortable, and spacious row heights and persists density after reload", async ({
    page,
  }) => {
    const state = createState();
    await openProjectsTable(page, state);
    const comfortable = await rowHeight(page);

    await page.getByRole("button", { name: "Compact" }).click();
    await expect.poll(() => state.views[0].density, { timeout: 10000 }).toBe("compact");
    const compact = await rowHeight(page);
    expect(compact).toBeLessThan(comfortable);

    await page.getByRole("button", { name: "Spacious" }).click();
    await expect.poll(() => state.views[0].density, { timeout: 10000 }).toBe("spacious");
    const spacious = await rowHeight(page);
    expect(spacious).toBeGreaterThan(comfortable);

    await page.getByRole("button", { name: "Comfortable" }).click();
    await expect.poll(() => state.views[0].density, { timeout: 10000 }).toBe("comfortable");
    expect(await rowHeight(page)).toBe(comfortable);

    await page.getByRole("button", { name: "Spacious" }).click();
    await expect.poll(() => state.views[0].density, { timeout: 10000 }).toBe("spacious");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await expect(tableCell(page, projectId(1), "name")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("125%").first()).toBeVisible();
    expect(await rowHeight(page)).toBe(spacious);
    await expectNoDirectProjectViewsDml(state);
  });

  test("uses simulated pinch density changes without applying transform scale", async ({
    page,
  }) => {
    const state = createState();
    await openProjectsTable(page, state);
    const comfortable = await rowHeight(page);
    const grid = page.getByRole("grid", { name: "Projects table" });

    await grid.evaluate((element) => {
      const touches = (distance: number) => ({
        length: 2,
        item: (index: number) =>
          index === 0
            ? { clientX: 0, clientY: 0 }
            : { clientX: distance, clientY: 0 },
      });
      const start = new Event("touchstart", { bubbles: true, cancelable: true });
      Object.defineProperty(start, "touches", { value: touches(100) });
      element.dispatchEvent(start);

      const move = new Event("touchmove", { bubbles: true, cancelable: true });
      Object.defineProperty(move, "touches", { value: touches(620) });
      element.dispatchEvent(move);

      const end = new Event("touchend", { bubbles: true, cancelable: true });
      Object.defineProperty(end, "touches", { value: touches(620) });
      element.dispatchEvent(end);
    });

    await expect.poll(() => state.views[0].density, { timeout: 10000 }).toBe("spacious");
    expect(await rowHeight(page)).toBeGreaterThan(comfortable);

    const scaleTransforms = await grid.evaluate((element) =>
      Array.from(element.querySelectorAll<HTMLElement>("*"))
        .map((node) => node.style.transform)
        .filter((transform) => transform.toLowerCase().includes("scale")),
    );
    expect(scaleTransforms).toEqual([]);
    await expectNoDirectProjectViewsDml(state);
  });
});
