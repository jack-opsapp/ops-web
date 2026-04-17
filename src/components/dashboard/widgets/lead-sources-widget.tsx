"use client";

import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showActions } from "@/lib/widget-tokens";
import { formatCompactCurrency } from "./shared/widget-utils";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Opportunity } from "@/lib/types/pipeline";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetTrendContext } from "./shared/widget-trend-context";

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
// Multi-line trend chart (LG) — HTML labels + SVG lines + hover crosshair
// ---------------------------------------------------------------------------
function MultiLineTrendChart({
  sources,
  trendData,
  monthLabels: labels,
  height,
  isVisible,
  reducedMotion,
  hoveredIndex,
  onHover,
  onLeave,
}: {
  sources: { source: string; label: string; count: number; pct: number; value: number }[];
  trendData: Map<string, number[]>;
  monthLabels: string[];
  height: number;
  isVisible: boolean;
  reducedMotion: boolean | null;
  hoveredIndex: number | null;
  onHover?: (monthIndex: number, mouseX: number, mouseY: number) => void;
  onLeave?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(320);

  // Measure container width for responsive SVG
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const chartHeight = height - 20; // reserve 20px for X labels
  const yLabelWidth = 24;
  const chartWidth = containerWidth - yLabelWidth;

  const allValues = Array.from(trendData.values()).flat();
  const globalMax = Math.max(...allValues, 1);
  const numPoints = Array.from(trendData.values())[0]?.length ?? 6;
  const stepX = chartWidth / Math.max(numPoints - 1, 1);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!onHover) return;
      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const monthIndex = Math.round(localX / stepX);
      const clampedIndex = Math.max(0, Math.min(numPoints - 1, monthIndex));
      onHover(clampedIndex, e.clientX, e.clientY);
    },
    [onHover, stepX, numPoints]
  );

  // Build line paths + data point positions
  const lineData = useMemo(() => {
    return sources.slice(0, 5).map((src, colorIdx) => {
      const data = trendData.get(src.source) ?? [];
      if (data.length < 2) return null;

      const points = data.map((val, i) => ({
        x: i * stepX,
        y: chartHeight - (Math.max(val, 0) / globalMax) * chartHeight,
        value: val,
      }));

      // Build path — use straight lines for ≤4 points, curves for more
      let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
      if (points.length <= 4) {
        for (let i = 1; i < points.length; i++) {
          d += ` L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
        }
      } else {
        for (let i = 1; i < points.length; i++) {
          const prev = points[i - 1];
          const curr = points[i];
          const cpx = (prev.x + curr.x) / 2;
          d += ` C${cpx.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
        }
      }

      const color = BAR_COLORS[colorIdx % BAR_COLORS.length];
      return { key: src.source, d, color, points, colorIdx };
    }).filter(Boolean) as { key: string; d: string; color: string; points: { x: number; y: number; value: number }[]; colorIdx: number }[];
  }, [sources, trendData, stepX, chartHeight, globalMax]);

  // Y-axis labels
  const yLabels = [0, Math.round(globalMax / 2), globalMax];

  return (
    <div ref={containerRef} className="w-full" style={{ height: `${height}px` }}>
      <div className="flex h-full">
        {/* Y-axis labels (HTML — not stretched) */}
        <div className="flex flex-col justify-between shrink-0 pr-1" style={{ width: `${yLabelWidth}px`, height: `${chartHeight}px` }}>
          {yLabels.slice().reverse().map((val) => (
            <span key={val} className="font-mono text-micro text-text-mute text-right leading-none">
              {val}
            </span>
          ))}
        </div>

        {/* Chart area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* SVG lines — no preserveAspectRatio distortion */}
          <svg
            width={chartWidth}
            height={chartHeight}
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={onLeave}
            role="img"
            aria-label="Lead source trends"
          >
            {/* Gridlines */}
            {[0.25, 0.5, 0.75].map((pct) => (
              <line
                key={pct}
                x1={0}
                y1={chartHeight * (1 - pct)}
                x2={chartWidth}
                y2={chartHeight * (1 - pct)}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
            ))}
            {/* Baseline */}
            <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />

            {/* Lines */}
            {lineData.map(({ key, d, color, colorIdx }) => (
              <path
                key={key}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: reducedMotion
                    ? "none"
                    : `opacity 600ms cubic-bezier(0.16, 1, 0.3, 1) ${colorIdx * 80}ms`,
                }}
              />
            ))}

            {/* Data point dots — always visible for overlapping line differentiation */}
            {lineData.map(({ key, color, points }) =>
              points.map((pt, i) => (
                <circle
                  key={`${key}-dot-${i}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={hoveredIndex === i ? 4 : 2.5}
                  fill={hoveredIndex === i ? color : "transparent"}
                  stroke={color}
                  strokeWidth={hoveredIndex === i ? 2 : 1.5}
                  style={{
                    opacity: isVisible ? 1 : 0,
                    transition: reducedMotion ? "none" : "r 150ms ease, fill 150ms ease, opacity 400ms ease",
                  }}
                />
              ))
            )}

            {/* Hover crosshair line */}
            {hoveredIndex !== null && (
              <line
                x1={hoveredIndex * stepX}
                y1={0}
                x2={hoveredIndex * stepX}
                y2={chartHeight}
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
          </svg>

          {/* X-axis labels (HTML — not stretched) */}
          <div className="flex justify-between" style={{ paddingTop: "4px" }}>
            {labels.map((label, i) => (
              <span
                key={i}
                className="font-mono text-micro text-text-mute uppercase tracking-wider"
                style={{ width: i === 0 ? "auto" : i === labels.length - 1 ? "auto" : undefined, textAlign: i === 0 ? "left" : i === labels.length - 1 ? "right" : "center", flex: i === 0 || i === labels.length - 1 ? "0 0 auto" : "1" }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
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
  const [mdBarExpanded, setMdBarExpanded] = useState(false);
  const [lgSourceExpanded, setLgSourceExpanded] = useState(false);

  // Crosshair tooltip for LG chart
  const [crosshair, setCrosshair] = useState<{
    visible: boolean;
    viewportX: number;
    viewportY: number;
    monthIndex: number;
  }>({ visible: false, viewportX: 0, viewportY: 0, monthIndex: 0 });

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

  const handleChartHover = useCallback(
    (monthIndex: number, mouseX: number, mouseY: number) => {
      const parentRect = ref.current?.getBoundingClientRect();
      if (!parentRect) return;
      setCrosshair({
        visible: true,
        viewportX: mouseX - parentRect.left,
        viewportY: mouseY - parentRect.top,
        monthIndex,
      });
    },
    []
  );

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-mono text-micro uppercase tracking-wider text-text-3">
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
    if (size === "xs") {
      return (
        <Card className="h-full">
          <div className="h-full flex flex-col pt-3">
            <span className="font-mono text-display font-bold text-text-mute leading-none">0</span>
            <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
              {t("leadSources.title") ?? "Lead Sources"}
            </span>
          </div>
        </Card>
      );
    }
    if (size === "sm") {
      return (
        <Card className="h-full p-0">
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold text-text-mute leading-none">0</span>
              <button onClick={() => onNavigate("/pipeline")} className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-[rgba(255,255,255,0.08)] transition-colors">
                <ArrowUpRight className="w-[14px] h-[14px]" />
              </button>
            </div>
            <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
              {t("leadSources.title") ?? "Lead Sources"}
            </span>
            <span className="font-mohave text-caption-sm text-text-mute mt-1 truncate">
              {t("leadSources.noSources") ?? "No lead sources yet"}
            </span>
          </div>
        </Card>
      );
    }
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider">
            {t("leadSources.title") ?? "Lead Sources"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mono text-display font-bold text-text-mute leading-none">0</span>
            <span className="font-mohave text-caption-sm text-text-mute mt-1">
              {t("leadSources.noSources") ?? "No lead sources yet"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── XS: Hero = top source name + count ─────────────────────────────────
  if (size === "xs") {
    const top = sourceData.sources[0];
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none text-text">
            {top.count}
          </span>
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("leadSources.title") ?? "Lead Sources"}
          </span>
          <span className="font-mono text-micro text-text-mute uppercase">
            {top.label}
          </span>
          <WidgetTrendContext variant="snapshot" label={t("trend.allTime") ?? "All Time"} />
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

        <div className="h-full flex flex-col p-3">
          {/* Hero row with arrow at top-right */}
          <div className="flex items-start justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text">
              {sourceData.total}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/pipeline"); }}
              className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <div className="flex-1 flex min-w-0">
          {/* Text content */}
          <div className="flex-1 flex flex-col min-w-0">
            <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
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
                  <span className="font-mohave text-micro text-text-2 truncate">
                    {s.label}
                  </span>
                  <span className="font-mono text-micro text-text-3 shrink-0">
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
        </div>
      </Card>
    );
  }

  // ── MD: Horizontal bar chart with tooltip ─────────────────────────────

  if (!showActions(size)) {
    const defaultMaxBars = 5;
    const maxBars = mdBarExpanded ? sourceData.sources.length : defaultMaxBars;
    const barRemaining = sourceData.sources.length - defaultMaxBars;
    const barHeight = 8;

    const renderBarRows = (sources: typeof sourceData.sources) =>
      sources.map((s, i) => {
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
              <span className="font-mohave text-caption-sm text-text-2">{s.label}</span>
              <span className="font-mono text-micro text-text-3">{s.count}</span>
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
      });

    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* HEADER */}
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-micro uppercase tracking-wider text-text-3">
              {t("leadSources.title") ?? "Lead Sources"}
            </span>
            <span className="font-mono text-micro text-text-3">
              {sourceData.total} {t("leadSources.total") ?? "total"}
            </span>
          </div>

          {/* DETAIL ZONE */}
          <div className="flex-1 min-h-0 flex flex-col relative">
            <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
              <TooltipRow label={tooltip.source} value={`${tooltip.count}`} />
              <TooltipRow label={t("leadSources.ofTotal") ?? "of total"} value={`${tooltip.pct}%`} />
              {tooltip.value > 0 && (
                <TooltipRow label={t("leadSources.pipelineValue") ?? "Pipeline value"} value={formatCompactCurrency(tooltip.value)} />
              )}
            </WidgetTooltip>

            {mdBarExpanded ? (
              <ScrollFade>
                <div className="flex flex-col gap-[6px]">
                  {renderBarRows(sourceData.sources)}
                </div>
                <WidgetMoreButton remaining={barRemaining} expanded={mdBarExpanded} onToggle={() => setMdBarExpanded((v) => !v)} className="mt-1" />
              </ScrollFade>
            ) : (
              <>
                <div className="flex flex-col gap-[6px]">
                  {renderBarRows(sourceData.sources.slice(0, maxBars))}
                </div>
                {barRemaining > 0 && (
                  <WidgetMoreButton remaining={barRemaining} expanded={mdBarExpanded} onToggle={() => setMdBarExpanded((v) => !v)} className="mt-1" />
                )}
              </>
            )}
          </div>

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

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
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
            monthLabels={monthLabels}
            height={120}
            isVisible={isVisible}
            reducedMotion={reducedMotion}
            hoveredIndex={crosshair.visible ? crosshair.monthIndex : null}
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
              <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
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
        {(() => {
          const defaultMaxSrc = maxSources;
          const maxSrc = lgSourceExpanded ? sourceData.sources.length : defaultMaxSrc;
          const srcRemaining = sourceData.sources.length - defaultMaxSrc;
          const displaySources = sourceData.sources.slice(0, maxSrc);

          const renderSourceRows = (sources: typeof sourceData.sources) =>
            sources.map((s, i) => {
              const barColor = BAR_COLORS[i % BAR_COLORS.length];
              return (
                <WidgetLineItem
                  key={s.source}
                  indicator={{ type: "bar", color: barColor, label: s.label }}
                  primary={s.label}
                  secondary={`${s.pct}% ${t("leadSources.ofTotal") ?? "of total"}`}
                  metric={`${s.count}`}
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                />
              );
            });

          return (
            <div className="flex-1 min-h-0 flex flex-col">
              {lgSourceExpanded ? (
                <ScrollFade>
                  <div className="flex flex-col gap-[2px]">
                    {renderSourceRows(displaySources)}
                  </div>
                  <WidgetMoreButton remaining={srcRemaining} expanded={lgSourceExpanded} onToggle={() => setLgSourceExpanded((v) => !v)} className="mt-1" />
                </ScrollFade>
              ) : (
                <>
                  <div className="flex flex-col gap-[2px]">
                    {renderSourceRows(displaySources)}
                  </div>
                  {srcRemaining > 0 && (
                    <WidgetMoreButton remaining={srcRemaining} expanded={lgSourceExpanded} onToggle={() => setLgSourceExpanded((v) => !v)} className="mt-1" />
                  )}
                </>
              )}
            </div>
          );
        })()}

      </div>
    </Card>
  );
}
