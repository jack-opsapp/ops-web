import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  authenticateRequest: vi.fn(),
  getAccessTokenClient: vi.fn(),
  getServiceRoleClient: vi.fn(),
  statusRpc: vi.fn(),
  processBatch: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void>>,
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
vi.mock("@/lib/api/services/project-status-lifecycle-outbox-service", () => ({
  ProjectStatusLifecycleOutboxService: {
    processBatch: mocks.processBatch,
  },
}));

import { PATCH } from "@/app/api/projects/[id]/status/route";

function projectQuery(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

function actorDb(result: { data: unknown; error: unknown }) {
  return { from: vi.fn(() => projectQuery(result)) };
}

function request(body: unknown, token = "token") {
  return new Request("http://localhost/api/projects/project-1/status", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.after.mockImplementation((callback: () => Promise<void>) => {
    mocks.afterCallbacks.push(callback);
  });
  mocks.authenticateRequest.mockResolvedValue({
    id: "actor-1",
    companyId: "company-1",
    role: "operator",
    firstName: "Jason",
    lastName: "Zavarella",
  });
  mocks.statusRpc.mockResolvedValue({
    data: {
      changed: true,
      updated_at: "2026-07-16T00:00:01.000Z",
      status_version: 2,
      from_status: "rfq",
      to_status: "estimated",
    },
    error: null,
  });
  mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.statusRpc });
  mocks.processBatch.mockResolvedValue({
    claimed: 1,
    completed: 1,
    requeued: 0,
    failed: 0,
    terminalFailed: 0,
    errors: [],
  });
  mocks.getAccessTokenClient.mockReturnValue(
    actorDb({
      data: {
        id: "project-1",
        status: "rfq",
        status_version: 1,
        updated_at: "2026-07-16T00:00:00.000Z",
      },
      error: null,
    })
  );
});

describe("PATCH /api/projects/:id/status", () => {
  it("uses the canonical actor-aware RPC and never trusts body identity", async () => {
    const response = await PATCH(
      request({
        status: "Estimated",
        companyId: "spoofed-company",
        userId: "spoofed-user",
      }) as never,
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, changed: true });
    expect(mocks.statusRpc).toHaveBeenCalledWith(
      "change_project_status_as_system",
      {
        p_actor_user_id: "actor-1",
        p_project_id: "project-1",
        p_new_status: "estimated",
        p_expected_updated_at: "2026-07-16T00:00:00.000Z",
        p_expected_status: "rfq",
        p_expected_status_version: 1,
      }
    );
    expect(JSON.stringify(mocks.statusRpc.mock.calls)).not.toContain("spoofed");
    expect(mocks.processBatch).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(1);

    await mocks.afterCallbacks[0]();
    expect(mocks.processBatch).toHaveBeenCalledWith(expect.anything(), {
      limit: 10,
      leaseSeconds: 180,
    });
  });

  it("does not schedule lifecycle work when the locked RPC reports no change", async () => {
    mocks.statusRpc.mockResolvedValueOnce({
      data: {
        changed: false,
        updated_at: "2026-07-16T00:00:00.000Z",
        status_version: 1,
        from_status: "estimated",
        to_status: "estimated",
      },
      error: null,
    });

    const response = await PATCH(request({ status: "Estimated" }) as never, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, changed: false });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("fails closed when the canonical RPC denies edit or archive authority", async () => {
    mocks.statusRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "project access denied" },
    });

    const response = await PATCH(request({ status: "Archived" }) as never, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("stops before database access for an inactive actor", async () => {
    mocks.authenticateRequest.mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
    );

    const response = await PATCH(request({ status: "Estimated" }) as never, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.getAccessTokenClient).not.toHaveBeenCalled();
    expect(mocks.statusRpc).not.toHaveBeenCalled();
  });

  it("returns a conflict when the row-locked compare-and-set loses a race", async () => {
    mocks.statusRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "project conflict" },
    });

    const response = await PATCH(request({ status: "Estimated" }) as never, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(409);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("does not invoke the guarded mutation for an invisible project", async () => {
    mocks.getAccessTokenClient.mockReturnValueOnce(
      actorDb({ data: null, error: null })
    );

    const response = await PATCH(request({ status: "Estimated" }) as never, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.statusRpc).not.toHaveBeenCalled();
  });

  it("fails closed on an invalid guarded RPC result", async () => {
    mocks.statusRpc.mockResolvedValueOnce({ data: null, error: null });

    const response = await PATCH(request({ status: "Estimated" }) as never, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(500);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
