import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUserByAuthMock, permissionHarness, verifyAdminAuthMock } =
  vi.hoisted(() => ({
    findUserByAuthMock: vi.fn(),
    permissionHarness: {
      admin: false,
      fail: false,
      scopes: {} as Record<string, "all" | "assigned" | "own" | null>,
      rpc: vi.fn(),
    },
    verifyAdminAuthMock: vi.fn(),
  }));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAdminAuthMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    rpc: permissionHarness.rpc,
  }),
}));

import {
  buildEmailThreadListAuthorizationFilter,
  resolveEmailInboxListAccess,
  resolveEmailOpportunityAccess,
  type EmailOpportunityAccessInput,
} from "@/lib/email/email-opportunity-access";
import { resolveEmailDraftAccess } from "@/lib/email/email-draft-access";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { resolvePermissionScopeById } from "@/lib/supabase/check-permission";

type Row = Record<string, unknown>;
type TableName =
  | "ai_draft_history"
  | "email_connections"
  | "email_threads"
  | "opportunities"
  | "opportunity_email_threads";

const ACTOR = { userId: "user-1", companyId: "company-1" } as const;

const BASE_ROWS: Record<TableName, Row[]> = {
  ai_draft_history: [
    {
      id: "draft-assigned",
      company_id: "company-1",
      user_id: "user-1",
      opportunity_id: "opportunity-assigned",
      connection_id: "connection-company",
      thread_id: "provider-assigned-shared",
      status: "auto_drafted",
      origin: "phase_c",
    },
    {
      id: "draft-reassigned",
      company_id: "company-1",
      user_id: "user-1",
      opportunity_id: "opportunity-other",
      connection_id: "connection-company",
      thread_id: "provider-other-shared",
      status: "auto_drafted",
      origin: "phase_c",
    },
    {
      id: "draft-other-owner",
      company_id: "company-1",
      user_id: "user-2",
      opportunity_id: "opportunity-assigned",
      connection_id: "connection-company",
      thread_id: "provider-assigned-shared",
      status: "auto_drafted",
      origin: "phase_c",
    },
  ],
  email_connections: [
    {
      id: "connection-company",
      company_id: "company-1",
      type: "company",
      user_id: null,
      status: "active",
    },
    {
      id: "connection-own",
      company_id: "company-1",
      type: "individual",
      user_id: "user-1",
      status: "active",
    },
    {
      id: "connection-other",
      company_id: "company-1",
      type: "individual",
      user_id: "user-2",
      status: "active",
    },
  ],
  email_threads: [
    {
      id: "thread-assigned-shared",
      company_id: "company-1",
      connection_id: "connection-company",
      provider_thread_id: "provider-assigned-shared",
      opportunity_id: "opportunity-assigned",
    },
    {
      id: "thread-other-shared",
      company_id: "company-1",
      connection_id: "connection-company",
      provider_thread_id: "provider-other-shared",
      opportunity_id: "opportunity-other",
    },
    {
      id: "thread-unassigned-shared",
      company_id: "company-1",
      connection_id: "connection-company",
      provider_thread_id: "provider-unassigned-shared",
      opportunity_id: "opportunity-unassigned",
    },
    {
      id: "thread-unlinked-shared",
      company_id: "company-1",
      connection_id: "connection-company",
      provider_thread_id: "provider-unlinked-shared",
      opportunity_id: null,
    },
    {
      id: "thread-unlinked-own",
      company_id: "company-1",
      connection_id: "connection-own",
      provider_thread_id: "provider-unlinked-own",
      opportunity_id: null,
    },
    {
      id: "thread-other-own",
      company_id: "company-1",
      connection_id: "connection-own",
      provider_thread_id: "provider-other-own",
      opportunity_id: "opportunity-other",
    },
    {
      id: "thread-assigned-other-personal",
      company_id: "company-1",
      connection_id: "connection-other",
      provider_thread_id: "provider-assigned-other-personal",
      opportunity_id: "opportunity-assigned",
    },
    {
      id: "thread-split-brain",
      company_id: "company-1",
      connection_id: "connection-company",
      provider_thread_id: "provider-split-brain",
      opportunity_id: "opportunity-assigned",
    },
  ],
  opportunities: [
    {
      id: "opportunity-assigned",
      company_id: "company-1",
      assigned_to: "user-1",
      deleted_at: null,
    },
    {
      id: "opportunity-other",
      company_id: "company-1",
      assigned_to: "user-2",
      deleted_at: null,
    },
    {
      id: "opportunity-unassigned",
      company_id: "company-1",
      assigned_to: null,
      deleted_at: null,
    },
  ],
  opportunity_email_threads: [
    {
      id: "link-assigned-shared",
      connection_id: "connection-company",
      thread_id: "provider-assigned-shared",
      opportunity_id: "opportunity-assigned",
    },
    {
      id: "link-other-shared",
      connection_id: "connection-company",
      thread_id: "provider-other-shared",
      opportunity_id: "opportunity-other",
    },
    {
      id: "link-unassigned-shared",
      connection_id: "connection-company",
      thread_id: "provider-unassigned-shared",
      opportunity_id: "opportunity-unassigned",
    },
    {
      id: "link-other-own",
      connection_id: "connection-own",
      thread_id: "provider-other-own",
      opportunity_id: "opportunity-other",
    },
    {
      id: "link-assigned-other-personal",
      connection_id: "connection-other",
      thread_id: "provider-assigned-other-personal",
      opportunity_id: "opportunity-assigned",
    },
    {
      id: "link-split-brain",
      connection_id: "connection-company",
      thread_id: "provider-split-brain",
      opportunity_id: "opportunity-other",
    },
  ],
};

function cloneRows(): Record<TableName, Row[]> {
  return Object.fromEntries(
    Object.entries(BASE_ROWS).map(([table, rows]) => [
      table,
      rows.map((row) => ({ ...row })),
    ])
  ) as Record<TableName, Row[]>;
}

async function permissionRpcImplementation(
  name: string,
  args: {
    p_action?: "view" | "edit" | "send";
    p_actor_user_id?: string;
    p_connection_id?: string;
    p_opportunity_id?: string | null;
    p_permission?: string;
    p_required_scope?: "all" | "assigned" | "own";
  }
) {
  if (permissionHarness.fail) {
    return {
      data: null,
      error: { code: "TEST", message: "permission lookup failed" },
    };
  }
  if (permissionHarness.admin) return { data: true, error: null };

  if (name === "authorize_email_inbox_action_as_system") {
    const connection = BASE_ROWS.email_connections.find(
      (row) => row.id === args.p_connection_id
    );
    const opportunity = args.p_opportunity_id
      ? BASE_ROWS.opportunities.find((row) => row.id === args.p_opportunity_id)
      : null;
    const inboxPermission =
      args.p_action === "send" ? "inbox.send" : "inbox.view";
    const inboxScope = permissionHarness.scopes[inboxPermission] ?? null;
    const ownsPersonal =
      connection?.type === "individual" &&
      connection.user_id === args.p_actor_user_id;
    const inboxAllowed =
      inboxScope === "all" ||
      (inboxScope === "assigned" &&
        (ownsPersonal || opportunity?.assigned_to === args.p_actor_user_id)) ||
      (inboxScope === "own" && ownsPersonal && args.p_action === "view");
    const transportAllowed = connection?.type === "company" || ownsPersonal;
    const pipelinePermission =
      args.p_action === "send" ? "pipeline.edit" : "pipeline.view";
    const pipelineScope = permissionHarness.scopes[pipelinePermission] ?? null;
    const pipelineAllowed =
      !opportunity ||
      pipelineScope === "all" ||
      (pipelineScope === "assigned" &&
        opportunity.assigned_to === args.p_actor_user_id);
    return {
      data:
        inboxAllowed &&
        pipelineAllowed &&
        (args.p_action !== "send" || transportAllowed),
      error: null,
    };
  }

  if (name === "authorize_opportunity_action_as_system") {
    const permission =
      args.p_action === "view" ? "pipeline.view" : "pipeline.edit";
    const granted = permissionHarness.scopes[permission] ?? null;
    const opportunity = BASE_ROWS.opportunities.find(
      (row) => row.id === args.p_opportunity_id
    );
    return {
      data:
        granted === "all" ||
        (granted === "assigned" &&
          opportunity?.assigned_to === args.p_actor_user_id),
      error: null,
    };
  }

  const granted = permissionHarness.scopes[args.p_permission ?? ""] ?? null;
  const required = args.p_required_scope ?? "all";
  const rank = { all: 3, assigned: 2, own: 1 } as const;
  return {
    data: granted !== null && rank[granted] >= rank[required],
    error: null,
  };
}

function createDatabase(rows = cloneRows()): SupabaseClient {
  return {
    rpc: permissionHarness.rpc,
    from(table: TableName) {
      const filters: Array<(row: Row) => boolean> = [];
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return query;
        },
        is(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return query;
        },
        async maybeSingle() {
          const matches = (rows[table] ?? []).filter((row) =>
            filters.every((filter) => filter(row))
          );
          if (matches.length > 1) {
            return {
              data: null,
              error: { message: "multiple rows" },
            };
          }
          return { data: matches[0] ?? null, error: null };
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: {
                data: Row[];
                error: null;
              }) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null
        ) {
          const matches = (rows[table] ?? []).filter((row) =>
            filters.every((filter) => filter(row))
          );
          return Promise.resolve({ data: matches, error: null }).then(
            onfulfilled,
            onrejected
          );
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

function setScopes(scopes: Record<string, "all" | "assigned" | "own" | null>) {
  permissionHarness.scopes = scopes;
}

function access(
  input: Omit<EmailOpportunityAccessInput, "actor" | "supabase">
) {
  return resolveEmailOpportunityAccess({
    ...input,
    actor: ACTOR,
    supabase: createDatabase(),
  });
}

describe("email route actor identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the actor from the verified token subject without an email fallback", async () => {
    verifyAdminAuthMock.mockResolvedValue({
      uid: "firebase-subject",
      email: "login@example.com",
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
      is_active: true,
    });

    const result = await resolveEmailRouteActor(
      new NextRequest("https://ops.test/api/inbox/threads"),
      { claimedUserId: "user-1", claimedCompanyId: "company-1" }
    );

    expect(result).toEqual({
      ok: true,
      actor: ACTOR,
    });
    expect(findUserByAuthMock).toHaveBeenCalledWith(
      "firebase-subject",
      undefined,
      "id, company_id, is_active"
    );
  });

  it.each([[{ claimedUserId: "user-2" }], [{ claimedCompanyId: "company-2" }]])(
    "rejects a conflicting compatibility claim",
    async (claims) => {
      verifyAdminAuthMock.mockResolvedValue({
        uid: "firebase-subject",
        email: "login@example.com",
      });
      findUserByAuthMock.mockResolvedValue({
        id: "user-1",
        company_id: "company-1",
        is_active: true,
      });

      const result = await resolveEmailRouteActor(
        new NextRequest("https://ops.test/api/inbox/threads"),
        claims
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
  );

  it.each([false, null])(
    "rejects a resolved actor whose active state is %s",
    async (isActive) => {
      verifyAdminAuthMock.mockResolvedValue({
        uid: "firebase-subject",
        email: "login@example.com",
      });
      findUserByAuthMock.mockResolvedValue({
        id: "user-1",
        company_id: "company-1",
        is_active: isActive,
      });

      const result = await resolveEmailRouteActor(
        new NextRequest("https://ops.test/api/inbox/threads")
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
  );
});

describe("effective permission scope resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionHarness.admin = false;
    permissionHarness.fail = false;
    permissionHarness.scopes = {};
    permissionHarness.rpc.mockImplementation(permissionRpcImplementation);
  });

  it.each(["all", "assigned", "own"] as const)(
    "returns the exact widest %s scope",
    async (scope) => {
      setScopes({ "pipeline.view": scope });
      await expect(
        resolvePermissionScopeById("user-1", "pipeline.view")
      ).resolves.toBe(scope);
    }
  );

  it("returns all for the canonical permission engine's admin bypass", async () => {
    permissionHarness.admin = true;

    await expect(
      resolvePermissionScopeById("user-1", "pipeline.view")
    ).resolves.toBe("all");
    expect(permissionHarness.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the canonical permission RPC fails", async () => {
    permissionHarness.fail = true;

    await expect(
      resolvePermissionScopeById("user-1", "pipeline.view")
    ).resolves.toBeNull();
  });
});

describe("email opportunity access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionHarness.admin = false;
    permissionHarness.fail = false;
    permissionHarness.scopes = {};
    permissionHarness.rpc.mockImplementation(permissionRpcImplementation);
  });

  it("allows an assigned linked shared thread only through pipeline.view intersect inbox.view", async () => {
    setScopes({ "pipeline.view": "assigned", "inbox.view": "assigned" });

    await expect(
      access({ operation: "read", threadId: "thread-assigned-shared" })
    ).resolves.toMatchObject({
      allowed: true,
      opportunityId: "opportunity-assigned",
      connectionId: "connection-company",
      providerThreadId: "provider-assigned-shared",
    });
    expect(permissionHarness.rpc).toHaveBeenCalledWith(
      "authorize_opportunity_action_as_system",
      {
        p_actor_user_id: "user-1",
        p_opportunity_id: "opportunity-assigned",
        p_action: "view",
      }
    );
    expect(permissionHarness.rpc).toHaveBeenCalledWith(
      "authorize_email_inbox_action_as_system",
      {
        p_actor_user_id: "user-1",
        p_connection_id: "connection-company",
        p_opportunity_id: "opportunity-assigned",
        p_action: "view",
      }
    );
  });

  it("never returns a legacy company connector user_id as a mailbox owner", async () => {
    setScopes({ "pipeline.view": "assigned", "inbox.view": "assigned" });
    const rows = cloneRows();
    const companyConnection = rows.email_connections.find(
      (row) => row.id === "connection-company"
    );
    if (!companyConnection)
      throw new Error("company connection fixture missing");
    companyConnection.user_id = "legacy-company-connector";

    await expect(
      resolveEmailOpportunityAccess({
        operation: "read",
        threadId: "thread-assigned-shared",
        actor: ACTOR,
        supabase: createDatabase(rows),
      })
    ).resolves.toMatchObject({
      allowed: true,
      connectionType: "company",
      connectionOwnerId: null,
    });
  });

  it.each([
    [
      "pipeline access missing",
      { "inbox.view": "all" },
      "missing_pipeline_permission",
    ],
    [
      "inbox access missing",
      { "pipeline.view": "all" },
      "missing_inbox_permission",
    ],
  ])("denies a linked read when %s", async (_label, scopes, reason) => {
    setScopes(scopes as Record<string, "all" | null>);

    await expect(
      access({ operation: "read", threadId: "thread-assigned-shared" })
    ).resolves.toMatchObject({ allowed: false, reason });
  });

  it.each([
    ["thread-other-shared", "opportunity_other_assignee"],
    ["thread-unassigned-shared", "opportunity_unassigned"],
    ["thread-unlinked-shared", "unlinked_shared_thread"],
  ])("denies assigned scope for %s", async (threadId, reason) => {
    setScopes({ "pipeline.view": "assigned", "inbox.view": "assigned" });

    await expect(
      access({ operation: "read", threadId })
    ).resolves.toMatchObject({ allowed: false, reason });
  });

  it("treats inbox.view:assigned as a union that includes unlinked own-personal threads", async () => {
    setScopes({ "inbox.view": "assigned" });

    await expect(
      access({ operation: "read", threadId: "thread-unlinked-own" })
    ).resolves.toMatchObject({
      allowed: true,
      opportunityId: null,
      connectionId: "connection-own",
    });
    expect(permissionHarness.rpc).not.toHaveBeenCalledWith(
      "has_permission",
      expect.objectContaining({ p_permission: "pipeline.view" })
    );
  });

  it("preserves inbox.view:own for only the actor's unlinked personal mailbox", async () => {
    setScopes({ "inbox.view": "own" });

    await expect(
      access({ operation: "read", threadId: "thread-unlinked-own" })
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      access({ operation: "read", threadId: "thread-unlinked-shared" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "unlinked_shared_thread",
    });
  });

  it("requires pipeline access even when a linked lead is in the actor's own mailbox", async () => {
    setScopes({ "pipeline.view": "assigned", "inbox.view": "assigned" });

    await expect(
      access({ operation: "read", threadId: "thread-other-own" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
  });

  it("allows an all-scope pipeline viewer to read a linked lead in their own mailbox under inbox assigned scope", async () => {
    setScopes({ "pipeline.view": "all", "inbox.view": "assigned" });

    await expect(
      access({ operation: "read", threadId: "thread-other-own" })
    ).resolves.toMatchObject({ allowed: true });
  });

  it("includes another mailbox's linked history when the lead is assigned, without granting send transport", async () => {
    setScopes({
      "pipeline.view": "assigned",
      "pipeline.edit": "assigned",
      "inbox.view": "assigned",
      "inbox.send": "assigned",
    });

    await expect(
      access({
        operation: "read",
        threadId: "thread-assigned-other-personal",
      })
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      access({
        operation: "send",
        threadId: "thread-assigned-other-personal",
      })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "mailbox_transport_denied",
    });
  });

  it("allows an assigned actor to send through the existing company mailbox", async () => {
    setScopes({ "pipeline.edit": "assigned", "inbox.send": "assigned" });

    await expect(
      access({ operation: "send", threadId: "thread-assigned-shared" })
    ).resolves.toMatchObject({ allowed: true });
    expect(permissionHarness.rpc).toHaveBeenCalledWith(
      "authorize_opportunity_action_as_system",
      {
        p_actor_user_id: "user-1",
        p_opportunity_id: "opportunity-assigned",
        p_action: "edit",
      }
    );
  });

  it("authorizes an assigned archive mutation through pipeline.edit and inbox.view without requiring inbox.send", async () => {
    setScopes({
      "pipeline.view": "assigned",
      "pipeline.edit": "assigned",
      "inbox.view": "assigned",
    });

    await expect(
      access({ operation: "mutate", threadId: "thread-assigned-shared" })
    ).resolves.toMatchObject({
      allowed: true,
      operation: "mutate",
      opportunityId: "opportunity-assigned",
      connectionId: "connection-company",
    });
    expect(permissionHarness.rpc).not.toHaveBeenCalledWith(
      "has_permission",
      expect.objectContaining({ p_permission: "inbox.send" })
    );
  });

  it("denies a linked archive mutation without current pipeline.edit authority", async () => {
    setScopes({
      "pipeline.view": "assigned",
      "inbox.view": "assigned",
    });

    await expect(
      access({ operation: "mutate", threadId: "thread-assigned-shared" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "missing_pipeline_permission",
    });
  });

  it("does not permit a provider mutation through another user's personal mailbox", async () => {
    setScopes({
      "pipeline.view": "assigned",
      "pipeline.edit": "assigned",
      "inbox.view": "assigned",
    });

    await expect(
      access({
        operation: "mutate",
        threadId: "thread-assigned-other-personal",
      })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "mailbox_transport_denied",
    });
  });

  it("authorizes a lead-learning edit through pipeline.edit and inbox.view without mailbox transport", async () => {
    setScopes({
      "pipeline.view": "assigned",
      "pipeline.edit": "assigned",
      "inbox.view": "assigned",
    });

    await expect(
      access({
        operation: "edit",
        threadId: "thread-assigned-other-personal",
      })
    ).resolves.toMatchObject({
      allowed: true,
      operation: "edit",
      opportunityId: "opportunity-assigned",
    });
  });

  it("revokes lead-learning edits immediately after reassignment", async () => {
    setScopes({
      "pipeline.edit": "assigned",
      "inbox.view": "assigned",
    });

    await expect(
      access({ operation: "edit", threadId: "thread-other-shared" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
  });

  it("requires a canonical lead relationship for a learning edit", async () => {
    setScopes({
      "pipeline.edit": "assigned",
      "inbox.view": "assigned",
    });

    await expect(
      access({ operation: "edit", threadId: "thread-unlinked-own" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "opportunity_required",
    });
  });

  it.each([
    [
      "pipeline edit missing",
      { "inbox.send": "all" },
      "missing_pipeline_permission",
    ],
    [
      "inbox send missing",
      { "pipeline.edit": "all" },
      "missing_inbox_permission",
    ],
  ])("denies a linked send when %s", async (_label, scopes, reason) => {
    setScopes(scopes as Record<string, "all" | null>);

    await expect(
      access({ operation: "send", threadId: "thread-assigned-shared" })
    ).resolves.toMatchObject({ allowed: false, reason });
  });

  it("does not treat company-mailbox access as lead authorization", async () => {
    setScopes({ "inbox.view": "all" });

    await expect(
      access({ operation: "read", threadId: "thread-assigned-shared" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "missing_pipeline_permission",
    });
  });

  it("never widens an absent granular pipeline permission through legacy pipeline.manage:all", async () => {
    setScopes({
      "pipeline.manage": "all",
      "inbox.view_company": "all",
    });

    await expect(
      access({ operation: "read", threadId: "thread-other-shared" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "missing_pipeline_permission",
    });

    expect(permissionHarness.rpc).not.toHaveBeenCalledWith(
      "has_permission",
      expect.objectContaining({ p_permission: "pipeline.manage" })
    );

    await expect(
      access({ operation: "read", threadId: "thread-unlinked-shared" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "missing_inbox_permission",
    });
  });

  it("never widens an absent granular inbox permission through legacy inbox.view_company:all", async () => {
    setScopes({
      "pipeline.view": "all",
      "inbox.view_company": "all",
    });

    await expect(
      access({ operation: "read", threadId: "thread-assigned-shared" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "missing_inbox_permission",
    });

    expect(permissionHarness.rpc).not.toHaveBeenCalledWith(
      "has_permission",
      expect.objectContaining({ p_permission: "inbox.view_company" })
    );
  });

  it("never widens an explicit granular assigned scope through pipeline.manage:all", async () => {
    setScopes({
      "pipeline.view": "assigned",
      "pipeline.edit": "assigned",
      "pipeline.manage": "all",
      "inbox.view": "all",
    });

    await expect(
      access({ operation: "read", threadId: "thread-other-shared" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
    await expect(
      access({ operation: "mutate", threadId: "thread-other-shared" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
  });

  it("does not accept assigned or own scope through an all-only legacy fallback", async () => {
    setScopes({
      "pipeline.manage": "assigned",
      "inbox.view_company": "own",
    });

    await expect(
      access({ operation: "read", threadId: "thread-assigned-shared" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "missing_pipeline_permission",
    });
  });

  it.each([
    [{ connectionId: "connection-own" }, "connection_identity_mismatch"],
    [{ providerThreadId: "forged-provider" }, "thread_identity_mismatch"],
    [{ opportunityId: "opportunity-other" }, "opportunity_identity_mismatch"],
  ])("rejects a forged canonical identifier", async (claim, reason) => {
    setScopes({ "pipeline.view": "all", "inbox.view": "all" });

    await expect(
      access({
        operation: "read",
        threadId: "thread-assigned-shared",
        ...claim,
      })
    ).resolves.toMatchObject({ allowed: false, reason });
  });

  it("fails closed when the cache row and relationship row disagree", async () => {
    setScopes({ "pipeline.view": "all", "inbox.view": "all" });

    await expect(
      access({ operation: "read", threadId: "thread-split-brain" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "canonical_relationship_conflict",
    });
  });

  it("rejects a provider-thread claim without a canonical internal thread", async () => {
    setScopes({ "pipeline.edit": "all", "inbox.send": "all" });

    await expect(
      access({
        operation: "send",
        connectionId: "connection-company",
        providerThreadId: "forged-provider",
        opportunityId: "opportunity-assigned",
      })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "internal_thread_required",
    });
  });

  it("allows a canonical new lead conversation only with no provider-thread identity", async () => {
    setScopes({ "pipeline.edit": "assigned", "inbox.send": "assigned" });

    await expect(
      access({
        operation: "send",
        connectionId: "connection-company",
        opportunityId: "opportunity-assigned",
      })
    ).resolves.toMatchObject({
      allowed: true,
      threadId: null,
      providerThreadId: null,
    });
  });
});

describe("email draft access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionHarness.admin = false;
    permissionHarness.fail = false;
    permissionHarness.scopes = {};
    permissionHarness.rpc.mockImplementation(permissionRpcImplementation);
  });

  it("re-resolves the current thread and assignment before returning a draft", async () => {
    setScopes({ "pipeline.view": "assigned", "inbox.view": "assigned" });

    await expect(
      resolveEmailDraftAccess({
        actor: ACTOR,
        draftHistoryId: "draft-assigned",
        operation: "read",
        supabase: createDatabase(),
      })
    ).resolves.toMatchObject({
      allowed: true,
      draft: { id: "draft-assigned" },
      threadId: "thread-assigned-shared",
    });
  });

  it("revokes stale draft access immediately after the lead is reassigned", async () => {
    setScopes({ "pipeline.view": "assigned", "inbox.view": "assigned" });

    await expect(
      resolveEmailDraftAccess({
        actor: ACTOR,
        draftHistoryId: "draft-reassigned",
        operation: "read",
        supabase: createDatabase(),
      })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
  });

  it("never lets one actor mutate another user's draft or learning profile", async () => {
    setScopes({ "pipeline.edit": "assigned", "inbox.send": "assigned" });

    await expect(
      resolveEmailDraftAccess({
        actor: ACTOR,
        draftHistoryId: "draft-other-owner",
        operation: "send",
        supabase: createDatabase(),
      })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "draft_owner_mismatch",
    });
  });
});

describe("assigned inbox list authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionHarness.admin = false;
    permissionHarness.fail = false;
    permissionHarness.scopes = {};
    permissionHarness.rpc.mockImplementation(permissionRpcImplementation);
  });

  it("resolves only the actor's personal connections and currently assigned leads", async () => {
    setScopes({ "pipeline.view": "assigned", "inbox.view": "assigned" });

    await expect(
      resolveEmailInboxListAccess({
        actor: ACTOR,
        supabase: createDatabase(),
      })
    ).resolves.toMatchObject({
      allowed: true,
      inboxScope: "assigned",
      pipelineScope: "assigned",
      ownPersonalConnectionIds: ["connection-own"],
      assignedOpportunityIds: ["opportunity-assigned"],
    });
  });

  it("fails closed without inbox permission while retaining unlinked personal access without pipeline permission", async () => {
    setScopes({});
    await expect(
      resolveEmailInboxListAccess({
        actor: ACTOR,
        supabase: createDatabase(),
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "missing_inbox_permission",
    });

    setScopes({ "inbox.view": "assigned" });
    await expect(
      resolveEmailInboxListAccess({
        actor: ACTOR,
        supabase: createDatabase(),
      })
    ).resolves.toMatchObject({
      allowed: true,
      pipelineScope: null,
      ownPersonalConnectionIds: ["connection-own"],
    });
  });

  it.each([
    [
      "assigned inbox and assigned pipeline",
      {
        inboxScope: "assigned" as const,
        pipelineScope: "assigned" as const,
        ownPersonalConnectionIds: ["connection-own"],
        assignedOpportunityIds: ["opportunity-assigned"],
      },
      {
        empty: false,
        or: "opportunity_id.in.(opportunity-assigned),and(connection_id.in.(connection-own),opportunity_id.is.null)",
      },
    ],
    [
      "assigned inbox without pipeline",
      {
        inboxScope: "assigned" as const,
        pipelineScope: null,
        ownPersonalConnectionIds: ["connection-own"],
        assignedOpportunityIds: [],
      },
      {
        empty: false,
        connectionIds: ["connection-own"],
        unlinkedOnly: true,
      },
    ],
    [
      "company inbox with assigned pipeline",
      {
        inboxScope: "all" as const,
        pipelineScope: "assigned" as const,
        ownPersonalConnectionIds: ["connection-own"],
        assignedOpportunityIds: ["opportunity-assigned"],
      },
      {
        empty: false,
        or: "opportunity_id.is.null,opportunity_id.in.(opportunity-assigned)",
      },
    ],
  ])("builds a server-side filter for %s", (_label, access, expected) => {
    expect(buildEmailThreadListAuthorizationFilter(access)).toEqual(expected);
  });
});
