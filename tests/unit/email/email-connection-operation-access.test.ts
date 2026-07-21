import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { resolveEmailRouteActorMock, checkPermissionByIdMock } = vi.hoisted(
  () => ({
    resolveEmailRouteActorMock: vi.fn(),
    checkPermissionByIdMock: vi.fn(),
  })
);

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveEmailRouteActorMock,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

import {
  authorizeEmailConnectionOperationForActor,
  emailConnectionOwnerId,
  resolveEmailConnectionOperationAccess,
} from "@/lib/email/email-connection-operation-access";

interface ConnectionRow {
  id: string;
  company_id: string;
  type: "company" | "individual";
  user_id: string | null;
  status: string;
  sync_enabled: boolean;
}

function supabaseWithConnections(
  rows: ConnectionRow[],
  user: Record<string, unknown> | null = {
    id: "user-1",
    company_id: "company-1",
    is_active: true,
    deleted_at: null,
  }
) {
  return {
    from: vi.fn((table: string) => {
      let resultRows: Record<string, unknown>[] =
        table === "users"
          ? user
            ? [user]
            : []
          : rows.map((row) => ({ ...row }));
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: string) => {
          resultRows = resultRows.filter((row) => row[column] === value);
          return query;
        }),
        is: vi.fn((column: string, value: unknown) => {
          resultRows = resultRows.filter((row) => row[column] === value);
          return query;
        }),
        maybeSingle: vi.fn(async () => ({
          data: resultRows[0] ?? null,
          error: null,
        })),
        then: (
          resolve: (value: {
            data: Record<string, unknown>[];
            error: null;
          }) => unknown
        ) => Promise.resolve({ data: resultRows, error: null }).then(resolve),
      };
      return query;
    }),
  } as never;
}

const actor = { userId: "user-1", companyId: "company-1" };

describe("email connection operation access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEmailRouteActorMock.mockResolvedValue({ ok: true, actor });
    checkPermissionByIdMock.mockResolvedValue(false);
  });

  it("normalizes only individual mailbox owner snapshots", () => {
    expect(
      emailConnectionOwnerId({ type: "individual", user_id: "  user-1  " })
    ).toBe("user-1");
    expect(
      emailConnectionOwnerId({ type: "company", user_id: "legacy-connector" })
    ).toBeNull();
  });

  it("lets an OPS user operate only their current individual mailbox", async () => {
    const decision = await authorizeEmailConnectionOperationForActor({
      actor,
      connectionId: "personal-1",
      supabase: supabaseWithConnections([
        {
          id: "personal-1",
          company_id: "company-1",
          type: "individual",
          user_id: "user-1",
          status: "active",
          sync_enabled: true,
        },
      ]),
    });

    expect(decision.allowed).toBe(true);
    expect(checkPermissionByIdMock).not.toHaveBeenCalled();
  });

  it("compares a legacy text mailbox owner to the canonical OPS UUID after trimming", async () => {
    const decision = await authorizeEmailConnectionOperationForActor({
      actor,
      connectionId: "personal-1",
      supabase: supabaseWithConnections([
        {
          id: "personal-1",
          company_id: "company-1",
          type: "individual",
          user_id: "  user-1  ",
          status: "active",
          sync_enabled: true,
        },
      ]),
    });

    expect(decision.allowed).toBe(true);
    expect(checkPermissionByIdMock).not.toHaveBeenCalled();
  });

  it("does not let a company administrator operate another user's individual mailbox", async () => {
    checkPermissionByIdMock.mockResolvedValue(true);
    const decision = await authorizeEmailConnectionOperationForActor({
      actor,
      connectionId: "personal-2",
      supabase: supabaseWithConnections([
        {
          id: "personal-2",
          company_id: "company-1",
          type: "individual",
          user_id: "user-2",
          status: "active",
          sync_enabled: true,
        },
      ]),
    });

    expect(decision).toMatchObject({ allowed: false, reason: "forbidden" });
  });

  it("requires settings.integrations at explicit all scope for a company mailbox", async () => {
    checkPermissionByIdMock.mockResolvedValue(false);
    const denied = await authorizeEmailConnectionOperationForActor({
      actor,
      connectionId: "shared-1",
      supabase: supabaseWithConnections([
        {
          id: "shared-1",
          company_id: "company-1",
          type: "company",
          user_id: null,
          status: "active",
          sync_enabled: true,
        },
      ]),
    });
    expect(denied.allowed).toBe(false);
    expect(checkPermissionByIdMock).toHaveBeenLastCalledWith(
      "user-1",
      "settings.integrations",
      "all"
    );

    checkPermissionByIdMock.mockResolvedValue(true);
    const allowed = await authorizeEmailConnectionOperationForActor({
      actor,
      connectionId: "shared-1",
      supabase: supabaseWithConnections([
        {
          id: "shared-1",
          company_id: "company-1",
          type: "company",
          user_id: null,
          status: "active",
          sync_enabled: true,
        },
      ]),
    });
    expect(allowed.allowed).toBe(true);
  });

  it("fails closed when a usable connection is disabled", async () => {
    const decision = await authorizeEmailConnectionOperationForActor({
      actor,
      connectionId: "personal-1",
      requireUsable: true,
      supabase: supabaseWithConnections([
        {
          id: "personal-1",
          company_id: "company-1",
          type: "individual",
          user_id: "user-1",
          status: "active",
          sync_enabled: false,
        },
      ]),
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "connection_unavailable",
    });
  });

  it("fails closed after the OPS actor leaves the mailbox company", async () => {
    const decision = await authorizeEmailConnectionOperationForActor({
      actor,
      connectionId: "personal-1",
      supabase: supabaseWithConnections(
        [
          {
            id: "personal-1",
            company_id: "company-1",
            type: "individual",
            user_id: "user-1",
            status: "active",
            sync_enabled: true,
          },
        ],
        {
          id: "user-1",
          company_id: "company-2",
          is_active: true,
          deleted_at: null,
        }
      ),
    });

    expect(decision).toMatchObject({ allowed: false, reason: "forbidden" });
  });

  it("fails closed without an explicit active OPS user flag", async () => {
    const decision = await authorizeEmailConnectionOperationForActor({
      actor,
      connectionId: "personal-1",
      supabase: supabaseWithConnections(
        [
          {
            id: "personal-1",
            company_id: "company-1",
            type: "individual",
            user_id: "user-1",
            status: "active",
            sync_enabled: true,
          },
        ],
        {
          id: "user-1",
          company_id: "company-1",
          is_active: null,
          deleted_at: null,
        }
      ),
    });

    expect(decision).toMatchObject({ allowed: false, reason: "forbidden" });
  });

  it("derives the OPS actor from the token subject and treats body company as a claim", async () => {
    const request = new NextRequest("https://ops.test/api/email/analyze");
    const decision = await resolveEmailConnectionOperationAccess({
      request,
      claimedCompanyId: "company-1",
      connectionId: "personal-1",
      supabase: supabaseWithConnections([
        {
          id: "personal-1",
          company_id: "company-1",
          type: "individual",
          user_id: "user-1",
          status: "setup_incomplete",
          sync_enabled: true,
        },
      ]),
    });

    expect(resolveEmailRouteActorMock).toHaveBeenCalledWith(request, {
      claimedCompanyId: "company-1",
    });
    expect(decision.allowed).toBe(true);
  });
});
