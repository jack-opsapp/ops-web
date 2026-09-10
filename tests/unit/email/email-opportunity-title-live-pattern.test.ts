import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { EmailConnection } from "@/lib/types/email-connection";
import type {
  AIClassifiedLead,
  AIReviewResult,
} from "@/lib/api/services/ai-sync-reviewer";

const {
  getConnectionMock,
  getProviderMock,
  updateConnectionMock,
  matchMock,
  buildBlocklistMock,
  shouldFilterMock,
  reviewUnmatchedEmailsMock,
  evaluateStagesWithSummaryMock,
  refreshLeadSummariesForOpportunitiesMock,
  upsertFromEmailMock,
} = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  updateConnectionMock: vi.fn(),
  matchMock: vi.fn(),
  buildBlocklistMock: vi.fn(),
  shouldFilterMock: vi.fn(),
  reviewUnmatchedEmailsMock: vi.fn(),
  evaluateStagesWithSummaryMock: vi.fn(),
  refreshLeadSummariesForOpportunitiesMock: vi.fn(),
  upsertFromEmailMock: vi.fn(),
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
    classifyAndUpdate: vi.fn(),
  },
}));

vi.mock("@/lib/api/services/lead-summary-service", () => ({
  refreshLeadSummariesForOpportunities:
    refreshLeadSummariesForOpportunitiesMock,
}));

vi.mock("@/lib/api/services/autonomy-milestone-service", () => ({
  AutonomyMilestoneService: {
    checkMilestonesAfterSync: vi.fn(),
  },
}));

import { SyncEngine } from "@/lib/api/services/sync-engine";

interface SupabaseState {
  clients: Array<Record<string, unknown>>;
  opportunities: Array<Record<string, unknown>>;
  threadLinks: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  subClients?: Array<Record<string, unknown>>;
  reviewAudits?: Array<Record<string, unknown>>;
}

function makeSupabaseDouble(state: SupabaseState) {
  class Query {
    private action: "select" | "insert" | "update" | "upsert" = "select";
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

    in(column: string, values: unknown[]) {
      this.filters.set(`${column}:in`, values);
      return this;
    }

    or(value: string) {
      this.filters.set("or", value);
      return this;
    }

    not(column: string, operator: string, value: unknown) {
      this.filters.set(`${column}:${operator}`, value);
      return this;
    }

    order() {
      return this;
    }

    limit() {
      return this;
    }

    range() {
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.action = "insert";
      if (this.table === "clients") {
        state.clients.push({
          id: `client-${state.clients.length + 1}`,
          ...payload,
        });
      }
      if (this.table === "opportunities") {
        state.opportunities.push({
          id: `opp-${state.opportunities.length + 1}`,
          created_at: "2026-05-25T00:00:00.000Z",
          updated_at: "2026-05-25T00:00:00.000Z",
          stage_entered_at: "2026-05-25T00:00:00.000Z",
          ...payload,
        });
      }
      if (this.table === "activities") {
        state.activities.push({
          id: `activity-${state.activities.length + 1}`,
          ...payload,
        });
      }
      return this;
    }

    update() {
      this.action = "update";
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      this.action = "upsert";
      if (this.table === "lead_classification_reviews") {
        const rows = (state.reviewAudits ??= []);
        const existing = rows.find(
          (row) => row.provider_message_id === payload.provider_message_id
        );
        if (existing) Object.assign(existing, payload);
        else rows.push(payload);
      }
      if (this.table === "opportunity_email_threads")
        state.threadLinks.push(payload);
      return this;
    }

    async single() {
      if (this.table === "clients" && this.action === "insert") {
        return { data: state.clients.at(-1), error: null };
      }
      if (this.table === "opportunities" && this.action === "insert") {
        return { data: state.opportunities.at(-1), error: null };
      }
      if (this.table === "activities" && this.action === "insert") {
        return { data: state.activities.at(-1), error: null };
      }
      if (this.table === "companies") {
        return {
          data: { name: "Canpro Deck and Rail", industry: "deck and rail" },
          error: null,
        };
      }
      return { data: null, error: null };
    }

    async maybeSingle() {
      if (this.table === "activities") {
        return {
          data:
            state.activities.find((row) =>
              [...this.filters].every(
                ([key, value]) => (row[key] ?? null) === value
              )
            ) ?? null,
          error: null,
        };
      }
      if (this.table === "companies") {
        return {
          data: {
            id: "company-1",
            name: "Canpro Deck and Rail",
            email: "canprojack@gmail.com",
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
        const id = this.filters.get("id");
        const opportunity =
          state.opportunities.find((row) => row.id === id) ?? null;
        return { data: opportunity, error: null };
      }
      if (this.table === "opportunity_email_threads") {
        const link =
          state.threadLinks.find(
            (row) =>
              row.thread_id === this.filters.get("thread_id") &&
              row.connection_id === this.filters.get("connection_id")
          ) ?? null;
        return { data: link, error: null };
      }
      return { data: null, error: null };
    }

    private result() {
      if (this.table === "email_connections" && this.action === "update") {
        return { data: [{ id: "connection-1" }], error: null };
      }
      if (this.table === "activities" && this.action === "select")
        return {
          data: state.activities.filter((row) =>
            [...this.filters].every(
              ([key, value]) => (row[key] ?? null) === value
            )
          ),
          error: null,
        };
      const rows =
        this.table === "clients"
          ? state.clients
          : this.table === "sub_clients"
            ? state.subClients
            : this.table === "projects"
              ? state.projects
              : this.table === "opportunities"
                ? state.opportunities
                : undefined;
      if (rows && this.action === "select") {
        return {
          data: rows.filter((row) =>
            [...this.filters].every(([key, value]) => {
              if (key.endsWith(":in") && Array.isArray(value))
                return value.includes(row[key.slice(0, -3)]);
              if (key === "or" || key.includes(":")) return true;
              return (row[key] ?? null) === value;
            })
          ),
          error: null,
        };
      }
      if (
        this.table === "opportunity_email_threads" &&
        this.action === "select"
      ) {
        return {
          data: state.threadLinks.filter(
            (row) =>
              row.thread_id === this.filters.get("thread_id") &&
              row.connection_id === this.filters.get("connection_id")
          ),
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
    rpc: vi.fn(async (name: string, params: Record<string, unknown> = {}) => {
      if (name === "route_email_work_correspondence_as_system") {
        const activity = state.activities.find(
          (row) =>
            row.id === params.p_activity_id &&
            row.email_message_id === params.p_provider_message_id &&
            row.email_thread_id === params.p_provider_thread_id &&
            row.email_connection_id === params.p_connection_id &&
            row.company_id === params.p_company_id &&
            !row.opportunity_id
        );
        if (!activity) throw new Error("work routing source mismatch");
        activity.match_confidence = params.p_needs_review
          ? "work_intent_review"
          : "existing_job";
        activity.match_needs_review = params.p_needs_review;
        activity.client_id = params.p_client_id;
        activity.project_id = params.p_project_id;
        return { data: true, error: null };
      }
      if (name === "acquire_email_connection_sync_lock_as_system") {
        return {
          data: "00000000-0000-4000-8000-000000000001",
          error: null,
        };
      }
      if (
        name === "renew_email_connection_sync_lock_as_system" ||
        name === "release_email_connection_sync_lock_as_system" ||
        name === "persist_email_connection_recovery_checkpoint_as_system" ||
        name === "persist_email_connection_sync_completion_as_system"
      ) {
        return { data: true, error: null };
      }
      if (name === "create_company_mailbox_email_opportunity_as_system") {
        const payload = params.p_opportunity as Record<string, unknown>;
        const opportunityId = `opp-${state.opportunities.length + 1}`;
        state.opportunities.push({
          id: opportunityId,
          company_id: "company-1",
          created_at: "2026-05-25T00:00:00.000Z",
          updated_at: "2026-05-25T00:00:00.000Z",
          stage_entered_at: "2026-05-25T00:00:00.000Z",
          correspondence_count: 0,
          inbound_count: 0,
          outbound_count: 0,
          assignment_version: 0,
          assigned_to: null,
          source: "email",
          ...payload,
        });
        return {
          data: {
            ok: true,
            created: true,
            reason: "created_prompted",
            opportunity: {
              id: opportunityId,
              client_id: payload.client_id,
              assigned_to: null,
              assignment_version: 0,
            },
            assignment: {
              outcome: "owner_missing",
              event_id: null,
              prompt_count: 1,
            },
          },
          error: null,
        };
      }
      if (name === "record_opportunity_correspondence_event") {
        const opportunity = state.opportunities.find(
          (row) => row.id === params.p_opportunity_id
        );
        if (!opportunity) {
          return {
            data: null,
            error: { code: "P0002", message: "opportunity_not_found" },
          };
        }
        opportunity.assignment_version ??= 0;
        opportunity.stage_manually_set ??= false;
        opportunity.correspondence_count ??= 0;
        opportunity.inbound_count ??= 0;
        opportunity.outbound_count ??= 0;
        if (params.p_apply_opportunity_projection === true) {
          opportunity.correspondence_count =
            Number(opportunity.correspondence_count) + 1;
          if (params.p_direction === "inbound") {
            opportunity.inbound_count = Number(opportunity.inbound_count) + 1;
            opportunity.last_inbound_at = params.p_occurred_at;
            opportunity.last_message_direction = "in";
          } else {
            opportunity.outbound_count = Number(opportunity.outbound_count) + 1;
            opportunity.last_outbound_at = params.p_occurred_at;
            opportunity.last_message_direction = "out";
          }
        }
        return {
          data: [{ created: true, event_id: "event-1" }],
          error: null,
        };
      }
      if (name === "reconcile_manual_outbound_follow_up_cycle_as_system") {
        return {
          data: [
            {
              correspondence_event_id: params.p_correspondence_event_id,
              opportunity_id: params.p_opportunity_id,
            },
          ],
          error: null,
        };
      }
      return {
        data:
          name === "apply_opportunity_correspondence_event"
            ? [
                {
                  changed: true,
                  correspondence_count: 1,
                  inbound_count: 0,
                  outbound_count: 1,
                  stage: "qualifying",
                  stage_manually_set: false,
                  assignment_version: 0,
                  last_message_direction: "out",
                  last_inbound_at: null,
                  last_outbound_at: "2026-05-25T23:05:00.000Z",
                },
              ]
            : name === "apply_email_opportunity_stage_transition"
              ? [{ changed: true }]
              : null,
        error: null,
      };
    }),
  };
}

function baseConnection(): EmailConnection {
  return {
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
    type: "company",
    userId: null,
    email: "canprojack@gmail.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2026-05-25T00:00:00.000Z"),
    historyId: "sync-token",
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 15,
    syncFilters: {
      includeSentMail: true,
      estimateSubjectPatterns: ["Canpro Deck and Rail Estimate"],
      companyDomains: ["canprodeckandrail.com"],
      userEmailAddresses: [],
      teamForwarders: ["victoria@canprodeckandrail.com"],
    },
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: new Date("2026-05-25T00:00:00.000Z"),
    updatedAt: new Date("2026-05-25T00:00:00.000Z"),
  };
}

function sentEstimateEmail(): NormalizedEmail {
  return {
    id: "msg-live-pattern",
    threadId: "thread-live-pattern",
    from: "Jackson Sweet <canprojack@gmail.com>",
    fromName: "Jackson Sweet",
    to: ["runningemu@gmail.com"],
    cc: [],
    subject: "Canpro Deck and Rail Estimate",
    snippet: "Estimate details",
    bodyText: "Hi Michael, thanks for your email.",
    date: new Date("2026-05-25T23:05:00.000Z"),
    labelIds: ["SENT"],
    isRead: true,
    hasAttachments: false,
    sizeEstimate: 1200,
  };
}

function inboundEmail(
  overrides: Partial<NormalizedEmail> = {}
): NormalizedEmail {
  return {
    ...sentEstimateEmail(),
    id: "1a087598ed43106a",
    threadId: "1a087598ed43106a",
    from: "wix-team@notification.wix.com",
    fromName: "Wix",
    to: ["canprojack@gmail.com"],
    subject: "You've been assigned as a post author",
    bodyText:
      "You’ve been assigned as an author of a post\r\n\r\nFor more details, contact the site owner.",
    snippet: "You’ve been assigned as an author of a post",
    labelIds: ["INBOX"],
    ...overrides,
  };
}

function formEmail(
  message = "Please quote a new deck at 123 Main Street."
): NormalizedEmail {
  return inboundEmail({
    from: "Wix Forms <no-reply@wixforms.com>",
    authenticatedFromDomains: ["wixforms.com"],
    subject: "Free Quote form got a new submission",
    bodyText: `A site visitor just submitted your form.\nSubmission summary:\nName: Michael Green\nEmail: michael@example.com\nPhone: 2505550101\nMessage: ${message}`,
  });
}

function classifiedLead(
  email: NormalizedEmail,
  overrides: Partial<AIClassifiedLead> = {}
): AIClassifiedLead {
  return {
    email,
    clientName: "Michael Green",
    clientEmail: "michael@example.com",
    clientPhone: null,
    address: null,
    description: "New deck inquiry",
    stage: "new_lead",
    terminalFlag: null,
    estimatedValue: null,
    confidence: 0.95,
    workIntent: "new_work",
    newWorkEvidence: "Please quote a new deck at 123 Main Street.",
    ...overrides,
  };
}

async function runEmail(
  email: NormalizedEmail,
  leads: AIClassifiedLead[] = [],
  initialState: Partial<SupabaseState> = {},
  deferredClassifications: AIReviewResult["deferredClassifications"] = []
) {
  const state: SupabaseState = {
    clients: [],
    opportunities: [],
    threadLinks: [],
    activities: [],
    ...initialState,
  };
  setSupabaseOverride(makeSupabaseDouble(state) as never);
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
  matchMock.mockResolvedValue({ action: "create_new", clientId: null });
  reviewUnmatchedEmailsMock.mockResolvedValue({
    classifiedLeads: leads,
    newLeadsClassified: leads.length,
    deferredClassifications,
  });
  const result = await SyncEngine.runSync("connection-1");
  expect(result.errors).toEqual([]);
  return { state, result };
}

describe("SyncEngine automatic lead creation", () => {
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
    refreshLeadSummariesForOpportunitiesMock.mockReset();
    refreshLeadSummariesForOpportunitiesMock.mockResolvedValue({
      requested: 0,
      attempted: 0,
      written: 0,
      skippedFeatureDisabled: false,
      failed: [],
      deferred: [],
      remainingOpportunityIds: [],
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

  it("retains a sent estimate-subject email without creating a client or lead", async () => {
    const state: SupabaseState = {
      clients: [],
      opportunities: [],
      threadLinks: [],
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    getConnectionMock.mockResolvedValue(baseConnection());
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince: vi.fn(async () => ({
        emails: [sentEstimateEmail()],
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
    expect(state.opportunities).toHaveLength(0);
    expect(state.clients).toHaveLength(0);
    expect(state.activities).toContainEqual(
      expect.objectContaining({
        email_message_id: "msg-live-pattern",
        opportunity_id: null,
        direction: "outbound",
      })
    );
  });

  it("keeps the exact Wix author notification in the inbox with zero sales records", async () => {
    const email = inboundEmail();
    const { state, result } = await runEmail(email);
    expect(state.clients).toHaveLength(0);
    expect(state.opportunities).toHaveLength(0);
    expect(result.newLeads).toBe(0);
    expect(upsertFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ email, direction: "inbound" })
    );
  });

  it("does not treat a Google review notification as a new inquiry", async () => {
    const { state } = await runEmail(
      inboundEmail({
        from: "businessprofile-noreply@google.com",
        subject: "You received a new review",
        bodyText: "A customer left your business a review.",
      })
    );
    expect(state.clients).toHaveLength(0);
    expect(state.opportunities).toHaveLength(0);
  });

  it.each([
    {
      from: "Customer <customer@example.com>",
      subject: "Re: Canpro Deck and Rail Estimate",
    },
    {
      from: "Office Victoria <victoria@canprodeckandrail.com>",
      subject: "Fwd: Free Quote form got a new submission",
    },
  ])(
    "requires inquiry evidence despite a matching subject/forwarder: $subject",
    async (headers) => {
      const { state } = await runEmail(
        inboundEmail({
          ...headers,
          bodyText: "Your account notification settings have changed.",
        })
      );
      expect(state.clients).toHaveLength(0);
      expect(state.opportunities).toHaveLength(0);
    }
  );

  it("cannot use a quoted old inquiry to create a fresh lead", async () => {
    const email = inboundEmail({
      from: "Michael Green <michael@example.com>",
      subject: "Re: Deck",
      bodyText:
        "It's all good to go. I'm at home today if you need anything.\n\nOn Tue, Michael wrote:\n> Please quote a new deck at 123 Main Street.",
    });
    const { state } = await runEmail(email, [classifiedLead(email)]);
    expect(state.clients).toHaveLength(0);
    expect(state.opportunities).toHaveLength(0);
    expect(state.activities).toContainEqual(
      expect.objectContaining({ match_confidence: "work_intent_review" })
    );
  });

  it.each([undefined, null, "This is an invented quote request."])(
    "holds a new customer classification with invalid evidence: %s",
    async (newWorkEvidence) => {
      const email = inboundEmail({
        from: "Michael Green <michael@example.com>",
        fromName: "Michael Green",
        subject: "Hello",
        bodyText: "Can you call me?",
      });
      const { state } = await runEmail(email, [
        classifiedLead(email, { newWorkEvidence }),
      ]);
      expect(state.clients).toHaveLength(0);
      expect(state.opportunities).toHaveLength(0);
      expect(state.activities).toContainEqual(
        expect.objectContaining({
          opportunity_id: null,
          match_confidence: "work_intent_review",
        })
      );
    }
  );

  it("retains an unclassified contact form in review without creating a lead", async () => {
    const { state } = await runEmail(
      formEmail(
        "The railing you installed is loose. Please arrange a warranty visit."
      )
    );
    expect(state.clients).toHaveLength(0);
    expect(state.opportunities).toHaveLength(0);
    expect(state.activities).toContainEqual(
      expect.objectContaining({
        opportunity_id: null,
        match_confidence: "work_intent_review",
      })
    );
  });

  it("retains the full source of a borderline form alongside its prior audit, once across replay", async () => {
    const email = formEmail();
    const deferred: NonNullable<AIReviewResult["deferredClassifications"]> = [
      {
        email,
        baseline: { verdict: "lead", confidence: 0.55 },
        decision: {
          outcome: "defer",
          adjustedLeadScore: 0.55,
          adjustment: 0,
          reviewReason: "borderline_confidence",
          appliedFeedbackIds: [],
          evidence: {
            exactMessage: false,
            exactThread: false,
            senderNegativeIndependentCount: 0,
            domainNegativeIndependentThreadCount: 0,
            domainNegativeIndependentSenderCount: 0,
            domainMature: false,
            hasSuppressionAuthority: false,
          },
        },
      },
    ];
    const first = await runEmail(email, [], {}, deferred);
    expect(first.state.opportunities).toHaveLength(0);
    expect(first.state.clients).toHaveLength(0);
    expect(first.result.needsReview).toBe(1);
    expect(first.state.reviewAudits).toHaveLength(1);
    expect(first.state.activities).toContainEqual(
      expect.objectContaining({
        email_message_id: email.id,
        body_text: email.bodyText,
        match_confidence: "work_intent_review",
      })
    );
    const replay = await runEmail(email, [], first.state, deferred);
    expect(replay.state.reviewAudits).toHaveLength(1);
    expect(replay.state.activities).toHaveLength(1);
    expect(replay.state.opportunities).toHaveLength(0);
  });

  it("creates a genuine form inquiry only with current-message new-work evidence", async () => {
    const email = formEmail();
    const { state, result } = await runEmail(email, [classifiedLead(email)]);
    expect(result.newLeads).toBe(1);
    expect(state.opportunities).toHaveLength(1);
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0].email).toBe("michael@example.com");
    expect(state.opportunities[0].title).toBe("Michael Green — Email Inquiry");
  });

  it("replays a genuine form without creating another client, lead, or activity", async () => {
    const email = formEmail();
    const first = await runEmail(email, [classifiedLead(email)]);
    const replay = await runEmail(email, [], first.state);
    expect(replay.result.newLeads).toBe(0);
    expect(replay.state.clients).toHaveLength(1);
    expect(replay.state.opportunities).toHaveLength(1);
    expect(replay.state.activities).toHaveLength(1);
  });

  it.each(["inbound", "outbound"])(
    "attaches a %s reply to an existing sales thread without creating another lead",
    async (direction) => {
      const inquiry = inboundEmail({
        from: "Michael Green <michael@example.com>",
        fromName: "Michael Green",
        subject: "Deck quote",
        bodyText: "Please quote a new deck at 123 Main Street.",
      });
      const first = await runEmail(inquiry, [classifiedLead(inquiry)]);
      const reply = {
        ...inquiry,
        id: "1a087598ed43106b",
        bodyText: "Tuesday works for the visit.",
        ...(direction === "outbound"
          ? {
              from: "Jackson Sweet <canprojack@gmail.com>",
              to: ["michael@example.com"],
              labelIds: ["SENT"],
            }
          : {}),
      };
      const next = await runEmail(reply, [], first.state);
      expect(next.result.newLeads).toBe(0);
      expect(next.state.clients).toHaveLength(1);
      expect(next.state.opportunities).toHaveLength(1);
      expect(next.state.activities).toContainEqual(
        expect.objectContaining({
          email_message_id: reply.id,
          opportunity_id: first.state.opportunities[0].id,
          direction,
        })
      );
    }
  );

  it("routes a warranty form to the customer's existing project without creating a sale", async () => {
    const email = formEmail(
      "The railing you installed is loose. Please arrange a warranty visit."
    );
    const { state, result } = await runEmail(
      email,
      [
        classifiedLead(email, {
          workIntent: "existing_job",
          newWorkEvidence: null,
        }),
      ],
      {
        clients: [
          {
            id: "client-existing",
            company_id: "company-1",
            name: "Michael Green",
            email: "michael@example.com",
          },
        ],
        projects: [
          {
            id: "project-existing",
            client_id: "client-existing",
            company_id: "company-1",
            status: "in_progress",
            address: null,
          },
        ],
      }
    );
    expect(result.newLeads).toBe(0);
    expect(state.clients).toHaveLength(1);
    expect(state.opportunities).toHaveLength(0);
    expect(state.activities).toContainEqual(
      expect.objectContaining({
        opportunity_id: null,
        project_id: "project-existing",
        client_id: "client-existing",
        match_confidence: "existing_job",
      })
    );
    const replay = await runEmail(email, [], state);
    expect(replay.state.activities).toHaveLength(1);
    expect(replay.state.opportunities).toHaveLength(0);
  });

  it("routes a subcontact's crew-damage email to the existing job even with no sales record", async () => {
    const email = inboundEmail({
      from: "Tenant Contact <tenant@example.com>",
      fromName: "Tenant Contact",
      subject: "Damage during deck work",
      bodyText:
        "The crew damaged a baby gate during the deck job. Can I pay for the replacement and deduct it from the existing bill?",
    });
    const { state, result } = await runEmail(
      email,
      [
        classifiedLead(email, {
          workIntent: "existing_job",
          newWorkEvidence: null,
        }),
      ],
      {
        clients: [
          {
            id: "client-owner",
            company_id: "company-1",
            name: "Property Owner",
            email: "owner@example.com",
          },
        ],
        subClients: [
          {
            id: "sub-tenant",
            company_id: "company-1",
            client_id: "client-owner",
            email: "tenant@example.com",
          },
        ],
        projects: [
          {
            id: "project-deck",
            client_id: "client-owner",
            company_id: "company-1",
            status: "in_progress",
            address: null,
          },
        ],
      }
    );
    expect(result.newLeads).toBe(0);
    expect(state.clients).toHaveLength(1);
    expect(state.opportunities).toHaveLength(0);
    expect(state.activities).toContainEqual(
      expect.objectContaining({
        opportunity_id: null,
        project_id: "project-deck",
        client_id: "client-owner",
        match_confidence: "existing_job",
      })
    );
  });
});
