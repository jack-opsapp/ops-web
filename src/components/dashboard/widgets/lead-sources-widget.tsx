"use client";

import { useMemo, useState, useRef } from "react";
import { Radio } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Opportunity } from "@/lib/types/pipeline";
import { useOpportunities } from "@/lib/hooks";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BAR_COLORS = [
  "#597794",  // accent steel
  "#C4A868",  // amber
  "#6B8F71",  // muted green
  "#8195B5",  // light steel
  "#9B8BA0",  // dusty mauve
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatSourceLabel(source: string): string {
  return source
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface LeadSourcesWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function LeadSourcesWidget({ size }: LeadSourcesWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { data: opportunities, isLoading } = useOpportunities();
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    source: string;
    count: number;
    pct: number;
    value: number;
  }>({ visible: false, x: 0, y: 0, source: "", count: 0, pct: 0, value: 0 });

  const sourceData = useMemo(() => {
    if (!opportunities) return { sources: [], total: 0 };

    const activeOpps = opportunities.filter((o: Opportunity) => !o.deletedAt);

    // Group by source
    const map = new Map<string, { count: number; value: number }>();
    for (const opp of activeOpps) {
      const source = opp.source ?? "other";
      const existing = map.get(source) ?? { count: 0, value: 0 };
      existing.count++;
      existing.value += opp.estimatedValue ?? 0;
      map.set(source, existing);
    }

    const total = activeOpps.length;
    const sources = Array.from(map.entries())
      .map(([source, data]) => ({
        source,
        label: formatSourceLabel(source),
        count: data.count,
        value: data.value,
        pct: total > 0 ? Math.round((data.count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return { sources, total };
  }, [opportunities]);

  const maxCount = sourceData.sources[0]?.count ?? 1;

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("leadSources.title") ?? "Lead Sources"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </CardContent>
      </Card>
    );
  }

  if (sourceData.sources.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("leadSources.title") ?? "Lead Sources"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 flex items-center justify-center h-[calc(100%-28px)]">
          <span className="font-mohave text-[13px] text-text-tertiary">No lead sources yet</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full" ref={ref}>
      <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("leadSources.title") ?? "Lead Sources"}
        </CardTitle>
        <span className="font-mono text-[11px] text-text-tertiary">
          {sourceData.total} total
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden relative">
        <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchor="above">
          <TooltipRow label={tooltip.source} value={`${tooltip.count}`} />
          <TooltipRow label={t("leadSources.ofTotal") ?? "of total"} value={`${tooltip.pct}%`} />
          {tooltip.value > 0 && (
            <TooltipRow label="Pipeline value" value={formatCurrency(tooltip.value)} />
          )}
        </WidgetTooltip>

        <div className="flex flex-col gap-[6px]">
          {sourceData.sources.slice(0, 5).map((s, i) => {
            const barWidth = Math.max((s.count / maxCount) * 100, 4);
            const color = BAR_COLORS[i % BAR_COLORS.length];

            return (
              <div
                key={s.source}
                onMouseEnter={(e) => {
                  const parentRect = ref.current?.getBoundingClientRect();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  if (!parentRect) return;
                  setTooltip({
                    visible: true,
                    x: rect.left - parentRect.left + rect.width / 2,
                    y: rect.top - parentRect.top,
                    source: s.label,
                    count: s.count,
                    pct: s.pct,
                    value: s.value,
                  });
                }}
                onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
              >
                <div className="flex items-center justify-between mb-[2px]">
                  <span className="font-mohave text-[11px] text-text-secondary">{s.label}</span>
                  <span className="font-mono text-[11px] text-text-tertiary">{s.count}</span>
                </div>
                <div className="h-[6px] rounded-sm bg-[rgba(255,255,255,0.04)] overflow-hidden">
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{
                      width: isVisible ? `${barWidth}%` : "0%",
                      backgroundColor: color,
                      transitionDuration: reducedMotion ? "200ms" : "500ms",
                      transitionDelay: reducedMotion ? "0ms" : `${i * 60}ms`,
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  />
                </div>
              </div>
            );
          })}
          {sourceData.sources.length > 5 && (
            <span className="font-mono text-[10px] text-text-tertiary">
              +{sourceData.sources.length - 5} more
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
