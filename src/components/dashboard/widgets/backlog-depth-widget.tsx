"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { ScrollFade } from "./shared/scroll-fade";
import { widgetLineItemStyle } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail } from "@/lib/widget-tokens";
import type { Project, ProjectTask } from "@/lib/types/models";
import { ProjectStatus, TaskStatus } from "@/lib/types/models";
import type { Estimate } from "@/lib/types/pipeline";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function backlogColor(weeks: number): string {
  if (weeks >= 3 && weeks <= 6) return WT.success;
  if ((weeks >= 1 && weeks < 3) || (weeks > 6 && weeks <= 8)) return WT.warning;
  return WT.error;
}

function backlogLabel(weeks: number, t: (key: string) => string | undefined): string {
  if (weeks >= 3 && weeks <= 6) return t("backlogDepth.healthy") ?? "Healthy";
  if ((weeks >= 1 && weeks < 3) || (weeks > 6 && weeks <= 8)) return t("backlogDepth.caution") ?? "Caution";
  return t("backlogDepth.risk") ?? "Risk";
}

interface MetricRow {
  key: string;
  label: string;
  count: number;
  color: string;
}

function metricColor(count: number, warnAt: number, errorAt: number): string {
  if (count >= errorAt) return WT.error;
  if (count >= warnAt) return WT.warning;
  return WT.success;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface BacklogDepthWidgetProps {
  size: WidgetSize;
  projects: Project[];
  tasks?: ProjectTask[];
  estimates?: Estimate[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function BacklogDepthWidget({
  size,
  projects,
  tasks,
  estimates,
  isLoading,
  onNavigate,
}: BacklogDepthWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;
  const reducedMotion = useReducedMotion();

  // ── Core backlog calculation (weeks of work) ──────────────────────────
  const backlog = useMemo(() => {
    const signedProjects = projects.filter(
      (p) => !p.deletedAt && (p.status === ProjectStatus.Accepted || p.status === ProjectStatus.InProgress)
    );

    if (signedProjects.length === 0) return { weeks: 0, projectCount: 0 };

    let totalDays = 0;
    for (const p of signedProjects) {
      if (p.duration && p.duration > 0) {
        totalDays += p.duration;
      } else {
        totalDays += 5;
      }
    }

    const weeks = Math.round((totalDays / 5) * 10) / 10;
    return { weeks, projectCount: signedProjects.length };
  }, [projects]);

  // ── MD breakdown metrics ──────────────────────────────────────────────
  const breakdownMetrics = useMemo((): MetricRow[] => {
    if (!showDetail(size)) return [];

    const rows: MetricRow[] = [];

    // 1. Signed, Not Started — projects with status Accepted that have no in-progress or completed tasks
    const acceptedProjects = projects.filter(
      (p) => !p.deletedAt && p.status === ProjectStatus.Accepted
    );
    // If we have tasks data, check which accepted projects have started work
    let signedNotStarted = acceptedProjects.length;
    if (tasks) {
      const projectsWithWork = new Set<string>();
      for (const task of tasks) {
        if (task.deletedAt) continue;
        if (task.status === TaskStatus.InProgress || task.status === TaskStatus.Completed) {
          projectsWithWork.add(task.projectId);
        }
      }
      signedNotStarted = acceptedProjects.filter((p) => !projectsWithWork.has(p.id)).length;
    }
    rows.push({
      key: "signedNotStarted",
      label: t("backlogDepth.signedNotStarted") ?? "Signed, Not Started",
      count: signedNotStarted,
      color: metricColor(signedNotStarted, 1, 4),
    });

    // 2. Unscheduled Tasks — active tasks with no startDate
    if (tasks) {
      const unscheduledCount = tasks.filter(
        (task) =>
          !task.deletedAt &&
          task.status !== TaskStatus.Completed &&
          task.status !== TaskStatus.Cancelled &&
          !task.startDate
      ).length;
      rows.push({
        key: "unscheduledTasks",
        label: t("backlogDepth.unscheduledTasks") ?? "Unscheduled Tasks",
        count: unscheduledCount,
        color: metricColor(unscheduledCount, 3, 6),
      });
    }

    // 3. Pending Estimates — estimates in Sent/Viewed status
    if (estimates) {
      const pendingStatuses = new Set([EstimateStatus.Sent, EstimateStatus.Viewed]);
      const pendingCount = estimates.filter(
        (est) => !est.deletedAt && pendingStatuses.has(est.status)
      ).length;
      rows.push({
        key: "pendingEstimates",
        label: t("backlogDepth.pendingEstimates") ?? "Pending Estimates",
        count: pendingCount,
        color: metricColor(pendingCount, 2, 4),
      });
    }

    return rows;
  }, [projects, tasks, estimates, size, t]);

  // Find max count for proportion bars
  const maxCount = useMemo(() => {
    if (breakdownMetrics.length === 0) return 1;
    return Math.max(...breakdownMetrics.map((m) => m.count), 1);
  }, [breakdownMetrics]);

  const animatedWeeks = useAnimatedValue(isVisible ? Math.round(backlog.weeks * 10) : 0, 1000);
  const displayWeeks = (animatedWeeks / 10).toFixed(1);
  const color = backlogColor(backlog.weeks);

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {t("backlogDepth.title") ?? "Backlog"}
          </span>
          <WidgetSkeleton variant="stat" />
        </div>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (backlog.projectCount === 0) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider">
            {t("backlogDepth.title") ?? "Backlog"}
          </span>
          <WidgetEmptyState
            message={t("backlogDepth.noPending") ?? "No signed projects pending"}
            cta={size === "xs" ? undefined : { label: t("backlogDepth.viewProjects") ?? "View Projects", onClick: () => onNavigate("/projects") }}
            className="flex-1"
          />
        </div>
      </Card>
    );
  }

  // Gauge scale constants
  const maxWeeks = 10;
  const gaugePct = Math.min((backlog.weeks / maxWeeks) * 100, 100);

  // ── XS: Hero weeks + color ────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none" style={{ color }}>
            {displayWeeks}
          </span>
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("backlogDepth.title") ?? "Backlog"}
          </span>
          <span className="font-mono text-micro text-text-mute uppercase">
            {t("backlogDepth.weeks") ?? "wk"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + gauge bar + status label ─────────────────────────
  if (size === "sm") {
    const gaugeHeight = 8;
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none" style={{ color }}>
              {displayWeeks}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/projects"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-mute" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("backlogDepth.title") ?? "Backlog"}
          </span>
          {/* Row 3: Gauge bar + status label */}
          <div className="relative w-full rounded-sm overflow-hidden mt-1.5" style={{ height: `${gaugeHeight}px` }}>
            <div className="absolute inset-0 flex">
              <div className="h-full" style={{ width: "10%", backgroundColor: WT.errorMuted, opacity: 0.25 }} />
              <div className="h-full" style={{ width: "20%", backgroundColor: WT.warningMuted, opacity: 0.25 }} />
              <div className="h-full" style={{ width: "30%", backgroundColor: WT.successMuted, opacity: 0.25 }} />
              <div className="h-full" style={{ width: "20%", backgroundColor: WT.warningMuted, opacity: 0.25 }} />
              <div className="h-full" style={{ width: "20%", backgroundColor: WT.errorMuted, opacity: 0.25 }} />
            </div>
            <div
              className="absolute top-0 h-full w-[3px] rounded-sm transition-all"
              style={{
                left: isVisible ? `${gaugePct}%` : "0%",
                backgroundColor: color,
                transitionDuration: reducedMotion ? "200ms" : "600ms",
                transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          </div>
          <span className="font-mono text-micro uppercase tracking-wider mt-1 block" style={{ color }}>
            {backlogLabel(backlog.weeks, t)}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD+: Hero + gauge + breakdown metrics + footer ─────────────────────
  const gaugeHeight = 10;
  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {t("backlogDepth.title") ?? "Backlog"}
          </span>
          <span className="font-mono text-caption-sm text-text-2">
            {backlog.projectCount} {t("backlogDepth.projects") ?? "projects"}
          </span>
        </div>

        {/* HERO */}
        <div className="flex items-center gap-2 mb-2">
          <span className={`font-mono ${heroClass} font-bold`} style={{ color }}>
            {displayWeeks}
          </span>
          <div className="flex flex-col">
            <span className="font-mono text-micro text-text-mute uppercase">{t("backlogDepth.weeks") ?? "wk"}</span>
            <span className="font-mono text-micro uppercase" style={{ color }}>{backlogLabel(backlog.weeks, t)}</span>
          </div>
        </div>

        {/* DETAIL ZONE: Gauge + breakdown metrics — directly in flex column */}
        {showDetail(size) && (
          <>
            {/* Gauge */}
            <div className="relative w-full rounded-sm overflow-hidden" style={{ height: `${gaugeHeight}px` }}>
              <div className="absolute inset-0 flex">
                <div className="h-full" style={{ width: "10%", backgroundColor: WT.errorMuted, opacity: 0.25 }} />
                <div className="h-full" style={{ width: "20%", backgroundColor: WT.warningMuted, opacity: 0.25 }} />
                <div className="h-full" style={{ width: "30%", backgroundColor: WT.successMuted, opacity: 0.25 }} />
                <div className="h-full" style={{ width: "20%", backgroundColor: WT.warningMuted, opacity: 0.25 }} />
                <div className="h-full" style={{ width: "20%", backgroundColor: WT.errorMuted, opacity: 0.25 }} />
              </div>
              <div
                className="absolute top-0 h-full w-[3px] rounded-sm transition-all"
                style={{
                  left: isVisible ? `${gaugePct}%` : "0%",
                  backgroundColor: color,
                  transitionDuration: reducedMotion ? "200ms" : "600ms",
                  transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-1 mb-2">
              <span className="font-mono text-micro text-text-mute uppercase">0</span>
              <span className="font-mono text-micro text-text-mute uppercase">10+ {t("backlogDepth.weeks") ?? "wk"}</span>
            </div>

            {/* Breakdown metric rows — flex-1 to fill vertical space */}
            {breakdownMetrics.length > 0 && (
              <div className="flex flex-col flex-1 min-h-0 pt-2 border-t border-border-subtle" style={{ gap: "2px" }}>
                {breakdownMetrics.map((metric, i) => {
                  const barPct = maxCount > 0 ? Math.max((metric.count / maxCount) * 100, metric.count > 0 ? 8 : 0) : 0;
                  return (
                    <div
                      key={metric.key}
                      className="flex-1 flex flex-col justify-center min-h-[24px]"
                      style={widgetLineItemStyle(i, isVisible, reducedMotion ?? null)}
                    >
                      {/* Bar full width */}
                      <div className="w-full h-[6px] rounded-sm overflow-hidden" style={{ backgroundColor: WT.faint }}>
                        <div
                          className="h-full rounded-sm"
                          style={{
                            width: isVisible ? `${barPct}%` : "0%",
                            backgroundColor: metric.color,
                            transitionProperty: "width",
                            transitionDuration: reducedMotion ? "200ms" : "500ms",
                            transitionDelay: reducedMotion ? "0ms" : `${i * 80 + 200}ms`,
                            transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                          }}
                        />
                      </div>
                      {/* Label + count beneath */}
                      <div className="flex items-center justify-between mt-[2px]">
                        <span className="font-mono text-micro text-text-3 uppercase tracking-wider">
                          {metric.label}
                        </span>
                        <span className="font-mono text-micro font-bold" style={{ color: metric.color }}>
                          {metric.count}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

      </div>
    </Card>
  );
}
