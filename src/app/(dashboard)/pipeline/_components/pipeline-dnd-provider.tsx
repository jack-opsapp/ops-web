"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  DndContext,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { OpportunityStage, getActiveStages } from "@/lib/types/pipeline";
import type { PipelineMode } from "./pipeline-mode-types";

interface PipelineDndState {
  activeDragId: string | null;
  isDragging: boolean;
  mode: PipelineMode;
}

interface PipelineDndProviderProps {
  mode: PipelineMode;
  children: ReactNode;
  activeDragId: string | null;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: (event: DragCancelEvent) => void;
}

const PipelineDndStateContext = createContext<PipelineDndState>({
  activeDragId: null,
  isDragging: false,
  mode: "focused",
});

export const pipelineCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  const activeData = args.active.data.current as PipelineDraggableData | undefined;

  if (activeData?.mode === "focused") {
    return pointerCollisions;
  }

  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

const FOCUSED_KEYBOARD_STAGE_ORDER = [
  ...getActiveStages(),
  OpportunityStage.Won,
  OpportunityStage.Lost,
];
const FOCUSED_KEYBOARD_STAGE_SET = new Set<OpportunityStage>(
  FOCUSED_KEYBOARD_STAGE_ORDER
);
const KEYBOARD_STAGE_CODES = new Set<string>([
  KeyboardCode.Left,
  KeyboardCode.Right,
  KeyboardCode.Up,
  KeyboardCode.Down,
]);

type PipelineDraggableData = {
  mode?: PipelineMode;
  opportunity?: {
    stage?: OpportunityStage;
  };
};

type PipelineDroppableData = {
  mode?: PipelineMode;
  stage?: OpportunityStage;
};

function normalizeFocusedStage(stage: unknown): OpportunityStage | null {
  if (typeof stage !== "string") return null;
  if (!FOCUSED_KEYBOARD_STAGE_SET.has(stage as OpportunityStage)) return null;

  return stage as OpportunityStage;
}

function getKeyboardDirection(code: string): -1 | 1 | null {
  if (code === KeyboardCode.Left || code === KeyboardCode.Up) return -1;
  if (code === KeyboardCode.Right || code === KeyboardCode.Down) return 1;

  return null;
}

export const pipelineKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  args
) => {
  const activeData = (args.context.active?.data.current ??
    args.context.draggableNodes.get(args.active)?.data.current) as
    | PipelineDraggableData
    | undefined;

  if (activeData?.mode !== "focused" || !KEYBOARD_STAGE_CODES.has(event.code)) {
    return sortableKeyboardCoordinates(event, args);
  }

  const direction = getKeyboardDirection(event.code);
  if (direction === null) {
    return sortableKeyboardCoordinates(event, args);
  }

  const sourceStage = normalizeFocusedStage(activeData.opportunity?.stage);
  const overData = args.context.over?.data.current as
    | PipelineDroppableData
    | undefined;
  const overStage = normalizeFocusedStage(overData?.stage);
  const currentStage = overStage ?? sourceStage;
  if (!currentStage) return args.currentCoordinates;

  const enabledFocusedTargets = new Map<
    OpportunityStage,
    { rect: { left: number; top: number } }
  >();

  args.context.droppableContainers.getEnabled().forEach((container) => {
    const data = container.data.current as PipelineDroppableData | undefined;
    const stage = normalizeFocusedStage(data?.stage);

    if (data?.mode !== "focused" || !stage) return;

    const rect = args.context.droppableRects.get(container.id);
    if (!rect) return;

    enabledFocusedTargets.set(stage, { rect });
  });

  const currentIndex = FOCUSED_KEYBOARD_STAGE_ORDER.indexOf(currentStage);
  if (currentIndex === -1) return args.currentCoordinates;

  event.preventDefault();

  for (
    let index = currentIndex + direction;
    index >= 0 && index < FOCUSED_KEYBOARD_STAGE_ORDER.length;
    index += direction
  ) {
    const stage = FOCUSED_KEYBOARD_STAGE_ORDER[index];
    const target = enabledFocusedTargets.get(stage);
    if (!target) continue;

    return {
      x: target.rect.left,
      y: target.rect.top,
    };
  }

  return args.currentCoordinates;
};

export function PipelineDndProvider({
  mode,
  children,
  activeDragId,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
}: PipelineDndProviderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: pipelineKeyboardCoordinates,
      scrollBehavior: "auto",
    })
  );
  const state = useMemo(
    () => ({
      activeDragId,
      isDragging: activeDragId !== null,
      mode,
    }),
    [activeDragId, mode]
  );

  return (
    <PipelineDndStateContext.Provider value={state}>
      <DndContext
        sensors={sensors}
        collisionDetection={pipelineCollisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {children}
      </DndContext>
    </PipelineDndStateContext.Provider>
  );
}

export function usePipelineDndState(): PipelineDndState {
  return useContext(PipelineDndStateContext);
}
