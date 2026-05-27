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
    getConnection: getConnectionMock,
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

import { POST as importPOST } from "@/app/api/integrations/email/import/route";
import { POST as webhookPOST } from "@/app/api/integrations/email-webhook/route";

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
}

function makeImportSupabaseDouble(state: ImportState) {
  class Query {
    private action: "select" | "insert" | "update" | "upsert" = "select";
    private payload: Record<string, unknown> | null = null;

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq() {
      return this;
    }

    ilike() {
      return this;
    }

    is() {
      return this;
    }

    in() {
      return this;
    }

    limit() {
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.action = "insert";
      this.payload = payload;
      if (this.table === "notifications") state.notifications.push(payload);
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      if (this.table === "gmail_scan_jobs") state.jobUpdates.push(payload);
      if (this.table === "opportunities")
        state.opportunityPatches.push(payload);
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      this.action = "upsert";
      this.payload = payload;
      if (this.table === "opportunity_email_threads")
        state.threadLinks.push(payload);
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
      return { data: null, error: null };
    }

    private result() {
      if (this.table === "clients") return { data: [], error: null };
      if (this.table === "opportunities") return { data: [], error: null };
      if (this.table === "activities") return { data: [], error: null };
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
  };
}

function makeWebhookSupabaseDouble(
  inserted: Array<Record<string, unknown>>,
  company: Record<string, unknown> = { id: "company-1" }
) {
  class Query {
    private action: "select" | "insert" = "select";
    private payload: Record<string, unknown> | null = null;

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    or() {
      return this;
    }

    limit() {
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.action = "insert";
      this.payload = payload;
      if (this.table === "opportunities") inserted.push(payload);
      return this;
    }

    private result() {
      if (this.table === "companies") {
        return { data: [company], error: null };
      }
      if (this.table === "opportunities" && this.action === "insert") {
        return { data: this.payload, error: null };
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
    };
    getServiceRoleClientMock.mockReturnValue(makeImportSupabaseDouble(state));
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
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

  it("creates webhook opportunity titles from sender identity, never the email subject", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    getServiceRoleClientMock.mockReturnValue(
      makeWebhookSupabaseDouble(inserted)
    );

    const response = await webhookPOST(
      makeJsonRequest("https://ops.test/api/integrations/email-webhook", {
        to: "leads-company@inbound.opsapp.co",
        from: "marcel.mercier@example.com",
        fromName: "Marcel Mercier",
        subject: "Canpro Deck and Rail Estimate",
        body: "We need roof deck work quoted.",
      }) as never
    );

    expect(response.status).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].title).toBe("Marcel Mercier — Email Inquiry");
    expect(inserted[0].title).not.toBe("Canpro Deck and Rail Estimate");
    expect(inserted[0].description).toBe("We need roof deck work quoted.");
  });

  it("filters company identity in webhook titles instead of using the subject", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    getServiceRoleClientMock.mockReturnValue(
      makeWebhookSupabaseDouble(inserted, {
        id: "company-1",
        name: "North Ridge Exteriors",
        email: "operator@north-ridge.test",
        website: "https://north-ridge.test",
      })
    );

    const response = await webhookPOST(
      makeJsonRequest("https://ops.test/api/integrations/email-webhook", {
        to: "leads-company@inbound.opsapp.co",
        from: "North Ridge Exteriors <hello@north-ridge.test>",
        fromName: "North Ridge Exteriors",
        subject: "Mara Hill deck estimate",
        body: "Forwarded lead without a reliable submitter identity.",
      }) as never
    );

    expect(response.status).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].title).toBe("New Lead — Email Inquiry");
    expect(inserted[0].title).not.toContain("North Ridge");
    expect(inserted[0].title).not.toContain("Mara Hill");
  });
});
