import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorizeConnection: vi.fn(),
  checkPermission: vi.fn(),
  client: null as unknown,
  resolveActor: vi.fn(),
  resolveConnection: vi.fn(),
  resolveInboxList: vi.fn(),
  resolveOpportunity: vi.fn(),
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => mocks.client,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: (...args: unknown[]) => mocks.resolveActor(...args),
}));

vi.mock("@/lib/email/email-connection-operation-access", () => ({
  authorizeEmailConnectionOperationForActor: (...args: unknown[]) =>
    mocks.authorizeConnection(...args),
  resolveEmailConnectionOperationAccess: (...args: unknown[]) =>
    mocks.resolveConnection(...args),
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  buildEmailThreadListAuthorizationFilter: vi.fn(() => ({ empty: false })),
  resolveEmailInboxListAccess: (...args: unknown[]) =>
    mocks.resolveInboxList(...args),
  resolveEmailOpportunityAccess: (...args: unknown[]) =>
    mocks.resolveOpportunity(...args),
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: (...args: unknown[]) => mocks.checkPermission(...args),
}));

class Query {
  private action: "select" | "update" = "select";
  private payload: Record<string, unknown> = {};

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  eq() {
    return this;
  }

  in() {
    return this;
  }

  is() {
    return this;
  }

  gte() {
    return this;
  }

  or() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  like() {
    return this;
  }

  async single() {
    if (this.table === "gmail_scan_jobs") {
      return {
        data: {
          id: "scan-1",
          company_id: "company-1",
          connection_id: "connection-1",
          status: "complete",
          result: { privateSubject: "Customer project" },
          progress: {},
          error_message: null,
          created_at: "2026-07-21T00:00:00.000Z",
          updated_at: "2026-07-21T00:00:00.000Z",
        },
        error: null,
      };
    }
    if (this.table === "gmail_import_jobs") {
      return {
        data: {
          id: "import-1",
          company_id: "company-1",
          connection_id: "connection-1",
          status: "completed",
        },
        error: null,
      };
    }
    if (this.table === "activities") {
      return {
        data: {
          id: "activity-1",
          company_id: "company-1",
          email_connection_id: "connection-1",
          email_thread_id: "provider-thread-1",
          opportunity_id: "opportunity-1",
          suggested_client_id: "client-1",
        },
        error: null,
      };
    }
    if (this.table === "email_connections") {
      return {
        data: {
          id: "connection-1",
          company_id: "company-1",
          provider: "gmail",
          sync_filters: {},
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }

  async maybeSingle() {
    if (this.table === "email_connections") {
      return {
        data: { id: "connection-1", provider: "gmail" },
        error: null,
      };
    }
    if (this.table === "email_threads") {
      return { data: { id: "thread-1" }, error: null };
    }
    return { data: null, error: null };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    if (this.action === "update") {
      mocks.updates.push({ table: this.table, payload: this.payload });
    }
    return Promise.resolve({ data: [], error: null }).then(
      onfulfilled,
      onrejected
    );
  }
}

function makeClient() {
  return {
    from: vi.fn((table: string) => new Query(table)),
  };
}

import { POST as blockDomain } from "@/app/api/integrations/gmail/block-domain/route";
import { POST as confirmMatch } from "@/app/api/integrations/gmail/confirm-match/route";
import { POST as ignoreActivity } from "@/app/api/integrations/gmail/ignore/route";
import { GET as importHistory } from "@/app/api/integrations/gmail/import-history/route";
import { GET as importStatus } from "@/app/api/integrations/gmail/import-status/route";
import { POST as rejectMatch } from "@/app/api/integrations/gmail/reject-match/route";
import { GET as reviewItems } from "@/app/api/integrations/gmail/review-items/route";
import { GET as scanStatus } from "@/app/api/integrations/gmail/scan-status/route";

describe("Gmail resource route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates.length = 0;
    mocks.client = makeClient();
    mocks.resolveActor.mockResolvedValue({
      ok: true,
      actor: { userId: "user-1", companyId: "company-1" },
    });
    mocks.checkPermission.mockResolvedValue(true);
    mocks.authorizeConnection.mockResolvedValue({
      allowed: false,
      reason: "forbidden",
      status: 403,
    });
    mocks.resolveConnection.mockResolvedValue({
      allowed: false,
      reason: "forbidden",
      status: 403,
    });
    mocks.resolveInboxList.mockResolvedValue({
      allowed: false,
      reason: "missing_inbox_permission",
    });
    mocks.resolveOpportunity.mockResolvedValue({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
  });

  it.each([
    ["scan", scanStatus, "scan-status?jobId=scan-1"],
    ["import", importStatus, "import-status?jobId=import-1"],
  ])(
    "withholds %s job results when the exact mailbox is denied",
    async (_label, route, path) => {
      const response = await route(
        new NextRequest(`https://ops.test/api/integrations/gmail/${path}`)
      );

      expect(response.status).toBe(403);
      expect(mocks.authorizeConnection).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: "connection-1" })
      );
    }
  );

  it("withholds import history when the actor has no authorized mailbox", async () => {
    const response = await importHistory(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/import-history?companyId=company-1"
      )
    );

    expect(response.status).toBe(403);
    expect(mocks.resolveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ claimedCompanyId: "company-1" })
    );
  });

  it("withholds review items when the inbox and lead intersection is denied", async () => {
    const response = await reviewItems(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/review-items?companyId=company-1"
      )
    );

    expect(response.status).toBe(403);
    expect(mocks.resolveInboxList).toHaveBeenCalled();
  });

  it("does not mutate a mailbox filter when exact connection access is denied", async () => {
    const response = await blockDomain(
      new NextRequest("https://ops.test/api/integrations/gmail/block-domain", {
        method: "POST",
        body: JSON.stringify({
          companyId: "company-1",
          connectionId: "connection-1",
          domain: "example.com",
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.updates).toEqual([]);
  });

  it.each([
    ["confirm", confirmMatch, "confirm-match"],
    ["reject", rejectMatch, "reject-match"],
    ["ignore", ignoreActivity, "ignore"],
  ])(
    "does not %s an activity outside the canonical thread and lead scope",
    async (_label, route, path) => {
      const response = await route(
        new NextRequest(`https://ops.test/api/integrations/gmail/${path}`, {
          method: "POST",
          body: JSON.stringify({ activityId: "activity-1" }),
        })
      );

      expect(response.status).toBe(404);
      expect(mocks.resolveOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "mutate",
          connectionId: "connection-1",
          providerThreadId: "provider-thread-1",
        })
      );
      expect(mocks.updates).toEqual([]);
    }
  );
});
