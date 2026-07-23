import React from "react";
import {
  act,
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
import {
  PipelineFocusedDetailWindow,
  getOpportunityTitle,
} from "@/app/(dashboard)/pipeline/_components/pipeline-focused-detail-window";

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

vi.mock("@/lib/hooks/use-opportunity-assigned-context", () => ({
  useOpportunityAssignedContext: () => ({
    data: null,
    isError: false,
    isFetching: false,
  }),
}));

// The map-backed band + Overview tab are new always-/conditionally-mounted body
// children that pull in query hooks (useUpdateOpportunity, useEstimates, …).
// This suite covers the window chrome, not the band internals (which have their
// own suites), so stub them like the other data-dependent body children above.
vi.mock("@/app/(dashboard)/pipeline/_components/lead-map-band", () => ({
  LeadMapBand: () => <div data-testid="lead-map-band" />,
}));

vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-overview-tab",
  () => ({
    PipelineDetailOverviewTab: () => <div />,
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
    assignmentVersion: 0,
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
    handledAt: null,
    operatorActionRequiredAt: null,
    aiSummary: null,
    aiSummaryUpdatedAt: null,
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

function renderWindow(canManage = true) {
  const leadAccess = {
    canView: true,
    canEdit: canManage,
    canAssign: canManage,
    canUnassign: canManage,
    canConvert: canManage,
  };
  return render(
    <>
      <button type="button" data-opportunity-card-id="opp-1">
        Origin card
      </button>
      <div data-testid="pipeline-focused-frame" />
      <PipelineFocusedDetailWindow
        opportunity={makeOpportunity()}
        leadAccess={leadAccess}
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
    expect(titleBar).toHaveClass("backdrop-saturate-[var(--glass-saturate)]");

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

  it("surfaces the job site address in the workspace header", async () => {
    renderWindow();

    const windowShell = await screen.findByTestId("project-workspace-window");

    // The standalone contact strip was replaced by the map-backed band (mocked
    // in this suite). The address still surfaces in the window header subtitle,
    // which buildSubtitle joins with " · " — so match on a substring-tolerant
    // matcher rather than an exact-text node.
    expect(
      within(windowShell).getAllByText((_content, element) =>
        (element?.textContent ?? "").includes("42 Lonsdale Ave")
      ).length
    ).toBeGreaterThan(0);
  });

  it("does not steal focus back into the window body on a bring-to-front store write", async () => {
    // Regression: the window subscribed to the whole store record, so every
    // `focusWindow` bring-to-front (which fires on any in-window pointerdown)
    // re-ran the focus effect and yanked focus out of the just-opened,
    // non-modal assignee popover — dismissing it on focus-out. The narrow
    // shallow selector + per-open focus latch must keep focus where it is.
    async function flushFrames(count = 2) {
      for (let i = 0; i < count; i += 1) {
        await act(async () => {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
          );
        });
      }
    }

    renderWindow();
    const windowShell = await screen.findByTestId("project-workspace-window");
    await flushFrames();

    // Stand in for the operator having moved focus into a popover portaled
    // outside the window body.
    const origin = screen.getByRole("button", { name: "Origin card" });
    origin.focus();
    expect(document.activeElement).toBe(origin);

    await act(async () => {
      useWindowStore.getState().focusWindow("pipeline-detail:opp-1");
    });
    await flushFrames();

    expect(document.activeElement).toBe(origin);
    expect(windowShell.contains(document.activeElement)).toBe(false);
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

  it("closes the nested action menu before closing the detail window", async () => {
    renderWindow();
    const windowShell = await screen.findByTestId("project-workspace-window");

    fireEvent.click(
      within(windowShell).getByRole("button", { name: "Stage actions" })
    );
    expect(
      within(windowShell).getByRole("button", { name: "Archive" })
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      within(windowShell).queryByRole("button", { name: "Archive" })
    ).not.toBeInTheDocument();
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
      "opp-1"
    );
    expect(useWindowStore.getState().windows).toHaveLength(1);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(
        usePipelineModeStore.getState().detailPanelOpportunityId
      ).toBeNull();
    });
  });

  it("leaves Escape with an open nested delete confirmation", async () => {
    renderWindow();
    await screen.findByTestId("project-workspace-window");

    const confirmation = document.createElement("div");
    confirmation.setAttribute("role", "alertdialog");
    confirmation.setAttribute("data-state", "open");
    document.body.appendChild(confirmation);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
      "opp-1"
    );
    expect(useWindowStore.getState().windows).toHaveLength(1);
    confirmation.remove();
  });

  it("does not close for an Escape already owned by a nested control", async () => {
    renderWindow();
    await screen.findByTestId("project-workspace-window");

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    document.dispatchEvent(event);

    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
      "opp-1"
    );
    expect(useWindowStore.getState().windows).toHaveLength(1);
  });

  it("falls back to the deal's table row cell for focus restore when no card exists (table mode)", async () => {
    // Table mode renders no board cards — pipeline/page.tsx mounts this same
    // window for table-row clicks, and focusOrigin restores to the row cell
    // via data-pipeline-table-row-id instead.
    usePipelineModeStore.setState({ mode: "table" });
    render(
      <>
        <div
          role="gridcell"
          tabIndex={-1}
          data-pipeline-table-row-id="opp-1"
          data-testid="origin-row-cell"
        />
        <PipelineFocusedDetailWindow
          opportunity={makeOpportunity()}
          leadAccess={{
            canView: true,
            canEdit: true,
            canAssign: true,
            canUnassign: true,
            canConvert: true,
          }}
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

    await screen.findByTestId("project-workspace-window");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(
        usePipelineModeStore.getState().detailPanelOpportunityId
      ).toBeNull();
      expect(useWindowStore.getState().windows).toHaveLength(0);
      expect(document.activeElement).toBe(
        screen.getByTestId("origin-row-cell")
      );
    });
  });
});

describe("getOpportunityTitle", () => {
  it("joins a distinct title to the display name with an em-dash", () => {
    const opp = {
      ...makeOpportunity(),
      contactName: "Jordan Lee",
      title: "Roof repair",
    };
    expect(getOpportunityTitle(opp, "Lead")).toBe("Jordan Lee — Roof repair");
  });

  it("shows the title alone when it already leads with the display name", () => {
    const opp = {
      ...makeOpportunity(),
      contactName: "North Shore Decks",
      title: "North Shore Decks — deck rebuild",
    };
    // No stutter: "North Shore Decks — North Shore Decks — deck rebuild" avoided.
    expect(getOpportunityTitle(opp, "Lead")).toBe(
      "North Shore Decks — deck rebuild"
    );
  });

  it("matches the name prefix case-insensitively", () => {
    const opp = {
      ...makeOpportunity(),
      contactName: "North Shore Decks",
      title: "NORTH SHORE DECKS phase 2",
    };
    expect(getOpportunityTitle(opp, "Lead")).toBe("NORTH SHORE DECKS phase 2");
  });

  it("falls back to the display name when there is no separate title", () => {
    const opp = {
      ...makeOpportunity(),
      contactName: "Jordan Lee",
      title: "",
    };
    expect(getOpportunityTitle(opp, "Lead")).toBe("Jordan Lee");
  });
});
