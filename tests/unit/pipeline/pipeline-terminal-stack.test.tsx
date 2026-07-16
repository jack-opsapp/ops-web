import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Opportunity, OpportunityStage } from "@/lib/types/pipeline";
import { PipelineTerminalStack } from "@/app/(dashboard)/pipeline/_components/pipeline-terminal-stack";

const dndMocks = vi.hoisted(() => ({
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
      if (key === "focused.terminalStack.label") return "Terminal stages";
      if (key === "focused.terminalStack.itemLabel") {
        return "{stage}, {count} opportunities";
      }

      return typeof fallback === "string" ? fallback : key;
    },
  }),
}));

const NOW = new Date("2026-05-12T12:00:00.000Z");

function makeOpportunity(id: string, stage: OpportunityStage): Opportunity {
  return {
    id,
    companyId: "company-1",
    clientId: null,
    title: `Lead ${id}`,
    description: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    stage,
    source: null,
    assignedTo: null,
    assignmentVersion: 0,
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

describe("<PipelineTerminalStack>", () => {
  beforeEach(() => {
    dndMocks.useDroppable.mockClear();
  });

  it("registers won and lost as focused-mode terminal drop targets", () => {
    render(
      <PipelineTerminalStack
        wonOpportunities={[makeOpportunity("won-1", OpportunityStage.Won)]}
        lostOpportunities={[makeOpportunity("lost-1", OpportunityStage.Lost)]}
        focusedStage={OpportunityStage.NewLead}
        panelId="pipeline-focused-panel"
        onSelectStage={vi.fn()}
      />
    );

    expect(dndMocks.useDroppable).toHaveBeenCalledWith({
      id: `focused-terminal-${OpportunityStage.Won}`,
      data: {
        stage: OpportunityStage.Won,
        isTerminal: true,
        mode: "focused",
        focusedDropIntent: "stage-target",
      },
      disabled: false,
    });
    expect(dndMocks.useDroppable).toHaveBeenCalledWith({
      id: `focused-terminal-${OpportunityStage.Lost}`,
      data: {
        stage: OpportunityStage.Lost,
        isTerminal: true,
        mode: "focused",
        focusedDropIntent: "stage-target",
      },
      disabled: false,
    });
  });

  it("still selects the terminal stage on click", async () => {
    const user = userEvent.setup();
    const onSelectStage = vi.fn();

    render(
      <PipelineTerminalStack
        wonOpportunities={[makeOpportunity("won-1", OpportunityStage.Won)]}
        lostOpportunities={[]}
        focusedStage={OpportunityStage.NewLead}
        panelId="pipeline-focused-panel"
        onSelectStage={onSelectStage}
      />
    );

    await user.click(screen.getByRole("tab", { name: "Won, 1 opportunities" }));

    expect(onSelectStage).toHaveBeenCalledWith(OpportunityStage.Won);
  });

  it("renders terminal entries as roving tabs controlling the focused panel", () => {
    render(
      <PipelineTerminalStack
        wonOpportunities={[makeOpportunity("won-1", OpportunityStage.Won)]}
        lostOpportunities={[]}
        focusedStage={OpportunityStage.Won}
        panelId="pipeline-focused-panel"
        onSelectStage={vi.fn()}
      />
    );

    const wonTab = screen.getByRole("tab", { name: "Won, 1 opportunities" });
    const lostTab = screen.getByRole("tab", { name: "Lost, 0 opportunities" });

    expect(wonTab).toHaveAttribute("aria-selected", "true");
    expect(wonTab).toHaveAttribute("aria-controls", "pipeline-focused-panel");
    expect(wonTab).toHaveAttribute("tabindex", "0");
    expect(lostTab).toHaveAttribute("aria-selected", "false");
    expect(lostTab).toHaveAttribute("tabindex", "-1");
  });
});
