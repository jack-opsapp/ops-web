"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";
import { EyeOff, GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils/cn";
import { usePreferencesStore } from "@/stores/preferences-store";
import type { WidgetSize, DashboardWidgetId } from "@/lib/types/dashboard-widgets";
import { WIDGET_REGISTRY, WIDGET_SIZE_LABELS } from "@/lib/types/dashboard-widgets";
import { SPRING_LAYOUT, widgetVariants, EASE_SMOOTH } from "@/lib/utils/motion";

// Static Tailwind class maps for purge safety
const COL_SPAN_CLASSES: Record<WidgetSize, string> = {
  sm: "col-span-1",
  md: "col-span-1 md:col-span-2",
  lg: "col-span-1 md:col-span-2",
  full: "col-span-1 md:col-span-2 xl:col-span-4",
};

const ROW_SPAN_CLASSES: Record<WidgetSize, string> = {
  sm: "",
  md: "",
  lg: "row-span-2",
  full: "",
};

interface WidgetShellProps {
  widgetId: DashboardWidgetId;
  size: WidgetSize;
  isCustomizing?: boolean;
  children: ReactNode;
}

export function WidgetShell({ widgetId, size, isCustomizing, children }: WidgetShellProps) {
  const setWidgetSize = usePreferencesStore((s) => s.setWidgetSize);
  const setWidgetVisible = usePreferencesStore((s) => s.setWidgetVisible);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: widgetId,
    disabled: !isCustomizing,
  });

  const entry = WIDGET_REGISTRY[widgetId];
  const hasMultipleSizes = entry && entry.supportedSizes.length > 1;

  // Merge dnd-kit transform with Framer Motion layout
  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <motion.div
      ref={setNodeRef}
      layout
      layoutId={widgetId}
      variants={widgetVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={SPRING_LAYOUT}
      style={sortableStyle}
      className={cn(
        COL_SPAN_CLASSES[size],
        ROW_SPAN_CLASSES[size],
        "relative group/widget",
        isCustomizing && "ring-1 ring-border-medium rounded-md",
        isDragging && "opacity-80 ring-ops-accent"
      )}
      data-widget-id={widgetId}
      data-widget-size={size}
    >
      {children}

      {/* Inline customization toolbar — floats at top of widget */}
      <AnimatePresence>
        {isCustomizing && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            className="absolute top-[6px] right-[6px] z-10 flex items-center gap-[4px]"
          >
            {/* Drag handle */}
            <button
              {...attributes}
              {...listeners}
              className="p-[3px] rounded-sm bg-[rgba(25,25,25,0.85)] backdrop-blur-sm text-text-disabled hover:text-text-secondary border border-transparent hover:border-border-medium transition-all duration-150 cursor-grab active:cursor-grabbing"
              title="Drag to reorder"
            >
              <GripVertical className="w-[12px] h-[12px]" />
            </button>

            {/* Size pills */}
            {hasMultipleSizes &&
              entry.supportedSizes.map((s: WidgetSize) => {
                const isSelected = size === s;
                return (
                  <button
                    key={s}
                    onClick={() => setWidgetSize(widgetId, s)}
                    className={cn(
                      "px-[8px] py-[2px] rounded-sm font-mono text-[10px] border transition-all duration-150",
                      isSelected
                        ? "bg-ops-accent-muted border-ops-accent text-text-primary"
                        : "bg-[rgba(25,25,25,0.85)] text-text-disabled border-transparent hover:border-border-medium backdrop-blur-sm"
                    )}
                  >
                    {WIDGET_SIZE_LABELS[s]}
                  </button>
                );
              })}

            {/* Hide button */}
            <button
              onClick={() => setWidgetVisible(widgetId, false)}
              className="p-[3px] rounded-sm bg-[rgba(25,25,25,0.85)] backdrop-blur-sm text-text-disabled hover:text-ops-error border border-transparent hover:border-ops-error/30 transition-all duration-150"
              title={`Hide ${entry?.label ?? "widget"}`}
            >
              <EyeOff className="w-[12px] h-[12px]" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
