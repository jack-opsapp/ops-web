"use client";

import { useState, useMemo, useCallback } from "react";
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
const TERMINAL_STAGES: OpportunityStage[] = [
  OpportunityStage.Won,
  OpportunityStage.Lost,
];
const ALL_BOARD_STAGES = [...ACTIVE_STAGES, ...TERMINAL_STAGES];

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

  // -- Sensors ---------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // -- Group opportunities by stage ------------------------------------------
  const opportunitiesByStage = useMemo(() => {
    const map = new Map<OpportunityStage, Opportunity[]>();
    for (const stage of ALL_BOARD_STAGES) {
      map.set(stage, []);
    }
    for (const opp of opportunities) {
      const list = map.get(opp.stage);
      if (list) {
        list.push(opp);
      }
    }
    return map;
  }, [opportunities]);

  // -- Active drag opportunity -----------------------------------------------
  const activeOpportunity = useMemo(
    () =>
      activeId ? opportunities.find((o) => o.id === activeId) ?? null : null,
    [activeId, opportunities]
  );

  // -- Advance / retreat handlers --------------------------------------------
  const handleAdvance = useCallback(
    (opportunity: Opportunity) => {
      const next = nextOpportunityStage(opportunity.stage);
      if (next) {
        onMoveStage(opportunity.id, next);
      }
    },
    [onMoveStage]
  );

  const handleRetreat = useCallback(
    (opportunity: Opportunity) => {
      const prev = previousOpportunityStage(opportunity.stage);
      if (prev) {
        onMoveStage(opportunity.id, prev);
      }
    },
    [onMoveStage]
  );

  // -- Drag handlers ---------------------------------------------------------
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

    // Validate target is a real stage
    if (!ALL_BOARD_STAGES.includes(targetStage)) return;

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
      <div className="flex gap-[8px] overflow-x-auto scrollbar-hide pb-2 h-full">
        {/* Active stage columns */}
        {ACTIVE_STAGES.map((stage) => (
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

        {/* Separator before terminal columns */}
        <div className="w-px self-stretch bg-[rgba(255,255,255,0.06)] mx-[4px] shrink-0" />

        {/* Terminal columns (Won / Lost) */}
        {TERMINAL_STAGES.map((stage) => (
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
            canManage={canManage}
            activeId={activeId}
            isTerminal={true}
          />
        ))}
      </div>

      {/* Drag overlay — no drop animation, layout handled by Framer Motion */}
      <DragOverlay dropAnimation={null}>
        {activeOpportunity ? (
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
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
