import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

import { type Opportunity, OpportunityStage } from "@/lib/types/pipeline";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { PipelineMobileDetailDrawer } from "@/app/(dashboard)/pipeline/_components/pipeline-mobile-detail-drawer";

expect.extend(jestDomMatchers);

const mockRouterReplace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        "actions.archive": "Archive",
        "detail.stageActions": "Stage actions",
      };
      return translations[key] ?? fallback ?? key;
    },
    dict: {},
  }),
}));

// The drawer hosts the REAL PipelineDetailBody + action menu; stub the
// data-backed body children exactly like the detail-window suite does.
vi.mock("@/lib/hooks/use-opportunity-assigned-context", () => ({
  useOpportunityAssignedContext: () => ({
    data: null,
    error: null,
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/app/(dashboard)/pipeline/_components/lead-map-band", () => ({
  LeadMapBand: () => <div data-testid="mock-band" />,
}));
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-overview-tab",
  () => ({
    PipelineDetailOverviewTab: () => <div data-testid="mock-overview" />,
  })
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-correspondence-tab",
  () => ({ PipelineDetailCorrespondenceTab: () => <div /> })
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-timeline-tab",
  () => ({ PipelineDetailTimelineTab: () => <div /> })
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-photos-tab",
  () => ({ PipelineDetailPhotosTab: () => <div /> })
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-next-steps",
  () => ({ PipelineDetailNextSteps: () => null })
);

const NOW = new Date("2026-07-16T12:00:00.000Z");

function makeOpportunity(): Opportunity {
  return {
    id: "opp-1",
    companyId: "company-1",
    clientId: null,
    title: "Deck rebuild",
    description: null,
    contactName: "Jordan Lee",
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Quoted,
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

function renderDrawer(canManage = true) {
  const leadAccess = {
    canView: true,
    canEdit: canManage,
    canAssign: canManage,
    canUnassign: canManage,
    canConvert: canManage,
  };
  return render(
    <>
      <button type="button" data-testid="origin-control">
        Origin card
      </button>
      <PipelineMobileDetailDrawer
        opportunity={makeOpportunity()}
        leadAccess={leadAccess}
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

describe("<PipelineMobileDetailDrawer>", () => {
  let historyBack: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.replaceState({}, "", "/pipeline");
    mockRouterReplace.mockReset();
    mockRouterReplace.mockImplementation((href: string) => {
      window.history.replaceState({}, "", href);
    });
    historyBack = vi.spyOn(window.history, "back").mockImplementation(() => {});
    usePipelineModeStore.setState({
      mode: "focused",
      focusedStage: OpportunityStage.Quoted,
      detailPanelOpportunityId: "opp-1",
      detailPanelActiveTab: "overview",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

  afterEach(() => {
    historyBack.mockRestore();
  });

  it("renders a full-screen modal drawer hosting the shared detail body", async () => {
    renderDrawer();

    const drawer = await screen.findByTestId("pipeline-mobile-detail-drawer");
    expect(drawer).toHaveAttribute("role", "dialog");
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toHaveClass("fixed", "inset-0", "z-modal", "glass-dense");
    // Display name in the header (contact name — no client on this lead).
    expect(drawer).toHaveTextContent("Jordan Lee");
    // The one shared body, not a fork.
    expect(screen.getByTestId("mock-band")).toBeInTheDocument();
    expect(screen.getByTestId("mock-overview")).toBeInTheDocument();
    // Actions menu present for a managing operator.
    expect(
      screen.getByRole("button", { name: "Stage actions" })
    ).toBeInTheDocument();
  });

  it("hides the action menu when the operator can neither edit nor convert", async () => {
    renderDrawer(false);

    await screen.findByTestId("pipeline-mobile-detail-drawer");
    expect(
      screen.queryByRole("button", { name: "Stage actions" })
    ).not.toBeInTheDocument();
  });

  it("closes via the back button and restores focus to the opener", async () => {
    const origin = document.createElement("button");
    document.body.appendChild(origin);
    origin.focus();

    const { container } = renderDrawer();
    await screen.findByTestId("pipeline-mobile-detail-drawer");
    await waitFor(() => expect(container).toHaveAttribute("inert"));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
    expect(container).not.toHaveAttribute("inert");
    expect(container).not.toHaveAttribute("aria-hidden");
    await waitFor(() => expect(document.activeElement).toBe(origin));
    origin.remove();
  });

  it("closes on Escape", async () => {
    renderDrawer();
    await screen.findByTestId("pipeline-mobile-detail-drawer");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });

  it("closes the nested action menu before closing the drawer", async () => {
    renderDrawer();
    await screen.findByTestId("pipeline-mobile-detail-drawer");

    fireEvent.click(screen.getByRole("button", { name: "Stage actions" }));
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByRole("button", { name: "Archive" })
    ).not.toBeInTheDocument();
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
      "opp-1"
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });

  it("inerts the pipeline underlay and traps Tab inside the drawer", async () => {
    const { container } = renderDrawer();
    const drawer = await screen.findByTestId("pipeline-mobile-detail-drawer");

    await waitFor(() => expect(container).toHaveAttribute("inert"));
    expect(container).toHaveAttribute("aria-hidden", "true");

    const focusable = Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hasAttribute("disabled"));
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    screen.getByTestId("origin-control").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("spares Escape for a nested full-screen modal", async () => {
    renderDrawer();
    await screen.findByTestId("pipeline-mobile-detail-drawer");

    const nested = document.createElement("div");
    nested.setAttribute("data-pipeline-detail-modal", "");
    const nestedControl = document.createElement("button");
    nested.appendChild(nestedControl);
    document.body.appendChild(nested);
    nestedControl.focus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(nestedControl);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
      "opp-1"
    );
    nested.remove();
  });

  it("closes when the history sentinel pops (hardware back)", async () => {
    renderDrawer();
    await screen.findByTestId("pipeline-mobile-detail-drawer");

    fireEvent.popState(window);

    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });

  it("consumes the history sentinel when an external revocation closes the drawer", async () => {
    renderDrawer();
    await screen.findByTestId("pipeline-mobile-detail-drawer");

    act(() => usePipelineModeStore.getState().closeDetailPanel());

    expect(historyBack).toHaveBeenCalledTimes(1);
  });

  it("replaces its transient history entry when an internal link navigates", async () => {
    renderDrawer();
    const drawer = await screen.findByTestId("pipeline-mobile-detail-drawer");
    const internalLink = document.createElement("a");
    internalLink.href = "/clients/client-1";
    internalLink.textContent = "Open client";
    drawer.appendChild(internalLink);

    fireEvent.click(internalLink);

    expect(mockRouterReplace).toHaveBeenCalledWith("/clients/client-1");
    expect(window.location.pathname).toBe("/clients/client-1");
    expect(window.history.state).not.toHaveProperty("ops-lead-drawer");
    expect(historyBack).not.toHaveBeenCalled();
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });
});
