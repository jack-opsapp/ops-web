import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpportunityStage,
  OpportunitySource,
  OpportunityPriority,
  type Opportunity,
} from "@/lib/types/pipeline";
import type { PipelineTableSort } from "@/lib/types/pipeline-table";

// The data hook fans out to four query hooks; mock each so the search / sort /
// active-stage-filter logic can be asserted under a deterministic data set.
vi.mock("@/lib/hooks/use-opportunities", () => ({
  useOpportunities: vi.fn(),
}));
vi.mock("@/lib/hooks/use-clients", () => ({
  useClients: vi.fn(),
}));
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: vi.fn(),
}));
vi.mock("@/lib/hooks/pipeline-table/use-pipeline-stage-configs", () => ({
  usePipelineStageConfigs: vi.fn(),
  // The real stageConfigBySlug is a pure Map builder; reuse a faithful copy.
  stageConfigBySlug: (configs: Array<{ slug: string }>) =>
    new Map(configs.map((c) => [c.slug, c])),
}));

import { useOpportunities } from "@/lib/hooks/use-opportunities";
import { useClients } from "@/lib/hooks/use-clients";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { usePipelineStageConfigs } from "@/lib/hooks/pipeline-table/use-pipeline-stage-configs";
import { usePipelineTableData } from "@/lib/hooks/pipeline-table/use-pipeline-table-data";

const BASE_DATE = new Date("2026-06-01T00:00:00Z");

function makeOpportunity(overrides: Partial<Opportunity>): Opportunity {
  return {
    id: "opp-x",
    companyId: "company-1",
    clientId: null,
    title: "Untitled",
    description: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.NewLead,
    source: OpportunitySource.Referral,
    assignedTo: null,
    priority: null,
    estimatedValue: null,
    actualValue: null,
    winProbability: 0,
    expectedCloseDate: null,
    actualCloseDate: null,
    stageEnteredAt: BASE_DATE,
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
    aiSummary: null,
    aiStageConfidence: null,
    aiStageSignals: null,
    detectedValue: null,
    lastActivityAt: null,
    nextFollowUpAt: null,
    tags: [],
    images: [],
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function setOpportunities(
  opportunities: Opportunity[],
  flags?: { isLoading?: boolean; isError?: boolean },
) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: opportunities,
    isLoading: flags?.isLoading ?? false,
    isError: flags?.isError ?? false,
  } as unknown as ReturnType<typeof useOpportunities>);
}

beforeEach(() => {
  vi.mocked(useClients).mockReturnValue({
    data: { clients: [{ id: "client-1", name: "Acme Roofing" }], remaining: 0, count: 1 },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useClients>);
  vi.mocked(useTeamMembers).mockReturnValue({
    data: {
      users: [{ id: "user-1", firstName: "Mara", lastName: "Silva" }],
      remaining: 0,
      count: 1,
    },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useTeamMembers>);
  vi.mocked(usePipelineStageConfigs).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof usePipelineStageConfigs>);
});

afterEach(() => {
  vi.clearAllMocks();
});

const NO_SORT: PipelineTableSort[] = [];

describe("usePipelineTableData", () => {
  it("excludes deleted, archived, and terminal-stage opportunities", () => {
    setOpportunities([
      makeOpportunity({ id: "active", stage: OpportunityStage.Quoting }),
      makeOpportunity({ id: "won", stage: OpportunityStage.Won }),
      makeOpportunity({ id: "lost", stage: OpportunityStage.Lost }),
      makeOpportunity({ id: "discarded", stage: OpportunityStage.Discarded }),
      makeOpportunity({ id: "deleted", stage: OpportunityStage.Quoting, deletedAt: BASE_DATE }),
      makeOpportunity({ id: "archived", stage: OpportunityStage.Quoting, archivedAt: BASE_DATE }),
    ]);

    const { result } = renderHook(() => usePipelineTableData({ search: "", sorting: NO_SORT }));

    expect(result.current.rows.map((r) => r.id)).toEqual(["active"]);
    expect(result.current.totalCount).toBe(1);
  });

  it("filters by case-insensitive search over title, client, and assignee", () => {
    setOpportunities([
      makeOpportunity({ id: "by-title", title: "Skylight install" }),
      makeOpportunity({ id: "by-client", title: "Other", clientId: "client-1" }),
      makeOpportunity({ id: "by-assignee", title: "Other", assignedTo: "user-1" }),
      makeOpportunity({ id: "no-match", title: "Gutter" }),
    ]);

    const { result } = renderHook(() =>
      usePipelineTableData({ search: "SKY", sorting: NO_SORT }),
    );
    expect(result.current.rows.map((r) => r.id)).toEqual(["by-title"]);

    const { result: byClient } = renderHook(() =>
      usePipelineTableData({ search: "acme", sorting: NO_SORT }),
    );
    expect(byClient.current.rows.map((r) => r.id)).toEqual(["by-client"]);

    const { result: byAssignee } = renderHook(() =>
      usePipelineTableData({ search: "silva", sorting: NO_SORT }),
    );
    expect(byAssignee.current.rows.map((r) => r.id)).toEqual(["by-assignee"]);

    // totalCount ignores the search filter (active set is all four).
    expect(result.current.totalCount).toBe(4);
  });

  it("sorts numbers ascending and descending with nulls always last", () => {
    setOpportunities([
      makeOpportunity({ id: "high", estimatedValue: 9000 }),
      makeOpportunity({ id: "low", estimatedValue: 100 }),
      makeOpportunity({ id: "none", estimatedValue: null }),
    ]);

    const asc = renderHook(() =>
      usePipelineTableData({ search: "", sorting: [{ field: "value", direction: "asc" }] }),
    );
    expect(asc.result.current.rows.map((r) => r.id)).toEqual(["low", "high", "none"]);

    const desc = renderHook(() =>
      usePipelineTableData({ search: "", sorting: [{ field: "value", direction: "desc" }] }),
    );
    expect(desc.result.current.rows.map((r) => r.id)).toEqual(["high", "low", "none"]);
  });

  it("sorts strings case-insensitively by deal title", () => {
    setOpportunities([
      makeOpportunity({ id: "b", title: "beta" }),
      makeOpportunity({ id: "a", title: "Alpha" }),
      makeOpportunity({ id: "c", title: "Charlie" }),
    ]);

    const { result } = renderHook(() =>
      usePipelineTableData({ search: "", sorting: [{ field: "deal", direction: "asc" }] }),
    );
    expect(result.current.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("resolves client, assignee, and priority onto the mapped row", () => {
    setOpportunities([
      makeOpportunity({
        id: "rich",
        title: "Deck",
        clientId: "client-1",
        assignedTo: "user-1",
        priority: OpportunityPriority.High,
      }),
    ]);

    const { result } = renderHook(() => usePipelineTableData({ search: "", sorting: NO_SORT }));
    const row = result.current.rows[0];
    expect(row.clientName).toBe("Acme Roofing");
    expect(row.assigneeName).toBe("Mara Silva");
    expect(row.priority).toBe("high");
  });

  it("surfaces loading and error from the underlying queries", () => {
    setOpportunities([], { isLoading: true });
    const loading = renderHook(() => usePipelineTableData({ search: "", sorting: NO_SORT }));
    expect(loading.result.current.isLoading).toBe(true);

    setOpportunities([], { isError: true });
    const errored = renderHook(() => usePipelineTableData({ search: "", sorting: NO_SORT }));
    expect(errored.result.current.isError).toBe(true);
  });
});
