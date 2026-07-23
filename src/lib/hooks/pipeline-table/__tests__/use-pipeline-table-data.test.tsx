/**
 * Tests for the pipeline-table data hook's sort behavior — specifically the
 * Phase 5 aging-aware DEFAULT sort and its interaction with explicit column
 * sorts.
 *
 * Two layers:
 *   1. `compareByAging` is unit-tested as a pure comparator under a FIXED clock,
 *      so the "overdue-first, then oldest-contact" ordering is deterministic.
 *   2. `usePipelineTableData` is exercised through mocked data hooks (+ fake
 *      timers pinning the clock the hook captures on mount) to prove the branch
 *      selection: no explicit sort → aging order; an explicit column sort wins.
 */

import React, { type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OpportunityStage,
  OpportunitySource,
  OpportunityPriority,
  type Opportunity,
} from "@/lib/types/pipeline";
import type {
  PipelineTableRow,
  PipelineTableSort,
} from "@/lib/types/pipeline-table";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

// ── Mocks for the four fanned-out data hooks ──────────────────────────────────
// The data hook composes useOpportunities / useClients / useTeamMembers /
// usePipelineStageConfigs. Mock each to return a settled query result so the
// hook runs purely against in-memory fixtures (no Supabase, no auth store).
const { useOpportunities } = vi.hoisted(() => ({ useOpportunities: vi.fn() }));
const { useClients } = vi.hoisted(() => ({ useClients: vi.fn() }));
const { useTeamMembers } = vi.hoisted(() => ({ useTeamMembers: vi.fn() }));

vi.mock("@/lib/hooks/use-opportunities", () => ({ useOpportunities }));
vi.mock("@/lib/hooks/use-clients", () => ({ useClients }));
vi.mock("@/lib/hooks/use-users", () => ({ useTeamMembers }));
vi.mock("@/lib/hooks/pipeline-table/use-pipeline-stage-configs", () => ({
  usePipelineStageConfigs: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
  // The hook indexes configs by slug; an empty map makes the adapter fall back
  // to PIPELINE_STAGES_DEFAULT, which is all this sort test needs.
  stageConfigBySlug: () => new Map(),
}));

import {
  compareByAging,
  usePipelineTableData,
} from "@/lib/hooks/pipeline-table/use-pipeline-table-data";

// ── Fixed clock ───────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-31T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBeforeNow(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}
function daysAfterNow(days: number): Date {
  return new Date(NOW.getTime() + days * MS_PER_DAY);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal-but-complete `PipelineTableRow` for the pure comparator tests. */
function makeRow(
  overrides: Partial<PipelineTableRow> & { id: string }
): PipelineTableRow {
  return {
    companyId: "co-1",
    title: overrides.id,
    stage: OpportunityStage.Quoting,
    clientId: null,
    clientName: null,
    estimatedValue: null,
    winProbability: null,
    weightedValue: null,
    ageInStageDays: null,
    lastActivityAt: null,
    nextFollowUpAt: null,
    expectedCloseDate: null,
    assignedTo: null,
    assignmentVersion: 0,
    assigneeName: null,
    source: null,
    priority: null,
    correspondenceCount: 0,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastMessageDirection: null,
    handledAt: null,
    operatorActionRequiredAt: null,
    stageEnteredAt: null,
    projectId: null,
    updatedAt: null,
    staleThresholdDays: null,
    winProbabilityIsFallback: false,
    ...overrides,
  };
}

/** Full `Opportunity` fixture (mirrors the adapter test's factory). */
function makeOpportunity(
  overrides: Partial<Opportunity> & { id: string }
): Opportunity {
  return {
    companyId: "co-1",
    clientId: null,
    title: overrides.id,
    description: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Quoting,
    source: OpportunitySource.Referral,
    assignedTo: null,
    assignmentVersion: 0,
    priority: OpportunityPriority.Medium,
    estimatedValue: 10000,
    actualValue: null,
    winProbability: 40,
    expectedCloseDate: null,
    actualCloseDate: null,
    stageEnteredAt: daysBeforeNow(5),
    projectId: null,
    lostReason: null,
    lostNotes: null,
    quoteDeliveryMethod: null,
    address: null,
    latitude: null,
    longitude: null,
    sourceEmailId: null,
    correspondenceCount: 0,
    outboundCount: 0,
    inboundCount: 0,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastMessageDirection: null,
    handledAt: null,
    operatorActionRequiredAt: null,
    aiSummary: null,
    aiSummaryUpdatedAt: null,
    aiStageConfidence: null,
    aiStageSignals: null,
    detectedValue: null,
    lastActivityAt: daysBeforeNow(1),
    nextFollowUpAt: null,
    tags: [],
    images: [],
    createdAt: daysBeforeNow(30),
    updatedAt: daysBeforeNow(1),
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  useAuthStore.setState({
    company: { id: "co-1" } as never,
    currentUser: { id: "actor-1" } as never,
  });
  usePermissionStore.setState({
    permissions: new Map([["pipeline.view", "all"]]),
    configuredPermissions: new Set(["pipeline.view"]),
    initialized: true,
  });
});

afterEach(() => {
  usePermissionStore.getState().clear();
  useAuthStore.setState({ company: null, currentUser: null });
});

// ─── compareByAging (pure) ──────────────────────────────────────────────────────

describe("compareByAging", () => {
  const cmp = compareByAging(NOW);

  it("sorts an overdue follow-up above a deal with no follow-up", () => {
    const overdue = makeRow({
      id: "overdue",
      nextFollowUpAt: daysBeforeNow(1).toISOString(),
    });
    const fresh = makeRow({ id: "fresh", nextFollowUpAt: null });
    expect(cmp(overdue, fresh)).toBeLessThan(0);
    expect(cmp(fresh, overdue)).toBeGreaterThan(0);
  });

  it("sorts an overdue follow-up above one with a FUTURE follow-up", () => {
    const overdue = makeRow({
      id: "overdue",
      nextFollowUpAt: daysBeforeNow(2).toISOString(),
    });
    const future = makeRow({
      id: "future",
      nextFollowUpAt: daysAfterNow(3).toISOString(),
    });
    expect(cmp(overdue, future)).toBeLessThan(0);
  });

  it("does NOT treat a terminal-stage past follow-up as overdue (gated by the adapter)", () => {
    // A Won deal with a past follow-up is not overdue; it should not jump above a
    // genuinely overdue active deal.
    const wonPast = makeRow({
      id: "won",
      stage: OpportunityStage.Won,
      nextFollowUpAt: daysBeforeNow(5).toISOString(),
      lastActivityAt: daysBeforeNow(1).toISOString(),
    });
    const activeOverdue = makeRow({
      id: "active",
      stage: OpportunityStage.Quoting,
      nextFollowUpAt: daysBeforeNow(1).toISOString(),
      lastActivityAt: daysBeforeNow(1).toISOString(),
    });
    expect(cmp(activeOverdue, wonPast)).toBeLessThan(0);
  });

  it("within the same overdue group, sorts oldest lastActivityAt first", () => {
    const older = makeRow({
      id: "older",
      nextFollowUpAt: daysBeforeNow(1).toISOString(),
      lastActivityAt: daysBeforeNow(10).toISOString(),
    });
    const newer = makeRow({
      id: "newer",
      nextFollowUpAt: daysBeforeNow(1).toISOString(),
      lastActivityAt: daysBeforeNow(2).toISOString(),
    });
    expect(cmp(older, newer)).toBeLessThan(0);
  });

  it("sorts a never-contacted (null lastActivityAt) deal last within a group", () => {
    const contacted = makeRow({
      id: "contacted",
      lastActivityAt: daysBeforeNow(20).toISOString(),
    });
    const never = makeRow({ id: "never", lastActivityAt: null });
    expect(cmp(contacted, never)).toBeLessThan(0);
    expect(cmp(never, contacted)).toBeGreaterThan(0);
  });

  it("produces the full expected order when applied to a mixed set", () => {
    const rows = [
      makeRow({
        id: "fresh-recent",
        lastActivityAt: daysBeforeNow(1).toISOString(),
      }),
      makeRow({
        id: "overdue-old",
        nextFollowUpAt: daysBeforeNow(3).toISOString(),
        lastActivityAt: daysBeforeNow(15).toISOString(),
      }),
      makeRow({
        id: "overdue-recent",
        nextFollowUpAt: daysBeforeNow(1).toISOString(),
        lastActivityAt: daysBeforeNow(2).toISOString(),
      }),
      makeRow({
        id: "fresh-old",
        lastActivityAt: daysBeforeNow(40).toISOString(),
      }),
    ];
    const ordered = [...rows].sort(cmp).map((r) => r.id);
    expect(ordered).toEqual([
      "overdue-old", // overdue group, oldest contact
      "overdue-recent", // overdue group, newer contact
      "fresh-old", // non-overdue, oldest contact
      "fresh-recent", // non-overdue, newest contact
    ]);
  });
});

// ─── usePipelineTableData — default sort vs explicit sort ────────────────────────

describe("usePipelineTableData sort branching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin the clock the hook captures via `new Date()` on mount.
    vi.setSystemTime(NOW);

    useClients.mockReturnValue({
      data: { clients: [], remaining: 0, count: 0 },
      isLoading: false,
      isError: false,
    });
    useTeamMembers.mockReturnValue({
      data: { users: [], remaining: 0, count: 0 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("with NO explicit sort, an overdue-follow-up deal sorts above a fresh one", async () => {
    useOpportunities.mockReturnValue({
      data: [
        makeOpportunity({
          id: "fresh",
          nextFollowUpAt: daysAfterNow(5), // future → not overdue
          lastActivityAt: daysBeforeNow(1),
        }),
        makeOpportunity({
          id: "overdue",
          nextFollowUpAt: daysBeforeNow(2), // past → overdue
          lastActivityAt: daysBeforeNow(1),
        }),
      ],
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(
      () =>
        usePipelineTableData({
          search: "",
          sorting: [] as PipelineTableSort[],
        }),
      { wrapper: makeWrapper() }
    );

    // The mocked data hooks resolve synchronously, so rows are computed on the
    // first render — no async settling to await.
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows.map((r) => r.id)).toEqual(["overdue", "fresh"]);
    // The hook surfaces the clock it aged against.
    expect(result.current.now.getTime()).toBe(NOW.getTime());
  });

  it("an explicit column sort overrides the aging default", async () => {
    useOpportunities.mockReturnValue({
      data: [
        makeOpportunity({
          id: "overdue-z",
          title: "Zeta job",
          nextFollowUpAt: daysBeforeNow(2), // overdue — would lead under the aging default
          lastActivityAt: daysBeforeNow(1),
        }),
        makeOpportunity({
          id: "fresh-a",
          title: "Alpha job",
          nextFollowUpAt: daysAfterNow(5), // not overdue
          lastActivityAt: daysBeforeNow(1),
        }),
      ],
      isLoading: false,
      isError: false,
    });

    // Explicit ascending sort by deal title: "Alpha job" must come first even
    // though "Zeta job" is overdue (which the aging default would have floated up).
    const { result } = renderHook(
      () =>
        usePipelineTableData({
          search: "",
          sorting: [{ field: "deal", direction: "asc" }] as PipelineTableSort[],
        }),
      { wrapper: makeWrapper() }
    );

    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows.map((r) => r.title)).toEqual([
      "Alpha job",
      "Zeta job",
    ]);
  });
});

// ─── usePipelineTableData — closedDeals scope ────────────────────────────────────

describe("usePipelineTableData closedDeals option", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    useClients.mockReturnValue({
      data: { clients: [], remaining: 0, count: 0 },
      isLoading: false,
      isError: false,
    });
    useTeamMembers.mockReturnValue({
      data: { users: [], remaining: 0, count: 0 },
    });

    // One active deal plus all three terminal stages.
    useOpportunities.mockReturnValue({
      data: [
        makeOpportunity({ id: "active", stage: OpportunityStage.Quoting }),
        makeOpportunity({ id: "won", stage: OpportunityStage.Won }),
        makeOpportunity({ id: "lost", stage: OpportunityStage.Lost }),
        makeOpportunity({ id: "discarded", stage: OpportunityStage.Discarded }),
      ],
      isLoading: false,
      isError: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("excludes terminal-stage deals by default (closedDeals omitted)", () => {
    const { result } = renderHook(
      () =>
        usePipelineTableData({
          search: "",
          sorting: [] as PipelineTableSort[],
        }),
      { wrapper: makeWrapper() }
    );

    expect(result.current.rows.map((r) => r.id)).toEqual(["active"]);
    expect(result.current.totalCount).toBe(1);
  });

  it("excludes terminal-stage deals when closedDeals is false", () => {
    const { result } = renderHook(
      () =>
        usePipelineTableData({
          search: "",
          sorting: [] as PipelineTableSort[],
          closedDeals: false,
        }),
      { wrapper: makeWrapper() }
    );

    expect(result.current.rows.map((r) => r.id)).toEqual(["active"]);
  });

  it("includes Won / Lost / Discarded deals when closedDeals is true", () => {
    const { result } = renderHook(
      () =>
        usePipelineTableData({
          search: "",
          sorting: [] as PipelineTableSort[],
          closedDeals: true,
        }),
      { wrapper: makeWrapper() }
    );

    const ids = result.current.rows.map((r) => r.id).sort();
    expect(ids).toEqual(["active", "discarded", "lost", "won"]);
    expect(result.current.totalCount).toBe(4);
  });

  it("always excludes deleted/archived deals regardless of closedDeals", () => {
    useOpportunities.mockReturnValue({
      data: [
        makeOpportunity({ id: "active", stage: OpportunityStage.Quoting }),
        makeOpportunity({ id: "won", stage: OpportunityStage.Won }),
        makeOpportunity({
          id: "won-deleted",
          stage: OpportunityStage.Won,
          deletedAt: daysBeforeNow(1),
        }),
        makeOpportunity({
          id: "won-archived",
          stage: OpportunityStage.Won,
          archivedAt: daysBeforeNow(1),
        }),
      ],
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(
      () =>
        usePipelineTableData({
          search: "",
          sorting: [] as PipelineTableSort[],
          closedDeals: true,
        }),
      { wrapper: makeWrapper() }
    );

    const ids = result.current.rows.map((r) => r.id).sort();
    expect(ids).toEqual(["active", "won"]);
  });
});
