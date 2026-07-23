import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineCard } from "@/app/(dashboard)/pipeline/_components/pipeline-card";
import type {
  PipelineTableColumnLayout,
  PipelineTableMetrics,
} from "@/app/(dashboard)/pipeline/_components/table/pipeline-table";
import { PipelineTableRow } from "@/app/(dashboard)/pipeline/_components/table/pipeline-table-row";
import {
  OpportunityStage,
  PIPELINE_STAGES_DEFAULT,
  type Opportunity,
} from "@/lib/types/pipeline";
import {
  PIPELINE_TABLE_COLUMNS,
  type PipelineTableRow as PipelineTableRowModel,
} from "@/lib/types/pipeline-table";

const opportunityService = vi.hoisted(() => ({
  markHandled: vi.fn(),
}));

vi.mock("@/lib/api/services/opportunity-service", () => ({
  OpportunityService: opportunityService,
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
  useLocale: () => ({ locale: "en" }),
}));

vi.mock("framer-motion", async () => {
  const actual =
    await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, useReducedMotion: () => true };
});

const INBOUND_AT = new Date("2026-07-19T11:00:00.000Z");
const HANDLED_AT = new Date("2026-07-19T12:00:00.000Z");
const NEXT_FOLLOW_UP_AT = new Date("2026-07-20T12:00:00.000Z");

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    companyId: "company-1",
    clientId: null,
    title: "Deck rebuild",
    description: null,
    contactName: "Dana Reyes",
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Qualifying,
    source: null,
    assignedTo: null,
    assignmentVersion: 0,
    priority: null,
    estimatedValue: 12_500,
    actualValue: null,
    winProbability: 0,
    expectedCloseDate: null,
    actualCloseDate: null,
    stageEnteredAt: INBOUND_AT,
    projectId: null,
    lostReason: null,
    lostNotes: null,
    quoteDeliveryMethod: null,
    address: null,
    latitude: null,
    longitude: null,
    sourceEmailId: null,
    correspondenceCount: 1,
    outboundCount: 0,
    inboundCount: 1,
    lastInboundAt: INBOUND_AT,
    lastOutboundAt: null,
    lastMessageDirection: "in",
    handledAt: null,
    operatorActionRequiredAt: null,
    aiSummary: null,
    aiSummaryUpdatedAt: null,
    aiStageConfidence: null,
    aiStageSignals: null,
    detectedValue: null,
    lastActivityAt: INBOUND_AT,
    nextFollowUpAt: NEXT_FOLLOW_UP_AT,
    tags: [],
    images: [],
    createdAt: INBOUND_AT,
    updatedAt: INBOUND_AT,
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function makeTableRow(
  overrides: Partial<PipelineTableRowModel> & {
    lastInboundAt?: string | null;
    lastMessageDirection?: "in" | "out" | null;
    handledAt?: string | null;
  } = {}
): PipelineTableRowModel {
  return {
    id: "opp-1",
    companyId: "company-1",
    title: "Deck rebuild",
    stage: OpportunityStage.Qualifying,
    clientId: null,
    clientName: "Dana Reyes",
    estimatedValue: 12_500,
    winProbability: null,
    weightedValue: null,
    ageInStageDays: 2,
    lastActivityAt: INBOUND_AT.toISOString(),
    nextFollowUpAt: NEXT_FOLLOW_UP_AT.toISOString(),
    expectedCloseDate: null,
    assignedTo: null,
    assignmentVersion: 0,
    assigneeName: null,
    source: null,
    priority: null,
    correspondenceCount: 1,
    stageEnteredAt: INBOUND_AT.toISOString(),
    projectId: null,
    updatedAt: INBOUND_AT.toISOString(),
    staleThresholdDays: null,
    winProbabilityIsFallback: false,
    lastInboundAt: INBOUND_AT.toISOString(),
    lastOutboundAt: null,
    lastMessageDirection: "in",
    handledAt: null,
    operatorActionRequiredAt: null,
    ...overrides,
  } as PipelineTableRowModel;
}

function wrapper(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderMobileCard({
  opportunity = makeOpportunity(),
  canManage = true,
  onToggleExpand = vi.fn(),
}: {
  opportunity?: Opportunity;
  canManage?: boolean;
  onToggleExpand?: () => void;
} = {}) {
  const stageConfig = PIPELINE_STAGES_DEFAULT.find(
    (stage) => stage.slug === opportunity.stage
  );
  if (!stageConfig) throw new Error("Missing stage fixture");

  return render(
    wrapper(
      <PipelineCard
        opportunity={opportunity}
        clientName="Dana Reyes"
        isExpanded={false}
        onToggleExpand={onToggleExpand}
        onAdvance={vi.fn()}
        onRetreat={vi.fn()}
        onLogCall={vi.fn()}
        onLogText={vi.fn()}
        onAddNote={vi.fn()}
        onArchive={vi.fn()}
        onDiscard={vi.fn()}
        onMarkWon={vi.fn()}
        onMarkLost={vi.fn()}
        onOpenDetail={vi.fn()}
        onAssign={vi.fn()}
        onScheduleFollowUp={vi.fn()}
        canManage={canManage}
        canAssign={canManage}
        canConvert={canManage}
        stageConfig={stageConfig}
      />
    )
  );
}

const TABLE_METRICS: PipelineTableMetrics = {
  zoom: 1,
  density: "compact",
  rowHeight: 36,
  headerHeight: 36,
  fontSize: 13,
  microFontSize: 11,
  avatarSize: 20,
  columnScale: 1,
};

const DEAL_COLUMN = PIPELINE_TABLE_COLUMNS.find(
  (candidate) => candidate.id === "deal"
);
if (!DEAL_COLUMN) throw new Error("Missing deal column fixture");

const TABLE_COLUMNS: PipelineTableColumnLayout[] = [
  { column: DEAL_COLUMN, width: 260, stickyLeft: null },
];

function renderTableRow({
  row = makeTableRow(),
  canEdit = true,
  onOpenDeal = vi.fn(),
}: {
  row?: PipelineTableRowModel;
  canEdit?: boolean;
  onOpenDeal?: (id: string) => void;
} = {}) {
  return render(
    wrapper(
      <div role="grid">
        <PipelineTableRow
          row={row}
          columns={TABLE_COLUMNS}
          metrics={TABLE_METRICS}
          selected={false}
          virtualStart={0}
          totalWidth={260}
          now={INBOUND_AT}
          saveStates={new Map()}
          activeCell={null}
          editingCell={null}
          canManage={canEdit}
          leadAccess={{
            canView: true,
            canEdit,
            canAssign: canEdit,
            canUnassign: canEdit,
            canConvert: canEdit,
          }}
          setActiveCell={vi.fn()}
          onToggleRow={vi.fn()}
          onOpenDeal={onOpenDeal}
          onBeginEdit={vi.fn()}
          onCancelEdit={vi.fn()}
          onCellKeyDown={vi.fn()}
          onCommitCell={vi.fn()}
          onRequestStageChange={vi.fn()}
          onRequestConvertAlreadyWon={vi.fn()}
        />
      </div>
    )
  );
}

beforeEach(() => {
  opportunityService.markHandled.mockReset();
});

describe("pipeline chase-state surface parity", () => {
  it("propagates a manual YOUR MOVE correction through mobile and table rows", () => {
    const { unmount } = renderMobileCard({
      opportunity: makeOpportunity({
        lastInboundAt: null,
        lastOutboundAt: HANDLED_AT,
        lastMessageDirection: "out",
        handledAt: HANDLED_AT,
        operatorActionRequiredAt: NEXT_FOLLOW_UP_AT,
      }),
      canManage: false,
    });

    expect(screen.getByText("YOUR MOVE")).toBeInTheDocument();
    unmount();

    renderTableRow({
      row: makeTableRow({
        lastInboundAt: null,
        lastOutboundAt: HANDLED_AT.toISOString(),
        lastMessageDirection: "out",
        handledAt: HANDLED_AT.toISOString(),
        operatorActionRequiredAt: NEXT_FOLLOW_UP_AT.toISOString(),
      }),
      canEdit: false,
    });

    expect(screen.getByText("YOUR MOVE")).toBeInTheDocument();
  });

  it("renders YOUR MOVE on the mobile card and uses the atomic HANDLED mutation", async () => {
    const onToggleExpand = vi.fn();
    opportunityService.markHandled.mockResolvedValue(
      makeOpportunity({ handledAt: HANDLED_AT })
    );

    renderMobileCard({ onToggleExpand });

    expect(screen.getByText("YOUR MOVE")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark handled" }));

    await waitFor(() =>
      expect(opportunityService.markHandled).toHaveBeenCalledWith(
        "opp-1",
        NEXT_FOLLOW_UP_AT
      )
    );
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("keeps mobile chase state visible but HANDLED permission-aware", () => {
    const { rerender } = renderMobileCard({ canManage: false });

    expect(screen.getByText("YOUR MOVE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark handled" })).toBeNull();

    rerender(
      wrapper(
        <PipelineCard
          opportunity={makeOpportunity({ handledAt: HANDLED_AT })}
          clientName="Dana Reyes"
          isExpanded={false}
          onToggleExpand={vi.fn()}
          onAdvance={vi.fn()}
          onRetreat={vi.fn()}
          onLogCall={vi.fn()}
          onLogText={vi.fn()}
          onAddNote={vi.fn()}
          onArchive={vi.fn()}
          onDiscard={vi.fn()}
          onMarkWon={vi.fn()}
          onMarkLost={vi.fn()}
          onOpenDetail={vi.fn()}
          onAssign={vi.fn()}
          onScheduleFollowUp={vi.fn()}
          canManage={false}
          canAssign={false}
          canConvert={false}
          stageConfig={
            PIPELINE_STAGES_DEFAULT.find(
              (stage) => stage.slug === OpportunityStage.Qualifying
            )!
          }
        />
      )
    );

    expect(screen.getByText("WAITING")).toBeInTheDocument();
    expect(screen.queryByText("YOUR MOVE")).toBeNull();
  });

  it("renders the exact shared state compactly in a table scan row", () => {
    renderTableRow({ canEdit: false });

    expect(screen.getByText("YOUR MOVE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark handled" })).toBeNull();
    expect(
      document.querySelector('[data-lead-chase-density="compact"]')
    ).toBeInTheDocument();
  });

  it("keeps table HANDLED permission-aware and on the same atomic mutation", async () => {
    opportunityService.markHandled.mockResolvedValue(
      makeOpportunity({ handledAt: HANDLED_AT })
    );
    const onOpenDeal = vi.fn();
    const { rerender } = renderTableRow({ canEdit: true, onOpenDeal });

    fireEvent.click(screen.getByRole("button", { name: "Mark handled" }));

    await waitFor(() =>
      expect(opportunityService.markHandled).toHaveBeenCalledWith(
        "opp-1",
        NEXT_FOLLOW_UP_AT
      )
    );
    expect(onOpenDeal).not.toHaveBeenCalled();

    rerender(
      wrapper(
        <div role="grid">
          <PipelineTableRow
            row={makeTableRow({ handledAt: HANDLED_AT.toISOString() })}
            columns={TABLE_COLUMNS}
            metrics={TABLE_METRICS}
            selected={false}
            virtualStart={0}
            totalWidth={260}
            now={INBOUND_AT}
            saveStates={new Map()}
            activeCell={null}
            editingCell={null}
            canManage
            leadAccess={{
              canView: true,
              canEdit: true,
              canAssign: true,
              canUnassign: true,
              canConvert: true,
            }}
            setActiveCell={vi.fn()}
            onToggleRow={vi.fn()}
            onOpenDeal={vi.fn()}
            onBeginEdit={vi.fn()}
            onCancelEdit={vi.fn()}
            onCellKeyDown={vi.fn()}
            onCommitCell={vi.fn()}
            onRequestStageChange={vi.fn()}
            onRequestConvertAlreadyWon={vi.fn()}
          />
        </div>
      )
    );

    expect(screen.getByText("WAITING")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark handled" })).toBeNull();
  });
});
