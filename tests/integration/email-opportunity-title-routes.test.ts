import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  afterCallbacks,
  getServiceRoleClientMock,
  runWithSupabaseMock,
  getConnectionMock,
  getProviderMock,
  createClientMock,
  createSubClientMock,
  softDeleteClientMock,
  createOpportunityMock,
  createActivityMock,
  upsertEmailThreadMock,
  classifyEmailThreadMock,
  relationshipMatchMock,
  resolveEmailRouteActorMock,
  loadEmailImportSourceForActorMock,
  createOrResumeEmailImportJobMock,
  loadAuthorizedEmailImportJobMock,
  completeEmailImportJobMock,
  approvedImportPayloads,
} = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown | Promise<unknown>>,
  getServiceRoleClientMock: vi.fn(),
  runWithSupabaseMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  createClientMock: vi.fn(),
  createSubClientMock: vi.fn(),
  softDeleteClientMock: vi.fn(),
  createOpportunityMock: vi.fn(),
  createActivityMock: vi.fn(),
  upsertEmailThreadMock: vi.fn(),
  classifyEmailThreadMock: vi.fn(),
  relationshipMatchMock: vi.fn(),
  resolveEmailRouteActorMock: vi.fn(),
  loadEmailImportSourceForActorMock: vi.fn(),
  createOrResumeEmailImportJobMock: vi.fn(),
  loadAuthorizedEmailImportJobMock: vi.fn(),
  completeEmailImportJobMock: vi.fn(),
  approvedImportPayloads: new Map<string, Record<string, unknown>>(),
}));

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (callback: () => unknown | Promise<unknown>) => {
      afterCallbacks.push(callback);
    },
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: runWithSupabaseMock,
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: async (...args: unknown[]) => {
      const connection = await getConnectionMock(...args);
      return connection
        ? {
            type: "company",
            userId: null,
            syncEnabled: true,
            status: "active",
            ...connection,
          }
        : connection;
    },
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/api/services/client-service", () => ({
  ClientService: {
    createClient: createClientMock,
    createSubClient: createSubClientMock,
    softDeleteClient: softDeleteClientMock,
  },
}));

vi.mock("@/lib/api/services/opportunity-service", () => ({
  OpportunityService: {
    createOpportunity: createOpportunityMock,
    createActivity: createActivityMock,
  },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    upsertFromEmail: upsertEmailThreadMock,
    classifyAndUpdate: classifyEmailThreadMock,
  },
}));

vi.mock("@/lib/email/opportunity-relationship-matching", () => ({
  findOpportunityRelationshipMatch: relationshipMatchMock,
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailCompanyAccess: vi.fn(async () => null),
  resolveEmailRouteActor: resolveEmailRouteActorMock,
  emailPipelineAuthorizationHeaders: vi.fn(() => ({
    "Content-Type": "application/json",
    Authorization: "Bearer test-pipeline-secret",
  })),
}));

vi.mock("@/lib/email/email-import-approval", () => ({
  EmailImportApprovalError: class EmailImportApprovalError extends Error {},
  approveEmailImportPayload: ({ submitted }: { submitted: unknown }) => submitted,
  fingerprintEmailImportPayload: () => "a".repeat(64),
}));

vi.mock("@/lib/email/email-import-job-access", () => ({
  EmailImportJobAccessError: class EmailImportJobAccessError extends Error {},
  loadEmailImportSourceForActor: loadEmailImportSourceForActorMock,
  createOrResumeEmailImportJob: createOrResumeEmailImportJobMock,
  loadAuthorizedEmailImportJob: loadAuthorizedEmailImportJobMock,
  completeEmailImportJob: completeEmailImportJobMock,
}));

import { POST as importPOST } from "@/app/api/integrations/email/import/route";
import { POST as webhookPOST } from "@/app/api/integrations/email-webhook/route";

describe("retired inbound email webhook", () => {
  it("returns 410 Gone and writes nothing", async () => {
    const response = await webhookPOST();
    expect(response.status).toBe(410);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain("retired");
  });
});

async function flushAfterCallbacks() {
  while (afterCallbacks.length > 0) {
    const callback = afterCallbacks.shift()!;
    await callback();
  }
}

function makeJsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface ImportState {
  jobUpdates: Array<Record<string, unknown>>;
  opportunityPatches: Array<Record<string, unknown>>;
  threadLinks: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  correspondenceEvents?: Array<Record<string, unknown>>;
  lifecycleStateUpserts?: Array<Record<string, unknown>>;
  opportunities?: Array<Record<string, unknown>>;
  clientRows?: Array<Record<string, unknown>>;
  activityRows?: Array<Record<string, unknown>>;
  sourceKeyWinner?: Record<string, unknown>;
  sourceKeyWinnerLookups?: Array<Record<string, unknown>>;
  connectionUpdates?: Array<Record<string, unknown>>;
  clientMergeCalls?: Array<Record<string, unknown>>;
  correspondenceProjectionCalls?: Array<Record<string, unknown>>;
  correspondenceProjectionIncrements?: number;
}

function makeImportSupabaseDouble(state: ImportState) {
  class Query {
    private action: "select" | "insert" | "update" | "upsert" = "select";
    private payload: Record<string, unknown> | null = null;
    private filters = new Map<string, unknown>();
    private inFilters = new Map<string, unknown[]>();

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    ilike() {
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    in(column: string, values: unknown[]) {
      this.inFilters.set(column, values);
      return this;
    }

    order() {
      return this;
    }

    limit() {
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.action = "insert";
      this.payload = payload;
      if (this.table === "notifications") state.notifications.push(payload);
      if (this.table === "opportunity_correspondence_events") {
        const row = {
          id: `event-${(state.correspondenceEvents ?? []).length + 1}`,
          ...payload,
        };
        state.correspondenceEvents ??= [];
        state.correspondenceEvents.push(row);
      }
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      if (this.table === "gmail_scan_jobs") state.jobUpdates.push(payload);
      if (this.table === "opportunities")
        state.opportunityPatches.push(payload);
      if (this.table === "email_connections") {
        state.connectionUpdates ??= [];
        state.connectionUpdates.push(payload);
      }
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      this.action = "upsert";
      this.payload = payload;
      if (this.table === "opportunity_email_threads") {
        const alreadyClaimed = state.threadLinks.some(
          (row) =>
            row.thread_id === payload.thread_id &&
            row.connection_id === payload.connection_id
        );
        if (!alreadyClaimed) state.threadLinks.push(payload);
      }
      if (this.table === "opportunity_lifecycle_state") {
        state.lifecycleStateUpserts ??= [];
        state.lifecycleStateUpserts.push(payload);
      }
      return this;
    }

    async single() {
      if (this.table === "gmail_scan_jobs" && this.action === "insert") {
        return { data: { id: "job-1", ...this.payload }, error: null };
      }
      if (this.table === "email_connections") {
        return {
          data: {
            sync_filters: {},
            user_id: null,
            company_id: "company-1",
          },
          error: null,
        };
      }
      if (this.table === "clients" && this.action === "select") {
        const rows = this.filteredRows(state.clientRows ?? []);
        return { data: rows[0] ?? null, error: null };
      }
      return { data: null, error: null };
    }

    async maybeSingle() {
      if (this.table === "activities") {
        const row = this.filteredRows(state.activityRows ?? [])[0] ?? null;
        if (row && this.action === "update" && this.payload) {
          Object.assign(row, this.payload);
        }
        return { data: row, error: null };
      }
      if (this.table === "opportunity_email_threads") {
        const row = this.filteredRows(state.threadLinks)[0] ?? null;
        return { data: row, error: null };
      }
      if (this.table === "opportunities" && this.action === "select") {
        const lookup = Object.fromEntries(this.filters.entries());
        if (this.filters.has("source_thread_key")) {
          state.sourceKeyWinnerLookups ??= [];
          state.sourceKeyWinnerLookups.push(lookup);
        }
        const rows = [
          ...(state.opportunities ?? []),
          ...(state.sourceKeyWinner ? [state.sourceKeyWinner] : []),
        ];
        return { data: this.filteredRows(rows)[0] ?? null, error: null };
      }
      return { data: null, error: null };
    }

    private filteredRows(rows: Array<Record<string, unknown>>) {
      return rows.filter((row) => {
        for (const [column, value] of this.filters.entries()) {
          if (
            String(row[column] ?? "").toLowerCase() !==
            String(value ?? "").toLowerCase()
          ) {
            return false;
          }
        }
        for (const [column, values] of this.inFilters.entries()) {
          if (!values.includes(row[column])) return false;
        }
        return true;
      });
    }

    private result() {
      if (this.table === "clients")
        return { data: this.filteredRows(state.clientRows ?? []), error: null };
      if (this.table === "opportunities")
        return { data: state.opportunities ?? [], error: null };
      if (this.table === "activities") {
        const rows = this.filteredRows(state.activityRows ?? []);
        return { data: rows, error: null };
      }
      if (this.table === "opportunity_correspondence_events") {
        return {
          data: this.filteredRows(state.correspondenceEvents ?? []),
          error: null,
        };
      }
      return { data: null, error: null };
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
      return new Query(table);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "authorize_opportunity_action_as_system") {
        return { data: true, error: null };
      }
      if (name === "enqueue_email_import_provider_operation_as_system") {
        return { data: true, error: null };
      }
      if (name === "apply_opportunity_correspondence_event") {
        state.correspondenceProjectionCalls ??= [];
        state.correspondenceProjectionCalls.push(args);
        const event = (state.correspondenceEvents ?? []).find(
          (row) =>
            row.company_id === args.p_company_id &&
            row.opportunity_id === args.p_opportunity_id &&
            row.connection_id === args.p_connection_id &&
            row.provider_message_id === args.p_provider_message_id
        );
        if (!event) {
          return {
            data: null,
            error: { message: "correspondence event not found" },
          };
        }
        if (event.opportunity_projection_applied === false) {
          event.opportunity_projection_applied = true;
          state.correspondenceProjectionIncrements =
            (state.correspondenceProjectionIncrements ?? 0) + 1;
        }
        return { data: [{ correspondence_count: 1 }], error: null };
      }
      if (name === "execute_client_merge_guarded") {
        state.clientMergeCalls ??= [];
        state.clientMergeCalls.push(args);
        return { data: { applied: true }, error: null };
      }
      return { data: null, error: null };
    },
  };
}

describe("email opportunity title route writes", () => {
  beforeEach(() => {
    afterCallbacks.length = 0;
    getServiceRoleClientMock.mockReset();
    runWithSupabaseMock.mockReset();
    getConnectionMock.mockReset();
    getProviderMock.mockReset();
    createClientMock.mockReset();
    createSubClientMock.mockReset();
    softDeleteClientMock.mockReset();
    createOpportunityMock.mockReset();
    createActivityMock.mockReset();
    upsertEmailThreadMock.mockReset();
    upsertEmailThreadMock.mockResolvedValue({
      threadRow: { id: "email-thread-1" },
      isNew: true,
    });
    classifyEmailThreadMock.mockReset();
    relationshipMatchMock.mockReset();
    resolveEmailRouteActorMock.mockReset();
    loadEmailImportSourceForActorMock.mockReset();
    createOrResumeEmailImportJobMock.mockReset();
    loadAuthorizedEmailImportJobMock.mockReset();
    completeEmailImportJobMock.mockReset();
    approvedImportPayloads.clear();
    resolveEmailRouteActorMock.mockResolvedValue({
      ok: true,
      actor: { userId: "user-1", companyId: "company-1" },
    });
    loadEmailImportSourceForActorMock.mockResolvedValue({
      sourceScanJobId: "scan-1",
      companyId: "company-1",
      connectionId: "connection-1",
      connectionEmail: "jackson@canprodeckandrail.com",
      connectionOwnerUserId: null,
      connectionType: "company",
      result: { leads: [] },
    });
    createOrResumeEmailImportJobMock.mockImplementation(
      async ({ approvedPayload }: { approvedPayload: Record<string, unknown> }) => {
        const jobId = `job-${approvedImportPayloads.size + 1}`;
        approvedImportPayloads.set(jobId, approvedPayload);
        return { jobId, shouldDispatch: true, resumed: false };
      }
    );
    loadAuthorizedEmailImportJobMock.mockImplementation(
      async ({ jobId }: { jobId: string }) => ({
        jobId,
        sourceScanJobId: "scan-1",
        actorUserId: "user-1",
        companyId: "company-1",
        connectionId: "connection-1",
        connectionOwnerUserId: null,
        connectionType: "company",
        approvalFingerprint: "a".repeat(64),
        approvedPayload: approvedImportPayloads.get(jobId),
      })
    );
    completeEmailImportJobMock.mockResolvedValue(undefined);
    relationshipMatchMock.mockResolvedValue({
      action: "create_new",
      reason: "No deterministic relationship signal met the P3 bar",
      suggestedOpportunityId: null,
      evidence: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 }))
    );

    runWithSupabaseMock.mockImplementation(
      async (_client: unknown, callback: () => Promise<unknown>) => callback()
    );
  });

  it("normalizes imported estimate lead titles from customer identity, not subject/company/AI summary text", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      correspondenceEvents: [],
      // The same provider thread in another mailbox must not suppress this
      // connection's synthetic activity or change its sequence.
      activityRows: [
        {
          id: "activity-other-mailbox",
          company_id: "company-1",
          email_connection_id: "connection-2",
          opportunity_id: "opp-kara",
          email_thread_id: "thread-1",
          type: "email",
        },
      ],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    createClientMock.mockResolvedValue({ id: "client-kara" });
    createOpportunityMock.mockResolvedValue({ id: "opp-kara" });
    createActivityMock.mockResolvedValue({ id: "activity-kara" });

    const aiSummary = `Canpro Deck and Rail Estimate ${"details ".repeat(80)}`;
    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          {
            id: "lead-1",
            threadId: "thread-1",
            emails: [
              {
                id: "gmail-message-kara",
                providerThreadId: "thread-1",
                from: "Kara Beach <kara.beach@example.com>",
                subject: "Estimate request",
                date: "2026-05-20T17:00:00.000Z",
                direction: "inbound",
              },
            ],
            clientName: "Kara Beach",
            clientEmail: "kara.beach@example.com",
            clientPhone: null,
            clientAddress: "123 Cedar Street",
            description: aiSummary,
            stage: "new_lead",
            estimatedValue: null,
            correspondenceCount: 1,
            outboundCount: 0,
            lastMessageDate: "2026-05-20T17:00:00.000Z",
            existingClientId: null,
            action: "create_new",
            mergeWithLeadId: null,
            title: "Canpro Deck and Rail Estimate",
            actualCloseDate: null,
          },
        ],
        syncProfile: {
          estimateSubjectPatterns: ["estimate"],
          companyDomains: ["canprodeckandrail.com"],
          teamForwarders: [],
          knownPlatformSenders: ["notifications@wix-forms.com"],
          formSubjectPatterns: [],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
          aiClassificationThreshold: 0.75,
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(createOpportunityMock).toHaveBeenCalledOnce();
    const payload = createOpportunityMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.title).toBe("Kara Beach — Estimate");
    expect(payload.title).not.toBe("Canpro Deck and Rail Estimate");
    expect(payload.title).not.toContain("details");
    expect(payload).toMatchObject({
      contactName: "Kara Beach",
      contactEmail: "kara.beach@example.com",
      address: "123 Cedar Street",
      sourceEmailId: "thread-1",
      source: "email",
    });
    expect(payload.description).toBe(aiSummary);
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Kara Beach",
        email: "kara.beach@example.com",
        address: "123 Cedar Street",
      })
    );
    expect(state.opportunityPatches[0]).toMatchObject({
      ai_summary: aiSummary,
    });
    // The import activity preserves the exact provider message identity from
    // analysis so steady sync can dedupe the same message without guessing.
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opp-kara",
        emailThreadId: "thread-1",
        emailMessageId: "gmail-message-kara",
        emailConnectionId: "connection-1",
        fromEmail: "kara.beach@example.com",
        toEmails: ["jackson@canprodeckandrail.com"],
        occurredAt: new Date("2026-05-20T17:00:00.000Z"),
      })
    );
    expect(upsertEmailThreadMock).toHaveBeenCalledWith({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "thread-1",
      direction: "inbound",
      opportunityId: "opp-kara",
      clientId: "client-kara",
      markClassificationDirty: true,
      email: expect.objectContaining({
        id: "gmail-message-kara",
        threadId: "thread-1",
        from: "kara.beach@example.com",
        fromName: "Kara Beach",
        to: ["jackson@canprodeckandrail.com"],
        cc: [],
        subject: "Estimate request",
        date: new Date("2026-05-20T17:00:00.000Z"),
        isRead: true,
      }),
    });
    expect(createActivityMock.mock.invocationCallOrder[0]).toBeLessThan(
      upsertEmailThreadMock.mock.invocationCallOrder[0]
    );
    expect(classifyEmailThreadMock).not.toHaveBeenCalled();
    expect(state.correspondenceEvents).toEqual([
      expect.objectContaining({
        company_id: "company-1",
        opportunity_id: "opp-kara",
        provider_thread_id: "thread-1",
        provider_message_id: "gmail-message-kara",
        direction: "inbound",
        from_email: "kara.beach@example.com",
        to_emails: ["jackson@canprodeckandrail.com"],
        party_role: "customer",
        is_meaningful: true,
        source: "email_import",
      }),
    ]);
  });

  it("stops an ordinary import without exact provider messages before creating CRM records", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      correspondenceEvents: [],
      connectionUpdates: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });

    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          {
            id: "lead-stale-analysis",
            threadId: "thread-stale-analysis",
            clientName: "Kara Beach",
            clientEmail: "kara.beach@example.com",
            clientPhone: null,
            clientAddress: null,
            description: "Estimate request.",
            stage: "new_lead",
            estimatedValue: null,
            correspondenceCount: 1,
            outboundCount: 0,
            lastMessageDate: "2026-05-20T17:00:00.000Z",
            existingClientId: null,
            action: "create_new",
            mergeWithLeadId: null,
            title: null,
            actualCloseDate: null,
          },
        ],
        syncProfile: {},
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(createClientMock).not.toHaveBeenCalled();
    expect(createOpportunityMock).not.toHaveBeenCalled();
    expect(createActivityMock).not.toHaveBeenCalled();
    expect(state.correspondenceEvents).toHaveLength(0);
    expect(state.jobUpdates.at(-1)).toMatchObject({
      status: "import_error",
      error_message: expect.stringContaining(
        "Reanalyze the mailbox, then import again"
      ),
    });
    expect(state.connectionUpdates).not.toContainEqual(
      expect.objectContaining({
        sync_filters: expect.objectContaining({ importComplete: true }),
      })
    );
  });

  it("dedupes an imported provider message while preserving a newer message from the same thread", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      correspondenceEvents: [],
      activityRows: [
        {
          id: "activity-old",
          company_id: "company-1",
          email_connection_id: "connection-1",
          opportunity_id: null,
          client_id: null,
          email_thread_id: "thread-1",
          email_message_id: "gmail-message-old",
          type: "email",
        },
      ],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    createClientMock.mockResolvedValue({ id: "client-kara" });
    createOpportunityMock.mockResolvedValue({ id: "opp-kara" });
    createActivityMock.mockResolvedValue({ id: "activity-new" });

    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          {
            id: "lead-message-identity",
            threadId: "thread-1",
            providerThreadId: "thread-1",
            emails: [
              {
                id: "gmail-message-old",
                providerThreadId: "thread-1",
                from: "Kara Beach <kara.beach@example.com>",
                subject: "Estimate request",
                date: "2026-05-20T17:00:00.000Z",
                direction: "inbound",
              },
              {
                id: "gmail-message-new",
                providerThreadId: "thread-1",
                from: "Jackson Sweet <jackson@canprodeckandrail.com>",
                subject: "Re: Estimate request",
                date: "2026-05-21T18:00:00.000Z",
                direction: "outbound",
              },
            ],
            clientName: "Kara Beach",
            clientEmail: "kara.beach@example.com",
            clientPhone: null,
            clientAddress: null,
            description: "Estimate request and reply.",
            stage: "quoted",
            estimatedValue: 12500,
            correspondenceCount: 2,
            outboundCount: 1,
            lastMessageDate: "2026-05-21T18:00:00.000Z",
            lastInboundAt: "2026-05-20T17:00:00.000Z",
            lastOutboundAt: "2026-05-21T18:00:00.000Z",
            lastMessageDirection: "outbound",
            existingClientId: null,
            action: "create_new",
            mergeWithLeadId: null,
            title: null,
            actualCloseDate: null,
          },
        ],
        syncProfile: {
          estimateSubjectPatterns: ["estimate"],
          companyDomains: ["canprodeckandrail.com"],
          teamForwarders: [],
          knownPlatformSenders: [],
          formSubjectPatterns: [],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
          aiClassificationThreshold: 0.75,
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(createActivityMock).toHaveBeenCalledOnce();
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opp-kara",
        emailThreadId: "thread-1",
        emailMessageId: "gmail-message-new",
        emailConnectionId: "connection-1",
        direction: "outbound",
        subject: "Re: Estimate request",
        fromEmail: "jackson@canprodeckandrail.com",
        toEmails: ["kara.beach@example.com"],
      })
    );
    expect(state.activityRows?.[0]).toMatchObject({
      id: "activity-old",
      opportunity_id: "opp-kara",
      client_id: "client-kara",
    });
    expect(state.correspondenceEvents).toEqual([
      expect.objectContaining({
        activity_id: "activity-old",
        provider_thread_id: "thread-1",
        provider_message_id: "gmail-message-old",
        from_email: "kara.beach@example.com",
        occurred_at: "2026-05-20T17:00:00.000Z",
        opportunity_projection_applied: true,
      }),
      expect.objectContaining({
        activity_id: "activity-new",
        provider_thread_id: "thread-1",
        provider_message_id: "gmail-message-new",
        direction: "outbound",
        from_email: "jackson@canprodeckandrail.com",
        occurred_at: "2026-05-21T18:00:00.000Z",
        opportunity_projection_applied: true,
      }),
    ]);
  });

  it("projects exact messages once when import reuses an existing opportunity", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      opportunities: [
        {
          id: "opp-existing",
          company_id: "company-1",
          client_id: "client-existing",
        },
      ],
      clientRows: [
        {
          id: "client-existing",
          company_id: "company-1",
          email: "kara.beach@example.com",
          deleted_at: null,
        },
      ],
      activityRows: [
        {
          id: "activity-old",
          company_id: "company-1",
          email_connection_id: "connection-1",
          opportunity_id: "opp-existing",
          client_id: "client-existing",
          email_thread_id: "thread-existing",
          email_message_id: "gmail-message-old",
          type: "email",
        },
      ],
      correspondenceEvents: [
        {
          id: "event-old",
          company_id: "company-1",
          opportunity_id: "opp-existing",
          activity_id: "activity-old",
          connection_id: "connection-1",
          provider_thread_id: "thread-existing",
          provider_message_id: "gmail-message-old",
          direction: "outbound",
          occurred_at: "2026-05-20T17:00:00.000Z",
          opportunity_projection_applied: true,
        },
      ],
      correspondenceProjectionCalls: [],
      correspondenceProjectionIncrements: 0,
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    relationshipMatchMock.mockResolvedValue({
      action: "link",
      opportunityId: "opp-existing",
      clientId: "client-existing",
      reason: "Same verified customer and thread",
      evidence: [],
    });
    createActivityMock.mockImplementation(async (activity) => {
      const row = {
        id: "activity-new",
        company_id: activity.companyId,
        opportunity_id: activity.opportunityId,
        client_id: activity.clientId,
        email_connection_id: activity.emailConnectionId,
        email_thread_id: activity.emailThreadId,
        email_message_id: activity.emailMessageId,
        type: activity.type,
      };
      state.activityRows?.push(row);
      return { id: row.id };
    });

    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          {
            id: "lead-existing",
            threadId: "thread-existing",
            providerThreadId: "thread-existing",
            emails: [
              {
                id: "gmail-message-old",
                providerThreadId: "thread-existing",
                from: "Jackson Sweet <jackson@canprodeckandrail.com>",
                subject: "Estimate sent",
                date: "2026-05-20T17:00:00.000Z",
                direction: "outbound",
              },
              {
                id: "gmail-message-new",
                providerThreadId: "thread-existing",
                from: "Jackson Sweet <jackson@canprodeckandrail.com>",
                subject: "Estimate follow-up",
                date: "2026-05-21T18:00:00.000Z",
                direction: "outbound",
              },
            ],
            clientName: "Kara Beach",
            clientEmail: "kara.beach@example.com",
            clientPhone: null,
            clientAddress: null,
            description: "Estimate sent and followed up.",
            stage: "follow_up",
            estimatedValue: 12500,
            correspondenceCount: 2,
            outboundCount: 2,
            lastMessageDate: "2026-05-21T18:00:00.000Z",
            lastInboundAt: null,
            lastOutboundAt: "2026-05-21T18:00:00.000Z",
            lastMessageDirection: "outbound",
            existingClientId: "client-existing",
            action: "link",
            mergeWithLeadId: null,
            title: null,
            actualCloseDate: null,
          },
        ],
        syncProfile: {
          estimateSubjectPatterns: ["estimate"],
          companyDomains: ["canprodeckandrail.com"],
          teamForwarders: [],
          knownPlatformSenders: [],
          formSubjectPatterns: [],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
          aiClassificationThreshold: 0.75,
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(createOpportunityMock).not.toHaveBeenCalled();
    expect(createActivityMock).toHaveBeenCalledOnce();
    expect(state.correspondenceProjectionCalls).toEqual([
      expect.objectContaining({
        p_opportunity_id: "opp-existing",
        p_provider_message_id: "gmail-message-old",
      }),
      expect.objectContaining({
        p_opportunity_id: "opp-existing",
        p_provider_message_id: "gmail-message-new",
      }),
    ]);
    expect(state.correspondenceProjectionIncrements).toBe(1);
    expect(state.correspondenceEvents).toContainEqual(
      expect.objectContaining({
        provider_message_id: "gmail-message-new",
        opportunity_projection_applied: true,
      })
    );
  });

  it("preserves an outbound-only wizard thread as outbound correspondence", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      correspondenceEvents: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    createClientMock.mockResolvedValue({ id: "client-kara" });
    createOpportunityMock.mockResolvedValue({ id: "opp-kara" });
    createActivityMock.mockResolvedValue({ id: "activity-kara" });

    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          {
            id: "lead-outbound",
            threadId: "thread-outbound",
            emails: [
              {
                id: "gmail-outbound-1",
                providerThreadId: "thread-outbound",
                from: "jackson@canprodeckandrail.com",
                subject: "Estimate sent",
                date: "2026-05-19T17:00:00.000Z",
                direction: "outbound",
              },
              {
                id: "gmail-outbound-2",
                providerThreadId: "thread-outbound",
                from: "jackson@canprodeckandrail.com",
                subject: "Estimate follow-up",
                date: "2026-05-20T17:00:00.000Z",
                direction: "outbound",
              },
            ],
            clientName: "Kara Beach",
            clientEmail: "kara.beach@example.com",
            clientPhone: null,
            clientAddress: null,
            description: "Estimate sent.",
            stage: "quoted",
            estimatedValue: 12500,
            correspondenceCount: 2,
            outboundCount: 2,
            lastMessageDate: "2026-05-20T17:00:00.000Z",
            existingClientId: null,
            action: "create_new",
            mergeWithLeadId: null,
            title: null,
            actualCloseDate: null,
          },
        ],
        syncProfile: {
          estimateSubjectPatterns: ["estimate"],
          companyDomains: ["canprodeckandrail.com"],
          teamForwarders: [],
          knownPlatformSenders: [],
          formSubjectPatterns: [],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
          aiClassificationThreshold: 0.75,
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "outbound",
        fromEmail: "jackson@canprodeckandrail.com",
        toEmails: ["kara.beach@example.com"],
      })
    );
    expect(createActivityMock).toHaveBeenCalledTimes(2);
    expect(state.correspondenceEvents).toHaveLength(2);
    expect(state.correspondenceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "outbound",
          from_email: "jackson@canprodeckandrail.com",
          to_emails: ["kara.beach@example.com"],
        }),
      ])
    );
  });

  it("preserves separate inbound and outbound maxima when a mixed thread ends outbound", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      correspondenceEvents: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    createClientMock.mockResolvedValue({ id: "client-mixed" });
    createOpportunityMock.mockResolvedValue({ id: "opp-mixed" });
    createActivityMock.mockResolvedValue({ id: "activity-mixed" });

    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          {
            id: "lead-mixed",
            threadId: "thread-mixed",
            emails: [
              {
                id: "gmail-mixed-inbound",
                providerThreadId: "thread-mixed",
                from: "mara.hill@example.com",
                subject: "Estimate request",
                date: "2026-05-20T17:00:00.000Z",
                direction: "inbound",
              },
              {
                id: "gmail-mixed-outbound",
                providerThreadId: "thread-mixed",
                from: "jackson@canprodeckandrail.com",
                subject: "Re: Estimate request",
                date: "2026-05-21T18:00:00.000Z",
                direction: "outbound",
              },
            ],
            clientName: "Mara Hill",
            clientEmail: "mara.hill@example.com",
            clientPhone: null,
            clientAddress: null,
            description: "Estimate requested, then sent.",
            stage: "quoted",
            estimatedValue: 6400,
            correspondenceCount: 2,
            outboundCount: 1,
            lastMessageDate: "2026-05-21T18:00:00.000Z",
            lastInboundAt: "2026-05-20T17:00:00.000Z",
            lastOutboundAt: "2026-05-21T18:00:00.000Z",
            lastMessageDirection: "outbound",
            existingClientId: null,
            action: "create_new",
            mergeWithLeadId: null,
            title: null,
            actualCloseDate: null,
          },
        ],
        syncProfile: {
          estimateSubjectPatterns: ["estimate"],
          companyDomains: ["canprodeckandrail.com"],
          teamForwarders: [],
          knownPlatformSenders: [],
          formSubjectPatterns: [],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
          aiClassificationThreshold: 0.75,
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(createOpportunityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inboundCount: 1,
        outboundCount: 1,
        lastInboundAt: new Date("2026-05-20T17:00:00.000Z"),
        lastOutboundAt: new Date("2026-05-21T18:00:00.000Z"),
        lastMessageDirection: "out",
      })
    );
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "outbound",
        fromEmail: "jackson@canprodeckandrail.com",
        toEmails: ["mara.hill@example.com"],
      })
    );
    expect(createActivityMock).toHaveBeenCalledTimes(2);
    expect(state.correspondenceEvents).toHaveLength(2);
    expect(state.correspondenceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "inbound",
          from_email: "mara.hill@example.com",
        }),
        expect.objectContaining({
          direction: "outbound",
          from_email: "jackson@canprodeckandrail.com",
          to_emails: ["mara.hill@example.com"],
        }),
      ])
    );
  });

  it("preserves every raw thread when one reviewed lead merges ordinary sibling threads", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      correspondenceEvents: [],
      activityRows: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    createClientMock.mockResolvedValue({ id: "client-liane" });
    createOpportunityMock.mockResolvedValue({ id: "opp-liane" });
    createActivityMock.mockImplementation(async (activity) => {
      const id = `activity-${activity.emailMessageId}`;
      state.activityRows?.push({
        id,
        company_id: activity.companyId,
        opportunity_id: activity.opportunityId,
        client_id: activity.clientId,
        email_connection_id: activity.emailConnectionId,
        email_thread_id: activity.emailThreadId,
        email_message_id: activity.emailMessageId,
        type: activity.type,
      });
      return { id };
    });

    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          {
            id: "lead-merged-threads",
            threadId: "thread-primary",
            providerThreadId: "thread-primary",
            emails: [
              {
                id: "message-primary",
                providerThreadId: "thread-primary",
                from: "liane@example.com",
                subject: "Estimate request",
                date: "2026-05-20T17:00:00.000Z",
                direction: "inbound",
              },
              {
                id: "message-secondary",
                providerThreadId: "thread-secondary",
                from: "liane@example.com",
                subject: "Re: Estimate request",
                date: "2026-05-21T17:00:00.000Z",
                direction: "inbound",
              },
            ],
            clientName: "Liane Kern",
            clientEmail: "liane@example.com",
            clientPhone: null,
            clientAddress: null,
            description: "Two estimate threads.",
            stage: "qualifying",
            estimatedValue: null,
            correspondenceCount: 2,
            outboundCount: 0,
            lastMessageDate: "2026-05-21T17:00:00.000Z",
            lastInboundAt: "2026-05-21T17:00:00.000Z",
            lastOutboundAt: null,
            lastMessageDirection: "inbound",
            existingClientId: null,
            action: "create_new",
            mergeWithLeadId: null,
            title: null,
            actualCloseDate: null,
          },
        ],
        syncProfile: {
          companyDomains: ["canprodeckandrail.com"],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(state.threadLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ thread_id: "thread-primary" }),
        expect.objectContaining({ thread_id: "thread-secondary" }),
      ])
    );
    expect(state.threadLinks).toHaveLength(2);
    expect(
      createActivityMock.mock.calls.map((call) => ({
        messageId: call[0].emailMessageId,
        threadId: call[0].emailThreadId,
      }))
    ).toEqual([
      { messageId: "message-primary", threadId: "thread-primary" },
      { messageId: "message-secondary", threadId: "thread-secondary" },
    ]);
    expect(
      state.correspondenceEvents?.map((event) => ({
        messageId: event.provider_message_id,
        threadId: event.provider_thread_id,
      }))
    ).toEqual([
      { messageId: "message-primary", threadId: "thread-primary" },
      { messageId: "message-secondary", threadId: "thread-secondary" },
    ]);
  });

  it("imports two form submissions from one Gmail thread as separate leads without raw-thread inheritance", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      correspondenceEvents: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    createClientMock
      .mockResolvedValueOnce({ id: "client-sandra" })
      .mockResolvedValueOnce({ id: "client-brad" });
    createOpportunityMock
      .mockResolvedValueOnce({ id: "opp-sandra" })
      .mockResolvedValueOnce({ id: "opp-brad" });
    createActivityMock
      .mockResolvedValueOnce({ id: "activity-sandra" })
      .mockResolvedValueOnce({ id: "activity-brad" });

    const formLead = (
      id: string,
      messageId: string,
      clientName: string,
      clientEmail: string
    ) => ({
      id,
      threadId: `contact-form-message:${messageId}`,
      providerThreadId: "gmail-thread-shared",
      clientName,
      clientEmail,
      clientPhone: null,
      clientAddress: null,
      description: "Free quote request.",
      stage: "new_lead",
      estimatedValue: null,
      correspondenceCount: 1,
      outboundCount: 0,
      lastMessageDate: "2026-05-20T17:00:00.000Z",
      existingClientId: null,
      action: "create_new",
      mergeWithLeadId: null,
      title: null,
      actualCloseDate: null,
    });

    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          formLead(
            "lead-sandra",
            "msg-sandra",
            "Sandra Dunford",
            "sandra@example.com"
          ),
          formLead("lead-brad", "msg-brad", "Brad King", "brad@example.com"),
        ],
        syncProfile: {
          estimateSubjectPatterns: [],
          companyDomains: ["canprodeckandrail.com"],
          teamForwarders: [],
          knownPlatformSenders: ["notifications@wix-forms.com"],
          formSubjectPatterns: ["free quote"],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
          aiClassificationThreshold: 0.75,
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(createOpportunityMock).toHaveBeenCalledTimes(2);
    expect(state.threadLinks).toHaveLength(0);
    expect(relationshipMatchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerThreadId: null })
    );
    expect(relationshipMatchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ providerThreadId: null })
    );
    expect(createActivityMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        emailThreadId: "gmail-thread-shared",
        emailMessageId: "msg-sandra",
      })
    );
    expect(createActivityMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        emailThreadId: "gmail-thread-shared",
        emailMessageId: "msg-brad",
      })
    );
  });

  it("atomically reuses the same-company source-key winner when concurrent wizard imports collide", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      correspondenceEvents: [],
      activityRows: [],
      sourceKeyWinner: {
        id: "opp-winner",
        company_id: "company-1",
        client_id: "client-winner",
        source_thread_key: "email:gmail:connection-1:message:msg-concurrent",
      },
      clientMergeCalls: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    createClientMock
      .mockResolvedValueOnce({ id: "client-winner" })
      .mockResolvedValueOnce({ id: "client-loser" });
    createOpportunityMock
      .mockResolvedValueOnce({ id: "opp-winner" })
      .mockRejectedValueOnce(
        Object.assign(new Error("duplicate opportunity source key"), {
          code: "23505",
        })
      );
    createActivityMock.mockImplementation(async (activity) => {
      const row = {
        id: "activity-winner",
        company_id: activity.companyId,
        opportunity_id: activity.opportunityId,
        email_connection_id: activity.emailConnectionId,
        email_thread_id: activity.emailThreadId,
        email_message_id: activity.emailMessageId,
        type: activity.type,
      };
      state.activityRows?.push(row);
      return { id: row.id };
    });

    const payload = {
      connectionId: "connection-1",
      companyId: "company-1",
      leads: [
        {
          id: "lead-concurrent",
          threadId: "contact-form-message:msg-concurrent",
          providerThreadId: "gmail-thread-shared",
          clientName: "Sandra Dunford",
          clientEmail: "sandra@example.com",
          clientPhone: null,
          clientAddress: null,
          description: "Free quote request.",
          stage: "new_lead",
          estimatedValue: null,
          correspondenceCount: 1,
          outboundCount: 0,
          lastMessageDate: "2026-05-20T17:00:00.000Z",
          existingClientId: null,
          action: "create_new",
          mergeWithLeadId: null,
          subContacts: [
            {
              name: "Sam Dunford",
              email: "sam@example.com",
              phone: null,
            },
          ],
          title: null,
          actualCloseDate: null,
        },
      ],
      syncProfile: {
        companyDomains: ["canprodeckandrail.com"],
        knownPlatformSenders: ["notifications@wix-forms.com"],
        userEmailAddresses: ["jackson@canprodeckandrail.com"],
      },
    };

    const [firstResponse, concurrentResponse] = await Promise.all([
      importPOST(
        makeJsonRequest(
          "https://ops.test/api/integrations/email/import",
          payload
        ) as never
      ),
      importPOST(
        makeJsonRequest(
          "https://ops.test/api/integrations/email/import",
          payload
        ) as never
      ),
    ]);

    expect(firstResponse.status).toBe(200);
    expect(concurrentResponse.status).toBe(200);
    await flushAfterCallbacks();

    expect(createOpportunityMock).toHaveBeenCalledTimes(2);
    expect(createOpportunityMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sourceThreadKey: "email:gmail:connection-1:message:msg-concurrent",
      })
    );
    expect(createOpportunityMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sourceThreadKey: "email:gmail:connection-1:message:msg-concurrent",
      })
    );
    expect(state.sourceKeyWinnerLookups).toContainEqual({
      company_id: "company-1",
      source_thread_key: "email:gmail:connection-1:message:msg-concurrent",
    });
    expect(state.clientMergeCalls).toEqual([
      expect.objectContaining({
        p_company_id: "company-1",
        p_winner_id: "client-winner",
        p_loser_id: "client-loser",
      }),
    ]);
    expect(createActivityMock).toHaveBeenCalledOnce();
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opp-winner",
        clientId: "client-winner",
        emailConnectionId: "connection-1",
        emailThreadId: "gmail-thread-shared",
        emailMessageId: "msg-concurrent",
      })
    );
    expect(createSubClientMock).toHaveBeenCalledTimes(2);
    expect(createSubClientMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client-loser" }),
      expect.anything()
    );
    expect(state.threadLinks).toHaveLength(0);
  });

  it("logs distinct form submissions even when both resolve to the same opportunity", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      correspondenceEvents: [],
      activityRows: [],
      opportunities: [
        {
          id: "opp-shared",
          company_id: "company-1",
          client_id: "client-shared",
        },
      ],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    createClientMock.mockResolvedValue({ id: "client-shared" });
    relationshipMatchMock.mockResolvedValue({
      action: "link",
      opportunityId: "opp-shared",
      clientId: "client-shared",
      reason: "Same verified customer",
      evidence: [],
    });
    createActivityMock.mockImplementation(async (payload) => {
      const id = `activity-${(state.activityRows ?? []).length + 1}`;
      state.activityRows ??= [];
      state.activityRows.push({
        id,
        company_id: payload.companyId,
        opportunity_id: payload.opportunityId,
        email_connection_id: payload.emailConnectionId,
        email_thread_id: payload.emailThreadId,
        email_message_id: payload.emailMessageId,
        type: payload.type,
      });
      return { id };
    });

    const formLead = (messageId: string) => ({
      id: `lead-${messageId}`,
      threadId: `contact-form-message:${messageId}`,
      providerThreadId: "gmail-thread-shared",
      clientName: "Sandra Dunford",
      clientEmail: "sandra@example.com",
      clientPhone: null,
      clientAddress: null,
      description: "Free quote request.",
      stage: "new_lead",
      estimatedValue: null,
      correspondenceCount: 1,
      outboundCount: 0,
      lastMessageDate: "2026-05-20T17:00:00.000Z",
      existingClientId: null,
      action: "create_new",
      mergeWithLeadId: null,
      title: null,
      actualCloseDate: null,
    });

    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [formLead("msg-1"), formLead("msg-2")],
        syncProfile: {
          companyDomains: ["canprodeckandrail.com"],
          knownPlatformSenders: ["notifications@wix-forms.com"],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(createActivityMock).toHaveBeenCalledTimes(2);
    expect(
      createActivityMock.mock.calls.map((call) => call[0].emailMessageId)
    ).toEqual(["msg-1", "msg-2"]);
  });

  it("skips import lifecycle events when provider thread ids are invalid", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      correspondenceEvents: [],
      connectionUpdates: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => []),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });

    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          {
            id: "lead-blank-thread",
            threadId: "   ",
            clientName: "Kara Beach",
            clientEmail: "kara.beach@example.com",
            clientPhone: null,
            clientAddress: "123 Cedar Street",
            description: "Deck quote request.",
            stage: "new_lead",
            estimatedValue: null,
            correspondenceCount: 1,
            outboundCount: 0,
            lastMessageDate: "2026-05-20T17:00:00.000Z",
            existingClientId: null,
            action: "create_new",
            mergeWithLeadId: null,
            title: "Need an estimate",
            actualCloseDate: null,
          },
        ],
        syncProfile: {
          estimateSubjectPatterns: ["estimate"],
          companyDomains: ["canprodeckandrail.com"],
          teamForwarders: [],
          knownPlatformSenders: [],
          formSubjectPatterns: [],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
          aiClassificationThreshold: 0.75,
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(createOpportunityMock).not.toHaveBeenCalled();
    expect(createActivityMock).not.toHaveBeenCalled();
    expect(state.threadLinks).toHaveLength(0);
    expect(state.correspondenceEvents).toHaveLength(0);
    expect(state.jobUpdates.at(-1)).toMatchObject({
      status: "import_error",
      progress: expect.objectContaining({
        stage: "import_error",
        processedLeads: 0,
      }),
      result: expect.objectContaining({
        errors: [expect.stringContaining("blank provider thread id")],
      }),
    });
    expect(state.jobUpdates.at(-1)).not.toMatchObject({
      status: "import_complete",
      progress: expect.objectContaining({ processedLeads: 1 }),
    });
    expect(state.connectionUpdates).not.toContainEqual(
      expect.objectContaining({
        sync_filters: expect.objectContaining({ importComplete: true }),
      })
    );
  });

  it("falls back to email identity when imported lead names are company or summary text", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    createClientMock.mockResolvedValue({ id: "client-kara" });
    createOpportunityMock.mockResolvedValue({ id: "opp-kara" });
    createActivityMock.mockResolvedValue({ id: "activity-kara" });

    const overlongSummary = `Canpro Deck and Rail Estimate ${"summary ".repeat(20)}`;
    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          {
            id: "lead-1",
            threadId: "thread-1",
            emails: [
              {
                id: "gmail-message-title-fallback",
                providerThreadId: "thread-1",
                from: "kara.beach@example.com",
                subject: "Estimate request",
                date: "2026-05-20T17:00:00.000Z",
                direction: "inbound",
              },
            ],
            clientName: "Canpro Deck and Rail",
            clientEmail: "kara.beach@example.com",
            clientPhone: null,
            clientAddress: null,
            description: "Customer requested an estimate.",
            stage: "new_lead",
            estimatedValue: null,
            correspondenceCount: 1,
            outboundCount: 0,
            lastMessageDate: "2026-05-20T17:00:00.000Z",
            existingClientId: null,
            action: "create_new",
            mergeWithLeadId: null,
            title: overlongSummary,
            actualCloseDate: null,
          },
        ],
        syncProfile: {
          estimateSubjectPatterns: ["estimate"],
          companyDomains: ["canprodeckandrail.com"],
          teamForwarders: [],
          knownPlatformSenders: ["notifications@wix-forms.com"],
          formSubjectPatterns: [],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
          aiClassificationThreshold: 0.75,
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    const payload = createOpportunityMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.title).toBe("Kara Beach — Estimate");
    expect(payload.title).not.toContain("Canpro");
    expect(payload.title).not.toContain("summary");
  });

  it.each(["discard_existing", "merge", "link", "create_subclient"])(
    "rejects a cross-company existingClientId before queuing the %s action",
    async (action) => {
      const state: ImportState = {
        jobUpdates: [],
        opportunityPatches: [],
        threadLinks: [],
        notifications: [],
        clientRows: [
          {
            id: "client-company-2",
            company_id: "company-2",
            deleted_at: null,
          },
        ],
      };
      getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
      getConnectionMock.mockResolvedValue({
        id: "connection-1",
        companyId: "company-1",
        provider: "gmail",
        email: "jackson@canprodeckandrail.com",
        syncFilters: {},
        opsLabelId: null,
      });

      const response = await importPOST(
        makeJsonRequest("https://ops.test/api/integrations/email/import", {
          connectionId: "connection-1",
          companyId: "company-1",
          leads: [
            {
              id: `lead-${action}`,
              threadId: `thread-${action}`,
              clientName: "Foreign Client",
              clientEmail: "foreign@example.com",
              clientPhone: null,
              clientAddress: null,
              description: "Must not cross the company boundary.",
              stage: "new_lead",
              estimatedValue: null,
              correspondenceCount: 1,
              outboundCount: 0,
              lastMessageDate: "2026-05-20T17:00:00.000Z",
              existingClientId: "client-company-2",
              action,
              mergeWithLeadId: null,
              title: null,
              actualCloseDate: null,
            },
          ],
          syncProfile: {},
        }) as never
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "One or more selected customers are unavailable",
      });
      expect(afterCallbacks).toHaveLength(0);
      expect(getProviderMock).not.toHaveBeenCalled();
      expect(createClientMock).not.toHaveBeenCalled();
      expect(createOpportunityMock).not.toHaveBeenCalled();
      expect(createSubClientMock).not.toHaveBeenCalled();
      expect(softDeleteClientMock).not.toHaveBeenCalled();
    }
  );

  it("creates a separate import lead when P3 relationship matching returns create_new for an existing client", async () => {
    const state: ImportState = {
      jobUpdates: [],
      opportunityPatches: [],
      threadLinks: [],
      notifications: [],
      clientRows: [
        {
          id: "client-existing",
          company_id: "company-1",
          deleted_at: null,
        },
      ],
      opportunities: [
        {
          id: "opp-open",
          company_id: "company-1",
          client_id: "client-existing",
          stage: "follow_up",
          deleted_at: null,
        },
      ],
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
      provider: "gmail",
      email: "jackson@canprodeckandrail.com",
      syncFilters: {},
      opsLabelId: null,
    });
    getProviderMock.mockReturnValue({
      listLabels: vi.fn(async () => [{ id: "label-1", name: "OPS Pipeline" }]),
      createLabel: vi.fn(),
      applyLabel: vi.fn(async () => undefined),
    });
    createOpportunityMock.mockResolvedValue({ id: "opp-new" });
    createActivityMock.mockResolvedValue({ id: "activity-new" });

    const response = await importPOST(
      makeJsonRequest("https://ops.test/api/integrations/email/import", {
        connectionId: "connection-1",
        companyId: "company-1",
        leads: [
          {
            id: "lead-new-job",
            threadId: "thread-new-job",
            emails: [
              {
                id: "gmail-message-new-job",
                providerThreadId: "thread-new-job",
                from: "mara.hill@example.com",
                subject: "Front gate quote request",
                date: "2026-05-20T17:00:00.000Z",
                direction: "inbound",
              },
            ],
            clientName: "Mara Hill",
            clientEmail: "mara.hill@example.com",
            clientPhone: null,
            clientAddress: "455 New Road",
            description: "Front gate quote request.",
            stage: "new_lead",
            estimatedValue: null,
            correspondenceCount: 1,
            outboundCount: 0,
            lastMessageDate: "2026-05-20T17:00:00.000Z",
            existingClientId: "client-existing",
            action: "link",
            mergeWithLeadId: null,
            title: "Need an estimate",
            actualCloseDate: null,
          },
        ],
        syncProfile: {
          estimateSubjectPatterns: ["estimate"],
          companyDomains: ["canprodeckandrail.com"],
          teamForwarders: [],
          knownPlatformSenders: [],
          formSubjectPatterns: [],
          userEmailAddresses: ["jackson@canprodeckandrail.com"],
          aiClassificationThreshold: 0.75,
        },
      }) as never
    );

    expect(response.status).toBe(200);
    await flushAfterCallbacks();

    expect(relationshipMatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-existing",
        providerThreadId: "thread-new-job",
      })
    );
    expect(createOpportunityMock).toHaveBeenCalledOnce();
    expect(createOpportunityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-existing",
        contactName: "Mara Hill",
        contactEmail: "mara.hill@example.com",
        sourceEmailId: "thread-new-job",
      })
    );
    expect(state.threadLinks).toEqual([
      expect.objectContaining({
        opportunity_id: "opp-new",
        thread_id: "thread-new-job",
        connection_id: "connection-1",
      }),
    ]);
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opp-new",
        clientId: "client-existing",
        emailThreadId: "thread-new-job",
      })
    );
    expect(state.threadLinks[0].opportunity_id).not.toBe("opp-open");
  });
});
