import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type Opportunity,
  OpportunityStage,
} from "@/lib/types/pipeline";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { PipelineSpineColumn } from "@/app/(dashboard)/pipeline/_components/pipeline-spine-column";

const dndMocks = vi.hoisted(() => ({
  setNodeRef: vi.fn(),
  useDroppable: vi.fn(() => ({
    setNodeRef: vi.fn(),
    isOver: false,
  })),
}));

vi.mock("@dnd-kit/core", () => ({
  useDroppable: dndMocks.useDroppable,
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (key === "focused.spineLabel") {
        return "{stage}, {count} opportunities";
      }

      return typeof fallback === "string" ? fallback : key;
    },
  }),
}));

const NOW = new Date("2026-05-12T12:00:00.000Z");

function makeOpportunity(id: string): Opportunity {
  return {
    id,
    companyId: "company-1",
    clientId: null,
    title: `Lead ${id}`,
    description: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Quoted,
    source: null,
    assignedTo: null,
    priority: null,
    estimatedValue: null,
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
    images: [],
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    archivedAt: null,
  };
}

function makeOpportunities(count: number): Opportunity[] {
  return Array.from({ length: count }, (_, index) =>
    makeOpportunity(`opp-${index + 1}`)
  );
}

function renderSpine(opportunities: Opportunity[]) {
  return render(
    <PipelineSpineColumn
      stage={OpportunityStage.Quoted}
      opportunities={opportunities}
      distanceFromFocus={1}
      isHovered={false}
      tabId="tab-quoted"
      panelId="panel-quoted"
    />
  );
}

describe("<PipelineSpineColumn>", () => {
  beforeEach(() => {
    dndMocks.useDroppable.mockClear();
    localStorage.clear();
    usePipelineModeStore.setState({
      mode: "focused",
      focusedStage: OpportunityStage.NewLead,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

  it("renders one silhouette per opportunity up to the cap", () => {
    const { container } = renderSpine(makeOpportunities(5));

    expect(
      container.querySelectorAll("[data-testid='pipeline-spine-silhouette']")
    ).toHaveLength(5);
    expect(screen.queryByTestId("pipeline-spine-overflow")).not.toBeInTheDocument();
  });

  it("caps individual silhouettes at 30 and renders a single 30+ block", () => {
    const { container } = renderSpine(makeOpportunities(35));

    expect(
      container.querySelectorAll("[data-testid='pipeline-spine-silhouette']")
    ).toHaveLength(30);
    expect(screen.getAllByTestId("pipeline-spine-overflow")).toHaveLength(1);
    const overflowBlock = screen.getByTestId("pipeline-spine-overflow");

    expect(overflowBlock).toHaveTextContent("30+");
    expect(overflowBlock).toHaveClass("h-3", "min-h-3", "leading-none");
  });

  it("renders as an unselected spine tab", () => {
    renderSpine(makeOpportunities(2));

    const tab = screen.getByRole("tab", {
      name: "Quoted, 2 opportunities",
    });

    expect(tab).toHaveAttribute("id", "tab-quoted");
    expect(tab).toHaveAttribute("aria-controls", "panel-quoted");
    expect(tab).toHaveAttribute("aria-selected", "false");
    expect(tab).toHaveAttribute("tabindex", "-1");
  });

  it("sets the focused stage when clicked", async () => {
    const user = userEvent.setup();
    renderSpine(makeOpportunities(1));

    await user.click(
      screen.getByRole("tab", { name: "Quoted, 1 opportunities" })
    );

    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Quoted
    );
  });

  it("registers the rail as a focused-mode drop target", () => {
    renderSpine(makeOpportunities(1));

    expect(dndMocks.useDroppable).toHaveBeenCalledWith({
      id: `focused-stage-${OpportunityStage.Quoted}`,
      data: {
        stage: OpportunityStage.Quoted,
        mode: "focused",
        focusedDropIntent: "stage-target",
      },
      disabled: false,
    });
  });
});
