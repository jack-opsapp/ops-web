"use client";

import { useMemo, useState, useRef } from "react";
import { Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { Project } from "@/lib/types/models";
import {
  ProjectStatus,
  isActiveProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

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
// Helpers
// ---------------------------------------------------------------------------
function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
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

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    stage: string;
    count: number;
    pct: number;
  }>({ visible: false, x: 0, y: 0, stage: "", count: 0, pct: 0 });

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
      // Proportional bar width within the max-width container
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

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="funnel" />
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (totalProjects === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <div className="flex flex-col items-center gap-[3px]">
            {FUNNEL_STAGES.map((stage, i) => (
              <div
                key={i}
                className="h-[16px] rounded-sm border border-dashed border-[rgba(255,255,255,0.12)]"
                style={{ width: `${stage.maxWidth}%` }}
              />
            ))}
          </div>
          <p className="font-kosugi text-[9px] text-text-tertiary mt-2 text-center">
            {t("pipelineFunnel.noProjects") ?? "No active projects"}
          </p>
        </CardContent>
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

  const barHeight = size === "sm" ? 12 : 16;

  // ── SM ──────────────────────────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">{totalProjects}</span>
        </CardHeader>
        <CardContent className="px-3 pb-2 overflow-hidden">
          <div ref={ref} className="flex flex-col items-center gap-[3px] relative cursor-pointer" onClick={() => onNavigate("/pipeline")}>
            {stages.map((stage, i) => (
              <div key={i} className="w-full flex justify-center" style={{ maxWidth: `${stage.maxWidth}%` }}>
                <div
                  className="rounded-sm transition-all"
                  style={{
                    height: `${barHeight}px`,
                    width: isVisible ? `${Math.max(stage.fillPct, stage.count > 0 ? 8 : 0)}%` : "0%",
                    backgroundColor: stage.color,
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG ─────────────────────────────────────────────────────────────
  return (
    <Card className="h-full" ref={ref}>
      <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("pipelineFunnel.title") ?? "Pipeline"}
        </CardTitle>
        <span className="font-mono text-[11px] text-text-tertiary">
          {totalProjects}
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden relative">
        <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchor="above">
          <TooltipRow label={tooltip.stage} value={`${tooltip.count}`} />
          <TooltipRow label="Of pipeline" value={`${tooltip.pct}%`} />
        </WidgetTooltip>

        {/* Funnel bars */}
        <div className="flex flex-col gap-[3px] cursor-pointer" onClick={() => onNavigate("/pipeline")}>
          {stages.map((stage, i) => (
            <div key={i} className="flex items-center gap-2">
              {/* Bar container */}
              <div className="flex-1" style={{ maxWidth: `${stage.maxWidth}%` }}>
                <div
                  className="rounded-sm transition-all"
                  style={{
                    height: `${barHeight}px`,
                    width: isVisible ? `${Math.max(stage.fillPct, stage.count > 0 ? 8 : 0)}%` : "0%",
                    backgroundColor: stage.color,
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                  onMouseEnter={(e) => handleBarHover(e, stage)}
                  onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                />
              </div>
              {/* Label + count */}
              <div className="flex items-center gap-1 shrink-0 min-w-[80px]">
                <span className="font-mohave text-[11px] text-text-secondary">{stage.label}</span>
                <span className="font-mono text-[11px] text-text-primary font-medium">{stage.count}</span>
              </div>
            </div>
          ))}
        </div>

        {/* LG: Per-stage project names */}
        {size === "lg" && (
          <div className="mt-2 pt-2 border-t border-border-primary">
            {stages.map((stage, si) => {
              if (stage.count === 0) return null;
              return (
                <div key={si} className="mb-1.5 last:mb-0">
                  <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                    {stage.label}
                  </span>
                  {stage.projects.slice(0, 2).map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between py-[2px] px-1 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                      onClick={(e) => { e.stopPropagation(); onNavigate(`/projects/${p.id}`); }}
                    >
                      <span className="font-mohave text-[12px] text-text-secondary truncate flex-1 min-w-0">
                        {p.title || "Untitled"}
                      </span>
                      {p.client?.name && (
                        <span className="font-kosugi text-[9px] text-text-tertiary truncate ml-2 shrink-0">
                          {p.client.name}
                        </span>
                      )}
                    </div>
                  ))}
                  {stage.count > 2 && (
                    <span className="font-mono text-[10px] text-text-disabled pl-1">
                      +{stage.count - 2} more
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
