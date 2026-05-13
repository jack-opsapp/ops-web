import React, { useRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Opportunity,
  OpportunityStage,
} from "@/lib/types/pipeline";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { PipelineDetailPanel } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-panel";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
    t: (key: string, fallback?: string) => fallback ?? key,
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
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-tab-bar",
  () => ({
    PipelineDetailTabBar: () => null,
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

function Harness() {
  const scopeRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={scopeRef} data-testid="pipeline-scope">
      <PipelineDetailPanel
        opportunity={makeOpportunity()}
        canManage={false}
        originatingOpportunityId="opp-1"
        scopeRef={scopeRef}
        onAdvanceStage={vi.fn()}
        onMarkWon={vi.fn()}
        onMarkLost={vi.fn()}
        onArchive={vi.fn()}
        onDiscard={vi.fn()}
        onDelete={vi.fn()}
      />
    </div>
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

  it("moves focus inside the compact drawer after the portal mounts", async () => {
    render(<Harness />);

    const panel = await screen.findByRole("region", {
      name: "Deal detail panel",
    });

    await waitFor(() => {
      expect(panel).toContainElement(document.activeElement as HTMLElement);
    });
  });
});
