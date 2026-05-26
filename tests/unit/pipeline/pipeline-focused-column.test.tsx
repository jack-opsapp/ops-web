import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { type Opportunity, OpportunityStage } from "@/lib/types/pipeline";
import { PipelineFocusedColumn } from "@/app/(dashboard)/pipeline/_components/pipeline-focused-column";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        "focused.error.title": "// PIPELINE UNREACHABLE",
        "focused.error.action": "[RETRY]",
        "focused.empty.title": "// NO LEADS",
        "focused.empty.action": "[+ ADD LEAD]",
        "focused.filteredEmpty.title": "// NO MATCHES FOR FILTERS",
        "focused.filteredEmpty.action": "[CLEAR FILTERS]",
        "focused.listSummary.text":
          "{count} {cardLabel} IN {stage} STAGE, OLDEST {oldest}",
        "focused.listSummary.cardSingular": "CARD",
        "focused.listSummary.cardPlural": "CARDS",
        "focused.listSummary.ageDays": "{count}D",
        "focused.listSummary.oldestEmpty": "—",
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

const NOW = new Date("2026-05-12T12:00:00.000Z");

function makeOpportunity(
  id: string,
  overrides: Partial<Opportunity> = {}
): Opportunity {
  return {
    id,
    companyId: "company-1",
    clientId: null,
    title: `Lead ${id}`,
    description: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.NewLead,
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
    ...overrides,
  };
}

function renderColumn(
  overrides: Partial<ComponentProps<typeof PipelineFocusedColumn>> = {}
) {
  return render(
    <PipelineFocusedColumn
      stage={OpportunityStage.NewLead}
      opportunities={[]}
      clientNameMap={new Map()}
      canManage={true}
      filtersActive={false}
      focusedTabId="pipeline-focused-tab-new_lead"
      focusedPanelId="pipeline-focused-panel"
      onAddLead={vi.fn()}
      onClearFilters={vi.fn()}
      onLogCall={vi.fn()}
      onLogText={vi.fn()}
      onAddNote={vi.fn()}
      onArchive={vi.fn()}
      onDiscard={vi.fn()}
      onMarkWon={vi.fn()}
      onMarkLost={vi.fn()}
      onMoveStage={vi.fn()}
      onAssign={vi.fn()}
      onScheduleFollowUp={vi.fn()}
      {...overrides}
    />
  );
}

describe("<PipelineFocusedColumn>", () => {
  it("renders loading ghost cards inside the focused tabpanel", () => {
    renderColumn({ isLoading: true });

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "pipeline-focused-panel");
    expect(panel).toHaveAttribute(
      "aria-labelledby",
      "pipeline-focused-tab-new_lead"
    );
    expect(panel).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("pipeline-focused-loading-card")).toHaveLength(
      3
    );
  });

  it("renders a dictionary-backed error state and retries on command", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    renderColumn({ isError: true, onRetry });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "// PIPELINE UNREACHABLE"
    );
    await user.click(screen.getByRole("button", { name: "[RETRY]" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders cards only after loading and error clear", () => {
    renderColumn({ opportunities: [makeOpportunity("opp-1")] });

    expect(screen.getByTestId("focused-card")).toHaveTextContent("Lead opp-1");
    expect(
      screen.queryByTestId("pipeline-focused-loading-card")
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the end-of-list summary with two-card scroll runway", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));

    try {
      renderColumn({
        opportunities: [
          makeOpportunity("opp-1", {
            stageEnteredAt: new Date("2026-05-13T12:00:00.000Z"),
          }),
          makeOpportunity("opp-2", {
            stageEnteredAt: new Date("2026-05-10T12:00:00.000Z"),
          }),
        ],
      });

      expect(screen.getByRole("tabpanel").className).toContain(
        "scroll-pb-[360px]"
      );
      expect(screen.getByTestId("pipeline-focused-list-summary")).toHaveTextContent(
        "2 CARDS IN NEW LEAD STAGE, OLDEST 4D"
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
