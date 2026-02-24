"use client";

import { type ReactNode, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type DragCancelEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { usePreferencesStore } from "@/stores/preferences-store";
import type { WidgetInstance } from "@/lib/types/dashboard-widgets";
import { gridVariants } from "@/lib/utils/motion";
import { cn } from "@/lib/utils/cn";
import { WidgetShell } from "./widget-shell";

interface WidgetGridProps {
  /** Map of instanceId → rendered widget content */
  children: Record<string, ReactNode>;
  isCustomizing?: boolean;
}

export function WidgetGrid({ children, isCustomizing }: WidgetGridProps) {
  const widgetInstances = usePreferencesStore((s) => s.widgetInstances);
  const reorderWidgetInstances = usePreferencesStore((s) => s.reorderWidgetInstances);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const visibleInstances = widgetInstances.filter((i: WidgetInstance) => i.visible);
  const visibleIds = visibleInstances.map((i: WidgetInstance) => i.id);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverId(event.over?.id as string | null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setOverId(null);

      if (!over || active.id === over.id) return;

      const allIds = widgetInstances.map((i: WidgetInstance) => i.id);
      const oldIndex = allIds.indexOf(active.id as string);
      const newIndex = allIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = [...allIds];
      newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, active.id as string);
      reorderWidgetInstances(newOrder);
    },
    [widgetInstances, reorderWidgetInstances]
  );

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveId(null);
    setOverId(null);
  }, []);

  const gridContent = (
    <motion.div
      variants={gridVariants}
      initial="hidden"
      animate="visible"
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2",
        activeId && "widget-grid-lines"
      )}
      style={{ gridAutoFlow: "dense", gridAutoRows: "160px" }}
    >
      <AnimatePresence mode="popLayout">
        {visibleInstances.map((instance: WidgetInstance) => (
          <WidgetShell
            key={instance.id}
            instanceId={instance.id}
            typeId={instance.typeId}
            size={instance.size}
            isCustomizing={isCustomizing}
            isDragActive={activeId !== null}
            isBeingDragged={activeId === instance.id}
            isDropTarget={overId === instance.id && activeId !== instance.id}
          >
            {children[instance.id] ?? null}
          </WidgetShell>
        ))}
      </AnimatePresence>
    </motion.div>
  );

  // Only wrap with DndContext when customizing to avoid overhead during normal use
  if (isCustomizing) {
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={visibleIds} strategy={rectSortingStrategy}>
          {gridContent}
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeId ? (
            <div
              className="rounded-md ring-2 ring-ops-accent shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-none"
              style={{ opacity: 0.95 }}
            >
              {children[activeId] ?? null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    );
  }

  return gridContent;
}
