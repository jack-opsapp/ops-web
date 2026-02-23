"use client";

import { type ReactNode, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { usePreferencesStore } from "@/stores/preferences-store";
import type { DashboardWidgetId } from "@/lib/types/dashboard-widgets";
import { gridVariants } from "@/lib/utils/motion";
import { WidgetShell } from "./widget-shell";

interface WidgetGridProps {
  children: Record<DashboardWidgetId, ReactNode>;
  isCustomizing?: boolean;
}

export function WidgetGrid({ children, isCustomizing }: WidgetGridProps) {
  const widgetConfigs = usePreferencesStore((s) => s.widgetConfigs);
  const widgetOrder = usePreferencesStore((s) => s.widgetOrder);
  const setWidgetOrder = usePreferencesStore((s) => s.setWidgetOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const visibleOrder = widgetOrder.filter((id) => widgetConfigs[id]?.visible);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = widgetOrder.indexOf(active.id as DashboardWidgetId);
      const newIndex = widgetOrder.indexOf(over.id as DashboardWidgetId);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = [...widgetOrder];
      newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, active.id as DashboardWidgetId);
      setWidgetOrder(newOrder);
    },
    [widgetOrder, setWidgetOrder]
  );

  const gridContent = (
    <motion.div
      variants={gridVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2"
      style={{ gridAutoFlow: "dense" }}
    >
      <AnimatePresence mode="popLayout">
        {visibleOrder.map((id) => {
          const config = widgetConfigs[id];
          return (
            <WidgetShell
              key={id}
              widgetId={id}
              size={config.size}
              isCustomizing={isCustomizing}
            >
              {children[id]}
            </WidgetShell>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );

  // Only wrap with DndContext when customizing to avoid overhead during normal use
  if (isCustomizing) {
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visibleOrder} strategy={rectSortingStrategy}>
          {gridContent}
        </SortableContext>
      </DndContext>
    );
  }

  return gridContent;
}
