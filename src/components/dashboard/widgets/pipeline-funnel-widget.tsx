"use client";

import { useMemo, useState, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WidgetTitle } from "./shared/widget-title";
import { useWeightedPipelineValue } from "@/lib/hooks/use-forecast";
import { formatCompactCurrency } from "./shared/widget-utils";
import { HERO_SIZE_CLASS, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
import type { Project } from "@/lib/types/models";
import {
  ProjectStatus,
  isActiveProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
import { useWidgetEntityOpen } from "./shared/use-widget-entity-open";
import { cn } from "@/lib/utils/cn";
import { SegmentedPicker, type SegmentedPickerOption } from "@/components/ops/segmented-picker";

// ---------------------------------------------------------------------------
// Pipeline stage definitions (data-driven — no hardcoded widths)
// ---------------------------------------------------------------------------
const PIPELINE_STAGES = [
  { status: ProjectStatus.RFQ, i18nKey: "stat.statusRfq" },
  { status: ProjectStatus.Estimated, i18nKey: "stat.statusEstimated" },
  { status: ProjectStatus.Accepted, i18nKey: "stat.statusAccepted" },
  { status: ProjectStatus.InProgress, i18nKey: "stat.statusInProgress" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function projectAgeDays(project: Project): number {
  const created = project.createdAt ? new Date(project.createdAt) : new Date();
  const now = new Date();
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface PipelineFunnelWidgetProps {
  size: WidgetSize;
  projects: Project[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function PipelineFunnelWidget({
  size,
  projects,
  isLoading,
  onNavigate,
}: PipelineFunnelWidgetProps) {
  const { t } = useDictionary("dashboard");
  const openEntity = useWidgetEntityOpen();
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);

  const reducedMotion = useReducedMotion();

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    stage: string;
    count: number;
    pct: number;
  }>({ visible: false, x: 0, y: 0, stage: "", count: 0, pct: 0 });

  const { data: weightedPipeline } = useWeightedPipelineValue();
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [showAllItems, setShowAllItems] = useState(false);

  // ── Compute stage data (data-proportional) ────────────────────────────
  const stages = useMemo(() => {
    const activeProjects = projects.filter(
      (p) => !p.deletedAt && isActiveProjectStatus(p.status)
    );
    const total = activeProjects.length;
    const maxCount = Math.max(
      ...PIPELINE_STAGES.map((s) => activeProjects.filter((p) => p.status === s.status).length),
      1
    );

    return PIPELINE_STAGES.map((stage) => {
      const stageProjects = activeProjects.filter((p) => p.status === stage.status);
      const count = stageProjects.length;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      // Data-proportional width: count/maxCount. Min 8% for non-empty stages.
      const widthPct = maxCount > 0 ? Math.max((count / maxCount) * 100, count > 0 ? 8 : 0) : 0;
      return {
        ...stage,
        count,
        pct,
        widthPct,
        color: PROJECT_STATUS_COLORS[stage.status],
        projects: stageProjects,
      };
    });
  }, [projects]);

  const totalProjects = stages.reduce((sum, s) => sum + s.count, 0);

  // ── Distribution (LG only) ─────────────────────────────────────────────
  const distribution = useMemo(() => {
    if (!showActions(size)) return [];
    return stages
      .filter((s) => s.count > 0)
      .map((s) => ({ label: t(s.i18nKey), count: s.count, pct: s.pct, color: s.color }));
  }, [stages, size]);

  // ── SegmentedPicker options for LG stage filter ───────────────────────
  const stagePickerOptions = useMemo<SegmentedPickerOption[]>(() => {
    const opts: SegmentedPickerOption[] = [{ value: "all", label: t("trend.all") ?? "All" }];
    for (const stage of stages) {
      if (stage.count > 0) {
        opts.push({ value: stage.status, label: `${t(stage.i18nKey)} (${stage.count})` });
      }
    }
    return opts;
  }, [stages, t]);

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="px-3 pt-2 pb-1">
          <WidgetTitle>{t("pipelineFunnel.title") ?? "Pipeline"}</WidgetTitle>
        </div>
        <div className="px-3 pb-2">
          <WidgetSkeleton variant="funnel" />
        </div>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  if (totalProjects === 0) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <WidgetTitle>
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </WidgetTitle>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded} font-bold text-text-mute leading-none`}>
              0
            </span>
            <span className="font-mohave text-caption-sm text-text-mute mt-1">
              {t("pipelineFunnel.noProjects") ?? "No active projects"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  const handleBarHover = (e: React.MouseEvent, stage: typeof stages[number]) => {
    const parentRect = ref.current?.getBoundingClientRect();
    const barRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!parentRect) return;
    setTooltip({
      visible: true,
      x: barRect.left - parentRect.left + barRect.width / 2,
      y: barRect.top - parentRect.top,
      stage: t(stage.i18nKey),
      count: stage.count,
      pct: stage.pct,
    });
  };

  const barHeight = compact ? 12 : showActions(size) ? 20 : 16;

  // ── XS: Header + Hero (active count) ─────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none text-text">
            {totalProjects}
          </span>
          <WidgetTitle className="mt-1">
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </WidgetTitle>
          {weightedPipeline ? (
            <WidgetTrendContext variant="snapshot" label={`${t("pipelineFunnel.weighted") ?? "Weighted"}: ${formatCompactCurrency(weightedPipeline.totalWeighted)}`} />
          ) : (
            <WidgetTrendContext variant="snapshot" label={t("trend.active") ?? "Active"} />
          )}
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + mini funnel bars (data-proportional) ────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex p-3">
          {/* Left: Hero + Title */}
          <div className="flex flex-col shrink-0">
            <span className="font-mono text-data-lg font-bold leading-none text-text">
              {totalProjects}
            </span>
            <WidgetTitle className="mt-1">
              {t("pipelineFunnel.title") ?? "Pipeline"}
            </WidgetTitle>
            {weightedPipeline && (
              <span className="font-mono text-micro text-text-mute mt-0.5">
                {formatCompactCurrency(weightedPipeline.totalWeighted)}
              </span>
            )}
          </div>
          {/* Center: Mini funnel bars — data-proportional widths */}
          <div className="flex-1 flex flex-col items-center justify-center gap-[3px] px-3">
            {stages.map((stage, i) => (
              <div key={i} className="w-full flex justify-center">
                <div
                  className="rounded-sm"
                  style={{
                    height: `${barHeight}px`,
                    width: isVisible ? `${stage.widthPct}%` : "0%",
                    backgroundColor: stage.color,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                    transitionTimingFunction: WIDGET_EASE_CSS,
                  }}
                />
              </div>
            ))}
          </div>
          {/* Right: Nav icon */}
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate("/pipeline"); }}
            className="p-0.5 rounded-sm hover:bg-surface-hover transition-colors self-start shrink-0"
          >
            <ArrowUpRight className="w-2.5 h-2.5 text-text-mute" />
          </button>
        </div>
      </Card>
    );
  }

  // ── Horizontal funnel bars (shared by MD and LG) ───────────────────────
  const nonEmptyStages = stages.filter((s) => s.count > 0);
  const funnelBarHeight = showActions(size) ? 24 : 20;

  const renderHorizontalFunnel = () => (
    <div className="flex flex-col gap-[3px] flex-1">
      {stages.map((stage, i) => {
        if (stage.count === 0) return null;
        const isWide = stage.widthPct >= 35;

        return (
          <div
            key={i}
            className="flex items-center justify-center flex-1"
            style={{
              opacity: !isVisible ? 0 : (showActions(size) && stageFilter !== "all" && stageFilter !== stage.status) ? 0.4 : 1,
              transitionProperty: "opacity",
              transitionDuration: reducedMotion ? "200ms" : "500ms",
              transitionTimingFunction: WIDGET_EASE_CSS,
            }}
          >
            <div
              className="rounded-sm cursor-pointer relative flex items-center shrink-0"
              style={{
                height: `${funnelBarHeight}px`,
                minHeight: stage.count > 0 ? "20px" : undefined,
                width: isVisible ? `${stage.widthPct}%` : "0%",
                minWidth: isVisible && stage.count > 0 ? "8px" : undefined,
                border: `1px solid ${stage.color}`,
                backgroundColor: `color-mix(in srgb, ${stage.color} 15%, transparent)`,
                transitionProperty: "width, min-width",
                transitionDuration: reducedMotion ? "200ms" : "500ms",
                transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                transitionTimingFunction: WIDGET_EASE_CSS,
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (showActions(size)) {
                  setStageFilter((prev) => prev === stage.status ? "all" : stage.status);
                  setShowAllItems(false);
                } else {
                  onNavigate("/pipeline");
                }
              }}
              onMouseEnter={(e) => handleBarHover(e, stage)}
              onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
            >
              {isWide && (
                <span className="font-mohave text-caption-sm truncate px-2" style={{ color: stage.color }}>
                  {t(stage.i18nKey)} · {stage.count}
                </span>
              )}
            </div>
            {!isWide && (
              <div className="flex items-center gap-1 ml-2 whitespace-nowrap shrink-0">
                <span className="font-mohave text-micro text-text-2">{t(stage.i18nKey)}</span>
                <span className="font-mono text-micro font-medium" style={{ color: stage.color }}>{stage.count}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Filtered stage data (LG) ────────────────────────────────────────────
  const filteredStageData = showActions(size) && stageFilter !== "all"
    ? stages.find((s) => s.status === stageFilter)
    : null;
  const MAX_VISIBLE_ITEMS = 10;

  // ── MD: Horizontal funnel only ────────────────────────────────────────
  if (size === "md") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <WidgetTitle>
              {t("pipelineFunnel.title") ?? "Pipeline"}
            </WidgetTitle>
          </div>

          {/* Hero */}
          <div className="flex items-baseline gap-2 mb-2">
            <span className="font-mono text-display font-bold text-text leading-none">
              {totalProjects}
            </span>
            <span className="font-mono text-micro text-text-mute uppercase">
              {t("trend.active") ?? "Active"}
            </span>
            {weightedPipeline && (
              <>
                <span className="text-text-mute">·</span>
                <span className="font-mono text-micro text-text-mute">
                  {formatCompactCurrency(weightedPipeline.totalWeighted)}
                </span>
              </>
            )}
          </div>

          {/* Funnel bars */}
          <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
            <TooltipRow label={tooltip.stage} value={`${tooltip.count}`} />
            <TooltipRow label={t("pipelineFunnel.ofPipeline") ?? "Of pipeline"} value={`${tooltip.pct}%`} />
          </WidgetTooltip>

          {renderHorizontalFunnel()}
        </div>
      </Card>
    );
  }

  // ── LG: Full operational view with stage filter ─────────────────────────
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header row: title + weighted value */}
        <div className="flex items-center justify-between mb-1">
          <WidgetTitle>
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </WidgetTitle>
          {weightedPipeline && (
            <span className="font-mono text-micro text-text-mute">
              {t("pipelineFunnel.weighted") ?? "Weighted"}: {formatCompactCurrency(weightedPipeline.totalWeighted)}
            </span>
          )}
        </div>

        {/* Hero */}
        <div className="flex items-baseline gap-2 mb-2">
          <span className="font-mono text-display font-bold text-text leading-none">
            {totalProjects}
          </span>
          <span className="font-mono text-micro text-text-mute uppercase">
            {t("trend.active") ?? "Active"}
          </span>
        </div>

        {/* Funnel bars — always visible */}
        <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
          <TooltipRow label={tooltip.stage} value={`${tooltip.count}`} />
          <TooltipRow label={t("pipelineFunnel.ofPipeline") ?? "Of pipeline"} value={`${tooltip.pct}%`} />
        </WidgetTooltip>

        <div className="mb-3">
          {renderHorizontalFunnel()}
        </div>

        {/* Stage filter — SegmentedPicker */}
        <div className="mb-2">
          <SegmentedPicker
            options={stagePickerOptions}
            value={stageFilter}
            onChange={(val) => { setStageFilter(val); setShowAllItems(false); }}
          />
        </div>

        {/* Content area */}
        <ScrollFade className="flex-1 min-h-0">
          {/* "All" view — distribution breakdown */}
          {stageFilter === "all" && distribution.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {distribution.map((d, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-1 cursor-pointer hover:bg-[rgba(255,255,255,0.03)] rounded-sm px-1 -mx-1 transition-colors"
                  onClick={() => { setStageFilter(stages.find(s => t(s.i18nKey) === d.label)?.status ?? "all"); setShowAllItems(false); }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-[6px] h-[6px] rounded-bar shrink-0"
                      style={{ backgroundColor: d.color }}
                    />
                    <span className="font-mohave text-caption-sm text-text-2">
                      {d.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-micro text-text font-medium">{d.count}</span>
                    <span className="font-mono text-micro text-text-mute w-[32px] text-right">{d.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Filtered stage view — project list */}
          {filteredStageData && (
            <div className="flex flex-col">
              {(showAllItems ? filteredStageData.projects : filteredStageData.projects.slice(0, MAX_VISIBLE_ITEMS)).map((p, i) => (
                <WidgetLineItem
                  key={p.id}
                  indicator={{ type: "bar", color: filteredStageData.color }}
                  primary={p.title || (t("pipelineFunnel.untitled") ?? "Untitled")}
                  secondary={[p.client?.name, p.address].filter(Boolean).join(" · ")}
                  metric={`${projectAgeDays(p)}d`}
                  onClick={(e) => openEntity({
                    entityType: "project",
                    entityId: p.id,
                    title: p.title || (t("pipelineFunnel.untitled") ?? "Untitled"),
                    color: filteredStageData.color,
                    event: e,
                    fallbackPath: `/projects/${p.id}`,
                  })}
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                />
              ))}
              {filteredStageData.projects.length > MAX_VISIBLE_ITEMS && (
                <WidgetMoreButton
                  remaining={filteredStageData.projects.length - MAX_VISIBLE_ITEMS}
                  expanded={showAllItems}
                  onToggle={() => setShowAllItems((prev) => !prev)}
                />
              )}
            </div>
          )}
        </ScrollFade>
      </div>
    </Card>
  );
}
