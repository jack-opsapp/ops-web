import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Opportunity,
  OpportunityStage,
} from "@/lib/types/pipeline";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { PipelineFocusedCard } from "@/app/(dashboard)/pipeline/_components/pipeline-focused-card";

const dndMocks = vi.hoisted(() => ({
  pointerDown: vi.fn(),
  keyDown: vi.fn(),
  setActivatorNodeRef: vi.fn(),
  setNodeRef: vi.fn(),
}));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: { "data-dnd-activator": "true" },
    listeners: {
      onPointerDown: dndMocks.pointerDown,
      onKeyDown: dndMocks.keyDown,
    },
    setActivatorNodeRef: dndMocks.setActivatorNodeRef,
    setNodeRef: dndMocks.setNodeRef,
    transform: null,
    isDragging: false,
  }),
}));

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion"
  );

  return {
    ...actual,
    useReducedMotion: () => false,
  };
});

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        "focused.dragHandle.label": "Drag card to another stage",
        "focused.openDetail.label": "Open deal details",
        "spatial.emailCount": "{count} emails",
        "card.followUpDate": "Follow up {date}",
        "actions.logCall": "Log call",
        "actions.logText": "Log text",
        "actions.openDetail": "Open detail",
        "actions.addNote": "Add note",
        "actions.more": "More",
        "actions.notePlaceholder": "Note",
        "spatial.confirm": "Confirm",
      };

      return translations[key] ?? fallback ?? key;
    },
  }),
}));

const NOW = new Date("2026-05-12T12:00:00.000Z");

function makeOpportunity(): Opportunity {
  return {
    id: "opp-1",
    companyId: "company-1",
    clientId: "client-1",
    title: "Deck rebuild",
    description: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Quoted,
    source: null,
    assignedTo: null,
    priority: null,
    estimatedValue: 12500,
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
    correspondenceCount: 3,
    outboundCount: 2,
    inboundCount: 1,
    lastInboundAt: NOW,
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

function renderFocusedCard() {
  return render(
    <PipelineFocusedCard
      opportunity={makeOpportunity()}
      clientName="North Shore Decks"
      stageColor="#8F9AA3"
      stalenessOpacity={1}
      canManage={true}
      onLogCall={vi.fn()}
      onLogText={vi.fn()}
      onAddNote={vi.fn()}
      onArchive={vi.fn()}
      onDiscard={vi.fn()}
      onMarkWon={vi.fn()}
      onMarkLost={vi.fn()}
      onAssign={vi.fn()}
      onScheduleFollowUp={vi.fn()}
    />
  );
}

describe("<PipelineFocusedCard>", () => {
  beforeEach(() => {
    dndMocks.pointerDown.mockClear();
    dndMocks.keyDown.mockClear();
    dndMocks.setActivatorNodeRef.mockClear();
    dndMocks.setNodeRef.mockClear();
    localStorage.clear();
    usePipelineModeStore.setState({
      mode: "focused",
      focusedStage: OpportunityStage.Quoted,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

  it("uses a native labeled button as the drag activator", () => {
    renderFocusedCard();

    const dragActivator = screen.getByRole("button", {
      name: "Drag card to another stage",
    });

    expect(dragActivator).toHaveAttribute("data-dnd-activator", "true");
    expect(dragActivator).toHaveClass("min-h-11", "w-11");
    expect(dndMocks.setActivatorNodeRef).toHaveBeenCalled();
  });

  it("keeps drag listeners off the open-detail body target", () => {
    renderFocusedCard();

    const dragActivator = screen.getByRole("button", {
      name: "Drag card to another stage",
    });
    const openDetailBody = screen.getByRole("button", {
      name: "Open deal details: Deck rebuild",
    });

    expect(openDetailBody).not.toHaveAttribute("data-dnd-activator");

    fireEvent.pointerDown(openDetailBody);
    expect(dndMocks.pointerDown).not.toHaveBeenCalled();

    fireEvent.pointerDown(dragActivator);
    expect(dndMocks.pointerDown).toHaveBeenCalledTimes(1);
  });
});
