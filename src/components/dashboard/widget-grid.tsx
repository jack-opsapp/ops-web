"use client";

import { type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePreferencesStore } from "@/stores/preferences-store";
import type { DashboardWidgetId } from "@/lib/types/dashboard-widgets";
import { WIDGET_RENDER_ORDER } from "@/lib/types/dashboard-widgets";
import { gridVariants } from "@/lib/utils/motion";
import { WidgetShell } from "./widget-shell";

interface WidgetGridProps {
  children: Record<DashboardWidgetId, ReactNode>;
}

export function WidgetGrid({ children }: WidgetGridProps) {
  const widgetConfigs = usePreferencesStore((s) => s.widgetConfigs);

  return (
    <motion.div
      variants={gridVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2"
      style={{ gridAutoFlow: "dense" }}
    >
      <AnimatePresence mode="popLayout">
        {WIDGET_RENDER_ORDER.map((id) => {
          const config = widgetConfigs[id];
          if (!config?.visible) return null;

          return (
            <WidgetShell key={id} widgetId={id} size={config.size}>
              {children[id]}
            </WidgetShell>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
}
