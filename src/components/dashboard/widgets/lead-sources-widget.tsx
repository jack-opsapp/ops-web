"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showActions, showFooter } from "@/lib/widget-tokens";
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
// Donut Chart (SVG) — supports interactive hover per segment
// ---------------------------------------------------------------------------
interface DonutSegment {
  value: number;
  color: string;
  label?: string;
  count?: number;
  pct?: number;
  pipelineValue?: number;
}

function DonutChart({
  segments,
  size: diameter,
  strokeWidth = 8,
  isVisible,
  reducedMotion,
  onSegmentHover,
  onSegmentLeave,
}: {
  segments: DonutSegment[];
  size: number;
  strokeWidth?: number;
  isVisible: boolean;
  reducedMotion: boolean | null;
  onSegmentHover?: (segment: DonutSegment, event: React.MouseEvent) => void;
  onSegmentLeave?: () => void;
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
              cursor: onSegmentHover ? "pointer" : undefined,
            }}
            onMouseEnter={onSegmentHover ? (e) => onSegmentHover(seg, e) : undefined}
            onMouseLeave={onSegmentLeave}
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Multi-line trend chart (LG) — all sources superimposed on one SVG
// ---------------------------------------------------------------------------
function MultiLineTrendChart({
  sources,
  trendData,
  width,
  height,
  isVisible,
  reducedMotion,
  onHover,
  onLeave,
}: {
  sources: { source: string; label: string; count: number; pct: number; value: number }[];
  trendData: Map<string, number[]>;
  width: number;
  height: number;
  isVisible: boolean;
  reducedMotion: boolean | null;
  onHover?: (x: number, monthIndex: number, mouseX: number, mouseY: number) => void;
  onLeave?: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const padding = { top: 4, right: 4, bottom: 4, left: 4 };
  const usableW = width - padding.left - padding.right;
  const usableH = height - padding.top - padding.bottom;

  // Find global max across all sources for consistent Y scale
  const allValues = Array.from(trendData.values()).flat();
  const globalMax = Math.max(...allValues, 1);

  // Number of data points (months)
  const numPoints = Array.from(trendData.values())[0]?.length ?? 6;
  const stepX = usableW / Math.max(numPoints - 1, 1);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || !onHover) return;
      const rect = svgRef.current.getBoundingClientRect();
      const localX = e.clientX - rect.left - padding.left;
      const monthIndex = Math.round(localX / stepX);
      const clampedIndex = Math.max(0, Math.min(numPoints - 1, monthIndex));
      const crosshairX = padding.left + clampedIndex * stepX;
      onHover(crosshairX, clampedIndex, e.clientX, e.clientY);
    },
    [onHover, stepX, numPoints, padding.left]
  );

  // Build paths for each source
  const paths = useMemo(() => {
    return sources.slice(0, 5).map((src, colorIdx) => {
      const data = trendData.get(src.source) ?? [];
      if (data.length < 2) return null;

      const points = data.map((val, i) => ({
        x: padding.left + i * stepX,
        y: padding.top + usableH - (val / globalMax) * usableH,
      }));

      // Build SVG path with smooth curves
      let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const cpx = (prev.x + curr.x) / 2;
        d += ` C${cpx.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
      }

      const color = BAR_COLORS[colorIdx % BAR_COLORS.length];
      const totalLength = width * 2;

      return (
        <path
          key={src.source}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{
            strokeDasharray: totalLength,
            strokeDashoffset: isVisible || reducedMotion ? 0 : totalLength,
            transition: reducedMotion
              ? "none"
              : `stroke-dashoffset 600ms ${WIDGET_EASE_CSS} ${colorIdx * 80}ms`,
          }}
        />
      );
    });
  }, [sources, trendData, stepX, usableH, globalMax, isVisible, reducedMotion, width, padding.left, padding.top]);

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onMouseMove={handleMouseMove}
      onMouseLeave={onLeave}
      className="cursor-crosshair"
      role="img"
      aria-label="Lead source trends"
    >
      {/* Faint gridlines */}
      {[0.25, 0.5, 0.75].map((pct) => (
        <line
          key={pct}
          x1={padding.left}
          y1={padding.top + usableH * (1 - pct)}
          x2={width - padding.right}
          y2={padding.top + usableH * (1 - pct)}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
        />
      ))}
      {paths}
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
// Period filter type
// ---------------------------------------------------------------------------
type TrendPeriod = "30d" | "90d" | "ytd";

function getPeriodMonths(period: TrendPeriod): number {
  switch (period) {
    case "30d": return 1;
    case "90d": return 3;
    case "ytd": {
      const now = new Date();
      return now.getMonth() + 1;
    }
  }
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

  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("90d");

  // Crosshair tooltip for LG chart
  const [crosshair, setCrosshair] = useState<{
    visible: boolean;
    x: number;
    viewportX: number;
    viewportY: number;
    monthIndex: number;
  }>({ visible: false, x: 0, viewportX: 0, viewportY: 0, monthIndex: 0 });

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

  // ── Per-source trends — period-aware (LG only) ─────────────────────────
  const numTrendMonths = getPeriodMonths(trendPeriod);
  const sourceTrends = useMemo(() => {
    if (!showActions(size)) return new Map<string, number[]>();
    const now = new Date();
    const months = Math.max(numTrendMonths, 2); // Need at least 2 points for a line
    const trends = new Map<string, number[]>();
    for (const src of sourceData.sources) {
      const points: number[] = [];
      for (let i = months - 1; i >= 0; i--) {
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
  }, [opportunities, sourceData.sources, size, numTrendMonths]);

  // Month labels for crosshair tooltip
  const monthLabels = useMemo(() => {
    const now = new Date();
    const months = Math.max(numTrendMonths, 2);
    const labels: string[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(m.toLocaleString("default", { month: "short" }));
    }
    return labels;
  }, [numTrendMonths]);

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

  // ── SM: Interactive donut + top 3 sources with color dots ──────────────
  if (size === "sm") {
    const top3 = sourceData.sources.slice(0, 3);
    const donutSegments: DonutSegment[] = sourceData.sources.slice(0, 4).map((s, i) => ({
      value: s.count,
      color: BAR_COLORS[i % BAR_COLORS.length],
      label: s.label,
      count: s.count,
      pct: s.pct,
      pipelineValue: s.value,
    }));
    const otherCount = sourceData.sources.slice(4).reduce((sum, s) => sum + s.count, 0);
    const otherValue = sourceData.sources.slice(4).reduce((sum, s) => sum + s.value, 0);
    if (otherCount > 0) {
      donutSegments.push({
        value: otherCount,
        color: WT.muted,
        label: t("leadSources.other") ?? "Other",
        count: otherCount,
        pct: sourceData.total > 0 ? Math.round((otherCount / sourceData.total) * 100) : 0,
        pipelineValue: otherValue,
      });
    }

    const handleSegmentHover = (seg: DonutSegment, event: React.MouseEvent) => {
      const parentRect = ref.current?.getBoundingClientRect();
      if (!parentRect) return;
      setTooltip({
        visible: true,
        x: event.clientX - parentRect.left,
        y: event.clientY - parentRect.top,
        source: seg.label ?? "",
        count: seg.count ?? 0,
        pct: seg.pct ?? 0,
        value: seg.pipelineValue ?? 0,
      });
    };

    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetTooltip
          visible={tooltip.visible}
          x={tooltip.x}
          y={tooltip.y}
          anchorRef={ref}
          anchor="above"
        >
          <TooltipRow label={tooltip.source} value={`${tooltip.count}`} />
          <TooltipRow label={t("leadSources.ofTotal") ?? "of total"} value={`${tooltip.pct}%`} />
          {tooltip.value > 0 && (
            <TooltipRow label={t("leadSources.pipelineValue") ?? "Pipeline value"} value={formatCompactCurrency(tooltip.value)} />
          )}
        </WidgetTooltip>

        <div className="h-full flex p-3">
          {/* Text content */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
                {sourceData.total}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/pipeline"); }}
                className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("leadSources.title") ?? "Lead Sources"}
            </span>
            {/* Top 3 sources with color dots */}
            <div className="flex flex-col gap-0.5 mt-1.5">
              {top3.map((s, i) => (
                <div key={s.source} className="flex items-center gap-1 min-w-0">
                  <span
                    className="w-[5px] h-[5px] rounded-full shrink-0"
                    style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                  />
                  <span className="font-mohave text-[10px] text-text-secondary truncate">
                    {s.label}
                  </span>
                  <span className="font-mono text-[9px] text-text-tertiary shrink-0">
                    {s.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {/* Interactive donut */}
          <div className="shrink-0 ml-1 flex items-center">
            <DonutChart
              segments={donutSegments}
              size={72}
              isVisible={isVisible}
              reducedMotion={reducedMotion}
              onSegmentHover={handleSegmentHover}
              onSegmentLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
            />
          </div>
        </div>
      </Card>
    );
  }

  // ── MD: Horizontal bar chart with tooltip ─────────────────────────────
  if (!showActions(size)) {
    const maxBars = 5;
    const barHeight = 8;

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
          <ScrollFade className="relative">
            <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
              <TooltipRow label={tooltip.source} value={`${tooltip.count}`} />
              <TooltipRow label={t("leadSources.ofTotal") ?? "of total"} value={`${tooltip.pct}%`} />
              {tooltip.value > 0 && (
                <TooltipRow label={t("leadSources.pipelineValue") ?? "Pipeline value"} value={formatCompactCurrency(tooltip.value)} />
              )}
            </WidgetTooltip>

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
              {sourceData.sources.length > maxBars && (
                <span className="font-mono text-micro-sm text-text-tertiary">
                  +{sourceData.sources.length - maxBars} {t("leadSources.more") ?? "more"}
                </span>
              )}
            </div>
          </ScrollFade>

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

  // ── LG: Superimposed multi-line trend chart + source list ─────────────
  const maxSources = 8;
  const periodOptions = [
    { value: "30d", label: t("leadSources.period30d") ?? "30D" },
    { value: "90d", label: t("leadSources.period90d") ?? "90D" },
    { value: "ytd", label: t("leadSources.periodYtd") ?? "YTD" },
  ];

  const handleChartHover = useCallback(
    (x: number, monthIndex: number, mouseX: number, mouseY: number) => {
      const parentRect = ref.current?.getBoundingClientRect();
      if (!parentRect) return;
      setCrosshair({
        visible: true,
        x,
        viewportX: mouseX - parentRect.left,
        viewportY: mouseY - parentRect.top,
        monthIndex,
      });
    },
    []
  );

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("leadSources.title") ?? "Lead Sources"}
          </span>
          <div className="flex items-center gap-1">
            <WidgetPeriodPicker
              options={periodOptions}
              value={trendPeriod}
              onChange={(v) => setTrendPeriod(v as TrendPeriod)}
              size={size}
            />
          </div>
        </div>

        {/* MULTI-LINE TREND CHART */}
        <div className="relative mb-2">
          <MultiLineTrendChart
            sources={sourceData.sources}
            trendData={sourceTrends}
            width={320}
            height={100}
            isVisible={isVisible}
            reducedMotion={reducedMotion}
            onHover={handleChartHover}
            onLeave={() => setCrosshair((prev) => ({ ...prev, visible: false }))}
          />

          {/* Crosshair tooltip */}
          <WidgetTooltip
            visible={crosshair.visible}
            x={crosshair.viewportX}
            y={crosshair.viewportY}
            anchorRef={ref}
            anchor="above"
          >
            <div className="mb-1">
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                {monthLabels[crosshair.monthIndex] ?? ""}
              </span>
            </div>
            {sourceData.sources.slice(0, 5).map((s, i) => {
              const trend = sourceTrends.get(s.source) ?? [];
              const val = trend[crosshair.monthIndex] ?? 0;
              return (
                <TooltipRow
                  key={s.source}
                  label={s.label}
                  value={`${val}`}
                  color={BAR_COLORS[i % BAR_COLORS.length]}
                />
              );
            })}
          </WidgetTooltip>
        </div>

        {/* SOURCE LIST */}
        <ScrollFade>
          <div className="flex flex-col gap-[2px]">
            {sourceData.sources.slice(0, maxSources).map((s, i) => {
              const barColor = BAR_COLORS[i % BAR_COLORS.length];
              return (
                <WidgetLineItem
                  key={s.source}
                  indicator={{ type: "dot", color: barColor }}
                  primary={s.label}
                  secondary={`${s.pct}% ${t("leadSources.ofTotal") ?? "of total"}`}
                  metric={`${s.count}`}
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                />
              );
            })}
          </div>
        </ScrollFade>

        {/* FOOTER */}
        <button
          onClick={() => onNavigate("/pipeline")}
          className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
        >
          {t("leadSources.viewPipeline") ?? "View Pipeline"}
        </button>
      </div>
    </Card>
  );
}
