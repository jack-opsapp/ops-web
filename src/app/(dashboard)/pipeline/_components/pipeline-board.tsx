"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragCancelEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  type Opportunity,
  OpportunityStage,
  PIPELINE_STAGES_DEFAULT,
  getActiveStages,
  nextOpportunityStage,
  previousOpportunityStage,
} from "@/lib/types/pipeline";
import { PipelineColumn } from "./pipeline-column";
import { PipelineCollapsedColumn } from "./pipeline-collapsed-column";
import { PipelineCard } from "./pipeline-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PipelineBoardProps {
  opportunities: Opportunity[];
  clients: Map<string, string>;
  expandedCardId: string | null;
  onToggleExpand: (id: string) => void;
  onMoveStage: (opportunityId: string, newStage: OpportunityStage) => void;
  onLogCall: (opportunityId: string) => void;
  onLogText: (opportunityId: string) => void;
  onAddNote: (opportunityId: string, note: string) => void;
  onArchive: (opportunityId: string) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onOpenDetail: (opportunity: Opportunity) => void;
  onAssign: (opportunityId: string) => void;
  onScheduleFollowUp: (opportunityId: string) => void;
  onAddLead: () => void;
  canManage: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACTIVE_STAGES = getActiveStages();

/** Minimum width (px) for a visible column before it should collapse */
const MIN_COL_WIDTH = 180;
/** Width (px) of a collapsed column bar */
const COLLAPSED_WIDTH = 40;
/** Gap between columns (matches gap-[8px]) */
const GAP = 8;

// ---------------------------------------------------------------------------
// PipelineBoard
// ---------------------------------------------------------------------------
export function PipelineBoard({
  opportunities,
  clients,
  expandedCardId,
  onToggleExpand,
  onMoveStage,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onMarkWon,
  onMarkLost,
  onOpenDetail,
  onAssign,
  onScheduleFollowUp,
  onAddLead,
  canManage,
}: PipelineBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // -- Container measurement via ResizeObserver -----------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // -- Stage order (for swap-on-click) --------------------------------------
  const [stageOrder, setStageOrder] = useState<OpportunityStage[]>(ACTIVE_STAGES);
  const stageCount = ACTIVE_STAGES.length;

  // -- Calculate how many columns can be visible ----------------------------
  const maxVisible = useMemo(() => {
    if (containerWidth === 0) return stageCount; // initial render — show all
    const totalGaps = (stageCount - 1) * GAP;
    const availableForCols = containerWidth - totalGaps;
    // Solve: visibleN * MIN_COL_WIDTH + (stageCount - visibleN) * COLLAPSED_WIDTH <= availableForCols
    const max = Math.floor(
      (availableForCols - stageCount * COLLAPSED_WIDTH) /
        (MIN_COL_WIDTH - COLLAPSED_WIDTH)
    );
    return Math.max(2, Math.min(stageCount, max));
  }, [containerWidth, stageCount]);

  const visibleStages = stageOrder.slice(0, maxVisible);
  const collapsedStages = stageOrder.slice(maxVisible);

  // -- Sensors --------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // -- Group opportunities by stage (active only) ---------------------------
  const opportunitiesByStage = useMemo(() => {
    const map = new Map<OpportunityStage, Opportunity[]>();
    for (const stage of ACTIVE_STAGES) {
      map.set(stage, []);
    }
    for (const opp of opportunities) {
      const list = map.get(opp.stage);
      if (list) list.push(opp);
    }
    return map;
  }, [opportunities]);

  // -- Max count across all active stages (for proportional fill) -----------
  const maxStageCount = useMemo(() => {
    let max = 0;
    for (const stage of ACTIVE_STAGES) {
      const count = (opportunitiesByStage.get(stage) ?? []).length;
      if (count > max) max = count;
    }
    return Math.max(1, max);
  }, [opportunitiesByStage]);

  // -- Active drag opportunity ----------------------------------------------
  const activeOpportunity = useMemo(
    () =>
      activeId ? opportunities.find((o) => o.id === activeId) ?? null : null,
    [activeId, opportunities]
  );

  // -- Advance / retreat handlers -------------------------------------------
  const handleAdvance = useCallback(
    (opportunity: Opportunity) => {
      const next = nextOpportunityStage(opportunity.stage);
      if (next) onMoveStage(opportunity.id, next);
    },
    [onMoveStage]
  );

  const handleRetreat = useCallback(
    (opportunity: Opportunity) => {
      const prev = previousOpportunityStage(opportunity.stage);
      if (prev) onMoveStage(opportunity.id, prev);
    },
    [onMoveStage]
  );

  // -- Swap a collapsed column into the visible area ------------------------
  const handleExpandCollapsed = useCallback(
    (stage: OpportunityStage) => {
      setStageOrder((prev) => {
        const newOrder = [...prev];
        const collapsedIdx = newOrder.indexOf(stage);
        const lastVisibleIdx = maxVisible - 1;
        // Swap the clicked collapsed column with the rightmost visible column
        [newOrder[lastVisibleIdx], newOrder[collapsedIdx]] = [
          newOrder[collapsedIdx],
          newOrder[lastVisibleIdx],
        ];
        return newOrder;
      });
    },
    [maxVisible]
  );

  // -- Drag handlers --------------------------------------------------------
  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const opportunity = active.data.current?.opportunity as
      | Opportunity
      | undefined;
    if (!opportunity) return;

    const targetStage = over.id as OpportunityStage;

    // Validate target is an active stage on the board
    if (!ACTIVE_STAGES.includes(targetStage)) return;

    // Only move if actually changing stage
    if (opportunity.stage === targetStage) return;

    onMoveStage(opportunity.id, targetStage);
  }

  function handleDragCancel(_event: DragCancelEvent) {
    setActiveId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div ref={containerRef} className="flex gap-[8px] h-full overflow-x-auto min-w-0">
        {/* Visible columns — fluid, share available space equally */}
        {visibleStages.map((stage) => (
          <PipelineColumn
            key={stage}
            stage={stage}
            opportunities={opportunitiesByStage.get(stage) ?? []}
            clients={clients}
            expandedCardId={expandedCardId}
            onToggleExpand={onToggleExpand}
            onAdvance={handleAdvance}
            onRetreat={handleRetreat}
            onLogCall={onLogCall}
            onLogText={onLogText}
            onAddNote={onAddNote}
            onArchive={onArchive}
            onMarkWon={onMarkWon}
            onMarkLost={onMarkLost}
            onOpenDetail={onOpenDetail}
            onAssign={onAssign}
            onScheduleFollowUp={onScheduleFollowUp}
            onAddLead={
              stage === OpportunityStage.NewLead ? onAddLead : undefined
            }
            canManage={canManage}
            activeId={activeId}
            isTerminal={false}
          />
        ))}

        {/* Separator + collapsed columns */}
        {collapsedStages.length > 0 && (
          <>
            <div className="w-px self-stretch bg-[rgba(255,255,255,0.06)] shrink-0" />

            {collapsedStages.map((stage) => (
              <PipelineCollapsedColumn
                key={stage}
                stage={stage}
                count={(opportunitiesByStage.get(stage) ?? []).length}
                maxCount={maxStageCount}
                onExpand={() => handleExpandCollapsed(stage)}
              />
            ))}
          </>
        )}
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {activeOpportunity ? (
          <div className="w-[240px]">
            <PipelineCard
              isOverlay
              opportunity={activeOpportunity}
              clientName={
                activeOpportunity.clientId
                  ? (clients.get(activeOpportunity.clientId) ??
                    activeOpportunity.contactName ??
                    "Unknown")
                  : (activeOpportunity.contactName ?? "Unknown")
              }
              isExpanded={false}
              onToggleExpand={() => {}}
              onAdvance={() => {}}
              onRetreat={() => {}}
              onLogCall={() => {}}
              onLogText={() => {}}
              onAddNote={() => {}}
              onArchive={() => {}}
              onMarkWon={() => {}}
              onMarkLost={() => {}}
              onOpenDetail={() => {}}
              onAssign={() => {}}
              onScheduleFollowUp={() => {}}
              canManage={false}
              stageConfig={
                PIPELINE_STAGES_DEFAULT.find(
                  (s) => s.slug === activeOpportunity.stage
                ) ?? PIPELINE_STAGES_DEFAULT[0]
              }
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
