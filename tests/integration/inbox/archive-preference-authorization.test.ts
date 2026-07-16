import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkPermissionByIdMock,
  findUserByAuthMock,
  getServiceRoleClientMock,
  requireSupabaseMock,
  resolveEmailRouteActorMock,
  runWithSupabaseMock,
  verifyAdminAuthMock,
} = vi.hoisted(() => ({
  checkPermissionByIdMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  requireSupabaseMock: vi.fn(),
  resolveEmailRouteActorMock: vi.fn(),
  runWithSupabaseMock: vi.fn(),
  verifyAdminAuthMock: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveEmailRouteActorMock,
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAdminAuthMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
  runWithSupabase: runWithSupabaseMock,
}));

import { POST as setLeadArchivePreference } from "@/app/api/inbox/lead-archive-preference/route";
import { POST as setWritebackPreference } from "@/app/api/inbox/writeback-preference/route";

const ACTOR = { userId: "user-1", companyId: "company-1" } as const;

interface ConnectionRow {
  id: string;
  company_id: string;
  type: "company" | "individual";
  user_id: string | null;
  status: string;
}

interface QueryRecord {
  operation: "select" | "update";
  filters: Array<[string, unknown]>;
  payload?: Record<string, unknown>;
}

function makeDatabase(initialConnection: ConnectionRow | null) {
  let connection = initialConnection ? { ...initialConnection } : null;
  const queries: QueryRecord[] = [];

  const from = vi.fn((table: string) => {
    if (table !== "email_connections") {
      throw new Error(`unexpected table: ${table}`);
    }

    const record: QueryRecord = { operation: "select", filters: [] };
    queries.push(record);

    const result = () => {
      const matches =
        connection !== null &&
        record.filters.every(([column, value]) =>
          Object.is(connection?.[column as keyof ConnectionRow], value)
        );

      if (record.operation === "update" && matches && record.payload) {
        connection = { ...connection, ...record.payload } as ConnectionRow;
      }

      return {
        data: matches
          ? record.operation === "update"
            ? { id: connection?.id }
            : { ...connection }
          : null,
        error: null,
      };
    };

    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.update = vi.fn((payload: Record<string, unknown>) => {
      record.operation = "update";
      record.payload = payload;
      return builder;
    });
    builder.eq = vi.fn((column: string, value: unknown) => {
      record.filters.push([column, value]);
      return builder;
    });
    builder.maybeSingle = vi.fn(async () => result());
    builder.then = (
      resolve: (value: ReturnType<typeof result>) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(result()).then(resolve, reject);
    return builder;
  });

  return {
    client: { from },
    queries,
    connection: () => connection,
    updateQueries: () =>
      queries.filter((query) => query.operation === "update"),
  };
}

function request(path: string, body: Record<string, unknown>) {
  return new NextRequest(`https://ops.test${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer real-actor-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const endpoints = [
  {
    name: "provider writeback",
    path: "/api/inbox/writeback-preference",
    post: setWritebackPreference,
    preference: "ops_only",
    column: "archive_writeback_preference",
  },
  {
    name: "lead archive",
    path: "/api/inbox/lead-archive-preference",
    post: setLeadArchivePreference,
    preference: "leave",
    column: "archive_lead_preference",
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  resolveEmailRouteActorMock.mockResolvedValue({ ok: true, actor: ACTOR });
  verifyAdminAuthMock.mockResolvedValue({
    uid: "firebase-subject",
    email: "login-address@example.test",
  });
  findUserByAuthMock.mockResolvedValue({
    id: ACTOR.userId,
    company_id: ACTOR.companyId,
  });
  checkPermissionByIdMock.mockImplementation(
    async (_userId: string, permission: string) =>
      permission === "inbox.archive"
  );
  runWithSupabaseMock.mockImplementation(
    async (_client: unknown, operation: () => Promise<unknown>) => operation()
  );
});

describe.each(endpoints)(
  "$name archive preference authorization",
  (endpoint) => {
    it("requires integration settings authority for a company mailbox", async () => {
      const db = makeDatabase({
        id: "connection-company",
        company_id: ACTOR.companyId,
        type: "company",
        user_id: null,
        status: "active",
      });
      getServiceRoleClientMock.mockReturnValue(db.client);
      requireSupabaseMock.mockReturnValue(db.client);

      const response = await endpoint.post(
        request(endpoint.path, {
          connectionId: "connection-company",
          preference: endpoint.preference,
        })
      );

      expect(response.status).toBe(403);
      expect(checkPermissionByIdMock).toHaveBeenCalledWith(
        ACTOR.userId,
        "settings.integrations",
        "all"
      );
      expect(db.updateQueries()).toHaveLength(0);
    });

    it("never lets company authority override another user's personal mailbox ownership", async () => {
      checkPermissionByIdMock.mockResolvedValue(true);
      const db = makeDatabase({
        id: "connection-other-personal",
        company_id: ACTOR.companyId,
        type: "individual",
        user_id: "user-2",
        status: "active",
      });
      getServiceRoleClientMock.mockReturnValue(db.client);
      requireSupabaseMock.mockReturnValue(db.client);

      const response = await endpoint.post(
        request(endpoint.path, {
          connectionId: "connection-other-personal",
          preference: endpoint.preference,
          userId: "user-2",
          companyId: ACTOR.companyId,
          email: "other-person@example.test",
        })
      );

      expect(response.status).toBe(404);
      expect(db.updateQueries()).toHaveLength(0);
    });

    it("fails closed on inbox archive permission before resolving a mailbox", async () => {
      checkPermissionByIdMock.mockResolvedValue(false);
      const db = makeDatabase({
        id: "connection-personal",
        company_id: ACTOR.companyId,
        type: "individual",
        user_id: ACTOR.userId,
        status: "active",
      });
      getServiceRoleClientMock.mockReturnValue(db.client);
      requireSupabaseMock.mockReturnValue(db.client);

      const response = await endpoint.post(
        request(endpoint.path, {
          connectionId: "connection-personal",
          preference: endpoint.preference,
        })
      );

      expect(response.status).toBe(403);
      expect(db.queries).toHaveLength(0);
      expect(checkPermissionByIdMock).not.toHaveBeenCalledWith(
        ACTOR.userId,
        "settings.integrations",
        "all"
      );
    });

    it("requires the actor's personal mailbox connection to remain active", async () => {
      const db = makeDatabase({
        id: "connection-personal",
        company_id: ACTOR.companyId,
        type: "individual",
        user_id: ACTOR.userId,
        status: "disconnected",
      });
      getServiceRoleClientMock.mockReturnValue(db.client);
      requireSupabaseMock.mockReturnValue(db.client);

      const response = await endpoint.post(
        request(endpoint.path, {
          connectionId: "connection-personal",
          preference: endpoint.preference,
        })
      );

      expect(response.status).toBe(404);
      expect(db.updateQueries()).toHaveLength(0);
    });

    it("uses the real actor and exact owned mailbox despite forged body identities", async () => {
      const db = makeDatabase({
        id: "connection-personal",
        company_id: ACTOR.companyId,
        type: "individual",
        user_id: ACTOR.userId,
        status: "active",
      });
      getServiceRoleClientMock.mockReturnValue(db.client);
      requireSupabaseMock.mockReturnValue(db.client);

      const response = await endpoint.post(
        request(endpoint.path, {
          connectionId: "connection-personal",
          preference: endpoint.preference,
          userId: "user-2",
          companyId: "company-2",
          email: "other-person@example.test",
        })
      );

      expect(response.status).toBe(200);
      expect(resolveEmailRouteActorMock).toHaveBeenCalledOnce();
      expect(findUserByAuthMock).not.toHaveBeenCalled();
      expect(checkPermissionByIdMock).not.toHaveBeenCalledWith(
        ACTOR.userId,
        "settings.integrations",
        "all"
      );
      expect(db.updateQueries()).toEqual([
        expect.objectContaining({
          payload: { [endpoint.column]: endpoint.preference },
          filters: expect.arrayContaining([
            ["id", "connection-personal"],
            ["company_id", ACTOR.companyId],
            ["type", "individual"],
            ["user_id", ACTOR.userId],
            ["status", "active"],
          ]),
        }),
      ]);
    });

    it("updates only the exact active company mailbox after both permissions pass", async () => {
      checkPermissionByIdMock.mockResolvedValue(true);
      const db = makeDatabase({
        id: "connection-company",
        company_id: ACTOR.companyId,
        type: "company",
        user_id: null,
        status: "active",
      });
      getServiceRoleClientMock.mockReturnValue(db.client);
      requireSupabaseMock.mockReturnValue(db.client);

      const response = await endpoint.post(
        request(endpoint.path, {
          connectionId: "connection-company",
          preference: endpoint.preference,
        })
      );

      expect(response.status).toBe(200);
      expect(db.updateQueries()).toEqual([
        expect.objectContaining({
          payload: { [endpoint.column]: endpoint.preference },
          filters: expect.arrayContaining([
            ["id", "connection-company"],
            ["company_id", ACTOR.companyId],
            ["type", "company"],
            ["status", "active"],
          ]),
        }),
      ]);
    });

    it("preserves authorized company-mailbox settings while the connection is inactive", async () => {
      checkPermissionByIdMock.mockResolvedValue(true);
      const db = makeDatabase({
        id: "connection-company",
        company_id: ACTOR.companyId,
        type: "company",
        user_id: null,
        status: "disconnected",
      });
      getServiceRoleClientMock.mockReturnValue(db.client);
      requireSupabaseMock.mockReturnValue(db.client);

      const response = await endpoint.post(
        request(endpoint.path, {
          connectionId: "connection-company",
          preference: endpoint.preference,
        })
      );

      expect(response.status).toBe(200);
      expect(db.updateQueries()).toEqual([
        expect.objectContaining({
          filters: expect.arrayContaining([
            ["id", "connection-company"],
            ["company_id", ACTOR.companyId],
            ["type", "company"],
            ["status", "disconnected"],
          ]),
        }),
      ]);
    });
  }
);
