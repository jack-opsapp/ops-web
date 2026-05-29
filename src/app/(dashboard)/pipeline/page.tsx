"use client";

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  memo,
  useLayoutEffect,
  type CSSProperties,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Mail, X, Loader2 } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
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
  useAttachClientToOpportunity,
  useCreateOpportunity,
  useCreateClient,
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
import {
  SpatialMarqueeSelect,
  getMarqueeSelectedOpportunityIds,
} from "./_components/spatial-marquee-select";
import { SpatialContextMenu } from "./_components/spatial-context-menu";
import { SpatialTerminalRegion } from "./_components/spatial-terminal-region";
import { SpatialFloatingToolbar } from "./_components/spatial-floating-toolbar";
import {
  SpatialArchiveTray,
  SpatialDiscardTray,
} from "./_components/spatial-archive-tray";
import { calculateCanvasLayout } from "./_components/spatial-layout-engine";
import { calculateBatchStaleness } from "./_components/spatial-staleness";
import { PipelineDndProvider } from "./_components/pipeline-dnd-provider";
import { PipelineDetailPanel } from "./_components/pipeline-detail-panel";
import { PipelineFocusedDragOverlay } from "./_components/pipeline-focused-drag-overlay";
import { PipelineFocusedShell } from "./_components/pipeline-focused-shell";
import { PipelineFocusedToolbar } from "./_components/pipeline-focused-toolbar";
import { PipelineFilterRow } from "./_components/pipeline-filter-row";
import { usePipelineModeShortcut } from "./_components/pipeline-mode-shortcuts";
import {
  resolvePipelineDragEnd,
  type PipelineDropData,
} from "./_components/pipeline-dnd-resolution";
import { PipelineCardContent } from "./_components/pipeline-card-content";
import {
  useSpatialCanvasStore,
  BIRD_EYE_THRESHOLD,
  CARD_WIDTH,
  CARD_HEIGHT,
} from "./_components/spatial-canvas-store";
import {
  PIPELINE_MODE_WILL_CHANGE_EVENT,
  usePipelineModeStore,
  type PipelineModeWillChangeDetail,
} from "./_components/pipeline-mode-store";
import type { PipelineMode } from "./_components/pipeline-mode-types";
import { OPPORTUNITY_STAGE_COLORS } from "@/lib/types/pipeline";

type PipelineModeTransitionRole = "static" | "entering";

type TransitionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PendingModeTransition = {
  id: number;
  from: PipelineMode;
  to: PipelineMode;
  sourceRects: Map<string, TransitionRect>;
  sourceClone: HTMLElement | null;
};

type TransitionCard = {
  opportunity: Opportunity;
  clientName: string;
  stageColor: string;
  stalenessOpacity: number;
  density: "compact" | "comfortable";
  isSilhouetteTarget: boolean;
  from: TransitionRect;
  to: TransitionRect;
};

type ModeTransitionState = PendingModeTransition & {
  cards: TransitionCard[];
  durationMs: number;
};

type TransitionCardStyle = CSSProperties & {
  "--pipeline-from-x": string;
  "--pipeline-from-y": string;
  "--pipeline-from-scale-x": number;
  "--pipeline-from-scale-y": number;
  "--pipeline-to-scale-x": number;
  "--pipeline-to-scale-y": number;
  "--pipeline-to-opacity": number;
};

const MODE_TRANSITION_DURATION_MS = 360;
const MODE_TRANSITION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

function formatPipelineTemplate(
  template: string,
  values: Record<string, string | number>
) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function transitionRectFromElement(element: Element): TransitionRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function fallbackRectFromStage(rect: TransitionRect): TransitionRect {
  const width = Math.max(10, Math.min(40, rect.width * 0.5));
  const height = 8;

  return {
    left: rect.left + rect.width / 2 - width / 2,
    top:
      rect.top +
      Math.min(Math.max(16, rect.height * 0.35), rect.height - height),
    width,
    height,
  };
}

function readModeTransitionRects(
  scope: HTMLElement | null,
  opportunities: Opportunity[]
): Map<string, TransitionRect> {
  const rects = new Map<string, TransitionRect>();
  if (!scope) return rects;

  scope
    .querySelectorAll<HTMLElement>(
      "[data-pipeline-transition-card][data-opportunity-id]"
    )
    .forEach((element) => {
      const opportunityId = element.dataset.opportunityId;
      if (!opportunityId) return;
      rects.set(opportunityId, transitionRectFromElement(element));
    });

  scope
    .querySelectorAll<HTMLElement>("[data-pipeline-spine-card-id]")
    .forEach((element) => {
      const opportunityId = element.dataset.pipelineSpineCardId;
      if (!opportunityId || rects.has(opportunityId)) return;
      rects.set(opportunityId, transitionRectFromElement(element));
    });

  const stageRects = new Map<OpportunityStage, TransitionRect>();
  scope
    .querySelectorAll<HTMLElement>("[data-pipeline-stage-fallback]")
    .forEach((element) => {
      const stage = element.dataset.pipelineStageFallback;
      if (!stage) return;
      stageRects.set(
        stage as OpportunityStage,
        transitionRectFromElement(element)
      );
    });

  for (const opportunity of opportunities) {
    if (rects.has(opportunity.id)) continue;
    const stageRect = stageRects.get(opportunity.stage);
    if (!stageRect) continue;
    rects.set(opportunity.id, fallbackRectFromStage(stageRect));
  }

  return rects;
}

function cloneModeSurface(
  scope: HTMLElement | null,
  mode: PipelineMode,
  durationMs: number
): HTMLElement | null {
  const surface = scope?.querySelector<HTMLElement>(
    `[data-pipeline-mode-surface="${mode}"]`
  );
  if (!surface) return null;

  const rect = surface.getBoundingClientRect();
  const clone = surface.cloneNode(true) as HTMLElement;

  clone.setAttribute("aria-hidden", "true");
  clone.querySelectorAll<HTMLElement>("[id]").forEach((element) => {
    element.removeAttribute("id");
  });
  clone
    .querySelectorAll<HTMLElement>("button,a,input,textarea,select,[tabindex]")
    .forEach((element) => {
      element.setAttribute("tabindex", "-1");
    });
  clone
    .querySelectorAll<HTMLElement>("[data-pipeline-transition-card]")
    .forEach((element) => {
      element.style.opacity = "0";
    });

  Object.assign(clone.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    pointerEvents: "none",
    opacity: "1",
    overflow: "hidden",
    zIndex: "1",
    transition: `opacity ${durationMs}ms ${MODE_TRANSITION_EASING}`,
  });

  return clone;
}

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
  const isSelected = useSpatialCanvasStore((s) =>
    s.selectedCardIds.has(opportunity.id)
  );
  const isExpanded = useSpatialCanvasStore((s) =>
    s.expandedCardIds.has(opportunity.id)
  );
  const isHovered = useSpatialCanvasStore(
    (s) => s.hoveredCardId === opportunity.id
  );
  const isBirdEye = useSpatialCanvasStore((s) => s.zoom < BIRD_EYE_THRESHOLD);
  const toggleCardExpanded = useSpatialCanvasStore((s) => s.toggleCardExpanded);
  const setHoveredCard = useSpatialCanvasStore((s) => s.setHoveredCard);
  const toggleCardSelected = useSpatialCanvasStore((s) => s.toggleCardSelected);

  const clientName =
    clientNameMap.get(opportunity.clientId ?? "") ??
    opportunity.contactName ??
    tUnknown;
  const stageColor =
    OPPORTUNITY_STAGE_COLORS[opportunity.stage] ??
    OPPORTUNITY_STAGE_COLORS[OpportunityStage.NewLead];
  const stalenessOpacity = stalenessMap.get(opportunity.id) ?? 1.0;
  const cb = callbacksRef.current;

  return (
    <div
      data-spatial-card
      data-pipeline-transition-card
      data-opportunity-id={opportunity.id}
      className={flow ? "relative" : "absolute"}
      style={{
        ...(flow
          ? { width: CARD_WIDTH }
          : {
              left: position.x,
              top: position.y,
              width: CARD_WIDTH,
              transition:
                "left 0.3s cubic-bezier(0.22, 1, 0.36, 1), top 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
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
  transitionRole = "static",
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
  transitionRole?: PipelineModeTransitionRole;
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
    () =>
      calculateCanvasLayout(
        opportunities,
        sortBy,
        clientNameMap,
        stageSortOverrides
      ),
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
    ? (opportunities.find((o) => o.id === activeDragId) ?? null)
    : null;

  // Context menu handlers
  const handleCardContextMenu = useCallback(
    (e: React.MouseEvent, id: string) => {
      const opp = opportunities.find((o) => o.id === id);
      showContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        type:
          selectedCardIds.size > 1 && selectedCardIds.has(id)
            ? "selection"
            : "card",
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
          if (
            canvasX >= b.x &&
            canvasX <= b.x + b.width &&
            canvasY >= b.y &&
            canvasY <= b.y + b.height
          ) {
            hitStage = stack.stage;
            break;
          }
        }

        // Check terminal regions if no active stage hit
        if (!hitStage) {
          for (const region of layout.terminalRegions) {
            const b = region.bounds;
            if (
              canvasX >= b.x &&
              canvasX <= b.x + b.width &&
              canvasY >= b.y &&
              canvasY <= b.y + b.height
            ) {
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

  // Marquee selection → compute which cards fall inside the rectangle.
  const computeMarqueeSelection = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const allPositions = [
        ...layout.stacks.flatMap((s) => s.cardPositions),
        ...layout.terminalRegions.flatMap((r) => r.cardPositions),
      ];
      return getMarqueeSelectedOpportunityIds(
        allPositions,
        CARD_WIDTH,
        CARD_HEIGHT,
        start,
        end
      );
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
    (
      opportunity: Opportunity,
      position: { x: number; y: number },
      draggable = true,
      flow = false
    ) => (
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

  const batchCount =
    activeDragId && selectedCardIds.has(activeDragId)
      ? selectedCardIds.size
      : 1;

  return (
    <div className="relative h-full w-full">
      <SpatialCanvas
        canvasWidth={layout.canvasWidth}
        canvasHeight={layout.canvasHeight}
        transitionRole={transitionRole}
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
            renderCard={(opp, pos, draggable, flow) =>
              renderCard(opp, pos, draggable, flow)
            }
          />
        ))}

        {/* Terminal regions (Won/Lost) */}
        {layout.terminalRegions.map((regionLayout) => (
          <SpatialTerminalRegion
            key={regionLayout.stage}
            stage={
              regionLayout.stage as OpportunityStage.Won | OpportunityStage.Lost
            }
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
            ? (clientNameMap.get(activeOpportunity.clientId ?? "") ??
              activeOpportunity.contactName ??
              tPipeline("card.unknown"))
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
        onMoveToStage={(ids, stage) =>
          ids.forEach((id) => onMoveStage(id, stage))
        }
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
            selectCards(
              opportunities.filter((o) => o.stage === stage).map((o) => o.id)
            );
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

function PipelineModeTransitionOverlay({
  transition,
  onComplete,
}: {
  transition: ModeTransitionState;
  onComplete: () => void;
}) {
  const cloneHostRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useLayoutEffect(() => {
    const cloneHost = cloneHostRef.current;
    const clone = transition.sourceClone;
    if (cloneHost && clone) {
      cloneHost.appendChild(clone);
      requestAnimationFrame(() => {
        clone.style.opacity = "0";
      });
    }

    const timeoutId = window.setTimeout(
      () => onCompleteRef.current(),
      transition.durationMs + 40
    );

    return () => {
      window.clearTimeout(timeoutId);
      clone?.remove();
    };
  }, [transition]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[1]">
      <style>{`
        @keyframes pipeline-mode-card-travel {
          from {
            opacity: 1;
            transform: translate3d(var(--pipeline-from-x), var(--pipeline-from-y), 0) scale(var(--pipeline-from-scale-x), var(--pipeline-from-scale-y));
          }
          to {
            opacity: var(--pipeline-to-opacity);
            transform: translate3d(0, 0, 0) scale(var(--pipeline-to-scale-x), var(--pipeline-to-scale-y));
          }
        }
        @keyframes pipeline-mode-surface-enter {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
      <div ref={cloneHostRef} />
      {transition.cards.map((card) => {
        const baseWidth = card.isSilhouetteTarget
          ? CARD_WIDTH
          : Math.max(1, card.to.width);
        const baseHeight = card.isSilhouetteTarget
          ? CARD_HEIGHT
          : Math.max(1, card.to.height);
        const style: TransitionCardStyle = {
          position: "fixed",
          left: card.to.left,
          top: card.to.top,
          width: baseWidth,
          minHeight: baseHeight,
          transformOrigin: "top left",
          animation: `pipeline-mode-card-travel ${transition.durationMs}ms ${MODE_TRANSITION_EASING} both`,
          zIndex: 2,
          "--pipeline-from-x": `${card.from.left - card.to.left}px`,
          "--pipeline-from-y": `${card.from.top - card.to.top}px`,
          "--pipeline-from-scale-x": card.from.width / baseWidth,
          "--pipeline-from-scale-y": card.from.height / baseHeight,
          "--pipeline-to-scale-x": card.to.width / baseWidth,
          "--pipeline-to-scale-y": card.to.height / baseHeight,
          "--pipeline-to-opacity": card.isSilhouetteTarget ? 0 : 1,
        };

        return (
          <div key={card.opportunity.id} style={style}>
            <PipelineCardContent
              opportunity={card.opportunity}
              clientName={card.clientName}
              stageColor={card.stageColor}
              stalenessOpacity={card.stalenessOpacity}
              density={card.density}
              canManage={false}
              isHovered={false}
              isExpanded={false}
            />
          </div>
        );
      })}
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
    <div className="flex h-full min-w-0 flex-col space-y-2">
      {/* Header skeleton */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <p className="font-mono text-caption-sm text-text-3">
            {t("loading")}
          </p>
        </div>

        {/* Metrics skeleton */}
        <div className="rounded-chip border border-border-subtle bg-fill-neutral-dim backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]">
          <div className="flex items-center gap-[16px] px-3 py-[8px]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[2px]">
                <div className="h-[18px] w-[60px] animate-pulse rounded bg-fill-neutral-dim" />
                <div className="h-[10px] w-[40px] animate-pulse rounded bg-fill-neutral-dim" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Board skeleton */}
      <div className="flex-1 overflow-x-auto pb-2">
        <div className="flex min-w-min gap-2">
          {stages.slice(0, 6).map((stage) => (
            <div key={stage.slug} className="flex w-[280px] shrink-0 flex-col">
              <div
                className="glass-surface rounded-t-sm border border-b-0 border-t-2 border-border bg-glass px-1.5 py-1"
                style={{ borderTopColor: stage.color }}
              >
                <div className="flex items-center gap-1">
                  <h3
                    className="font-cakemono text-body font-light uppercase tracking-wider"
                    style={{ color: stage.color }}
                  >
                    {stage.name}
                  </h3>
                  <span className="rounded-bar bg-fill-neutral-dim px-[6px] py-[2px] font-mono text-micro text-text-mute">
                    --
                  </span>
                </div>
              </div>
              <div className="min-h-[200px] flex-1 space-y-1 rounded-b border border-t-0 border-border bg-glass p-1">
                {[1, 2].map((j) => (
                  <div
                    key={j}
                    className="glass-surface animate-pulse space-y-1.5 rounded border border-border-medium bg-glass p-1.5"
                  >
                    <div className="h-[14px] w-3/4 rounded bg-fill-neutral-dim" />
                    <div className="h-[10px] w-1/2 rounded bg-fill-neutral-dim" />
                    <div className="h-[10px] w-1/3 rounded bg-fill-neutral-dim" />
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
  const reducedMotion = useReducedMotion();
  const mode = usePipelineModeStore((state) => state.mode);
  const detailPanelOpportunityId = usePipelineModeStore(
    (state) => state.detailPanelOpportunityId
  );
  const closeDetailPanel = usePipelineModeStore(
    (state) => state.closeDetailPanel
  );
  const previousModeRef = useRef(mode);
  const openedUrlOpportunityRef = useRef<string | null>(null);
  const pipelineScopeRef = useRef<HTMLDivElement>(null);
  const pendingModeTransitionRef = useRef<PendingModeTransition | null>(null);
  const transitionSequenceRef = useRef(0);
  const filteredOpportunitiesRef = useRef<Opportunity[]>([]);
  const isMobileRef = useRef(isMobile);
  const reducedMotionRef = useRef(Boolean(reducedMotion));
  const [modeTransition, setModeTransition] =
    useState<ModeTransitionState | null>(null);
  const [originatingOpportunityId, setOriginatingOpportunityId] = useState<
    string | null
  >(null);

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
  const [focusedDragAnnouncement, setFocusedDragAnnouncement] = useState("");
  usePipelineModeShortcut(activeDragId !== null, mode === "spatial");

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
  const { data: pipelineMetrics = [], isLoading: pipelineMetricsLoading } =
    usePipelineMetrics();

  // ── Data fetching ─────────────────────────────────────────────────────
  const {
    data: opportunities,
    isLoading: oppsLoading,
    isError: oppsError,
    error: opportunitiesError,
    refetch: refetchOpportunities,
  } = useOpportunities();
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
  const attachClient = useAttachClientToOpportunity();
  const createOpportunity = useCreateOpportunity();
  const createClientMutation = useCreateClient();
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
    return opportunities.filter((o) => !o.deletedAt && !o.archivedAt);
  }, [opportunities]);

  useEffect(() => {
    const opportunityId = searchParams.get("opportunityId");
    if (!opportunityId || openedUrlOpportunityRef.current === opportunityId) {
      return;
    }
    const target = activeOpportunities.find((opp) => opp.id === opportunityId);
    if (!target) return;

    openedUrlOpportunityRef.current = opportunityId;
    setSearchQuery("");
    setStageFilter("all");
    setAssigneeFilter("all");
    setOriginatingOpportunityId(opportunityId);
    usePipelineModeStore.getState().openDetailPanel(opportunityId);
  }, [activeOpportunities, searchParams]);

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
  }, [
    activeOpportunities,
    stageFilter,
    assigneeFilter,
    searchQuery,
    clientNameMap,
  ]);

  const transitionStalenessMap = useMemo(
    () => calculateBatchStaleness(filteredOpportunities),
    [filteredOpportunities]
  );

  useEffect(() => {
    filteredOpportunitiesRef.current = filteredOpportunities;
  }, [filteredOpportunities]);

  useEffect(() => {
    isMobileRef.current = isMobile;
    reducedMotionRef.current = Boolean(reducedMotion);
  }, [isMobile, reducedMotion]);

  useEffect(() => {
    function handleModeWillChange(event: Event) {
      const detail = (event as CustomEvent<PipelineModeWillChangeDetail>)
        .detail;
      if (!detail || detail.from === detail.to) return;
      if (isMobileRef.current || reducedMotionRef.current) {
        pendingModeTransitionRef.current = null;
        return;
      }

      const scope = pipelineScopeRef.current;
      const opportunitiesForSnapshot = filteredOpportunitiesRef.current;
      pendingModeTransitionRef.current = {
        id: transitionSequenceRef.current + 1,
        from: detail.from,
        to: detail.to,
        sourceRects: readModeTransitionRects(scope, opportunitiesForSnapshot),
        sourceClone: cloneModeSurface(
          scope,
          detail.from,
          MODE_TRANSITION_DURATION_MS
        ),
      };
      transitionSequenceRef.current += 1;
    }

    window.addEventListener(
      PIPELINE_MODE_WILL_CHANGE_EVENT,
      handleModeWillChange
    );
    return () =>
      window.removeEventListener(
        PIPELINE_MODE_WILL_CHANGE_EVENT,
        handleModeWillChange
      );
  }, []);

  useLayoutEffect(() => {
    const pending = pendingModeTransitionRef.current;
    if (!pending || pending.to !== mode) return;

    pendingModeTransitionRef.current = null;

    if (isMobile || reducedMotion) {
      pending.sourceClone?.remove();
      setModeTransition(null);
      return;
    }

    const targetRects = readModeTransitionRects(
      pipelineScopeRef.current,
      filteredOpportunities
    );
    const cards = filteredOpportunities.flatMap((opportunity) => {
      const from = pending.sourceRects.get(opportunity.id);
      const to = targetRects.get(opportunity.id);
      if (!from || !to) return [];

      const isSilhouetteTarget = to.width < 120 || to.height < 24;
      return [
        {
          opportunity,
          clientName:
            clientNameMap.get(opportunity.clientId ?? "") ??
            opportunity.contactName ??
            t("card.unknown"),
          stageColor:
            OPPORTUNITY_STAGE_COLORS[opportunity.stage] ??
            OPPORTUNITY_STAGE_COLORS[OpportunityStage.NewLead],
          stalenessOpacity: transitionStalenessMap.get(opportunity.id) ?? 1,
          density:
            !isSilhouetteTarget && to.width > CARD_WIDTH + 80
              ? "comfortable"
              : "compact",
          isSilhouetteTarget,
          from,
          to,
        } satisfies TransitionCard,
      ];
    });

    if (cards.length === 0) {
      pending.sourceClone?.remove();
      setModeTransition(null);
      return;
    }

    setModeTransition({
      ...pending,
      cards,
      durationMs: MODE_TRANSITION_DURATION_MS,
    });
  }, [
    clientNameMap,
    filteredOpportunities,
    isMobile,
    mode,
    reducedMotion,
    t,
    transitionStalenessMap,
  ]);

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

  useEffect(() => {
    if (!detailPanelOpportunityId) {
      setOriginatingOpportunityId(null);
    }
  }, [detailPanelOpportunityId]);

  // ── Board opportunities (active stages only — Won/Lost live in metrics bar)
  const boardOpportunities = useMemo(() => {
    return filteredOpportunities.filter((o) => isActiveStage(o.stage));
  }, [filteredOpportunities]);

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
        inverseFn: async () => {
          await unarchiveMutation.mutateAsync(opportunityId);
        },
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
      const clientName =
        clientNameMap.get(opp.clientId ?? "") ??
        opp.contactName ??
        opp.title ??
        "";
      moveStage.mutate(
        { id, stage: newStage, userId: currentUser?.id },
        {
          onSuccess: () => {
            const value = opp.estimatedValue
              ? formatCurrency(opp.estimatedValue)
              : "";
            const fromStage = getStageDisplayName(previousStage);
            const toStage = getStageDisplayName(newStage);
            toast.success(`${clientName}${value ? ` · ${value}` : ""}`, {
              description: `${fromStage} → ${toStage}`,
            });
            pushUndo({
              label: `${clientName} → ${toStage}`,
              inverseFn: async () => {
                await moveStage.mutateAsync({
                  id,
                  stage: previousStage,
                  userId: currentUser?.id,
                });
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
    [
      activeOpportunities,
      moveStage,
      currentUser,
      can,
      t,
      clientNameMap,
      pushUndo,
    ]
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

  const setFocusedDragLiveMessage = useCallback((message: string) => {
    setFocusedDragAnnouncement((current) =>
      current === message ? current : message
    );
  }, []);

  const handlePipelineDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      setActiveDragId(id);

      if (mode === "focused") {
        setFocusedDragLiveMessage(t("focused.dragLive.started"));
        return;
      }

      const { selectedCardIds, startDrag, clearSelection } =
        useSpatialCanvasStore.getState();

      if (selectedCardIds.has(id)) {
        startDrag(Array.from(selectedCardIds), { x: 0, y: 0 });
      } else {
        clearSelection();
        startDrag([id], { x: 0, y: 0 });
      }
    },
    [mode, setFocusedDragLiveMessage, t]
  );

  const handlePipelineDragOver = useCallback(
    (event: DragOverEvent) => {
      if (mode !== "focused") return;

      const data = event.over?.data.current as PipelineDropData | undefined;
      if (
        data?.mode === "focused" &&
        data.focusedDropIntent === "archive-target"
      ) {
        setFocusedDragLiveMessage(t("actions.archive"));
        return;
      }

      if (
        data?.mode === "focused" &&
        data.focusedDropIntent === "discard-target"
      ) {
        setFocusedDragLiveMessage(t("actions.discard"));
        return;
      }

      if (data?.mode !== "focused" || !data.stage) {
        setFocusedDragLiveMessage("");
        return;
      }

      setFocusedDragLiveMessage(
        formatPipelineTemplate(t("focused.dragLive.target"), {
          stage: getStageDisplayName(data.stage),
        })
      );
    },
    [mode, setFocusedDragLiveMessage, t]
  );

  const handlePipelineDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { over } = event;
      const draggedId = String(event.active.id);
      const { selectedCardIds, clearSelection, endDrag } =
        useSpatialCanvasStore.getState();
      const data = over?.data.current as PipelineDropData | undefined;
      const drop = resolvePipelineDragEnd({
        mode,
        draggedId,
        selectedCardIds,
        dropData: data,
      });

      if (mode === "focused") {
        if (drop.type === "focused-action") {
          if (drop.action === "archive") {
            handleArchive(drop.opportunityId);
            setFocusedDragLiveMessage(t("actions.archived"));
          } else {
            handleDiscard(drop.opportunityId);
            setFocusedDragLiveMessage(t("actions.discard"));
          }
        } else if (drop.type === "focused-stage") {
          const opportunity = filteredOpportunities.find(
            (o) => o.id === draggedId
          );

          if (drop.isTerminal && opportunity) {
            if (drop.stage === OpportunityStage.Won) {
              handleMarkWon(opportunity);
            } else if (drop.stage === OpportunityStage.Lost) {
              handleMarkLost(opportunity);
            }
          } else {
            handleMoveStage(drop.opportunityId, drop.stage);
          }

          setFocusedDragLiveMessage(
            formatPipelineTemplate(t("focused.dragLive.dropped"), {
              stage: getStageDisplayName(drop.stage),
            })
          );
        } else {
          setFocusedDragLiveMessage(t("focused.dragLive.cancelled"));
        }

        setActiveDragId(null);
        endDrag();
        return;
      }

      setFocusedDragLiveMessage("");

      if (drop.type === "spatial-stage") {
        if (drop.isTerminal) {
          for (const id of drop.opportunityIds) {
            const opportunity = filteredOpportunities.find((o) => o.id === id);
            if (!opportunity) continue;

            if (drop.stage === OpportunityStage.Won) {
              handleMarkWon(opportunity);
            } else if (drop.stage === OpportunityStage.Lost) {
              handleMarkLost(opportunity);
            }
          }
        } else {
          for (const id of drop.opportunityIds) {
            handleMoveStage(id, drop.stage);
          }
        }

        if (mode === "spatial") clearSelection();
      } else {
        // Drop on empty space cancels. Spatial mode no longer preserves free positions.
      }

      setActiveDragId(null);
      endDrag();
    },
    [
      filteredOpportunities,
      handleArchive,
      handleDiscard,
      handleMarkLost,
      handleMarkWon,
      handleMoveStage,
      mode,
      setFocusedDragLiveMessage,
      t,
    ]
  );

  const handlePipelineDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      setActiveDragId(null);
      if (mode === "focused") {
        setFocusedDragLiveMessage(t("focused.dragLive.cancelled"));
      } else {
        setFocusedDragLiveMessage("");
      }
      useSpatialCanvasStore.getState().endDrag();
    },
    [mode, setFocusedDragLiveMessage, t]
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
                await moveStage.mutateAsync({
                  id,
                  stage: previousStage,
                  userId: currentUser?.id,
                });
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

  /** Open detail panel for an opportunity */
  const handleOpenDetail = useCallback((opp: Opportunity) => {
    // Collapse the inline card expansion before opening the detail panel.
    const { expandedCardIds, toggleCardExpanded } =
      useSpatialCanvasStore.getState();
    if (expandedCardIds.has(opp.id)) {
      toggleCardExpanded(opp.id);
    }

    setOriginatingOpportunityId(opp.id);
    usePipelineModeStore.getState().openDetailPanel(opp.id);
  }, []);

  const handleTitleSave = useCallback(
    (opportunity: Opportunity, title: string) => {
      if (!can("pipeline.manage")) return;
      updateOpportunity.mutate(
        { id: opportunity.id, data: { title } },
        {
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
    },
    [can, t, updateOpportunity]
  );

  const handleLinkClient = useCallback(
    (opportunity: Opportunity, clientId: string) => {
      if (!can("pipeline.manage")) return;
      attachClient.mutate(
        { opportunityId: opportunity.id, clientId },
        {
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
    },
    [attachClient, can, t]
  );

  const handleCreateAndLinkClient = useCallback(
    async (opportunity: Opportunity, clientName: string) => {
      if (!can("pipeline.manage") || !company?.id) return;

      try {
        const client = await createClientMutation.mutateAsync({
          name: clientName,
          email: opportunity.contactEmail,
          phoneNumber: opportunity.contactPhone,
          address: opportunity.address,
          companyId: company.id,
        });

        await attachClient.mutateAsync({
          opportunityId: opportunity.id,
          clientId: client.id,
        });
      } catch (error) {
        toast.error(t("toast.failedUpdate"), {
          description:
            error instanceof Error ? error.message : t("toast.errorOccurred"),
        });
      }
    },
    [attachClient, can, company?.id, createClientMutation, t]
  );

  const handleAddressSave = useCallback(
    (
      opportunity: Opportunity,
      selection: { address: string; latitude: number; longitude: number }
    ) => {
      if (!can("pipeline.manage")) return;
      updateOpportunity.mutate(
        {
          id: opportunity.id,
          data: {
            address: selection.address,
            latitude: selection.latitude,
            longitude: selection.longitude,
          },
        },
        {
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
    },
    [can, t, updateOpportunity]
  );

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

  /** Placeholder: assign (opens detail panel) */
  const handleAssign = useCallback(
    (opportunityId: string) => {
      const opp = activeOpportunities.find((o) => o.id === opportunityId);
      if (opp) handleOpenDetail(opp);
    },
    [activeOpportunities, handleOpenDetail]
  );

  /** Placeholder: schedule follow-up (opens detail panel) */
  const handleScheduleFollowUp = useCallback(
    (opportunityId: string) => {
      const opp = activeOpportunities.find((o) => o.id === opportunityId);
      if (opp) handleOpenDetail(opp);
    },
    [activeOpportunities, handleOpenDetail]
  );

  // ── Loading state ─────────────────────────────────────────────────────
  if (isLoading && (isMobile || mode !== "focused")) {
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

  const transitionRole: PipelineModeTransitionRole = modeTransition
    ? "entering"
    : "static";
  const modeSurfaceStyle: CSSProperties | undefined = modeTransition
    ? {
        animation: `pipeline-mode-surface-enter ${
          modeTransition.durationMs
        }ms ${MODE_TRANSITION_EASING} both`,
      }
    : undefined;
  const modeSurfaceClassName = cn(
    "absolute inset-0",
    modeTransition &&
      "pointer-events-none [&_[data-pipeline-transition-card]]:opacity-0"
  );
  const focusedActiveOpportunity =
    mode === "focused" && activeDragId
      ? (filteredOpportunities.find(
          (opportunity) => opportunity.id === activeDragId
        ) ?? null)
      : null;
  const focusedActiveClientName = focusedActiveOpportunity
    ? (clientNameMap.get(focusedActiveOpportunity.clientId ?? "") ??
      focusedActiveOpportunity.contactName ??
      t("card.unknown"))
    : "";
  const focusedActiveStaleness = focusedActiveOpportunity
    ? (transitionStalenessMap.get(focusedActiveOpportunity.id) ?? 1)
    : 1;
  const isFocusedDesktop = !isMobile && mode === "focused";
  const handleModeTransitionComplete = () => {
    setModeTransition(null);
  };

  return (
    <div
      ref={pipelineScopeRef}
      className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden"
    >
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
            <div
              data-pipeline-mode-surface={mode}
              className={modeSurfaceClassName}
              style={modeSurfaceStyle}
            >
              {mode === "focused" ? (
                <PipelineFocusedShell
                  opportunities={filteredOpportunities}
                  clients={clientsData?.clients ?? []}
                  clientNameMap={clientNameMap}
                  canManage={canManage}
                  filtersActive={filtersActive}
                  opportunitiesLoading={oppsLoading}
                  clientsLoading={clientsLoading}
                  isOpportunitiesError={oppsError}
                  opportunitiesError={opportunitiesError}
                  dragAnnouncement={focusedDragAnnouncement}
                  transitionRole={transitionRole}
                  onRetryOpportunities={() => {
                    void refetchOpportunities();
                  }}
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
                  onMoveStage={handleMoveStage}
                  onAssign={handleAssign}
                  onScheduleFollowUp={handleScheduleFollowUp}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onTitleSave={handleTitleSave}
                  onLinkClient={handleLinkClient}
                  onCreateAndLinkClient={handleCreateAndLinkClient}
                  onAddressSave={handleAddressSave}
                />
              ) : (
                <SpatialCanvasDesktop
                  opportunities={filteredOpportunities}
                  clientNameMap={clientNameMap}
                  canManage={canManage}
                  transitionRole={transitionRole}
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
                    opportunities?.filter(
                      (o) =>
                        o.stage === OpportunityStage.Discarded && !o.archivedAt
                    ) ?? []
                  }
                  onRestore={(id) => unarchiveMutation.mutate(id)}
                  onDeletePermanently={(id) => deleteMutation.mutate(id)}
                  activeDragId={activeDragId}
                />
              )}
            </div>
            {modeTransition && (
              <PipelineModeTransitionOverlay
                transition={modeTransition}
                onComplete={handleModeTransitionComplete}
              />
            )}
            {mode === "focused" && (
              <PipelineFocusedDragOverlay
                activeOpportunity={focusedActiveOpportunity}
                clientName={focusedActiveClientName}
                stalenessOpacity={focusedActiveStaleness}
              />
            )}
          </PipelineDndProvider>
        )}
      </div>

      {/* ── Page HUD — metrics, toolbar, banners float on top of canvas ── */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-[2]">
        <div className="pointer-events-auto">
          <MetricsHeader
            variant="full"
            tabId="pipeline"
            title="Pipeline"
            metrics={pipelineMetrics}
            isLoading={pipelineMetricsLoading}
          />
        </div>
        {!isMobile && mode !== "focused" && (
          <div className="pointer-events-auto px-3 py-1.5">
            <div className="inline-flex w-fit rounded-chip border border-border-subtle bg-glass-subtle py-[2px] backdrop-blur-[12px] backdrop-saturate-[1.1]">
              <SpatialFloatingToolbar
                reviewCount={reviewCount}
                onReviewEmails={() => setReviewPanelOpen(true)}
              />
            </div>
          </div>
        )}
        {!isMobile && mode !== "focused" && (
          <div className="pointer-events-auto px-3 pb-1">
            <div className="inline-flex w-fit rounded-chip border border-border-subtle bg-glass-subtle px-1.5 py-1 backdrop-blur-[12px] backdrop-saturate-[1.1]">
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
        )}
        {/* Banners */}
        <div
          className={cn(
            "pointer-events-auto flex flex-col gap-1 px-3",
            isFocusedDesktop &&
              "fixed bottom-[54px] left-[84px] z-[9997] w-[min(560px,calc(100vw-108px))] px-0"
          )}
        >
          {gmailConnections.length === 0 && !gmailBannerDismissed && (
            <div
              className="glass-dense flex animate-fade-in items-center gap-2 rounded-panel border px-2 py-1.5 [&::before]:rounded-panel"
              style={{
                background: "var(--surface-glass-dense)",
                backdropFilter: "blur(28px) saturate(1.3)",
                WebkitBackdropFilter: "blur(28px) saturate(1.3)",
                borderColor: "rgba(111, 148, 176, 0.26)",
              }}
            >
              <div className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[5px] border border-ops-accent/20 bg-ops-accent/10">
                <Mail className="h-[16px] w-[16px] text-ops-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mohave text-body text-text">
                  {t("gmail.connectBanner")}
                </p>
                <p className="font-mono text-micro text-text-mute">
                  {t("gmail.connectDesc")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  className="gap-[6px]"
                  onClick={() => {
                    if (!currentUser?.id) {
                      console.error(
                        "[pipeline] No current user — cannot initiate OAuth"
                      );
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
                  <Mail className="h-[14px] w-[14px]" />
                  {t("gmail.connect")}
                </Button>
                <button
                  onClick={() => setGmailBannerDismissed(true)}
                  className="p-[6px] text-text-mute transition-colors hover:text-text-3"
                  title={t("gmail.dismiss")}
                >
                  <X className="h-[14px] w-[14px]" />
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
            <div className="flex items-center gap-1.5 rounded-chip border border-ops-accent/25 bg-ops-accent/10 px-2 py-1">
              <Loader2 className="h-[14px] w-[14px] animate-spin text-ops-accent" />
              <span className="font-mono text-micro text-ops-accent">
                {t("column.updating")}
              </span>
            </div>
          )}
        </div>
      </div>

      {!isMobile && mode === "focused" && (
        <div
          className="pointer-events-none fixed bottom-[12px] left-[84px] right-[12px] z-[9998] flex justify-start"
        >
          <div
            className="glass-dense scrollbar-hide pointer-events-auto inline-flex max-w-full items-center gap-[3px] overflow-x-auto rounded-[10px] border px-[3px] py-[3px] [&::before]:rounded-[10px]"
            style={{
              background: "var(--surface-glass-dense)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              borderColor: "var(--glass-border)",
              borderRadius: "10px",
            }}
          >
            <PipelineFocusedToolbar
              reviewCount={reviewCount}
              onReviewEmails={() => setReviewPanelOpen(true)}
            />
            <div className="mx-[3px] h-[16px] w-px shrink-0 bg-border-subtle" />
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
              variant="toolbar"
            />
          </div>
        </div>
      )}

      {!isMobile && mode === "focused" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[30] h-12 bg-gradient-to-t from-background via-background/60 to-transparent" />
      )}

      {!isMobile && mode === "spatial" && detailPanelOpportunity && (
        <PipelineDetailPanel
          opportunity={detailPanelOpportunity}
          canManage={canManage}
          originatingOpportunityId={
            originatingOpportunityId ?? detailPanelOpportunityId
          }
          scopeRef={pipelineScopeRef}
          onAdvanceStage={handleAdvanceStage}
          onMarkWon={handleMarkWon}
          onMarkLost={handleMarkLost}
          onArchive={handleArchive}
          onDiscard={handleDiscard}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      )}

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
          openWindow({
            id: "create-lead",
            title: "New Lead",
            type: "create-lead",
          });
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
