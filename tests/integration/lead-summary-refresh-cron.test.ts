/**
 * Integration tests for the lead AI summary coverage extension:
 * `runLeadSummaryRefresh` (lead-summary-service) and
 * `/api/cron/lead-summary-refresh` (GET recurring; bulk POST is disabled).
 *
 * Covers:
 *   - staleness: engine stage-transition echo inside the 5-minute epsilon is
 *     NOT stale; a note beyond it IS; NULL-stamp legacy summaries heal
 *   - eligibility: bare name-only leads are skipped (insufficient context),
 *     never sent to the model
 *   - write path: service-role guarded snapshot RPC; no direct opportunity
 *     update and no assignment/stage mutation
 *   - model contract: gpt-4o-mini / temp 0.1 / strict json_schema singleton;
 *     one retry on contract error; per-lead failure isolation
 *   - budget: stalest-first ordering under maxLeadsPerRun
 *   - route: auth gates, LEAD_SUMMARY_REFRESH_ENABLED gate, and no bulk
 *     historical backfill entry point
 *
 * The Supabase client is mocked at the chain level (same approach as
 * lead-lifecycle-cron.test.ts); OpenAI and the phase_c gate are module mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Module mocks ────────────────────────────────────────────────────────────

const openAICreateMock = vi.fn();
vi.mock("@/lib/api/services/openai-clients", () => ({
  getSyncOpenAI: () => ({
    chat: { completions: { create: openAICreateMock } },
  }),
}));

const isAIFeatureEnabledMock = vi.fn(
  async (_companyId: string, _feature: string) => true
);
vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: (companyId: string, feature: string) =>
      isAIFeatureEnabledMock(companyId, feature),
  },
}));

const supabaseFromMock = vi.fn();
const supabaseRpcMock = vi.fn();
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: supabaseFromMock,
    rpc: supabaseRpcMock,
  }),
}));

import {
  runLeadSummaryRefresh,
  refreshLeadSummariesForOpportunities,
  evaluateLeadStaleness,
  computeLeadContextAggregates,
  buildLeadSummaryContext,
  LEAD_SUMMARY_STALENESS_EPSILON_MS,
} from "@/lib/api/services/lead-summary-service";
import { GET, POST } from "@/app/api/cron/lead-summary-refresh/route";

// ─── Chain-level Supabase mock ──────────────────────────────────────────────

type RecordedFilter = [string, string, unknown];

interface TableConfig {
  rows?: unknown[];
  maybeSingleRow?: unknown;
  error?: { message: string } | null;
  updateError?: { message: string } | null;
}

let tables: Record<string, TableConfig>;
let selectCalls: Array<{ table: string; filters: RecordedFilter[] }>;
let updateCalls: Array<{
  table: string;
  payload: Record<string, unknown>;
  filters: RecordedFilter[];
}>;

function makeChain(table: string) {
  const cfg = tables[table] ?? {};
  const filters: RecordedFilter[] = [];
  selectCalls.push({ table, filters });
  const resolveSelect = () => {
    let rows = cfg.rows ?? [];
    for (const [kind, column, value] of filters) {
      if (kind !== "in" || !Array.isArray(value)) continue;
      rows = rows.filter((row) => {
        if (!row || typeof row !== "object") return false;
        return value.includes((row as Record<string, unknown>)[column]);
      });
    }
    return {
      data: cfg.error ? null : rows,
      error: cfg.error ?? null,
    };
  };
  const chain: any = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push(["eq", column, value]);
      return chain;
    },
    is: (column: string, value: unknown) => {
      filters.push(["is", column, value]);
      return chain;
    },
    in: (column: string, value: unknown) => {
      filters.push(["in", column, value]);
      return chain;
    },
    not: (column: string, operator: string, value: unknown) => {
      filters.push(["not", column, `${operator}:${String(value)}`]);
      return chain;
    },
    order: () => chain,
    limit: async () => resolveSelect(),
    range: async (from: number, to: number) => {
      const result = resolveSelect();
      return {
        data: result.data?.slice(from, to + 1) ?? null,
        error: result.error,
      };
    },
    maybeSingle: async () => ({
      data: cfg.error ? null : (cfg.maybeSingleRow ?? null),
      error: cfg.error ?? null,
    }),
    then: (resolve: (value: unknown) => unknown) => resolve(resolveSelect()),
    update: (payload: Record<string, unknown>) => {
      const call = { table, payload, filters: [] as RecordedFilter[] };
      updateCalls.push(call);
      const updateChain: any = {
        eq: (column: string, value: unknown) => {
          call.filters.push(["eq", column, value]);
          return updateChain;
        },
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: null, error: cfg.updateError ?? null }),
      };
      return updateChain;
    },
  };
  return chain;
}

const mockSupabase = {
  from: (table: string) => makeChain(table),
  rpc: (...args: unknown[]) => supabaseRpcMock(...args),
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const OPP_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OPP_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const NOW = new Date("2026-07-21T20:00:00.000Z");
const STAMP = "2026-07-21T10:00:00.000Z";
const STAMP_MS = Date.parse(STAMP);

function opportunityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OPP_A,
    company_id: COMPANY_ID,
    client_id: "client-1",
    title: "Jane Doe — Email Inquiry",
    stage: "qualifying",
    stage_entered_at: "2026-07-01T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    contact_name: "Jane Doe",
    contact_email: "jane@example.com",
    address: "123 Main St",
    source: "phone",
    description: null,
    estimated_value: null,
    detected_value: null,
    actual_value: null,
    ai_summary: null,
    ai_summary_updated_at: null,
    assignment_version: 0,
    correspondence_count: 0,
    updated_at: "2026-07-21T12:00:00.000Z",
    ...overrides,
  };
}

function noteActivity(opportunityId: string, createdAt: string) {
  return {
    id: `note-${opportunityId}-${createdAt}`,
    opportunity_id: opportunityId,
    type: "note",
    direction: null,
    subject: null,
    content: "Client confirmed they want composite decking, budget ~$12k.",
    body_text: null,
    body_text_clean: null,
    email_connection_id: null,
    email_message_id: null,
    email_thread_id: null,
    to_emails: null,
    cc_emails: null,
    outcome: null,
    duration_minutes: null,
    created_at: createdAt,
  };
}

function emailActivity(
  opportunityId: string,
  createdAt: string,
  body: string,
  direction: "inbound" | "outbound" = "inbound"
) {
  return {
    id: `email-${opportunityId}-${createdAt}`,
    opportunity_id: opportunityId,
    type: "email",
    direction,
    subject: "Deck quote",
    content: null,
    body_text: body,
    body_text_clean: body,
    email_connection_id: "22222222-2222-2222-2222-222222222222",
    email_message_id: `message-${createdAt}`,
    email_thread_id: "thread-1",
    to_emails:
      direction === "inbound" ? ["operator@canpro.ca"] : ["jane@example.com"],
    cc_emails: [],
    outcome: null,
    duration_minutes: null,
    created_at: createdAt,
  };
}

function correspondenceEvent(
  activity: ReturnType<typeof emailActivity>,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: `event-${activity.id}`,
    opportunity_id: activity.opportunity_id,
    activity_id: activity.id,
    connection_id: activity.email_connection_id,
    provider_thread_id: activity.email_thread_id,
    provider_message_id: activity.email_message_id,
    direction: activity.direction,
    party_role: activity.direction === "inbound" ? "customer" : "ops",
    from_email:
      activity.direction === "inbound"
        ? "jane@example.com"
        : "operator@canpro.ca",
    to_emails: activity.to_emails,
    cc_emails: activity.cc_emails,
    is_meaningful: true,
    opportunity_projection_applied: true,
    occurred_at: activity.created_at,
    created_at: activity.created_at,
    subject: activity.subject,
    ...overrides,
  };
}

function modelResponse(summary: string) {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: {
          refusal: null,
          content: JSON.stringify({ results: [{ tid: "k0", summary }] }),
        },
      },
    ],
  };
}

function baseTables(overrides: Record<string, TableConfig> = {}) {
  return {
    admin_feature_overrides: { rows: [{ company_id: COMPANY_ID }] },
    companies: { maybeSingleRow: { id: COMPANY_ID, name: "Canpro" } },
    opportunities: { rows: [] },
    clients: { rows: [] },
    sub_clients: { rows: [] },
    activities: { rows: [] },
    opportunity_correspondence_events: { rows: [] },
    stage_transitions: { rows: [] },
    site_visits: { rows: [] },
    email_threads: { rows: [] },
    ...overrides,
  };
}

beforeEach(() => {
  tables = baseTables();
  selectCalls = [];
  updateCalls = [];
  supabaseFromMock.mockReset();
  supabaseFromMock.mockImplementation((table: string) => makeChain(table));
  openAICreateMock.mockReset();
  openAICreateMock.mockResolvedValue(modelResponse("Generated summary."));
  supabaseRpcMock.mockReset();
  supabaseRpcMock.mockResolvedValue({
    data: [
      {
        changed: true,
        guard_reason: null,
        summary_updated_at: NOW.toISOString(),
      },
    ],
    error: null,
  });
  isAIFeatureEnabledMock.mockReset();
  isAIFeatureEnabledMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Pure helper behaviour ───────────────────────────────────────────────────

describe("evaluateLeadStaleness", () => {
  it("treats an engine stage-transition echo inside the epsilon as fresh", () => {
    const opp = opportunityRow({
      ai_summary: "Existing summary.",
      ai_summary_updated_at: STAMP,
    });
    const aggregates = computeLeadContextAggregates(opp, {
      activities: [],
      correspondenceEvents: [],
      stageTransitions: [
        {
          id: "transition-echo",
          opportunity_id: OPP_A,
          from_stage: "new_lead",
          to_stage: "qualifying",
          transitioned_at: new Date(STAMP_MS + 2_000).toISOString(),
        },
      ],
      siteVisits: [],
      threadSummaries: [],
    });
    expect(evaluateLeadStaleness(opp, aggregates)).toBe("fresh");
  });

  it("treats context beyond the epsilon as stale", () => {
    const opp = opportunityRow({
      ai_summary: "Existing summary.",
      ai_summary_updated_at: STAMP,
    });
    const aggregates = computeLeadContextAggregates(opp, {
      activities: [
        noteActivity(
          OPP_A,
          new Date(
            STAMP_MS + LEAD_SUMMARY_STALENESS_EPSILON_MS + 60_000
          ).toISOString()
        ),
      ],
      correspondenceEvents: [],
      stageTransitions: [],
      siteVisits: [],
      threadSummaries: [],
    });
    expect(evaluateLeadStaleness(opp, aggregates)).toBe("stale");
  });

  it("heals a legacy summary with a NULL stamp when context exists", () => {
    const opp = opportunityRow({
      ai_summary: "Legacy import seed",
      ai_summary_updated_at: null,
    });
    const aggregates = computeLeadContextAggregates(opp, {
      activities: [noteActivity(OPP_A, "2026-07-10T00:00:00.000Z")],
      correspondenceEvents: [],
      stageTransitions: [],
      siteVisits: [],
      threadSummaries: [],
    });
    expect(evaluateLeadStaleness(opp, aggregates)).toBe("stale");
  });

  it("waits for a new targeted event instead of backfilling a NULL summary", () => {
    const opp = opportunityRow({ ai_summary: null });
    const aggregates = computeLeadContextAggregates(opp, {
      activities: [noteActivity(OPP_A, "2026-07-10T00:00:00.000Z")],
      correspondenceEvents: [],
      stageTransitions: [],
      siteVisits: [],
      threadSummaries: [],
    });
    expect(evaluateLeadStaleness(opp, aggregates)).toBe("awaiting_event");
  });

  it("marks bare name-only leads as insufficient context", () => {
    const opp = opportunityRow();
    const aggregates = computeLeadContextAggregates(opp, {
      activities: [],
      correspondenceEvents: [],
      stageTransitions: [
        {
          id: "transition-creation",
          // Creation row only — from_stage null is not a real move.
          opportunity_id: OPP_A,
          from_stage: null,
          to_stage: "new_lead",
          transitioned_at: "2026-07-01T00:00:00.000Z",
        },
      ],
      siteVisits: [],
      threadSummaries: [],
    });
    expect(evaluateLeadStaleness(opp, aggregates)).toBe("insufficient_context");
  });
});

describe("buildLeadSummaryContext", () => {
  it("keeps the complete current 14-message conversation, preserves enough body context for revised scope, and carries the previous summary", () => {
    const longBody = "x".repeat(2_000);
    const activities = Array.from({ length: 14 }, (_, index) =>
      emailActivity(
        OPP_A,
        new Date(
          Date.parse("2026-07-01T00:00:00.000Z") + index * 3_600_000
        ).toISOString(),
        index === 13 ? longBody : `Message ${index}`
      )
    );
    const bundle = buildLeadSummaryContext(
      opportunityRow({
        ai_summary: "Previous summary text.",
        description: "Original inquiry about deck railing.",
      }) as never,
      {
        activities,
        correspondenceEvents: activities.map((activity) =>
          correspondenceEvent(activity)
        ),
        stageTransitions: [],
        siteVisits: [],
        threadSummaries: [
          {
            id: "thread-row-1",
            opportunity_id: OPP_A,
            connection_id: "22222222-2222-2222-2222-222222222222",
            provider_thread_id: "thread-1",
            ai_summary: "Thread-level summary from the inbox feature.",
            last_message_at: "2026-07-02T00:00:00.000Z",
          },
        ],
        customerEmails: ["jane@example.com"],
      }
    );
    expect(bundle).not.toBeNull();
    expect(bundle!.emails).toHaveLength(14);
    // Newest last, with materially more than the old 500-character window.
    const newest = bundle!.emails.at(-1)!;
    expect(newest.body!.length).toBeGreaterThan(500);
    expect(bundle!.emails[0].body).toBe("Message 0");
    expect(bundle!.lead.previous_summary).toBe("Previous summary text.");
    expect(bundle!.email_thread_summaries).toEqual([
      "Thread-level summary from the inbox feature.",
    ]);
  });

  it("carries Camille's current price, removed scope, confirmed schedule, and next action across the full conversation", () => {
    const messages = [
      "Installation is $1,200, or supply only is $880.",
      "I'll take you up on the installation offer for $1,200.",
      "Removal would bring the total to $1,400.",
      "My husband will remove the old railing, so we do not need removal. Is tomorrow still open?",
      "Tomorrow is good still.",
      "Amazing! I work from home tomorrow.",
    ];
    const activities = messages.map((body, index) =>
      emailActivity(
        OPP_A,
        new Date(
          Date.parse("2026-07-21T15:00:00.000Z") + index * 3_600_000
        ).toISOString(),
        body,
        index % 2 === 0 ? "outbound" : "inbound"
      )
    );
    const bundle = buildLeadSummaryContext(
      opportunityRow({
        title: "Camille Ottenhof — Email Inquiry",
        stage: "negotiation",
        ai_summary:
          "Camille is considering $1,400 including removal and is waiting on scheduling.",
        estimated_value: 1_200,
      }) as never,
      {
        activities,
        correspondenceEvents: activities.map((activity) =>
          correspondenceEvent(activity as ReturnType<typeof emailActivity>)
        ),
        stageTransitions: [],
        siteVisits: [],
        threadSummaries: [
          {
            id: "thread-row-2",
            opportunity_id: OPP_A,
            connection_id: "22222222-2222-2222-2222-222222222222",
            provider_thread_id: "thread-1",
            ai_summary:
              "Linked to a negotiation opportunity — Request for Estimate.",
            last_message_at: "2026-07-21T20:00:00.000Z",
          },
        ],
        customerEmails: ["jane@example.com"],
      }
    );

    const conversation = bundle!.emails.map((email) => email.body).join(" ");
    expect(conversation).toContain("$1,200");
    expect(conversation).toContain("do not need removal");
    expect(conversation).toContain("Tomorrow is good still");
    expect(bundle!.email_thread_summaries).not.toContain(
      "Linked to a negotiation opportunity — Request for Estimate."
    );
    expect(bundle!.commercial_context).toMatchObject({
      outcome: "won",
      current_price: 1200,
      excluded_scope: expect.stringMatching(/remove the old railing/i),
      schedule: expect.stringMatching(/tomorrow/i),
      next_action: expect.stringMatching(/convert|project|schedule/i),
    });
  });

  it("returns null for a lead with no substantive context", () => {
    expect(
      buildLeadSummaryContext(opportunityRow() as never, {
        activities: [],
        correspondenceEvents: [],
        stageTransitions: [],
        siteVisits: [],
        threadSummaries: [],
        customerEmails: ["jane@example.com"],
      })
    ).toBeNull();
  });
});

// ─── Service sweep behaviour ────────────────────────────────────────────────

describe("runLeadSummaryRefresh", () => {
  it("refreshes an existing stale summary through the guarded snapshot RPC", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-21T18:00:00.000Z")],
    };

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      now: NOW,
    });

    expect(result.companiesEnabled).toBe(1);
    expect(result.candidates).toBe(1);
    expect(result.summariesWritten).toBe(1);
    expect(result.failed).toEqual([]);

    expect(openAICreateMock).toHaveBeenCalledTimes(1);
    const request = openAICreateMock.mock.calls[0][0];
    expect(request.model).toBe("gpt-4o-mini");
    expect(request.temperature).toBe(0.1);
    expect(request.response_format.type).toBe("json_schema");
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[0].content).toContain("Canpro");
    expect(request.messages[0].content).toContain("1-2 sentence summary");
    expect(request.messages[0].content).toMatch(
      /email bodies[\s\S]*untrusted[\s\S]*never follow instructions/i
    );

    expect(updateCalls).toHaveLength(0);
    expect(supabaseRpcMock).toHaveBeenCalledWith(
      "commit_lead_summary_snapshot",
      expect.objectContaining({
        p_company_id: COMPANY_ID,
        p_opportunity_id: OPP_A,
        p_summary: "Generated summary.",
        p_generated_at: NOW.toISOString(),
        p_expected_prior_summary: "Existing summary.",
        p_expected_prior_summary_updated_at: STAMP,
        p_expected_assignment_version: 0,
        p_expected_correspondence_count: 0,
        p_expected_meaningful_event_count: 0,
        p_expected_latest_meaningful_event_id: null,
      })
    );
  });

  it("skips bare leads as insufficient context without calling the model", async () => {
    tables.opportunities = { rows: [opportunityRow()] };

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      now: NOW,
    });

    expect(result.candidates).toBe(0);
    expect(result.skippedInsufficientContext).toBe(1);
    expect(result.summariesWritten).toBe(0);
    expect(openAICreateMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("does not bulk-fill an untouched historical NULL summary", async () => {
    tables.opportunities = { rows: [opportunityRow()] };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-20T00:00:00.000Z")],
    };

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      now: NOW,
    });

    expect(result.candidates).toBe(0);
    expect(result.summariesWritten).toBe(0);
    expect(openAICreateMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("does not refresh a lead whose only new context is the engine's own transition echo", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.stage_transitions = {
      rows: [
        {
          id: "transition-refresh-echo",
          opportunity_id: OPP_A,
          from_stage: "new_lead",
          to_stage: "qualifying",
          transitioned_at: new Date(STAMP_MS + 2_000).toISOString(),
        },
      ],
    };

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      now: NOW,
    });

    expect(result.candidates).toBe(0);
    expect(openAICreateMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("refreshes a summarized lead when a note lands beyond the epsilon", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [
        noteActivity(OPP_A, new Date(STAMP_MS + 10 * 60_000).toISOString()),
      ],
    };

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      now: NOW,
    });

    expect(result.candidates).toBe(1);
    expect(result.summariesWritten).toBe(1);
    // The prior summary rides along as model context.
    const userPayload = JSON.parse(
      openAICreateMock.mock.calls[0][0].messages[1].content
    );
    expect(userPayload.lead.previous_summary).toBe("Existing summary.");
  });

  it("processes the stalest candidate first under maxLeadsPerRun", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          id: OPP_B,
          title: "Refresh candidate",
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
        opportunityRow({
          id: OPP_A,
          title: "Never stamped",
          ai_summary: "Legacy summary.",
          ai_summary_updated_at: null,
        }),
      ],
    };
    tables.activities = {
      rows: [
        noteActivity(OPP_A, "2026-07-21T18:00:00.000Z"),
        noteActivity(OPP_B, new Date(STAMP_MS + 10 * 60_000).toISOString()),
      ],
    };

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      maxLeadsPerRun: 1,
      now: NOW,
    });

    expect(result.candidates).toBe(2);
    expect(result.summariesWritten).toBe(1);
    // Existing but never-stamped legacy summary wins the budget slot.
    expect(supabaseRpcMock.mock.calls[0][1]).toMatchObject({
      p_opportunity_id: OPP_A,
    });
  });

  it("retries once on a model contract error and succeeds", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-21T18:00:00.000Z")],
    };
    openAICreateMock
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: { refusal: null, content: "not json" },
          },
        ],
      })
      .mockResolvedValueOnce(modelResponse("Second attempt summary."));

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      now: NOW,
    });

    expect(openAICreateMock).toHaveBeenCalledTimes(2);
    expect(result.summariesWritten).toBe(1);
    expect(supabaseRpcMock.mock.calls[0][1]).toMatchObject({
      p_summary: "Second attempt summary.",
    });
  });

  it("isolates a persistent per-lead failure and continues the sweep", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          id: OPP_A,
          title: "Fails",
          ai_summary: "Existing A.",
          ai_summary_updated_at: STAMP,
        }),
        opportunityRow({
          id: OPP_B,
          title: "Succeeds",
          ai_summary: "Existing B.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [
        noteActivity(OPP_A, "2026-07-21T18:00:00.000Z"),
        noteActivity(OPP_B, "2026-07-21T19:00:00.000Z"),
      ],
    };
    const badResponse = {
      choices: [
        {
          finish_reason: "stop",
          message: { refusal: null, content: "not json" },
        },
      ],
    };
    // OPP_A drains its two contract attempts; OPP_B then succeeds.
    openAICreateMock
      .mockResolvedValueOnce(badResponse)
      .mockResolvedValueOnce(badResponse)
      .mockResolvedValueOnce(modelResponse("Second lead summary."));

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      now: NOW,
    });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].opportunityId).toBe(OPP_A);
    expect(result.summariesWritten).toBe(1);
    expect(updateCalls).toHaveLength(0);
    expect(supabaseRpcMock).toHaveBeenCalledTimes(1);
    expect(supabaseRpcMock.mock.calls[0][1]).toMatchObject({
      p_opportunity_id: OPP_B,
    });
  });

  it("isolates a corrupt email provenance boundary and still refreshes other stale leads", async () => {
    const corruptEmail = emailActivity(
      OPP_A,
      "2026-07-21T18:00:00.000Z",
      "Please quote the composite railing."
    );
    tables.opportunities = {
      rows: [
        opportunityRow({
          id: OPP_A,
          title: "Corrupt evidence",
          ai_summary: "Existing A.",
          ai_summary_updated_at: STAMP,
        }),
        opportunityRow({
          id: OPP_B,
          title: "Valid lead",
          ai_summary: "Existing B.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [corruptEmail, noteActivity(OPP_B, "2026-07-21T19:00:00.000Z")],
    };
    tables.opportunity_correspondence_events = {
      rows: [
        correspondenceEvent(corruptEmail, {
          connection_id: "different-mailbox-connection",
        }),
      ],
    };

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      now: NOW,
    });

    expect(result.failed).toEqual([
      {
        opportunityId: OPP_A,
        error: expect.stringContaining(
          "lead summary correspondence activity identity conflict"
        ),
      },
    ]);
    expect(result.summariesWritten).toBe(1);
    expect(openAICreateMock).toHaveBeenCalledTimes(1);
    expect(supabaseRpcMock).toHaveBeenCalledTimes(1);
    expect(supabaseRpcMock.mock.calls[0][1]).toMatchObject({
      p_opportunity_id: OPP_B,
    });
  });

  it("rejects direct historical backfill before reading or writing", async () => {
    await expect(
      runLeadSummaryRefresh({
        supabase: mockSupabase,
        mode: "backfill",
        now: NOW,
      } as never)
    ).rejects.toThrow("Historical lead-summary backfill is disabled");
    expect(selectCalls).toHaveLength(0);
    expect(openAICreateMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("previews candidates in dryRun without model calls or writes", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-21T18:00:00.000Z")],
    };

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      dryRun: true,
      now: NOW,
    });

    expect(result.dryRun).toBe(true);
    expect(result.candidates).toBe(1);
    expect(result.candidatesPreview).toEqual([
      { opportunityId: OPP_A, title: "Jane Doe — Email Inquiry" },
    ]);
    expect(result.summariesWritten).toBe(0);
    expect(openAICreateMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("skips companies whose phase_c gate is off", async () => {
    isAIFeatureEnabledMock.mockResolvedValue(false);
    tables.opportunities = { rows: [opportunityRow()] };

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "refresh",
      now: NOW,
    });

    expect(result.companiesConsidered).toBe(1);
    expect(result.companiesEnabled).toBe(0);
    expect(result.leadsScanned).toBe(0);
    expect(openAICreateMock).not.toHaveBeenCalled();
  });
});

describe("refreshLeadSummariesForOpportunities", () => {
  it("refreshes the complete conversation for a touched terminal lead without a stage or staleness filter", async () => {
    const activities = [
      emailActivity(
        OPP_A,
        "2026-07-21T16:00:00.000Z",
        "Installation total is $1,200.",
        "outbound"
      ),
      emailActivity(
        OPP_A,
        "2026-07-21T17:00:00.000Z",
        "Removal would bring the total to $1,400.",
        "outbound"
      ),
      emailActivity(
        OPP_A,
        "2026-07-21T18:00:00.000Z",
        "My husband will remove the old railing. We accept the $1,200 installation."
      ),
      emailActivity(
        OPP_A,
        "2026-07-21T19:00:00.000Z",
        "Tomorrow is confirmed for installation.",
        "outbound"
      ),
    ];
    tables.opportunities = {
      rows: [
        opportunityRow({
          stage: "won",
          ai_summary: "Old qualifying placeholder.",
          ai_summary_updated_at: NOW.toISOString(),
          correspondence_count: activities.length,
        }),
      ],
    };
    tables.activities = { rows: activities };
    tables.opportunity_correspondence_events = {
      rows: activities.map((activity) =>
        correspondenceEvent(activity as ReturnType<typeof emailActivity>)
      ),
    };
    openAICreateMock
      .mockResolvedValueOnce(
        modelResponse(
          "Camille accepted the $1,400 installation including removal; tomorrow is confirmed."
        )
      )
      .mockResolvedValueOnce(
        modelResponse(
          "Camille accepted the $1,200 installation with removal excluded; tomorrow is confirmed and the next action is to prepare for the scheduled work."
        )
      );

    const result = await refreshLeadSummariesForOpportunities({
      supabase: mockSupabase,
      companyId: COMPANY_ID,
      opportunityIds: [OPP_A, OPP_A],
      now: NOW,
    });

    expect(result).toMatchObject({
      requested: 1,
      written: 1,
      skippedFeatureDisabled: false,
      failed: [],
    });
    const targetedSelect = selectCalls.find(
      (call) =>
        call.table === "opportunities" &&
        call.filters.some(
          ([kind, column, value]) =>
            kind === "in" && column === "id" && Array.isArray(value)
        )
    );
    expect(targetedSelect).toBeDefined();
    expect(targetedSelect!.filters).not.toEqual(
      expect.arrayContaining([["in", "stage", expect.anything()]])
    );
    expect(openAICreateMock).toHaveBeenCalledTimes(2);
    const prompt = JSON.parse(
      openAICreateMock.mock.calls[0][0].messages[1].content
    );
    expect(prompt.lead.stage).toBe("won");
    expect(prompt.emails[0].body).toContain("$1,200");
    expect(prompt.commercial_context.next_action).toBe(
      "Prepare for the confirmed work schedule."
    );
    expect(updateCalls).toHaveLength(0);
    expect(supabaseRpcMock).toHaveBeenCalledWith(
      "commit_lead_summary_snapshot",
      expect.objectContaining({
        p_summary: expect.stringMatching(
          /\$1,200[\s\S]*husband will remove[\s\S]*tomorrow is confirmed/i
        ),
        p_expected_correspondence_count: 4,
        p_expected_meaningful_event_count: 4,
        p_expected_latest_meaningful_event_id:
          "event-email-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-2026-07-21T19:00:00.000Z",
      })
    );
  });

  it("processes every touched opportunity across internal 40-lead batches", async () => {
    const opportunityIds = Array.from(
      { length: 41 },
      (_, index) => `opportunity-${String(index + 1).padStart(2, "0")}`
    );
    tables.opportunities = {
      rows: opportunityIds.map((id, index) =>
        opportunityRow({
          id,
          title: `Lead ${index + 1}`,
          description: `Current scope for lead ${index + 1}.`,
        })
      ),
    };
    tables.activities = {
      rows: opportunityIds.map((id) =>
        noteActivity(id, "2026-07-21T18:00:00.000Z")
      ),
    };

    const result = await refreshLeadSummariesForOpportunities({
      supabase: mockSupabase,
      companyId: COMPANY_ID,
      opportunityIds,
      now: NOW,
    });

    expect(result).toMatchObject({
      requested: 41,
      written: 41,
      failed: [],
    });
    expect(updateCalls).toHaveLength(0);
    expect(supabaseRpcMock).toHaveBeenCalledTimes(41);
    const targetedOpportunityReads = selectCalls.filter(
      (call) =>
        call.table === "opportunities" &&
        call.filters.some(([kind, column]) => kind === "in" && column === "id")
    );
    expect(targetedOpportunityReads).toHaveLength(2);
  });

  it("holds the corrupt touched lead as failed while refreshing another touched lead", async () => {
    const corruptEmail = emailActivity(
      OPP_A,
      "2026-07-21T18:00:00.000Z",
      "Please quote the composite railing."
    );
    tables.opportunities = {
      rows: [
        opportunityRow({ id: OPP_A, title: "Corrupt evidence" }),
        opportunityRow({ id: OPP_B, title: "Valid lead" }),
      ],
    };
    tables.activities = {
      rows: [corruptEmail, noteActivity(OPP_B, "2026-07-21T19:00:00.000Z")],
    };
    tables.opportunity_correspondence_events = {
      rows: [
        correspondenceEvent(corruptEmail, {
          connection_id: "different-mailbox-connection",
        }),
      ],
    };

    const result = await refreshLeadSummariesForOpportunities({
      supabase: mockSupabase,
      companyId: COMPANY_ID,
      opportunityIds: [OPP_A, OPP_B],
      now: NOW,
    });

    expect(result.failed).toEqual([
      {
        opportunityId: OPP_A,
        error: expect.stringContaining(
          "lead summary correspondence activity identity conflict"
        ),
      },
    ]);
    expect(result.written).toBe(1);
    expect(openAICreateMock).toHaveBeenCalledTimes(1);
    expect(supabaseRpcMock).toHaveBeenCalledTimes(1);
    expect(supabaseRpcMock.mock.calls[0][1]).toMatchObject({
      p_opportunity_id: OPP_B,
    });
  });

  it("does not overwrite a newer conversation when the guarded snapshot is stale", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-21T18:00:00.000Z")],
    };
    supabaseRpcMock.mockResolvedValueOnce({
      data: [
        {
          changed: false,
          guard_reason: "conversation_snapshot_mismatch",
          summary_updated_at: STAMP,
        },
      ],
      error: null,
    });

    const result = await refreshLeadSummariesForOpportunities({
      supabase: mockSupabase,
      companyId: COMPANY_ID,
      opportunityIds: [OPP_A],
      now: NOW,
    });

    expect(result.written).toBe(0);
    expect(result.failed).toEqual([
      {
        opportunityId: OPP_A,
        error: "summary write skipped: conversation_snapshot_mismatch",
      },
    ]);
    expect(updateCalls).toHaveLength(0);
  });

  it("treats an exact already-applied summary retry as a successful write", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-21T18:00:00.000Z")],
    };
    supabaseRpcMock.mockResolvedValueOnce({
      data: [
        {
          changed: false,
          guard_reason: "already_applied",
          summary_updated_at: NOW.toISOString(),
        },
      ],
      error: null,
    });

    const result = await refreshLeadSummariesForOpportunities({
      supabase: mockSupabase,
      companyId: COMPANY_ID,
      opportunityIds: [OPP_A],
      now: NOW,
    });

    expect(result).toMatchObject({ written: 1, failed: [] });
    expect(supabaseRpcMock.mock.calls[0][1]).toMatchObject({
      p_expected_prior_summary: "Existing summary.",
      p_expected_prior_summary_updated_at: STAMP,
    });
  });

  it("rejects an out-of-order generator whose timestamp is older than the committed summary", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-21T18:00:00.000Z")],
    };
    supabaseRpcMock.mockResolvedValueOnce({
      data: [
        {
          changed: false,
          guard_reason: "stale_summary_generation",
          summary_updated_at: "2026-07-21T20:01:00.000Z",
        },
      ],
      error: null,
    });

    const result = await refreshLeadSummariesForOpportunities({
      supabase: mockSupabase,
      companyId: COMPANY_ID,
      opportunityIds: [OPP_A],
      now: NOW,
    });

    expect(result.written).toBe(0);
    expect(result.failed).toEqual([
      {
        opportunityId: OPP_A,
        error: "summary write skipped: stale_summary_generation",
      },
    ]);
  });

  it("rejects a concurrent generator built from a superseded prior summary snapshot", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-21T18:00:00.000Z")],
    };
    supabaseRpcMock.mockResolvedValueOnce({
      data: [
        {
          changed: false,
          guard_reason: "summary_snapshot_mismatch",
          summary_updated_at: "2026-07-21T19:59:00.000Z",
        },
      ],
      error: null,
    });

    const result = await refreshLeadSummariesForOpportunities({
      supabase: mockSupabase,
      companyId: COMPANY_ID,
      opportunityIds: [OPP_A],
      now: NOW,
    });

    expect(result.written).toBe(0);
    expect(result.failed).toEqual([
      {
        opportunityId: OPP_A,
        error: "summary write skipped: summary_snapshot_mismatch",
      },
    ]);
  });

  it("routes an AI-provider quota outage into deferred rather than failed", async () => {
    tables.opportunities = { rows: [opportunityRow()] };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-21T18:00:00.000Z")],
    };
    const quotaError = Object.assign(
      new Error("429 You exceeded your current quota."),
      { status: 429, code: "insufficient_quota" }
    );
    openAICreateMock.mockReset();
    openAICreateMock.mockRejectedValue(quotaError);

    const result = await refreshLeadSummariesForOpportunities({
      supabase: mockSupabase,
      companyId: COMPANY_ID,
      opportunityIds: [OPP_A],
      now: NOW,
    });

    expect(result.deferred).toEqual([
      { opportunityId: OPP_A, error: "429 You exceeded your current quota." },
    ]);
    expect(result.failed).toEqual([]);
    expect(result.written).toBe(0);
    // Generation threw before the guarded write, so the cursor-holding commit
    // path was never reached.
    expect(supabaseRpcMock).not.toHaveBeenCalled();
  });

  it("routes a non-provider database write failure into failed rather than deferred", async () => {
    tables.opportunities = { rows: [opportunityRow()] };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-21T18:00:00.000Z")],
    };
    // Model generation succeeds (beforeEach default), the guarded snapshot RPC
    // fails with a non-serialization Postgres error — a genuine persistence
    // failure that must hold the cursor, never a deferrable provider outage.
    supabaseRpcMock.mockReset();
    supabaseRpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "permission denied for table opportunities",
        code: "42501",
      },
    });

    const result = await refreshLeadSummariesForOpportunities({
      supabase: mockSupabase,
      companyId: COMPANY_ID,
      opportunityIds: [OPP_A],
      now: NOW,
    });

    expect(result.failed).toEqual([
      {
        opportunityId: OPP_A,
        error:
          "summary write failed: permission denied for table opportunities",
      },
    ]);
    expect(result.deferred).toEqual([]);
    expect(result.written).toBe(0);
  });

  it("routes a provider outage, a persistence failure, and a success into their own buckets", async () => {
    const OPP_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    tables.opportunities = {
      rows: [
        opportunityRow(),
        opportunityRow({ id: OPP_B, title: "Second lead" }),
        opportunityRow({ id: OPP_C, title: "Third lead" }),
      ],
    };
    tables.activities = {
      rows: [
        noteActivity(OPP_A, "2026-07-21T18:00:00.000Z"),
        noteActivity(OPP_B, "2026-07-21T18:00:00.000Z"),
        noteActivity(OPP_C, "2026-07-21T18:00:00.000Z"),
      ],
    };
    const quotaError = Object.assign(
      new Error("429 You exceeded your current quota."),
      { status: 429, code: "insufficient_quota" }
    );
    // Opportunities process in row order [A, B, C]. A's generation hits the
    // provider outage (deferred); B and C generate, then B's guarded write
    // fails (failed) and C's write succeeds (written).
    openAICreateMock.mockReset();
    openAICreateMock
      .mockRejectedValueOnce(quotaError)
      .mockResolvedValueOnce(modelResponse("Generated summary."))
      .mockResolvedValueOnce(modelResponse("Generated summary."));
    supabaseRpcMock.mockReset();
    supabaseRpcMock
      .mockResolvedValueOnce({
        data: null,
        error: {
          message: "permission denied for table opportunities",
          code: "42501",
        },
      })
      .mockResolvedValueOnce({
        data: [
          {
            changed: true,
            guard_reason: null,
            summary_updated_at: NOW.toISOString(),
          },
        ],
        error: null,
      });

    const result = await refreshLeadSummariesForOpportunities({
      supabase: mockSupabase,
      companyId: COMPANY_ID,
      opportunityIds: [OPP_A, OPP_B, OPP_C],
      now: NOW,
    });

    expect(result.requested).toBe(3);
    expect(result.deferred).toEqual([
      { opportunityId: OPP_A, error: "429 You exceeded your current quota." },
    ]);
    expect(result.failed).toEqual([
      {
        opportunityId: OPP_B,
        error:
          "summary write failed: permission denied for table opportunities",
      },
    ]);
    expect(result.written).toBe(1);
  });
});

// ─── Route behaviour ────────────────────────────────────────────────────────

function cronRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest(
    new URL("https://example.com/api/cron/lead-summary-refresh"),
    { headers }
  );
}

function backfillRequest(
  authHeader: string | undefined,
  body: unknown
): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  headers.set("content-type", "application/json");
  return new NextRequest(
    new URL("https://example.com/api/cron/lead-summary-refresh"),
    { method: "POST", headers, body: JSON.stringify(body) }
  );
}

describe("GET /api/cron/lead-summary-refresh", () => {
  it("rejects a missing or wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    expect((await GET(cronRequest())).status).toBe(401);
    expect((await GET(cronRequest("Bearer wrong"))).status).toBe(401);
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronRequest("Bearer anything"))).status).toBe(500);
  });

  it("no-ops when LEAD_SUMMARY_REFRESH_ENABLED is not true", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    const response = await GET(cronRequest("Bearer top-secret"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      ok: true,
      skipped: true,
      reason: "lead_summary_refresh_disabled",
    });
    expect(supabaseFromMock).not.toHaveBeenCalled();
    expect(openAICreateMock).not.toHaveBeenCalled();
  });

  it("runs the refresh sweep when enabled", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    vi.stubEnv("LEAD_SUMMARY_REFRESH_ENABLED", "true");
    tables.opportunities = {
      rows: [
        opportunityRow({
          ai_summary: "Existing summary.",
          ai_summary_updated_at: STAMP,
        }),
      ],
    };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-21T18:00:00.000Z")],
    };

    const response = await GET(cronRequest("Bearer top-secret"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("refresh");
    expect(payload.summariesWritten).toBe(1);
    expect(updateCalls).toHaveLength(0);
    expect(supabaseRpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/cron/lead-summary-refresh", () => {
  it("refuses bulk historical backfill without touching the model or database", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    const response = await POST(
      backfillRequest("Bearer top-secret", { mode: "backfill" })
    );
    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Historical lead-summary backfill is disabled",
    });
    expect(openAICreateMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});
