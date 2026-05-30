import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/inbox/drafts/route";

const {
  checkPermissionByIdMock,
  findUserByAuthMock,
  getConnectionMock,
  getConnectionsMock,
  getProviderMock,
  getServiceRoleClientMock,
  runWithSupabaseMock,
  verifyAdminAuthMock,
} = vi.hoisted(() => ({
  checkPermissionByIdMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getConnectionsMock: vi.fn(),
  getProviderMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  runWithSupabaseMock: vi.fn(async (_supabase, fn) => fn()),
  verifyAdminAuthMock: vi.fn(),
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
  runWithSupabase: runWithSupabaseMock,
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getConnections: getConnectionsMock,
    getProvider: getProviderMock,
  },
}));

type DraftRouteState = {
  ai_draft_history: Array<Record<string, unknown>>;
  email_threads: Array<Record<string, unknown>>;
  opportunity_follow_up_drafts: Array<Record<string, unknown>>;
};

function matches(row: Record<string, unknown>, filters: Map<string, unknown>) {
  for (const [column, value] of filters.entries()) {
    if (row[column] !== value) return false;
  }
  return true;
}

function makeSupabaseDouble(state: DraftRouteState) {
  class Query {
    private filters = new Map<string, unknown>();
    private inFilters = new Map<string, Set<unknown>>();
    private limitCount: number | null = null;
    private orderColumn: string | null = null;
    private orderAscending = true;
    private updatePayload: Record<string, unknown> | null = null;

    constructor(private readonly table: keyof DraftRouteState) {}

    private rows() {
      return state[this.table];
    }

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    in(column: string, values: unknown[]) {
      this.inFilters.set(column, new Set(values));
      return this;
    }

    order(column: string, options?: { ascending?: boolean }) {
      this.orderColumn = column;
      this.orderAscending = options?.ascending !== false;
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }

    single() {
      const rows = this.resultRows();
      this.applyUpdate();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }

    maybeSingle() {
      return this.single();
    }

    private rowMatches(row: Record<string, unknown>) {
      if (!matches(row, this.filters)) return false;
      for (const [column, values] of this.inFilters.entries()) {
        if (!values.has(row[column])) return false;
      }
      return true;
    }

    private resultRows() {
      let rows = this.rows().filter((row) => this.rowMatches(row));
      if (this.orderColumn) {
        rows = [...rows].sort((a, b) => {
          const left = a[this.orderColumn!];
          const right = b[this.orderColumn!];
          if (left === right) return 0;
          const direction = this.orderAscending ? 1 : -1;
          return String(left) > String(right) ? direction : -direction;
        });
      }
      return this.limitCount === null ? rows : rows.slice(0, this.limitCount);
    }

    private applyUpdate() {
      if (!this.updatePayload) return;
      for (const row of this.rows()) {
        if (this.rowMatches(row)) Object.assign(row, this.updatePayload);
      }
    }

    private result() {
      const data = this.resultRows();
      this.applyUpdate();
      return { data, error: null };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }
  }

  return {
    from(table: string) {
      return new Query(table as keyof DraftRouteState);
    },
  };
}

const activeConnection = {
  id: "connection-1",
  companyId: "company-1",
  provider: "gmail",
  type: "company",
  userId: null,
  email: "ops@example.com",
  status: "active",
};

function makeDraftRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `draft-${index + 1}`,
    company_id: "company-1",
    opportunity_id: `opp-${index + 1}`,
    connection_id: "connection-1",
    provider_thread_id: `provider-thread-${index + 1}`,
    origin: "template_follow_up",
    status: "drafted",
    subject: index === 0 ? "" : `Subject ${index + 1}`,
    original_body: `Original body ${index + 1}`,
    current_body: `Current body ${index + 1}`,
    edited_at: null,
    updated_at: `2026-05-29T18:${String(index).padStart(2, "0")}:00.000Z`,
    created_at: `2026-05-29T17:${String(index).padStart(2, "0")}:00.000Z`,
  }));
}

describe("/api/inbox/drafts lifecycle drafts", () => {
  beforeEach(() => {
    verifyAdminAuthMock.mockResolvedValue({
      uid: "auth-1",
      email: "operator@example.com",
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
    });
    checkPermissionByIdMock.mockResolvedValue(true);
    getConnectionsMock.mockResolvedValue([activeConnection]);
    getConnectionMock.mockResolvedValue(activeConnection);
    getProviderMock.mockReturnValue({
      listDrafts: vi.fn().mockResolvedValue([]),
      createDraft: vi.fn().mockResolvedValue("provider-draft-1"),
      updateDraft: vi.fn().mockResolvedValue(undefined),
      deleteDraft: vi.fn().mockResolvedValue(undefined),
    });
    runWithSupabaseMock.mockImplementation(async (_supabase, fn) => fn());
  });

  it("surfaces all drafted template follow-ups as local editable inbox drafts", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_threads: Array.from({ length: 23 }, (_, index) => ({
        id: `thread-internal-${index + 1}`,
        company_id: "company-1",
        connection_id: "connection-1",
        provider_thread_id: `provider-thread-${index + 1}`,
      })),
      opportunity_follow_up_drafts: makeDraftRows(23),
    };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const response = await GET(
      new NextRequest("http://test.local/api/inbox/drafts?scope=own")
    );
    const body = await response.json();
    const lifecycleDrafts = body.drafts.filter(
      (draft: Record<string, unknown>) => draft.source === "lifecycle"
    );

    expect(response.status).toBe(200);
    expect(lifecycleDrafts).toHaveLength(23);
    expect(lifecycleDrafts[0]).toMatchObject({
      source: "lifecycle",
      id: "draft-23",
      connectionId: "connection-1",
      fromEmail: "ops@example.com",
      threadId: "provider-thread-23",
      inboxThreadId: "thread-internal-23",
      opportunityId: "opp-23",
    });
    expect(lifecycleDrafts.at(-1)).toMatchObject({
      id: "draft-1",
      subject: "Following up",
      bodyText: "Current body 1",
    });
  });

  it("updates a local lifecycle draft subject and body without touching a provider draft", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_threads: [],
      opportunity_follow_up_drafts: makeDraftRows(1),
    };
    const provider = {
      listDrafts: vi.fn().mockResolvedValue([]),
      createDraft: vi.fn(),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
    };
    getProviderMock.mockReturnValue(provider);
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const response = await POST(
      new NextRequest("http://test.local/api/inbox/drafts", {
        method: "POST",
        body: JSON.stringify({
          source: "lifecycle",
          draftId: "draft-1",
          subject: "Still interested?",
          body: "Revised lifecycle body",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      draftId: "draft-1",
      source: "lifecycle",
    });
    expect(state.opportunity_follow_up_drafts[0]).toMatchObject({
      subject: "Still interested?",
      current_body: "Revised lifecycle body",
      edited_by: "user-1",
    });
    expect(provider.createDraft).not.toHaveBeenCalled();
    expect(provider.updateDraft).not.toHaveBeenCalled();
  });

  it("discards local lifecycle drafts without calling the mail provider", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_threads: [],
      opportunity_follow_up_drafts: makeDraftRows(1),
    };
    const provider = {
      listDrafts: vi.fn().mockResolvedValue([]),
      createDraft: vi.fn(),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
    };
    getProviderMock.mockReturnValue(provider);
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const response = await DELETE(
      new NextRequest(
        "http://test.local/api/inbox/drafts?source=lifecycle&id=draft-1",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(200);
    expect(state.opportunity_follow_up_drafts[0]).toMatchObject({
      status: "discarded",
      edited_by: "user-1",
    });
    expect(provider.deleteDraft).not.toHaveBeenCalled();
  });
});
