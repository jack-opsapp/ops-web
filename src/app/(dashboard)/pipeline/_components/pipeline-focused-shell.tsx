"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useReducedMotion } from "framer-motion";
import {
  type Opportunity,
  OpportunityStage,
  PIPELINE_STAGES_DEFAULT,
  getDaysInStage,
  isActiveStage,
} from "@/lib/types/pipeline";
import type { SortOption } from "./pipeline-mode-types";
import { usePipelineModeStore } from "./pipeline-mode-store";
import { usePipelineDndState } from "./pipeline-dnd-provider";
import { PipelineFocusedColumn } from "./pipeline-focused-column";
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
  onAssign: (id: string) => void;
  onScheduleFollowUp: (id: string) => void;
};

export interface PipelineFocusedShellProps extends FocusedShellActionHandlers {
  opportunities: Opportunity[];
  clientNameMap: Map<string, string>;
  canManage: boolean;
  filtersActive: boolean;
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
const SNAP_DEBOUNCE_MS = 150;

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
  const element = target as HTMLElement | null;
  if (!element) return false;
  return Boolean(
    element.closest("input, textarea, select, [contenteditable='true']")
  );
}

export function PipelineFocusedShell({
  opportunities,
  clientNameMap,
  canManage,
  filtersActive,
  onAddLead,
  onClearFilters,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onDiscard,
  onMarkWon,
  onMarkLost,
  onAssign,
  onScheduleFollowUp,
}: PipelineFocusedShellProps) {
  const reduced = useReducedMotion();
  const focusedStage = usePipelineModeStore((state) => state.focusedStage);
  const setFocusedStage = usePipelineModeStore(
    (state) => state.setFocusedStage
  );
  const sortBy = usePipelineModeStore((state) => state.sortBy);
  const stageSortOverrides = usePipelineModeStore(
    (state) => state.stageSortOverrides
  );
  const { isDragging } = usePipelineDndState();
  const focusedColumnRef = useRef<HTMLDivElement>(null);
  const pendingFlipRectRef = useRef<DOMRect | null>(null);
  const lastSnapAtRef = useRef(0);
  const animationRef = useRef<Animation | null>(null);

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
  const focusedTabId = `pipeline-focused-tab-${safeFocusedStage}`;
  const focusedPanelId = "pipeline-focused-panel";

  const snapToStage = useCallback(
    (nextStage: OpportunityStage) => {
      if (isDragging) return;
      if (nextStage === safeFocusedStage) return;
      animationRef.current?.cancel();
      pendingFlipRectRef.current =
        focusedColumnRef.current?.getBoundingClientRect() ?? null;
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
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (isDragging) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        snapByDirection(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        snapByDirection(1);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDragging, snapByDirection]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const horizontalIntent =
        Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const shiftedWheelIntent =
        event.shiftKey && Math.abs(event.deltaY) > 0 && event.deltaX === 0;

      if (!horizontalIntent && !shiftedWheelIntent) return;
      if (isDragging) return;

      const now = Date.now();
      if (now - lastSnapAtRef.current < SNAP_DEBOUNCE_MS) return;
      lastSnapAtRef.current = now;
      event.preventDefault();

      const delta = horizontalIntent ? event.deltaX : event.deltaY;
      snapByDirection(delta > 0 ? 1 : -1);
    },
    [isDragging, snapByDirection]
  );

  const leftStages = ACTIVE_STAGE_ORDER.filter(
    (stage) => ACTIVE_STAGE_ORDER.indexOf(stage) < focusedIndex
  );
  const rightStages = ACTIVE_STAGE_ORDER.filter(
    (stage) => ACTIVE_STAGE_ORDER.indexOf(stage) > focusedIndex
  );
  const focusedOpportunities =
    opportunitiesByStage.get(safeFocusedStage) ?? [];
  const wonOpportunities =
    opportunitiesByStage.get(OpportunityStage.Won) ?? [];
  const lostOpportunities =
    opportunitiesByStage.get(OpportunityStage.Lost) ?? [];

  return (
    <div
      className="h-full w-full overflow-hidden bg-background px-[44px] pb-[36px] pt-[176px]"
      onWheel={handleWheel}
    >
      <div className="flex h-full min-h-0 items-stretch justify-center gap-2 overflow-hidden">
        <div className="flex min-h-0 shrink-0 items-stretch gap-2">
          {leftStages.map((stage) => (
            <SpineSlot
              key={stage}
              stage={stage}
              focusedIndex={focusedIndex}
              stageIndex={ACTIVE_STAGE_ORDER.indexOf(stage)}
              opportunities={opportunitiesByStage.get(stage) ?? []}
              panelId={focusedPanelId}
              onFocusStage={snapToStage}
            />
          ))}
        </div>

        <div ref={focusedColumnRef} className="min-h-0 shrink-0">
          <PipelineFocusedColumn
            stage={safeFocusedStage}
            opportunities={focusedOpportunities}
            clientNameMap={clientNameMap}
            canManage={canManage}
            filtersActive={filtersActive}
            focusedTabId={focusedTabId}
            focusedPanelId={focusedPanelId}
            onAddLead={onAddLead}
            onClearFilters={onClearFilters}
            onLogCall={onLogCall}
            onLogText={onLogText}
            onAddNote={onAddNote}
            onArchive={onArchive}
            onDiscard={onDiscard}
            onMarkWon={onMarkWon}
            onMarkLost={onMarkLost}
            onAssign={onAssign}
            onScheduleFollowUp={onScheduleFollowUp}
          />
        </div>

        <div className="flex min-h-0 shrink-0 items-stretch gap-2">
          {rightStages.map((stage) => (
            <SpineSlot
              key={stage}
              stage={stage}
              focusedIndex={focusedIndex}
              stageIndex={ACTIVE_STAGE_ORDER.indexOf(stage)}
              opportunities={opportunitiesByStage.get(stage) ?? []}
              panelId={focusedPanelId}
              onFocusStage={snapToStage}
            />
          ))}
        </div>

        <PipelineTerminalStack
          wonOpportunities={wonOpportunities}
          lostOpportunities={lostOpportunities}
          focusedStage={safeFocusedStage}
          onSelectStage={snapToStage}
        />
      </div>
    </div>
  );
}

function SpineSlot({
  stage,
  opportunities,
  stageIndex,
  focusedIndex,
  panelId,
  onFocusStage,
}: {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  stageIndex: number;
  focusedIndex: number;
  panelId: string;
  onFocusStage: (stage: OpportunityStage) => void;
}) {
  const distance = Math.min(
    3,
    Math.max(1, Math.abs(stageIndex - focusedIndex))
  ) as SpineDistanceFromFocus;
  const compactHidden = distance >= 2 ? "max-[1279px]:hidden" : "";

  return (
    <div className={compactHidden}>
      <PipelineSpineColumn
        stage={stage}
        opportunities={opportunities}
        distanceFromFocus={distance}
        isHovered={false}
        tabId={`pipeline-spine-tab-${stage}`}
        panelId={panelId}
        onFocusStage={onFocusStage}
      />
    </div>
  );
}
