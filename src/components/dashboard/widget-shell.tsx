"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { WidgetSize, DashboardWidgetId } from "@/lib/types/dashboard-widgets";
import { SPRING_LAYOUT, widgetVariants } from "@/lib/utils/motion";

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
  children: ReactNode;
}

export function WidgetShell({ widgetId, size, children }: WidgetShellProps) {
  return (
    <motion.div
      layout
      layoutId={widgetId}
      variants={widgetVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={SPRING_LAYOUT}
      className={`${COL_SPAN_CLASSES[size]} ${ROW_SPAN_CLASSES[size]}`.trim()}
      data-widget-id={widgetId}
      data-widget-size={size}
    >
      {children}
    </motion.div>
  );
}
