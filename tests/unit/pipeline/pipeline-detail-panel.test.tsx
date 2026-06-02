import React, { useRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Opportunity, OpportunityStage } from "@/lib/types/pipeline";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { PipelineDetailPanel } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-panel";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  motion: {
    div: ({
      children,
      layout: _layout,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
    aside: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>) => (
      <aside {...props}>{children}</aside>
    ),
  },
  useReducedMotion: () => true,
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        "detail.advance": "Advance",
        "detail.daysInStage": "d",
        "detail.lost": "Lost",
        "detail.noContact": "No contact",
        "detail.stageActions": "Stage actions",
        "detail.tabCorrespondence": "Correspondence",
        "detail.tabPhotos": "Photos",
        "detail.tabTimeline": "Timeline",
        "detail.unknown": "Unknown",
        "detail.won": "Won",
        "actions.archive": "Archive",
        "actions.delete": "Delete",
        "actions.discard": "Discard",
      };

      return translations[key] ?? fallback ?? key;
    },
  }),
}));

vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-correspondence-tab",
  () => ({
    PipelineDetailCorrespondenceTab: () => (
      <button type="button">Thread action</button>
    ),
  })
);

vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-next-steps",
  () => ({
    PipelineDetailNextSteps: () => null,
  })
);

vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-photos-tab",
  () => ({
    PipelineDetailPhotosTab: () => <div />,
  })
);

vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-timeline-tab",
  () => ({
    PipelineDetailTimelineTab: () => <div />,
  })
);

const NOW = new Date("2026-05-12T12:00:00.000Z");

function makeRect({
  top,
  left,
  width,
  height,
}: {
  top: number;
  left: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeOpportunity(): Opportunity {
  return {
    id: "opp-1",
    companyId: "company-1",
    clientId: null,
    title: "Deck rebuild",
    description: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Quoted,
    source: null,
    assignedTo: null,
    priority: null,
    estimatedValue: 12000,
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

function Harness({
  canManage = false,
  scopeBounds = { top: 80, left: 72, width: 1000, height: 720 },
}: {
  canManage?: boolean;
  scopeBounds?: { top: number; left: number; width: number; height: number };
}) {
  const detailPanelOpportunityId = usePipelineModeStore(
    (state) => state.detailPanelOpportunityId
  );
  const scopeRef = useRef<HTMLElement | null>(null);
  if (!scopeRef.current) {
    scopeRef.current = document.createElement("div");
  }
  scopeRef.current.getBoundingClientRect = () => makeRect(scopeBounds);

  return (
    <>
      <button type="button" data-opportunity-card-id="opp-1">
        Origin card
      </button>
      <div data-testid="pipeline-scope" />
      {detailPanelOpportunityId ? (
        <PipelineDetailPanel
          opportunity={makeOpportunity()}
          canManage={canManage}
          originatingOpportunityId="opp-1"
          scopeRef={scopeRef}
          onAdvanceStage={vi.fn()}
          onMarkWon={vi.fn()}
          onMarkLost={vi.fn()}
          onArchive={vi.fn()}
          onDiscard={vi.fn()}
          onDelete={vi.fn()}
        />
      ) : null}
    </>
  );
}

describe("<PipelineDetailPanel>", () => {
  beforeEach(() => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query.includes("max-width: 1279px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    localStorage.clear();
    usePipelineModeStore.setState({
      mode: "focused",
      focusedStage: OpportunityStage.Quoted,
      detailPanelOpportunityId: "opp-1",
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

  it("moves focus inside the focused drawer after the portal mounts", async () => {
    render(<Harness />);

    const panel = await screen.findByRole("region", {
      name: "Deal detail panel",
    });

    await waitFor(() => {
      expect(panel).toContainElement(document.activeElement as HTMLElement);
    });
  });

  it("renders focused detail as a portaled drawer outside the scope", async () => {
    render(
      <Harness scopeBounds={{ top: 80, left: 72, width: 1180, height: 780 }} />
    );

    const panel = await screen.findByRole("region", {
      name: "Deal detail panel",
    });
    const drawer = panel.closest("aside");

    expect(drawer).toHaveClass("fixed");
    expect(drawer).not.toHaveAttribute("data-pipeline-detail-surface");
    expect(panel.closest("[data-testid='pipeline-scope']")).toBeNull();
  });

  it("keeps detail actions and tabs available inside the surface", async () => {
    render(<Harness canManage />);

    expect(
      await screen.findByRole("button", { name: "Correspondence" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Timeline" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Photos" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stage actions" }));

    expect(screen.getByRole("button", { name: "Advance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Won" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lost" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the originating card", async () => {
    render(<Harness />);

    const panel = await screen.findByRole("region", {
      name: "Deal detail panel",
    });

    await waitFor(() => {
      expect(panel).toContainElement(document.activeElement as HTMLElement);
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(
        usePipelineModeStore.getState().detailPanelOpportunityId
      ).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Origin card" })
      );
    });
  });
});
