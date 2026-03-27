"use client";

import { useState, useCallback, useMemo, useEffect, useRef, memo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Mail, X, Loader2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { trackScreenView } from "@/lib/analytics/analytics";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import {
  useOpportunities,
  useClients,
  useTeamMembers,
  useMoveOpportunityStage,
  useUpdateOpportunity,
  useCreateOpportunity,
  useCreateActivity,
  useArchiveOpportunity,
  useUnarchiveOpportunity,
  useDeleteOpportunity,
  useGmailConnections,
  usePipelineMetrics,
} from "@/lib/hooks";
import { MetricsHeader } from "@/components/metrics";
import {
  type Opportunity,
  OpportunityStage,
  OpportunitySource,
  ActivityType,
  getStageDisplayName,
  isActiveStage,
  nextOpportunityStage,
  previousOpportunityStage,
  PIPELINE_STAGES_DEFAULT,
} from "@/lib/types/pipeline";
import {
  actionPromptVariants,
  actionPromptVariantsReduced,
} from "@/lib/utils/motion";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { PipelineMobile } from "./_components/pipeline-mobile";
import { useDetailPopoverStore } from "./_components/detail-popover-store";
import { DetailPopover } from "./_components/detail-popover";
import { DetailPopoverTether } from "./_components/detail-popover-tether";
import { StageTransitionDialog } from "./_components/stage-transition-dialog";
import { useWindowStore } from "@/stores/window-store";
import { InboxLeadsQueue } from "@/components/ops/inbox-leads-queue";
import { EmailReviewPanel } from "@/components/ops/email-review-panel";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import { SpatialCanvas } from "./_components/spatial-canvas";
import { SpatialStageStack } from "./_components/spatial-stage-stack";
import { SpatialCard } from "./_components/spatial-card";
import { SpatialCardHoverMetrics } from "./_components/spatial-card-hover-metrics";
import { SpatialCardExpanded } from "./_components/spatial-card-expanded";
import { SpatialDragOverlay } from "./_components/spatial-drag-overlay";
import { SpatialMarqueeSelect, isCardInMarquee } from "./_components/spatial-marquee-select";
import { SpatialContextMenu } from "./_components/spatial-context-menu";
import { SpatialTerminalRegion } from "./_components/spatial-terminal-region";
import { SpatialFloatingToolbar } from "./_components/spatial-floating-toolbar";
import { SpatialArchiveTray } from "./_components/spatial-archive-tray";
import { calculateCanvasLayout } from "./_components/spatial-layout-engine";
import { calculateBatchStaleness } from "./_components/spatial-staleness";
import {
  useSpatialCanvasStore,
  BIRD_EYE_THRESHOLD,
  CARD_WIDTH,
  CARD_HEIGHT,
} from "./_components/spatial-canvas-store";
import { OPPORTUNITY_STAGE_COLORS } from "@/lib/types/pipeline";

// ---------------------------------------------------------------------------
// SpatialCardWrapper — reads reactive store state per-card for efficient re-renders
// ---------------------------------------------------------------------------
const SpatialCardWrapperComponent = memo(function SpatialCardWrapperComponent({
  opportunity,
  position,
  draggable,
  clientNameMap,
  stalenessMap,
  canManage,
  callbacksRef,
  handleCardContextMenu,
  tUnknown,
}: {
  opportunity: Opportunity;
  position: { x: number; y: number };
  draggable: boolean;
  clientNameMap: Map<string, string>;
  stalenessMap: Map<string, number>;
  canManage: boolean;
  callbacksRef: React.RefObject<{
    onMoveStage: (id: string, stage: OpportunityStage) => void;
    onLogCall: (id: string) => void;
    onLogText: (id: string) => void;
    onAddNote: (id: string, note: string) => void;
    onArchive: (id: string) => void;
    onDiscard: (id: string) => void;
    onMarkWon: (opportunity: Opportunity) => void;
    onMarkLost: (opportunity: Opportunity) => void;
    onOpenDetail: (opportunity: Opportunity) => void;
    onAssign: (id: string) => void;
    onScheduleFollowUp: (id: string) => void;
  }>;
  handleCardContextMenu: (e: React.MouseEvent, id: string) => void;
  tUnknown: string;
}) {
  // Read reactive state directly from the store — only this component re-renders
  const isSelected = useSpatialCanvasStore((s) => s.selectedCardIds.has(opportunity.id));
  const isExpanded = useSpatialCanvasStore((s) => s.expandedCardIds.has(opportunity.id));
  const isHovered = useSpatialCanvasStore((s) => s.hoveredCardId === opportunity.id);
  const isBirdEye = useSpatialCanvasStore((s) => s.zoom < BIRD_EYE_THRESHOLD);
  const toggleCardExpanded = useSpatialCanvasStore((s) => s.toggleCardExpanded);
  const setHoveredCard = useSpatialCanvasStore((s) => s.setHoveredCard);
  const toggleCardSelected = useSpatialCanvasStore((s) => s.toggleCardSelected);
  const customPos = useSpatialCanvasStore((s) => s.customPositions.get(opportunity.id));

  // Use custom (free-form) position if set, otherwise fall back to layout position
  const effectivePosition = customPos ?? position;

  const clientName =
    clientNameMap.get(opportunity.clientId ?? "") ??
    opportunity.contactName ??
    tUnknown;
  const stageColor = OPPORTUNITY_STAGE_COLORS[opportunity.stage] ?? "#BCBCBC";
  const stalenessOpacity = stalenessMap.get(opportunity.id) ?? 1.0;
  const cb = callbacksRef.current;

  return (
    <div
      data-spatial-card
      data-opportunity-id={opportunity.id}
      className="absolute"
      style={{
        left: effectivePosition.x,
        top: effectivePosition.y,
        width: CARD_WIDTH,
        zIndex: isExpanded ? 20 : isHovered ? 10 : 1,
        transition: "left 0.3s cubic-bezier(0.22, 1, 0.36, 1), top 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <SpatialCard
        opportunity={opportunity}
        clientName={clientName}
        stageColor={stageColor}
        stalenessOpacity={stalenessOpacity}
        isSelected={isSelected}
        isExpanded={isExpanded}
        isHovered={isHovered}
        isBirdEye={isBirdEye}
        canManage={canManage}
        draggable={draggable}
        onToggleExpand={() => toggleCardExpanded(opportunity.id)}
        onHover={() => setHoveredCard(opportunity.id)}
        onHoverEnd={() => setHoveredCard(null)}
        onSelect={(e) => {
          if (e.shiftKey || e.metaKey) toggleCardSelected(opportunity.id);
        }}
        onContextMenu={(e) => handleCardContextMenu(e, opportunity.id)}
        onAdvance={() => {
          const next = nextOpportunityStage(opportunity.stage);
          if (next) cb.onMoveStage(opportunity.id, next);
        }}
        onRetreat={() => {
          const prev = previousOpportunityStage(opportunity.stage);
          if (prev) cb.onMoveStage(opportunity.id, prev);
        }}
        onLogCall={() => cb.onLogCall(opportunity.id)}
        onLogText={() => cb.onLogText(opportunity.id)}
        onAddNote={(note) => cb.onAddNote(opportunity.id, note)}
        onArchive={() => cb.onArchive(opportunity.id)}
        onDiscard={() => cb.onDiscard(opportunity.id)}
        onMarkWon={() => cb.onMarkWon(opportunity)}
        onMarkLost={() => cb.onMarkLost(opportunity)}
        onOpenDetail={() => cb.onOpenDetail(opportunity)}
        onAssign={() => cb.onAssign(opportunity.id)}
        onScheduleFollowUp={() => cb.onScheduleFollowUp(opportunity.id)}
        expandedContent={
          isExpanded && !isBirdEye ? (
            <SpatialCardExpanded
              opportunity={opportunity}
              canManage={canManage}
              onLogCall={() => cb.onLogCall(opportunity.id)}
              onLogText={() => cb.onLogText(opportunity.id)}
              onAddNote={(note) => cb.onAddNote(opportunity.id, note)}
              onArchive={() => cb.onArchive(opportunity.id)}
              onDiscard={() => cb.onDiscard(opportunity.id)}
              onMarkWon={() => cb.onMarkWon(opportunity)}
              onMarkLost={() => cb.onMarkLost(opportunity)}
              onAssign={() => cb.onAssign(opportunity.id)}
              onScheduleFollowUp={() => cb.onScheduleFollowUp(opportunity.id)}
              onOpenDetail={() => cb.onOpenDetail(opportunity)}
            />
          ) : undefined
        }
      />
      {isHovered && !isExpanded && !isBirdEye && (
        <SpatialCardHoverMetrics opportunity={opportunity} isVisible={true} />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Spatial Canvas Desktop — wraps all spatial components with DndContext
// ---------------------------------------------------------------------------
function SpatialCanvasDesktop({
  opportunities,
  clientNameMap,
  canManage,
  onMoveStage,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onDiscard,
  onMarkWon,
  onMarkLost,
  onOpenDetail,
  onAssign,
  onScheduleFollowUp,
  onAddLead,
  archivedOpportunities,
  onRestore,
  onDeletePermanently,
}: {
  opportunities: Opportunity[];
  clientNameMap: Map<string, string>;
  canManage: boolean;
  onMoveStage: (id: string, stage: OpportunityStage) => void;
  onLogCall: (id: string) => void;
  onLogText: (id: string) => void;
  onAddNote: (id: string, note: string) => void;
  onArchive: (id: string) => void;
  onDiscard: (id: string) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onOpenDetail: (opportunity: Opportunity) => void;
  onAssign: (id: string) => void;
  onScheduleFollowUp: (id: string) => void;
  onAddLead: () => void;
  archivedOpportunities: Opportunity[];
  onRestore: (id: string) => void;
  onDeletePermanently: (id: string) => void;
}) {
  const { t: tPipeline } = useDictionary("pipeline");
  const sortBy = useSpatialCanvasStore((s) => s.sortBy);
  const stageSortOverrides = useSpatialCanvasStore((s) => s.stageSortOverrides);
  const selectedCardIds = useSpatialCanvasStore((s) => s.selectedCardIds);
  const clearSelection = useSpatialCanvasStore((s) => s.clearSelection);
  const showContextMenu = useSpatialCanvasStore((s) => s.showContextMenu);
  const selectCards = useSpatialCanvasStore((s) => s.selectCards);
  const startDrag = useSpatialCanvasStore((s) => s.startDrag);
  const endDrag = useSpatialCanvasStore((s) => s.endDrag);
  const isBirdEye = useSpatialCanvasStore((s) => s.zoom < BIRD_EYE_THRESHOLD);

  // Calculate layout
  const layout = useMemo(
    () => calculateCanvasLayout(opportunities, sortBy, clientNameMap, stageSortOverrides),
    [opportunities, sortBy, clientNameMap, stageSortOverrides]
  );

  // Auto-fit canvas on first load
  const fitAll = useSpatialCanvasStore((s) => s.fitAll);
  const hasAutoFit = useRef(false);
  useEffect(() => {
    if (!hasAutoFit.current && layout.canvasWidth > 0) {
      hasAutoFit.current = true;
      // Slight delay to ensure container is measured
      requestAnimationFrame(() => {
        const el = document.querySelector("[data-spatial-canvas]");
        if (el) {
          fitAll(el.clientWidth, el.clientHeight);
        }
      });
    }
  }, [layout.canvasWidth, fitAll]);

  // Calculate staleness
  const stalenessMap = useMemo(
    () => calculateBatchStaleness(opportunities),
    [opportunities]
  );

  // Active drag state
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeOpportunity = activeId
    ? opportunities.find((o) => o.id === activeId) ?? null
    : null;

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      setActiveId(id);
      if (selectedCardIds.has(id)) {
        // Dragging a selected card — drag all selected
        startDrag(Array.from(selectedCardIds), { x: 0, y: 0 });
      } else {
        // Dragging an unselected card — clear selection, drag just this one
        clearSelection();
        startDrag([id], { x: 0, y: 0 });
      }
    },
    [selectedCardIds, startDrag, clearSelection]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { over } = event;
      const draggedId = String(event.active.id);

      if (over) {
        const data = over.data.current as { stage?: OpportunityStage; isTerminal?: boolean } | undefined;
        if (data?.stage) {
          // Check if dropping on a terminal region — trigger transition dialog
          if (data.isTerminal) {
            const ids = selectedCardIds.has(draggedId)
              ? Array.from(selectedCardIds)
              : [draggedId];
            for (const id of ids) {
              const opp = opportunities.find((o) => o.id === id);
              if (opp) {
                if (data.stage === OpportunityStage.Won) {
                  onMarkWon(opp);
                } else if (data.stage === OpportunityStage.Lost) {
                  onMarkLost(opp);
                }
              }
            }
            clearSelection();
          } else {
            // Move dragged cards to this stage
            const ids = selectedCardIds.has(draggedId)
              ? Array.from(selectedCardIds)
              : [draggedId];
            for (const id of ids) {
              onMoveStage(id, data.stage);
            }
            clearSelection();
          }
        }
      } else {
        // Dropped on empty canvas — save as free-form position (Finder-style)
        const { setCustomPosition, customPositions, zoom } = useSpatialCanvasStore.getState();
        const draggedIds = selectedCardIds.has(draggedId)
          ? Array.from(selectedCardIds)
          : [draggedId];

        const { delta } = event;

        const allPositions = [
          ...layout.stacks.flatMap((s) => s.cardPositions),
          ...layout.terminalRegions.flatMap((r) => r.cardPositions),
        ];

        for (const id of draggedIds) {
          const currentPos = allPositions.find((p) => p.opportunityId === id);
          const existingCustom = customPositions.get(id);
          const basePos = existingCustom ?? (currentPos ? { x: currentPos.x, y: currentPos.y } : null);
          if (basePos) {
            setCustomPosition(id, {
              x: basePos.x + delta.x / zoom,
              y: basePos.y + delta.y / zoom,
            });
          }
        }
      }

      setActiveId(null);
      endDrag();
    },
    [selectedCardIds, onMoveStage, onMarkWon, onMarkLost, clearSelection, endDrag, opportunities, layout]
  );

  // Context menu handlers
  const handleCardContextMenu = useCallback(
    (e: React.MouseEvent, id: string) => {
      const opp = opportunities.find((o) => o.id === id);
      showContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        type: selectedCardIds.size > 1 && selectedCardIds.has(id) ? "selection" : "card",
        targetCardId: id,
        stage: opp?.stage ?? null,
      });
    },
    [showContextMenu, selectedCardIds, opportunities]
  );

  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Hit-test: convert screen coords to canvas-space and check region bounds
      const container = document.querySelector("[data-spatial-canvas]");
      const rect = container?.getBoundingClientRect();
      const { viewportX, viewportY, zoom } = useSpatialCanvasStore.getState();

      let hitStage: string | null = null;

      if (rect) {
        const canvasX = (e.clientX - rect.left - viewportX) / zoom;
        const canvasY = (e.clientY - rect.top - viewportY) / zoom;

        // Check active stage regions
        for (const stack of layout.stacks) {
          const b = stack.regionBounds;
          if (canvasX >= b.x && canvasX <= b.x + b.width && canvasY >= b.y && canvasY <= b.y + b.height) {
            hitStage = stack.stage;
            break;
          }
        }

        // Check terminal regions if no active stage hit
        if (!hitStage) {
          for (const region of layout.terminalRegions) {
            const b = region.bounds;
            if (canvasX >= b.x && canvasX <= b.x + b.width && canvasY >= b.y && canvasY <= b.y + b.height) {
              hitStage = region.stage;
              break;
            }
          }
        }
      }

      showContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        type: "canvas",
        targetCardId: null,
        stage: hitStage,
      });
    },
    [showContextMenu, layout]
  );

  // Marquee selection → compute which cards fall inside the rectangle
  // Uses custom positions when present so marquee matches visual card locations
  const handleMarqueeEnd = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const { customPositions } = useSpatialCanvasStore.getState();
      const allPositions = [
        ...layout.stacks.flatMap((s) => s.cardPositions),
        ...layout.terminalRegions.flatMap((r) => r.cardPositions),
      ];
      const selected = allPositions
        .filter((pos) => {
          const effective = customPositions.get(pos.opportunityId) ?? pos;
          return isCardInMarquee(effective.x, effective.y, CARD_WIDTH, CARD_HEIGHT, start, end);
        })
        .map((pos) => pos.opportunityId);
      if (selected.length > 0) {
        selectCards(selected);
      }
    },
    [layout, selectCards]
  );

  // Stable callbacks ref — avoids recreating renderCard on every callback change
  const callbacksRef = useRef({
    onMoveStage,
    onLogCall,
    onLogText,
    onAddNote,
    onArchive,
    onDiscard,
    onMarkWon,
    onMarkLost,
    onOpenDetail,
    onAssign,
    onScheduleFollowUp,
  });
  callbacksRef.current = {
    onMoveStage,
    onLogCall,
    onLogText,
    onAddNote,
    onArchive,
    onDiscard,
    onMarkWon,
    onMarkLost,
    onOpenDetail,
    onAssign,
    onScheduleFollowUp,
  };

  // Render card helper — returns a wrapper that reads reactive state from the store
  // This avoids recreating renderCard on every hover/selection/expand change
  const renderCard = useCallback(
    (opportunity: Opportunity, position: { x: number; y: number }, draggable = true) => (
      <SpatialCardWrapperComponent
        key={opportunity.id}
        opportunity={opportunity}
        position={position}
        draggable={draggable}
        clientNameMap={clientNameMap}
        stalenessMap={stalenessMap}
        canManage={canManage}
        callbacksRef={callbacksRef}
        handleCardContextMenu={handleCardContextMenu}
        tUnknown={tPipeline("card.unknown")}
      />
    ),
    [clientNameMap, stalenessMap, canManage, handleCardContextMenu, tPipeline]
  );

  // Group opportunities by stage for stacks
  const oppsByStage = useMemo(() => {
    const map = new Map<OpportunityStage, Opportunity[]>();
    for (const opp of opportunities) {
      const arr = map.get(opp.stage) ?? [];
      arr.push(opp);
      map.set(opp.stage, arr);
    }
    return map;
  }, [opportunities]);

  const batchCount = activeId && selectedCardIds.has(activeId)
    ? selectedCardIds.size
    : 1;

  return (
    <div className="relative h-full w-full">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SpatialCanvas
          canvasWidth={layout.canvasWidth}
          canvasHeight={layout.canvasHeight}
          onCanvasContextMenu={handleCanvasContextMenu}
          onMarqueeEnd={handleMarqueeEnd}
        >
          {/* Active stage stacks */}
          {layout.stacks.map((stackLayout) => (
            <SpatialStageStack
              key={stackLayout.stage}
              stage={stackLayout.stage}
              opportunities={oppsByStage.get(stackLayout.stage) ?? []}
              layout={stackLayout}
              isBirdEye={isBirdEye}
              activeId={activeId}
              renderCard={(opp, pos) => renderCard(opp, pos)}
            />
          ))}

          {/* Terminal regions (Won/Lost) */}
          {layout.terminalRegions.map((regionLayout) => (
            <SpatialTerminalRegion
              key={regionLayout.stage}
              stage={regionLayout.stage as OpportunityStage.Won | OpportunityStage.Lost}
              opportunities={oppsByStage.get(regionLayout.stage) ?? []}
              layout={regionLayout}
              renderCard={(opp, pos) => renderCard(opp, pos, false)}
            />
          ))}

          {/* Marquee selection */}
          <SpatialMarqueeSelect />
        </SpatialCanvas>

        {/* Drag overlay */}
        <SpatialDragOverlay
          activeOpportunity={activeOpportunity}
          clientName={
            activeOpportunity
              ? clientNameMap.get(activeOpportunity.clientId ?? "") ??
                activeOpportunity.contactName ??
                tPipeline("card.unknown")
              : ""
          }
          batchCount={batchCount}
        />
      </DndContext>

      {/* Context menu */}
      <SpatialContextMenu
        onEdit={(id) => {
          const opp = opportunities.find((o) => o.id === id);
          if (opp) onOpenDetail(opp);
        }}
        onArchive={onArchive}
        onArchiveBatch={(ids) => ids.forEach(onArchive)}
        onDelete={onDiscard}
        onMoveToStage={(ids, stage) => ids.forEach((id) => onMoveStage(id, stage))}
        onAssign={(ids) => ids.forEach(onAssign)}
        onMarkWon={(ids) => {
          for (const id of ids) {
            const opp = opportunities.find((o) => o.id === id);
            if (opp) onMarkWon(opp);
          }
        }}
        onMarkLost={(ids) => {
          for (const id of ids) {
            const opp = opportunities.find((o) => o.id === id);
            if (opp) onMarkLost(opp);
          }
        }}
        onSelectAll={(stage) => {
          if (stage) {
            selectCards(opportunities.filter((o) => o.stage === stage).map((o) => o.id));
          } else {
            selectCards(opportunities.map((o) => o.id));
          }
        }}
      />

      {/* Archive tray */}
      <SpatialArchiveTray
        archivedOpportunities={archivedOpportunities}
        clients={clientNameMap}
        onRestore={onRestore}
        onDeletePermanently={onDeletePermanently}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------
function PipelineSkeleton() {
  const { t } = useDictionary("pipeline");
  const stages = PIPELINE_STAGES_DEFAULT;

  return (
    <div className="flex flex-col h-full space-y-2 min-w-0">
      {/* Header skeleton */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <p className="font-kosugi text-caption-sm text-text-tertiary">
            {t("loading")}
          </p>
        </div>

        {/* Metrics skeleton */}
        <div className="bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)] border border-[rgba(255,255,255,0.06)] rounded-[4px]">
          <div className="flex items-center gap-[16px] px-3 py-[8px]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[2px]">
                <div className="h-[18px] w-[60px] bg-background-elevated rounded animate-pulse" />
                <div className="h-[10px] w-[40px] bg-background-elevated rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Board skeleton */}
      <div className="flex-1 overflow-x-auto pb-2">
        <div className="flex gap-2 min-w-min">
          {stages.slice(0, 6).map((stage) => (
            <div
              key={stage.slug}
              className="flex flex-col w-[280px] shrink-0"
            >
              <div
                className="border-t-2 rounded-t-sm px-1.5 py-1 bg-background-panel border border-border border-b-0"
                style={{ borderTopColor: stage.color }}
              >
                <div className="flex items-center gap-1">
                  <h3
                    className="font-mohave text-body font-medium uppercase tracking-wider"
                    style={{ color: stage.color }}
                  >
                    {stage.name}
                  </h3>
                  <span className="font-mono text-[11px] text-text-disabled bg-background-elevated px-[6px] py-[2px] rounded-sm">
                    --
                  </span>
                </div>
              </div>
              <div className="flex-1 border border-border border-t-0 rounded-b p-1 space-y-1 min-h-[200px] bg-[rgba(10,10,10,0.5)]">
                {[1, 2].map((j) => (
                  <div
                    key={j}
                    className="bg-[rgba(13,13,13,0.6)] border border-[rgba(255,255,255,0.2)] rounded-[5px] p-1.5 space-y-1.5 animate-pulse"
                  >
                    <div className="h-[14px] w-3/4 bg-background-elevated rounded" />
                    <div className="h-[10px] w-1/2 bg-background-elevated rounded" />
                    <div className="h-[10px] w-1/3 bg-background-elevated rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Responsive breakpoint hook
// ---------------------------------------------------------------------------
function useIsMobile(breakpoint = 900): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);

  return isMobile;
}

// ---------------------------------------------------------------------------
// Pipeline Page - Main Orchestrator
// ---------------------------------------------------------------------------
export default function PipelinePage() {
  usePageTitle("Pipeline");
  const { t } = useDictionary("pipeline");
  const router = useRouter();
  const isMobile = useIsMobile();

  // ── Reduced motion ────────────────────────────────────────────────────
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const toastVariants = prefersReducedMotion
    ? actionPromptVariantsReduced
    : actionPromptVariants;

  // ── Filter / search state ─────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<OpportunityStage | "all">(
    "all"
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string | "all">("all");

  // ── Card expand state (single card accordion) ─────────────────────────
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // ── Lead creation via floating window ────────────────────────────────
  const openWindow = useWindowStore((s) => s.openWindow);

  // ── Inbox leads / email review ────────────────────────────────────────
  const [showInboxLeads, setShowInboxLeads] = useState(false);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);

  // ── Gmail banner ──────────────────────────────────────────────────────
  const [gmailBannerDismissed, setGmailBannerDismissed] = useState(false);

  // ── Detail popovers ──────────────────────────────────────────────────
  const openPopover = useDetailPopoverStore((s) => s.openPopover);
  const popoversMap = useDetailPopoverStore((s) => s.popovers);

  // ── Stage transition dialog ───────────────────────────────────────────
  const [transitionType, setTransitionType] = useState<"won" | "lost" | null>(
    null
  );
  const [transitionOpportunity, setTransitionOpportunity] =
    useState<Opportunity | null>(null);
  const [pendingStageMove, setPendingStageMove] = useState<{
    id: string;
    stage: OpportunityStage;
  } | null>(null);

  // ── Archive undo state ────────────────────────────────────────────────
  const [archiveUndoState, setArchiveUndoState] = useState<{
    id: string;
    timer: NodeJS.Timeout;
  } | null>(null);

  // ── Track screen view ─────────────────────────────────────────────────
  useEffect(() => {
    trackScreenView("pipeline");
  }, []);

  // ── Handle ?action=new from FAB navigation ────────────────────────────
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("action") === "new") {
      openWindow({ id: "create-lead", title: "New Lead", type: "create-lead" });
    }
  }, [searchParams, openWindow]);

  // ── Auth ──────────────────────────────────────────────────────────────
  const { company, currentUser } = useAuthStore();
  const can = usePermissionStore((s) => s.can);

  // ── Setup gate ────────────────────────────────────────────────────────
  const { isComplete: setupComplete, missingSteps } = useSetupGate();
  const [showSetupModal, setShowSetupModal] = useState(false);

  const gatedOpenCreate = useCallback(() => {
    if (!setupComplete) {
      setShowSetupModal(true);
      return;
    }
    openWindow({ id: "create-lead", title: "New Lead", type: "create-lead" });
  }, [setupComplete, openWindow]);

  // ── Metrics header data ────────────────────────────────────────────
  const { data: pipelineMetrics = [], isLoading: pipelineMetricsLoading } = usePipelineMetrics();

  // ── Data fetching ─────────────────────────────────────────────────────
  const { data: opportunities, isLoading: oppsLoading } = useOpportunities();
  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: teamData } = useTeamMembers();
  const { data: gmailConnections = [] } = useGmailConnections();

  const { data: reviewCount = 0 } = useQuery({
    queryKey: ["emailReviewCount", company?.id],
    queryFn: async () => {
      const resp = await fetch(
        `/api/integrations/gmail/review-items?companyId=${encodeURIComponent(company!.id)}`
      );
      if (!resp.ok) return 0;
      const json = (await resp.json()) as { ok: boolean; items: unknown[] };
      return Array.isArray(json.items) ? json.items.length : 0;
    },
    enabled: !!company?.id,
    refetchInterval: 30000,
  });

  const isLoading = oppsLoading || clientsLoading;

  // ── Mutations ─────────────────────────────────────────────────────────
  const moveStage = useMoveOpportunityStage();
  const updateOpportunity = useUpdateOpportunity();
  const createOpportunity = useCreateOpportunity();
  const createActivity = useCreateActivity();
  const archiveMutation = useArchiveOpportunity();
  const unarchiveMutation = useUnarchiveOpportunity();
  const deleteMutation = useDeleteOpportunity();

  // ── Client name map ───────────────────────────────────────────────────
  const clientNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (clientsData?.clients) {
      for (const client of clientsData.clients) {
        map.set(client.id, client.name);
      }
    }
    return map;
  }, [clientsData]);

  // ── Team members for filter dropdown ──────────────────────────────────
  const teamMembers = useMemo(() => {
    if (!teamData?.users) return [];
    return teamData.users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
    }));
  }, [teamData]);

  // ── Active (non-deleted, non-archived) opportunities ──────────────────
  const activeOpportunities = useMemo(() => {
    if (!opportunities) return [];
    return opportunities.filter(
      (o) => !o.deletedAt && !o.archivedAt
    );
  }, [opportunities]);

  // ── Filtered opportunities ────────────────────────────────────────────
  const filteredOpportunities = useMemo(() => {
    let result = activeOpportunities;

    // Stage filter
    if (stageFilter !== "all") {
      result = result.filter((o) => o.stage === stageFilter);
    }

    // Assignee filter
    if (assigneeFilter !== "all") {
      result = result.filter((o) => o.assignedTo === assigneeFilter);
    }

    // Search query
    const query = searchQuery.toLowerCase().trim();
    if (query) {
      result = result.filter((opp) => {
        const clientName = opp.clientId
          ? (clientNameMap.get(opp.clientId) ?? "")
          : "";
        const contactName = opp.contactName ?? "";
        const title = opp.title ?? "";
        return (
          clientName.toLowerCase().includes(query) ||
          contactName.toLowerCase().includes(query) ||
          title.toLowerCase().includes(query)
        );
      });
    }

    return result;
  }, [activeOpportunities, stageFilter, assigneeFilter, searchQuery, clientNameMap]);

  // ── Board opportunities (active stages only — Won/Lost live in metrics bar)
  const boardOpportunities = useMemo(() => {
    return filteredOpportunities.filter((o) => isActiveStage(o.stage));
  }, [filteredOpportunities]);

  // ── Card positions map for tether overlay ──────────────────────────────
  const sortBy = useSpatialCanvasStore((s) => s.sortBy);
  const stageSortOverrides = useSpatialCanvasStore((s) => s.stageSortOverrides);
  const parentLayout = useMemo(
    () => calculateCanvasLayout(filteredOpportunities, sortBy, clientNameMap, stageSortOverrides),
    [filteredOpportunities, sortBy, clientNameMap, stageSortOverrides]
  );
  const cardPositionsMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const allPositions = [
      ...parentLayout.stacks.flatMap((s) => s.cardPositions),
      ...parentLayout.terminalRegions.flatMap((r) => r.cardPositions),
    ];
    for (const pos of allPositions) {
      map.set(pos.opportunityId, { x: pos.x, y: pos.y });
    }
    return map;
  }, [parentLayout]);

  // ── Close orphaned popovers when opportunities are deleted ───────────
  const popoverCount = useDetailPopoverStore((s) => s.popovers.size);

  useEffect(() => {
    if (!opportunities || popoverCount === 0) return;
    const { popovers, closePopover: close } = useDetailPopoverStore.getState();
    const oppIds = new Set(opportunities.map((o) => o.id));
    for (const id of popovers.keys()) {
      if (!oppIds.has(id)) {
        close(id);
      }
    }
  }, [opportunities, popoverCount]);

  // ── Handlers ──────────────────────────────────────────────────────────

  /** Toggle card expand — only one at a time */
  const handleToggleExpand = useCallback((id: string) => {
    setExpandedCardId((prev) => (prev === id ? null : id));
  }, []);

  /** One-tap call logging */
  const handleLogCall = useCallback(
    (opportunityId: string) => {
      createActivity.mutate({
        companyId: company?.id ?? "",
        opportunityId,
        clientId: null,
        estimateId: null,
        invoiceId: null,
        type: ActivityType.Call,
        subject: "Phone call",
        content: null,
        outcome: null,
        direction: "outbound",
        durationMinutes: null,
        createdBy: currentUser?.id ?? null,
      });
      toast.success(t("card.callLogged"));
    },
    [createActivity, company?.id, currentUser?.id, t]
  );

  /** One-tap text logging */
  const handleLogText = useCallback(
    (opportunityId: string) => {
      createActivity.mutate({
        companyId: company?.id ?? "",
        opportunityId,
        clientId: null,
        estimateId: null,
        invoiceId: null,
        type: ActivityType.TextMessage,
        subject: "Text message",
        content: null,
        outcome: null,
        direction: "outbound",
        durationMinutes: null,
        createdBy: currentUser?.id ?? null,
      });
      toast.success(t("card.textLogged"));
    },
    [createActivity, company?.id, currentUser?.id, t]
  );

  /** Add note to an opportunity */
  const handleAddNote = useCallback(
    (opportunityId: string, note: string) => {
      createActivity.mutate({
        companyId: company?.id ?? "",
        opportunityId,
        clientId: null,
        estimateId: null,
        invoiceId: null,
        type: ActivityType.Note,
        subject: t("detail.noteSubject"),
        content: note,
        outcome: null,
        direction: null,
        durationMinutes: null,
        createdBy: currentUser?.id ?? null,
      });
      toast.success(t("card.noteAdded"));
    },
    [createActivity, company?.id, currentUser?.id, t]
  );

  /** Archive with undo */
  const handleArchive = useCallback(
    (opportunityId: string) => {
      archiveMutation.mutate(opportunityId);
      // Clear any existing undo timer
      if (archiveUndoState?.timer) clearTimeout(archiveUndoState.timer);
      const timer = setTimeout(() => setArchiveUndoState(null), 5000);
      setArchiveUndoState({ id: opportunityId, timer });
    },
    [archiveMutation, archiveUndoState]
  );

  /** Undo archive */
  const handleUndoArchive = useCallback(() => {
    if (archiveUndoState) {
      clearTimeout(archiveUndoState.timer);
      unarchiveMutation.mutate(archiveUndoState.id);
      setArchiveUndoState(null);
    }
  }, [archiveUndoState, unarchiveMutation]);

  /** Handle stage move from drag-and-drop or advance button */
  const handleMoveStage = useCallback(
    (id: string, newStage: OpportunityStage) => {
      if (!can("pipeline.manage")) return;
      const opp = activeOpportunities.find((o) => o.id === id);
      if (!opp) return;

      // Won / Lost need confirmation dialogs
      if (newStage === OpportunityStage.Won) {
        setTransitionOpportunity(opp);
        setTransitionType("won");
        setPendingStageMove({ id, stage: newStage });
        return;
      }

      if (newStage === OpportunityStage.Lost) {
        setTransitionOpportunity(opp);
        setTransitionType("lost");
        setPendingStageMove({ id, stage: newStage });
        return;
      }

      // Normal stage move
      moveStage.mutate(
        { id, stage: newStage, userId: currentUser?.id },
        {
          onSuccess: () => {
            toast.success(
              `${t("toast.movedTo")} ${getStageDisplayName(newStage)}`,
              { description: opp.title }
            );
          },
          onError: (error) => {
            toast.error(t("toast.failedMove"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("toast.errorOccurred"),
            });
          },
        }
      );
    },
    [activeOpportunities, moveStage, currentUser, can, t]
  );

  /** Mark won — opens transition dialog */
  const handleMarkWon = useCallback(
    (opportunity: Opportunity) => {
      handleMoveStage(opportunity.id, OpportunityStage.Won);
    },
    [handleMoveStage]
  );

  /** Mark lost — opens transition dialog */
  const handleMarkLost = useCallback(
    (opportunity: Opportunity) => {
      handleMoveStage(opportunity.id, OpportunityStage.Lost);
    },
    [handleMoveStage]
  );

  /** Discard — direct stage move, no confirmation dialog needed */
  const handleDiscard = useCallback(
    (opportunityId: string) => {
      handleMoveStage(opportunityId, OpportunityStage.Discarded);
    },
    [handleMoveStage]
  );

  /** Confirm Won/Lost transition */
  const handleTransitionConfirm = useCallback(
    (data: {
      actualValue?: number;
      lostReason?: string;
      lostNotes?: string;
    }) => {
      if (!can("pipeline.manage")) return;
      if (!pendingStageMove || !transitionOpportunity) return;

      const { id, stage } = pendingStageMove;

      moveStage.mutate(
        { id, stage, userId: currentUser?.id },
        {
          onSuccess: () => {
            const updateData: Record<string, unknown> = {};
            if (data.actualValue !== undefined) {
              updateData.actualValue = data.actualValue;
            }
            if (data.lostReason) {
              updateData.lostReason = data.lostReason;
            }
            if (data.lostNotes) {
              updateData.lostNotes = data.lostNotes;
            }

            if (Object.keys(updateData).length > 0) {
              updateOpportunity.mutate({ id, data: updateData });
            }

            const toastMsg =
              stage === OpportunityStage.Won
                ? t("toast.dealMarkedWon")
                : t("toast.dealMarkedLost");
            toast.success(toastMsg, {
              description: transitionOpportunity.title,
            });
          },
          onError: (error) => {
            toast.error(t("toast.failedUpdate"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("toast.errorOccurred"),
            });
          },
        }
      );

      setTransitionType(null);
      setTransitionOpportunity(null);
      setPendingStageMove(null);
    },
    [
      pendingStageMove,
      transitionOpportunity,
      moveStage,
      updateOpportunity,
      currentUser,
      can,
      t,
    ]
  );

  /** Cancel Won/Lost transition */
  const handleTransitionCancel = useCallback(() => {
    setTransitionType(null);
    setTransitionOpportunity(null);
    setPendingStageMove(null);
  }, []);

  /** Open detail popover for an opportunity */
  const handleOpenDetail = useCallback((opp: Opportunity) => {
    // Collapse the inline card expansion before opening the popover
    const { expandedCardIds, toggleCardExpanded } = useSpatialCanvasStore.getState();
    if (expandedCardIds.has(opp.id)) {
      toggleCardExpanded(opp.id);
    }

    // Get card position for popover placement (read BEFORE collapse animation)
    const cardEl = document.querySelector(`[data-spatial-card][data-opportunity-id="${opp.id}"]`);
    const rect = cardEl?.getBoundingClientRect();
    const screenPos = rect
      ? { x: rect.right + 20, y: rect.top }
      : { x: globalThis.innerWidth / 2 - 190, y: 100 };
    const stageColor = OPPORTUNITY_STAGE_COLORS[opp.stage] ?? "#BCBCBC";
    openPopover(opp.id, screenPos, opp.title, stageColor);
  }, [openPopover]);

  /** Handle quick advance: move to next stage */
  const handleAdvanceStage = useCallback(
    (opportunity: Opportunity) => {
      const next = nextOpportunityStage(opportunity.stage);
      if (!next) return;
      handleMoveStage(opportunity.id, next);
    },
    [handleMoveStage]
  );

  /** Create lead from email — shared between inbox and review panel */
  const createLeadFromEmail = useCallback(
    (prefill: { title: string; notes?: string; sourceEmail?: string }) => {
      if (!company) return;
      createOpportunity.mutate(
        {
          companyId: company.id,
          clientId: null,
          title: prefill.title,
          description: prefill.notes || null,
          contactName: null,
          contactEmail: prefill.sourceEmail || null,
          contactPhone: null,
          stage: OpportunityStage.NewLead,
          source: OpportunitySource.Email,
          assignedTo: currentUser?.id ?? null,
          priority: null,
          estimatedValue: null,
          actualValue: null,
          winProbability: 10,
          expectedCloseDate: null,
          actualCloseDate: null,
          projectId: null,
          lostReason: null,
          lostNotes: null,
          quoteDeliveryMethod: null,
          address: null,
          tags: [],
        },
        {
          onSuccess: () => {
            toast.success(t("toast.leadFromEmail"), {
              description: prefill.title,
            });
          },
        }
      );
    },
    [company, currentUser, createOpportunity, t]
  );

  /** Placeholder: assign (opens detail popover) */
  const handleAssign = useCallback(
    (opportunityId: string) => {
      const opp = activeOpportunities.find((o) => o.id === opportunityId);
      if (opp) handleOpenDetail(opp);
    },
    [activeOpportunities, handleOpenDetail]
  );

  /** Placeholder: schedule follow-up (opens detail popover) */
  const handleScheduleFollowUp = useCallback(
    (opportunityId: string) => {
      const opp = activeOpportunities.find((o) => o.id === opportunityId);
      if (opp) handleOpenDetail(opp);
    },
    [activeOpportunities, handleOpenDetail]
  );

  // ── Loading state ─────────────────────────────────────────────────────
  if (isLoading) {
    return <PipelineSkeleton />;
  }

  const canManage = can("pipeline.manage");

  // ── Shared board/mobile props ─────────────────────────────────────────
  const sharedBoardProps = {
    opportunities: boardOpportunities,
    clients: clientNameMap,
    expandedCardId,
    onToggleExpand: handleToggleExpand,
    onMoveStage: handleMoveStage,
    onLogCall: handleLogCall,
    onLogText: handleLogText,
    onAddNote: handleAddNote,
    onArchive: handleArchive,
    onDiscard: handleDiscard,
    onMarkWon: handleMarkWon,
    onMarkLost: handleMarkLost,
    onOpenDetail: handleOpenDetail,
    onAssign: handleAssign,
    onScheduleFollowUp: handleScheduleFollowUp,
    onAddLead: gatedOpenCreate,
    canManage,
  } as const;

  return (
    <div className="relative h-[calc(100vh-56px)] -m-3 min-w-0">
      {/* Floating metrics bar — frosted glass overlay */}
      <div className="absolute top-0 left-0 right-0 z-[100] pointer-events-none">
        <div
          className="pointer-events-auto"
          style={{
            background: "rgba(10, 10, 10, 0.70)",
            backdropFilter: "blur(20px) saturate(1.2)",
            WebkitBackdropFilter: "blur(20px) saturate(1.2)",
          }}
        >
          <MetricsHeader variant="full" tabId="pipeline" title="Pipeline" metrics={pipelineMetrics} isLoading={pipelineMetricsLoading} />
          {/* Toolbar — left-aligned below metrics, inside frosted glass */}
          <div className="inline-flex w-fit mx-3 my-1.5 py-[2px] rounded-[4px] border border-[rgba(255,255,255,0.08)]">
            <SpatialFloatingToolbar
              onAddLead={gatedOpenCreate}
              reviewCount={reviewCount}
              onReviewEmails={() => setReviewPanelOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* Floating notifications/banners — stacked below metrics */}
      <div className="absolute top-[72px] left-0 right-0 z-[90] pointer-events-none flex flex-col gap-1 px-2">
        {/* Gmail connect prompt */}
        {gmailConnections.length === 0 && !gmailBannerDismissed && (
          <div className="pointer-events-auto flex items-center gap-2 px-2 py-1.5 rounded-[4px] bg-[rgba(65,115,148,0.08)] border border-[rgba(89,119,148,0.2)] animate-fade-in">
            <div className="w-[32px] h-[32px] rounded bg-[rgba(89,119,148,0.15)] flex items-center justify-center shrink-0">
              <Mail className="w-[16px] h-[16px] text-[#597794]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-mohave text-body text-text-primary">
                {t("gmail.connectBanner")}
              </p>
              <p className="font-kosugi text-[11px] text-text-disabled">
                {t("gmail.connectDesc")}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                className="gap-[6px]"
                onClick={() => {
                  const params = new URLSearchParams({
                    companyId: company?.id ?? "",
                    type: "company",
                  });
                  window.location.href = `/api/integrations/gmail?${params}`;
                }}
              >
                <Mail className="w-[14px] h-[14px]" />
                {t("gmail.connect")}
              </Button>
              <button
                onClick={() => setGmailBannerDismissed(true)}
                className="p-[6px] text-text-disabled hover:text-text-tertiary transition-colors"
                title={t("gmail.dismiss")}
              >
                <X className="w-[14px] h-[14px]" />
              </button>
            </div>
          </div>
        )}

        {/* Inbox leads */}
        {showInboxLeads && (
          <div className="pointer-events-auto">
            <InboxLeadsQueue
              onCreateLead={(prefill) => {
                setShowInboxLeads(false);
                createLeadFromEmail(prefill);
              }}
              className="max-w-[600px]"
            />
          </div>
        )}

        {/* Mutation loading indicator */}
        {moveStage.isPending && (
          <div className="pointer-events-auto flex items-center gap-1.5 px-2 py-1 rounded-[4px] bg-[rgba(89,119,148,0.12)] border border-[rgba(89,119,148,0.25)]">
            <Loader2 className="w-[14px] h-[14px] text-[#597794] animate-spin" />
            <span className="font-kosugi text-[11px] text-[#597794]">
              {t("column.updating")}
            </span>
          </div>
        )}
      </div>

      {/* Full-bleed canvas */}
      <div className="absolute inset-0">
        {isMobile ? (
          <PipelineMobile {...sharedBoardProps} />
        ) : (
          <SpatialCanvasDesktop
            opportunities={filteredOpportunities}
            clientNameMap={clientNameMap}
            canManage={canManage}
            onMoveStage={handleMoveStage}
            onLogCall={handleLogCall}
            onLogText={handleLogText}
            onAddNote={handleAddNote}
            onArchive={handleArchive}
            onDiscard={handleDiscard}
            onMarkWon={handleMarkWon}
            onMarkLost={handleMarkLost}
            onOpenDetail={handleOpenDetail}
            onAssign={handleAssign}
            onScheduleFollowUp={handleScheduleFollowUp}
            onAddLead={gatedOpenCreate}
            archivedOpportunities={
              opportunities?.filter((o) => !!o.archivedAt) ?? []
            }
            onRestore={(id) => unarchiveMutation.mutate(id)}
            onDeletePermanently={(id) => deleteMutation.mutate(id)}
          />
        )}
      </div>

      {/* Detail Popover Tether Lines */}
      <DetailPopoverTether cardPositions={cardPositionsMap} />

      {/* Detail Popovers */}
      <AnimatePresence>
        {Array.from(popoversMap.entries()).map(([oppId, popoverState]) => {
          const opp = opportunities?.find((o) => o.id === oppId);
          if (!opp) return null;
          return (
            <DetailPopover
              key={oppId}
              popoverState={popoverState}
              opportunity={opp}
              canManage={canManage}
              onAdvanceStage={() => handleAdvanceStage(opp)}
              onMarkWon={() => handleMoveStage(opp.id, OpportunityStage.Won)}
              onMarkLost={() => handleMoveStage(opp.id, OpportunityStage.Lost)}
              onArchive={() => handleArchive(opp.id)}
              onDelete={() => deleteMutation.mutate(opp.id)}
            />
          );
        })}
      </AnimatePresence>

      {/* Stage Transition Dialog (Won/Lost prompts) */}
      <StageTransitionDialog
        type={transitionType}
        opportunity={transitionOpportunity}
        onConfirm={handleTransitionConfirm}
        onCancel={handleTransitionCancel}
      />

      {/* Email Review Panel */}
      <EmailReviewPanel
        open={reviewPanelOpen}
        onClose={() => setReviewPanelOpen(false)}
        onViewClient={(clientId) => {
          setReviewPanelOpen(false);
          router.push(`/clients/${clientId}`);
        }}
        onCreateLead={(prefill) => {
          setReviewPanelOpen(false);
          createLeadFromEmail(prefill);
        }}
      />

      {/* Setup interception modal */}
      <SetupInterceptionModal
        isOpen={showSetupModal}
        onComplete={() => {
          setShowSetupModal(false);
          openWindow({ id: "create-lead", title: "New Lead", type: "create-lead" });
        }}
        onDismiss={() => {
          setShowSetupModal(false);
        }}
        missingSteps={missingSteps}
        triggerAction="leads"
      />

      {/* Archive undo toast */}
      <AnimatePresence>
        {archiveUndoState && (
          <motion.div
            variants={toastVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)_saturate(1.2)] border border-[rgba(255,255,255,0.08)] rounded-[4px] px-3 py-2 flex items-center gap-2"
          >
            <span className="font-mohave text-body-sm text-text-secondary">
              {t("actions.archived")}
            </span>
            <span className="text-[rgba(255,255,255,0.12)]">|</span>
            <button
              onClick={handleUndoArchive}
              className="font-mohave text-body-sm text-[#597794] hover:text-[#6d8fad] transition-colors cursor-pointer"
            >
              {t("actions.undoArchive")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
