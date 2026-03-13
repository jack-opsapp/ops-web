"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
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
import { useDictionary } from "@/i18n/client";
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

const EXPANDED_WIDTH = 280;
const EXPANDED_NARROW = 200;
const COLLAPSED_WIDTH = 44;
const GAP = 8;
const SEPARATOR_WIDTH = 17; // 1px line + px-1 padding

// ---------------------------------------------------------------------------
// Auto-collapse: calculate which stages fit expanded
// ---------------------------------------------------------------------------
function calcDefaultExpanded(containerWidth: number): Set<OpportunityStage> {
  const expanded = new Set<OpportunityStage>();
  let remaining = containerWidth;

  // Active stages left to right
  for (const stage of ACTIVE_STAGES) {
    const needed = EXPANDED_WIDTH + GAP;
    if (remaining >= needed) {
      expanded.add(stage);
      remaining -= needed;
    } else {
      remaining -= COLLAPSED_WIDTH + GAP;
    }
  }

  remaining -= SEPARATOR_WIDTH;

  // Terminal stages
  for (const stage of TERMINAL_STAGES) {
    const needed = EXPANDED_NARROW + GAP;
    if (remaining >= needed) {
      expanded.add(stage);
      remaining -= needed;
    } else {
      remaining -= COLLAPSED_WIDTH + GAP;
    }
  }

  return expanded;
}

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
  const { t } = useDictionary("pipeline");
  const [activeId, setActiveId] = useState<string | null>(null);

  // ── Expanded state ─────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedStages, setExpandedStages] = useState<Set<OpportunityStage>>(
    () => new Set(ALL_BOARD_STAGES) // start all expanded, auto-collapse after measure
  );
  const [userOverrides, setUserOverrides] = useState<Set<OpportunityStage>>(
    () => new Set()
  );

  // Auto-collapse on mount and resize (only for non-overridden stages)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const autoExpanded = calcDefaultExpanded(width);

      setExpandedStages((prev) => {
        const next = new Set<OpportunityStage>();
        for (const stage of ALL_BOARD_STAGES) {
          if (userOverrides.has(stage)) {
            // Keep user's manual choice
            next.add(stage); // will be in prev if user expanded it
            if (!prev.has(stage)) next.delete(stage);
          } else {
            // Auto-collapse/expand
            if (autoExpanded.has(stage)) next.add(stage);
          }
        }
        return next;
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [userOverrides]);

  const toggleStage = useCallback((stage: OpportunityStage) => {
    setUserOverrides((prev) => {
      const next = new Set(prev);
      next.add(stage);
      return next;
    });
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) {
        next.delete(stage);
      } else {
        next.add(stage);
      }
      return next;
    });
  }, []);

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

  // ── Max count across all stages (for collapsed fill indicator) ──────
  const maxStageCount = useMemo(() => {
    let max = 0;
    for (const [, list] of opportunitiesByStage) {
      if (list.length > max) max = list.length;
    }
    return max;
  }, [opportunitiesByStage]);

  // ── Active drag card ─────────────────────────────────────────────────
  const activeOpportunity = activeId
    ? opportunities.find((o) => o.id === activeId) ?? null
    : null;

  const activeClientName = activeOpportunity
    ? activeOpportunity.clientId
      ? (clientMap.get(activeOpportunity.clientId)?.name ??
        activeOpportunity.contactName ??
        t("card.unknown"))
      : (activeOpportunity.contactName ?? t("newLead"))
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
    <div ref={containerRef} className="h-full">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-1 min-w-min h-full">
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
              isExpanded={expandedStages.has(stage)}
              onToggleExpand={() => toggleStage(stage)}
              maxCount={maxStageCount}
            />
          ))}

          {/* Visual separator */}
          <div className="flex items-stretch py-4 px-0.5">
            <div className="w-[1px] bg-border-subtle" />
          </div>

          {/* Terminal columns (Won / Lost) */}
          {TERMINAL_STAGES.map((stage) => (
            <PipelineColumn
              key={stage}
              stage={stage}
              opportunities={opportunitiesByStage.get(stage) ?? []}
              clientMap={clientMap}
              onSelectOpportunity={onSelectOpportunity}
              narrow
              isExpanded={expandedStages.has(stage)}
              onToggleExpand={() => toggleStage(stage)}
              maxCount={maxStageCount}
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
    </div>
  );
}
