"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useDroppable } from "@dnd-kit/core";
import { motion, useReducedMotion } from "framer-motion";
import { Archive, Trash2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  PIPELINE_STAGES_DEFAULT,
  formatCurrency,
  getDaysInStage,
  isActiveStage,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import type { SortOption } from "./pipeline-mode-types";
import { usePipelineModeStore } from "./pipeline-mode-store";
import { usePipelineDndState } from "./pipeline-dnd-provider";
import { PipelineFocusedColumn } from "./pipeline-focused-column";
import { PipelineFocusedDetailWindow } from "./pipeline-focused-detail-window";
import { PipelineSpineColumn } from "./pipeline-spine-column";
import { PipelineTerminalStack } from "./pipeline-terminal-stack";

type FocusedShellActionHandlers = {
  onLogCall: (id: string) => void;
  onLogText: (id: string) => void;
  onAddNote: (id: string, note: string) => void;
  onArchive: (id: string) => void;
  onDiscard: (id: string) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onAdvanceStage: (opportunity: Opportunity) => void;
  onMoveStage: (id: string, stage: OpportunityStage) => void;
  onAssign: (id: string) => void;
  onScheduleFollowUp: (id: string) => void;
  onDelete: (id: string) => void;
};

export interface PipelineFocusedShellProps extends FocusedShellActionHandlers {
  opportunities: Opportunity[];
  clientNameMap: Map<string, string>;
  canManage: boolean;
  filtersActive: boolean;
  opportunitiesLoading?: boolean;
  clientsLoading?: boolean;
  opportunitiesError?: unknown;
  isOpportunitiesError?: boolean;
  dragAnnouncement: string;
  transitionRole?: "static" | "entering";
  onRetryOpportunities?: () => void;
  onAddLead: () => void;
  onClearFilters: () => void;
}

type SpineDistanceFromFocus = 1 | 2 | 3;

const ACTIVE_STAGE_ORDER = PIPELINE_STAGES_DEFAULT.map(
  (stage) => stage.slug as OpportunityStage
).filter(isActiveStage);
const TERMINAL_STAGE_ORDER = [OpportunityStage.Won, OpportunityStage.Lost];
const SNAP_DURATION_MS = 280;
const SNAP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const PINCH_ZOOM_SENSITIVITY = 0.005;
const FOCUSED_PINCH_MIN_ZOOM = 0.5;
const FOCUSED_PINCH_SPATIAL_THRESHOLD = 0.6;
const REDUCED_MOTION_DURATION = 0.001;
const SPINE_RAIL_CHROME = "h-full pt-[112px] pb-0";
const ACTION_DROP_ZONE_BASE =
  "group relative h-full min-w-0 overflow-hidden text-left transition-[color,opacity] duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";
const ACTION_DROP_SILHOUETTE_COUNT = 24;
const NUMBER_STYLE: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1, "zero" 1',
};

function hexToRgbChannels(hex: string): string | null {
  const normalized = hex.replace("#", "").trim();
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;

  const value = Number.parseInt(expanded, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;

  return `${red}, ${green}, ${blue}`;
}

function sortOpportunities(
  opportunities: Opportunity[],
  sortBy: SortOption,
  clientNames: Map<string, string>
): Opportunity[] {
  const sorted = [...opportunities];

  switch (sortBy) {
    case "value":
      return sorted.sort((a, b) => {
        if (a.estimatedValue === null && b.estimatedValue === null) return 0;
        if (a.estimatedValue === null) return 1;
        if (b.estimatedValue === null) return -1;
        return b.estimatedValue - a.estimatedValue;
      });
    case "name":
      return sorted.sort((a, b) => {
        const nameA = clientNames.get(a.clientId ?? "") ?? a.contactName ?? "";
        const nameB = clientNames.get(b.clientId ?? "") ?? b.contactName ?? "";
        return nameA.localeCompare(nameB);
      });
    case "date":
      return sorted.sort((a, b) => {
        const dateA = a.createdAt?.getTime() ?? 0;
        const dateB = b.createdAt?.getTime() ?? 0;
        return dateB - dateA;
      });
    case "days_in_stage":
      return sorted.sort((a, b) => getDaysInStage(b) - getDaysInStage(a));
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const editable = target.closest("[contenteditable]");
  if (
    editable instanceof HTMLElement &&
    editable.getAttribute("contenteditable") !== "false"
  ) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [data-keyboard-scope='modal-or-menu']"
    )
  );
}

function hasNavigationModifier(event: KeyboardEvent): boolean {
  return (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.isComposing
  );
}

function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function focusOpportunityCard(opportunityId: string | null) {
  if (!opportunityId) return;

  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(
      `[data-opportunity-card-id="${escapeAttributeValue(opportunityId)}"]`
    );
    target?.focus({ preventScroll: true });
  });
}

export function PipelineFocusedShell({
  opportunities,
  clientNameMap,
  canManage,
  filtersActive,
  opportunitiesLoading = false,
  isOpportunitiesError = false,
  dragAnnouncement,
  transitionRole = "static",
  onRetryOpportunities,
  onAddLead,
  onClearFilters,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onDiscard,
  onMarkWon,
  onMarkLost,
  onAdvanceStage,
  onMoveStage,
  onAssign,
  onScheduleFollowUp,
  onDelete,
}: PipelineFocusedShellProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const focusedStage = usePipelineModeStore((state) => state.focusedStage);
  const setFocusedStage = usePipelineModeStore(
    (state) => state.setFocusedStage
  );
  const sortBy = usePipelineModeStore((state) => state.sortBy);
  const stageSortOverrides = usePipelineModeStore(
    (state) => state.stageSortOverrides
  );
  const detailPanelOpportunityId = usePipelineModeStore(
    (state) => state.detailPanelOpportunityId
  );
  const closeDetailPanel = usePipelineModeStore(
    (state) => state.closeDetailPanel
  );
  const setMode = usePipelineModeStore((state) => state.setMode);
  const toggleMode = usePipelineModeStore((state) => state.toggleMode);
  const { isDragging } = usePipelineDndState();
  const shellRef = useRef<HTMLDivElement>(null);
  const focusedColumnRef = useRef<HTMLDivElement>(null);
  const pendingFlipRectRef = useRef<DOMRect | null>(null);
  const stageSyncedDetailIdRef = useRef<string | null>(null);
  const virtualZoomRef = useRef(1);
  const animationRef = useRef<Animation | null>(null);
  const pendingTabFocusRef = useRef<OpportunityStage | null>(null);
  const focusedStageTabRefs = useRef(new Map<OpportunityStage, HTMLElement>());

  const registerFocusedTab = useCallback(
    (stage: OpportunityStage) => (node: HTMLElement | null) => {
      if (node) {
        focusedStageTabRefs.current.set(stage, node);
      } else {
        focusedStageTabRefs.current.delete(stage);
      }
    },
    []
  );

  const opportunitiesByStage = useMemo(() => {
    const byStage = new Map<OpportunityStage, Opportunity[]>();

    for (const stage of [...ACTIVE_STAGE_ORDER, ...TERMINAL_STAGE_ORDER]) {
      const stageSort = stageSortOverrides.get(stage) ?? sortBy;
      const stageOpportunities = opportunities.filter(
        (opportunity) => opportunity.stage === stage
      );
      byStage.set(
        stage,
        sortOpportunities(stageOpportunities, stageSort, clientNameMap)
      );
    }

    return byStage;
  }, [opportunities, sortBy, stageSortOverrides, clientNameMap]);

  const focusableStages = useMemo(
    () => [...ACTIVE_STAGE_ORDER, ...TERMINAL_STAGE_ORDER],
    []
  );
  const safeFocusedStage = focusableStages.includes(focusedStage)
    ? focusedStage
    : ACTIVE_STAGE_ORDER[0];
  const focusedIndex =
    ACTIVE_STAGE_ORDER.indexOf(safeFocusedStage) === -1
      ? ACTIVE_STAGE_ORDER.length
      : ACTIVE_STAGE_ORDER.indexOf(safeFocusedStage);
  const focusedPanelId = "pipeline-focused-panel";

  const snapToStage = useCallback(
    (nextStage: OpportunityStage) => {
      if (isDragging) return;
      if (nextStage === safeFocusedStage) return;
      animationRef.current?.cancel();
      pendingFlipRectRef.current =
        focusedColumnRef.current?.getBoundingClientRect() ?? null;
      pendingTabFocusRef.current = nextStage;
      setFocusedStage(nextStage);
    },
    [isDragging, safeFocusedStage, setFocusedStage]
  );

  const snapByDirection = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = focusableStages.indexOf(safeFocusedStage);
      if (currentIndex === -1) return;
      const nextIndex = Math.max(
        0,
        Math.min(focusableStages.length - 1, currentIndex + direction)
      );
      snapToStage(focusableStages[nextIndex]);
    },
    [focusableStages, safeFocusedStage, snapToStage]
  );

  useLayoutEffect(() => {
    const previousRect = pendingFlipRectRef.current;
    const element = focusedColumnRef.current;
    pendingFlipRectRef.current = null;

    if (!previousRect || !element || reduced) return;

    const nextRect = element.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    if (Math.abs(deltaX) < 1) return;

    animationRef.current?.cancel();
    animationRef.current = element.animate(
      [
        { transform: `translate3d(${deltaX}px, 0, 0)` },
        { transform: "translate3d(0, 0, 0)" },
      ],
      {
        duration: SNAP_DURATION_MS,
        easing: SNAP_EASING,
        fill: "both",
      }
    );

    animationRef.current.onfinish = () => {
      animationRef.current = null;
    };

    return () => {
      animationRef.current?.cancel();
      animationRef.current = null;
    };
  }, [safeFocusedStage, reduced]);

  useEffect(() => {
    if (pendingTabFocusRef.current !== safeFocusedStage) return;

    pendingTabFocusRef.current = null;
    focusedStageTabRefs.current.get(safeFocusedStage)?.focus();
  }, [safeFocusedStage]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (isDragging) return;

      if (
        event.key.toLowerCase() === "v" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        toggleMode();
        return;
      }

      if (event.key === "Escape") {
        if (detailPanelOpportunityId) {
          event.preventDefault();
          focusOpportunityCard(detailPanelOpportunityId);
          closeDetailPanel();
        }
        return;
      }

      if (hasNavigationModifier(event)) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        snapByDirection(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        snapByDirection(1);
      } else if (
        safeFocusedStage === OpportunityStage.Won &&
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        snapToStage(OpportunityStage.Lost);
      } else if (
        safeFocusedStage === OpportunityStage.Lost &&
        event.key === "ArrowUp"
      ) {
        event.preventDefault();
        snapToStage(OpportunityStage.Won);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closeDetailPanel,
    detailPanelOpportunityId,
    isDragging,
    safeFocusedStage,
    snapByDirection,
    snapToStage,
    toggleMode,
  ]);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey && event.deltaY > 0) {
        if (isDragging) return;

        event.preventDefault();
        const delta = -event.deltaY * PINCH_ZOOM_SENSITIVITY;
        virtualZoomRef.current = Math.max(
          FOCUSED_PINCH_MIN_ZOOM,
          Math.min(1, virtualZoomRef.current + delta)
        );

        if (virtualZoomRef.current <= FOCUSED_PINCH_SPATIAL_THRESHOLD) {
          virtualZoomRef.current = 1;
          setMode("spatial");
        }
        return;
      }

      // Let native horizontal wheel gestures pass through so browser/page
      // swipe navigation remains available on trackpads.
    },
    [isDragging, setMode]
  );

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    shell.addEventListener("wheel", handleWheel, { passive: false });
    return () => shell.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const leftStages = ACTIVE_STAGE_ORDER.filter(
    (stage) => ACTIVE_STAGE_ORDER.indexOf(stage) < focusedIndex
  );
  const rightStages = ACTIVE_STAGE_ORDER.filter(
    (stage) => ACTIVE_STAGE_ORDER.indexOf(stage) > focusedIndex
  );
  const focusedOpportunities = opportunitiesByStage.get(safeFocusedStage) ?? [];
  const detailOpportunity = detailPanelOpportunityId
    ? (opportunities.find(
        (opportunity) => opportunity.id === detailPanelOpportunityId
      ) ?? null)
    : null;
  const detailOpenInFocusedStage =
    detailOpportunity?.stage === safeFocusedStage;
  const wonOpportunities = opportunitiesByStage.get(OpportunityStage.Won) ?? [];
  const lostOpportunities =
    opportunitiesByStage.get(OpportunityStage.Lost) ?? [];
  const isTerminalFocusedStage =
    TERMINAL_STAGE_ORDER.includes(safeFocusedStage);
  const focusedHeaderTabId = `pipeline-focused-tab-${safeFocusedStage}`;
  const selectedFocusedTabId = isTerminalFocusedStage
    ? `pipeline-terminal-tab-${safeFocusedStage}`
    : focusedHeaderTabId;

  const renderFocusedHeader = (isTab: boolean) => (
    <div
      role="presentation"
      className="pointer-events-none z-[3] col-start-2 row-start-1 min-h-0 min-w-[460px]"
    >
      <div className="pointer-events-none relative h-full min-h-0 min-w-0">
        <FocusedStageTab
          ref={isTab ? registerFocusedTab(safeFocusedStage) : undefined}
          stage={safeFocusedStage}
          opportunities={focusedOpportunities}
          isLoading={opportunitiesLoading || isOpportunitiesError}
          isTab={isTab}
          tabId={focusedHeaderTabId}
          panelId={focusedPanelId}
        />
      </div>
    </div>
  );

  useEffect(() => {
    if (!detailPanelOpportunityId) {
      stageSyncedDetailIdRef.current = null;
      return;
    }

    if (!detailOpportunity) {
      stageSyncedDetailIdRef.current = null;
      closeDetailPanel();
      return;
    }

    if (!focusableStages.includes(detailOpportunity.stage)) {
      stageSyncedDetailIdRef.current = null;
      closeDetailPanel();
      return;
    }

    if (detailOpportunity.stage === safeFocusedStage) {
      stageSyncedDetailIdRef.current = detailPanelOpportunityId;
      return;
    }

    if (stageSyncedDetailIdRef.current === detailPanelOpportunityId) {
      stageSyncedDetailIdRef.current = null;
      closeDetailPanel();
      return;
    }

    stageSyncedDetailIdRef.current = detailPanelOpportunityId;
    setFocusedStage(detailOpportunity.stage);
  }, [
    closeDetailPanel,
    detailOpportunity,
    detailPanelOpportunityId,
    focusableStages,
    safeFocusedStage,
    setFocusedStage,
  ]);

  return (
    <div
      ref={shellRef}
      data-pipeline-transition-role={transitionRole}
      className="h-full min-h-0 w-full overflow-hidden bg-background"
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {dragAnnouncement}
      </div>
      <div className="grid h-full min-h-0 w-full grid-cols-[auto_minmax(460px,1fr)_auto_auto] items-stretch gap-2 overflow-hidden">
        <div
          role="tablist"
          aria-label={t("focused.tablist.label", "Pipeline stages")}
          className="contents"
        >
          <div
            role="presentation"
            className={`col-start-1 row-start-1 flex min-h-0 shrink-0 items-stretch gap-2 ${SPINE_RAIL_CHROME}`}
          >
            {leftStages.map((stage) => (
              <SpineSlot
                key={stage}
                stage={stage}
                focusedIndex={focusedIndex}
                stageIndex={ACTIVE_STAGE_ORDER.indexOf(stage)}
                opportunities={opportunitiesByStage.get(stage) ?? []}
                panelId={focusedPanelId}
                isLoading={opportunitiesLoading}
                registerTab={registerFocusedTab}
                onFocusStage={snapToStage}
              />
            ))}
          </div>

          {!isTerminalFocusedStage && renderFocusedHeader(true)}

          <div
            role="presentation"
            className={`col-start-3 row-start-1 flex min-h-0 shrink-0 items-stretch gap-2 ${SPINE_RAIL_CHROME}`}
          >
            {rightStages.map((stage) => (
              <SpineSlot
                key={stage}
                stage={stage}
                focusedIndex={focusedIndex}
                stageIndex={ACTIVE_STAGE_ORDER.indexOf(stage)}
                opportunities={opportunitiesByStage.get(stage) ?? []}
                panelId={focusedPanelId}
                isLoading={opportunitiesLoading}
                registerTab={registerFocusedTab}
                onFocusStage={snapToStage}
              />
            ))}
          </div>

          <div
            role="presentation"
            className={`col-start-4 row-start-1 ${SPINE_RAIL_CHROME}`}
          >
            <PipelineTerminalStack
              wonOpportunities={wonOpportunities}
              lostOpportunities={lostOpportunities}
              focusedStage={safeFocusedStage}
              isLoading={opportunitiesLoading}
              panelId={focusedPanelId}
              registerTab={registerFocusedTab}
              onSelectStage={snapToStage}
            />
          </div>
        </div>

        {isTerminalFocusedStage && renderFocusedHeader(false)}

        <motion.div
          ref={focusedColumnRef}
          layout={!reduced}
          transition={{
            duration: reduced ? REDUCED_MOTION_DURATION : 0.24,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="z-[1] col-start-2 row-start-1 min-h-0 min-w-[460px]"
        >
          <PipelineFocusedColumn
            stage={safeFocusedStage}
            opportunities={focusedOpportunities}
            clientNameMap={clientNameMap}
            canManage={canManage}
            filtersActive={filtersActive}
            focusedTabId={selectedFocusedTabId}
            focusedPanelId={focusedPanelId}
            isLoading={opportunitiesLoading}
            isError={isOpportunitiesError}
            onRetry={onRetryOpportunities}
            onAddLead={onAddLead}
            onClearFilters={onClearFilters}
            onLogCall={onLogCall}
            onLogText={onLogText}
            onAddNote={onAddNote}
            onArchive={onArchive}
            onDiscard={onDiscard}
            onMarkWon={onMarkWon}
            onMarkLost={onMarkLost}
            onMoveStage={onMoveStage}
            onAssign={onAssign}
            onScheduleFollowUp={onScheduleFollowUp}
          />
        </motion.div>
      </div>

      {detailOpportunity && detailOpenInFocusedStage && (
        <PipelineFocusedDetailWindow
          opportunity={detailOpportunity}
          canManage={canManage}
          originatingOpportunityId={detailPanelOpportunityId}
          onAdvanceStage={onAdvanceStage}
          onMarkWon={onMarkWon}
          onMarkLost={onMarkLost}
          onArchive={onArchive}
          onDiscard={onDiscard}
          onDelete={onDelete}
        />
      )}

      <FocusedActionDropZones canManage={canManage} isDragging={isDragging} />
    </div>
  );
}

function FocusedActionDropZones({
  canManage,
  isDragging,
}: {
  canManage: boolean;
  isDragging: boolean;
}) {
  const { t } = useDictionary("pipeline");
  const isVisible = canManage && isDragging;

  return (
    <div
      data-testid="pipeline-focused-action-drops"
      aria-hidden={!isVisible}
      className={cn(
        "fixed bottom-2 left-[84px] right-3 z-[9999] grid h-[88px] grid-cols-2 gap-2 overflow-visible",
        "transition-opacity duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        isVisible
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0"
      )}
    >
      <FocusedActionDropTarget
        intent="archive-target"
        label={t("actions.archive", "Archive")}
        icon={<Archive className="h-[15px] w-[15px]" strokeWidth={1.5} />}
        disabled={!canManage}
      />
      <FocusedActionDropTarget
        intent="discard-target"
        label={t("actions.discard", "Discard")}
        icon={<Trash2 className="h-[15px] w-[15px]" strokeWidth={1.5} />}
        destructive
        disabled={!canManage}
      />
    </div>
  );
}

function FocusedActionDropTarget({
  intent,
  label,
  icon,
  destructive = false,
  disabled,
}: {
  intent: "archive-target" | "discard-target";
  label: string;
  icon: ReactNode;
  destructive?: boolean;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `focused-action-${intent === "archive-target" ? "archive" : "discard"}`,
    data: {
      mode: "focused",
      focusedDropIntent: intent,
    },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      role="region"
      aria-label={label}
      data-testid={`pipeline-focused-${intent === "archive-target" ? "archive" : "discard"}-drop`}
      style={{
        color: isOver ? "var(--text)" : undefined,
      }}
      className={cn(
        ACTION_DROP_ZONE_BASE,
        isOver ? "text-text" : "text-text-3"
      )}
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[52px] rounded-panel border border-line bg-[var(--surface-glass-dense)] backdrop-blur-[28px] backdrop-saturate-[1.3] transition-[border-color] duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          borderColor: isOver
            ? destructive
              ? "rgba(147, 50, 26, 0.58)"
              : "rgba(143, 154, 163, 0.46)"
            : "var(--glass-border)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[52px] rounded-panel transition-opacity duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          backgroundColor: destructive
            ? "rgba(147, 50, 26, 0.16)"
            : "rgba(143, 154, 163, 0.14)",
          opacity: isOver ? 1 : 0,
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-1.5 bottom-[51px] h-px transition-opacity duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          background: `linear-gradient(90deg, transparent, ${
            destructive ? "#93321A" : "#8F9AA3"
          }, transparent)`,
          opacity: isOver ? 0.86 : 0.32,
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[52px] rounded-panel bg-gradient-to-b from-white/[0.035] to-transparent"
      />
      <div className="absolute inset-x-0 bottom-0 z-[1] flex h-[52px] min-w-0 items-center justify-center gap-3 px-6">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            destructive && isOver ? "text-rose" : "text-text-3"
          )}
        >
          {icon}
        </span>
        <span className="font-cakemono text-caption-sm font-light uppercase leading-none">
          {label}
        </span>
        <div
          className="hidden w-[168px] gap-[2px] min-[1120px]:flex"
          aria-hidden="true"
        >
          {Array.from({ length: ACTION_DROP_SILHOUETTE_COUNT }).map(
            (_, index) => (
              <span
                key={index}
                className="h-1.5 flex-1 rounded-bar"
                style={{
                  backgroundColor: destructive ? "#93321A" : "#8F9AA3",
                  opacity: isOver ? 0.72 : 0.18,
                }}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

type FocusedStageTabProps = {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  isLoading: boolean;
  isTab: boolean;
  tabId: string;
  panelId: string;
};

const FocusedStageTab = memo(
  forwardRef<HTMLDivElement, FocusedStageTabProps>(function FocusedStageTab(
    { stage, opportunities, isLoading, isTab, tabId, panelId },
    ref
  ) {
    const { t } = useDictionary("pipeline");
    const stageName = getStageDisplayName(stage);
    const stageColor =
      OPPORTUNITY_STAGE_COLORS[stage] ??
      OPPORTUNITY_STAGE_COLORS[OpportunityStage.NewLead];
    const stageRgb =
      hexToRgbChannels(stageColor) ??
      hexToRgbChannels(OPPORTUNITY_STAGE_COLORS[OpportunityStage.NewLead]) ??
      "143, 154, 163";
    const totalEstimatedValue = useMemo(
      () =>
        opportunities.reduce(
          (sum, opportunity) => sum + (opportunity.estimatedValue ?? 0),
          0
        ),
      [opportunities]
    );
    const avgDays = useMemo(() => {
      if (opportunities.length === 0) return null;
      const totalDays = opportunities.reduce(
        (sum, opportunity) => sum + getDaysInStage(opportunity),
        0
      );
      return Math.round(totalDays / opportunities.length);
    }, [opportunities]);
    const countValue = isLoading ? "—" : String(opportunities.length);
    const valueMetric = isLoading ? "—" : formatCurrency(totalEstimatedValue);
    const avgDaysValue = isLoading || avgDays === null ? "—" : `${avgDays}d`;
    const tabProps = isTab
      ? {
          role: "tab" as const,
          id: tabId,
          "aria-selected": true,
          "aria-controls": panelId,
          tabIndex: 0,
        }
      : {
          "aria-hidden": true,
        };
    const stageHeaderStyle: CSSProperties = {
      background: `linear-gradient(90deg, rgba(${stageRgb}, 0.16) 0%, rgba(${stageRgb}, 0.08) 30%, var(--surface-glass-dense) 68%)`,
      backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-saturate))",
      WebkitBackdropFilter:
        "blur(var(--glass-blur)) saturate(var(--glass-saturate))",
      borderColor: `rgba(${stageRgb}, 0.38)`,
      borderRadius: "10px",
    };

    return (
      <div
        ref={ref}
        {...tabProps}
        className="glass-dense pointer-events-auto absolute left-0 right-0 top-[112px] isolate z-[2] min-h-[52px] cursor-default overflow-hidden rounded-panel border px-3 py-2 outline-none focus:outline-none focus-visible:outline-none [&::before]:rounded-panel"
        style={stageHeaderStyle}
      >
        <span
          aria-hidden="true"
          data-focused-stage-accent="top"
          className="absolute left-0 right-0 top-0 h-px"
          style={{
            background: `linear-gradient(90deg, rgba(${stageRgb}, 0.8), rgba(${stageRgb}, 0) 55%)`,
          }}
        />
        <span
          aria-hidden="true"
          data-focused-stage-accent="bottom"
          className="absolute bottom-0 left-0 right-0 h-px"
          style={{
            background: `linear-gradient(90deg, rgba(${stageRgb}, 0.34), rgba(${stageRgb}, 0) 45%)`,
          }}
        />

        <div className="relative z-[1] flex min-h-[36px] items-center justify-between gap-4">
          <span className="min-w-0 truncate font-cakemono text-heading font-light uppercase leading-none text-text">
            {stageName}
          </span>

          <dl className="grid w-[280px] shrink-0 grid-cols-3 gap-2">
            <Metric
              label={t("focused.metrics.count", "COUNT")}
              value={countValue}
            />
            <Metric
              label={t("focused.metrics.value", "VALUE")}
              value={valueMetric}
            />
            <Metric
              label={t("focused.metrics.avgDays", "AVG DAYS")}
              value={avgDaysValue}
            />
          </dl>
        </div>
      </div>
    );
  })
);

function SpineSlot({
  stage,
  opportunities,
  stageIndex,
  focusedIndex,
  panelId,
  isLoading,
  registerTab,
  onFocusStage,
}: {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  stageIndex: number;
  focusedIndex: number;
  panelId: string;
  isLoading: boolean;
  registerTab: (stage: OpportunityStage) => (node: HTMLElement | null) => void;
  onFocusStage: (stage: OpportunityStage) => void;
}) {
  const distance = Math.min(
    3,
    Math.max(1, Math.abs(stageIndex - focusedIndex))
  ) as SpineDistanceFromFocus;
  const compactHidden = distance >= 2 ? "max-[1279px]:hidden" : "";

  return (
    <div className={`h-full ${compactHidden}`}>
      <PipelineSpineColumn
        stage={stage}
        opportunities={opportunities}
        distanceFromFocus={distance}
        isHovered={false}
        tabId={`pipeline-spine-tab-${stage}`}
        panelId={panelId}
        isLoading={isLoading}
        tabRef={registerTab(stage)}
        onFocusStage={onFocusStage}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate font-mono text-micro uppercase text-text-3">
        {label}
      </dt>
      <dd
        className="truncate font-mono text-data-sm text-text"
        style={NUMBER_STYLE}
      >
        {value}
      </dd>
    </div>
  );
}
