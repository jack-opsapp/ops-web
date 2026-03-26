"use client";

import { type ReactNode, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { WidgetInstance } from "@/lib/types/dashboard-widgets";
import { WIDGET_TYPE_REGISTRY } from "@/lib/types/dashboard-widgets";
import { gridVariants, EDIT_MODE_GAP, SPRING_REORDER } from "@/lib/utils/motion";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { usePreferencesStore, WIDGET_GAP_VALUES } from "@/stores/preferences-store";
import { WidgetShell, COL_SPAN_CLASSES } from "./widget-shell";
import { GridPlaceholderCell } from "./grid-placeholder-cell";

// ---------------------------------------------------------------------------
// Entry stagger animation
// ---------------------------------------------------------------------------
function getEntryStyle(
  index: number,
  hasEntered: boolean,
  reducedMotion: boolean
): React.CSSProperties {
  return {
    opacity: hasEntered ? 1 : 0,
    transform: hasEntered ? "translateY(0)" : "translateY(12px)",
    transition: reducedMotion
      ? "opacity 200ms ease"
      : `opacity 400ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 60}ms, transform 400ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 60}ms`,
  };
}

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
  const { t } = useDictionary("dashboard");
  const widgetGap = usePreferencesStore((s) => s.widgetGap);
  const visibleInstances = orderedInstances.filter((i: WidgetInstance) => i.visible);
  const visibleIds = visibleInstances.map((i: WidgetInstance) => i.id);

  // Entry stagger: trigger on mount
  const [hasEntered, setHasEntered] = useState(false);
  useEffect(() => { setHasEntered(true); }, []);
  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  // During customize mode, use the wider edit gap for comfortable dragging.
  // In normal mode, use the user's preference.
  const gap = isCustomizing ? EDIT_MODE_GAP : WIDGET_GAP_VALUES[widgetGap];

  const gridContent = (
    <motion.div
      variants={gridVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 2xl:grid-cols-12"
      style={{
        gridAutoFlow: "dense",
        gridAutoRows: "140px",
        gap,
        transition: "gap 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <AnimatePresence mode="popLayout">
        {visibleInstances.map((instance: WidgetInstance, index: number) => {
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
                style={{ minHeight: 140 }}
              >
                <span className="font-mohave text-[11px] text-ops-accent/60">
                  {ghostEntry?.label ?? t("grid.widgetFallback")}
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
              config={instance.config}
              isCustomizing={isCustomizing}
              isDragActive={activeId !== null}
              isBeingDragged={activeId === instance.id}
              entryStyle={isCustomizing ? undefined : getEntryStyle(index, hasEntered, reducedMotion)}
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
