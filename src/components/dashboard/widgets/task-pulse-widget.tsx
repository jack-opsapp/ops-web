"use client";

import { useMemo, useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { ScrollFade } from "./shared/scroll-fade";
import { widgetLineItemStyle } from "./shared/widget-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { useWidgetEntityOpen } from "./shared/use-widget-entity-open";
import { WT, isCompact, showDetail } from "@/lib/widget-tokens";
import type { ProjectTask, Project, Client } from "@/lib/types/models";
import { TaskStatus } from "@/lib/types/models";
import type { Estimate } from "@/lib/types/pipeline";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { CheckCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Segment colors — muted for chart fills, raw for badges/hero
// ---------------------------------------------------------------------------
const SEGMENT_COLORS = {
  overdue: WT.errorMuted,
  dueToday: WT.warningMuted,
  inProgress: WT.accent,
  upcoming: WT.muted,
} as const;

const SEGMENT_COLORS_RAW = {
  overdue: WT.error,
  dueToday: WT.warning,
  inProgress: WT.accent,
  upcoming: WT.muted,
} as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface TaskPulseWidgetProps {
  size: WidgetSize;
  tasks: ProjectTask[];
  estimates?: Estimate[];
  projects?: Project[];
  clients?: Client[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function TaskPulseWidget({ size, tasks, estimates, projects = [], clients = [], isLoading, onNavigate }: TaskPulseWidgetProps) {
  const { t } = useDictionary("dashboard");
  const openEntity = useWidgetEntityOpen();
  const barRef = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(barRef);
  const compact = isCompact(size);
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  // Build lookup maps for enriching task context
  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);
  const clientMap = useMemo(() => {
    const map = new Map<string, Client>();
    for (const c of clients) map.set(c.id, c);
    return map;
  }, [clients]);

  // ── Tooltip state ─────────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    segment: string;
    count: number;
    pct: number;
  }>({ visible: false, x: 0, y: 0, segment: "", count: 0, pct: 0 });

  // ── Project value map from approved estimates ─────────────────────────
  const projectValueMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!estimates) return map;
    for (const est of estimates) {
      if (est.deletedAt) continue;
      if (est.status !== EstimateStatus.Approved) continue;
      if (!est.projectId) continue;
      map.set(est.projectId, (map.get(est.projectId) ?? 0) + est.total);
    }
    return map;
  }, [estimates]);

  // ── Categorize tasks ──────────────────────────────────────────────────
  const segments = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAhead = new Date(today);
    weekAhead.setDate(weekAhead.getDate() + 7);

    const active = tasks.filter(
      (t) => !t.deletedAt && t.status !== TaskStatus.Completed && t.status !== TaskStatus.Cancelled
    );

    let overdue = 0;
    let dueToday = 0;
    let inProgress = 0;
    let upcoming = 0;

    for (const task of active) {
      const start = task.startDate ? new Date(task.startDate) : null;
      const startDay = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()) : null;

      if (startDay && startDay < today) {
        overdue++;
      } else if (startDay && startDay.getTime() === today.getTime()) {
        dueToday++;
      } else if (task.status === TaskStatus.InProgress && startDay && startDay >= today) {
        inProgress++;
      } else if (startDay && startDay > today && startDay <= weekAhead) {
        upcoming++;
      } else if (task.status === TaskStatus.InProgress) {
        inProgress++;
      } else {
        upcoming++;
      }
    }

    const total = overdue + dueToday + inProgress + upcoming;
    return { overdue, dueToday, inProgress, upcoming, total };
  }, [tasks]);

  // ── Overdue tasks for MD detail zone ──────────────────────────────────
  const overdueTasks = useMemo(() => {
    if (!showDetail(size)) return [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const active = tasks.filter(
      (t) => !t.deletedAt && t.status !== TaskStatus.Completed && t.status !== TaskStatus.Cancelled
    );

    // Build a map of project future tasks (to detect blocking)
    const projectFutureTaskCount = new Map<string, number>();
    for (const task of active) {
      if (!task.projectId) continue;
      const start = task.startDate ? new Date(task.startDate) : null;
      const startDay = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()) : null;
      if (startDay && startDay > today) {
        projectFutureTaskCount.set(task.projectId, (projectFutureTaskCount.get(task.projectId) ?? 0) + 1);
      }
    }

    return active
      .filter((task) => {
        const start = task.startDate ? new Date(task.startDate) : null;
        if (!start) return false;
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        return startDay < today;
      })
      .map((task) => {
        const start = new Date(task.startDate!);
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const daysOverdue = Math.floor((today.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24));
        const isBlocking = task.projectId
          ? (projectFutureTaskCount.get(task.projectId) ?? 0) === 0
          : false;
        const projectValue = task.projectId ? projectValueMap.get(task.projectId) : undefined;
        return { task, daysOverdue, isBlocking, projectValue };
      })
      .sort((a, b) => {
        // Blocking tasks first, then by days overdue descending
        if (a.isBlocking !== b.isBlocking) return a.isBlocking ? -1 : 1;
        return b.daysOverdue - a.daysOverdue;
      });
  }, [tasks, size, projectValueMap]);

  // ── Segment entries for bars + legends ────────────────────────────────
  const segmentEntries = [
    { key: "overdue", count: segments.overdue, color: SEGMENT_COLORS.overdue, rawColor: SEGMENT_COLORS_RAW.overdue, label: t("taskPulse.overdue") ?? "Overdue" },
    { key: "dueToday", count: segments.dueToday, color: SEGMENT_COLORS.dueToday, rawColor: SEGMENT_COLORS_RAW.dueToday, label: t("taskPulse.dueToday") ?? "Due Today" },
    { key: "inProgress", count: segments.inProgress, color: SEGMENT_COLORS.inProgress, rawColor: SEGMENT_COLORS_RAW.inProgress, label: t("taskPulse.inProgress") ?? "In Progress" },
    { key: "upcoming", count: segments.upcoming, color: SEGMENT_COLORS.upcoming, rawColor: SEGMENT_COLORS_RAW.upcoming, label: t("taskPulse.upcoming") ?? "Upcoming" },
  ];

  const handleSegmentHover = (
    e: React.MouseEvent,
    segment: string,
    count: number
  ) => {
    if (!barRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const parentRect = barRef.current.getBoundingClientRect();
    setTooltip({
      visible: true,
      x: rect.left - parentRect.left + rect.width / 2,
      y: 0,
      segment,
      count,
      pct: segments.total > 0 ? Math.round((count / segments.total) * 100) : 0,
    });
  };

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("taskPulse.title") ?? "Tasks"}
          </span>
          <WidgetSkeleton variant="horizontal-bars" />
        </div>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  if (segments.total === 0) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("taskPulse.title") ?? "Tasks"}
          </span>
          <WidgetEmptyState
            icon={CheckCircle}
            message={t("taskPulse.allClear") ?? "All clear"}
            className="flex-1"
          />
        </div>
      </Card>
    );
  }

  const hasOverdue = segments.overdue > 0;
  const barHeight = compact ? 14 : 20;

  // ── Segmented bar + legend (reusable across SM/MD) ────────────────────
  const segmentedBar = (
    <div ref={barRef}>
      <div className="relative w-full rounded-sm overflow-hidden flex" style={{ height: `${barHeight}px` }}>
        <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={barRef} anchor="above">
          <TooltipRow label={tooltip.segment} value={`${tooltip.count}`} delta={{ value: `${tooltip.pct}%`, direction: "neutral" }} />
        </WidgetTooltip>
        {segmentEntries.map((seg, i) => {
          if (seg.count === 0) return null;
          const pct = (seg.count / segments.total) * 100;
          return (
            <div
              key={seg.key}
              className="h-full"
              style={{
                width: isVisible ? `${pct}%` : "0%",
                backgroundColor: seg.color,
                transitionProperty: "width",
                transitionDuration: reducedMotion ? "200ms" : "400ms",
                transitionDelay: reducedMotion ? "0ms" : `${i * 100}ms`,
                transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
              }}
              onMouseEnter={(e) => handleSegmentHover(e, seg.label, seg.count)}
              onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
            />
          );
        })}
      </div>
      {/* Segment legend */}
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        {segmentEntries.map((seg) => {
          if (seg.count === 0) return null;
          return (
            <span key={seg.key} className="font-mono text-micro-sm whitespace-nowrap" style={{ color: seg.rawColor }}>
              {seg.count} {seg.label.toLowerCase()}
              {seg.key !== "upcoming" && <span className="text-text-disabled mx-0.5">·</span>}
            </span>
          );
        })}
      </div>
    </div>
  );

  // ── XS: Header + Hero ────────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3">
          <span
            className="font-mono text-display font-bold leading-none text-text-primary"
          >
            {hasOverdue ? segments.overdue : segments.total}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("taskPulse.title") ?? "Tasks"}
          </span>
          <WidgetTrendContext
            variant="health"
            color={hasOverdue ? WT.error : WT.success}
            label={hasOverdue ? `${segments.overdue} ${t("trend.overdue") ?? "Overdue"}` : (t("trend.onTrack") ?? "On Track")}
          />
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + segmented bar + legend ──────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number */}
          <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
            {segments.total}
          </span>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("taskPulse.title") ?? "Tasks"}
          </span>
          {/* Row 3: Health indicator */}
          <WidgetTrendContext
            variant="health"
            color={hasOverdue ? WT.error : WT.success}
            label={hasOverdue ? `${segments.overdue} ${t("trend.overdue") ?? "Overdue"}` : (t("trend.onTrack") ?? "On Track")}
          />
          {/* Row 4: Segmented bar (no tooltip at SM — bar too small) */}
          <div className="mt-1.5 pointer-events-none">
            {segmentedBar}
          </div>
        </div>
      </Card>
    );
  }

  // ── MD+: Bar + collapsible overdue list ───────────────────────────────
  const previewCount = 3;
  const visibleOverdue = expanded ? overdueTasks : overdueTasks.slice(0, previewCount);
  const remaining = overdueTasks.length - previewCount;

  return (
    <Card className="h-full">
      <div className="h-full flex flex-col px-3 py-2">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("taskPulse.title") ?? "Tasks"}
          </span>
          <span
            className="font-mono text-micro-sm px-1.5 py-0.5 rounded-sm"
            style={{
              backgroundColor: hasOverdue ? `${WT.error}20` : `${WT.accent}20`,
              color: hasOverdue ? WT.error : WT.accent,
            }}
          >
            {segments.total}
          </span>
        </div>

        {/* Collapsible bar graphic */}
        <WidgetHeroCollapse collapsed={expanded} collapsedHeight="0px" expandedHeight="80px">
          {segmentedBar}
        </WidgetHeroCollapse>

        {/* Overdue task list */}
        {overdueTasks.length > 0 && (
          <>
            {!expanded && <div className="mt-2 border-t border-border-subtle" />}
            <ScrollFade className={!expanded ? "pt-1" : undefined}>
              <div className="flex flex-col">
                {visibleOverdue.map(({ task, daysOverdue, isBlocking, projectValue }, i) => {
                  const project = task.projectId ? projectMap.get(task.projectId) : null;
                  const client = project?.clientId ? clientMap.get(project.clientId) : null;
                  const clientName = client?.name ?? task.project?.client?.name;
                  const projectName = project?.title ?? task.project?.title;
                  const secondaryParts = [clientName, projectName].filter(Boolean);
                  const metricParts: string[] = [`${daysOverdue}${t("taskPulse.dOverdue") ?? "d overdue"}`];
                  if (projectValue !== undefined) {
                    metricParts.push(formatCompactCurrency(projectValue));
                  }

                  return (
                    <WidgetLineItem
                      key={task.id}
                      indicator={{
                        type: "bar",
                        color: isBlocking ? WT.error : (task.taskColor || WT.accent),
                        label: isBlocking ? "Blocking" : "Overdue",
                      }}
                      primary={task.customTitle || task.taskType?.display || "Task"}
                      secondary={secondaryParts.join(" · ") || undefined}
                      metric={metricParts.join(" · ")}
                      onClick={task.projectId ? (e) => openEntity({
                        entityType: "project",
                        entityId: task.projectId!,
                        title: task.project?.title || task.customTitle || "Project",
                        color: isBlocking ? WT.error : (task.taskColor || WT.accent),
                        event: e,
                        fallbackPath: `/projects/${task.projectId}`,
                      }) : undefined}
                      index={i}
                      isVisible={isVisible}
                      reducedMotion={reducedMotion}
                    />
                  );
                })}
              </div>
            </ScrollFade>
          </>
        )}

        {/* More button — outside scroll area, never overlaps */}
        {remaining > 0 && (
          <WidgetMoreButton
            remaining={remaining}
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
            label={t("taskPulse.moreOverdue") ?? "more overdue"}
            className="mt-1 shrink-0"
          />
        )}

      </div>
    </Card>
  );
}
