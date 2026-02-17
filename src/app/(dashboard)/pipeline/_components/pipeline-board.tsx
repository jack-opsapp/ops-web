"use client";

import { useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  type Opportunity,
  OpportunityStage,
  getActiveStages,
  formatCurrency,
} from "@/lib/types/pipeline";
import type { Client } from "@/lib/types/models";
import { PipelineColumn } from "./pipeline-column";
import { PipelineCard } from "./pipeline-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PipelineBoardProps {
  opportunities: Opportunity[];
  clientMap: Map<string, Client>;
  searchQuery: string;
  stageFilter: OpportunityStage | null;
  onMoveStage: (id: string, newStage: OpportunityStage) => void;
  onAdvanceStage: (opportunity: Opportunity) => void;
  onSelectOpportunity: (opportunity: Opportunity) => void;
  onAddLead: () => void;
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
// Pipeline Board - DndContext wrapper with columns
// ---------------------------------------------------------------------------
export function PipelineBoard({
  opportunities,
  clientMap,
  searchQuery,
  stageFilter,
  onMoveStage,
  onAdvanceStage,
  onSelectOpportunity,
  onAddLead,
}: PipelineBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // ── Filter opportunities ─────────────────────────────────────────────
  const filteredOpportunities = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return opportunities.filter((opp) => {
      // Stage filter
      if (stageFilter && opp.stage !== stageFilter) return false;

      // Search filter
      if (query) {
        const clientName =
          opp.clientId
            ? (clientMap.get(opp.clientId)?.name ?? "")
            : "";
        const contactName = opp.contactName ?? "";
        const title = opp.title ?? "";

        const matchesSearch =
          clientName.toLowerCase().includes(query) ||
          contactName.toLowerCase().includes(query) ||
          title.toLowerCase().includes(query);

        if (!matchesSearch) return false;
      }

      return true;
    });
  }, [opportunities, searchQuery, stageFilter, clientMap]);

  // ── Group opportunities by stage ─────────────────────────────────────
  const opportunitiesByStage = useMemo(() => {
    const map = new Map<OpportunityStage, Opportunity[]>();
    for (const stage of ALL_BOARD_STAGES) {
      map.set(stage, []);
    }
    for (const opp of filteredOpportunities) {
      const list = map.get(opp.stage);
      if (list) {
        list.push(opp);
      }
    }
    return map;
  }, [filteredOpportunities]);

  // ── Active drag card ─────────────────────────────────────────────────
  const activeOpportunity = activeId
    ? opportunities.find((o) => o.id === activeId) ?? null
    : null;

  const activeClientName = activeOpportunity
    ? activeOpportunity.clientId
      ? (clientMap.get(activeOpportunity.clientId)?.name ??
        activeOpportunity.contactName ??
        "Unknown")
      : (activeOpportunity.contactName ?? "New Lead")
    : "";

  // ── Drag handlers ────────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const opportunityId = active.id as string;
    const newStage = over.id as OpportunityStage;

    // Validate target is a valid stage
    if (!ALL_BOARD_STAGES.includes(newStage)) return;

    // Find opportunity and check it actually moved
    const opportunity = opportunities.find((o) => o.id === opportunityId);
    if (!opportunity || opportunity.stage === newStage) return;

    onMoveStage(opportunityId, newStage);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-2 min-w-min">
        {/* Active stage columns */}
        {ACTIVE_STAGES.map((stage) => (
          <PipelineColumn
            key={stage}
            stage={stage}
            opportunities={opportunitiesByStage.get(stage) ?? []}
            clientMap={clientMap}
            onSelectOpportunity={onSelectOpportunity}
            onAdvanceStage={onAdvanceStage}
            onAddLead={stage === OpportunityStage.NewLead ? onAddLead : undefined}
          />
        ))}

        {/* Visual separator */}
        <div className="flex items-stretch py-4">
          <div className="w-[1px] bg-border-subtle" />
        </div>

        {/* Terminal columns (Won / Lost) - narrower */}
        {TERMINAL_STAGES.map((stage) => (
          <PipelineColumn
            key={stage}
            stage={stage}
            opportunities={opportunitiesByStage.get(stage) ?? []}
            clientMap={clientMap}
            onSelectOpportunity={onSelectOpportunity}
            narrow
          />
        ))}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeOpportunity ? (
          <PipelineCard
            opportunity={activeOpportunity}
            clientName={activeClientName}
            isDragOverlay
            onSelect={() => {}}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
