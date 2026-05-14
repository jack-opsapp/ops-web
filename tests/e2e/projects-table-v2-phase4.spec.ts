import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CURRENT_USER_ID = "00000000-0000-4000-8000-000000000101";
const MEMBER_ONE_ID = "00000000-0000-4000-8000-000000000102";
const MEMBER_TWO_ID = "00000000-0000-4000-8000-000000000103";
const CLIENT_ID = "00000000-0000-4000-8000-000000000201";
const ALL_ACTIVE_VIEW_ID = "00000000-0000-4000-8000-000000000301";
const COMPLETED_VIEW_ID = "00000000-0000-4000-8000-000000000302";
const PROJECT_COUNT = 620;
const AUTH_TOKEN = "mock-id-token";
const FIREBASE_FALLBACK_API_KEY = "ops-e2e-api-key";
const E2E_ORIGIN =
  process.env.E2E_BASE_URL ??
  `http://localhost:${process.env.E2E_PORT ?? "3000"}`;

type JsonRecord = Record<string, unknown>;

type Phase4State = {
  tableRows: JsonRecord[];
  projectRows: JsonRecord[];
  taskRows: JsonRecord[];
  photosByProject: Map<string, JsonRecord[]>;
  notifications: JsonRecord[];
  dispatchCalls: JsonRecord[];
  teamAssignCalls: JsonRecord[];
  photoInsertCalls: JsonRecord[];
  bulkCalls: JsonRecord[][];
  uploadedObjects: string[];
  removedObjects: string[];
  failNextTeamAssignWithPermission: boolean;
  failNextStorageUpload: boolean;
  failNextPhotoInsert: boolean;
  failBulkProjectIds: Set<string>;
};

function uuid(sequence: number) {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function projectId(index: number) {
  return uuid(1000 + index);
}

function taskId(index: number, offset = 0) {
  return uuid(5000 + index * 10 + offset);
}

function updatedAt(index: number) {
  const value = new Date(Date.UTC(2026, 4, 13, 12, 0, 0));
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
    // Optional local env file. Playwright supplies a deterministic fallback.
  }

  return [...keys];
}

function tableCell(page: Page, rowId: string, columnId: string) {
  return page.locator(
    `[data-project-table-row-id="${rowId}"][data-project-table-column-id="${columnId}"]`,
  );
}

function tableCheckbox(page: Page, rowId: string) {
  return tableCell(page, rowId, "select").locator('input[type="checkbox"]');
}

function photoDialog(page: Page, index: number) {
  return page.getByRole("dialog", {
    name: `// PHOTOS - Phase 4 Project ${String(index).padStart(3, "0")}`,
  });
}

function createProjectTableRow(index: number): JsonRecord {
  const status = index % 13 === 0 ? "completed" : "in_progress";
  return {
    id: projectId(index),
    company_id: COMPANY_ID,
    title: `Phase 4 Project ${String(index).padStart(3, "0")}`,
    status,
    client_id: CLIENT_ID,
    client_name: "Maverick Builders",
    client_email: "ops-client@example.com",
    client_phone: "555-0100",
    address: `${100 + index} Gate Road`,
    team_member_ids: index === 3 ? [MEMBER_ONE_ID] : [],
    start_date: "2026-06-01",
    end_date: "2026-06-15",
    duration: 14,
    progress: index % 13 === 0 ? 1 : 0.42,
    next_task: `Task ${index}.1`,
    task_count: 2,
    task_completed_count: index % 13 === 0 ? 2 : 0,
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

function createTaskRows(projectIndex: number): JsonRecord[] {
  const project_id = projectId(projectIndex);
  return [
    {
      id: taskId(projectIndex, 1),
      project_id,
      company_id: COMPANY_ID,
      custom_title: `Task ${projectIndex}.1`,
      status: "active",
      task_color: "#6F94B0",
      task_notes: null,
      task_type_id: uuid(7001),
      team_member_ids: [],
      start_date: "2026-06-01",
      end_date: "2026-06-03",
      duration: 2,
      all_day: true,
      display_order: 1,
      created_at: "2026-05-01T12:00:00.000Z",
      updated_at: "2026-05-01T12:00:00.000Z",
      deleted_at: null,
    },
    {
      id: taskId(projectIndex, 2),
      project_id,
      company_id: COMPANY_ID,
      custom_title: `Task ${projectIndex}.2`,
      status: "active",
      task_color: "#6F94B0",
      task_notes: null,
      task_type_id: uuid(7002),
      team_member_ids: [],
      start_date: "2026-06-04",
      end_date: "2026-06-05",
      duration: 1,
      all_day: true,
      display_order: 2,
      created_at: "2026-05-01T12:01:00.000Z",
      updated_at: "2026-05-01T12:01:00.000Z",
      deleted_at: null,
    },
  ];
}

function createState(): Phase4State {
  const tableRows = Array.from({ length: PROJECT_COUNT }, (_, index) =>
    createProjectTableRow(index + 1),
  );
  return {
    tableRows,
    projectRows: tableRows.map(createProjectRow),
    taskRows: tableRows.flatMap((_row, index) => createTaskRows(index + 1)),
    photosByProject: new Map(),
    notifications: [],
    dispatchCalls: [],
    teamAssignCalls: [],
    photoInsertCalls: [],
    bulkCalls: [],
    uploadedObjects: [],
    removedObjects: [],
    failNextTeamAssignWithPermission: false,
    failNextStorageUpload: false,
    failNextPhotoInsert: false,
    failBulkProjectIds: new Set(),
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
    {
      id: MEMBER_TWO_ID,
      first_name: "Riley",
      last_name: "Crew",
      email: "riley@ops.test",
      role: "crew",
      profile_image_url: null,
      user_color: null,
      company_id: COMPANY_ID,
      is_active: true,
      deleted_at: null,
    },
  ];
}

function projectViews() {
  const columns = [
    "name",
    "status",
    "client",
    "team",
    "end_date",
    "photos",
    "address",
    "next_task",
    "progress",
    "updated_at",
  ];

  return [
    {
      id: ALL_ACTIVE_VIEW_ID,
      company_id: COMPANY_ID,
      name: "All Active",
      icon: null,
      permission_key: null,
      columns,
      filters: {},
      sort: [{ field: "updated_at", direction: "desc" }],
      density: "comfortable",
      zoom_level: 1,
      is_default: true,
      is_archived: false,
      sort_position: 1,
      updated_at: "2026-05-13T12:00:00.000Z",
    },
    {
      id: COMPLETED_VIEW_ID,
      company_id: COMPANY_ID,
      name: "Completed Only",
      icon: null,
      permission_key: null,
      columns,
      filters: { field: "status", op: "in", value: ["completed"] },
      sort: [{ field: "updated_at", direction: "desc" }],
      density: "comfortable",
      zoom_level: 1,
      is_default: false,
      is_archived: false,
      sort_position: 2,
      updated_at: "2026-05-13T12:01:00.000Z",
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

function rowProjectId(row: JsonRecord) {
  return String(row.id);
}

function filteredTableRows(state: Phase4State, url: URL) {
  let rows = [...state.tableRows];
  const projectId = eqParam(url, "project_id");
  if (projectId) {
    rows = rows.filter((row) => rowProjectId(row) === projectId);
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

function rangeSlice(route: Route, rows: JsonRecord[]) {
  const range = route.request().headers().range;
  const match = range?.match(/^(\d+)-(\d+)$/);
  const from = match ? Number(match[1]) : 0;
  const to = match ? Number(match[2]) : rows.length - 1;
  return {
    from,
    to,
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

function updateTableRow(
  state: Phase4State,
  projectIdValue: string,
  patch: JsonRecord,
) {
  state.tableRows = state.tableRows.map((row) =>
    rowProjectId(row) === projectIdValue ? { ...row, ...patch } : row,
  );
  state.projectRows = state.projectRows.map((row) =>
    rowProjectId(row) === projectIdValue ? { ...row, ...patch } : row,
  );
}

async function handleRpcRoute(route: Route, state: Phase4State, rpcName: string) {
  const body = JSON.parse(route.request().postData() || "{}") as JsonRecord;

  if (rpcName === "assign_project_team_member") {
    state.teamAssignCalls.push(body);
    if (state.failNextTeamAssignWithPermission) {
      state.failNextTeamAssignWithPermission = false;
      await fulfillJson(route, { code: "42501", message: "permission denied" }, 403);
      return;
    }

    const projectIdValue = String(body.p_project_id);
    const userId = String(body.p_user_id);
    const nextUpdatedAt = new Date().toISOString();
    const row = state.tableRows.find((candidate) => rowProjectId(candidate) === projectIdValue);
    const memberIds = new Set<string>(
      Array.isArray(row?.team_member_ids) ? (row?.team_member_ids as string[]) : [],
    );
    memberIds.add(userId);
    updateTableRow(state, projectIdValue, {
      team_member_ids: Array.from(memberIds),
      updated_at: nextUpdatedAt,
    });
    state.taskRows = state.taskRows.map((task) => {
      const taskIds = Array.isArray(body.p_task_ids) ? (body.p_task_ids as string[]) : [];
      if (!taskIds.includes(String(task.id))) return task;
      const taskMembers = new Set<string>(
        Array.isArray(task.team_member_ids) ? (task.team_member_ids as string[]) : [],
      );
      taskMembers.add(userId);
      return { ...task, team_member_ids: Array.from(taskMembers) };
    });
    await fulfillJson(route, { updated_at: nextUpdatedAt });
    return;
  }

  if (rpcName === "create_project_table_assignment_task") {
    const projectIdValue = String(body.p_project_id);
    const createdTaskId = uuid(8800 + state.taskRows.length);
    state.taskRows.push({
      id: createdTaskId,
      project_id: projectIdValue,
      company_id: COMPANY_ID,
      custom_title: String(body.p_title),
      status: "active",
      team_member_ids: [],
      display_order: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    });
    const nextUpdatedAt = new Date().toISOString();
    updateTableRow(state, projectIdValue, { task_count: 1, updated_at: nextUpdatedAt });
    await fulfillJson(route, { task_id: createdTaskId, updated_at: nextUpdatedAt });
    return;
  }

  if (rpcName === "bulk_update_project_table") {
    const operations = Array.isArray(body.p_operations)
      ? (body.p_operations as JsonRecord[])
      : [];
    state.bulkCalls.push(operations);

    const success: JsonRecord[] = [];
    const failed: JsonRecord[] = [];
    for (const operation of operations) {
      const projectIdValue = String(operation.project_id);
      if (state.failBulkProjectIds.has(projectIdValue)) {
        failed.push({
          project_id: projectIdValue,
          action: operation.action,
          code: "P0001",
          message: "stale updated_at",
        });
        continue;
      }

      const nextUpdatedAt = new Date().toISOString();
      if (operation.action === "status") {
        updateTableRow(state, projectIdValue, {
          status: operation.status,
          updated_at: nextUpdatedAt,
        });
      } else if (operation.action === "date") {
        updateTableRow(state, projectIdValue, {
          [String(operation.field)]: operation.value,
          updated_at: nextUpdatedAt,
        });
      } else if (operation.action === "assign_team") {
        const row = state.tableRows.find(
          (candidate) => rowProjectId(candidate) === projectIdValue,
        );
        const memberIds = new Set<string>(
          Array.isArray(row?.team_member_ids) ? (row?.team_member_ids as string[]) : [],
        );
        memberIds.add(String(operation.user_id));
        updateTableRow(state, projectIdValue, {
          team_member_ids: Array.from(memberIds),
          updated_at: nextUpdatedAt,
        });
      } else if (operation.action === "remove_team") {
        const row = state.tableRows.find(
          (candidate) => rowProjectId(candidate) === projectIdValue,
        );
        const userId = String(operation.user_id);
        updateTableRow(state, projectIdValue, {
          team_member_ids: (Array.isArray(row?.team_member_ids)
            ? (row?.team_member_ids as string[])
            : []
          ).filter((id) => id !== userId),
          updated_at: nextUpdatedAt,
        });
      }
      success.push({
        project_id: projectIdValue,
        action: operation.action,
        updated_at: nextUpdatedAt,
      });
    }

    await fulfillJson(route, {
      success,
      failed,
      success_count: success.length,
      failed_count: failed.length,
    });
    return;
  }

  if (rpcName === "create_notification_if_new") {
    await fulfillJson(route, {});
    return;
  }

  await fulfillJson(route, {});
}

async function handleRestRoute(route: Route, state: Phase4State) {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.split("/rest/v1/")[1] ?? "";
  const table = decodeURIComponent(path.split("?")[0] ?? "");
  const method = request.method();

  if (table.startsWith("rpc/")) {
    await handleRpcRoute(route, state, table.slice(4));
    return;
  }

  if (table === "project_views") {
    await fulfillRange(route, projectViews());
    return;
  }

  if (table === "project_table_rows") {
    await fulfillRange(route, filteredTableRows(state, url));
    return;
  }

  if (table === "projects") {
    if (method === "PATCH") {
      const patch = JSON.parse(request.postData() || "{}") as JsonRecord;
      const id = eqParam(url, "id");
      if (id) updateTableRow(state, id, { ...patch, updated_at: new Date().toISOString() });
      await fulfillJson(route, { updated_at: new Date().toISOString() });
      return;
    }
    await fulfillRange(route, state.projectRows);
    return;
  }

  if (table === "users") {
    await fulfillRange(route, teamRows());
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

  if (table === "project_tasks") {
    const projectIdValue = eqParam(url, "project_id");
    const rows = projectIdValue
      ? state.taskRows.filter((row) => String(row.project_id) === projectIdValue)
      : state.taskRows;
    await fulfillRange(route, rows);
    return;
  }

  if (table === "project_photos") {
    if (method === "POST") {
      const payload = JSON.parse(request.postData() || "{}") as JsonRecord;
      state.photoInsertCalls.push(payload);
      if (state.failNextPhotoInsert) {
        state.failNextPhotoInsert = false;
        await fulfillJson(route, { code: "P0001", message: "insert failed" }, 409);
        return;
      }

      const projectIdValue = String(payload.project_id);
      const photo = {
        id: uuid(9000 + state.photoInsertCalls.length),
        ...payload,
        created_at: new Date().toISOString(),
        deleted_at: null,
      };
      const existing = state.photosByProject.get(projectIdValue) ?? [];
      state.photosByProject.set(projectIdValue, [photo, ...existing]);
      const row = state.tableRows.find((candidate) => rowProjectId(candidate) === projectIdValue);
      updateTableRow(state, projectIdValue, {
        photo_count: Number(row?.photo_count ?? 0) + 1,
      });
      await fulfillJson(route, photo);
      return;
    }

    const projectIdValue = eqParam(url, "project_id");
    const rows = projectIdValue
      ? state.photosByProject.get(projectIdValue) ?? []
      : Array.from(state.photosByProject.values()).flat();
    await fulfillRange(route, rows);
    return;
  }

  if (table === "project_notes") {
    await fulfillJson(route, {
      id: uuid(9900),
      project_id: projectId(1),
      company_id: COMPANY_ID,
      author_id: CURRENT_USER_ID,
      content: "",
      attachments: [],
      mentioned_user_ids: [],
      event_kind: "photo_uploaded",
      content_metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    });
    return;
  }

  if (table === "notifications") {
    await fulfillRange(route, state.notifications);
    return;
  }

  await fulfillRange(route, []);
}

async function handleStorageRoute(route: Route, state: Phase4State) {
  const request = route.request();
  const url = new URL(request.url());
  const uploadPrefix = "/storage/v1/object/project-photos/";

  if (request.method() === "DELETE") {
    const body = JSON.parse(request.postData() || "{}") as { prefixes?: string[] };
    if (Array.isArray(body.prefixes)) {
      state.removedObjects.push(...body.prefixes);
    }
    await fulfillJson(route, []);
    return;
  }

  if (request.method() === "POST" || request.method() === "PUT") {
    const objectPath = decodeURIComponent(url.pathname.split(uploadPrefix)[1] ?? "");
    if (state.failNextStorageUpload) {
      state.failNextStorageUpload = false;
      await fulfillJson(route, { statusCode: "400", message: "upload failed" }, 400);
      return;
    }
    state.uploadedObjects.push(objectPath);
    await fulfillJson(route, { Key: `project-photos/${objectPath}` });
    return;
  }

  await fulfillJson(route, {});
}

async function installPhase4Mocks(page: Page, state: Phase4State) {
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
    ({
      apiKeys,
      authToken,
      companyId,
      currentUserId,
      memberOneId,
      memberTwoId,
      viewId,
    }) => {
      const now = Date.now();
      const trackedWindow = window as typeof window & {
        __phase4NavigationLog?: string[];
      };
      trackedWindow.__phase4NavigationLog = [];
      const originalPushState = window.history.pushState.bind(window.history);
      const originalReplaceState = window.history.replaceState.bind(window.history);
      window.history.pushState = (...args) => {
        const stack = new Error().stack?.split("\n").slice(2, 16).join(" <- ");
        trackedWindow.__phase4NavigationLog?.push(
          `push:${String(args[2])}${stack ? ` @ ${stack}` : ""}`,
        );
        return originalPushState(...args);
      };
      window.history.replaceState = (...args) => {
        const stack = new Error().stack?.split("\n").slice(2, 16).join(" <- ");
        trackedWindow.__phase4NavigationLog?.push(
          `replace:${String(args[2])}${stack ? ` @ ${stack}` : ""}`,
        );
        return originalReplaceState(...args);
      };
      window.localStorage.setItem(
        "ops-auth-storage",
        JSON.stringify({
          state: {
            currentUser: {
              id: currentUserId,
              firstName: "E2E",
              lastName: "Manager",
              email: "e2e-manager@ops.test",
              phone: null,
              profileImageURL: null,
              role: "admin",
              companyId,
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
            },
            company: {
              id: companyId,
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
              adminIds: [currentUserId],
              accountHolderId: currentUserId,
              defaultProjectColor: "#6F94B0",
              teamMembersSynced: true,
              subscriptionStatus: "active",
              subscriptionPlan: "team",
              subscriptionEnd: null,
              subscriptionPeriod: null,
              maxSeats: 50,
              seatedEmployeeIds: [currentUserId, memberOneId, memberTwoId],
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
            },
            token: authToken,
            isAuthenticated: true,
            role: "admin",
          },
          version: 0,
        }),
      );
      for (const apiKey of apiKeys) {
        window.localStorage.setItem(
          `firebase:authUser:${apiKey}:[DEFAULT]`,
          JSON.stringify({
            uid: currentUserId,
            email: "e2e-manager@ops.test",
            emailVerified: true,
            displayName: "E2E Manager",
            isAnonymous: false,
            phoneNumber: null,
            photoURL: null,
            tenantId: null,
            providerId: "firebase",
            providerData: [
              {
                providerId: "password",
                uid: "e2e-manager@ops.test",
                displayName: "E2E Manager",
                email: "e2e-manager@ops.test",
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
      companyId: COMPANY_ID,
      currentUserId: CURRENT_USER_ID,
      memberOneId: MEMBER_ONE_ID,
      memberTwoId: MEMBER_TWO_ID,
      viewId: ALL_ACTIVE_VIEW_ID,
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
      user: {
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
      },
      company: {
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
        seatedEmployeeIds: [CURRENT_USER_ID, MEMBER_ONE_ID, MEMBER_TWO_ID],
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
      },
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
      id: "phase4-dashboard-preferences",
      user_id: CURRENT_USER_ID,
      company_id: COMPANY_ID,
      widget_instances: [],
      dashboard_layout: "default",
      scheduling_type: "both",
      map_default_zoom: 12,
      map_default_center: null,
      map_show_traffic: false,
      map_show_crew_labels: true,
      created_at: "2026-05-13T12:00:00.000Z",
      updated_at: "2026-05-13T12:00:00.000Z",
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
    const body = JSON.parse(route.request().postData() || "{}") as JsonRecord;
    state.dispatchCalls.push(body);
    await fulfillJson(route, { ok: true });
  });

  await page.route("**/rest/v1/**", (route) => handleRestRoute(route, state));
  await page.route("**/storage/v1/object/**", (route) =>
    handleStorageRoute(route, state),
  );
}

async function openProjectsTable(page: Page, state: Phase4State) {
  const browserErrors: string[] = [];
  const frameNavigations: string[] = [];
  page.on("pageerror", (error) => {
    browserErrors.push(error.stack ?? error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      frameNavigations.push(frame.url());
    }
  });

  await installPhase4Mocks(page, state);
  let renderError: unknown = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto("/projects", { waitUntil: "domcontentloaded", timeout: 60000 });
    try {
      await expect(tableCell(page, projectId(1), "name")).toContainText(
        "Phase 4 Project 001",
        { timeout: 12000 },
      );
      await page.waitForTimeout(5000);
      if (new URL(page.url()).pathname !== "/projects") {
        renderError = new Error(`Projects route moved to ${page.url()}`);
        continue;
      }
      await expect(tableCell(page, projectId(1), "name")).toBeVisible({
        timeout: 5000,
      });
      return;
    } catch (error) {
      renderError = error;
      if (attempt === 3) {
        break;
      }
    }
  }

  const historyCalls = page.isClosed()
    ? "page closed before diagnostics"
    : await page.evaluate(() => {
        const trackedWindow = window as typeof window & {
          __phase4NavigationLog?: string[];
        };
        return trackedWindow.__phase4NavigationLog?.join(" -> ") ?? "none captured";
      });

  throw new Error(
    [
      "Projects Table V2 did not render.",
      `Current URL: ${page.isClosed() ? "page closed" : page.url()}`,
      `Frame navigations: ${frameNavigations.join(" -> ") || "none captured"}`,
      `History calls: ${historyCalls}`,
      `Browser errors: ${browserErrors.slice(0, 6).join(" | ") || "none captured"}`,
    ].join("\n"),
    { cause: renderError },
  );
}

async function selectRows(page: Page, rowIds: string[]) {
  for (const rowId of rowIds) {
    await tableCheckbox(page, rowId).click();
  }
}

async function expectBulkOperations(
  state: Phase4State,
  index: number,
  projectIds: string[],
) {
  await expect
    .poll(() => state.bulkCalls.length, { timeout: 10000 })
    .toBeGreaterThan(index);
  expect(state.bulkCalls[index].map((operation) => operation.project_id).sort()).toEqual(
    [...projectIds].sort(),
  );
}

test.describe("Projects Table V2 Phase 4 browser gate", () => {
  test.describe.configure({ mode: "serial", timeout: 90000 });

  test("assigns a team member through RPC-only table services", async ({ page }) => {
    const state = createState();
    await openProjectsTable(page, state);

    await tableCell(page, projectId(1), "team")
      .getByRole("button", { name: /Team - Phase 4 Project 001/i })
      .click();
    await page.getByRole("button", { name: "Riley Crew" }).click();
    await page.getByRole("checkbox", { name: "Task 1.1" }).click();
    await page.getByRole("checkbox", { name: "Task 1.2" }).click();
    await page.getByRole("button", { name: /^Assign$/ }).click();

    await expect
      .poll(() => state.teamAssignCalls.length, { timeout: 10000 })
      .toBe(1);
    expect(state.teamAssignCalls[0]).toMatchObject({
      p_project_id: projectId(1),
      p_user_id: MEMBER_TWO_ID,
      p_task_ids: [taskId(1, 1), taskId(1, 2)],
    });
    await expect(tableCell(page, projectId(1), "team")).toContainText("1");
    await expect
      .poll(() => state.dispatchCalls.length, { timeout: 10000 })
      .toBe(1);
    expect(state.dispatchCalls[0]).toMatchObject({
      eventType: "project_assigned",
      recipientIds: [MEMBER_TWO_ID],
      companyId: COMPANY_ID,
    });
  });

  test("shows the read-only team path when assignment permission is denied", async ({
    page,
  }) => {
    const state = createState();
    state.failNextTeamAssignWithPermission = true;
    await openProjectsTable(page, state);

    await tableCell(page, projectId(1), "team")
      .getByRole("button", { name: /Team - Phase 4 Project 001/i })
      .click();
    await page.getByRole("button", { name: "Riley Crew" }).click();
    await page.getByRole("checkbox", { name: "Task 1.1" }).click();
    await page.getByRole("button", { name: /^Assign$/ }).click();

    await expect(page.getByText("// READ-ONLY - no team permission")).toBeVisible();
    await expect(tableCell(page, projectId(1), "team")).toContainText("0");
  });

  test("uploads photos through Storage and cleans up failed paths", async ({ page }) => {
    const state = createState();
    await openProjectsTable(page, state);
    const file = {
      name: "phase4-photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("phase-4-photo"),
    };

    await tableCell(page, projectId(1), "photos")
      .getByRole("button", { name: /Photos - Phase 4 Project 001/i })
      .click();
    await photoDialog(page, 1).getByLabel("Select photos").setInputFiles(file);
    await expect
      .poll(() => state.photoInsertCalls.length, { timeout: 10000 })
      .toBe(1);
    expect(state.photoInsertCalls[0]).toMatchObject({
      company_id: COMPANY_ID,
      project_id: projectId(1),
      source: "other",
      uploaded_by: CURRENT_USER_ID,
      is_client_visible: false,
    });
    await expect(tableCell(page, projectId(1), "photos")).toContainText("1");

    await page.keyboard.press("Escape");
    state.failNextStorageUpload = true;
    await tableCell(page, projectId(2), "photos")
      .getByRole("button", { name: /Photos - Phase 4 Project 002/i })
      .click();
    await photoDialog(page, 2).getByLabel("Select photos").setInputFiles(file);
    await expect(page.getByText("// ERROR - UPLOAD FAILED")).toBeVisible();
    expect(
      state.photoInsertCalls.filter((call) => call.project_id === projectId(2)),
    ).toHaveLength(0);
    expect(state.photosByProject.get(projectId(2)) ?? []).toHaveLength(0);

    await page.keyboard.press("Escape");
    state.failNextPhotoInsert = true;
    await tableCell(page, projectId(3), "photos")
      .getByRole("button", { name: /Photos - Phase 4 Project 003/i })
      .click();
    await photoDialog(page, 3).getByLabel("Select photos").setInputFiles(file);
    await expect(page.getByText("// ERROR - UPLOAD FAILED")).toBeVisible();
    await expect
      .poll(() => state.removedObjects.length, { timeout: 10000 })
      .toBe(1);
    expect(state.uploadedObjects[state.uploadedObjects.length - 1]).toBe(
      state.removedObjects[0],
    );
    expect(state.photosByProject.get(projectId(3)) ?? []).toHaveLength(0);
  });

  test("runs bulk status with one undo and bulk due-date updates", async ({ page }) => {
    const state = createState();
    await openProjectsTable(page, state);

    await selectRows(page, [projectId(1), projectId(2)]);
    await page.getByLabel("Change status").selectOption("Completed");
    await page.getByRole("button", { name: "Change status" }).click();
    await expectBulkOperations(state, 0, [projectId(1), projectId(2)]);
    expect(state.bulkCalls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "status", status: "completed" }),
      ]),
    );
    await expect(tableCell(page, projectId(1), "status")).toContainText("Completed");
    await expect(tableCell(page, projectId(2), "status")).toContainText("Completed");

    await page.getByRole("button", { name: "Undo" }).focus();
    await page.keyboard.press("Enter");
    await expectBulkOperations(state, 1, [projectId(1), projectId(2)]);
    expect(state.bulkCalls[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "status", status: "in_progress" }),
      ]),
    );
    await expect(tableCell(page, projectId(1), "status")).toContainText("In Progress");

    await selectRows(page, [projectId(1), projectId(2)]);
    await page.getByLabel("Set due date").fill("2026-07-04");
    await page.getByRole("button", { name: "Set due date" }).click();
    await expectBulkOperations(state, 2, [projectId(1), projectId(2)]);
    expect(state.bulkCalls[2]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "date",
          field: "end_date",
          value: "2026-07-04",
        }),
      ]),
    );
    await expect(tableCell(page, projectId(1), "end_date")).toContainText("Jul 4");
  });

  test("assigns teams in bulk and handles partial failure retry/discard", async ({
    page,
  }) => {
    const state = createState();
    await openProjectsTable(page, state);

    await selectRows(page, [projectId(1), projectId(2)]);
    await page.getByRole("button", { name: /^Assign to$/ }).click();
    await page.getByLabel("Assign to", { exact: true }).selectOption(MEMBER_TWO_ID);
    await page.getByLabel("Assign to all active tasks").check();
    await page.getByRole("button", { name: /^Assign to$/ }).last().click();
    await expectBulkOperations(state, 0, [projectId(1), projectId(2)]);
    expect(state.bulkCalls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "assign_team",
          user_id: MEMBER_TWO_ID,
          task_ids: [taskId(1, 1), taskId(1, 2)],
        }),
        expect.objectContaining({
          action: "assign_team",
          user_id: MEMBER_TWO_ID,
          task_ids: [taskId(2, 1), taskId(2, 2)],
        }),
      ]),
    );
    await expect(tableCell(page, projectId(1), "team")).toContainText("1");

    await selectRows(page, [projectId(3), projectId(4)]);
    state.failBulkProjectIds = new Set([projectId(4)]);
    await page.getByLabel("Change status").selectOption("Completed");
    await page.getByRole("button", { name: "Change status" }).click();
    await expectBulkOperations(state, 1, [projectId(3), projectId(4)]);
    await expect(page.getByText("Updated 1 of 2. 1 failed.")).toBeVisible();

    state.failBulkProjectIds.clear();
    await page.getByRole("button", { name: "Retry" }).click();
    await expectBulkOperations(state, 2, [projectId(4)]);

    await selectRows(page, [projectId(5), projectId(6)]);
    state.failBulkProjectIds = new Set([projectId(6)]);
    await page.getByRole("button", { name: "Change status" }).click();
    await expectBulkOperations(state, 3, [projectId(5), projectId(6)]);
    await expect(page.getByText("Updated 1 of 2. 1 failed.")).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText("Updated 1 of 2. 1 failed.")).toBeHidden();
    await expect(page.getByText("// 1 SELECTED")).toBeHidden();
  });

  test("clears selection on view, search, filter, and sort changes", async ({
    page,
  }) => {
    const state = createState();
    await openProjectsTable(page, state);

    await selectRows(page, [projectId(1)]);
    await expect(page.getByText("// 1 SELECTED")).toBeVisible();
    await page.getByPlaceholder("Search projects...").fill("Phase 4 Project 002");
    await expect(page.getByText("// 1 SELECTED")).toBeHidden();

    await page.getByPlaceholder("Search projects...").fill("");
    await expect(tableCell(page, projectId(1), "name")).toBeVisible();
    await selectRows(page, [projectId(1)]);
    await page.getByRole("button", { name: "Completed Only" }).click();
    await expect(page.getByText("// 1 SELECTED")).toBeHidden();

    await page.getByRole("button", { name: "All Active" }).click();
    await expect(tableCell(page, projectId(1), "name")).toBeVisible();
    await selectRows(page, [projectId(1)]);
    await page
      .locator(".sticky.top-0")
      .getByRole("button", { name: /^Name$/ })
      .click();
    await expect(page.getByText("// 1 SELECTED")).toBeHidden();
  });

  test("keeps frozen columns aligned through virtualization and horizontal scroll", async ({
    page,
  }) => {
    const state = createState();

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 820, height: 1180 },
    ]) {
      await page.setViewportSize(viewport);
      if (page.url() === "about:blank") {
        await openProjectsTable(page, state);
      } else {
        await page.reload();
        await expect(tableCell(page, projectId(1), "name")).toBeVisible({
          timeout: 20000,
        });
      }

      const targetRowId = projectId(500);
      const grid = page.getByRole("grid", { name: "Projects table" });
      const measuredRowHeight = await tableCell(page, projectId(1), "name").evaluate(
        (cell) => Math.max(32, Math.round((cell as HTMLElement).getBoundingClientRect().height)),
      );
      const targetTop = measuredRowHeight * 492;
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await grid.evaluate((scroller) => {
          scroller.scrollTop = scroller.scrollHeight;
          scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
        await page.waitForTimeout(500);
        await grid.evaluate(
          (scroller, nextTop) => {
            scroller.scrollTop = nextTop;
            scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
          },
          targetTop,
        );
        if (await tableCell(page, targetRowId, "name").isVisible().catch(() => false)) {
          break;
        }
        await page.waitForTimeout(500);
      }

      await expect(tableCell(page, targetRowId, "name")).toContainText(
        "Phase 4 Project 500",
        { timeout: 15000 },
      );
      await grid.evaluate((scroller) => {
        scroller.scrollLeft = 900;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      });

      const geometry = await tableCell(page, targetRowId, "select").evaluate(
        (selectCell) => {
          const rowId = selectCell.getAttribute("data-project-table-row-id");
          const scroller = selectCell.closest(".overflow-auto") as HTMLElement;
          const nameCell = document.querySelector(
            `[data-project-table-row-id="${rowId}"][data-project-table-column-id="name"]`,
          ) as HTMLElement;
          const statusCell = document.querySelector(
            `[data-project-table-row-id="${rowId}"][data-project-table-column-id="status"]`,
          ) as HTMLElement;
          const scrollerBox = scroller.getBoundingClientRect();
          const selectBox = selectCell.getBoundingClientRect();
          const nameBox = nameCell.getBoundingClientRect();
          const statusBox = statusCell.getBoundingClientRect();

          return {
            scrollerLeft: scrollerBox.left,
            selectLeft: selectBox.left,
            nameLeft: nameBox.left,
            statusLeft: statusBox.left,
            statusRight: statusBox.right,
          };
        },
      );

      expect(geometry.selectLeft).toBeGreaterThanOrEqual(geometry.scrollerLeft - 1);
      expect(geometry.nameLeft).toBeGreaterThan(geometry.selectLeft + 36);
      expect(geometry.statusLeft).toBeGreaterThan(geometry.nameLeft + 180);
      expect(geometry.statusRight).toBeLessThan(geometry.scrollerLeft + 460);
    }
  });
});
