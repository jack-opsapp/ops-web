import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  resolveEmailRouteActorMock,
  checkPermissionByIdMock,
  getConnectionMock,
  getConnectionsMock,
  updateConnectionMock,
  configureCompanyMailboxIntakeOwnerMock,
  deleteConnectionMock,
  disconnectPersonalConnectionMock,
} = vi.hoisted(() => ({
  resolveEmailRouteActorMock: vi.fn(),
  checkPermissionByIdMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getConnectionsMock: vi.fn(),
  updateConnectionMock: vi.fn(),
  configureCompanyMailboxIntakeOwnerMock: vi.fn(),
  deleteConnectionMock: vi.fn(),
  disconnectPersonalConnectionMock: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveEmailRouteActorMock,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: vi.fn(() => ({ kind: "service-role-double" })),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: vi.fn(
    async (_client: unknown, operation: () => Promise<unknown>) => operation()
  ),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getConnections: getConnectionsMock,
    updateConnection: updateConnectionMock,
    configureCompanyMailboxIntakeOwner: configureCompanyMailboxIntakeOwnerMock,
    deleteConnection: deleteConnectionMock,
  },
}));

vi.mock(
  "@/lib/api/services/personal-email-connection-lifecycle-service",
  () => ({
    PersonalEmailConnectionLifecycleService: {
      disconnect: disconnectPersonalConnectionMock,
    },
  })
);

import {
  DELETE,
  GET,
  PATCH,
} from "@/app/api/integrations/email/connection/route";

const COMPANY_ID = "company-1";
const ACTOR_ID = "user-1";
const DEFAULT_OWNER_ID = "11111111-1111-4111-8111-111111111111";
const NEXT_OWNER_ID = "22222222-2222-4222-8222-222222222222";

function connection(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "connection-company",
    companyId: COMPANY_ID,
    provider: "gmail",
    type: "company",
    userId: null,
    defaultIntakeOwnerId: DEFAULT_OWNER_ID,
    email: "shared@canpro.test",
    accessToken: "secret-access-token",
    refreshToken: "secret-refresh-token",
    expiresAt: new Date("2026-07-16T12:00:00.000Z"),
    historyId: "provider-history-id",
    syncEnabled: true,
    lastSyncedAt: new Date("2026-07-15T12:00:00.000Z"),
    syncIntervalMinutes: 60,
    syncFilters: { wizardCompleted: true },
    historyRecoveryAnchor: null,
    historyRecoveryPageToken: "recovery-page-token",
    historyRecoveryTargetToken: "recovery-target-token",
    webhookSubscriptionId: "provider-subscription-id",
    webhookExpiresAt: new Date("2026-07-17T12:00:00.000Z"),
    webhookClientStateHash: "client-state-hash",
    opsLabelId: "OPS_LABEL",
    aiReviewEnabled: true,
    aiMemoryEnabled: true,
    status: "active",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-15T12:00:00.000Z"),
    ...overrides,
  };
}

function request(
  method: "GET" | "PATCH" | "DELETE",
  options: { id?: string; body?: unknown } = {}
): NextRequest {
  const url = new URL("https://ops.test/api/integrations/email/connection");
  if (options.id) url.searchParams.set("id", options.id);
  const hasBody = options.body !== undefined;
  return new NextRequest(url, {
    method,
    headers: {
      authorization: "Bearer firebase-token",
      ...(hasBody ? { "content-type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
}

function expectNoCredentialMaterial(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("secret-access-token");
  expect(serialized).not.toContain("secret-refresh-token");
  expect(serialized).not.toContain("accessToken");
  expect(serialized).not.toContain("refreshToken");
  expect(serialized).not.toContain("access_token");
  expect(serialized).not.toContain("refresh_token");
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveEmailRouteActorMock.mockResolvedValue({
    ok: true,
    actor: { userId: ACTOR_ID, companyId: COMPANY_ID },
  });
  checkPermissionByIdMock.mockResolvedValue(false);
  getConnectionsMock.mockResolvedValue([]);
  updateConnectionMock.mockImplementation(
    async (_id: string, data: Record<string, unknown>) =>
      connection({ ...data })
  );
  configureCompanyMailboxIntakeOwnerMock.mockImplementation(
    async ({ newOwnerId }: { newOwnerId: string | null }) =>
      connection({ defaultIntakeOwnerId: newOwnerId })
  );
  deleteConnectionMock.mockResolvedValue(undefined);
  disconnectPersonalConnectionMock.mockResolvedValue({
    state: "processed",
    affectedConversationCount: 1,
    notifiedUserCount: 1,
    resolvedNotificationCount: 0,
  });
});

describe("authenticated email connection API", () => {
  it("lists only safe company and actor-owned personal descriptors", async () => {
    getConnectionsMock.mockResolvedValue([
      connection(),
      connection({
        id: "connection-mine",
        type: "individual",
        userId: ACTOR_ID,
        email: "actor@personal.test",
      }),
      connection({
        id: "connection-other",
        type: "individual",
        userId: "user-2",
        email: "other@personal.test",
      }),
    ]);

    const response = await GET(request("GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getConnectionsMock).toHaveBeenCalledWith(COMPANY_ID);
    expect(body.connections.map((item: { id: string }) => item.id)).toEqual([
      "connection-company",
      "connection-mine",
    ]);
    expect(body.connections[0]).toMatchObject({
      id: "connection-company",
      companyId: COMPANY_ID,
      provider: "gmail",
      type: "company",
      email: "shared@canpro.test",
      status: "active",
      defaultIntakeOwnerId: null,
    });
    expectNoCredentialMaterial(body);
  });

  it("does not expose another user's personal connection by id", async () => {
    getConnectionMock.mockResolvedValue(
      connection({ type: "individual", userId: "user-2" })
    );

    const response = await GET(request("GET", { id: "connection-other" }));

    expect(response.status).toBe(403);
  });

  it("lets the canonical owner update a personal connection without integration-admin authority", async () => {
    getConnectionMock.mockResolvedValue(
      connection({
        id: "connection-mine",
        type: "individual",
        userId: ACTOR_ID,
      })
    );

    const response = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-mine",
          data: { syncEnabled: false, syncIntervalMinutes: 30 },
        },
      })
    );

    expect(response.status).toBe(200);
    expect(checkPermissionByIdMock).not.toHaveBeenCalled();
    expect(updateConnectionMock).toHaveBeenCalledWith("connection-mine", {
      syncEnabled: false,
      syncIntervalMinutes: 30,
    });
  });

  it("requires settings.integrations to update a company connection", async () => {
    getConnectionMock.mockResolvedValue(connection());

    const denied = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          data: { syncEnabled: false },
        },
      })
    );

    expect(denied.status).toBe(403);
    expect(updateConnectionMock).not.toHaveBeenCalled();
    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      ACTOR_ID,
      "settings.integrations",
      "all"
    );

    checkPermissionByIdMock.mockResolvedValueOnce(true);
    const allowed = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          data: { syncEnabled: false },
        },
      })
    );

    expect(allowed.status).toBe(200);
    expect(updateConnectionMock).toHaveBeenCalledWith("connection-company", {
      syncEnabled: false,
    });
  });

  it("guards company intake-owner changes with assignment authority and a stale-safe expectation", async () => {
    getConnectionMock.mockResolvedValue(connection());
    checkPermissionByIdMock.mockImplementation(
      async (_userId: string, permission: string, scope?: string) =>
        permission === "settings.integrations" && scope === "all"
    );

    const denied = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          expectedDefaultIntakeOwnerId: DEFAULT_OWNER_ID,
          data: { defaultIntakeOwnerId: NEXT_OWNER_ID },
        },
      })
    );

    expect(denied.status).toBe(403);
    expect(configureCompanyMailboxIntakeOwnerMock).not.toHaveBeenCalled();
    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      ACTOR_ID,
      "pipeline.assign",
      "all"
    );

    checkPermissionByIdMock.mockResolvedValue(true);
    const allowed = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          expectedDefaultIntakeOwnerId: DEFAULT_OWNER_ID,
          data: { defaultIntakeOwnerId: NEXT_OWNER_ID },
        },
      })
    );

    expect(allowed.status).toBe(200);
    expect(configureCompanyMailboxIntakeOwnerMock).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      connectionId: "connection-company",
      expectedOwnerId: DEFAULT_OWNER_ID,
      newOwnerId: NEXT_OWNER_ID,
    });
    expect(updateConnectionMock).not.toHaveBeenCalled();
    expect(await allowed.json()).toMatchObject({
      connection: { defaultIntakeOwnerId: NEXT_OWNER_ID },
    });
  });

  it("rejects blind or personal-mailbox intake-owner changes", async () => {
    checkPermissionByIdMock.mockResolvedValue(true);
    getConnectionMock.mockResolvedValue(connection());

    const missingExpectation = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          data: { defaultIntakeOwnerId: NEXT_OWNER_ID },
        },
      })
    );
    expect(missingExpectation.status).toBe(400);

    getConnectionMock.mockResolvedValue(
      connection({
        id: "connection-mine",
        type: "individual",
        userId: ACTOR_ID,
      })
    );
    const personal = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-mine",
          expectedDefaultIntakeOwnerId: DEFAULT_OWNER_ID,
          data: { defaultIntakeOwnerId: NEXT_OWNER_ID },
        },
      })
    );
    expect(personal.status).toBe(400);
    expect(configureCompanyMailboxIntakeOwnerMock).not.toHaveBeenCalled();
  });

  it("rejects invalid, mixed, and stale intake-owner configuration writes", async () => {
    checkPermissionByIdMock.mockResolvedValue(true);
    getConnectionMock.mockResolvedValue(connection());

    const invalidOwner = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          expectedDefaultIntakeOwnerId: DEFAULT_OWNER_ID,
          data: { defaultIntakeOwnerId: "not-a-user-id" },
        },
      })
    );
    expect(invalidOwner.status).toBe(400);

    const mixedUpdate = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          expectedDefaultIntakeOwnerId: DEFAULT_OWNER_ID,
          data: {
            defaultIntakeOwnerId: NEXT_OWNER_ID,
            syncEnabled: false,
          },
        },
      })
    );
    expect(mixedUpdate.status).toBe(400);

    const conflict = new Error("stale owner");
    conflict.name = "CompanyMailboxIntakeOwnerConflictError";
    configureCompanyMailboxIntakeOwnerMock.mockRejectedValueOnce(conflict);
    const staleUpdate = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          expectedDefaultIntakeOwnerId: DEFAULT_OWNER_ID,
          data: { defaultIntakeOwnerId: NEXT_OWNER_ID },
        },
      })
    );
    expect(staleUpdate.status).toBe(409);
    expect(await staleUpdate.json()).toEqual({
      error: "Connection changed. Refresh and try again.",
    });

    const ineligible = new Error("owner_ineligible");
    ineligible.name = "CompanyMailboxIntakeOwnerValidationError";
    configureCompanyMailboxIntakeOwnerMock.mockRejectedValueOnce(ineligible);
    const rejectedOwner = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          expectedDefaultIntakeOwnerId: DEFAULT_OWNER_ID,
          data: { defaultIntakeOwnerId: NEXT_OWNER_ID },
        },
      })
    );
    expect(rejectedOwner.status).toBe(400);
    expect(await rejectedOwner.json()).toEqual({
      error: "Choose an active teammate with lead and inbox access.",
    });
  });

  it("merges wizard sync filters without allowing credential updates", async () => {
    getConnectionMock.mockResolvedValue(connection());
    checkPermissionByIdMock.mockResolvedValue(true);

    const response = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          syncFilters: { reviewState: { subStep: "triage" } },
        },
      })
    );

    expect(response.status).toBe(200);
    expect(updateConnectionMock).toHaveBeenCalledWith("connection-company", {
      syncFilters: {
        wizardCompleted: true,
        reviewState: { subStep: "triage" },
      },
    });

    const rejected = await PATCH(
      request("PATCH", {
        body: {
          connectionId: "connection-company",
          data: { accessToken: "attacker-controlled-token" },
        },
      })
    );

    expect(rejected.status).toBe(400);
  });

  it("rejects malformed update payloads without touching persistence", async () => {
    const response = await PATCH(request("PATCH", { body: null }));

    expect(response.status).toBe(400);
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(updateConnectionMock).not.toHaveBeenCalled();
  });

  it("requires ownership for personal disconnect and settings authority for company disconnect", async () => {
    getConnectionMock.mockResolvedValueOnce(
      connection({ type: "individual", userId: "user-2" })
    );
    const personalDenied = await DELETE(
      request("DELETE", { id: "connection-other" })
    );
    expect(personalDenied.status).toBe(403);
    expect(deleteConnectionMock).not.toHaveBeenCalled();

    getConnectionMock.mockResolvedValueOnce(connection());
    const companyDenied = await DELETE(
      request("DELETE", { id: "connection-company" })
    );
    expect(companyDenied.status).toBe(403);

    getConnectionMock.mockResolvedValueOnce(connection());
    checkPermissionByIdMock.mockResolvedValueOnce(true);
    const companyAllowed = await DELETE(
      request("DELETE", { id: "connection-company" })
    );
    expect(companyAllowed.status).toBe(200);
    expect(deleteConnectionMock).toHaveBeenCalledWith("connection-company");
  });

  it("uses the durable lifecycle only for an owner-disconnected personal mailbox", async () => {
    const ownedPersonal = connection({
      id: "connection-mine",
      type: "individual",
      userId: ACTOR_ID,
      email: "actor@personal.test",
    });
    getConnectionMock.mockResolvedValue(ownedPersonal);

    const response = await DELETE(request("DELETE", { id: "connection-mine" }));

    expect(response.status).toBe(200);
    expect(disconnectPersonalConnectionMock).toHaveBeenCalledWith(
      ownedPersonal,
      expect.anything()
    );
    expect(deleteConnectionMock).not.toHaveBeenCalled();
  });

  it("uses the canonical server-derived email actor", async () => {
    getConnectionsMock.mockResolvedValue([connection()]);

    const emailRequest = request("GET");
    await GET(emailRequest);

    expect(resolveEmailRouteActorMock).toHaveBeenCalledWith(emailRequest);
    expect(getConnectionsMock).toHaveBeenCalledWith(COMPANY_ID);
  });

  it("fails closed for an unauthenticated request", async () => {
    resolveEmailRouteActorMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(401);
    expect(getConnectionsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["PATCH", () => PATCH(request("PATCH", { body: {} }))],
    ["DELETE", () => DELETE(request("DELETE"))],
  ] as const)(
    "authenticates before validating %s mutation identifiers",
    async (_method, callRoute) => {
      resolveEmailRouteActorMock.mockResolvedValue({
        ok: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      });

      const response = await callRoute();

      expect(response.status).toBe(401);
      expect(getConnectionMock).not.toHaveBeenCalled();
    }
  );
});
