import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  aiGenerate: vi.fn(),
  buildEmailThreadListAuthorizationFilter: vi.fn(),
  getConnections: vi.fn(),
  getProvider: vi.fn(),
  resolveEmailInboxListAccess: vi.fn(),
  resolveEmailOpportunityAccess: vi.fn(),
  resolveEmailRouteActor: vi.fn(),
  rows: {
    ai_draft_history: [] as Array<Record<string, unknown>>,
    email_connections: [] as Array<Record<string, unknown>>,
    email_threads: [] as Array<Record<string, unknown>>,
    opportunities: [] as Array<Record<string, unknown>>,
    opportunity_follow_up_drafts: [] as Array<Record<string, unknown>>,
  },
  queryOperations: [] as Array<{
    table: string;
    operation: string;
    value: string;
  }>,
  writes: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: state.resolveEmailRouteActor,
  requireEmailCompanyAccess: vi.fn(async () => null),
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  buildEmailThreadListAuthorizationFilter:
    state.buildEmailThreadListAuthorizationFilter,
  resolveEmailInboxListAccess: state.resolveEmailInboxListAccess,
  resolveEmailOpportunityAccess: state.resolveEmailOpportunityAccess,
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: vi.fn(async () => ({
    uid: "firebase-subject",
    email: "login@example.com",
  })),
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: vi.fn(async () => ({
    id: "user-1",
    company_id: "company-1",
  })),
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: vi.fn(async () => true),
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: state.aiGenerate },
}));

vi.mock("@/lib/api/services/writing-profile-service", () => ({
  WritingProfileService: {
    getProfile: vi.fn(async () => null),
    getConfidence: vi.fn(() => 0),
  },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnections: state.getConnections,
    getConnection: vi.fn(async (id: string) =>
      (await state.getConnections()).find(
        (connection: { id: string }) => connection.id === id
      )
    ),
    getProvider: state.getProvider,
  },
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  loadKnownEmailSignaturesForMessage: vi.fn(async () => []),
  normalizeMailboxDraftAuthoredBody: (value: string) => value,
  renderMailboxDraftWithSignature: (value: string) => ({
    body: value,
    contentType: "text/plain",
  }),
  resolveEmailSignatureForMessage: vi.fn(async () => ({
    text: "OPS",
    html: "<p>OPS</p>",
  })),
}));

function makeQuery(table: keyof typeof state.rows) {
  const filters = new Map<string, unknown>();
  const inFilters = new Map<string, Set<unknown>>();
  let updatePayload: Record<string, unknown> | null = null;
  let limitCount: number | null = null;
  const builder: Record<string, unknown> = {};
  const resultRows = () => {
    let rows = state.rows[table].filter((row) => {
      for (const [key, value] of filters) if (row[key] !== value) return false;
      for (const [key, values] of inFilters)
        if (!values.has(row[key])) return false;
      return true;
    });
    if (limitCount !== null) rows = rows.slice(0, limitCount);
    return rows;
  };
  const applyUpdate = () => {
    if (!updatePayload) return;
    state.writes.push({ table, payload: updatePayload });
    for (const row of resultRows()) Object.assign(row, updatePayload);
  };
  Object.assign(builder, {
    select: () => builder,
    eq: (key: string, value: unknown) => {
      filters.set(key, value);
      return builder;
    },
    is: (key: string, value: unknown) => {
      filters.set(key, value);
      return builder;
    },
    in: (key: string, values: unknown[]) => {
      inFilters.set(key, new Set(values));
      return builder;
    },
    or: (expression: string) => {
      state.queryOperations.push({ table, operation: "or", value: expression });
      return builder;
    },
    order: () => builder,
    limit: (count: number) => {
      limitCount = count;
      return builder;
    },
    update: (payload: Record<string, unknown>) => {
      updatePayload = payload;
      return builder;
    },
    single: async () => {
      const data = resultRows()[0] ?? null;
      applyUpdate();
      return { data, error: null };
    },
    maybeSingle: async () => ({ data: resultRows()[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
      const data = resultRows();
      applyUpdate();
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  });
  return builder;
}

const supabase = {
  from: (table: keyof typeof state.rows) => makeQuery(table),
};

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => supabase,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: async (_client: unknown, task: () => Promise<unknown>) =>
    task(),
  setSupabaseOverride: vi.fn(),
}));

const actor = { userId: "user-1", companyId: "company-1" } as const;
const connection = {
  id: "connection-company",
  companyId: "company-1",
  provider: "gmail",
  type: "company",
  userId: null,
  email: "office@example.com",
  status: "active",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  for (const table of Object.keys(state.rows) as Array<
    keyof typeof state.rows
  >) {
    state.rows[table] = [];
  }
  state.writes = [];
  state.queryOperations = [];
  state.resolveEmailRouteActor.mockResolvedValue({ ok: true, actor });
  state.buildEmailThreadListAuthorizationFilter.mockReturnValue({
    empty: false,
    or: "opportunity_id.in.(opportunity-assigned)",
  });
  state.resolveEmailInboxListAccess.mockResolvedValue({
    allowed: true,
    actor,
    inboxScope: "assigned",
    pipelineScope: "assigned",
    ownPersonalConnectionIds: [],
    assignedOpportunityIds: ["opportunity-assigned"],
    usedLegacyPipelineManage: false,
    usedLegacyInboxViewCompany: false,
  });
  state.resolveEmailOpportunityAccess.mockResolvedValue({
    allowed: false,
    reason: "opportunity_other_assignee",
  });
  state.getConnections.mockResolvedValue([connection]);
  state.getProvider.mockReturnValue({
    listDrafts: vi.fn(async () => []),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    deleteDraft: vi.fn(),
  });
});

describe("assigned draft authorization", () => {
  it("denies direct AI drafting before generation", async () => {
    const { POST } =
      await import("@/app/api/integrations/email/ai-draft/route");

    const response = await POST(
      new NextRequest("https://ops.test/api/integrations/email/ai-draft", {
        method: "POST",
        body: JSON.stringify({
          companyId: "company-1",
          userId: "user-1",
          connectionId: "connection-company",
          opportunityId: "opportunity-other",
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(state.resolveEmailOpportunityAccess).toHaveBeenCalledWith({
      actor,
      operation: "send",
      connectionId: "connection-company",
      opportunityId: "opportunity-other",
      supabase,
    });
    expect(state.aiGenerate).not.toHaveBeenCalled();
  });

  it("denies pipeline mailbox draft generation before the model or provider", async () => {
    const { POST } = await import("@/app/api/integrations/email/draft/route");

    const response = await POST(
      new NextRequest("https://ops.test/api/integrations/email/draft", {
        method: "POST",
        body: JSON.stringify({
          companyId: "company-1",
          userId: "user-1",
          opportunityId: "opportunity-other",
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(state.resolveEmailOpportunityAccess).toHaveBeenCalledWith({
      actor,
      operation: "send",
      connectionId: "connection-company",
      opportunityId: "opportunity-other",
      supabase,
    });
    expect(state.aiGenerate).not.toHaveBeenCalled();
    expect(state.getProvider).not.toHaveBeenCalled();
  });

  it("denies editing a lifecycle draft linked to another user's lead", async () => {
    state.rows.opportunity_follow_up_drafts = [
      {
        id: "draft-other",
        company_id: "company-1",
        opportunity_id: "opportunity-other",
        connection_id: "connection-company",
        provider_thread_id: "provider-other",
        origin: "phase_c",
        status: "drafted",
      },
    ];
    const { POST } = await import("@/app/api/inbox/drafts/route");

    const response = await POST(
      new NextRequest("https://ops.test/api/inbox/drafts", {
        method: "POST",
        body: JSON.stringify({
          source: "lifecycle",
          draftId: "draft-other",
          subject: "Re: Inquiry",
          body: "Draft body",
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(state.writes).toHaveLength(0);
  });

  it("filters unauthorized lifecycle drafts out of the assigned inbox", async () => {
    state.rows.opportunity_follow_up_drafts = [
      {
        id: "draft-other",
        company_id: "company-1",
        opportunity_id: "opportunity-other",
        connection_id: "connection-company",
        provider_thread_id: null,
        origin: "phase_c",
        status: "drafted",
        subject: "Private draft",
        original_body: "Must not leak",
        current_body: null,
        edited_at: null,
        updated_at: "2026-07-15T10:00:00.000Z",
        created_at: "2026-07-15T10:00:00.000Z",
      },
    ];
    const { GET } = await import("@/app/api/inbox/drafts/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/drafts?scope=own")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.drafts).toEqual([]);
    expect(state.resolveEmailOpportunityAccess).toHaveBeenCalledWith({
      actor,
      operation: "read",
      connectionId: "connection-company",
      opportunityId: "opportunity-other",
      supabase,
    });
  });

  it("keeps authorized lead history visible when it came through another user's personal mailbox", async () => {
    state.getConnections.mockResolvedValue([
      connection,
      {
        ...connection,
        id: "connection-personal-other",
        type: "individual",
        userId: "user-2",
        email: "personal@example.com",
      },
    ]);
    state.resolveEmailOpportunityAccess.mockResolvedValue({
      allowed: true,
      connectionId: "connection-personal-other",
      providerThreadId: null,
      opportunityId: "opportunity-assigned",
    });
    state.rows.opportunity_follow_up_drafts = [
      {
        id: "draft-assigned",
        company_id: "company-1",
        opportunity_id: "opportunity-assigned",
        connection_id: "connection-personal-other",
        provider_thread_id: null,
        origin: "phase_c",
        status: "drafted",
        subject: "Assigned inquiry",
        original_body: "Complete linked history",
        current_body: null,
        edited_at: null,
        updated_at: "2026-07-15T10:00:00.000Z",
        created_at: "2026-07-15T10:00:00.000Z",
      },
    ];
    const { GET } = await import("@/app/api/inbox/drafts/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/drafts?scope=own")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.drafts).toEqual([
      expect.objectContaining({
        id: "draft-assigned",
        opportunityId: "opportunity-assigned",
        connectionId: "connection-personal-other",
        fromEmail: "personal@example.com",
      }),
    ]);
    expect(state.resolveEmailOpportunityAccess).toHaveBeenCalledWith({
      actor,
      operation: "read",
      connectionId: "connection-personal-other",
      opportunityId: "opportunity-assigned",
      supabase,
    });
  });

  it("keeps an authorized lead's AI draft visible regardless of who generated it", async () => {
    state.resolveEmailOpportunityAccess.mockResolvedValue({
      allowed: true,
      connectionId: "connection-company",
      providerThreadId: null,
      opportunityId: "opportunity-assigned",
    });
    state.rows.ai_draft_history = [
      {
        id: "ai-draft-assigned",
        company_id: "company-1",
        user_id: "user-2",
        connection_id: "connection-company",
        thread_id: null,
        opportunity_id: "opportunity-assigned",
        subject: "Assigned inquiry",
        original_draft: "Draft from the linked lead history",
        final_version: null,
        status: "drafted",
        created_at: "2026-07-15T10:00:00.000Z",
      },
    ];
    const { GET } = await import("@/app/api/inbox/drafts/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/drafts?scope=own")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.drafts).toEqual([
      expect.objectContaining({
        source: "ai",
        id: "ai-draft-assigned",
        connectionId: "connection-company",
      }),
    ]);
  });

  it("pushes the assigned-lead union into both local draft queries", async () => {
    const { GET } = await import("@/app/api/inbox/drafts/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/drafts?scope=own")
    );

    expect(response.status).toBe(200);
    expect(state.queryOperations).toEqual(
      expect.arrayContaining([
        {
          table: "ai_draft_history",
          operation: "or",
          value: "opportunity_id.in.(opportunity-assigned)",
        },
        {
          table: "opportunity_follow_up_drafts",
          operation: "or",
          value: "opportunity_id.in.(opportunity-assigned)",
        },
      ])
    );
  });

  it("rejects an unrecognized provider thread before updating a mailbox draft", async () => {
    const updateDraft = vi.fn();
    state.getProvider.mockReturnValue({
      listDrafts: vi.fn(async () => []),
      createDraft: vi.fn(),
      updateDraft,
      deleteDraft: vi.fn(),
    });
    state.rows.email_connections = [
      {
        id: "connection-company",
        company_id: "company-1",
        type: "company",
        user_id: null,
        status: "active",
      },
    ];
    const { POST } = await import("@/app/api/inbox/drafts/route");

    const response = await POST(
      new NextRequest("https://ops.test/api/inbox/drafts", {
        method: "POST",
        body: JSON.stringify({
          connectionId: "connection-company",
          to: "lead@example.com",
          subject: "Re: Inquiry",
          body: "Draft body",
          providerThreadId: "forged-provider-thread",
          draftId: "provider-draft",
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(updateDraft).not.toHaveBeenCalled();
  });
});
