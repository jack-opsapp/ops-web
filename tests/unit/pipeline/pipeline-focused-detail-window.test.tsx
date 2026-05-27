import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Opportunity, OpportunityStage } from "@/lib/types/pipeline";
import { useWindowStore } from "@/stores/window-store";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { PipelineFocusedDetailWindow } from "@/app/(dashboard)/pipeline/_components/pipeline-focused-detail-window";

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
    span: ({
      children,
      animate: _animate,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLSpanElement> & Record<string, unknown>) => (
      <span {...props}>{children}</span>
    ),
  },
  useReducedMotion: () => true,
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        "actions.archive": "Archive",
        "actions.delete": "Delete",
        "actions.discard": "Discard",
        "detail.advance": "Advance",
        "detail.daysInStage": "d",
        "detail.lost": "Lost",
        "detail.noContact": "No contact",
        "detail.stageActions": "Stage actions",
        "detail.tabCorrespondence": "Correspondence",
        "detail.tabPhotos": "Photos",
        "detail.tabTimeline": "Timeline",
        "detail.unknown": "Unknown",
        "detail.windowCrumb": "DEAL",
        "detail.windowDockTitle": "Deal detail",
        "detail.won": "Won",
        "focused.detailPanel.label": "Deal detail panel",
        "mode.viewing": "VIEWING",
        "traffic.close": "Close",
        "traffic.maximize": "Maximize",
        "traffic.minimize": "Minimize",
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

function makeOpportunity(): Opportunity {
  return {
    id: "opp-1",
    companyId: "company-1",
    clientId: null,
    title: "Deck rebuild",
    description: null,
    contactName: "Jordan Lee",
    contactEmail: "jordan@example.com",
    contactPhone: "778-555-0199",
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
    address: "42 Lonsdale Ave",
    latitude: 49.313,
    longitude: -123.082,
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

function renderWindow(canManage = true) {
  return render(
    <>
      <button type="button" data-opportunity-card-id="opp-1">
        Origin card
      </button>
      <div data-testid="pipeline-focused-frame" />
      <PipelineFocusedDetailWindow
        opportunity={makeOpportunity()}
        canManage={canManage}
        originatingOpportunityId="opp-1"
        onAdvanceStage={vi.fn()}
        onMarkWon={vi.fn()}
        onMarkLost={vi.fn()}
        onArchive={vi.fn()}
        onDiscard={vi.fn()}
        onDelete={vi.fn()}
      />
    </>
  );
}

describe("<PipelineFocusedDetailWindow>", () => {
  beforeEach(() => {
    localStorage.clear();
    useWindowStore.setState({ windows: [], nextZIndex: 2000 });
    usePipelineModeStore.setState({
      mode: "focused",
      focusedStage: OpportunityStage.Quoted,
      detailPanelOpportunityId: "opp-1",
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

  it("uses the project workspace window shell and shared window store", async () => {
    renderWindow();

    const windowShell = await screen.findByTestId("project-workspace-window");
    const titleBar = within(windowShell).getByTestId("workspace-title-bar");

    expect(windowShell).toHaveClass("rounded-modal");
    expect(windowShell).toHaveClass("border-glass-border");
    expect(windowShell).toHaveClass("bg-transparent");
    expect(windowShell).toHaveAttribute("data-keyboard-scope", "modal-or-menu");
    expect(windowShell).toHaveStyle({ boxShadow: "var(--shadow-window)" });
    expect(titleBar).toHaveClass("bg-[var(--glass-bg-dense)]");
    expect(titleBar).toHaveClass("backdrop-blur-[var(--glass-blur)]");
    expect(titleBar).toHaveClass(
      "backdrop-saturate-[var(--glass-saturate)]"
    );

    const bodySurface = within(windowShell).getByTestId("workspace-body-slot");
    expect(bodySurface).toHaveClass("bg-[var(--glass-bg-dense)]");
    expect(bodySurface).toHaveClass("backdrop-blur-[var(--glass-blur)]");
    expect(bodySurface).toHaveClass(
      "backdrop-saturate-[var(--glass-saturate)]"
    );
    expect(titleBar).toHaveTextContent("// DEAL");
    expect(titleBar).toHaveTextContent("OPP-1");
    expect(titleBar).toHaveTextContent("QUOTED");
    expect(screen.getByTestId("mode-pill-viewing")).toHaveTextContent(
      "VIEWING"
    );
    expect(useWindowStore.getState().windows[0]).toMatchObject({
      id: "pipeline-detail:opp-1",
      type: "pipeline-detail",
      title: "Deal detail",
    });
    expect(
      windowShell.closest("[data-testid='pipeline-focused-frame']")
    ).toBeNull();
  });

  it("keeps detail actions and tabs available inside the workspace shell", async () => {
    renderWindow();

    const windowShell = await screen.findByTestId("project-workspace-window");

    expect(
      within(windowShell).getByRole("button", { name: "Correspondence" })
    ).toBeInTheDocument();
    expect(
      within(windowShell).getByRole("button", { name: "Timeline" })
    ).toBeInTheDocument();
    expect(
      within(windowShell).getByRole("button", { name: "Photos" })
    ).toBeInTheDocument();

    fireEvent.click(
      within(windowShell).getByRole("button", { name: "Stage actions" })
    );

    expect(
      within(windowShell).getByRole("button", { name: "Advance" })
    ).toBeInTheDocument();
    expect(
      within(windowShell).getByRole("button", { name: "Won" })
    ).toBeInTheDocument();
    expect(
      within(windowShell).getByRole("button", { name: "Lost" })
    ).toBeInTheDocument();
    expect(
      within(windowShell).getByRole("button", { name: "Archive" })
    ).toBeInTheDocument();
  });

  it("surfaces the job site in the workspace header and contact strip", async () => {
    renderWindow();

    const windowShell = await screen.findByTestId("project-workspace-window");

    expect(within(windowShell).getAllByText("42 Lonsdale Ave").length).toBeGreaterThan(0);
  });

  it("closes on Escape and restores focus to the originating card", async () => {
    renderWindow();

    await screen.findByTestId("project-workspace-window");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(
        usePipelineModeStore.getState().detailPanelOpportunityId
      ).toBeNull();
      expect(useWindowStore.getState().windows).toHaveLength(0);
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Origin card" })
      );
    });
  });
});
