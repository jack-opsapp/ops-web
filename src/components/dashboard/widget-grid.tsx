"use client";

import { type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { WidgetInstance } from "@/lib/types/dashboard-widgets";
import { WIDGET_TYPE_REGISTRY } from "@/lib/types/dashboard-widgets";
import { gridVariants, EDIT_MODE_GAP, NORMAL_GAP, SPRING_REORDER } from "@/lib/utils/motion";
import { cn } from "@/lib/utils/cn";
import { WidgetShell, COL_SPAN_CLASSES } from "./widget-shell";
import { GridPlaceholderCell } from "./grid-placeholder-cell";

const PLACEHOLDER_COUNT = 8;

interface WidgetGridProps {
  /** Map of instanceId → rendered widget content */
  children: Record<string, ReactNode>;
  /** Ordered widget instances — during drag this is the tentative order */
  orderedInstances: WidgetInstance[];
  isCustomizing?: boolean;
  activeId?: string | null;
  /** Ghost widget ID (tray drag preview in grid) */
  ghostId?: string | null;
}

export function WidgetGrid({
  children,
  orderedInstances,
  isCustomizing,
  activeId = null,
  ghostId = null,
}: WidgetGridProps) {
  const visibleInstances = orderedInstances.filter((i: WidgetInstance) => i.visible);
  const visibleIds = visibleInstances.map((i: WidgetInstance) => i.id);

  const gap = isCustomizing ? EDIT_MODE_GAP : NORMAL_GAP;

  const gridContent = (
    <motion.div
      variants={gridVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
      style={{
        gridAutoFlow: "dense",
        gridAutoRows: "160px",
        gap,
        transition: "gap 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <AnimatePresence mode="popLayout">
        {visibleInstances.map((instance: WidgetInstance) => {
          // Ghost widget — render as dashed accent placeholder, not a real WidgetShell
          if (instance.id === ghostId) {
            const ghostEntry = WIDGET_TYPE_REGISTRY[instance.typeId];
            const ghostSize = ghostEntry?.defaultSize ?? "sm";
            return (
              <motion.div
                key={instance.id}
                layout={false}
                layoutId={instance.id}
                transition={SPRING_REORDER}
                className={cn(
                  COL_SPAN_CLASSES[ghostSize],
                  "rounded-md flex items-center justify-center bg-ops-accent/5"
                )}
                style={{ minHeight: 160 }}
              >
                <span className="font-mohave text-[11px] text-ops-accent/60">
                  {ghostEntry?.label ?? "Widget"}
                </span>
              </motion.div>
            );
          }

          return (
            <WidgetShell
              key={instance.id}
              instanceId={instance.id}
              typeId={instance.typeId}
              size={instance.size}
              isCustomizing={isCustomizing}
              isDragActive={activeId !== null}
              isBeingDragged={activeId === instance.id}
            >
              {children[instance.id] ?? null}
            </WidgetShell>
          );
        })}
      </AnimatePresence>

      {/* Placeholder cells — fill vacant 1x1 areas during edit mode */}
      <AnimatePresence>
        {isCustomizing &&
          Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => (
            <GridPlaceholderCell
              key={`placeholder__${i}`}
              id={`placeholder__${i}`}
              index={i}
            />
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
