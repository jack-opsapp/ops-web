import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  eqCalls: [] as Array<[string, unknown]>,
  updates: [] as Array<Record<string, unknown>>,
  resolveActor: vi.fn(),
  resolveDraftAccess: vi.fn(),
  resolveOpportunityAccess: vi.fn(),
}));

function createDatabase() {
  return {
    from: vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          state.eqCalls.push([column, value]);
          return query;
        }),
        order: vi.fn(() => query),
        limit: vi.fn(async () => ({ data: state.rows, error: null })),
        update: vi.fn((payload: Record<string, unknown>) => {
          state.updates.push(payload);
          return query;
        }),
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: {
                data: null;
                error: null;
              }) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null
        ) {
          return Promise.resolve({ data: null, error: null }).then(
            onfulfilled,
            onrejected
          );
        },
      };
      return query;
    }),
  };
}

const db = createDatabase();

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => db,
}));
vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: vi.fn(),
}));
vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: state.resolveActor,
}));
vi.mock("@/lib/email/email-draft-access", () => ({
  resolveEmailDraftAccess: state.resolveDraftAccess,
}));
vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: state.resolveOpportunityAccess,
}));

import {
  DELETE,
  GET,
  PATCH,
} from "@/app/api/integrations/email/auto-drafts/route";

const actor = { userId: "user-1", companyId: "company-1" } as const;

function allowedDraft(id: string) {
  return {
    allowed: true,
    draft: { id, status: "auto_drafted" },
    threadId: "thread-1",
    opportunityId: "opportunity-1",
    connectionId: "connection-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows.length = 0;
  state.eqCalls.length = 0;
  state.updates.length = 0;
  state.resolveActor.mockResolvedValue({ ok: true, actor });
  state.resolveDraftAccess.mockImplementation(async ({ draftHistoryId }) =>
    allowedDraft(draftHistoryId)
  );
  state.resolveOpportunityAccess.mockResolvedValue({
    allowed: true,
    connectionId: "connection-1",
    providerThreadId: "provider-thread-1",
  });
});

describe("legacy auto-draft current-access boundary", () => {
  it("filters every listed draft through live assignment authorization", async () => {
    state.rows.push(
      {
        id: "draft-current",
        original_draft: "Current",
        profile_type: "general",
        created_at: "2026-07-15T18:00:00.000Z",
      },
      {
        id: "draft-stale",
        original_draft: "Stale",
        profile_type: "general",
        created_at: "2026-07-15T17:00:00.000Z",
      }
    );
    state.resolveDraftAccess.mockImplementation(async ({ draftHistoryId }) =>
      draftHistoryId === "draft-current"
        ? allowedDraft(draftHistoryId)
        : { allowed: false, reason: "opportunity_other_assignee" }
    );

    const response = await GET(
      new NextRequest("https://ops.test/api/integrations/email/auto-drafts")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.autoDrafts).toHaveLength(1);
    expect(payload.autoDrafts[0].id).toBe("draft-current");
    expect(state.resolveDraftAccess).toHaveBeenCalledTimes(2);
    expect(state.eqCalls).toContainEqual(["company_id", "company-1"]);
    expect(state.eqCalls).toContainEqual(["user_id", "user-1"]);
  });

  it("treats a requested thread id as an internal OPS id", async () => {
    await GET(
      new NextRequest(
        "https://ops.test/api/integrations/email/auto-drafts?threadId=thread-1"
      )
    );

    expect(state.resolveOpportunityAccess).toHaveBeenCalledWith({
      actor,
      operation: "read",
      threadId: "thread-1",
      supabase: db,
    });
    expect(state.eqCalls).toContainEqual(["connection_id", "connection-1"]);
    expect(state.eqCalls).toContainEqual(["thread_id", "provider-thread-1"]);
  });

  it("does not edit a stale draft after reassignment", async () => {
    state.resolveDraftAccess.mockResolvedValue({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
    const response = await PATCH(
      new NextRequest("https://ops.test/api/integrations/email/auto-drafts", {
        method: "PATCH",
        body: JSON.stringify({ id: "draft-stale", draft: "Edited" }),
        headers: { "content-type": "application/json" },
      })
    );

    expect(response.status).toBe(404);
    expect(state.updates).toHaveLength(0);
    expect(state.resolveDraftAccess).toHaveBeenCalledWith({
      actor,
      draftHistoryId: "draft-stale",
      operation: "send",
      supabase: db,
    });
  });

  it("scopes discard writes to the canonical actor and ignores spoofed company input", async () => {
    const response = await DELETE(
      new NextRequest(
        "https://ops.test/api/integrations/email/auto-drafts?id=draft-current&companyId=spoof-company",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ status: "discarded" });
    expect(state.eqCalls).toContainEqual(["company_id", "company-1"]);
    expect(state.eqCalls).toContainEqual(["user_id", "user-1"]);
    expect(state.eqCalls).not.toContainEqual(["company_id", "spoof-company"]);
  });
});
