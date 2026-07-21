/**
 * Integration tests for the lead AI summary coverage extension:
 * `runLeadSummaryRefresh` (lead-summary-service) and
 * `/api/cron/lead-summary-refresh` (GET recurring + POST backfill).
 *
 * Covers:
 *   - staleness: engine stage-transition echo inside the 5-minute epsilon is
 *     NOT stale; a note beyond it IS; NULL-stamp legacy summaries heal
 *   - eligibility: bare name-only leads are skipped (insufficient context),
 *     never sent to the model
 *   - write path: exactly { ai_summary, ai_summary_updated_at }, scoped by
 *     id + company_id
 *   - model contract: gpt-4o-mini / temp 0.1 / strict json_schema singleton;
 *     one retry on contract error; per-lead failure isolation
 *   - budget: stalest-first ordering under maxLeadsPerRun
 *   - backfill mode: DB-side ai_summary IS NULL restriction; dryRun previews
 *     without model calls or writes
 *   - route: auth gates, LEAD_SUMMARY_REFRESH_ENABLED gate on GET only,
 *     POST body validation
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
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: supabaseFromMock }),
}));

import {
  runLeadSummaryRefresh,
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
  const resolveSelect = () => ({
    data: cfg.error ? null : (cfg.rows ?? []),
    error: cfg.error ?? null,
  });
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

const mockSupabase = { from: (table: string) => makeChain(table) };

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
    title: "Jane Doe — Email Inquiry",
    stage: "qualifying",
    stage_entered_at: "2026-07-01T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    contact_name: "Jane Doe",
    address: "123 Main St",
    source: "phone",
    description: null,
    estimated_value: null,
    detected_value: null,
    actual_value: null,
    ai_summary: null,
    ai_summary_updated_at: null,
    ...overrides,
  };
}

function noteActivity(opportunityId: string, createdAt: string) {
  return {
    opportunity_id: opportunityId,
    type: "note",
    direction: null,
    subject: null,
    content: "Client confirmed they want composite decking, budget ~$12k.",
    body_text: null,
    outcome: null,
    duration_minutes: null,
    created_at: createdAt,
  };
}

function emailActivity(
  opportunityId: string,
  createdAt: string,
  body: string
) {
  return {
    opportunity_id: opportunityId,
    type: "email",
    direction: "inbound",
    subject: "Deck quote",
    content: null,
    body_text: body,
    outcome: null,
    duration_minutes: null,
    created_at: createdAt,
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
    activities: { rows: [] },
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
      stageTransitions: [
        {
          opportunity_id: OPP_A,
          from_stage: "new_lead",
          to_stage: "qualifying",
          transitioned_at: new Date(STAMP_MS + 2_000).toISOString(),
        },
      ],
      siteVisits: [],
      threadSummaries: [],
    });
    expect(evaluateLeadStaleness(opp, aggregates, "refresh")).toBe("fresh");
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
          new Date(STAMP_MS + LEAD_SUMMARY_STALENESS_EPSILON_MS + 60_000).toISOString()
        ),
      ],
      stageTransitions: [],
      siteVisits: [],
      threadSummaries: [],
    });
    expect(evaluateLeadStaleness(opp, aggregates, "refresh")).toBe("stale");
  });

  it("heals a legacy summary with a NULL stamp when context exists", () => {
    const opp = opportunityRow({
      ai_summary: "Legacy import seed",
      ai_summary_updated_at: null,
    });
    const aggregates = computeLeadContextAggregates(opp, {
      activities: [noteActivity(OPP_A, "2026-07-10T00:00:00.000Z")],
      stageTransitions: [],
      siteVisits: [],
      threadSummaries: [],
    });
    expect(evaluateLeadStaleness(opp, aggregates, "refresh")).toBe("stale");
    expect(evaluateLeadStaleness(opp, aggregates, "backfill")).toBe(
      "not_applicable"
    );
  });

  it("marks bare name-only leads as insufficient context", () => {
    const opp = opportunityRow();
    const aggregates = computeLeadContextAggregates(opp, {
      activities: [],
      stageTransitions: [
        {
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
    expect(evaluateLeadStaleness(opp, aggregates, "refresh")).toBe(
      "insufficient_context"
    );
    expect(evaluateLeadStaleness(opp, aggregates, "backfill")).toBe(
      "insufficient_context"
    );
  });
});

describe("buildLeadSummaryContext", () => {
  it("caps email bodies at 500 chars, keeps newest 10 chronologically, and carries the previous summary", () => {
    const longBody = "x".repeat(2_000);
    const activities = Array.from({ length: 14 }, (_, index) =>
      emailActivity(
        OPP_A,
        new Date(Date.parse("2026-07-01T00:00:00.000Z") + index * 3_600_000).toISOString(),
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
        stageTransitions: [],
        siteVisits: [],
        threadSummaries: [
          {
            opportunity_id: OPP_A,
            ai_summary: "Thread-level summary from the inbox feature.",
            last_message_at: "2026-07-02T00:00:00.000Z",
          },
        ],
      }
    );
    expect(bundle).not.toBeNull();
    expect(bundle!.emails).toHaveLength(10);
    // Newest last, and the newest (index 13) body is clipped to the cap.
    const newest = bundle!.emails.at(-1)!;
    expect(newest.body).toHaveLength(500);
    expect(bundle!.emails[0].body).toBe("Message 4");
    expect(bundle!.lead.previous_summary).toBe("Previous summary text.");
    expect(bundle!.email_thread_summaries).toEqual([
      "Thread-level summary from the inbox feature.",
    ]);
  });

  it("returns null for a lead with no substantive context", () => {
    expect(
      buildLeadSummaryContext(opportunityRow() as never, {
        activities: [],
        stageTransitions: [],
        siteVisits: [],
        threadSummaries: [],
      })
    ).toBeNull();
  });
});

// ─── Service sweep behaviour ────────────────────────────────────────────────

describe("runLeadSummaryRefresh", () => {
  it("generates a first summary for a NULL-summary lead with context and writes exactly the two summary fields", async () => {
    tables.opportunities = { rows: [opportunityRow()] };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-20T00:00:00.000Z")],
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

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("opportunities");
    expect(updateCalls[0].payload).toEqual({
      ai_summary: "Generated summary.",
      ai_summary_updated_at: NOW.toISOString(),
    });
    expect(updateCalls[0].filters).toEqual([
      ["eq", "id", OPP_A],
      ["eq", "company_id", COMPANY_ID],
    ]);
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
      rows: [noteActivity(OPP_A, new Date(STAMP_MS + 10 * 60_000).toISOString())],
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
        opportunityRow({ id: OPP_A, title: "Never summarized" }),
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
    // Never-stamped lead wins the budget slot.
    expect(updateCalls[0].filters).toContainEqual(["eq", "id", OPP_A]);
  });

  it("retries once on a model contract error and succeeds", async () => {
    tables.opportunities = { rows: [opportunityRow()] };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-20T00:00:00.000Z")],
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
    expect(updateCalls[0].payload.ai_summary).toBe("Second attempt summary.");
  });

  it("isolates a persistent per-lead failure and continues the sweep", async () => {
    tables.opportunities = {
      rows: [
        opportunityRow({ id: OPP_A, title: "Fails" }),
        opportunityRow({ id: OPP_B, title: "Succeeds" }),
      ],
    };
    tables.activities = {
      rows: [
        noteActivity(OPP_A, "2026-07-20T00:00:00.000Z"),
        noteActivity(OPP_B, "2026-07-20T01:00:00.000Z"),
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
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].filters).toContainEqual(["eq", "id", OPP_B]);
  });

  it("restricts backfill candidates to NULL summaries at the database layer", async () => {
    tables.opportunities = { rows: [] };

    await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "backfill",
      now: NOW,
    });

    const oppSelect = selectCalls.find(
      (call) =>
        call.table === "opportunities" &&
        call.filters.some(([kind, column]) => kind === "in" && column === "stage")
    );
    expect(oppSelect).toBeDefined();
    expect(oppSelect!.filters).toContainEqual(["is", "ai_summary", null]);
  });

  it("previews candidates in dryRun without model calls or writes", async () => {
    tables.opportunities = { rows: [opportunityRow()] };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-20T00:00:00.000Z")],
    };

    const result = await runLeadSummaryRefresh({
      supabase: mockSupabase,
      mode: "backfill",
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
    tables.opportunities = { rows: [opportunityRow()] };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-20T00:00:00.000Z")],
    };

    const response = await GET(cronRequest("Bearer top-secret"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("refresh");
    expect(payload.summariesWritten).toBe(1);
    expect(updateCalls).toHaveLength(1);
  });
});

describe("POST /api/cron/lead-summary-refresh (backfill)", () => {
  it("rejects a missing or wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    expect(
      (await POST(backfillRequest(undefined, { mode: "backfill" }))).status
    ).toBe(401);
    expect(
      (await POST(backfillRequest("Bearer wrong", { mode: "backfill" }))).status
    ).toBe(401);
  });

  it("rejects a body without the explicit backfill mode", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    const response = await POST(backfillRequest("Bearer top-secret", {}));
    expect(response.status).toBe(400);
  });

  it("runs the backfill even while the recurring gate is off", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    // LEAD_SUMMARY_REFRESH_ENABLED deliberately NOT set.
    tables.opportunities = { rows: [opportunityRow()] };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-20T00:00:00.000Z")],
    };

    const response = await POST(
      backfillRequest("Bearer top-secret", { mode: "backfill" })
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("backfill");
    expect(payload.summariesWritten).toBe(1);
  });

  it("honours dryRun end-to-end", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    tables.opportunities = { rows: [opportunityRow()] };
    tables.activities = {
      rows: [noteActivity(OPP_A, "2026-07-20T00:00:00.000Z")],
    };

    const response = await POST(
      backfillRequest("Bearer top-secret", { mode: "backfill", dryRun: true })
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.dryRun).toBe(true);
    expect(payload.candidates).toBe(1);
    expect(payload.summariesWritten).toBe(0);
    expect(openAICreateMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("scopes the sweep when a companyId is supplied", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    tables.opportunities = { rows: [] };

    const response = await POST(
      backfillRequest("Bearer top-secret", {
        mode: "backfill",
        companyId: COMPANY_ID,
      })
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.companiesConsidered).toBe(1);
    // Discovery via admin_feature_overrides is skipped for a scoped run.
    expect(
      selectCalls.some((call) => call.table === "admin_feature_overrides")
    ).toBe(false);
    expect(isAIFeatureEnabledMock).toHaveBeenCalledWith(COMPANY_ID, "phase_c");
  });
});
