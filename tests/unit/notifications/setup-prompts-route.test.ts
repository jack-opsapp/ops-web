import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { actorMock, db, getDbMock, syncMock } = vi.hoisted(() => ({
  actorMock: vi.fn(),
  db: { from: vi.fn() },
  getDbMock: vi.fn(),
  syncMock: vi.fn(),
}));

vi.mock("@/lib/notifications/server-notification-service", () => ({
  resolveNotificationRouteActor: (...args: unknown[]) => actorMock(...args),
}));

vi.mock("@/lib/notifications/setup-prompt-service", () => ({
  syncSetupPromptNotifications: (...args: unknown[]) => syncMock(...args),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => getDbMock(),
}));

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  name: "Operator One",
};

async function loadPost() {
  return (await import("@/app/api/notifications/setup-prompts/route")).POST;
}

function request(body?: unknown): Request {
  return new Request("http://localhost/api/notifications/setup-prompts", {
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
    ...(body === undefined
      ? {}
      : {
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
  });
}

describe("POST /api/notifications/setup-prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actorMock.mockResolvedValue({ ok: true, actor });
    getDbMock.mockReturnValue(db);
    syncMock.mockResolvedValue({ created: 2, resolved: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unauthenticated callers before loading setup state", async () => {
    actorMock.mockResolvedValue({ ok: false, status: 401 });

    const POST = await loadPost();
    const response = await POST(request() as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(getDbMock).not.toHaveBeenCalled();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("rejects identity, copy, recipient, and navigation fields from the browser", async () => {
    const POST = await loadPost();
    const response = await POST(
      request({
        companyId: "forged-company",
        recipientUserIds: ["forged-user"],
        title: "Forged title",
        actionUrl: "https://evil.example",
      }) as never
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body is not allowed",
    });
    expect(getDbMock).not.toHaveBeenCalled();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("passes only the canonical server-derived actor and service client", async () => {
    const POST = await loadPost();
    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      created: 2,
      resolved: 0,
    });
    expect(syncMock).toHaveBeenCalledWith({ actor, db });
  });

  it("fails closed when current setup state cannot be loaded", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    syncMock.mockRejectedValue(new Error("state unavailable"));

    const POST = await loadPost();
    const response = await POST(request() as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to sync setup prompts",
    });
    expect(log).toHaveBeenCalledWith(
      "[setup-prompts] Failed to sync prompts:",
      expect.any(Error)
    );
  });
});
