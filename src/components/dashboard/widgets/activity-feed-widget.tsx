"use client";

import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { isCompact, showFooter } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

interface ActivityWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  onNavigate: (path: string) => void;
}

export function ActivityWidget({ size, config, onNavigate }: ActivityWidgetProps) {
  const { t } = useDictionary("dashboard");

  // ── XS / SM: Hero-first placeholder ─────────────────────────────────────
  if (isCompact(size)) {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero + tiny nav icon (SM only) */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold text-text-disabled leading-none">
              —
            </span>
            {showFooter(size) && (
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/activity"); }}
                className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
              </button>
            )}
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("activity.title") ?? "Activity"}
          </span>
          {/* Row 3: Subtitle */}
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase mt-0.5">
            {t("activity.comingSoon") ?? "Coming soon"}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD+: Placeholder list ──────────────────────────────────────────────
  return (
    <Card className="h-full p-0">
      <div className="h-full flex flex-col p-3">
        <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
          {t("activity.title") ?? "Activity"}
        </span>
        <div className="flex-1 flex flex-col justify-center">
          <span className="font-mohave text-caption-sm text-text-disabled">
            {t("activity.comingSoon") ?? "Activity feed coming soon"}
          </span>
        </div>
        <button
          onClick={() => onNavigate("/activity")}
          className="mt-auto pt-1 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
        >
          {t("activity.viewAll") ?? "View Activity"}
        </button>
      </div>
    </Card>
  );
}
