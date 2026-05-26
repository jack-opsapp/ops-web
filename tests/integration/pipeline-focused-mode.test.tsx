import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Opportunity, OpportunityStage } from "@/lib/types/pipeline";
import { PipelineFilterRow } from "@/app/(dashboard)/pipeline/_components/pipeline-filter-row";
import { PipelineFocusedShell } from "@/app/(dashboard)/pipeline/_components/pipeline-focused-shell";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import {
  resolvePipelineDragEnd,
  type PipelineDropData,
} from "@/app/(dashboard)/pipeline/_components/pipeline-dnd-resolution";

const dndMocks = vi.hoisted(() => ({
  useDroppable: vi.fn(() => ({
    setNodeRef: vi.fn(),
    isOver: false,
  })),
}));

vi.mock("@dnd-kit/core", async () => {
  const actual =
    await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");

  return {
    ...actual,
    useDroppable: dndMocks.useDroppable,
  };
});

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      layout: _layout,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      layout?: boolean;
      transition?: unknown;
    }) => <div {...props}>{children}</div>,
  },
  useReducedMotion: () => true,
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        "focused.tablist.label": "Pipeline stages",
        "focused.loading.count": "loading",
        "focused.search.placeholder": "search pipeline...",
        "focused.empty.title": "// NO LEADS",
        "focused.empty.action": "[+ ADD LEAD]",
        "focused.filteredEmpty.title": "// NO MATCHES FOR FILTERS",
        "focused.filteredEmpty.action": "[CLEAR FILTERS]",
        "focused.error.title": "// PIPELINE UNREACHABLE",
        "focused.error.action": "[RETRY]",
        "focused.metrics.count": "COUNT",
        "focused.metrics.value": "VALUE",
        "focused.metrics.avgDays": "AVG DAYS",
        "focused.spineLabel": "{stage}, {count} opportunities",
        "focused.terminalStack.label": "Terminal stages",
        "focused.terminalStack.itemLabel": "{stage}, {count} opportunities",
        "filter.allStages": "All Stages",
        "filter.everyone": "Everyone",
        newLead: "New Lead",
        "card.unknown": "Unknown",
      };

      return translations[key] ?? fallback ?? key;
    },
  }),
}));

vi.mock("@/app/(dashboard)/pipeline/_components/pipeline-focused-card", () => ({
  PipelineFocusedCard: ({ opportunity }: { opportunity: Opportunity }) => (
    <article data-testid="focused-card">{opportunity.title}</article>
  ),
}));

vi.mock("@/app/(dashboard)/pipeline/_components/pipeline-detail-panel", () => ({
  PipelineDetailPanel: () => <aside data-testid="detail-panel" />,
}));

const NOW = new Date("2026-05-12T12:00:00.000Z");

function makeOpportunity(
  id: string,
  stage: OpportunityStage,
  title: string
): Opportunity {
  return {
    id,
    companyId: "company-1",
    clientId: null,
    title,
    description: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    stage,
    source: null,
    assignedTo: null,
    priority: null,
    estimatedValue: 1000,
    actualValue: null,
    winProbability: 60,
    expectedCloseDate: null,
    actualCloseDate: null,
    stageEnteredAt: NOW,
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
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    archivedAt: null,
  };
}

function PipelineFocusedModeHarness() {
  const [opportunities, setOpportunities] = React.useState<Opportunity[]>([
    makeOpportunity("opp-1", OpportunityStage.NewLead, "Fence repair"),
    makeOpportunity("opp-2", OpportunityStage.Quoted, "Deck rebuild"),
  ]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState<
    OpportunityStage | "all"
  >("all");
  const [assigneeFilter, setAssigneeFilter] = React.useState<string | "all">(
    "all"
  );
  const [transitionStage, setTransitionStage] =
    React.useState<OpportunityStage | null>(null);
  const [moveStageCall, setMoveStageCall] = React.useState<string | null>(null);
  const [undoLabel, setUndoLabel] = React.useState<string | null>(null);
  const mode = usePipelineModeStore((state) => state.mode);
  const filtersActive =
    searchQuery.trim().length > 0 ||
    stageFilter !== "all" ||
    assigneeFilter !== "all";
  const filteredOpportunities = React.useMemo(() => {
    let result = opportunities;

    if (stageFilter !== "all") {
      result = result.filter(
        (opportunity) => opportunity.stage === stageFilter
      );
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((opportunity) =>
        opportunity.title?.toLowerCase().includes(query)
      );
    }

    return result;
  }, [opportunities, searchQuery, stageFilter]);

  function moveFocusedOpportunity(id: string, stage: OpportunityStage) {
    const opportunity = opportunities.find((candidate) => candidate.id === id);
    if (!opportunity) return;

    if (stage === OpportunityStage.Won || stage === OpportunityStage.Lost) {
      setTransitionStage(stage);
      return;
    }

    setMoveStageCall(`${id}:${stage}`);
    setUndoLabel(`${opportunity.title} -> ${stage}`);
    setOpportunities((current) =>
      current.map((candidate) =>
        candidate.id === id
          ? { ...candidate, stage, stageEnteredAt: new Date(NOW.getTime() + 1) }
          : candidate
      )
    );
  }

  function simulateFocusedDrop(stage: OpportunityStage, isTerminal = false) {
    const drop = resolvePipelineDragEnd({
      mode: "focused",
      draggedId: "opp-1",
      selectedCardIds: new Set(),
      dropData: {
        mode: "focused",
        stage,
        isTerminal,
        focusedDropIntent: "stage-target",
      } satisfies PipelineDropData,
    });

    if (drop.type !== "focused-stage") return;
    moveFocusedOpportunity(drop.opportunityId, drop.stage);
  }

  return (
    <div>
      <PipelineFilterRow
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        stageFilter={stageFilter}
        onStageFilterChange={setStageFilter}
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        teamMembers={[]}
        onAddLead={vi.fn()}
        canManage={true}
      />
      {mode === "focused" ? (
        <PipelineFocusedShell
          opportunities={filteredOpportunities}
          clientNameMap={new Map()}
          canManage={true}
          filtersActive={filtersActive}
          dragAnnouncement=""
          onAddLead={vi.fn()}
          onClearFilters={() => {
            setSearchQuery("");
            setStageFilter("all");
            setAssigneeFilter("all");
          }}
          onLogCall={vi.fn()}
          onLogText={vi.fn()}
          onAddNote={vi.fn()}
          onArchive={vi.fn()}
          onDiscard={vi.fn()}
          onMarkWon={(opportunity) =>
            moveFocusedOpportunity(opportunity.id, OpportunityStage.Won)
          }
          onMarkLost={(opportunity) =>
            moveFocusedOpportunity(opportunity.id, OpportunityStage.Lost)
          }
          onAdvanceStage={vi.fn()}
          onMoveStage={moveFocusedOpportunity}
          onAssign={vi.fn()}
          onScheduleFollowUp={vi.fn()}
          onDelete={vi.fn()}
        />
      ) : (
        <div data-testid="spatial-mode">spatial mode</div>
      )}
      <button
        type="button"
        onClick={() => simulateFocusedDrop(OpportunityStage.Won, true)}
      >
        drop won
      </button>
      <button
        type="button"
        onClick={() => simulateFocusedDrop(OpportunityStage.Quoted)}
      >
        drop quoted
      </button>
      {transitionStage && (
        <div role="dialog" aria-label="stage transition">
          transition:{transitionStage}
        </div>
      )}
      {moveStageCall && (
        <output data-testid="move-stage">{moveStageCall}</output>
      )}
      {undoLabel && <output data-testid="undo-label">{undoLabel}</output>}
    </div>
  );
}

describe("pipeline focused mode integration", () => {
  beforeEach(() => {
    localStorage.clear();
    dndMocks.useDroppable.mockClear();
    usePipelineModeStore.setState({
      mode: "focused",
      focusedStage: OpportunityStage.NewLead,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

  it("preserves filter and search state across focused/spatial mode toggle", async () => {
    const user = userEvent.setup();
    render(<PipelineFocusedModeHarness />);

    await user.type(
      screen.getByRole("searchbox", { name: "search pipeline..." }),
      "deck"
    );
    await user.click(screen.getByRole("button", { name: "All Stages" }));
    await user.click(screen.getByRole("option", { name: "Quoted" }));

    fireEvent.keyDown(window, { key: "v" });

    await waitFor(() => {
      expect(screen.getByTestId("spatial-mode")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("searchbox", { name: "search pipeline..." })
    ).toHaveValue("deck");
    expect(screen.getByRole("button", { name: "Quoted" })).toBeInTheDocument();
  });

  it("keeps the focused stage when filters empty it and renders filtered-empty", async () => {
    const user = userEvent.setup();
    act(() => {
      usePipelineModeStore.getState().setFocusedStage(OpportunityStage.Quoted);
    });
    render(<PipelineFocusedModeHarness />);

    await user.click(screen.getByRole("button", { name: "All Stages" }));
    await user.click(screen.getByRole("option", { name: "New Lead" }));

    expect(screen.getByText("// NO MATCHES FOR FILTERS")).toBeInTheDocument();
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Quoted
    );
  });

  it("opens the transition dialog seam when a focused drag resolves to Won", async () => {
    const user = userEvent.setup();
    render(<PipelineFocusedModeHarness />);

    await user.click(screen.getByRole("button", { name: "drop won" }));

    expect(
      screen.getByRole("dialog", { name: "stage transition" })
    ).toHaveTextContent(`transition:${OpportunityStage.Won}`);
  });

  it("fires the move seam, optimistic stage update, and undo dispatch for spine drops", async () => {
    const user = userEvent.setup();
    render(<PipelineFocusedModeHarness />);

    await user.click(screen.getByRole("button", { name: "drop quoted" }));

    expect(screen.getByTestId("move-stage")).toHaveTextContent(
      `opp-1:${OpportunityStage.Quoted}`
    );
    expect(screen.getByTestId("undo-label")).toHaveTextContent(
      `Fence repair -> ${OpportunityStage.Quoted}`
    );
    act(() => {
      usePipelineModeStore.getState().setFocusedStage(OpportunityStage.Quoted);
    });
    expect(
      screen.getAllByTestId("focused-card").map((card) => card.textContent)
    ).toContain("Fence repair");
  });
});
