"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent } from "@/components/ui/card";
import { usePreferencesStore } from "@/stores/preferences-store";
import {
  WIDGET_RENDER_ORDER,
  WIDGET_REGISTRY,
  WIDGET_SIZE_LABELS,
  type WidgetSize,
} from "@/lib/types/dashboard-widgets";
import { EASE_SMOOTH } from "@/lib/utils/motion";

interface WidgetCustomizerProps {
  open: boolean;
}

export function WidgetCustomizer({ open }: WidgetCustomizerProps) {
  const widgetConfigs = usePreferencesStore((s) => s.widgetConfigs);
  const setWidgetSize = usePreferencesStore((s) => s.setWidgetSize);
  const setWidgetVisible = usePreferencesStore((s) => s.setWidgetVisible);
  const resetWidgetConfigs = usePreferencesStore((s) => s.resetWidgetConfigs);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE_SMOOTH }}
          style={{ overflow: "hidden" }}
        >
          <Card>
            <CardContent className="p-1.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Customize Widgets
                </span>
                <button
                  onClick={resetWidgetConfigs}
                  className="flex items-center gap-[4px] font-mohave text-body-sm text-text-disabled hover:text-text-secondary transition-colors"
                >
                  <RotateCcw className="w-[12px] h-[12px]" />
                  Reset
                </button>
              </div>

              <div className="space-y-[2px]">
                {WIDGET_RENDER_ORDER.map((id) => {
                  const entry = WIDGET_REGISTRY[id];
                  const config = widgetConfigs[id];
                  const isActive = config.visible;
                  const hasMultipleSizes = entry.supportedSizes.length > 1;

                  return (
                    <div
                      key={id}
                      className="flex items-center gap-1.5 px-1 py-[6px] rounded hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                    >
                      {/* Eye toggle */}
                      <button
                        onClick={() => setWidgetVisible(id, !isActive)}
                        className="shrink-0"
                      >
                        {isActive ? (
                          <Eye className="w-[16px] h-[16px] text-ops-accent" />
                        ) : (
                          <EyeOff className="w-[16px] h-[16px] text-text-disabled" />
                        )}
                      </button>

                      {/* Widget label */}
                      <span
                        className={cn(
                          "font-mohave text-body-sm flex-1 min-w-0 truncate",
                          isActive ? "text-text-primary" : "text-text-disabled"
                        )}
                      >
                        {entry.label}
                      </span>

                      {/* Size pills */}
                      {hasMultipleSizes && isActive && (
                        <div className="flex items-center gap-[4px] shrink-0">
                          {entry.supportedSizes.map((size: WidgetSize) => {
                            const isSelected = config.size === size;
                            return (
                              <button
                                key={size}
                                onClick={() => setWidgetSize(id, size)}
                                className={cn(
                                  "px-[8px] py-[2px] rounded-sm font-mono text-[10px] border transition-all duration-150",
                                  isSelected
                                    ? "bg-ops-accent-muted border-ops-accent text-text-primary"
                                    : "bg-[rgba(255,255,255,0.04)] text-text-disabled border-transparent hover:border-border-medium"
                                )}
                              >
                                {WIDGET_SIZE_LABELS[size]}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
