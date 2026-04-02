"use client";

import { useMemo, useState, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { Project } from "@/lib/types/models";
import {
  ProjectStatus,
  isActiveProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Funnel stage definitions
// ---------------------------------------------------------------------------
const FUNNEL_STAGES = [
  { status: ProjectStatus.RFQ, maxWidth: 100, label: "RFQ" },
  { status: ProjectStatus.Estimated, maxWidth: 80, label: "Estimated" },
  { status: ProjectStatus.Accepted, maxWidth: 60, label: "Accepted" },
  { status: ProjectStatus.InProgress, maxWidth: 45, label: "In Progress" },
] as const;

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

  // ── Compute stage data ────────────────────────────────────────────────
  const stages = useMemo(() => {
    const activeProjects = projects.filter(
      (p) => !p.deletedAt && isActiveProjectStatus(p.status)
    );
    const total = activeProjects.length;
    const maxCount = Math.max(
      ...FUNNEL_STAGES.map((s) => activeProjects.filter((p) => p.status === s.status).length),
      1
    );

    return FUNNEL_STAGES.map((stage) => {
      const stageProjects = activeProjects.filter((p) => p.status === stage.status);
      const count = stageProjects.length;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      const fillPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
      return {
        ...stage,
        count,
        pct,
        fillPct,
        color: PROJECT_STATUS_COLORS[stage.status],
        projects: stageProjects,
      };
    });
  }, [projects]);

  const totalProjects = stages.reduce((sum, s) => sum + s.count, 0);

  // ── Conversion rates (LG only) ────────────────────────────────────────
  const conversionRates = useMemo(() => {
    if (!showActions(size)) return [];
    const rates: { from: string; to: string; rate: number }[] = [];
    for (let i = 0; i < stages.length - 1; i++) {
      const fromCount = stages[i].count;
      const toCount = stages[i + 1].count;
      rates.push({
        from: stages[i].label,
        to: stages[i + 1].label,
        rate: fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0,
      });
    }
    return rates;
  }, [stages, size]);

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="funnel" />
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  if (totalProjects === 0) {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/pipeline")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded} font-bold text-text-disabled leading-none`}>
              0
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("pipelineFunnel.noProjects") ?? "No active projects"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("pipelineFunnel.viewPipeline") ?? "View Pipeline"}
            </span>
          )}
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
      stage: stage.label,
      count: stage.count,
      pct: stage.pct,
    });
  };

  const barHeight = compact ? 12 : showActions(size) ? 20 : 16;

  // ── XS: Header + Hero (active count) ─────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/pipeline")}>
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none text-text-primary">
            {totalProjects}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {t("pipelineFunnel.active") ?? "active"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + mini funnel bars ─────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex p-3">
          {/* Left: Hero + Title */}
          <div className="flex flex-col shrink-0">
            <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
              {totalProjects}
            </span>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("pipelineFunnel.title") ?? "Pipeline"}
            </span>
          </div>
          {/* Center: Mini funnel bars */}
          <div className="flex-1 flex flex-col items-center justify-center gap-[3px] px-3">
            {stages.map((stage, i) => (
              <div key={i} className="w-full flex justify-center" style={{ maxWidth: `${stage.maxWidth}%` }}>
                <div
                  className="rounded-sm"
                  style={{
                    height: `${barHeight}px`,
                    width: isVisible ? `${Math.max(stage.fillPct, stage.count > 0 ? 8 : 0)}%` : "0%",
                    backgroundColor: stage.color,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              </div>
            ))}
          </div>
          {/* Right: Nav icon */}
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate("/pipeline"); }}
            className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors self-start shrink-0"
          >
            <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
          </button>
        </div>
      </Card>
    );
  }

  // ── MD / LG: Funnel bars with labels + detail ─────────────────────────
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {totalProjects}
          </span>
        </div>

        {/* Detail zone */}
        <ScrollFade>
          <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
            <TooltipRow label={tooltip.stage} value={`${tooltip.count}`} />
            <TooltipRow label={t("pipelineFunnel.ofPipeline") ?? "Of pipeline"} value={`${tooltip.pct}%`} />
          </WidgetTooltip>

          {/* Funnel bars — centered like a funnel */}
          <div className="flex flex-col items-center gap-[6px] cursor-pointer" onClick={() => onNavigate("/pipeline")}>
            {stages.map((stage, i) => (
              <div key={i} className="w-full flex justify-center" style={{ maxWidth: `${stage.maxWidth}%` }}>
                <div className="relative w-full">
                  <div
                    className="rounded-sm w-full"
                    style={{
                      height: `${barHeight}px`,
                      backgroundColor: stage.color,
                      opacity: isVisible ? 1 : 0,
                      transitionProperty: "opacity",
                      transitionDuration: reducedMotion ? "200ms" : "500ms",
                      transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                    onMouseEnter={(e) => handleBarHover(e, stage)}
                    onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                  />
                  {/* Label to the right of the bar */}
                  <div className="absolute left-full top-1/2 -translate-y-1/2 flex items-center gap-1 ml-2 whitespace-nowrap">
                    <span className="font-mohave text-micro text-text-secondary">{stage.label}</span>
                    <span className="font-mono text-micro text-text-primary font-medium">{stage.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* LG: Conversion rates */}
          {showActions(size) && conversionRates.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border-subtle">
              <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                {t("pipelineFunnel.conversionRate") ?? "Conversion"}
              </span>
              <div className="flex flex-col gap-1 mt-1">
                {conversionRates.map((cr, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="font-mohave text-caption-sm text-text-secondary">
                      {cr.from} → {cr.to}
                    </span>
                    <span className="font-mono text-micro-sm text-text-primary">{cr.rate}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LG: Per-stage project names */}
          {showActions(size) && (
            <div className="mt-2 pt-2 border-t border-border-subtle">
              {stages.map((stage, si) => {
                if (stage.count === 0) return null;
                return (
                  <div key={si} className="mb-1.5 last:mb-0">
                    <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                      {stage.label}
                    </span>
                    {stage.projects.slice(0, 2).map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between py-[2px] px-1 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                        onClick={(e) => { e.stopPropagation(); onNavigate(`/projects/${p.id}`); }}
                      >
                        <span className="font-mohave text-caption-sm text-text-secondary truncate flex-1 min-w-0">
                          {p.title || (t("pipelineFunnel.untitled") ?? "Untitled")}
                        </span>
                        {p.client?.name && (
                          <span className="font-kosugi text-micro-sm text-text-disabled truncate ml-2 shrink-0">
                            {p.client.name}
                          </span>
                        )}
                      </div>
                    ))}
                    {stage.count > 2 && (
                      <span className="font-mono text-micro-sm text-text-disabled pl-1">
                        +{stage.count - 2} {t("pipelineFunnel.more") ?? "more"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollFade>

        {/* Footer — SM+ */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/pipeline")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("pipelineFunnel.viewPipeline") ?? "View Pipeline"}
          </button>
        )}
      </div>
    </Card>
  );
}
