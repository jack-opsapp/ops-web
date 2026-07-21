import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/inbox/drafts/route";

const {
  buildEmailThreadListAuthorizationFilterMock,
  checkPermissionByIdMock,
  findUserByAuthMock,
  getConnectionMock,
  getConnectionsMock,
  getProviderMock,
  getServiceRoleClientMock,
  loadKnownEmailSignaturesForMessageMock,
  resolveEmailInboxListAccessMock,
  resolveEmailOpportunityAccessMock,
  resolveEmailRouteActorMock,
  resolveEmailSignatureForMessageMock,
  runWithEmailConnectionSyncLockMock,
  mailboxCheckpointMock,
  mutationExecuteMock,
  createMutationServiceMock,
  buildMutationFingerprintMock,
  runWithSupabaseMock,
  verifyAdminAuthMock,
} = vi.hoisted(() => ({
  buildEmailThreadListAuthorizationFilterMock: vi.fn(),
  checkPermissionByIdMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getConnectionsMock: vi.fn(),
  getProviderMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  loadKnownEmailSignaturesForMessageMock: vi.fn(),
  resolveEmailInboxListAccessMock: vi.fn(),
  resolveEmailOpportunityAccessMock: vi.fn(),
  resolveEmailRouteActorMock: vi.fn(),
  resolveEmailSignatureForMessageMock: vi.fn(),
  runWithEmailConnectionSyncLockMock: vi.fn(),
  mailboxCheckpointMock: vi.fn(),
  mutationExecuteMock: vi.fn(),
  createMutationServiceMock: vi.fn(),
  buildMutationFingerprintMock: vi.fn(() => "f".repeat(64)),
  runWithSupabaseMock: vi.fn(async (_supabase, fn) => fn()),
  verifyAdminAuthMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-provider-mutation-attempt-service", () => ({
  buildEmailProviderMutationFingerprint: buildMutationFingerprintMock,
  createEmailProviderMutationAttemptService: createMutationServiceMock,
  isEmailProviderMutationReconciliationRequiredError: (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    error.code === "EMAIL_PROVIDER_MUTATION_RECONCILIATION_REQUIRED",
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveEmailRouteActorMock,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  buildEmailThreadListAuthorizationFilter:
    buildEmailThreadListAuthorizationFilterMock,
  resolveEmailInboxListAccess: resolveEmailInboxListAccessMock,
  resolveEmailOpportunityAccess: resolveEmailOpportunityAccessMock,
}));

vi.mock("@/lib/email/email-signature-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/email/email-signature-runtime")
  >("@/lib/email/email-signature-runtime");
  return {
    ...actual,
    loadKnownEmailSignaturesForMessage: loadKnownEmailSignaturesForMessageMock,
    resolveEmailSignatureForMessage: resolveEmailSignatureForMessageMock,
  };
});

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

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  runWithEmailConnectionSyncLock: runWithEmailConnectionSyncLockMock,
}));

type DraftRouteState = {
  ai_draft_history: Array<Record<string, unknown>>;
  email_connections?: Array<Record<string, unknown>>;
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
      return state[this.table] ?? [];
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
    vi.clearAllMocks();
    resolveEmailOpportunityAccessMock.mockReset();
    checkPermissionByIdMock.mockReset();
    buildEmailThreadListAuthorizationFilterMock.mockReturnValue({
      empty: false,
    });
    resolveEmailRouteActorMock.mockResolvedValue({
      ok: true,
      actor: { userId: "user-1", companyId: "company-1" },
    });
    resolveEmailInboxListAccessMock.mockResolvedValue({
      allowed: true,
      actor: { userId: "user-1", companyId: "company-1" },
      inboxScope: "all",
      pipelineScope: "all",
      ownPersonalConnectionIds: [],
      assignedOpportunityIds: [],
      usedLegacyPipelineManage: false,
      usedLegacyInboxViewCompany: false,
    });
    resolveEmailOpportunityAccessMock.mockResolvedValue({ allowed: true });
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
    resolveEmailSignatureForMessageMock.mockResolvedValue({
      recordId: "signature-1",
      source: "ops",
      scope: "mailbox",
      html: "<div>Jackson<br>OPS</div>",
      text: "Jackson\nOPS",
      hash: "a".repeat(64),
      providerIdentity: null,
    });
    loadKnownEmailSignaturesForMessageMock.mockResolvedValue([
      {
        html: "<div>Jackson<br>OPS</div>",
        text: "Jackson\nOPS",
        hash: "a".repeat(64),
      },
      {
        html: "<div>Old Jackson<br>Old OPS</div>",
        text: "Old Jackson\nOld OPS",
        hash: "b".repeat(64),
      },
    ]);
    getProviderMock.mockReturnValue({
      listDrafts: vi.fn().mockResolvedValue([]),
      getDraft: vi.fn().mockResolvedValue(null),
      createDraft: vi.fn().mockResolvedValue("provider-draft-1"),
      updateDraft: vi.fn().mockResolvedValue(undefined),
      deleteDraft: vi.fn().mockResolvedValue(undefined),
    });
    runWithEmailConnectionSyncLockMock.mockImplementation(
      async ({
        run,
      }: {
        run: (checkpoint: () => Promise<void>) => unknown;
      }) => ({
        acquired: true,
        value: await run(mailboxCheckpointMock),
      })
    );
    mailboxCheckpointMock.mockResolvedValue(undefined);
    mutationExecuteMock.mockImplementation(async (input) => {
      const output = await input.executeProvider();
      await input.reconcile({
        attemptId: "attempt-1",
        resourceId: output.resourceId,
        secondaryResourceId: output.secondaryResourceId ?? null,
        result: output.result ?? {},
      });
      return {
        status: "completed",
        providerResourceId: output.resourceId,
      };
    });
    createMutationServiceMock.mockReturnValue({
      execute: mutationExecuteMock,
    });
    runWithSupabaseMock.mockImplementation(async (_supabase, fn) => fn());
  });

  it("skips provider reads while the mailbox lease is owned by ingestion", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_threads: [],
      opportunity_follow_up_drafts: makeDraftRows(1),
    };
    const provider = {
      listDrafts: vi.fn(),
      createDraft: vi.fn(),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
    };
    getProviderMock.mockReturnValue(provider);
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
    runWithEmailConnectionSyncLockMock.mockResolvedValue({ acquired: false });

    const response = await GET(
      new NextRequest("http://test.local/api/inbox/drafts?scope=own")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(provider.listDrafts).not.toHaveBeenCalled();
    expect(body.drafts).toEqual([
      expect.objectContaining({ source: "lifecycle", id: "draft-1" }),
    ]);
  });

  it("keeps provider-rendered signatures out of composer state and appends once on autosave", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_threads: [
        {
          id: "thread-internal-1",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
        },
      ],
      opportunity_follow_up_drafts: [],
    };
    const provider = {
      listDrafts: vi.fn().mockResolvedValue([
        {
          id: "provider-draft-1",
          threadId: "provider-thread-1",
          to: ["lead@example.com"],
          cc: [],
          subject: "Re: Quote",
          bodyText: "Authored body\n\nOld Jackson\nOld OPS",
          updatedAt: new Date("2026-07-14T18:00:00.000Z"),
        },
      ]),
      getDraft: vi.fn().mockResolvedValue({
        id: "provider-draft-1",
        threadId: "provider-thread-1",
        to: ["lead@example.com"],
        cc: [],
        subject: "Re: Quote",
        bodyText: "Authored body\n\nOld Jackson\nOld OPS",
        updatedAt: new Date("2026-07-14T18:00:00.000Z"),
      }),
      createDraft: vi.fn(),
      updateDraft: vi.fn().mockResolvedValue(undefined),
      deleteDraft: vi.fn(),
    };
    getProviderMock.mockReturnValue(provider);
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const listResponse = await GET(
      new NextRequest("http://test.local/api/inbox/drafts?scope=own")
    );
    const listed = await listResponse.json();
    const providerDraft = listed.drafts.find(
      (draft: Record<string, unknown>) => draft.source === "provider"
    );

    expect(providerDraft.bodyText).toBe("Authored body");
    expect(loadKnownEmailSignaturesForMessageMock).toHaveBeenCalledWith({
      connection: activeConnection,
    });
    expect(resolveEmailSignatureForMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerLockCheckpoint: mailboxCheckpointMock,
      })
    );

    const saveResponse = await POST(
      new NextRequest("http://test.local/api/inbox/drafts", {
        method: "POST",
        body: JSON.stringify({
          connectionId: "connection-1",
          to: "lead@example.com",
          subject: "Re: Quote",
          body: providerDraft.bodyText,
          providerThreadId: "provider-thread-1",
          draftId: "provider-draft-1",
        }),
      })
    );

    expect(saveResponse.status).toBe(200);
    expect(provider.updateDraft).toHaveBeenCalledOnce();
    const renderedBody = provider.updateDraft.mock.calls[0][3] as string;
    expect(renderedBody.match(/data-ops-signature-hash/g)).toHaveLength(1);
    expect(renderedBody.match(/Jackson/g)).toHaveLength(1);
  });

  it("rechecks canonical send access immediately before updating a provider draft", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_threads: [
        {
          id: "thread-internal-1",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
        },
      ],
      opportunity_follow_up_drafts: [],
    };
    const provider = {
      listDrafts: vi.fn(),
      getDraft: vi.fn().mockResolvedValue({
        id: "provider-draft-1",
        threadId: "provider-thread-1",
        to: ["lead@example.com"],
        cc: [],
        subject: "Re: Quote",
        bodyText: "Draft body",
        updatedAt: new Date("2026-07-14T18:00:00.000Z"),
      }),
      createDraft: vi.fn(),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
    };
    getProviderMock.mockReturnValue(provider);
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
    resolveEmailOpportunityAccessMock
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({
        allowed: false,
        reason: "opportunity_other_assignee",
      });

    const response = await POST(
      new NextRequest("http://test.local/api/inbox/drafts", {
        method: "POST",
        body: JSON.stringify({
          connectionId: "connection-1",
          to: "lead@example.com",
          subject: "Re: Quote",
          body: "Draft body",
          providerThreadId: "provider-thread-1",
          draftId: "provider-draft-1",
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_DRAFT_AUTHORIZATION_REVOKED",
    });
    expect(provider.updateDraft).not.toHaveBeenCalled();
  });

  it("rejects a provider draft whose immutable id belongs to another thread", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_threads: [
        {
          id: "thread-internal-1",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
        },
      ],
      opportunity_follow_up_drafts: [],
    };
    const provider = {
      listDrafts: vi.fn(),
      getDraft: vi.fn().mockResolvedValue({
        id: "provider-draft-1",
        threadId: "provider-thread-2",
        to: ["other@example.com"],
        cc: [],
        subject: "Other draft",
        bodyText: "Other body",
        updatedAt: new Date("2026-07-14T18:00:00.000Z"),
      }),
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
          connectionId: "connection-1",
          to: "lead@example.com",
          subject: "Re: Quote",
          body: "Draft body",
          providerThreadId: "provider-thread-1",
          draftId: "provider-draft-1",
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_DRAFT_AUTHORIZATION_REVOKED",
    });
    expect(provider.getDraft).toHaveBeenCalledWith("provider-draft-1");
    expect(provider.updateDraft).not.toHaveBeenCalled();
  });

  it("fails closed when the supplied provider draft identity is unknown", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_threads: [
        {
          id: "thread-internal-1",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
        },
      ],
      opportunity_follow_up_drafts: [],
    };
    const provider = {
      listDrafts: vi.fn(),
      getDraft: vi.fn().mockResolvedValue(null),
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
          connectionId: "connection-1",
          to: "lead@example.com",
          subject: "Re: Quote",
          body: "Draft body",
          providerThreadId: "provider-thread-1",
          draftId: "missing-provider-draft",
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_DRAFT_AUTHORIZATION_REVOKED",
    });
    expect(provider.getDraft).toHaveBeenCalledWith("missing-provider-draft");
    expect(provider.updateDraft).not.toHaveBeenCalled();
  });

  it("fails a provider-draft save before provider construction when the mailbox is busy", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_threads: [
        {
          id: "thread-internal-1",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
        },
      ],
      opportunity_follow_up_drafts: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
    runWithEmailConnectionSyncLockMock.mockResolvedValue({ acquired: false });

    const response = await POST(
      new NextRequest("http://test.local/api/inbox/drafts", {
        method: "POST",
        body: JSON.stringify({
          connectionId: "connection-1",
          to: "lead@example.com",
          subject: "Re: Quote",
          body: "Draft body",
          providerThreadId: "provider-thread-1",
          idempotencyKey: "user-1:inbox-reply:thread-internal-1::",
        }),
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_DRAFT_MAILBOX_BUSY",
    });
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(resolveEmailSignatureForMessageMock).not.toHaveBeenCalled();
  });

  it("requires and durably binds a stable key before creating a provider draft", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_connections: [
        {
          id: "connection-1",
          company_id: "company-1",
          type: "company",
          user_id: null,
          status: "active",
        },
      ],
      email_threads: [],
      opportunity_follow_up_drafts: [],
    };
    const provider = {
      listDrafts: vi.fn(),
      createDraft: vi.fn().mockResolvedValue("provider-draft-1"),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
    };
    getProviderMock.mockReturnValue(provider);
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const missingKey = await POST(
      new NextRequest("http://test.local/api/inbox/drafts", {
        method: "POST",
        body: JSON.stringify({
          connectionId: "connection-1",
          to: "lead@example.com",
          subject: "Quote",
          body: "Draft body",
        }),
      })
    );
    expect(missingKey.status).toBe(400);
    expect(await missingKey.json()).toMatchObject({
      code: "EMAIL_DRAFT_IDEMPOTENCY_KEY_REQUIRED",
    });
    expect(provider.createDraft).not.toHaveBeenCalled();

    const response = await POST(
      new NextRequest("http://test.local/api/inbox/drafts", {
        method: "POST",
        body: JSON.stringify({
          connectionId: "connection-1",
          to: "lead@example.com",
          subject: "Quote",
          body: "Draft body",
          idempotencyKey: "user-1:inbox-reply:thread-1::",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      draftId: "provider-draft-1",
    });
    expect(mutationExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        connectionId: "connection-1",
        operationKind: "draft_create",
        operationKey: "inbox-composer:user-1:inbox-reply:thread-1::",
        requestFingerprint: "f".repeat(64),
      })
    );
    expect(provider.createDraft).toHaveBeenCalledOnce();
  });

  it("revalidates an accepted provider draft identity during stable retry reconciliation", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_threads: [
        {
          id: "thread-internal-1",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
        },
      ],
      opportunity_follow_up_drafts: [],
    };
    const provider = {
      listDrafts: vi.fn(),
      getDraft: vi.fn().mockResolvedValue({
        id: "provider-draft-1",
        threadId: "provider-thread-1",
        to: ["lead@example.com"],
        cc: [],
        subject: "Re: Quote",
        bodyText: "Prior accepted body",
        updatedAt: new Date("2026-07-14T18:00:00.000Z"),
      }),
      createDraft: vi.fn(),
      updateDraft: vi.fn().mockResolvedValue(undefined),
      deleteDraft: vi.fn(),
    };
    getProviderMock.mockReturnValue(provider);
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
    mutationExecuteMock.mockImplementationOnce(async (input) => {
      await input.reconcile({
        attemptId: "attempt-1",
        resourceId: "provider-draft-1",
        secondaryResourceId: null,
        result: { draftId: "provider-draft-1" },
      });
      return {
        status: "completed",
        providerResourceId: "provider-draft-1",
      };
    });

    const response = await POST(
      new NextRequest("http://test.local/api/inbox/drafts", {
        method: "POST",
        body: JSON.stringify({
          connectionId: "connection-1",
          to: "lead@example.com",
          subject: "Re: Quote",
          body: "Recovered autosave body",
          providerThreadId: "provider-thread-1",
          idempotencyKey: "user-1:inbox-reply:thread-internal-1::",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(provider.getDraft).toHaveBeenCalledWith("provider-draft-1");
    expect(provider.updateDraft).toHaveBeenCalledOnce();
    expect(provider.createDraft).not.toHaveBeenCalled();
  });

  it("fails a provider-draft delete before provider construction when the mailbox is busy", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_connections: [
        {
          id: "connection-1",
          company_id: "company-1",
          type: "company",
          user_id: null,
          status: "active",
        },
      ],
      email_threads: [],
      opportunity_follow_up_drafts: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
    runWithEmailConnectionSyncLockMock.mockResolvedValue({ acquired: false });

    const response = await DELETE(
      new NextRequest(
        "http://test.local/api/inbox/drafts?source=provider&id=provider-draft-1&connectionId=connection-1",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_DRAFT_MAILBOX_BUSY",
    });
    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it("rechecks unlinked mailbox authority immediately before deleting a provider draft", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_connections: [
        {
          id: "connection-1",
          company_id: "company-1",
          type: "company",
          user_id: null,
          status: "active",
        },
      ],
      email_threads: [],
      opportunity_follow_up_drafts: [],
    };
    const provider = {
      listDrafts: vi.fn(),
      getDraft: vi.fn().mockResolvedValue({
        id: "provider-draft-1",
        threadId: null,
        to: ["lead@example.com"],
        cc: [],
        subject: "Standalone draft",
        bodyText: "Draft body",
        updatedAt: new Date("2026-07-14T18:00:00.000Z"),
      }),
      createDraft: vi.fn(),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
    };
    getProviderMock.mockReturnValue(provider);
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
    checkPermissionByIdMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const response = await DELETE(
      new NextRequest(
        "http://test.local/api/inbox/drafts?source=provider&id=provider-draft-1&connectionId=connection-1",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_DRAFT_AUTHORIZATION_REVOKED",
    });
    expect(provider.deleteDraft).not.toHaveBeenCalled();
  });

  it("binds a provider draft delete to the draft's actual authorized thread", async () => {
    const state: DraftRouteState = {
      ai_draft_history: [],
      email_connections: [
        {
          id: "connection-1",
          company_id: "company-1",
          type: "company",
          user_id: null,
          status: "active",
        },
      ],
      email_threads: [
        {
          id: "thread-internal-2",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-2",
        },
      ],
      opportunity_follow_up_drafts: [],
    };
    const provider = {
      listDrafts: vi.fn(),
      getDraft: vi.fn().mockResolvedValue({
        id: "provider-draft-1",
        threadId: "provider-thread-2",
        to: ["other@example.com"],
        cc: [],
        subject: "Other draft",
        bodyText: "Other body",
        updatedAt: new Date("2026-07-14T18:00:00.000Z"),
      }),
      createDraft: vi.fn(),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
    };
    getProviderMock.mockReturnValue(provider);
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
    resolveEmailOpportunityAccessMock.mockResolvedValue({
      allowed: false,
      reason: "opportunity_other_assignee",
    });

    const response = await DELETE(
      new NextRequest(
        "http://test.local/api/inbox/drafts?source=provider&id=provider-draft-1&connectionId=connection-1",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_DRAFT_AUTHORIZATION_REVOKED",
    });
    expect(provider.getDraft).toHaveBeenCalledWith("provider-draft-1");
    expect(provider.deleteDraft).not.toHaveBeenCalled();
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
