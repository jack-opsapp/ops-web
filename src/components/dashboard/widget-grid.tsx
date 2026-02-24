"use client";

import { type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { usePreferencesStore } from "@/stores/preferences-store";
import type { WidgetInstance } from "@/lib/types/dashboard-widgets";
import { gridVariants } from "@/lib/utils/motion";
import { cn } from "@/lib/utils/cn";
import { WidgetShell } from "./widget-shell";

interface WidgetGridProps {
  /** Map of instanceId → rendered widget content */
  children: Record<string, ReactNode>;
  isCustomizing?: boolean;
  activeId?: string | null;
  overId?: string | null;
}

export function WidgetGrid({ children, isCustomizing, activeId = null, overId = null }: WidgetGridProps) {
  const widgetInstances = usePreferencesStore((s) => s.widgetInstances);

  const visibleInstances = widgetInstances.filter((i: WidgetInstance) => i.visible);
  const visibleIds = visibleInstances.map((i: WidgetInstance) => i.id);

  const gridContent = (
    <motion.div
      variants={gridVariants}
      initial="hidden"
      animate="visible"
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2",
        (isCustomizing || activeId) && "widget-grid-lines"
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

  // When customizing, wrap with SortableContext (DndContext is owned by parent page)
  if (isCustomizing) {
    return (
      <SortableContext items={visibleIds} strategy={rectSortingStrategy}>
        {gridContent}
      </SortableContext>
    );
  }

  return gridContent;
}
