"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";
import { Trash2, Info } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils/cn";
import { usePreferencesStore } from "@/stores/preferences-store";
import { WidgetCardFlip } from "./widgets/shared/widget-card-flip";
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
  xs: "col-span-1 md:col-span-1 xl:col-span-1 2xl:col-span-1",
  sm: "col-span-1 md:col-span-2 xl:col-span-2 2xl:col-span-2",
  md: "col-span-2 md:col-span-4 xl:col-span-4 2xl:col-span-6",
  lg: "col-span-2 md:col-span-4 xl:col-span-4 2xl:col-span-6",
  xl: "col-span-2 md:col-span-4 xl:col-span-4 2xl:col-span-6",
};

const ROW_SPAN_CLASSES: Record<WidgetSize, string> = {
  xs: "",
  sm: "",
  md: "row-span-2",
  lg: "row-span-4",
  xl: "row-span-6",
};

interface WidgetShellProps {
  instanceId: string;
  typeId: WidgetTypeId;
  size: WidgetSize;
  config?: Record<string, unknown>;
  isCustomizing?: boolean;
  isDragActive?: boolean;
  isBeingDragged?: boolean;
  /** CSS entry stagger style applied to the outermost grid element */
  entryStyle?: React.CSSProperties;
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
  entryStyle,
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
  const [isFlipped, setIsFlipped] = useState(false);
  const hasMultipleSizes = !isSpacer && entry && entry.supportedSizes.length > 1;

  // Spacer uses custom grid spans from config instead of preset size classes
  const spacerColSpan = isSpacer ? ((config?.colSpan as number) ?? 2) : undefined;
  const spacerRowSpan = isSpacer ? ((config?.rowSpan as number) ?? 1) : undefined;

  // Compute animation state — GPU-composited only (transform, opacity)
  // IMPORTANT: `filter` is applied via CSS (not Framer animate) because any
  // non-"none" CSS filter on a parent creates a new "backdrop root", which
  // breaks `backdrop-filter: blur()` on child elements (the frosted glass).
  // We only apply filter during edit/drag states where blur breakage is acceptable.
  const animateState = useMemo(() => {
    if (isBeingDragged) {
      return { scale: 0.95, opacity: 0 };
    }
    if (isDragActive) {
      return {
        scale: DRAG_SIBLING_SCALE,
        opacity: DRAG_SIBLING_OPACITY,
      };
    }
    return { scale: 1, opacity: 1 };
  }, [isBeingDragged, isDragActive]);

  // CSS filter for edit/drag desaturation — applied via style, not Framer animate,
  // so it can be fully removed (undefined) in normal state to preserve backdrop-filter.
  const filterStyle = useMemo((): string | undefined => {
    if (isBeingDragged) return "saturate(0.3)";
    if (isDragActive) return `saturate(${DRAG_SIBLING_SATURATION})`;
    if (isCustomizing) return "saturate(0.7)";
    return undefined; // No filter → no new backdrop root → backdrop-filter works
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
        !isSpacer && "pointer-events-auto",
        isCustomizing && !isSpacer && "ring-1 ring-border-medium rounded-md cursor-grab active:cursor-grabbing",
        isCustomizing && isSpacer && "cursor-grab active:cursor-grabbing"
      )}
      style={{
        ...(isSpacer ? {
          gridColumn: `span ${spacerColSpan}`,
          gridRow: `span ${spacerRowSpan}`,
        } : undefined),
        ...entryStyle,
        filter: filterStyle,
        transition: filterStyle !== undefined ? "filter 0.3s cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
      }}
      data-widget-id={instanceId}
      data-widget-type={typeId}
      data-widget-size={size}
      {...(isCustomizing ? { ...attributes, ...listeners } : {})}
    >
      {/* Frosted backdrop — blocks map bleed-through for all real widgets */}
      {!isSpacer && (
        <div
          className="absolute inset-0 rounded-[6px] bg-glass border border-glass-border"
          style={{
            backdropFilter: "blur(20px) saturate(1.2)",
            WebkitBackdropFilter: "blur(20px) saturate(1.2)",
          }}
        />
      )}
      {/* Widget content — wrapped in card flip for info reveal */}
      <div className={cn("h-full relative", isCustomizing && "pointer-events-none")} data-widget-content>
        {isSpacer ? (
          children
        ) : (
          <WidgetCardFlip
            front={<div className="h-full">{children}</div>}
            backContent={{
              title: entry?.label ?? typeId,
              description: entry?.description ?? "",
              dataSource: entry?.dataSource ?? "",
            }}
            isFlipped={isFlipped}
            onFlip={() => setIsFlipped((f) => !f)}
          />
        )}
      </div>

      {/* Info button — click to flip card (hidden during edit mode + on spacers) */}
      {!isSpacer && !isCustomizing && !isFlipped && (
        <button
          onClick={() => setIsFlipped(true)}
          className="absolute top-[6px] left-[6px] z-10 w-[18px] h-[18px] flex items-center justify-center rounded-sm opacity-0 group-hover/widget:opacity-100 transition-opacity text-text-mute hover:text-text-2 hover:bg-[rgba(255,255,255,0.08)]"
        >
          <Info className="w-[12px] h-[12px]" />
        </button>
      )}

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
            className="absolute top-[6px] right-[6px] z-10 flex items-center gap-[4px] rounded-md px-[3px] py-[2px] pointer-events-auto bg-glass-dense border border-glass-border"
            style={{
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
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
                        ? "bg-ops-accent-muted border-ops-accent text-text"
                        : "border-transparent text-text-mute"
                    )}
                  >
                    {WIDGET_SIZE_LABELS[s]}
                  </button>
                );
              })}

            {/* Remove button */}
            <button
              onClick={() => removeWidgetInstance(instanceId)}
              className="p-[3px] rounded-sm text-text-mute hover:text-ops-error transition-all duration-150"
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
