"use client";

import { useMemo, useState, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Opportunity } from "@/lib/types/pipeline";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Token-based bar colors (cycled per source)
// ---------------------------------------------------------------------------
const BAR_COLORS = [
  WT.accent,
  WT.warning,
  WT.success,
  WT.accentMuted,
  WT.receivables,
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
  opportunities: Opportunity[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function LeadSourcesWidget({
  size,
  opportunities,
  isLoading,
  onNavigate,
}: LeadSourcesWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

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
    const activeOpps = opportunities.filter((o) => !o.deletedAt);

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

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("leadSources.title") ?? "Lead Sources"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (sourceData.sources.length === 0) {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/pipeline")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("leadSources.title") ?? "Lead Sources"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${heroClass} font-bold text-text-disabled leading-none`}>
              0
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("leadSources.noSources") ?? "No lead sources yet"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("leadSources.viewPipeline") ?? "View Pipeline"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── XS: Hero = top source name + count ─────────────────────────────────
  if (size === "xs") {
    const top = sourceData.sources[0];
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/pipeline")}>
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none text-text-primary">
            {top.count}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("leadSources.title") ?? "Lead Sources"}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {top.label}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + top source ────────────────────────────────────────
  if (size === "sm") {
    const top = sourceData.sources[0];
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
              {sourceData.total}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/pipeline"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("leadSources.title") ?? "Lead Sources"}
          </span>
          {/* Row 3: Top source */}
          {top && (
            <span className="font-mohave text-caption-sm text-text-secondary mt-0.5 truncate">
              #1: {top.label} ({top.count})
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: Horizontal bar chart + tooltip + footer ───────────────────
  const maxBars = showActions(size) ? 8 : 5;
  const barHeight = compact ? 6 : showActions(size) ? 10 : 8;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("leadSources.title") ?? "Lead Sources"}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {sourceData.total} total
          </span>
        </div>

        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade className="relative">
            <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
              <TooltipRow label={tooltip.source} value={`${tooltip.count}`} />
              <TooltipRow label={t("leadSources.ofTotal") ?? "of total"} value={`${tooltip.pct}%`} />
              {tooltip.value > 0 && (
                <TooltipRow label={t("leadSources.pipelineValue") ?? "Pipeline value"} value={formatCurrency(tooltip.value)} />
              )}
            </WidgetTooltip>

            <div className="flex flex-col gap-[6px]">
              {sourceData.sources.slice(0, maxBars).map((s, i) => {
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
                      <span className="font-mohave text-caption-sm text-text-secondary">{s.label}</span>
                      <span className="font-mono text-micro text-text-tertiary">{s.count}</span>
                    </div>
                    <div className="rounded-sm overflow-hidden" style={{ height: `${barHeight}px`, backgroundColor: WT.faint }}>
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
              {sourceData.sources.length > maxBars && (
                <span className="font-mono text-micro-sm text-text-tertiary">
                  +{sourceData.sources.length - maxBars} {t("leadSources.more") ?? "more"}
                </span>
              )}
            </div>
          </ScrollFade>
        )}

        {/* FOOTER */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/pipeline")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("leadSources.viewPipeline") ?? "View Pipeline"}
          </button>
        )}
      </div>
    </Card>
  );
}
