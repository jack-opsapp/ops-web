"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent } from "@/components/ui/card";
import { usePreferencesStore } from "@/stores/preferences-store";
import { WIDGET_RENDER_ORDER, WIDGET_REGISTRY } from "@/lib/types/dashboard-widgets";
import { EASE_SMOOTH } from "@/lib/utils/motion";

interface WidgetCustomizerProps {
  open: boolean;
}

export function WidgetCustomizer({ open }: WidgetCustomizerProps) {
  const widgetConfigs = usePreferencesStore((s) => s.widgetConfigs);
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
                  Toggle Widgets
                </span>
                <button
                  onClick={resetWidgetConfigs}
                  className="flex items-center gap-[4px] font-mohave text-body-sm text-text-disabled hover:text-text-secondary transition-colors"
                >
                  <RotateCcw className="w-[12px] h-[12px]" />
                  Reset
                </button>
              </div>

              <div className="flex flex-wrap gap-[6px]">
                {WIDGET_RENDER_ORDER.map((id) => {
                  const entry = WIDGET_REGISTRY[id];
                  const config = widgetConfigs[id];
                  const isActive = config.visible;

                  return (
                    <button
                      key={id}
                      onClick={() => setWidgetVisible(id, !isActive)}
                      className={cn(
                        "flex items-center gap-[6px] px-[10px] py-[5px] rounded-md border transition-all duration-150",
                        isActive
                          ? "border-ops-accent/40 bg-ops-accent-muted text-text-primary"
                          : "border-border-subtle bg-[rgba(255,255,255,0.02)] text-text-disabled hover:border-border-medium"
                      )}
                    >
                      {isActive ? (
                        <Eye className="w-[13px] h-[13px] text-ops-accent" />
                      ) : (
                        <EyeOff className="w-[13px] h-[13px]" />
                      )}
                      <span className="font-mohave text-body-sm">{entry.label}</span>
                    </button>
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
