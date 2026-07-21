import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import {
  SyncTokenExpiredError,
  type NormalizedEmail,
} from "@/lib/api/services/email-provider";
import type { EmailConnection } from "@/lib/types/email-connection";
import { buildEmailOpportunityTitle } from "@/lib/email/opportunity-title";

const {
  getConnectionMock,
  getProviderMock,
  updateConnectionMock,
  matchMock,
  buildBlocklistMock,
  shouldFilterMock,
  reviewUnmatchedEmailsMock,
  evaluateStagesWithSummaryMock,
  upsertFromEmailMock,
  classifyAndUpdateMock,
  afterMock,
  enqueueIfEnabledMock,
} = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  updateConnectionMock: vi.fn(),
  matchMock: vi.fn(),
  buildBlocklistMock: vi.fn(),
  shouldFilterMock: vi.fn(),
  reviewUnmatchedEmailsMock: vi.fn(),
  evaluateStagesWithSummaryMock: vi.fn(),
  upsertFromEmailMock: vi.fn(),
  classifyAndUpdateMock: vi.fn(),
  afterMock: vi.fn(),
  enqueueIfEnabledMock: vi.fn(async () => ({
    enqueued: true,
    jobId: "learning-job-test",
  })),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
    updateConnection: updateConnectionMock,
  },
}));

vi.mock("@/lib/api/services/email-matching-service-v2", () => ({
  EmailMatchingServiceV2: {
    match: matchMock,
  },
}));

vi.mock("@/lib/api/services/email-filter-service", () => ({
  EmailFilterService: {
    buildBlocklist: buildBlocklistMock,
    shouldFilter: shouldFilterMock,
  },
}));

vi.mock("@/lib/api/services/ai-sync-reviewer", () => ({
  AISyncReviewer: {
    reviewUnmatchedEmails: reviewUnmatchedEmailsMock,
    evaluateStagesWithSummary: evaluateStagesWithSummaryMock,
  },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    upsertFromEmail: upsertFromEmailMock,
    classifyAndUpdate: classifyAndUpdateMock,
  },
}));

vi.mock("@/lib/api/services/autonomy-milestone-service", () => ({
  AutonomyMilestoneService: {
    checkMilestonesAfterSync: vi.fn(),
  },
}));

vi.mock("@/lib/api/services/email-outbound-learning-service", () => ({
  EmailOutboundLearningService: class {
    enqueueIfEnabled = enqueueIfEnabledMock;
  },
}));

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: afterMock,
  };
});

import { SyncEngine } from "@/lib/api/services/sync-engine";

interface SupabaseState {
  clients: Array<Record<string, unknown>>;
  subClients?: Array<Record<string, unknown>>;
  opportunities: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  threadLinks: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
  correspondenceEvents?: Array<Record<string, unknown>>;
  lifecycleStateUpserts?: Array<Record<string, unknown>>;
  stageTransitions?: Array<Record<string, unknown>>;
  rpcCalls?: Array<{ name: string; params: Record<string, unknown> }>;
  syncLockResult?: unknown;
  syncLockError?: string;
  activityInsertError?: string;
  opportunityStageUpdateError?: string;
  opportunityEnrichmentUpdateError?: string;
  correspondenceEventInsertError?: string;
  correspondenceProjectionError?: string;
  opportunityInsertError?: { code: string; message: string };
  correspondenceProjectionApplications?: number;
  activityClaimCasMiss?: boolean;
  clientUpdateIds?: string[];
  subClientInsertFailuresRemaining?: number;
  threadLinkReadError?: string;
  threadClaimWinnerId?: string;
  estimatedValueUpdateFailuresRemaining?: number;
  provenanceUpserts?: Array<Record<string, unknown>>;
}

function makeSupabaseDouble(state: SupabaseState) {
  class Query {
    private action: "select" | "insert" | "update" | "upsert" = "select";
    private payload: Record<string, unknown> | null = null;
    private filters = new Map<string, unknown>();

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    ilike(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    like(column: string, value: unknown) {
      this.filters.set(`${column}:like`, value);
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    or() {
      return this;
    }

    not(column: string, operator: string, value: unknown) {
      this.filters.set(`${column}:${operator}`, value);
      return this;
    }

    lte(column: string, value: unknown) {
      this.filters.set(`${column}:lte`, value);
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
      if (this.table === "clients") {
        const row = { id: `client-${state.clients.length + 1}`, ...payload };
        state.clients.push(row);
      }
      if (this.table === "opportunities") {
        if (!state.opportunityInsertError) {
          const row = {
            id: `opp-${state.opportunities.length + 1}`,
            created_at: "2026-05-20T00:00:00.000Z",
            updated_at: "2026-05-20T00:00:00.000Z",
            stage_entered_at: "2026-05-20T00:00:00.000Z",
            correspondence_count: 0,
            inbound_count: 0,
            outbound_count: 0,
            ...payload,
          };
          state.opportunities.push(row);
        }
      }
      if (this.table === "sub_clients") {
        if ((state.subClientInsertFailuresRemaining ?? 0) === 0) {
          state.subClients ??= [];
          state.subClients.push({
            id: `sub-client-${state.subClients.length + 1}`,
            ...payload,
          });
        }
      }
      if (this.table === "activities") {
        if (!state.activityInsertError) {
          state.activities.push({
            id: `activity-${state.activities.length + 1}`,
            ...payload,
          });
        }
      }
      if (this.table === "opportunity_correspondence_events") {
        if (!state.correspondenceEventInsertError) {
          const row = {
            id: `event-${(state.correspondenceEvents ?? []).length + 1}`,
            ...payload,
          };
          state.correspondenceEvents ??= [];
          state.correspondenceEvents.push(row);
        }
      }
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      if (this.table === "opportunities") {
        const id = this.filters.get("id");
        const row = state.opportunities.find((opp) => opp.id === id);
        const isEnrichmentUpdate = [
          "contact_name",
          "contact_email",
          "contact_phone",
          "address",
        ].some((field) => field in payload);
        if (
          row &&
          !(state.opportunityStageUpdateError && "stage" in payload) &&
          !(state.opportunityEnrichmentUpdateError && isEnrichmentUpdate) &&
          !(
            (state.estimatedValueUpdateFailuresRemaining ?? 0) > 0 &&
            "estimated_value" in payload
          )
        ) {
          Object.assign(row, payload);
        }
      }
      if (this.table === "clients") {
        const id = this.filters.get("id");
        const row = state.clients.find((client) => client.id === id);
        if (row) Object.assign(row, payload);
      }
      return this;
    }

    upsert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
      this.action = "upsert";
      if (Array.isArray(payload)) {
        if (this.table === "lead_field_provenance") {
          state.provenanceUpserts ??= [];
          state.provenanceUpserts.push(...payload);
        }
        return this;
      }
      this.payload = payload;
      if (this.table === "opportunity_email_threads") {
        if (state.threadClaimWinnerId) {
          const alreadyClaimed = state.threadLinks.some(
            (link) =>
              link.thread_id === payload.thread_id &&
              link.connection_id === payload.connection_id
          );
          if (!alreadyClaimed) {
            state.threadLinks.push({
              opportunity_id: state.threadClaimWinnerId,
              thread_id: payload.thread_id,
              connection_id: payload.connection_id,
            });
          }
          state.threadClaimWinnerId = undefined;
        }
        const exists = state.threadLinks.some(
          (link) =>
            link.thread_id === payload.thread_id &&
            link.connection_id === payload.connection_id
        );
        if (!exists) state.threadLinks.push(payload);
      }
      if (this.table === "opportunity_lifecycle_state") {
        state.lifecycleStateUpserts ??= [];
        state.lifecycleStateUpserts.push(payload);
      }
      return this;
    }

    async single() {
      if (this.table === "clients" && this.action === "insert") {
        return { data: state.clients.at(-1), error: null };
      }
      if (this.table === "opportunities" && this.action === "insert") {
        if (state.opportunityInsertError) {
          return { data: null, error: state.opportunityInsertError };
        }
        return { data: state.opportunities.at(-1), error: null };
      }
      if (this.table === "activities" && this.action === "insert") {
        if (state.activityInsertError) {
          return {
            data: null,
            error: { message: state.activityInsertError },
          };
        }
        return { data: state.activities.at(-1), error: null };
      }
      if (
        this.table === "opportunity_correspondence_events" &&
        this.action === "insert"
      ) {
        if (state.correspondenceEventInsertError) {
          return {
            data: null,
            error: { message: state.correspondenceEventInsertError },
          };
        }
        return {
          data: state.correspondenceEvents?.at(-1) ?? null,
          error: null,
        };
      }
      if (this.table === "companies") {
        return {
          data: { name: "Canpro Deck and Rail", industry: "deck and rail" },
          error: null,
        };
      }
      if (this.table === "opportunities" && this.action === "select") {
        const rows = this.result().data as unknown[] | null;
        return { data: rows?.[0] ?? null, error: null };
      }
      return { data: null, error: null };
    }

    async maybeSingle() {
      if (this.table === "companies") {
        return {
          data: {
            id: "company-1",
            name: "Canpro Deck and Rail",
            email: "jackson@canprodeckandrail.com",
            phone: null,
            address: null,
          },
          error: null,
        };
      }
      if (this.table === "clients") {
        const id = this.filters.get("id");
        const client = state.clients.find((row) => row.id === id) ?? null;
        return { data: client, error: null };
      }
      if (this.table === "opportunities") {
        return {
          data: (this.result().data as unknown[] | null)?.[0] ?? null,
          error: null,
        };
      }
      if (this.table === "projects") {
        return {
          data: (this.result().data as unknown[] | null)?.[0] ?? null,
          error: null,
        };
      }
      return { data: null, error: null };
    }

    private result() {
      if (this.table === "activities" && this.action === "update") {
        const row = state.activities.find((activity) => {
          for (const [column, value] of this.filters.entries()) {
            if (column.endsWith(":like")) continue;
            if (value === null) {
              if (activity[column] != null) return false;
              continue;
            }
            if (activity[column] !== value) return false;
          }
          return true;
        });
        if (!row || state.activityClaimCasMiss) {
          return { data: [], error: null };
        }
        if (this.payload) Object.assign(row, this.payload);
        return { data: [{ id: row.id, ...this.payload }], error: null };
      }

      if (this.table === "email_connections" && this.action === "update") {
        return {
          data: [{ id: this.filters.get("id") ?? "connection-1" }],
          error: null,
        };
      }

      if (this.table === "activities" && this.action === "select") {
        const match = state.activities.filter((activity) => {
          for (const [column, value] of this.filters.entries()) {
            if (column.endsWith(":like")) {
              const col = column.slice(0, -":like".length);
              const pattern = String(value ?? "");
              const prefix = pattern.endsWith("%")
                ? pattern.slice(0, -1)
                : pattern;
              if (!String(activity[col] ?? "").startsWith(prefix)) {
                return false;
              }
              continue;
            }
            const activityValue =
              column === "company_id" && activity[column] == null
                ? "company-1"
                : activity[column];
            if (
              String(activityValue ?? "").toLowerCase() !==
              String(value ?? "").toLowerCase()
            ) {
              return false;
            }
          }
          return true;
        });
        return {
          data: match.map((activity) => ({
            ...activity,
            email_connection_id:
              "email_connection_id" in activity
                ? activity.email_connection_id
                : "connection-1",
          })),
          error: null,
        };
      }

      if (
        this.table === "opportunity_correspondence_events" &&
        this.action === "select"
      ) {
        const match = (state.correspondenceEvents ?? []).filter((event) => {
          for (const [column, value] of this.filters.entries()) {
            if (
              String(event[column] ?? "").toLowerCase() !==
              String(value ?? "").toLowerCase()
            ) {
              return false;
            }
          }
          return true;
        });
        return { data: match, error: null };
      }

      if (this.table === "clients" && this.action === "select") {
        const match = state.clients.filter((client) => {
          for (const [column, value] of this.filters.entries()) {
            if (column === "deleted_at") continue;
            if (
              String(client[column] ?? "").toLowerCase() !==
              String(value ?? "").toLowerCase()
            ) {
              return false;
            }
          }
          return true;
        });
        return { data: match, error: null };
      }

      if (
        this.table === "clients" &&
        this.action === "update" &&
        this.payload
      ) {
        const id = this.filters.get("id");
        if (typeof id === "string") state.clientUpdateIds?.push(id);
        const row = state.clients.find((client) => client.id === id);
        if (row) Object.assign(row, this.payload);
        return { data: null, error: null };
      }

      if (this.table === "users" && this.action === "select") {
        return {
          data: [
            {
              email: "jackson@canprodeckandrail.com",
              phone: null,
            },
          ],
          error: null,
        };
      }

      if (this.table === "sub_clients" && this.action === "select") {
        const match = (state.subClients ?? []).filter((subClient) => {
          for (const [column, value] of this.filters.entries()) {
            if (column === "deleted_at") continue;
            if (
              String(subClient[column] ?? "").toLowerCase() !==
              String(value ?? "").toLowerCase()
            ) {
              return false;
            }
          }
          return true;
        });
        return { data: match, error: null };
      }

      if (this.table === "opportunities" && this.action === "select") {
        const match = state.opportunities.filter((opportunity) => {
          for (const [column, value] of this.filters.entries()) {
            if (column === "deleted_at" && value === null) {
              if (opportunity.deleted_at) return false;
              continue;
            }
            if (column === "archived_at" && value === null) {
              if (opportunity.archived_at) return false;
              continue;
            }
            if (column.includes(":")) continue;
            const opportunityValue =
              column === "company_id" && opportunity[column] == null
                ? "company-1"
                : opportunity[column];
            if (
              String(opportunityValue ?? "").toLowerCase() !==
              String(value ?? "").toLowerCase()
            ) {
              return false;
            }
          }
          return true;
        });
        return {
          data: match.map((opportunity) => ({
            company_id: "company-1",
            ...opportunity,
          })),
          error: null,
        };
      }

      if (
        this.table === "opportunities" &&
        this.action === "update" &&
        this.payload &&
        "stage" in this.payload &&
        state.opportunityStageUpdateError
      ) {
        return {
          data: null,
          error: { message: state.opportunityStageUpdateError },
        };
      }

      if (
        this.table === "opportunities" &&
        this.action === "update" &&
        this.payload &&
        "estimated_value" in this.payload &&
        (state.estimatedValueUpdateFailuresRemaining ?? 0) > 0
      ) {
        state.estimatedValueUpdateFailuresRemaining! -= 1;
        return {
          data: null,
          error: { message: "AI supplemental enrichment unavailable" },
        };
      }

      if (
        this.table === "opportunities" &&
        this.action === "update" &&
        this.payload &&
        state.opportunityEnrichmentUpdateError &&
        ["contact_name", "contact_email", "contact_phone", "address"].some(
          (field) => field in this.payload!
        )
      ) {
        return {
          data: null,
          error: { message: state.opportunityEnrichmentUpdateError },
        };
      }

      if (
        this.table === "opportunities" &&
        this.action === "update" &&
        this.payload
      ) {
        const id = this.filters.get("id");
        const row = state.opportunities.find(
          (opportunity) => opportunity.id === id
        );
        if (row) Object.assign(row, this.payload);
        return { data: null, error: null };
      }

      if (this.table === "projects" && this.action === "select") {
        const match = (state.projects ?? []).filter((project) => {
          for (const [column, value] of this.filters.entries()) {
            if (column === "deleted_at" && value === null) {
              if (project.deleted_at) return false;
              continue;
            }
            if (
              String(project[column] ?? "").toLowerCase() !==
              String(value ?? "").toLowerCase()
            ) {
              return false;
            }
          }
          return true;
        });
        return { data: match, error: null };
      }

      if (
        this.table === "opportunity_email_threads" &&
        this.action === "select"
      ) {
        if (state.threadLinkReadError) {
          return {
            data: null,
            error: { message: state.threadLinkReadError },
          };
        }
        const threadId = this.filters.get("thread_id");
        const connectionId = this.filters.get("connection_id");
        const matches = state.threadLinks.filter(
          (link) =>
            link.thread_id === threadId && link.connection_id === connectionId
        );
        return { data: matches, error: null };
      }

      if (this.table === "sub_clients" && this.action === "insert") {
        if ((state.subClientInsertFailuresRemaining ?? 0) > 0) {
          state.subClientInsertFailuresRemaining! -= 1;
          return {
            data: null,
            error: { message: "sub-client write unavailable" },
          };
        }
        return { data: state.subClients?.at(-1) ?? null, error: null };
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
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === "acquire_email_connection_sync_lock_as_system") {
        if (state.syncLockError) {
          return { data: null, error: { message: state.syncLockError } };
        }
        return {
          data: Object.prototype.hasOwnProperty.call(state, "syncLockResult")
            ? state.syncLockResult
            : "00000000-0000-4000-8000-000000000001",
          error: null,
        };
      }
      state.rpcCalls?.push({ name, params });
      if (
        name === "apply_email_opportunity_stage_transition" &&
        state.opportunityStageUpdateError
      ) {
        return {
          data: null,
          error: { message: state.opportunityStageUpdateError },
        };
      }
      if (name === "apply_email_opportunity_stage_transition") {
        const opportunity = state.opportunities.find(
          (row) => row.id === params.p_opportunity_id
        );
        if (!opportunity) {
          return { data: null, error: { message: "opportunity_not_found" } };
        }
        const fromStage = String(opportunity.stage ?? "new_lead");
        const changed =
          !opportunity.stage_manually_set &&
          !["won", "lost", "discarded"].includes(fromStage) &&
          fromStage !== params.p_to_stage;
        if (changed) {
          opportunity.stage = params.p_to_stage;
          opportunity.stage_entered_at = "2026-05-20T17:00:01.000Z";
          state.stageTransitions ??= [];
          state.stageTransitions.push({
            company_id: params.p_company_id,
            opportunity_id: params.p_opportunity_id,
            from_stage: fromStage,
            to_stage: params.p_to_stage,
          });
        }
        return {
          data: [
            {
              changed,
              stage: opportunity.stage,
              stage_manually_set: Boolean(opportunity.stage_manually_set),
            },
          ],
          error: null,
        };
      }
      if (
        name === "apply_opportunity_correspondence_event" &&
        state.correspondenceProjectionError
      ) {
        return {
          data: null,
          error: { message: state.correspondenceProjectionError },
        };
      }
      if (name === "apply_opportunity_correspondence_event") {
        const event = (state.correspondenceEvents ?? []).find(
          (row) =>
            row.company_id === params.p_company_id &&
            row.connection_id === params.p_connection_id &&
            row.provider_message_id === params.p_provider_message_id
        );
        if (event && !event.opportunity_projection_applied) {
          const opportunity = state.opportunities.find(
            (row) => row.id === params.p_opportunity_id
          );
          if (opportunity) {
            opportunity.correspondence_count =
              Number(opportunity.correspondence_count ?? 0) + 1;
            if (event.direction === "inbound") {
              opportunity.inbound_count =
                Number(opportunity.inbound_count ?? 0) + 1;
            } else {
              opportunity.outbound_count =
                Number(opportunity.outbound_count ?? 0) + 1;
            }
          }
          event.opportunity_projection_applied = true;
          state.correspondenceProjectionApplications =
            (state.correspondenceProjectionApplications ?? 0) + 1;
        }
      }
      return {
        data: [
          {
            correspondence_count: 2,
            inbound_count: 2,
            outbound_count: 0,
            stage: "new_lead",
            stage_manually_set: false,
            last_inbound_at: "2026-05-20T17:00:00.000Z",
            last_outbound_at: null,
            last_message_direction: "in",
          },
        ],
        error: null,
      };
    }),
  };
}

function baseConnection(
  overrides: Partial<EmailConnection> = {}
): EmailConnection {
  return {
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
    type: "company",
    userId: null,
    email: "jackson@canprodeckandrail.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2026-05-21T00:00:00.000Z"),
    historyId: "sync-token",
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 15,
    syncFilters: {
      includeSentMail: true,
      estimateSubjectPatterns: ["estimate"],
      companyDomains: ["canprodeckandrail.com"],
      teamForwarders: ["jackson@canprodeckandrail.com"],
    },
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: new Date("2026-05-20T00:00:00.000Z"),
    updatedAt: new Date("2026-05-20T00:00:00.000Z"),
    ...overrides,
  };
}

function baseEmail(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    id: "msg-1",
    threadId: "thread-1",
    from: "Jackson Sweet <jackson@canprodeckandrail.com>",
    fromName: "Jackson Sweet",
    to: ["Kara Beach <kara.beach@example.com>"],
    cc: [],
    subject: "Canpro Deck and Rail Estimate",
    snippet: "Estimate attached.",
    bodyText: "Estimate attached.",
    date: new Date("2026-05-20T17:00:00.000Z"),
    labelIds: ["SENT"],
    isRead: true,
    hasAttachments: false,
    sizeEstimate: 1200,
    ...overrides,
  };
}

const contactFormBody = `Begin forwarded message:

From: Canpro Deck and Rail <notifications@wix-forms.com>
Reply-To: "Marcel Mercier" <marcel.mercier@example.com>
Subject: Contact Us 3 got a new submission

Submission summary:

Full Name:
Marcel Mercier

Company:
Mercier Holdings

Phone:
12505388340

Email:
marcel.mercier@example.com

Address:
1220 Wharf Street, Victoria BC

Budget:
$18,500

How can we help?:
We need someone to renovate and replace two roof decks.`;

describe("SyncEngine email opportunity title generation", () => {
  beforeEach(() => {
    getConnectionMock.mockReset();
    getProviderMock.mockReset();
    updateConnectionMock.mockReset();
    matchMock.mockReset();
    buildBlocklistMock.mockResolvedValue({});
    shouldFilterMock.mockReturnValue(false);
    reviewUnmatchedEmailsMock.mockResolvedValue({
      classifiedLeads: [],
      newLeadsClassified: 0,
    });
    evaluateStagesWithSummaryMock.mockResolvedValue([]);
    upsertFromEmailMock.mockReset();
    classifyAndUpdateMock.mockReset();
    classifyAndUpdateMock.mockImplementation(async (thread) => thread);
    afterMock.mockReset();
    enqueueIfEnabledMock.mockClear();
    enqueueIfEnabledMock.mockResolvedValue({
      enqueued: true,
      jobId: "learning-job-test",
    });
    upsertFromEmailMock.mockResolvedValue({
      isNew: false,
      threadRow: {
        id: "email-thread-1",
        categoryConfidence: 1,
        categoryManuallySet: true,
        categoryClassifiedAt: new Date("2026-05-20T16:00:00.000Z"),
      },
    });
  });

  afterEach(() => {
    setSupabaseOverride(null);
  });

  it("skips the cycle when another worker owns the sync lease", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
      syncLockResult: null,
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);
    getConnectionMock.mockResolvedValue(baseConnection());
    const fetchNewEmailsSince = vi.fn();
    getProviderMock.mockReturnValue({ fetchNewEmailsSince });

    await expect(SyncEngine.runSync("connection-1")).resolves.toMatchObject({
      errors: ["Sync already in progress for this connection"],
    });
    expect(fetchNewEmailsSince).not.toHaveBeenCalled();
  });

  it("fails closed when the database cannot claim the sync lease", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
      syncLockError: "lock RPC unavailable",
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({});

    await expect(SyncEngine.runSync("connection-1")).rejects.toThrow(
      "[sync-engine] acquireSyncLock failed: lock RPC unavailable"
    );
  });

  it("fails closed when the sync lease claim returns an invalid owner", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
      syncLockResult: { owner: "not-a-scalar-uuid" },
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({});

    await expect(SyncEngine.runSync("connection-1")).rejects.toThrow(
      "[sync-engine] acquireSyncLock returned an invalid owner"
    );
  });

  it("uses the external recipient display name for sent-folder safety-net opportunities", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [baseEmail()],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0].title).toBe("Kara Beach — Estimate");
    expect(state.opportunities[0]).toMatchObject({
      contact_name: "Kara Beach",
      contact_email: "kara.beach@example.com",
      source_email_id: "thread-1",
      source_thread_key: "email:gmail:connection-1:thread:thread-1",
      source: "email",
    });
    expect(state.clients[0]).toMatchObject({
      name: "Kara Beach",
      email: "kara.beach@example.com",
    });
    expect(state.opportunities[0].title).not.toContain("Jackson Sweet");
  });

  it("persists a fresh AI-classified lead under the scoped source key and projects its first message exactly once", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
      correspondenceProjectionApplications: 0,
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const aiEmail = baseEmail({
      id: "msg-ai-fresh",
      threadId: "thread-ai-fresh",
      from: "Avery Stone <avery@example.com>",
      fromName: "Avery Stone",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Back deck replacement",
      bodyText: "We need to replace the back deck this fall.",
      snippet: "We need to replace the back deck this fall.",
      labelIds: ["INBOX"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [aiEmail],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });
    reviewUnmatchedEmailsMock.mockResolvedValue({
      classifiedLeads: [
        {
          email: aiEmail,
          clientName: "Avery Stone",
          clientEmail: "avery@example.com",
          clientPhone: null,
          address: null,
          description: "Back deck replacement",
          stage: "new_lead",
          estimatedValue: null,
          confidence: 0.94,
        },
      ],
      newLeadsClassified: 1,
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0]).toMatchObject({
      source_thread_key: "email:gmail:connection-1:thread:thread-ai-fresh",
      correspondence_count: 1,
      inbound_count: 1,
      outbound_count: 0,
    });
    expect(state.correspondenceProjectionApplications).toBe(1);
  });

  it("keeps the provider cursor unchanged when AI classification is incomplete", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const aiEmail = baseEmail({
      id: "msg-ai-incomplete",
      threadId: "thread-ai-incomplete",
      from: "Avery Stone <avery@example.com>",
      fromName: "Avery Stone",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Back deck request",
      bodyText: "We need help replacing our back deck.",
      snippet: "We need help replacing our back deck.",
      labelIds: ["INBOX"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [aiEmail],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    reviewUnmatchedEmailsMock.mockRejectedValue(
      new Error("classifier omitted input msg-ai-incomplete")
    );

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors.join(" ")).toContain(
      "classifier omitted input msg-ai-incomplete"
    );
    expect(state.opportunities).toEqual([]);
    expect(state.activities).toEqual([]);
    expect(updateConnectionMock).not.toHaveBeenCalled();
  });

  it("runs AI-classified leads through relationship matching before creating a second client or opportunity", async () => {
    const state: SupabaseState = {
      clients: [
        {
          id: "client-parent",
          company_id: "company-1",
          name: "Stone Holdings",
          email: "accounts@stone.example",
          deleted_at: null,
        },
      ],
      opportunities: [
        {
          id: "opp-existing",
          company_id: "company-1",
          client_id: "client-parent",
          stage: "new_lead",
          contact_email: "avery@example.com",
          contact_name: "Avery Stone",
          correspondence_count: 0,
          inbound_count: 0,
          outbound_count: 0,
          archived_at: null,
          deleted_at: null,
          created_at: "2026-05-19T00:00:00.000Z",
          updated_at: "2026-05-19T00:00:00.000Z",
        },
      ],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const aiEmail = baseEmail({
      id: "msg-ai-existing",
      threadId: "thread-ai-existing",
      from: "Avery Stone <avery@example.com>",
      fromName: "Avery Stone",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Back deck timing",
      bodyText: "Following up about the back deck timing.",
      snippet: "Following up about the back deck timing.",
      labelIds: ["INBOX"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [aiEmail],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });
    reviewUnmatchedEmailsMock.mockResolvedValue({
      classifiedLeads: [
        {
          email: aiEmail,
          clientName: "Avery Stone",
          clientEmail: "avery@example.com",
          clientPhone: null,
          address: null,
          description: "Back deck timing",
          stage: "qualifying",
          estimatedValue: null,
          confidence: 0.91,
        },
      ],
      newLeadsClassified: 1,
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(state.clients).toHaveLength(1);
    expect(state.opportunities).toHaveLength(1);
    expect(state.activities).toEqual([
      expect.objectContaining({
        opportunity_id: "opp-existing",
        email_message_id: "msg-ai-existing",
      }),
    ]);
    expect(state.threadLinks).toEqual([
      expect.objectContaining({
        opportunity_id: "opp-existing",
        thread_id: "thread-ai-existing",
      }),
    ]);
  });

  it("keeps AI fallback enrichment on the raw-thread opportunity's client when email matching suggests another client", async () => {
    const state: SupabaseState = {
      clients: [
        {
          id: "client-thread-owner",
          company_id: "company-1",
          name: null,
          email: null,
          deleted_at: null,
        },
        {
          id: "client-email-match",
          company_id: "company-1",
          name: "Wrong Suggested Client",
          email: "suggested@example.com",
          deleted_at: null,
        },
      ],
      opportunities: [
        {
          id: "opp-thread-owner",
          company_id: "company-1",
          client_id: "client-thread-owner",
          stage: "new_lead",
          contact_email: "avery@example.com",
          correspondence_count: 0,
          inbound_count: 0,
          outbound_count: 0,
          archived_at: null,
          deleted_at: null,
          created_at: "2026-05-19T00:00:00.000Z",
          updated_at: "2026-05-19T00:00:00.000Z",
        },
      ],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
      clientUpdateIds: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const aiEmail = baseEmail({
      id: "msg-ai-thread-owner",
      threadId: "thread-ai-owner",
      from: "Avery Stone <avery@example.com>",
      fromName: "Avery Stone",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Back deck timing",
      bodyText: "Following up about the back deck timing.",
      snippet: "Following up about the back deck timing.",
      labelIds: ["INBOX"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [aiEmail],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({
      action: "link",
      clientId: "client-email-match",
    });
    reviewUnmatchedEmailsMock.mockImplementation(async () => {
      // Simulate another sync linking the raw provider thread after the initial
      // unmatched pass but before AI fallback persistence.
      state.threadLinks.push({
        opportunity_id: "opp-thread-owner",
        thread_id: "thread-ai-owner",
        connection_id: "connection-1",
      });
      return {
        classifiedLeads: [
          {
            email: aiEmail,
            clientName: "Avery Stone",
            clientEmail: "avery@example.com",
            clientPhone: null,
            address: null,
            description: "Back deck timing",
            stage: "qualifying",
            estimatedValue: null,
            confidence: 0.93,
          },
        ],
        newLeadsClassified: 1,
      };
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(matchMock).toHaveBeenCalledWith(
      "company-1",
      "avery@example.com",
      expect.objectContaining({
        threadId: "thread-ai-owner",
        connectionId: "connection-1",
      })
    );
    expect(state.opportunities).toHaveLength(1);
    expect(state.activities).toEqual([
      expect.objectContaining({ opportunity_id: "opp-thread-owner" }),
    ]);
    expect(state.clientUpdateIds).toContain("client-thread-owner");
    expect(state.clientUpdateIds).not.toContain("client-email-match");
  });

  it("keeps deterministic customer identity authoritative when the AI classifier returns operator details", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const aiEmail = baseEmail({
      id: "msg-ai-identity-guard",
      threadId: "thread-ai-identity-guard",
      from: "Avery Stone <avery@example.com>",
      fromName: "Avery Stone",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Back deck request",
      bodyText: "We need help replacing our back deck.",
      snippet: "We need help replacing our back deck.",
      labelIds: ["INBOX"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [aiEmail],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });
    reviewUnmatchedEmailsMock.mockResolvedValue({
      classifiedLeads: [
        {
          email: aiEmail,
          clientName: "Jackson Sweet",
          clientEmail: "jackson@canprodeckandrail.com",
          clientPhone: "2505388994",
          address: "Operator office",
          description: "Model summary",
          stage: "new_lead",
          estimatedValue: 4200,
          confidence: 0.96,
        },
      ],
      newLeadsClassified: 1,
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(matchMock).toHaveBeenCalledWith(
      "company-1",
      "avery@example.com",
      expect.objectContaining({ name: "Avery Stone" })
    );
    expect(state.clients[0]).toMatchObject({
      name: "Avery Stone",
      email: "avery@example.com",
    });
    expect(state.clients[0]).not.toMatchObject({ phone_number: "2505388994" });
    expect(state.opportunities[0]).toMatchObject({
      contact_name: "Avery Stone",
      contact_email: "avery@example.com",
      estimated_value: 4200,
    });
    expect(state.opportunities[0].contact_phone).not.toBe("2505388994");
    expect(state.opportunities[0].address).not.toBe("Operator office");
  });

  it("does not overwrite provenance with a resolved value the canonical lead rejected", async () => {
    const state: SupabaseState = {
      clients: [
        {
          id: "client-provenance",
          company_id: "company-1",
          name: "Avery Stone",
          email: "avery@example.com",
          phone_number: "12505550000",
          address: null,
        },
      ],
      opportunities: [
        {
          id: "opp-provenance",
          company_id: "company-1",
          client_id: "client-provenance",
          title: "Avery Stone — Deck repair",
          stage: "qualifying",
          archived_at: null,
          deleted_at: null,
          contact_name: "Avery Stone",
          contact_email: "avery@example.com",
          contact_phone: "12505550000",
          address: null,
          description: "Repair the back deck.",
          source_email_id: "thread-provenance",
        },
      ],
      threadLinks: [],
      activities: [
        {
          id: "activity-provenance-replay",
          company_id: "company-1",
          email_connection_id: "connection-1",
          email_message_id: "msg-provenance-candidate",
          email_thread_id: "thread-provenance",
          opportunity_id: "opp-provenance",
          direction: "inbound",
        },
      ],
      provenanceUpserts: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const inbound = baseEmail({
      id: "msg-provenance-candidate",
      threadId: "thread-provenance",
      from: "Avery Stone <avery@example.com>",
      fromName: "Avery Stone",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Re: Deck repair",
      bodyText: "You can also reach me at 250-555-1111.",
      snippet: "You can also reach me at 250-555-1111.",
      labelIds: ["INBOX"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [inbound],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({
      action: "link",
      clientId: "client-provenance",
      confidence: "exact",
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(state.opportunities[0].contact_phone).toBe("12505550000");
    expect(state.clients[0].phone_number).toBe("12505550000");
    expect(state.provenanceUpserts).toEqual([]);
  });

  it("retries AI-only supplemental enrichment before publishing a thread or activity checkpoint", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
      estimatedValueUpdateFailuresRemaining: 1,
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const aiEmail = baseEmail({
      id: "msg-ai-enrichment-retry",
      threadId: "thread-ai-enrichment-retry",
      from: "Avery Stone <avery@example.com>",
      fromName: "Avery Stone",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Back deck request",
      bodyText: "We need help replacing our back deck.",
      snippet: "We need help replacing our back deck.",
      labelIds: ["INBOX"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [aiEmail],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock
      .mockResolvedValueOnce({ action: "create_new", clientId: null })
      .mockResolvedValue({ action: "link", clientId: "client-1" });
    reviewUnmatchedEmailsMock.mockResolvedValue({
      classifiedLeads: [
        {
          email: aiEmail,
          clientName: "Avery Stone",
          clientEmail: "avery@example.com",
          clientPhone: null,
          address: null,
          description: "Back deck replacement",
          stage: "new_lead",
          estimatedValue: 7800,
          confidence: 0.92,
        },
      ],
      newLeadsClassified: 1,
    });

    const failed = await SyncEngine.runSync("connection-1");

    expect(failed.errors.join(" ")).toContain(
      "AI supplemental enrichment unavailable"
    );
    expect(state.activities).toHaveLength(0);
    expect(state.threadLinks).toHaveLength(0);
    expect(state.opportunities[0].estimated_value).toBeUndefined();
    expect(updateConnectionMock).not.toHaveBeenCalled();

    const repaired = await SyncEngine.runSync("connection-1");

    expect(repaired.errors).toEqual([]);
    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0].estimated_value).toBe(7800);
    expect(state.threadLinks).toEqual([
      expect.objectContaining({
        opportunity_id: state.opportunities[0].id,
        thread_id: "thread-ai-enrichment-retry",
      }),
    ]);
    expect(state.activities).toEqual([
      expect.objectContaining({
        opportunity_id: state.opportunities[0].id,
        email_message_id: "msg-ai-enrichment-retry",
      }),
    ]);
  });

  it("retries a required sub-client write before publishing a thread or activity checkpoint", async () => {
    const state: SupabaseState = {
      clients: [
        {
          id: "client-parent",
          company_id: "company-1",
          name: "Stone Holdings",
          email: "accounts@stone.example",
          deleted_at: null,
        },
      ],
      subClients: [],
      opportunities: [
        {
          id: "opp-parent",
          company_id: "company-1",
          client_id: "client-parent",
          stage: "new_lead",
          contact_email: "avery@stone.example",
          correspondence_count: 0,
          inbound_count: 0,
          outbound_count: 0,
          archived_at: null,
          deleted_at: null,
          created_at: "2026-05-19T00:00:00.000Z",
          updated_at: "2026-05-19T00:00:00.000Z",
        },
      ],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
      subClientInsertFailuresRemaining: 1,
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const email = baseEmail({
      id: "msg-subclient-retry",
      threadId: "thread-subclient-retry",
      from: "Avery Stone <avery@stone.example>",
      fromName: "Avery Stone",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Estimate follow-up",
      bodyText: "Following up on the estimate.",
      snippet: "Following up on the estimate.",
      labelIds: ["INBOX"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [email],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({
      action: "create_subclient",
      clientId: "client-parent",
    });

    const failed = await SyncEngine.runSync("connection-1");

    expect(failed.errors.join(" ")).toContain("sub-client write unavailable");
    expect(state.subClients).toHaveLength(0);
    expect(state.threadLinks).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
    expect(updateConnectionMock).not.toHaveBeenCalled();

    const repaired = await SyncEngine.runSync("connection-1");

    expect(repaired.errors).toEqual([]);
    expect(state.subClients).toEqual([
      expect.objectContaining({
        client_id: "client-parent",
        name: "Avery Stone",
        email: "avery@stone.example",
      }),
    ]);
    expect(state.threadLinks).toHaveLength(1);
    expect(state.activities).toHaveLength(1);
  });

  it("never rewrites a provider thread claimed by a concurrent opportunity", async () => {
    const state: SupabaseState = {
      clients: [
        {
          id: "client-b",
          company_id: "company-1",
          email: "avery@example.com",
          deleted_at: null,
        },
      ],
      opportunities: [
        {
          id: "opp-a",
          company_id: "company-1",
          client_id: null,
          stage: "new_lead",
          deleted_at: null,
        },
        {
          id: "opp-b",
          company_id: "company-1",
          client_id: "client-b",
          stage: "new_lead",
          contact_email: "avery@example.com",
          archived_at: null,
          deleted_at: null,
          created_at: "2026-05-19T00:00:00.000Z",
          updated_at: "2026-05-19T00:00:00.000Z",
        },
      ],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
      threadClaimWinnerId: "opp-a",
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const email = baseEmail({
      id: "msg-thread-race",
      threadId: "thread-race",
      from: "Avery Stone <avery@example.com>",
      fromName: "Avery Stone",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Estimate follow-up",
      labelIds: ["INBOX"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [email],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "link", clientId: "client-b" });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors.join(" ")).toContain(
      "provider thread is already owned by opportunity opp-a"
    );
    expect(state.threadLinks).toEqual([
      {
        opportunity_id: "opp-a",
        thread_id: "thread-race",
        connection_id: "connection-1",
      },
    ]);
    expect(state.activities).toHaveLength(0);
    expect(updateConnectionMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "inbound",
      inbox: [
        baseEmail({
          id: "msg-thread-read-inbound",
          threadId: "thread-read-inbound",
          from: "Avery Stone <avery@example.com>",
          fromName: "Avery Stone",
          to: ["jackson@canprodeckandrail.com"],
          subject: "Customer question",
          labelIds: ["INBOX"],
        }),
      ],
      sent: [],
    },
    {
      label: "outbound",
      inbox: [
        baseEmail({
          id: "msg-thread-read-outbound",
          threadId: "thread-read-outbound",
        }),
      ],
      sent: [],
    },
  ])(
    "fails closed on a $label provider-thread read error",
    async ({ inbox, sent }) => {
      const state: SupabaseState = {
        clients: [],
        opportunities: [],
        threadLinks: [],
        activities: [],
        threadLinkReadError: "thread relationship database unavailable",
      };
      setSupabaseOverride(makeSupabaseDouble(state) as never);
      getConnectionMock.mockResolvedValue(baseConnection());
      getProviderMock.mockReturnValue({
        providerType: "gmail",
        fetchNewEmailsSince: vi.fn(async () => ({
          emails: inbox,
          nextSyncToken: "sync-token-2",
        })),
        fetchSentEmailsSince: vi.fn(async () => ({
          emails: sent,
          nextSyncToken: "sync-token-2",
        })),
      });

      const result = await SyncEngine.runSync("connection-1");

      expect(result.errors.join(" ")).toContain(
        "thread relationship database unavailable"
      );
      expect(state.activities).toHaveLength(0);
      expect(updateConnectionMock).not.toHaveBeenCalled();
    }
  );

  it("does not dedupe a provider message against another company or mailbox", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        {
          id: "opp-other-company",
          company_id: "company-2",
          stage: "new_lead",
        },
      ],
      threadLinks: [],
      activities: [
        {
          id: "activity-other-company",
          company_id: "company-2",
          email_connection_id: "connection-2",
          email_message_id: "shared-provider-message",
          opportunity_id: "opp-other-company",
        },
      ],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "shared-provider-message",
            threadId: "company-1-thread",
            from: "Customer <customer@example.com>",
            fromName: "Customer",
            to: ["jackson@canprodeckandrail.com"],
            subject: "New deck estimate",
            bodyText: "Please quote a new deck.",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(matchMock).toHaveBeenCalledWith(
      "company-1",
      "customer@example.com",
      expect.objectContaining({
        threadId: "company-1-thread",
        connectionId: "connection-1",
      })
    );
    expect(state.activities).toHaveLength(2);
    expect(state.activities.at(-1)).toMatchObject({
      company_id: "company-1",
      email_connection_id: "connection-1",
      email_message_id: "shared-provider-message",
    });
  });

  it("uses a parsed contact form submitter instead of the platform sender or company identity", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-form-1",
            threadId: "thread-form-1",
            from: "Canpro Deck and Rail <notifications@wix-forms.com>",
            fromName: "Canpro Deck and Rail",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Contact Us 3 got a new submission",
            bodyText: contactFormBody,
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0].title).toBe("Marcel Mercier — Email Inquiry");
    expect(state.opportunities[0]).toMatchObject({
      contact_name: "Marcel Mercier",
      contact_email: "marcel.mercier@example.com",
      contact_phone: "12505388340",
      address: "1220 Wharf Street, Victoria BC",
      estimated_value: 18500,
      detected_value: 18500,
      description: "We need someone to renovate and replace two roof decks.",
      source_email_id: "thread-form-1",
      source: "email",
    });
    expect(state.clients[0]).toMatchObject({
      name: "Mercier Holdings",
      email: "marcel.mercier@example.com",
      phone_number: "12505388340",
      address: "1220 Wharf Street, Victoria BC",
    });
    expect(state.opportunities[0].title).not.toContain("Canpro");
    expect(state.opportunities[0].title).not.toContain("notifications");
    expect(matchMock).toHaveBeenCalledWith(
      "company-1",
      "marcel.mercier@example.com",
      { name: "Marcel Mercier" }
    );
    expect(state.activities[0]).toMatchObject({
      email_message_id: "msg-form-1",
      email_thread_id: "thread-form-1",
      from_email: "marcel.mercier@example.com",
      opportunity_id: "opp-1",
    });
    expect(upsertFromEmailMock).not.toHaveBeenCalled();
  });

  it("keeps distinct Wix submitters separate when Gmail reuses one provider thread", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const sandraBody = contactFormBody
      .replaceAll("Marcel Mercier", "Sandra Dunford")
      .replaceAll("marcel.mercier@example.com", "sandra@example.com")
      .replaceAll("Mercier Holdings", "Sandra Dunford")
      .replaceAll("12505388340", "12505550101")
      .replaceAll(
        "1220 Wharf Street, Victoria BC",
        "10 Douglas Street, Victoria BC"
      );
    const bradBody = contactFormBody
      .replaceAll("Marcel Mercier", "Brad King")
      .replaceAll("marcel.mercier@example.com", "brad@example.com")
      .replaceAll("Mercier Holdings", "Brad King")
      .replaceAll("12505388340", "12505550102")
      .replaceAll(
        "1220 Wharf Street, Victoria BC",
        "20 Douglas Street, Victoria BC"
      );

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-form-sandra",
            threadId: "thread-wix-shared",
            from: "Canpro Deck and Rail <notifications@wix-forms.com>",
            fromName: "Canpro Deck and Rail",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Free Quote form got a new submission",
            bodyText: sandraBody,
            labelIds: ["INBOX"],
          }),
          baseEmail({
            id: "msg-form-brad",
            threadId: "thread-wix-shared",
            from: "Canpro Deck and Rail <notifications@wix-forms.com>",
            fromName: "Canpro Deck and Rail",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Free Quote form got a new submission",
            bodyText: bradBody,
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    await SyncEngine.runSync("connection-1");

    expect(state.clients.map((row) => row.email).sort()).toEqual([
      "brad@example.com",
      "sandra@example.com",
    ]);
    expect(state.opportunities).toHaveLength(2);
    expect(
      state.opportunities.map((row) => row.source_thread_key).sort()
    ).toEqual([
      "email:gmail:connection-1:message:msg-form-brad",
      "email:gmail:connection-1:message:msg-form-sandra",
    ]);
    expect(state.activities).toHaveLength(2);
    expect(
      new Set(state.activities.map((row) => row.opportunity_id)).size
    ).toBe(2);
    // Form notifications retain the raw provider id on their activities but do
    // not create a one-thread/one-opportunity inheritance link.
    expect(
      state.activities.every(
        (row) => row.email_thread_id === "thread-wix-shared"
      )
    ).toBe(true);
    expect(state.threadLinks).toHaveLength(0);
  });

  it("persists an operator-authored message as outbound even when Gmail returned it in INBOX", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        {
          id: "opp-linked",
          company_id: "company-1",
          client_id: "client-kara",
          title: "Kara Beach — Estimate",
          stage: "quoted",
          stage_manually_set: false,
          archived_at: null,
          deleted_at: null,
        },
      ],
      threadLinks: [
        {
          opportunity_id: "opp-linked",
          thread_id: "thread-linked",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    const fetchSentEmailsSince = vi.fn(async () => ({
      emails: [],
      nextSyncToken: "sync-token-2",
    }));
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-own-inbox",
            threadId: "thread-linked",
            from: "Jackson Sweet <jackson@canprodeckandrail.com>",
            fromName: "Jackson Sweet",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince,
    });

    await SyncEngine.runSync("connection-1");

    expect(state.activities).toHaveLength(1);
    expect(state.activities[0].direction).toBe("outbound");
    expect(state.correspondenceEvents?.[0]?.direction).toBe("outbound");
    expect(fetchSentEmailsSince).not.toHaveBeenCalled();
    expect(state.rpcCalls).toContainEqual({
      name: "apply_opportunity_correspondence_event",
      params: expect.objectContaining({
        p_opportunity_id: "opp-linked",
        p_provider_message_id: "msg-own-inbox",
      }),
    });
  });

  it("persists provider occurrence time and processes mixed-direction history chronologically", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        {
          id: "opp-chronology",
          company_id: "company-1",
          client_id: null,
          title: "Chronology lead",
          stage: "qualifying",
          stage_manually_set: false,
          archived_at: null,
          deleted_at: null,
        },
      ],
      threadLinks: [
        {
          opportunity_id: "opp-chronology",
          thread_id: "thread-chronology",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const earliestInbound = baseEmail({
      id: "msg-chronology-1",
      threadId: "thread-chronology",
      from: "Kara Beach <kara.beach@example.com>",
      fromName: "Kara Beach",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Deck scope",
      bodyText: "Can you quote the deck scope?",
      snippet: "Can you quote the deck scope?",
      date: new Date("2026-05-20T15:00:00.000Z"),
      labelIds: ["INBOX"],
    });
    const middleOutbound = baseEmail({
      id: "msg-chronology-2",
      threadId: "thread-chronology",
      from: "Jackson Sweet <jackson@canprodeckandrail.com>",
      fromName: "Jackson Sweet",
      to: ["Kara Beach <kara.beach@example.com>"],
      subject: "Re: Deck scope",
      bodyText: "I will send the estimate today.",
      snippet: "I will send the estimate today.",
      date: new Date("2026-05-20T16:00:00.000Z"),
      labelIds: ["SENT"],
    });
    const latestInbound = baseEmail({
      id: "msg-chronology-3",
      threadId: "thread-chronology",
      from: "Kara Beach <kara.beach@example.com>",
      fromName: "Kara Beach",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Re: Deck scope",
      bodyText: "Thanks. I will watch for it.",
      snippet: "Thanks. I will watch for it.",
      date: new Date("2026-05-20T17:00:00.000Z"),
      labelIds: ["INBOX"],
    });

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        // Gmail History discovery order is not a conversation chronology.
        emails: [latestInbound, earliestInbound, middleOutbound],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });

    await SyncEngine.runSync("connection-1");

    expect(state.activities.map((row) => row.email_message_id)).toEqual([
      "msg-chronology-1",
      "msg-chronology-2",
      "msg-chronology-3",
    ]);
    expect(state.activities.map((row) => row.created_at)).toEqual([
      "2026-05-20T15:00:00.000Z",
      "2026-05-20T16:00:00.000Z",
      "2026-05-20T17:00:00.000Z",
    ]);
    expect(state.activities.map((row) => row.direction)).toEqual([
      "inbound",
      "outbound",
      "inbound",
    ]);
  });

  it("refreshes AI stage evidence when new correspondence confirms the current stage", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        {
          id: "opp-stage-refresh",
          company_id: "company-1",
          client_id: null,
          title: "Stage refresh lead",
          stage: "qualifying",
          stage_manually_set: false,
          ai_summary: "Old summary",
          ai_stage_signals: ["old_signal"],
          archived_at: null,
          deleted_at: null,
        },
      ],
      threadLinks: [
        {
          opportunity_id: "opp-stage-refresh",
          thread_id: "thread-stage-refresh",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
      stageTransitions: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const updateEmail = baseEmail({
      id: "msg-stage-refresh",
      threadId: "thread-stage-refresh",
      from: "Kara Beach <kara.beach@example.com>",
      fromName: "Kara Beach",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Updated measurements",
      bodyText: "The deck is 12 by 18 feet.",
      snippet: "The deck is 12 by 18 feet.",
      labelIds: ["INBOX"],
    });

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [updateEmail],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    evaluateStagesWithSummaryMock.mockResolvedValue([
      {
        threadId: "thread-stage-refresh",
        newStage: "qualifying",
        terminalFlag: null,
        summary: "Customer supplied updated deck measurements.",
      },
    ]);

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities[0]).toMatchObject({
      stage: "qualifying",
      ai_summary: "Customer supplied updated deck measurements.",
      ai_summary_updated_at: expect.any(String),
      ai_stage_signals: ["ai_evaluated"],
    });
    expect(state.stageTransitions).toEqual([]);
  });

  it("links a new provider thread to an existing active opportunity when parsed customer address matches", async () => {
    const state: SupabaseState = {
      clients: [
        {
          id: "client-john",
          company_id: "company-1",
          name: "John Carter",
          email: "john@example.com",
          phone_number: null,
          address: "18 Cedar Road, Victoria BC",
        },
      ],
      opportunities: [
        {
          id: "opp-john-active",
          company_id: "company-1",
          client_id: "client-john",
          title: "John Carter - Deck rebuild",
          stage: "follow_up",
          archived_at: null,
          deleted_at: null,
          contact_name: "John Carter",
          contact_email: "john@example.com",
          contact_phone: null,
          address: "18 Cedar Road, Victoria BC",
          description: "Replace the back deck and railing.",
          source_email_id: "thread-john-original",
          created_at: "2026-05-19T17:00:00.000Z",
          updated_at: "2026-05-20T17:00:00.000Z",
        },
      ],
      threadLinks: [],
      activities: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-mary-address",
            threadId: "thread-mary-new",
            from: "Canpro Deck and Rail <notifications@wix-forms.com>",
            fromName: "Canpro Deck and Rail",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Contact Us 3 got a new submission",
            bodyText: contactFormBody
              .replaceAll("Marcel Mercier", "Mary Carter")
              .replaceAll(
                "marcel.mercier@example.com",
                "mary.carter@example.com"
              )
              .replaceAll("Mercier Holdings", "Mary Carter")
              .replaceAll(
                "1220 Wharf Street, Victoria BC",
                "18 Cedar Road, Victoria BC"
              ),
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities).toHaveLength(1);
    expect(state.threadLinks).toHaveLength(0);
    expect(state.activities[0]).toMatchObject({
      email_message_id: "msg-mary-address",
      email_thread_id: "thread-mary-new",
      opportunity_id: "opp-john-active",
      from_email: "mary.carter@example.com",
    });
    expect(state.rpcCalls).toEqual([
      {
        name: "apply_opportunity_correspondence_event",
        params: expect.objectContaining({
          p_opportunity_id: "opp-john-active",
          p_provider_message_id: "msg-mary-address",
        }),
      },
    ]);
  });

  it("creates a separate opportunity when P3 relationship matching rejects client-level reuse", async () => {
    const state: SupabaseState = {
      clients: [
        {
          id: "client-existing",
          company_id: "company-1",
          name: "Kara Beach",
          email: "kara.beach@example.com",
          phone_number: null,
          address: "22 Original Road, Victoria BC",
        },
      ],
      opportunities: [
        {
          id: "opp-open",
          company_id: "company-1",
          client_id: "client-existing",
          title: "Kara Beach - Original deck",
          stage: "follow_up",
          archived_at: null,
          deleted_at: null,
          contact_name: "Kara Beach",
          contact_email: "kara.beach@example.com",
          contact_phone: null,
          address: "22 Original Road, Victoria BC",
          description: "Original deck repair.",
          source_email_id: "thread-original",
          created_at: "2026-05-19T17:00:00.000Z",
          updated_at: "2026-05-20T17:00:00.000Z",
        },
      ],
      threadLinks: [],
      activities: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-new-job",
            threadId: "thread-new-job",
            from: "Mara Hill <mara.hill@example.com>",
            fromName: "Mara Hill",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Need an estimate",
            bodyText: "Can you quote a front gate at 455 New Road?",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({
      action: "link",
      clientId: "client-existing",
      confidence: "exact",
    });

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities).toHaveLength(2);
    const createdOpportunity = state.opportunities.find(
      (opportunity) => opportunity.id !== "opp-open"
    );
    expect(createdOpportunity).toMatchObject({
      client_id: "client-existing",
      contact_name: "Mara Hill",
      contact_email: "mara.hill@example.com",
      source_email_id: "thread-new-job",
      source: "email",
    });
    expect(state.threadLinks).toEqual([
      expect.objectContaining({
        opportunity_id: createdOpportunity?.id,
        thread_id: "thread-new-job",
        connection_id: "connection-1",
      }),
    ]);
    expect(state.activities[0]).toMatchObject({
      email_message_id: "msg-new-job",
      email_thread_id: "thread-new-job",
      opportunity_id: createdOpportunity?.id,
      from_email: "mara.hill@example.com",
    });
    expect(state.threadLinks[0].opportunity_id).not.toBe("opp-open");
  });

  it("fails the cycle on a blank provider thread id before lifecycle writes or cursor advancement", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-blank-thread",
            threadId: "   ",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Canpro Deck and Rail Estimate",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    const result = await SyncEngine.runSync("connection-1");

    expect(state.clients).toHaveLength(0);
    expect(state.opportunities).toHaveLength(0);
    expect(state.threadLinks).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
    expect(state.correspondenceEvents).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
    expect(upsertFromEmailMock).not.toHaveBeenCalled();
    expect(result.invalidProviderEmails).toBe(1);
    expect(result.errors).toEqual([
      expect.stringContaining("rejected invalid provider identity"),
    ]);
    expect(updateConnectionMock).not.toHaveBeenCalled();
  });

  it("fails the cycle on a blank provider message id before count writes or cursor advancement", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [
        {
          opportunity_id: "opp-linked",
          thread_id: "thread-linked",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: " ",
            threadId: "thread-linked",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Deck quote follow-up",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(state.threadLinks).toHaveLength(1);
    expect(state.activities).toHaveLength(0);
    expect(state.correspondenceEvents).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
    expect(upsertFromEmailMock).not.toHaveBeenCalled();
    expect(result.invalidProviderEmails).toBe(1);
    expect(result.errors).toEqual([
      expect.stringContaining("rejected invalid provider identity"),
    ]);
    expect(updateConnectionMock).not.toHaveBeenCalled();
  });

  it("continues valid linked-thread processing after provider id guardrails", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        {
          id: "opp-linked",
          company_id: "company-1",
          client_id: null,
          stage: "new_lead",
          correspondence_count: 0,
          inbound_count: 0,
          outbound_count: 0,
          deleted_at: null,
        },
      ],
      threadLinks: [
        {
          opportunity_id: "opp-linked",
          thread_id: "thread-linked",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-linked",
            threadId: "thread-linked",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Deck quote follow-up",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(state.activities).toHaveLength(1);
    expect(state.correspondenceEvents).toEqual([
      expect.objectContaining({
        company_id: "company-1",
        opportunity_id: "opp-linked",
        connection_id: "connection-1",
        provider_thread_id: "thread-linked",
        provider_message_id: "msg-linked",
        direction: "inbound",
        party_role: "customer",
        is_meaningful: true,
        noise_reason: null,
        source: "sync_activity",
      }),
    ]);
    expect(state.activities[0]).toMatchObject({
      email_message_id: "msg-linked",
      email_thread_id: "thread-linked",
      opportunity_id: "opp-linked",
    });
    expect(state.rpcCalls).toEqual([
      {
        name: "apply_opportunity_correspondence_event",
        params: expect.objectContaining({
          p_opportunity_id: "opp-linked",
          p_provider_message_id: "msg-linked",
        }),
      },
    ]);
    expect(upsertFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerThreadId: "thread-linked",
        opportunityId: "opp-linked",
      })
    );
    expect(result.matched).toBe(1);
    expect(result.activitiesCreated).toBe(1);
  });

  it("dedupes an exact scan-snapshot message while ingesting a newer same-thread message", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [{ id: "opp-imported", stage: "new_lead" }],
      threadLinks: [
        {
          opportunity_id: "opp-imported",
          thread_id: "thread-imported",
          connection_id: "connection-1",
        },
      ],
      activities: [
        {
          id: "activity-imported-m1",
          company_id: "company-1",
          type: "email",
          email_thread_id: "thread-imported",
          email_message_id: "msg-imported-m1",
          email_connection_id: "connection-1",
          opportunity_id: "opp-imported",
          created_at: "2026-05-19T00:00:00.000Z",
        },
      ],
      correspondenceEvents: [
        {
          id: "event-imported-m1",
          company_id: "company-1",
          opportunity_id: "opp-imported",
          activity_id: "activity-imported-m1",
          connection_id: "connection-1",
          provider_thread_id: "thread-imported",
          provider_message_id: "msg-imported-m1",
          opportunity_projection_applied: true,
        },
      ],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-imported-m1",
            threadId: "thread-imported",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Deck quote follow-up",
            labelIds: ["INBOX"],
          }),
          baseEmail({
            id: "msg-new-m2",
            threadId: "thread-imported",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "One more detail",
            date: new Date("2026-05-20T17:10:00.000Z"),
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(state.activities.map((row) => row.email_message_id).sort()).toEqual([
      "msg-imported-m1",
      "msg-new-m2",
    ]);
    expect(
      state.correspondenceEvents?.map((row) => row.provider_message_id).sort()
    ).toEqual(["msg-imported-m1", "msg-new-m2"]);
    expect(result.activitiesCreated).toBe(1);
  });

  it("dedupes exact contact-form messages independently on a shared provider thread", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        { id: "opp-sandra", stage: "new_lead" },
        { id: "opp-brad", stage: "new_lead" },
      ],
      threadLinks: [],
      activities: [
        {
          id: "activity-sandra",
          company_id: "company-1",
          type: "email",
          email_connection_id: "connection-1",
          email_thread_id: "thread-wix-shared",
          email_message_id: "msg-sandra",
          opportunity_id: "opp-sandra",
          created_at: "2026-05-19T00:00:00.000Z",
        },
        {
          id: "activity-brad",
          company_id: "company-1",
          type: "email",
          email_connection_id: "connection-1",
          email_thread_id: "thread-wix-shared",
          email_message_id: "msg-brad",
          opportunity_id: "opp-brad",
          created_at: "2026-05-19T00:01:00.000Z",
        },
      ],
      correspondenceEvents: [
        {
          id: "event-sandra",
          company_id: "company-1",
          opportunity_id: "opp-sandra",
          activity_id: "activity-sandra",
          connection_id: "connection-1",
          provider_thread_id: "thread-wix-shared",
          provider_message_id: "msg-sandra",
          opportunity_projection_applied: true,
        },
        {
          id: "event-brad",
          company_id: "company-1",
          opportunity_id: "opp-brad",
          activity_id: "activity-brad",
          connection_id: "connection-1",
          provider_thread_id: "thread-wix-shared",
          provider_message_id: "msg-brad",
          opportunity_projection_applied: true,
        },
      ],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-sandra",
            threadId: "thread-wix-shared",
            from: "Wix Forms <notifications@wix-forms.com>",
            subject: "Free Quote form got a new submission",
            bodyText:
              "Name: Sandra Lee\nEmail: sandra@example.com\nMessage: Cedar deck quote",
            labelIds: ["INBOX"],
          }),
          baseEmail({
            id: "msg-brad",
            threadId: "thread-wix-shared",
            from: "Wix Forms <notifications@wix-forms.com>",
            subject: "Free Quote form got a new submission",
            bodyText:
              "Name: Brad Cole\nEmail: brad@example.com\nMessage: Railing quote",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(state.activities).toHaveLength(2);
    expect(state.activities.map((row) => row.email_message_id).sort()).toEqual([
      "msg-brad",
      "msg-sandra",
    ]);
    expect(result.activitiesCreated).toBe(0);
  });

  it("never guesses which real message an ambiguous legacy thread shell represented", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [{ id: "opp-legacy-thread", stage: "new_lead" }],
      threadLinks: [
        {
          opportunity_id: "opp-legacy-thread",
          thread_id: "thread-legacy",
          connection_id: "connection-1",
        },
      ],
      activities: [
        {
          id: "activity-legacy-thread",
          company_id: "company-1",
          type: "email",
          email_connection_id: null,
          email_thread_id: "thread-legacy",
          email_message_id: "import:thread-legacy:0",
          opportunity_id: "opp-legacy-thread",
          created_at: "2026-05-19T00:00:00.000Z",
        },
      ],
      correspondenceEvents: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-thread-legacy",
            threadId: "thread-legacy",
            from: "Customer <customer@example.com>",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(state.activities.map((row) => row.email_message_id).sort()).toEqual([
      "import:thread-legacy:0",
      "msg-thread-legacy",
    ]);
    expect(state.activities[0].email_connection_id).toBeNull();
    expect(state.activities[1].email_connection_id).toBe("connection-1");
  });

  it("keeps valid inbound customer sender titles stable", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-inbound-1",
            threadId: "thread-inbound-1",
            from: "Leah Graham <leah.graham@example.com>",
            fromName: "Leah Graham",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Need an estimate",
            bodyText: "Can you quote our deck repair?",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0].title).toBe("Leah Graham — Email Inquiry");
  });

  it("prioritizes inbound sender identity over an existing linked client display name", async () => {
    const state: SupabaseState = {
      clients: [
        {
          id: "client-existing",
          company_id: "company-1",
          name: "Existing Property Group",
          email: "office@existing-property.test",
        },
      ],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(
      baseConnection({
        email: "operator@north-ridge.test",
        syncFilters: {
          includeSentMail: false,
          estimateSubjectPatterns: ["estimate"],
          companyDomains: ["north-ridge.test"],
          teamForwarders: [],
        },
      })
    );
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-linked-1",
            threadId: "thread-linked-1",
            from: "Mara Hill <mara.hill@example.com>",
            fromName: "Mara Hill",
            to: ["operator@north-ridge.test"],
            subject: "Need an estimate",
            bodyText: "Can you quote a repair?",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({
      action: "link",
      clientId: "client-existing",
    });

    await SyncEngine.runSync("connection-1");

    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0].title).toBe("Mara Hill — Email Inquiry");
    expect(state.opportunities[0].title).not.toContain(
      "Existing Property Group"
    );
  });

  it("repairs a correspondence event on retry before advancing the cursor", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [{ id: "opp-linked", stage: "new_lead" }],
      threadLinks: [
        {
          opportunity_id: "opp-linked",
          thread_id: "thread-linked",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
      correspondenceEventInsertError: "correspondence event write unavailable",
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-lifecycle-retry",
            threadId: "thread-linked",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Estimate follow-up",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });

    const failed = await SyncEngine.runSync("connection-1");

    expect(failed.errors.join(" ")).toContain(
      "correspondence event write unavailable"
    );
    expect(state.activities).toHaveLength(1);
    expect(state.correspondenceEvents).toHaveLength(0);
    expect(updateConnectionMock).not.toHaveBeenCalled();

    state.correspondenceEventInsertError = undefined;
    const repaired = await SyncEngine.runSync("connection-1");

    expect(repaired.errors).toEqual([]);
    expect(state.activities).toHaveLength(1);
    expect(state.correspondenceEvents).toHaveLength(1);
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "sync-token-2" })
    );
  });

  it("projects a provider message exactly once after a failed counter write", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [{ id: "opp-linked", stage: "new_lead" }],
      threadLinks: [
        {
          opportunity_id: "opp-linked",
          thread_id: "thread-linked",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
      correspondenceProjectionError: "counter projection unavailable",
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-projection-retry",
            threadId: "thread-linked",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Estimate follow-up",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });

    const failed = await SyncEngine.runSync("connection-1");

    expect(failed.errors.join(" ")).toContain("counter projection unavailable");
    expect(state.activities).toHaveLength(1);
    expect(state.correspondenceEvents).toHaveLength(1);
    expect(
      state.correspondenceEvents?.[0]?.opportunity_projection_applied
    ).toBe(false);
    expect(updateConnectionMock).not.toHaveBeenCalled();

    state.correspondenceProjectionError = undefined;
    const repaired = await SyncEngine.runSync("connection-1");

    expect(repaired.errors).toEqual([]);
    expect(state.activities).toHaveLength(1);
    expect(state.correspondenceEvents).toHaveLength(1);
    expect(
      state.correspondenceEvents?.[0]?.opportunity_projection_applied
    ).toBe(true);
    expect(
      state.rpcCalls?.filter(
        (call) =>
          call.name === "apply_opportunity_correspondence_event" &&
          call.params.p_provider_message_id === "msg-projection-retry"
      )
    ).toHaveLength(2);
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "sync-token-2" })
    );
  });

  it("replays a new opportunity's first message without seeding or double-projecting counters", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
      correspondenceProjectionError: "counter projection unavailable",
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-new-lead-projection",
            threadId: "thread-new-lead-projection",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "New deck estimate",
            bodyText: "Please quote a new deck.",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    const failed = await SyncEngine.runSync("connection-1");

    expect(failed.errors.join(" ")).toContain("counter projection unavailable");
    expect(state.opportunities).toHaveLength(1);
    expect(state.opportunities[0]).toMatchObject({
      correspondence_count: 0,
      inbound_count: 0,
      outbound_count: 0,
    });
    expect(state.activities).toHaveLength(1);
    expect(state.correspondenceEvents).toEqual([
      expect.objectContaining({
        provider_message_id: "msg-new-lead-projection",
        opportunity_projection_applied: false,
      }),
    ]);
    expect(updateConnectionMock).not.toHaveBeenCalled();

    state.correspondenceProjectionError = undefined;
    const repaired = await SyncEngine.runSync("connection-1");
    const replayed = await SyncEngine.runSync("connection-1");

    expect(repaired.errors).toEqual([]);
    expect(replayed.errors).toEqual([]);
    expect(state.opportunities).toHaveLength(1);
    expect(state.activities).toHaveLength(1);
    expect(state.correspondenceEvents).toHaveLength(1);
    expect(state.opportunities[0]).toMatchObject({
      correspondence_count: 1,
      inbound_count: 1,
      outbound_count: 0,
    });
    expect(
      state.correspondenceEvents?.[0]?.opportunity_projection_applied
    ).toBe(true);
    expect(state.correspondenceProjectionApplications).toBe(1);
    expect(
      state.rpcCalls?.filter(
        (call) =>
          call.name === "apply_opportunity_correspondence_event" &&
          call.params.p_provider_message_id === "msg-new-lead-projection"
      )
    ).toHaveLength(3);
  });

  it("does not strand a pending first-message event after a create-new source-key conflict", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        {
          id: "opp-source-key-winner",
          company_id: "company-1",
          client_id: "client-race-winner",
          source_thread_key:
            "email:gmail:connection-1:thread:thread-source-key-race",
          stage: "new_lead",
          correspondence_count: 0,
          inbound_count: 0,
          outbound_count: 0,
          deleted_at: null,
        },
      ],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
      opportunityInsertError: {
        code: "23505",
        message: "duplicate source thread key",
      },
      correspondenceProjectionError: "counter projection unavailable",
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-source-key-race",
            threadId: "thread-source-key-race",
            from: "Mara Hill <mara.hill@example.com>",
            fromName: "Mara Hill",
            to: ["jackson@canprodeckandrail.com"],
            subject: "New gate estimate",
            bodyText: "Please quote a new gate.",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });

    const failed = await SyncEngine.runSync("connection-1");

    expect(failed.errors.join(" ")).toContain("counter projection unavailable");
    expect(state.opportunities).toHaveLength(1);
    expect(state.activities).toEqual([
      expect.objectContaining({
        opportunity_id: "opp-source-key-winner",
        email_message_id: "msg-source-key-race",
      }),
    ]);
    expect(state.correspondenceEvents).toEqual([
      expect.objectContaining({
        opportunity_id: "opp-source-key-winner",
        provider_message_id: "msg-source-key-race",
        opportunity_projection_applied: false,
      }),
    ]);
    expect(updateConnectionMock).not.toHaveBeenCalled();

    state.correspondenceProjectionError = undefined;
    const repaired = await SyncEngine.runSync("connection-1");

    expect(repaired.errors).toEqual([]);
    expect(state.opportunities[0]).toMatchObject({
      correspondence_count: 1,
      inbound_count: 1,
      outbound_count: 0,
    });
    expect(state.correspondenceProjectionApplications).toBe(1);
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "sync-token-2" })
    );
  });

  it("replays deterministic thread persistence after an activity was already inserted", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        {
          id: "opp-linked",
          company_id: "company-1",
          stage: "new_lead",
          contact_name: null,
          contact_email: null,
          contact_phone: null,
          address: null,
          estimated_value: null,
          detected_value: null,
          description: null,
          source: "email",
          source_email_id: "thread-linked",
        },
      ],
      threadLinks: [
        {
          opportunity_id: "opp-linked",
          thread_id: "thread-linked",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-thread-retry",
            threadId: "thread-linked",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Estimate follow-up",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    upsertFromEmailMock.mockRejectedValueOnce(
      new Error("email thread write unavailable")
    );

    const failed = await SyncEngine.runSync("connection-1");

    expect(failed.errors.join(" ")).toContain("email thread write unavailable");
    expect(state.activities).toHaveLength(1);
    expect(state.correspondenceEvents).toHaveLength(1);
    expect(updateConnectionMock).not.toHaveBeenCalled();

    const repaired = await SyncEngine.runSync("connection-1");

    expect(repaired.errors).toEqual([]);
    expect(state.activities).toHaveLength(1);
    expect(upsertFromEmailMock).toHaveBeenCalledTimes(2);
    expect(state.opportunities[0]).toMatchObject({
      contact_name: "Kara Beach",
      contact_email: "kara.beach@example.com",
    });
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "sync-token-2" })
    );
  });

  it("refreshes a manually categorized thread after a new outbound message without reclassifying an exact replay", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        {
          id: "opp-outbound-summary",
          company_id: "company-1",
          client_id: null,
          stage: "qualifying",
          contact_name: "Kara Beach",
          contact_email: "kara.beach@example.com",
          contact_phone: null,
          address: null,
          estimated_value: null,
          detected_value: null,
          description: null,
          source: "email",
          source_email_id: "thread-outbound-summary",
        },
      ],
      threadLinks: [
        {
          opportunity_id: "opp-outbound-summary",
          thread_id: "thread-outbound-summary",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const outbound = baseEmail({
      id: "msg-outbound-summary",
      threadId: "thread-outbound-summary",
      from: "Jackson Sweet <jackson@canprodeckandrail.com>",
      fromName: "Jackson Sweet",
      to: ["Kara Beach <kara.beach@example.com>"],
      subject: "Re: Deck estimate",
      bodyText: "Here is the updated start date.",
      snippet: "Here is the updated start date.",
      labelIds: ["SENT"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [outbound],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });

    const first = await SyncEngine.runSync("connection-1");

    expect(first.errors).toEqual([]);
    expect(upsertFromEmailMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ markClassificationDirty: true })
    );
    expect(afterMock).toHaveBeenCalledOnce();
    await afterMock.mock.calls[0][0]();
    expect(classifyAndUpdateMock).toHaveBeenCalledOnce();

    afterMock.mockClear();
    classifyAndUpdateMock.mockClear();
    const replay = await SyncEngine.runSync("connection-1");

    expect(replay.errors).toEqual([]);
    expect(upsertFromEmailMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ markClassificationDirty: false })
    );
    expect(afterMock).not.toHaveBeenCalled();
    expect(classifyAndUpdateMock).not.toHaveBeenCalled();
  });

  it("replays canonical contact enrichment after a partial message write", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        {
          id: "opp-linked",
          company_id: "company-1",
          stage: "new_lead",
          client_id: null,
          contact_name: null,
          contact_email: null,
          contact_phone: null,
          address: null,
          estimated_value: null,
          detected_value: null,
          description: null,
          source: "email",
          source_email_id: "thread-linked",
          source_message_id: null,
          source_metadata: null,
        },
      ],
      threadLinks: [
        {
          opportunity_id: "opp-linked",
          thread_id: "thread-linked",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
      opportunityEnrichmentUpdateError: "contact enrichment unavailable",
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-enrichment-retry",
            threadId: "thread-linked",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Estimate follow-up",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });

    const failed = await SyncEngine.runSync("connection-1");

    expect(failed.errors.join(" ")).toContain("contact enrichment unavailable");
    expect(state.activities).toHaveLength(1);
    expect(state.opportunities[0].contact_email).toBeNull();
    expect(updateConnectionMock).not.toHaveBeenCalled();

    state.opportunityEnrichmentUpdateError = undefined;
    const repaired = await SyncEngine.runSync("connection-1");

    expect(repaired.errors).toEqual([]);
    expect(state.activities).toHaveLength(1);
    expect(state.opportunities[0]).toMatchObject({
      contact_name: "Kara Beach",
      contact_email: "kara.beach@example.com",
    });
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "sync-token-2" })
    );
  });

  it("fails closed without advancing the cursor when a lifecycle stage write is rejected", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [{ id: "opp-linked", stage: "new_lead" }],
      threadLinks: [
        {
          opportunity_id: "opp-linked",
          thread_id: "thread-linked",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      opportunityStageUpdateError: "opportunity stage write unavailable",
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [
          baseEmail({
            id: "msg-stage-1",
            threadId: "thread-linked",
            from: "Kara Beach <kara.beach@example.com>",
            fromName: "Kara Beach",
            to: ["jackson@canprodeckandrail.com"],
            subject: "Deposit paid",
            bodyText: "The deposit has been paid. Please schedule the work.",
            labelIds: ["INBOX"],
          }),
        ],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    evaluateStagesWithSummaryMock.mockResolvedValue([
      {
        threadId: "thread-linked",
        currentStage: "new_lead",
        newStage: "qualifying",
        summary: "Deposit received; scheduling is next.",
        terminalFlag: null,
      },
    ]);

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors.join(" ")).toContain(
      "opportunity stage write unavailable"
    );
    expect(result.stageChanges).toBe(0);
    expect(state.opportunities[0].stage).toBe("new_lead");
    expect(updateConnectionMock).not.toHaveBeenCalled();
  });

  it("evaluates a contact-form lead from its message scope without linking the reused provider thread", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const formEmail = baseEmail({
      id: "msg-form-stage",
      threadId: "reused-wix-thread",
      from: "Wix Forms <notifications@wix-forms.com>",
      fromName: "Wix Forms",
      to: ["jackson@canprodeckandrail.com"],
      subject: "Contact Us 3 got a new submission",
      bodyText: contactFormBody,
      snippet: "Marcel Mercier requested a roof deck estimate.",
      labelIds: ["INBOX"],
    });
    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [formEmail],
        nextSyncToken: "sync-token-2",
      })),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token-2",
      })),
    });
    matchMock.mockResolvedValue({ action: "create_new", clientId: null });
    evaluateStagesWithSummaryMock.mockResolvedValue([
      {
        threadId: "email:gmail:connection-1:message:msg-form-stage",
        newStage: "qualifying",
        summary: "Marcel requested a roof deck renovation estimate.",
        terminalFlag: null,
      },
    ]);

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(state.threadLinks).toEqual([]);
    expect(evaluateStagesWithSummaryMock).toHaveBeenCalledWith(
      [
        {
          threadId: "email:gmail:connection-1:message:msg-form-stage",
          messages: [formEmail],
        },
      ],
      expect.objectContaining({ id: "connection-1" }),
      { name: "Canpro Deck and Rail" }
    );
    expect(state.opportunities[0]).toMatchObject({
      stage: "qualifying",
      ai_summary: "Marcel requested a roof deck renovation estimate.",
    });
    expect(state.stageTransitions).toEqual([
      expect.objectContaining({
        opportunity_id: state.opportunities[0].id,
        from_stage: "new_lead",
        to_stage: "qualifying",
      }),
    ]);
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "sync-token-2" })
    );
  });
});

describe("SyncEngine Gmail history completeness", () => {
  beforeEach(() => {
    getConnectionMock.mockReset();
    getProviderMock.mockReset();
    updateConnectionMock.mockReset();
    matchMock.mockReset();
    buildBlocklistMock.mockResolvedValue({});
    shouldFilterMock.mockReturnValue(false);
    reviewUnmatchedEmailsMock.mockResolvedValue({
      classifiedLeads: [],
      newLeadsClassified: 0,
    });
    evaluateStagesWithSummaryMock.mockResolvedValue([]);
    upsertFromEmailMock.mockReset();
    enqueueIfEnabledMock.mockClear();
    enqueueIfEnabledMock.mockResolvedValue({
      enqueued: true,
      jobId: "learning-job-test",
    });
    upsertFromEmailMock.mockResolvedValue({
      isNew: false,
      threadRow: {
        id: "email-thread-1",
        categoryConfidence: 1,
        categoryManuallySet: true,
      },
    });
  });

  afterEach(() => {
    setSupabaseOverride(null);
  });

  it("reconciles from connection creation before committing a first Gmail cursor", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [{ id: "opp-bootstrap", stage: "new_lead" }],
      threadLinks: [
        {
          opportunity_id: "opp-bootstrap",
          thread_id: "thread-bootstrap",
          connection_id: "connection-1",
        },
      ],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const createdAt = new Date("2026-05-20T17:00:00.000Z");
    getConnectionMock.mockResolvedValue(
      baseConnection({ historyId: null, lastSyncedAt: null, createdAt })
    );
    const listThreadIds = vi.fn(
      async (_options: { after: Date; pageToken: string | null }) => ({
        threadIds: ["thread-bootstrap"],
        nextPageToken: null,
      })
    );
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      getInitialSyncToken: vi.fn(async () => "fresh-history-token"),
      listThreadIds,
      fetchThread: vi.fn(async () => [
        baseEmail({
          id: "message-bootstrap",
          threadId: "thread-bootstrap",
          from: "Customer <customer@example.com>",
          fromName: "Customer",
          to: ["jackson@canprodeckandrail.com"],
          subject: "Estimate follow-up",
          labelIds: ["INBOX"],
          date: new Date("2026-05-20T17:05:00.000Z"),
        }),
      ]),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(state.activities.map((row) => row.email_message_id)).toEqual([
      "message-bootstrap",
    ]);
    expect(listThreadIds).toHaveBeenCalledWith(
      expect.objectContaining({
        after: expect.any(Date),
        pageToken: null,
      })
    );
    const after = listThreadIds.mock.calls[0][0].after as Date;
    expect(after.getTime()).toBeLessThan(createdAt.getTime());
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "fresh-history-token" })
    );
  });

  it("uses the last successful sync as a reconnect bootstrap anchor", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const createdAt = new Date("2025-05-20T17:00:00.000Z");
    const lastSyncedAt = new Date("2026-05-20T17:00:00.000Z");
    getConnectionMock.mockResolvedValue(
      baseConnection({ historyId: null, createdAt, lastSyncedAt })
    );
    const listThreadIds = vi.fn(
      async (_options: { after: Date; pageToken: string | null }) => ({
        threadIds: [],
        nextPageToken: null,
      })
    );
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      getInitialSyncToken: vi.fn(async () => "fresh-history-token"),
      listThreadIds,
      fetchThread: vi.fn(async () => []),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    const after = listThreadIds.mock.calls[0][0].after as Date;
    expect(after.getTime()).toBeLessThan(lastSyncedAt.getTime());
    expect(after.getTime()).toBeGreaterThan(createdAt.getTime());
  });

  it("reconciles every bounded Gmail thread from an overlap before committing a fresh cursor", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [
        { id: "opp-recovered-1", stage: "new_lead" },
        { id: "opp-recovered-2", stage: "new_lead" },
      ],
      threadLinks: [
        {
          opportunity_id: "opp-recovered-1",
          thread_id: "thread-recovered-1",
          connection_id: "connection-1",
        },
        {
          opportunity_id: "opp-recovered-2",
          thread_id: "thread-recovered-2",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const lastSyncedAt = new Date("2026-05-20T17:00:00.000Z");
    getConnectionMock.mockResolvedValue(baseConnection({ lastSyncedAt }));

    const listThreadIds = vi
      .fn()
      .mockResolvedValueOnce({
        threadIds: ["thread-recovered-1"],
        nextPageToken: "page-2",
      })
      .mockResolvedValueOnce({
        threadIds: ["thread-recovered-2"],
        nextPageToken: null,
      });
    const fetchThread = vi.fn(async (threadId: string) => [
      baseEmail({
        id: `message-${threadId}`,
        threadId,
        from: `Customer <${threadId}@example.com>`,
        fromName: "Customer",
        to: ["jackson@canprodeckandrail.com"],
        subject: "Estimate follow-up",
        bodyText: "Checking on the estimate.",
        date: new Date("2026-05-20T17:05:00.000Z"),
        labelIds: ["INBOX"],
      }),
    ]);
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => {
        throw new SyncTokenExpiredError("history token expired", 404);
      }),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token",
      })),
      getInitialSyncToken: vi.fn(async () => "fresh-history-token"),
      listThreadIds,
      fetchThread,
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(state.activities.map((row) => row.email_message_id)).toEqual([
      "message-thread-recovered-1",
      "message-thread-recovered-2",
    ]);
    expect(listThreadIds).toHaveBeenCalledTimes(2);
    const firstListOptions = listThreadIds.mock.calls[0][0] as {
      after: Date;
      pageToken?: string | null;
    };
    expect(firstListOptions.after.getTime()).toBeLessThan(
      lastSyncedAt.getTime()
    );
    expect(firstListOptions.pageToken).toBeNull();
    expect(listThreadIds.mock.calls[1][0]).toEqual(
      expect.objectContaining({ pageToken: "page-2" })
    );
    expect(fetchThread).toHaveBeenCalledTimes(2);
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "fresh-history-token" })
    );
  });

  it("checkpoints a Gmail recovery page and resumes beyond 500 threads before committing the fresh cursor", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const lastSyncedAt = new Date("2026-05-01T00:00:00.000Z");
    const recoveryAnchor = new Date("2026-04-30T23:45:00.000Z");
    const initialConnection = baseConnection({ lastSyncedAt });
    const recoveringConnection = {
      ...initialConnection,
      historyRecoveryAnchor: recoveryAnchor,
      historyRecoveryPageToken: "page-2",
      historyRecoveryTargetToken: "fresh-history-token",
    } as EmailConnection;
    getConnectionMock
      .mockResolvedValueOnce(initialConnection)
      .mockResolvedValueOnce(recoveringConnection);

    const fetchNewEmailsSince = vi.fn(async () => {
      throw new SyncTokenExpiredError("history token expired", 404);
    });
    const listThreadIds = vi.fn(
      async (options: { pageToken?: string | null }) => {
        if (options.pageToken === "page-2") {
          return {
            threadIds: ["thread-501"],
            nextPageToken: null,
          };
        }
        return {
          threadIds: Array.from(
            { length: 500 },
            (_, index) => `thread-${index + 1}`
          ),
          nextPageToken: "page-2",
        };
      }
    );
    const fetchThread = vi.fn(async () => []);
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince,
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token",
      })),
      getInitialSyncToken: vi.fn(async () => "fresh-history-token"),
      listThreadIds,
      fetchThread,
    });

    const first = await SyncEngine.runSync("connection-1");

    expect(first.errors).toEqual([]);
    expect(listThreadIds).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pageToken: null })
    );
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({
        historyRecoveryPageToken: "page-2",
        historyRecoveryTargetToken: "fresh-history-token",
      })
    );
    expect(updateConnectionMock).not.toHaveBeenCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "fresh-history-token" })
    );

    updateConnectionMock.mockClear();
    const second = await SyncEngine.runSync("connection-1");

    expect(second.errors).toEqual([]);
    expect(fetchNewEmailsSince).toHaveBeenCalledTimes(1);
    expect(listThreadIds).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        after: recoveryAnchor,
        pageToken: "page-2",
      })
    );
    expect(fetchThread).toHaveBeenCalledTimes(501);
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({
        historyId: "fresh-history-token",
        historyRecoveryAnchor: null,
        historyRecoveryPageToken: null,
        historyRecoveryTargetToken: null,
      })
    );
  });

  it("checkpoints the next Gmail page when recovery reaches its batch bound", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(
      baseConnection({
        lastSyncedAt: new Date("2026-05-01T00:00:00.000Z"),
      })
    );
    let page = 0;
    const listThreadIds = vi.fn(async () => {
      page += 1;
      return {
        threadIds: [`thread-${page}`],
        nextPageToken: `page-${page + 1}`,
      };
    });
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => {
        throw new SyncTokenExpiredError("history token expired", 404);
      }),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token",
      })),
      getInitialSyncToken: vi.fn(async () => "fresh-history-token"),
      listThreadIds,
      fetchThread: vi.fn(async () => []),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(listThreadIds).toHaveBeenCalledTimes(10);
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({
        historyRecoveryPageToken: "page-11",
        historyRecoveryTargetToken: "fresh-history-token",
      })
    );
    expect(updateConnectionMock).not.toHaveBeenCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "fresh-history-token" })
    );
    expect(state.activities).toHaveLength(0);
  });

  it("replays a bounded Microsoft 365 overlap before committing fresh folder cursors", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [{ id: "opp-m365-recovered", stage: "new_lead" }],
      threadLinks: [
        {
          opportunity_id: "opp-m365-recovered",
          thread_id: "thread-m365-recovered",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      correspondenceEvents: [],
      rpcCalls: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(
      baseConnection({
        provider: "microsoft365",
        lastSyncedAt: new Date("2026-05-20T17:00:00.000Z"),
      })
    );
    const initialToken = 'm365:v1:{"inboxDeltaLink":"","sentDeltaLink":""}';
    const inboxToken =
      'm365:v1:{"inboxDeltaLink":"fresh-inbox","sentDeltaLink":""}';
    const completeToken =
      'm365:v1:{"inboxDeltaLink":"fresh-inbox","sentDeltaLink":"fresh-sent"}';
    const getInitialSyncToken = vi.fn(async () => initialToken);
    const fetchNewEmailsSince = vi
      .fn()
      .mockRejectedValueOnce(
        new SyncTokenExpiredError("delta token expired", 410)
      )
      .mockResolvedValueOnce({
        emails: [
          baseEmail({
            id: "msg-m365-recovered",
            threadId: "thread-m365-recovered",
            from: "Customer <customer@example.com>",
            fromName: "Customer",
            to: ["jackson@canprodeckandrail.com"],
            labelIds: ["INBOX"],
            date: new Date("2026-05-20T17:05:00.000Z"),
          }),
        ],
        nextSyncToken: inboxToken,
      });
    const fetchSentEmailsSince = vi.fn(async () => ({
      emails: [],
      nextSyncToken: completeToken,
    }));
    getProviderMock.mockReturnValue({
      providerType: "microsoft365",
      fetchNewEmailsSince,
      fetchSentEmailsSince,
      getInitialSyncToken,
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(getInitialSyncToken).toHaveBeenCalledTimes(1);
    expect(fetchNewEmailsSince).toHaveBeenNthCalledWith(2, initialToken);
    expect(fetchSentEmailsSince).toHaveBeenCalledWith(inboxToken);
    expect(state.activities.map((row) => row.email_message_id)).toEqual([
      "msg-m365-recovered",
    ]);
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: completeToken })
    );
  });

  it("bootstraps and commits both Microsoft 365 folder cursors in sequence", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(
      baseConnection({
        provider: "microsoft365",
        historyId: null,
        lastSyncedAt: null,
      })
    );

    const initialToken = 'm365:v1:{"inboxDeltaLink":"","sentDeltaLink":""}';
    const inboxToken =
      'm365:v1:{"inboxDeltaLink":"inbox-1","sentDeltaLink":""}';
    const completeToken =
      'm365:v1:{"inboxDeltaLink":"inbox-1","sentDeltaLink":"sent-1"}';
    const getInitialSyncToken = vi.fn(async () => initialToken);
    const fetchNewEmailsSince = vi.fn(async (token: string) => {
      expect(token).toBe(initialToken);
      return { emails: [], nextSyncToken: inboxToken };
    });
    const fetchSentEmailsSince = vi.fn(async (token: string) => {
      expect(token).toBe(inboxToken);
      return { emails: [], nextSyncToken: completeToken };
    });
    getProviderMock.mockReturnValue({
      providerType: "microsoft365",
      getInitialSyncToken,
      fetchNewEmailsSince,
      fetchSentEmailsSince,
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(getInitialSyncToken).toHaveBeenCalledTimes(1);
    expect(fetchNewEmailsSince).toHaveBeenCalledTimes(1);
    expect(fetchSentEmailsSince).toHaveBeenCalledTimes(1);
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: completeToken })
    );
  });

  it("leaves both recovery cursors unadvanced when a recovered activity insert fails", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [{ id: "opp-linked", stage: "new_lead" }],
      threadLinks: [
        {
          opportunity_id: "opp-linked",
          thread_id: "thread-linked",
          connection_id: "connection-1",
        },
      ],
      activities: [],
      activityInsertError: "activities write unavailable",
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(
      baseConnection({ lastSyncedAt: new Date("2026-05-20T17:00:00.000Z") })
    );
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => {
        throw new SyncTokenExpiredError("history token expired", 404);
      }),
      fetchSentEmailsSince: vi.fn(async () => ({
        emails: [],
        nextSyncToken: "sync-token",
      })),
      getInitialSyncToken: vi.fn(async () => "fresh-history-token"),
      listThreadIds: vi.fn(async () => ({
        threadIds: [
          "thread-linked",
          ...Array.from(
            { length: 499 },
            (_, index) => `thread-empty-${index + 1}`
          ),
        ],
        nextPageToken: "page-2",
      })),
      fetchThread: vi.fn(async (threadId: string) =>
        threadId === "thread-linked"
          ? [
              baseEmail({
                id: "message-write-failure",
                threadId,
                from: "Customer <customer@example.com>",
                fromName: "Customer",
                to: ["jackson@canprodeckandrail.com"],
                subject: "Estimate follow-up",
                labelIds: ["INBOX"],
              }),
            ]
          : []
      ),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors.join(" ")).toContain("activities write unavailable");
    expect(updateConnectionMock).toHaveBeenCalledTimes(1);
    expect(updateConnectionMock).toHaveBeenLastCalledWith(
      "connection-1",
      expect.objectContaining({
        historyRecoveryPageToken: null,
        historyRecoveryTargetToken: "fresh-history-token",
      })
    );
    expect(updateConnectionMock).not.toHaveBeenCalledWith(
      "connection-1",
      expect.objectContaining({ historyRecoveryPageToken: "page-2" })
    );
    expect(updateConnectionMock).not.toHaveBeenCalledWith(
      "connection-1",
      expect.objectContaining({ historyId: "fresh-history-token" })
    );
    expect(state.activities).toHaveLength(0);
  });
});

describe("buildEmailOpportunityTitle unsafe identity filtering", () => {
  it("rejects operator, company, and platform identities before using a safe local part", () => {
    expect(
      buildEmailOpportunityTitle({
        kind: "email_inquiry",
        candidates: [
          {
            source: "contact_form",
            name: "North Ridge Exteriors",
            email: "operator@north-ridge.test",
          },
          {
            source: "inbound_sender",
            name: "Wix Forms",
            email: "notifications@wix-forms.com",
          },
          {
            source: "contact",
            name: "Riley Operator",
            email: "operator@north-ridge.test",
          },
          {
            source: "contact",
            name: null,
            email: "mara.hill@example.com",
          },
        ],
        unsafe: {
          names: ["Riley Operator"],
          emails: ["operator@north-ridge.test"],
          domains: ["north-ridge.test"],
          platformEmails: ["notifications@wix-forms.com"],
        },
      })
    ).toBe("Mara Hill — Email Inquiry");
  });

  it("uses New Lead only when every available identity is unsafe", () => {
    expect(
      buildEmailOpportunityTitle({
        kind: "email_inquiry",
        candidates: [
          {
            source: "inbound_sender",
            name: "North Ridge Exteriors",
            email: "operator@north-ridge.test",
          },
          {
            source: "inbound_sender",
            name: "Wix Forms",
            email: "notifications@wix-forms.com",
          },
        ],
        unsafe: {
          emails: ["operator@north-ridge.test"],
          domains: ["north-ridge.test"],
          platformEmails: ["notifications@wix-forms.com"],
        },
      })
    ).toBe("New Lead — Email Inquiry");
  });

  it("rejects company display names derived from unsafe company domains", () => {
    expect(
      buildEmailOpportunityTitle({
        kind: "email_inquiry",
        candidates: [
          {
            source: "inbound_sender",
            name: "North Ridge Exteriors",
            email: null,
          },
          {
            source: "contact",
            name: null,
            email: "mara.hill@example.com",
          },
        ],
        unsafe: {
          domains: ["north-ridge.test"],
        },
      })
    ).toBe("Mara Hill — Email Inquiry");
  });
});
