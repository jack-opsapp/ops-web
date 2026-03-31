"use client";

import { useMemo, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showFooter } from "@/lib/widget-tokens";
import type { ProjectTask } from "@/lib/types/models";
import { TaskStatus } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Segment colors — muted for chart fills, raw for badges/hero
// ---------------------------------------------------------------------------
const SEGMENT_COLORS = {
  overdue: WT.errorMuted,
  dueToday: WT.warningMuted,
  inProgress: WT.accent,
  upcoming: WT.muted,
} as const;

// Raw colors for XS hero number and status indicators (tiny elements)
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
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function TaskPulseWidget({ size, tasks, isLoading, onNavigate }: TaskPulseWidgetProps) {
  const { t } = useDictionary("dashboard");
  const barRef = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(barRef);
  const compact = isCompact(size);

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  // ── Tooltip state ─────────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    segment: string;
    count: number;
    pct: number;
  }>({ visible: false, x: 0, y: 0, segment: "", count: 0, pct: 0 });

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

  // ── Top actionable tasks for MD detail zone ───────────────────────────
  const actionableTasks = useMemo(() => {
    if (!showDetail(size)) return [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const active = tasks.filter(
      (t) => !t.deletedAt && t.status !== TaskStatus.Completed && t.status !== TaskStatus.Cancelled
    );

    return active
      .map((task) => {
        const start = task.startDate ? new Date(task.startDate) : null;
        const startDay = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()) : null;
        const isOverdue = startDay ? startDay < today : false;
        const isDueToday = startDay ? startDay.getTime() === today.getTime() : false;
        const priority = isOverdue ? 0 : isDueToday ? 1 : 2;
        return { task, isOverdue, isDueToday, priority };
      })
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 4);
  }, [tasks, size]);

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
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const parentRect = barRef.current?.getBoundingClientRect();
    if (!parentRect) return;
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
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("taskPulse.title") ?? "Tasks"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </CardContent>
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
          <div className="flex-1 flex flex-col justify-center">
            <div
              className="w-full rounded-sm"
              style={{ height: compact ? "14px" : "20px", backgroundColor: WT.success }}
            />
            <span className="font-kosugi text-micro-sm text-status-success uppercase mt-1">
              {t("taskPulse.allClear") ?? "All clear"}
            </span>
          </div>
          {showFooter(size) && (
            <button
              onClick={() => onNavigate("/calendar")}
              className="mt-auto pt-1 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
            >
              {t("taskPulse.viewCalendar") ?? "View Calendar"}
            </button>
          )}
        </div>
      </Card>
    );
  }

  const hasOverdue = segments.overdue > 0;
  const barHeight = compact ? 14 : 20;

  // ── XS: Header + Hero ────────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/calendar")}>
        <div className="h-full flex flex-col justify-center px-3">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mb-1">
            {t("taskPulse.title") ?? "Tasks"}
          </span>
          <span
            className={`font-mono ${HERO_SIZE_CLASS.compact} font-bold leading-none`}
            style={{ color: hasOverdue ? SEGMENT_COLORS_RAW.overdue : WT.accent }}
          >
            {hasOverdue ? segments.overdue : segments.total}
          </span>
          <span
            className="font-kosugi text-micro-sm uppercase mt-1"
            style={{ color: hasOverdue ? SEGMENT_COLORS_RAW.overdue : undefined }}
          >
            {hasOverdue ? (t("taskPulse.overdue") ?? "Overdue") : (t("taskPulse.openTasks") ?? "Open Tasks")}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + segmented bar + legend + footer ────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full" ref={barRef}>
        <div className="h-full flex flex-col px-3 py-2">
          {/* Header row: title + hero count */}
          <div className="flex items-baseline justify-between">
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
              {t("taskPulse.title") ?? "Tasks"}
            </span>
            <span
              className={`font-mono ${HERO_SIZE_CLASS.compact} font-bold leading-none`}
              style={{ color: hasOverdue ? SEGMENT_COLORS_RAW.overdue : WT.accent }}
            >
              {segments.total}
            </span>
          </div>

          {/* Segmented bar */}
          <div className="relative w-full rounded-sm overflow-hidden flex mt-2 cursor-pointer" style={{ height: `${barHeight}px` }} onClick={() => onNavigate("/calendar")}>
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
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                  onMouseEnter={(e) => handleSegmentHover(e, seg.label, seg.count)}
                  onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                />
              );
            })}
          </div>

          {/* Segment summary */}
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

          {/* Footer */}
          <button
            onClick={() => onNavigate("/calendar")}
            className="mt-auto pt-1 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("taskPulse.viewCalendar") ?? "View Calendar"}
          </button>
        </div>
      </Card>
    );
  }

  // ── MD: Bar + detail zone with actionable tasks + footer ──────────────
  return (
    <Card className="h-full" ref={barRef}>
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

        {/* Segmented bar */}
        <div className="relative w-full rounded-sm overflow-hidden flex cursor-pointer" style={{ height: `${barHeight}px` }} onClick={() => onNavigate("/calendar")}>
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
                  transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                }}
                onMouseEnter={(e) => handleSegmentHover(e, seg.label, seg.count)}
                onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
              />
            );
          })}
        </div>

        {/* Segment counts */}
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
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

        {/* Detail zone: Actionable task rows */}
        {showDetail(size) && actionableTasks.length > 0 && (
          <div className="mt-3 pt-2 border-t border-border-subtle flex-1 overflow-y-auto scrollbar-hide">
            <div className="flex flex-col gap-[2px]">
              {actionableTasks.map(({ task, isOverdue, isDueToday }, i) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 py-1 px-1.5 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                  style={{
                    borderLeft: `2px solid ${isOverdue ? SEGMENT_COLORS_RAW.overdue : isDueToday ? SEGMENT_COLORS_RAW.dueToday : SEGMENT_COLORS_RAW.inProgress}`,
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? "translateY(0)" : "translateY(4px)",
                    transition: reducedMotion
                      ? "opacity 200ms ease"
                      : `opacity 300ms ease ${400 + i * 40}ms, transform 300ms ease ${400 + i * 40}ms`,
                  }}
                  onClick={() => task.projectId && onNavigate(`/projects/${task.projectId}`)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-mohave text-caption-sm text-text-primary truncate">
                      {task.customTitle || task.taskType?.display || "Task"}
                    </p>
                    {task.project && (
                      <p className="font-kosugi text-micro-sm text-text-disabled truncate">
                        {task.project.title}
                      </p>
                    )}
                  </div>
                  {task.teamMembers && task.teamMembers.length > 0 && (
                    <div
                      className="w-[20px] h-[20px] rounded-full bg-background-elevated flex items-center justify-center shrink-0"
                      title={task.teamMembers[0].firstName ?? ""}
                    >
                      <span className="font-kosugi text-[8px] text-text-tertiary uppercase">
                        {(task.teamMembers[0].firstName?.[0] ?? "") + (task.teamMembers[0].lastName?.[0] ?? "")}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/calendar")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("taskPulse.viewCalendar") ?? "View Calendar"}
          </button>
        )}
      </div>
    </Card>
  );
}
