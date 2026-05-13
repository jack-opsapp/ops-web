"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
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
        collisionDetection={closestCenter}
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
