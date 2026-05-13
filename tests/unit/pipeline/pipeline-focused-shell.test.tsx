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
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { PipelineFocusedShell } from "@/app/(dashboard)/pipeline/_components/pipeline-focused-shell";

const mockDndState = vi.hoisted(() => ({ isDragging: false }));

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
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@/app/(dashboard)/pipeline/_components/pipeline-dnd-provider", () => ({
  usePipelineDndState: () => ({ isDragging: mockDndState.isDragging }),
}));

vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-focused-column",
  () => ({
    PipelineFocusedColumn: ({
      stage,
      focusedPanelId,
      focusedTabId,
    }: {
      stage: OpportunityStage;
      focusedPanelId: string;
      focusedTabId: string;
    }) => (
      <section
        id={focusedPanelId}
        role="tabpanel"
        aria-labelledby={focusedTabId}
        data-testid="focused-column"
        data-stage={stage}
      />
    ),
  })
);

vi.mock("@/app/(dashboard)/pipeline/_components/pipeline-detail-panel", () => ({
  PipelineDetailPanel: () => (
    <aside data-keyboard-scope="modal-or-menu" data-testid="detail-panel" />
  ),
}));

vi.mock("@/app/(dashboard)/pipeline/_components/pipeline-spine-column", () => ({
  PipelineSpineColumn: ({
    stage,
    tabId,
    panelId,
    tabRef,
    onFocusStage,
  }: {
    stage: OpportunityStage;
    tabId: string;
    panelId: string;
    tabRef?: (node: HTMLButtonElement | null) => void;
    onFocusStage?: (stage: OpportunityStage) => void;
  }) => (
    <button
      ref={tabRef}
      type="button"
      role="tab"
      id={tabId}
      aria-selected={false}
      aria-controls={panelId}
      tabIndex={-1}
      data-testid={`spine-${stage}`}
      onClick={() => onFocusStage?.(stage)}
    />
  ),
}));

vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-terminal-stack",
  () => ({
    PipelineTerminalStack: ({
      focusedStage,
      panelId,
      registerTab,
      onSelectStage,
    }: {
      focusedStage: OpportunityStage;
      panelId: string;
      registerTab?: (
        stage: OpportunityStage
      ) => (node: HTMLElement | null) => void;
      onSelectStage: (
        stage: OpportunityStage.Won | OpportunityStage.Lost
      ) => void;
    }) => (
      <div role="presentation" data-testid="terminal-stack">
        {[OpportunityStage.Won, OpportunityStage.Lost].map((stage) => (
          <button
            key={stage}
            ref={registerTab?.(stage)}
            type="button"
            role="tab"
            id={`pipeline-terminal-tab-${stage}`}
            aria-selected={focusedStage === stage}
            aria-controls={panelId}
            tabIndex={focusedStage === stage ? 0 : -1}
            onClick={() =>
              onSelectStage(
                stage as OpportunityStage.Won | OpportunityStage.Lost
              )
            }
          />
        ))}
      </div>
    ),
  })
);

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
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    archivedAt: null,
  };
}

function renderFocusedShell(opportunities: Opportunity[]) {
  return render(
    <PipelineFocusedShell
      opportunities={opportunities}
      clientNameMap={new Map()}
      canManage={true}
      filtersActive={false}
      dragAnnouncement=""
      onAddLead={vi.fn()}
      onClearFilters={vi.fn()}
      onLogCall={vi.fn()}
      onLogText={vi.fn()}
      onAddNote={vi.fn()}
      onArchive={vi.fn()}
      onDiscard={vi.fn()}
      onMarkWon={vi.fn()}
      onMarkLost={vi.fn()}
      onAdvanceStage={vi.fn()}
      onAssign={vi.fn()}
      onScheduleFollowUp={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

function getShellElement(container: HTMLElement): HTMLElement {
  const shell = container.firstElementChild;
  if (!(shell instanceof HTMLElement)) {
    throw new Error("Expected focused shell root element");
  }

  return shell;
}

describe("<PipelineFocusedShell>", () => {
  beforeEach(() => {
    localStorage.clear();
    mockDndState.isDragging = false;
    usePipelineModeStore.setState({
      mode: "focused",
      focusedStage: OpportunityStage.NewLead,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

  it("renders a valid focused tablist with the focused panel as a sibling", () => {
    renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
      makeOpportunity("opp-3", OpportunityStage.Won),
    ]);

    const tablist = screen.getByRole("tablist", {
      name: "Pipeline stages",
    });
    const tabs = within(tablist).getAllByRole("tab");
    const selectedTab = within(tablist).getByRole("tab", { selected: true });
    const panel = screen.getByRole("tabpanel");

    expect(tabs.length).toBeGreaterThan(1);
    expect(selectedTab).toHaveAttribute("id", "pipeline-focused-tab-new_lead");
    expect(selectedTab).toHaveAttribute(
      "aria-controls",
      "pipeline-focused-panel"
    );
    expect(selectedTab).toHaveAttribute("tabindex", "0");
    expect(panel).toHaveAttribute("id", "pipeline-focused-panel");
    expect(panel).toHaveAttribute(
      "aria-labelledby",
      "pipeline-focused-tab-new_lead"
    );
    expect(within(tablist).queryByRole("tabpanel")).not.toBeInTheDocument();
  });

  it.each([OpportunityStage.Won, OpportunityStage.Lost])(
    "uses the %s terminal tab as the only selected roving tab",
    (stage) => {
      usePipelineModeStore.setState({
        focusedStage: stage,
      });

      renderFocusedShell([
        makeOpportunity("opp-won", OpportunityStage.Won),
        makeOpportunity("opp-lost", OpportunityStage.Lost),
      ]);

      const tablist = screen.getByRole("tablist", {
        name: "Pipeline stages",
      });
      const tabs = within(tablist).getAllByRole("tab");
      const selectedTabs = tabs.filter(
        (tab) => tab.getAttribute("aria-selected") === "true"
      );
      const rovingTabs = tabs.filter(
        (tab) => tab.getAttribute("tabindex") === "0"
      );
      const [selectedTab] = selectedTabs;
      const [rovingTab] = rovingTabs;
      const panel = screen.getByRole("tabpanel");

      expect(selectedTabs).toHaveLength(1);
      expect(rovingTabs).toHaveLength(1);
      expect(selectedTab).toBe(rovingTab);
      expect(selectedTab).toHaveAttribute(
        "id",
        `pipeline-terminal-tab-${stage}`
      );
      expect(selectedTab).toHaveAttribute(
        "aria-controls",
        "pipeline-focused-panel"
      );
      expect(panel).toHaveAttribute(
        "aria-labelledby",
        `pipeline-terminal-tab-${stage}`
      );
      expect(
        tablist.querySelector(`#pipeline-focused-tab-${stage}`)
      ).not.toBeInTheDocument();
    }
  );

  it("focuses the newly active tab after arrow stage navigation", async () => {
    renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
    ]);

    fireEvent.keyDown(window, { key: "ArrowRight" });

    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute(
        "id",
        "pipeline-focused-tab-qualifying"
      );
    });
  });

  it("moves linearly through active stages and terminal stages with left and right arrows", () => {
    renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Negotiation),
      makeOpportunity("opp-3", OpportunityStage.Won),
      makeOpportunity("opp-4", OpportunityStage.Lost),
    ]);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Qualifying
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Quoting
    );

    act(() => {
      usePipelineModeStore
        .getState()
        .setFocusedStage(OpportunityStage.Negotiation);
    });

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Won
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Lost
    );

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Won
    );
  });

  it("uses up and down only to move inside the Won/Lost terminal stack", () => {
    renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Won),
      makeOpportunity("opp-3", OpportunityStage.Lost),
    ]);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.NewLead
    );

    act(() => {
      usePipelineModeStore.getState().setFocusedStage(OpportunityStage.Won);
    });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Lost
    );

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Won
    );
  });

  it("does not handle modified arrow keys", () => {
    renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
    ]);

    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", isComposing: true });

    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.NewLead
    );
  });

  it("toggles mode with V and closes the detail panel with Escape", () => {
    usePipelineModeStore.setState({
      detailPanelOpportunityId: "opp-1",
    });

    renderFocusedShell([makeOpportunity("opp-1", OpportunityStage.NewLead)]);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();

    fireEvent.keyDown(window, { key: "v" });
    expect(usePipelineModeStore.getState().mode).toBe("spatial");
  });

  it("snaps focusedStage to the loaded detail opportunity stage", async () => {
    usePipelineModeStore.setState({
      detailPanelOpportunityId: "opp-quoted",
    });

    renderFocusedShell([
      makeOpportunity("opp-quoted", OpportunityStage.Quoted),
    ]);

    await waitFor(() => {
      expect(usePipelineModeStore.getState().focusedStage).toBe(
        OpportunityStage.Quoted
      );
    });
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
      "opp-quoted"
    );
  });

  it("closes an aligned detail panel when focusedStage changes afterward", async () => {
    usePipelineModeStore.setState({
      focusedStage: OpportunityStage.Quoted,
      detailPanelOpportunityId: "opp-quoted",
    });

    renderFocusedShell([
      makeOpportunity("opp-quoted", OpportunityStage.Quoted),
      makeOpportunity("opp-follow-up", OpportunityStage.FollowUp),
    ]);

    await waitFor(() => {
      expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
        "opp-quoted"
      );
    });

    act(() => {
      usePipelineModeStore
        .getState()
        .setFocusedStage(OpportunityStage.FollowUp);
    });

    await waitFor(() => {
      expect(
        usePipelineModeStore.getState().detailPanelOpportunityId
      ).toBeNull();
    });
  });

  it("does not handle stage arrow keys from modal-or-menu scopes", () => {
    renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
    ]);

    const scopedTarget = document.createElement("div");
    scopedTarget.setAttribute("data-keyboard-scope", "modal-or-menu");
    document.body.appendChild(scopedTarget);

    fireEvent.keyDown(scopedTarget, { key: "ArrowRight" });

    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.NewLead
    );
    scopedTarget.remove();
  });

  it("does not handle shortcuts from typing or contenteditable targets", () => {
    renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
    ]);

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });

    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.NewLead
    );

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "");
    document.body.appendChild(editable);
    fireEvent.keyDown(editable, { key: "v" });

    expect(usePipelineModeStore.getState().mode).toBe("focused");

    input.remove();
    editable.remove();
  });

  it("suppresses keyboard navigation and mode switching while dragging", () => {
    mockDndState.isDragging = true;
    usePipelineModeStore.setState({
      detailPanelOpportunityId: "opp-1",
    });

    renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
    ]);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "v" });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.NewLead
    );
    expect(usePipelineModeStore.getState().mode).toBe("focused");
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
      "opp-1"
    );
  });

  it("uses horizontal wheel intent to advance focused stages", () => {
    const { container } = renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
    ]);

    fireEvent.wheel(getShellElement(container), { deltaX: 80, deltaY: 8 });

    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Qualifying
    );
  });

  it("lets vertical wheel intent scroll the focused card list", () => {
    const { container } = renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
    ]);

    fireEvent.wheel(getShellElement(container), { deltaX: 3, deltaY: 80 });

    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.NewLead
    );
  });

  it("uses Shift+wheel as a mouse fallback for stage navigation", () => {
    const { container } = renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
    ]);

    fireEvent.wheel(getShellElement(container), {
      deltaX: 0,
      deltaY: 80,
      shiftKey: true,
    });

    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Qualifying
    );
  });

  it("debounces wheel stage commits by 150ms", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);
    const { container } = renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
      makeOpportunity("opp-3", OpportunityStage.Quoting),
    ]);
    const shell = getShellElement(container);

    fireEvent.wheel(shell, { deltaX: 80, deltaY: 4 });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Qualifying
    );

    nowSpy.mockReturnValue(1149);
    fireEvent.wheel(shell, { deltaX: 80, deltaY: 4 });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Qualifying
    );

    nowSpy.mockReturnValue(1150);
    fireEvent.wheel(shell, { deltaX: 80, deltaY: 4 });
    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.Quoting
    );

    nowSpy.mockRestore();
  });

  it("suppresses wheel stage navigation while dragging", () => {
    mockDndState.isDragging = true;
    const { container } = renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
      makeOpportunity("opp-2", OpportunityStage.Qualifying),
    ]);

    fireEvent.wheel(getShellElement(container), { deltaX: 80, deltaY: 4 });

    expect(usePipelineModeStore.getState().focusedStage).toBe(
      OpportunityStage.NewLead
    );
  });

  it("switches to spatial mode when focused pinch-out crosses the virtual zoom threshold", () => {
    const { container } = renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
    ]);

    fireEvent.wheel(getShellElement(container), {
      ctrlKey: true,
      deltaY: 81,
    });

    expect(usePipelineModeStore.getState().mode).toBe("spatial");
  });

  it("does not consume focused ctrl+wheel pinch-in gestures", () => {
    const { container } = renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
    ]);
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -80,
    });

    getShellElement(container).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(usePipelineModeStore.getState().mode).toBe("focused");
  });

  it("ignores focused pinch mode switching while dragging", () => {
    mockDndState.isDragging = true;
    const { container } = renderFocusedShell([
      makeOpportunity("opp-1", OpportunityStage.NewLead),
    ]);

    fireEvent.wheel(getShellElement(container), {
      ctrlKey: true,
      deltaY: 100,
    });

    expect(usePipelineModeStore.getState().mode).toBe("focused");
  });

  it("renders focused DnD announcements in a polite live region", () => {
    render(
      <PipelineFocusedShell
        opportunities={[makeOpportunity("opp-1", OpportunityStage.NewLead)]}
        clientNameMap={new Map()}
        canManage={true}
        filtersActive={false}
        dragAnnouncement="Drag: Quoted stage. Press Space to drop."
        onAddLead={vi.fn()}
        onClearFilters={vi.fn()}
        onLogCall={vi.fn()}
        onLogText={vi.fn()}
        onAddNote={vi.fn()}
        onArchive={vi.fn()}
        onDiscard={vi.fn()}
        onMarkWon={vi.fn()}
        onMarkLost={vi.fn()}
        onAdvanceStage={vi.fn()}
        onAssign={vi.fn()}
        onScheduleFollowUp={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const liveRegion = document.querySelector("[role='status']");

    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveAttribute("aria-atomic", "true");
    expect(liveRegion).toHaveTextContent(
      "Drag: Quoted stage. Press Space to drop."
    );
  });
});
