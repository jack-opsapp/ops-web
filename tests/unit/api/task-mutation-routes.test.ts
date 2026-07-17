import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const TASK_TYPE_ID = "55555555-5555-4555-8555-555555555555";
const MEMBER_ID = "77777777-7777-4777-8777-777777777777";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void>>,
  authenticateRequest: vi.fn(),
  getAccessTokenClient: vi.fn(),
  getServiceRoleClient: vi.fn(),
  actorRpc: vi.fn(),
  serializeTaskPatch: vi.fn(),
  processTaskAutomation: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@/app/api/agent/_lib/auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
  isErrorResponse: (value: unknown) => value instanceof Response,
}));
vi.mock("@/lib/supabase/accessToken-client", () => ({
  getAccessTokenClient: mocks.getAccessTokenClient,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));
vi.mock("@/lib/api/services/task-service", () => ({
  serializeTaskPatch: mocks.serializeTaskPatch,
}));
vi.mock("@/lib/api/services/task-mutation-automation-outbox-service", () => ({
  TaskMutationAutomationOutboxService: {
    processBatch: mocks.processTaskAutomation,
  },
}));

import { PATCH } from "@/app/api/tasks/[id]/route";
import { POST } from "@/app/api/tasks/route";

type QueryResult = { data: unknown; error: unknown };

function query(result: QueryResult) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

function actorDatabase(...results: QueryResult[]) {
  const builders = results.map(query);
  return {
    rpc: mocks.actorRpc,
    from: vi.fn(() => {
      const builder = builders.shift();
      if (!builder) throw new Error("Unexpected database query");
      return builder;
    }),
  };
}

function request(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  });
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    task: {
      id: TASK_ID,
      projectId: PROJECT_ID,
      taskTypeId: TASK_TYPE_ID,
      ...overrides,
    },
  };
}

function currentTask(updatedAt = "2026-07-20T11:00:00.000Z") {
  return { id: TASK_ID, updated_at: updatedAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.after.mockImplementation((callback: () => Promise<void>) => {
    mocks.afterCallbacks.push(callback);
  });
  mocks.authenticateRequest.mockResolvedValue({
    id: ACTOR_ID,
    companyId: COMPANY_ID,
    role: "operator",
    firstName: "Jason",
    lastName: "Zavarella",
  });
  mocks.actorRpc.mockImplementation(async (name: string) => {
    if (name === "create_task_with_event") {
      return {
        data: { task_id: TASK_ID, created: true, schedule_version: 1 },
        error: null,
      };
    }
    if (name === "update_task_with_event") {
      return {
        data: {
          ok: true,
          conflict: false,
          changed: true,
          schedule_changed: true,
          schedule_version: 2,
        },
        error: null,
      };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  mocks.getAccessTokenClient.mockReturnValue(actorDatabase());
  mocks.getServiceRoleClient.mockReturnValue({ service: true });
  mocks.serializeTaskPatch.mockImplementation((value: unknown) => {
    const input = value as Record<string, unknown>;
    const serialized: Record<string, unknown> = {};
    const fields: Array<[string, string]> = [
      ["id", "id"],
      ["companyId", "company_id"],
      ["projectId", "project_id"],
      ["taskTypeId", "task_type_id"],
      ["status", "status"],
      ["customTitle", "custom_title"],
      ["teamMemberIds", "team_member_ids"],
      ["startDate", "start_date"],
      ["endDate", "end_date"],
    ];
    for (const [source, target] of fields) {
      if (input[source] !== undefined) serialized[target] = input[source];
    }
    return serialized;
  });
  mocks.processTaskAutomation.mockResolvedValue({
    claimed: 1,
    completed: 1,
    superseded: 0,
    skipped: 0,
    requeued: 0,
    failed: 0,
    terminalFailed: 0,
    errors: [],
  });
});

describe("POST /api/tasks", () => {
  it("uses the authenticated atomic create RPC and strips body authority", async () => {
    mocks.getAccessTokenClient.mockReturnValue(actorDatabase());

    const response = await POST(
      request("POST", "/api/tasks", {
        task: {
          id: TASK_ID,
          projectId: PROJECT_ID,
          companyId: "spoofed-company",
          taskTypeId: TASK_TYPE_ID,
          sourceLineItemId: "forged-source",
        },
        schedule: {
          title: "Site visit",
          startDate: "2026-07-21T16:00:00.000Z",
        },
      }) as never
    );

    expect(response.status).toBe(201);
    expect(mocks.getAccessTokenClient).toHaveBeenCalledWith("token");
    expect(mocks.actorRpc).toHaveBeenCalledWith("create_task_with_event", {
      p_task_id: TASK_ID,
      p_project_id: PROJECT_ID,
      p_task_type_id: TASK_TYPE_ID,
      p_payload: {
        start_date: new Date("2026-07-21T16:00:00.000Z"),
        end_date: null,
      },
    });
    expect(mocks.actorRpc.mock.calls[0][1]).not.toHaveProperty(
      "p_actor_user_id"
    );
    const serializedInput = mocks.serializeTaskPatch.mock.calls[0][0];
    expect(serializedInput.startDate).toBeInstanceOf(Date);
    expect(serializedInput.companyId).toBe(COMPANY_ID);
    expect(serializedInput.sourceLineItemId).toBeUndefined();
    expect(mocks.afterCallbacks).toHaveLength(1);

    await mocks.afterCallbacks[0]();
    expect(mocks.processTaskAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ service: true }),
      { limit: 10, leaseSeconds: 180 }
    );
  });

  it("delegates create authorization to the atomic RPC and fails closed", async () => {
    mocks.getAccessTokenClient.mockReturnValue(actorDatabase());
    mocks.actorRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "task_create_forbidden" },
    });

    const response = await POST(
      request("POST", "/api/tasks", createBody()) as never
    );

    expect(response.status).toBe(403);
    expect(mocks.actorRpc).toHaveBeenCalledWith(
      "create_task_with_event",
      expect.objectContaining({ p_task_id: TASK_ID })
    );
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it("maps guarded database validation and idempotency conflicts", async () => {
    mocks.getAccessTokenClient.mockReturnValue(actorDatabase());
    mocks.actorRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "invalid_task_type" },
    });
    const invalid = await POST(
      request("POST", "/api/tasks", createBody()) as never
    );
    expect(invalid.status).toBe(400);

    mocks.actorRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "task_id_conflict" },
    });
    const conflict = await POST(
      request("POST", "/api/tasks", createBody()) as never
    );
    expect(conflict.status).toBe(409);

    mocks.actorRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "project_closed" },
    });
    const closedProject = await POST(
      request("POST", "/api/tasks", createBody()) as never
    );
    expect(closedProject.status).toBe(409);
    await expect(closedProject.json()).resolves.toEqual({
      error: "Reopen the project before adding active tasks",
    });
  });

  it("rejects invalid ids and conflicting assignment sources before the RPC", async () => {
    const invalidId = await POST(
      request("POST", "/api/tasks", createBody({ id: "not-a-uuid" })) as never
    );
    expect(invalidId.status).toBe(400);
    expect(mocks.getAccessTokenClient).not.toHaveBeenCalled();

    const conflictingTeam = await POST(
      request("POST", "/api/tasks", {
        ...createBody({ teamMemberIds: [MEMBER_ID] }),
        schedule: {
          title: "Site visit",
          startDate: "2026-07-21T16:00:00.000Z",
          teamMemberIds: [ACTOR_ID],
        },
      }) as never
    );
    expect(conflictingTeam.status).toBe(400);
    expect(mocks.actorRpc).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/tasks/:id", () => {
  it("rejects invalid status values before the database is touched", async () => {
    const response = await PATCH(
      request("PATCH", `/api/tasks/${TASK_ID}`, {
        data: { status: "Won" },
      }) as never,
      { params: Promise.resolve({ id: TASK_ID }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.getAccessTokenClient).not.toHaveBeenCalled();
  });

  it("uses a current-row CAS and the authenticated atomic update RPC", async () => {
    const updatedAt = "2026-07-20T11:00:00.000Z";
    mocks.getAccessTokenClient.mockReturnValue(
      actorDatabase({ data: currentTask(updatedAt), error: null })
    );

    const response = await PATCH(
      request("PATCH", `/api/tasks/${TASK_ID}`, {
        data: {
          startDate: "2026-07-22T16:00:00.000Z",
          companyId: "spoofed-company",
          projectId: "spoofed-project",
          sourceLineItemId: "forged-source",
        },
      }) as never,
      { params: Promise.resolve({ id: TASK_ID }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.actorRpc).toHaveBeenCalledWith("update_task_with_event", {
      p_task_id: TASK_ID,
      p_expected_updated_at: updatedAt,
      p_patch: {
        start_date: new Date("2026-07-22T16:00:00.000Z"),
      },
    });
    expect(mocks.actorRpc.mock.calls[0][1]).not.toHaveProperty(
      "p_actor_user_id"
    );
    const patch = mocks.serializeTaskPatch.mock.calls[0][0];
    expect(patch.startDate).toBeInstanceOf(Date);
    expect(patch.companyId).toBeUndefined();
    expect(patch.projectId).toBeUndefined();
    expect(patch.sourceLineItemId).toBeUndefined();

    await mocks.afterCallbacks[0]();
    expect(mocks.processTaskAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ service: true }),
      { limit: 10, leaseSeconds: 180 }
    );
  });

  it("fails closed when the task is hidden or guarded authorization is revoked", async () => {
    mocks.getAccessTokenClient.mockReturnValueOnce(
      actorDatabase({ data: null, error: null })
    );
    const hidden = await PATCH(
      request("PATCH", `/api/tasks/${TASK_ID}`, {
        data: { customTitle: "Hidden edit" },
      }) as never,
      { params: Promise.resolve({ id: TASK_ID }) }
    );
    expect(hidden.status).toBe(403);
    expect(mocks.actorRpc).not.toHaveBeenCalled();

    mocks.getAccessTokenClient.mockReturnValueOnce(
      actorDatabase({ data: currentTask(), error: null })
    );
    mocks.actorRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "task_edit_forbidden" },
    });
    const revoked = await PATCH(
      request("PATCH", `/api/tasks/${TASK_ID}`, {
        data: { teamMemberIds: [MEMBER_ID] },
      }) as never,
      { params: Promise.resolve({ id: TASK_ID }) }
    );
    expect(revoked.status).toBe(403);
    expect(mocks.actorRpc).toHaveBeenCalledWith(
      "update_task_with_event",
      expect.objectContaining({ p_task_id: TASK_ID })
    );
  });

  it("maps guarded validation and a stale CAS without scheduling follow-up", async () => {
    mocks.getAccessTokenClient.mockReturnValueOnce(
      actorDatabase({ data: currentTask(), error: null })
    );
    mocks.actorRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "invalid_task_team" },
    });
    const invalid = await PATCH(
      request("PATCH", `/api/tasks/${TASK_ID}`, {
        data: { teamMemberIds: [MEMBER_ID] },
      }) as never,
      { params: Promise.resolve({ id: TASK_ID }) }
    );
    expect(invalid.status).toBe(400);

    mocks.getAccessTokenClient.mockReturnValueOnce(
      actorDatabase({ data: currentTask(), error: null })
    );
    mocks.actorRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "project_closed" },
    });
    const closedProject = await PATCH(
      request("PATCH", `/api/tasks/${TASK_ID}`, {
        data: { status: "Booked" },
      }) as never,
      { params: Promise.resolve({ id: TASK_ID }) }
    );
    expect(closedProject.status).toBe(409);
    await expect(closedProject.json()).resolves.toEqual({
      error: "Reopen the project before reactivating this task",
    });

    mocks.getAccessTokenClient.mockReturnValueOnce(
      actorDatabase({ data: currentTask(), error: null })
    );
    mocks.actorRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        conflict: true,
        schedule_version: 4,
        updated_at: "2026-07-20T11:06:00.000Z",
      },
      error: null,
    });
    const conflict = await PATCH(
      request("PATCH", `/api/tasks/${TASK_ID}`, {
        data: { customTitle: "Stale edit" },
      }) as never,
      { params: Promise.resolve({ id: TASK_ID }) }
    );
    expect(conflict.status).toBe(409);
    expect(mocks.afterCallbacks).toHaveLength(0);
  });
});
