"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils/cn";
import { usePreferencesStore } from "@/stores/preferences-store";
import type { WidgetSize, WidgetTypeId } from "@/lib/types/dashboard-widgets";
import { WIDGET_TYPE_REGISTRY, WIDGET_SIZE_LABELS } from "@/lib/types/dashboard-widgets";
import {
  SPRING_REORDER,
  EASE_SMOOTH,
  editModeOverlayVariants,
  DRAG_SIBLING_SCALE,
  DRAG_SIBLING_SATURATION,
  DRAG_SIBLING_OPACITY,
} from "@/lib/utils/motion";

// Static Tailwind class maps for purge safety
export const COL_SPAN_CLASSES: Record<WidgetSize, string> = {
  xs: "col-span-1 2xl:col-span-2",
  sm: "col-span-2 2xl:col-span-3",
  md: "col-span-2 md:col-span-4 2xl:col-span-6",
  lg: "col-span-2 md:col-span-4 2xl:col-span-6",
  full: "col-span-2 md:col-span-4 xl:col-span-8 2xl:col-span-12",
};

const ROW_SPAN_CLASSES: Record<WidgetSize, string> = {
  xs: "",
  sm: "",
  md: "",
  lg: "row-span-2",
  full: "",
};

interface WidgetShellProps {
  instanceId: string;
  typeId: WidgetTypeId;
  size: WidgetSize;
  config?: Record<string, unknown>;
  isCustomizing?: boolean;
  isDragActive?: boolean;
  isBeingDragged?: boolean;
  children: ReactNode;
}

export function WidgetShell({
  instanceId,
  typeId,
  size,
  config,
  isCustomizing,
  isDragActive,
  isBeingDragged,
  children,
}: WidgetShellProps) {
  const updateWidgetInstance = usePreferencesStore((s) => s.updateWidgetInstance);
  const removeWidgetInstance = usePreferencesStore((s) => s.removeWidgetInstance);

  const {
    attributes,
    listeners,
    setNodeRef,
  } = useSortable({
    id: instanceId,
    disabled: !isCustomizing,
    // Disable dnd-kit's built-in CSS transforms — Framer Motion handles positioning
    transition: null,
  });

  const entry = WIDGET_TYPE_REGISTRY[typeId];
  const isSpacer = typeId === "spacer";
  const hasMultipleSizes = !isSpacer && entry && entry.supportedSizes.length > 1;

  // Spacer uses custom grid spans from config instead of preset size classes
  const spacerColSpan = isSpacer ? ((config?.colSpan as number) ?? 2) : undefined;
  const spacerRowSpan = isSpacer ? ((config?.rowSpan as number) ?? 1) : undefined;

  // Compute animation state — GPU-composited only (transform, opacity, filter)
  const animateState = useMemo(() => {
    if (isBeingDragged) {
      // Invisible in-place — overlay shows the "grabbed" copy
      return { scale: 0.95, opacity: 0, filter: "saturate(0.3)" };
    }
    if (isDragActive) {
      // Sibling: shrink + desaturate more
      return {
        scale: DRAG_SIBLING_SCALE,
        opacity: DRAG_SIBLING_OPACITY,
        filter: `saturate(${DRAG_SIBLING_SATURATION})`,
      };
    }
    if (isCustomizing) {
      // Edit mode resting — no scale (avoids inconsistent visual shrink across widget sizes)
      return { scale: 1, opacity: 1, filter: "saturate(0.7)" };
    }
    // Normal
    return { scale: 1, opacity: 1, filter: "saturate(1)" };
  }, [isBeingDragged, isDragActive, isCustomizing]);

  return (
    <motion.div
      ref={setNodeRef}
      layout={!isDragActive}
      layoutId={instanceId}
      animate={animateState}
      transition={SPRING_REORDER}
      className={cn(
        !isSpacer && COL_SPAN_CLASSES[size],
        !isSpacer && ROW_SPAN_CLASSES[size],
        "relative group/widget h-full overflow-hidden",
        isCustomizing && "ring-1 ring-border-medium rounded-md cursor-grab active:cursor-grabbing"
      )}
      style={isSpacer ? {
        gridColumn: `span ${spacerColSpan}`,
        gridRow: `span ${spacerRowSpan}`,
      } : undefined}
      data-widget-id={instanceId}
      data-widget-type={typeId}
      data-widget-size={size}
      {...(isCustomizing ? { ...attributes, ...listeners } : {})}
    >
      {/* Wrap children so widget content is non-interactive during edit mode */}
      <div className={cn("h-full", isCustomizing && "pointer-events-none")}>
        {children}
      </div>

      {/* Dark overlay during edit mode */}
      <AnimatePresence>
        {isCustomizing && !isBeingDragged && (
          <motion.div
            variants={editModeOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute inset-0 bg-border rounded-md pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Inline customization toolbar — floats at top of widget */}
      <AnimatePresence>
        {isCustomizing && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            className="absolute top-[6px] right-[6px] z-10 flex items-center gap-[4px] rounded-md px-[3px] py-[2px] pointer-events-auto"
            style={{
              background: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Size pills */}
            {hasMultipleSizes &&
              entry.supportedSizes.map((s: WidgetSize) => {
                const isSelected = size === s;
                return (
                  <button
                    key={s}
                    onClick={() => updateWidgetInstance(instanceId, { size: s })}
                    className={cn(
                      "px-[8px] py-[2px] rounded-sm font-mono text-[10px] border transition-all duration-150",
                      isSelected
                        ? "bg-ops-accent-muted border-ops-accent text-text-primary"
                        : "border-transparent text-text-disabled"
                    )}
                  >
                    {WIDGET_SIZE_LABELS[s]}
                  </button>
                );
              })}

            {/* Remove button */}
            <button
              onClick={() => removeWidgetInstance(instanceId)}
              className="p-[3px] rounded-sm text-text-disabled hover:text-ops-error transition-all duration-150"
              title={`Remove ${entry?.label ?? "widget"}`}
            >
              <Trash2 className="w-[12px] h-[12px]" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
