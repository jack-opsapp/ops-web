"use client";

import { useMemo, useState, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { Sparkline } from "./shared/sparkline";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { widgetLineItemStyle } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import { formatCompactCurrency } from "./shared/widget-utils";
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

// ---------------------------------------------------------------------------
// Donut Chart (SVG)
// ---------------------------------------------------------------------------
function DonutChart({
  segments,
  size: diameter,
  strokeWidth = 8,
  isVisible,
  reducedMotion,
}: {
  segments: { value: number; color: string }[];
  size: number;
  strokeWidth?: number;
  isVisible: boolean;
  reducedMotion: boolean | null;
}) {
  const radius = (diameter - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  let accumulated = 0;

  return (
    <svg width={diameter} height={diameter} viewBox={`0 0 ${diameter} ${diameter}`}>
      {segments.map((seg, i) => {
        const pct = seg.value / total;
        const dashLen = circumference * pct;
        const dashGap = circumference - dashLen;
        const offset = -circumference * accumulated;
        accumulated += pct;

        return (
          <circle
            key={i}
            cx={diameter / 2}
            cy={diameter / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            style={{
              stroke: seg.color,
              strokeDasharray: `${dashLen} ${dashGap}`,
              strokeDashoffset: isVisible || reducedMotion ? offset : circumference,
              transition: reducedMotion ? "none" : `stroke-dashoffset 600ms ${WIDGET_EASE_CSS} ${i * 60}ms`,
              transform: "rotate(-90deg)",
              transformOrigin: "center",
            }}
          />
        );
      })}
    </svg>
  );
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

  const reducedMotion = useReducedMotion();

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

  // ── Per-source monthly trends (LG only) ─────────────────────────────
  const sourceTrends = useMemo(() => {
    if (!showActions(size)) return new Map<string, number[]>();
    const now = new Date();
    const trends = new Map<string, number[]>();
    for (const src of sourceData.sources) {
      const points: number[] = [];
      for (let i = 5; i >= 0; i--) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const count = opportunities.filter((o) => {
          if (o.deletedAt) return false;
          const source = o.source ?? "other";
          if (source !== src.source) return false;
          const created = new Date(o.createdAt);
          return created >= monthStart && created < monthEnd;
        }).length;
        points.push(count);
      }
      trends.set(src.source, points);
    }
    return trends;
  }, [opportunities, sourceData.sources, size]);

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

  // ── SM: Hero + background donut ──────────────────────────────────────
  if (size === "sm") {
    const top = sourceData.sources[0];
    const donutSegments = sourceData.sources.slice(0, 4).map((s, i) => ({
      value: s.count,
      color: BAR_COLORS[i % BAR_COLORS.length],
    }));
    const otherCount = sourceData.sources.slice(4).reduce((sum, s) => sum + s.count, 0);
    if (otherCount > 0) donutSegments.push({ value: otherCount, color: WT.muted });

    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={
            <div className="h-full w-full flex items-center justify-end pr-2">
              <DonutChart
                segments={donutSegments}
                size={80}
                isVisible={isVisible}
                reducedMotion={reducedMotion}
              />
            </div>
          }
          opacity={0.35}
        >
          <div className="h-full flex flex-col p-3">
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
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("leadSources.title") ?? "Lead Sources"}
            </span>
            {top && (
              <span className="font-mohave text-caption-sm text-text-secondary mt-0.5 truncate">
                #1: {top.label} ({top.count})
              </span>
            )}
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }

  // ── MD / LG: Horizontal bar chart + tooltip + LG trendlines + footer ──
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
            {sourceData.total} {t("leadSources.total") ?? "total"}
          </span>
        </div>

        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade className="relative">
            <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
              <TooltipRow label={tooltip.source} value={`${tooltip.count}`} />
              <TooltipRow label={t("leadSources.ofTotal") ?? "of total"} value={`${tooltip.pct}%`} />
              {tooltip.value > 0 && (
                <TooltipRow label={t("leadSources.pipelineValue") ?? "Pipeline value"} value={formatCompactCurrency(tooltip.value)} />
              )}
            </WidgetTooltip>

            {/* Bar chart — compressed in LG when trends visible */}
            <WidgetHeroCollapse collapsed={showActions(size)} collapsedHeight="80px">
              <div className="flex flex-col gap-[6px]">
                {sourceData.sources.slice(0, maxBars).map((s, i) => {
                  const barWidth = Math.max((s.count / maxCount) * 100, 4);
                  const barColor = BAR_COLORS[i % BAR_COLORS.length];

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
                          className="h-full rounded-sm"
                          style={{
                            width: isVisible ? `${barWidth}%` : "0%",
                            backgroundColor: barColor,
                            transitionProperty: "width",
                            transitionDuration: reducedMotion ? "200ms" : "500ms",
                            transitionDelay: reducedMotion ? "0ms" : `${i * 60}ms`,
                            transitionTimingFunction: WIDGET_EASE_CSS,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
                {sourceData.sources.length > maxBars && !showActions(size) && (
                  <span className="font-mono text-micro-sm text-text-tertiary">
                    +{sourceData.sources.length - maxBars} {t("leadSources.more") ?? "more"}
                  </span>
                )}
              </div>
            </WidgetHeroCollapse>

            {/* LG: Per-source trendlines */}
            {showActions(size) && (
              <div className="mt-2 pt-2 border-t border-border-subtle flex flex-col gap-[6px]">
                {sourceData.sources.slice(0, maxBars).map((s, i) => {
                  const trend = sourceTrends.get(s.source) ?? [];
                  const barColor = BAR_COLORS[i % BAR_COLORS.length];
                  return (
                    <div
                      key={s.source}
                      className="flex items-center gap-2"
                      style={widgetLineItemStyle(i, isVisible, reducedMotion)}
                    >
                      <span
                        className="w-[6px] h-[6px] rounded-full shrink-0"
                        style={{ backgroundColor: barColor }}
                      />
                      <span className="font-mohave text-caption-sm text-text-secondary truncate min-w-0 flex-1">
                        {s.label}
                      </span>
                      <Sparkline data={trend} width={80} height={20} color={barColor} />
                      <span className="font-mono text-micro text-text-primary shrink-0 w-[24px] text-right">
                        {s.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
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
