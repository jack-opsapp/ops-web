"use client";

import { useState, useCallback, useMemo, useEffect, useRef, memo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Mail, X, Loader2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { trackScreenView } from "@/lib/analytics/analytics";
import { useUndoStore } from "@/stores/undo-store";
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
  formatCurrency,
  isActiveStage,
  nextOpportunityStage,
  previousOpportunityStage,
  PIPELINE_STAGES_DEFAULT,
} from "@/lib/types/pipeline";
// motion variants removed — archive undo toast replaced by universal undo

import type {
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
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
import { SpatialArchiveTray, SpatialDiscardTray } from "./_components/spatial-archive-tray";
import { calculateCanvasLayout } from "./_components/spatial-layout-engine";
import { calculateBatchStaleness } from "./_components/spatial-staleness";
import { PipelineDndProvider } from "./_components/pipeline-dnd-provider";
import { PipelineFocusedShell } from "./_components/pipeline-focused-shell";
import { PipelineFocusedToolbar } from "./_components/pipeline-focused-toolbar";
import { PipelineFilterRow } from "./_components/pipeline-filter-row";
import {
  useSpatialCanvasStore,
  BIRD_EYE_THRESHOLD,
  CARD_WIDTH,
  CARD_HEIGHT,
} from "./_components/spatial-canvas-store";
import { usePipelineModeStore } from "./_components/pipeline-mode-store";
import { OPPORTUNITY_STAGE_COLORS } from "@/lib/types/pipeline";

// ---------------------------------------------------------------------------
// SpatialCardWrapper — reads reactive store state per-card for efficient re-renders
// ---------------------------------------------------------------------------
const SpatialCardWrapperComponent = memo(function SpatialCardWrapperComponent({
  opportunity,
  position,
  draggable,
  flow,
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
  flow?: boolean;
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
  const stageColor = OPPORTUNITY_STAGE_COLORS[opportunity.stage] ?? "#8F9AA3";
  const stalenessOpacity = stalenessMap.get(opportunity.id) ?? 1.0;
  const cb = callbacksRef.current;

  return (
    <div
      data-spatial-card
      data-opportunity-id={opportunity.id}
      className={flow ? "relative" : "absolute"}
      style={{
        ...(flow
          ? { width: CARD_WIDTH }
          : {
              left: effectivePosition.x,
              top: effectivePosition.y,
              width: CARD_WIDTH,
              transition: "left 0.3s cubic-bezier(0.22, 1, 0.36, 1), top 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
            }),
        zIndex: isExpanded ? 20 : isHovered ? 10 : 1,
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
  archivedOpportunities,
  discardedOpportunities,
  onRestore,
  onDeletePermanently,
  activeDragId,
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
  archivedOpportunities: Opportunity[];
  discardedOpportunities: Opportunity[];
  onRestore: (id: string) => void;
  onDeletePermanently: (id: string) => void;
  activeDragId: string | null;
}) {
  const { t: tPipeline } = useDictionary("pipeline");
  const sortBy = usePipelineModeStore((s) => s.sortBy);
  const stageSortOverrides = usePipelineModeStore((s) => s.stageSortOverrides);
  const selectedCardIds = useSpatialCanvasStore((s) => s.selectedCardIds);
  const showContextMenu = useSpatialCanvasStore((s) => s.showContextMenu);
  const selectCards = useSpatialCanvasStore((s) => s.selectCards);
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

  const activeOpportunity = activeDragId
    ? opportunities.find((o) => o.id === activeDragId) ?? null
    : null;

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

      let hitStage: OpportunityStage | null = null;

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
  const computeMarqueeSelection = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const { customPositions } = useSpatialCanvasStore.getState();
      const allPositions = [
        ...layout.stacks.flatMap((s) => s.cardPositions),
        ...layout.terminalRegions.flatMap((r) => r.cardPositions),
      ];
      return allPositions
        .filter((pos) => {
          const effective = customPositions.get(pos.opportunityId) ?? pos;
          return isCardInMarquee(effective.x, effective.y, CARD_WIDTH, CARD_HEIGHT, start, end);
        })
        .map((pos) => pos.opportunityId);
    },
    [layout]
  );

  const handleMarqueeUpdate = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const selected = computeMarqueeSelection(start, end);
      selectCards(selected);
    },
    [computeMarqueeSelection, selectCards]
  );

  const handleMarqueeEnd = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const selected = computeMarqueeSelection(start, end);
      if (selected.length > 0) {
        selectCards(selected);
      }
    },
    [computeMarqueeSelection, selectCards]
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
    (opportunity: Opportunity, position: { x: number; y: number }, draggable = true, flow = false) => (
      <SpatialCardWrapperComponent
        key={opportunity.id}
        opportunity={opportunity}
        position={position}
        draggable={draggable}
        flow={flow}
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

  const batchCount = activeDragId && selectedCardIds.has(activeDragId)
    ? selectedCardIds.size
    : 1;

  return (
    <div className="relative h-full w-full">
      <SpatialCanvas
        canvasWidth={layout.canvasWidth}
        canvasHeight={layout.canvasHeight}
        onCanvasContextMenu={handleCanvasContextMenu}
        onMarqueeUpdate={handleMarqueeUpdate}
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
            activeId={activeDragId}
            renderCard={(opp, pos, draggable, flow) => renderCard(opp, pos, draggable, flow)}
          />
        ))}

        {/* Terminal regions (Won/Lost) */}
        {layout.terminalRegions.map((regionLayout) => (
          <SpatialTerminalRegion
            key={regionLayout.stage}
            stage={regionLayout.stage as OpportunityStage.Won | OpportunityStage.Lost}
            opportunities={oppsByStage.get(regionLayout.stage) ?? []}
            layout={regionLayout}
            isBirdEye={isBirdEye}
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

      {/* Discard tray */}
      <SpatialDiscardTray
        discardedOpportunities={discardedOpportunities}
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
          <p className="font-mono text-caption-sm text-text-3">
            {t("loading")}
          </p>
        </div>

        {/* Metrics skeleton */}
        <div className="bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)] border border-[rgba(255,255,255,0.06)] rounded-[4px]">
          <div className="flex items-center gap-[16px] px-3 py-[8px]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[2px]">
                <div className="h-[18px] w-[60px] bg-fill-neutral-dim rounded animate-pulse" />
                <div className="h-[10px] w-[40px] bg-fill-neutral-dim rounded animate-pulse" />
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
                className="border-t-2 rounded-t-sm px-1.5 py-1 bg-glass glass-surface border border-border border-b-0"
                style={{ borderTopColor: stage.color }}
              >
                <div className="flex items-center gap-1">
                  <h3
                    className="font-cakemono text-body font-light uppercase tracking-wider"
                    style={{ color: stage.color }}
                  >
                    {stage.name}
                  </h3>
                  <span className="font-mono text-[11px] text-text-mute bg-fill-neutral-dim px-[6px] py-[2px] rounded-sm">
                    --
                  </span>
                </div>
              </div>
              <div className="flex-1 border border-border border-t-0 rounded-b p-1 space-y-1 min-h-[200px] bg-[rgba(10,10,10,0.5)]">
                {[1, 2].map((j) => (
                  <div
                    key={j}
                    className="bg-glass glass-surface border border-[rgba(255,255,255,0.2)] rounded-[5px] p-1.5 space-y-1.5 animate-pulse"
                  >
                    <div className="h-[14px] w-3/4 bg-fill-neutral-dim rounded" />
                    <div className="h-[10px] w-1/2 bg-fill-neutral-dim rounded" />
                    <div className="h-[10px] w-1/3 bg-fill-neutral-dim rounded" />
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
  const mode = usePipelineModeStore((state) => state.mode);
  const detailPanelOpportunityId = usePipelineModeStore(
    (state) => state.detailPanelOpportunityId
  );
  const closeDetailPanel = usePipelineModeStore(
    (state) => state.closeDetailPanel
  );
  const previousModeRef = useRef(mode);

  // ── Filter / search state ─────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<OpportunityStage | "all">(
    "all"
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string | "all">("all");
  const filtersActive =
    searchQuery.trim().length > 0 ||
    stageFilter !== "all" ||
    assigneeFilter !== "all";

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setStageFilter("all");
    setAssigneeFilter("all");
  }, []);

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
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // ── Undo store ────────────────────────────────────────────────────────
  const pushUndo = useUndoStore((s) => s.pushUndo);

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

  const detailPanelOpportunity = useMemo(() => {
    if (!detailPanelOpportunityId) return null;
    return (
      filteredOpportunities.find(
        (opportunity) => opportunity.id === detailPanelOpportunityId
      ) ?? null
    );
  }, [detailPanelOpportunityId, filteredOpportunities]);

  useEffect(() => {
    if (detailPanelOpportunityId && !detailPanelOpportunity) {
      closeDetailPanel();
    }
  }, [closeDetailPanel, detailPanelOpportunity, detailPanelOpportunityId]);

  useEffect(() => {
    if (previousModeRef.current !== mode) {
      if (detailPanelOpportunityId) closeDetailPanel();
      previousModeRef.current = mode;
    }
  }, [closeDetailPanel, detailPanelOpportunityId, mode]);

  // ── Board opportunities (active stages only — Won/Lost live in metrics bar)
  const boardOpportunities = useMemo(() => {
    return filteredOpportunities.filter((o) => isActiveStage(o.stage));
  }, [filteredOpportunities]);

  // ── Card positions map for tether overlay ──────────────────────────────
  const sortBy = usePipelineModeStore((s) => s.sortBy);
  const stageSortOverrides = usePipelineModeStore((s) => s.stageSortOverrides);
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
      const opp = activeOpportunities.find((o) => o.id === opportunityId);
      const label = (opp?.contactName ?? opp?.title ?? "Deal") + " → Archived";
      archiveMutation.mutate(opportunityId);
      pushUndo({
        label,
        inverseFn: async () => { await unarchiveMutation.mutateAsync(opportunityId); },
      });
    },
    [archiveMutation, unarchiveMutation, activeOpportunities, pushUndo]
  );

  /** Handle stage move from drag-and-drop or advance button */
  const handleMoveStage = useCallback(
    (id: string, newStage: OpportunityStage) => {
      if (!can("pipeline.manage")) return;
      const opp = activeOpportunities.find((o) => o.id === id);
      if (!opp) return;

      // No-op: card dropped back on its own stage
      if (opp.stage === newStage) return;

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
      const previousStage = opp.stage;
      const clientName = clientNameMap.get(opp.clientId ?? "") ?? opp.contactName ?? opp.title ?? "";
      moveStage.mutate(
        { id, stage: newStage, userId: currentUser?.id },
        {
          onSuccess: () => {
            const value = opp.estimatedValue ? formatCurrency(opp.estimatedValue) : "";
            const fromStage = getStageDisplayName(previousStage);
            const toStage = getStageDisplayName(newStage);
            toast.success(
              `${clientName}${value ? ` · ${value}` : ""}`,
              { description: `${fromStage} → ${toStage}` }
            );
            pushUndo({
              label: `${clientName} → ${toStage}`,
              inverseFn: async () => {
                await moveStage.mutateAsync({ id, stage: previousStage, userId: currentUser?.id });
              },
            });
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
    [activeOpportunities, moveStage, currentUser, can, t, clientNameMap, pushUndo]
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

  const handlePipelineDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      setActiveDragId(id);

      if (mode !== "spatial") return;

      const { selectedCardIds, startDrag, clearSelection } =
        useSpatialCanvasStore.getState();

      if (selectedCardIds.has(id)) {
        startDrag(Array.from(selectedCardIds), { x: 0, y: 0 });
      } else {
        clearSelection();
        startDrag([id], { x: 0, y: 0 });
      }
    },
    [mode]
  );

  const handlePipelineDragOver = useCallback(
    (_event: DragOverEvent) => undefined,
    []
  );

  const handlePipelineDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (mode !== "spatial") {
        setActiveDragId(null);
        useSpatialCanvasStore.getState().endDrag();
        return;
      }

      const { over } = event;
      const draggedId = String(event.active.id);
      const { selectedCardIds, clearSelection, endDrag } =
        useSpatialCanvasStore.getState();

      if (over) {
        const data = over.data.current as
          | { stage?: OpportunityStage; isTerminal?: boolean }
          | undefined;

        if (data?.stage) {
          const ids = selectedCardIds.has(draggedId)
            ? Array.from(selectedCardIds)
            : [draggedId];

          if (data.isTerminal) {
            for (const id of ids) {
              const opportunity = filteredOpportunities.find((o) => o.id === id);
              if (!opportunity) continue;

              if (data.stage === OpportunityStage.Won) {
                handleMarkWon(opportunity);
              } else if (data.stage === OpportunityStage.Lost) {
                handleMarkLost(opportunity);
              }
            }
          } else {
            for (const id of ids) {
              handleMoveStage(id, data.stage);
            }
          }

          clearSelection();
        }
      } else {
        const { setCustomPosition, customPositions, zoom } =
          useSpatialCanvasStore.getState();
        const draggedIds = selectedCardIds.has(draggedId)
          ? Array.from(selectedCardIds)
          : [draggedId];
        const { delta } = event;
        const allPositions = [
          ...parentLayout.stacks.flatMap((stack) => stack.cardPositions),
          ...parentLayout.terminalRegions.flatMap(
            (region) => region.cardPositions
          ),
        ];

        for (const id of draggedIds) {
          const currentPos = allPositions.find(
            (position) => position.opportunityId === id
          );
          const existingCustom = customPositions.get(id);
          const basePos =
            existingCustom ??
            (currentPos ? { x: currentPos.x, y: currentPos.y } : null);

          if (basePos) {
            setCustomPosition(id, {
              x: basePos.x + delta.x / zoom,
              y: basePos.y + delta.y / zoom,
            });
          }
        }
      }

      setActiveDragId(null);
      endDrag();
    },
    [
      filteredOpportunities,
      handleMarkLost,
      handleMarkWon,
      handleMoveStage,
      mode,
      parentLayout,
    ]
  );

  const handlePipelineDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      setActiveDragId(null);
      useSpatialCanvasStore.getState().endDrag();
    },
    []
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

      const previousStage = transitionOpportunity.stage;
      const clientName =
        clientNameMap.get(transitionOpportunity.clientId ?? "") ??
        transitionOpportunity.contactName ??
        transitionOpportunity.title ??
        "";
      const toStage = getStageDisplayName(stage);

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

            pushUndo({
              label: `${clientName} → ${toStage}`,
              inverseFn: async () => {
                await moveStage.mutateAsync({ id, stage: previousStage, userId: currentUser?.id });
              },
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
      clientNameMap,
      pushUndo,
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
    const stageColor = OPPORTUNITY_STAGE_COLORS[opp.stage] ?? "#8F9AA3";
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
          latitude: null,
          longitude: null,
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
    <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* ── Canvas — fills entire viewport, renders behind HUD ── */}
      <div className="absolute inset-0 overflow-hidden">
        {isMobile ? (
          <PipelineMobile {...sharedBoardProps} />
        ) : (
          <PipelineDndProvider
            mode={mode}
            activeDragId={activeDragId}
            onDragStart={handlePipelineDragStart}
            onDragOver={handlePipelineDragOver}
            onDragEnd={handlePipelineDragEnd}
            onDragCancel={handlePipelineDragCancel}
          >
            {mode === "focused" ? (
              <PipelineFocusedShell
                opportunities={filteredOpportunities}
                clientNameMap={clientNameMap}
                canManage={canManage}
                filtersActive={filtersActive}
                onAddLead={gatedOpenCreate}
                onClearFilters={handleClearFilters}
                onLogCall={handleLogCall}
                onLogText={handleLogText}
                onAddNote={handleAddNote}
                onArchive={handleArchive}
                onDiscard={handleDiscard}
                onMarkWon={handleMarkWon}
                onMarkLost={handleMarkLost}
                onAdvanceStage={handleAdvanceStage}
                onAssign={handleAssign}
                onScheduleFollowUp={handleScheduleFollowUp}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
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
                archivedOpportunities={
                  opportunities?.filter((o) => !!o.archivedAt) ?? []
                }
                discardedOpportunities={
                  opportunities?.filter((o) => o.stage === OpportunityStage.Discarded && !o.archivedAt) ?? []
                }
                onRestore={(id) => unarchiveMutation.mutate(id)}
                onDeletePermanently={(id) => deleteMutation.mutate(id)}
                activeDragId={activeDragId}
              />
            )}
          </PipelineDndProvider>
        )}
      </div>

      {/* ── Page HUD — metrics, toolbar, banners float on top of canvas ── */}
      <div className="absolute left-0 right-0 top-0 z-[2] pointer-events-none">
        <div className="pointer-events-auto">
          <MetricsHeader variant="full" tabId="pipeline" title="Pipeline" metrics={pipelineMetrics} isLoading={pipelineMetricsLoading} />
        </div>
        {mode !== "focused" && (
          <>
            <div className="pointer-events-auto px-3 py-1.5">
              <div className="inline-flex w-fit py-[2px] rounded-[4px] border border-[rgba(255,255,255,0.08)]"
                style={{
                  background: "rgba(10, 10, 10, 0.50)",
                  backdropFilter: "blur(12px) saturate(1.1)",
                  WebkitBackdropFilter: "blur(12px) saturate(1.1)",
                }}
              >
                <SpatialFloatingToolbar
                  onAddLead={gatedOpenCreate}
                  reviewCount={reviewCount}
                  onReviewEmails={() => setReviewPanelOpen(true)}
                />
              </div>
            </div>
            <div className="pointer-events-auto px-3 pb-1">
              <div className="inline-flex w-fit rounded-[4px] border border-[rgba(255,255,255,0.08)] bg-[rgba(10,10,10,0.50)] px-1.5 py-1 backdrop-blur-[12px] backdrop-saturate-[1.1]">
                <PipelineFilterRow
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  stageFilter={stageFilter}
                  onStageFilterChange={setStageFilter}
                  assigneeFilter={assigneeFilter}
                  onAssigneeFilterChange={setAssigneeFilter}
                  teamMembers={teamMembers}
                  onAddLead={gatedOpenCreate}
                  canManage={canManage}
                />
              </div>
            </div>
          </>
        )}
        {/* Banners */}
        <div className="pointer-events-auto flex flex-col gap-1 px-3">
          {gmailConnections.length === 0 && !gmailBannerDismissed && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-[4px] bg-[rgba(65,115,148,0.08)] border border-[rgba(111, 148, 176,0.2)] animate-fade-in">
              <div className="w-[32px] h-[32px] rounded bg-[rgba(111, 148, 176,0.15)] flex items-center justify-center shrink-0">
                <Mail className="w-[16px] h-[16px] text-[#6F94B0]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-mohave text-body text-text">
                  {t("gmail.connectBanner")}
                </p>
                <p className="font-mono text-[11px] text-text-mute">
                  {t("gmail.connectDesc")}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  className="gap-[6px]"
                  onClick={() => {
                    if (!currentUser?.id) {
                      console.error("[pipeline] No current user — cannot initiate OAuth");
                      return;
                    }
                    const params = new URLSearchParams({
                      companyId: company?.id ?? "",
                      userId: currentUser.id,
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
                  className="p-[6px] text-text-mute hover:text-text-3 transition-colors"
                  title={t("gmail.dismiss")}
                >
                  <X className="w-[14px] h-[14px]" />
                </button>
              </div>
            </div>
          )}
          {showInboxLeads && (
            <InboxLeadsQueue
              onCreateLead={(prefill) => {
                setShowInboxLeads(false);
                createLeadFromEmail(prefill);
              }}
              className="max-w-[600px]"
            />
          )}
          {moveStage.isPending && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-[4px] bg-[rgba(111, 148, 176,0.12)] border border-[rgba(111, 148, 176,0.25)]">
              <Loader2 className="w-[14px] h-[14px] text-[#6F94B0] animate-spin" />
              <span className="font-mono text-[11px] text-[#6F94B0]">
                {t("column.updating")}
              </span>
            </div>
          )}
        </div>
      </div>

      {!isMobile && mode === "focused" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] flex justify-center px-3">
          <div
            className="pointer-events-auto inline-flex max-w-full overflow-x-auto rounded-[4px] border border-[rgba(255,255,255,0.08)] py-[2px] scrollbar-hide"
            style={{
              background: "rgba(10, 10, 10, 0.50)",
              backdropFilter: "blur(12px) saturate(1.1)",
              WebkitBackdropFilter: "blur(12px) saturate(1.1)",
            }}
          >
            <PipelineFocusedToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              stageFilter={stageFilter}
              onStageFilterChange={setStageFilter}
              assigneeFilter={assigneeFilter}
              onAssigneeFilterChange={setAssigneeFilter}
              teamMembers={teamMembers}
              onAddLead={gatedOpenCreate}
              canManage={canManage}
              reviewCount={reviewCount}
              onReviewEmails={() => setReviewPanelOpen(true)}
            />
          </div>
        </div>
      )}

      {!isMobile && mode === "focused" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-10 bg-gradient-to-t from-background via-background/60 to-transparent" />
      )}

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

      {/* Archive undo toast removed — universal undo in TopBar */}
    </div>
  );
}
