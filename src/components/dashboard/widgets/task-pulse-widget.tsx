"use client";

import { useMemo, useState, useRef } from "react";
import { CheckSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { ProjectTask } from "@/lib/types/models";
import { TaskStatus } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Segment colors
// ---------------------------------------------------------------------------
const SEGMENT_COLORS = {
  overdue: "#B58289",
  dueToday: "#C4A868",
  inProgress: "#597794",
  upcoming: "rgba(255,255,255,0.15)",
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

  // Tooltip state
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    segment: string;
    count: number;
    pct: number;
  }>({ visible: false, x: 0, y: 0, segment: "", count: 0, pct: 0 });

  // Categorize tasks
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

  // Top actionable tasks for md size
  const actionableTasks = useMemo(() => {
    if (size !== "md") return [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const active = tasks.filter(
      (t) => !t.deletedAt && t.status !== TaskStatus.Completed && t.status !== TaskStatus.Cancelled
    );

    // Sort: overdue first (oldest first), then due today, then in-progress
    return active
      .map((task) => {
        const start = task.startDate ? new Date(task.startDate) : null;
        const startDay = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()) : null;
        const isOverdue = startDay ? startDay < today : false;
        const isDueToday = startDay ? startDay.getTime() === today.getTime() : false;
        const priority = isOverdue ? 0 : isDueToday ? 1 : 2;
        return { task, isOverdue, isDueToday, priority, startDay };
      })
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 4);
  }, [tasks, size]);

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("taskPulse.title") ?? "Tasks"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (segments.total === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("taskPulse.title") ?? "Tasks"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 flex flex-col items-start justify-center h-[calc(100%-28px)]">
          <div
            className="w-full h-[20px] rounded-sm"
            style={{ backgroundColor: "#6B8F71" }}
          />
          <span className="font-kosugi text-[9px] text-status-success uppercase tracking-wider mt-1">
            {t("taskPulse.allClear") ?? "All clear"}
          </span>
        </CardContent>
      </Card>
    );
  }

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

  const segmentEntries = [
    { key: "overdue", count: segments.overdue, color: SEGMENT_COLORS.overdue, label: t("taskPulse.overdue") ?? "Overdue" },
    { key: "dueToday", count: segments.dueToday, color: SEGMENT_COLORS.dueToday, label: t("taskPulse.dueToday") ?? "Due Today" },
    { key: "inProgress", count: segments.inProgress, color: SEGMENT_COLORS.inProgress, label: t("taskPulse.inProgress") ?? "In Progress" },
    { key: "upcoming", count: segments.upcoming, color: SEGMENT_COLORS.upcoming, label: t("taskPulse.upcoming") ?? "Upcoming" },
  ];

  // ── XS ──────────────────────────────────────────────────────────────────
  if (size === "xs") {
    const hasOverdue = segments.overdue > 0;
    return (
      <Card className="h-full flex flex-col items-start justify-center px-3">
        <span
          className="font-mono text-[28px] font-medium leading-none"
          style={{ color: hasOverdue ? SEGMENT_COLORS.overdue : "#597794" }}
        >
          {hasOverdue ? segments.overdue : segments.total}
        </span>
        <span
          className="font-kosugi text-[9px] uppercase tracking-wider mt-1"
          style={{ color: hasOverdue ? SEGMENT_COLORS.overdue : "var(--text-tertiary)" }}
        >
          {hasOverdue ? (t("taskPulse.overdue") ?? "Overdue") : (t("taskPulse.openTasks") ?? "Open Tasks")}
        </span>
      </Card>
    );
  }

  // ── SM / MD ─────────────────────────────────────────────────────────────
  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  return (
    <Card className="h-full">
      <CardHeader className="pb-1 pt-2 px-3">
        <CardTitle
          className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary cursor-pointer hover:text-text-secondary transition-colors"
          onClick={() => onNavigate("/calendar")}
        >
          {t("taskPulse.title") ?? "Tasks"}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden">
        {/* Segmented bar */}
        <div ref={barRef} className="relative w-full h-[20px] rounded-sm overflow-hidden flex cursor-pointer" onClick={() => onNavigate("/calendar")}>
          <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={barRef} anchor="above">
            <TooltipRow
              label={tooltip.segment}
              value={`${tooltip.count}`}
              delta={{ value: `${tooltip.pct}%`, direction: "neutral" }}
            />
          </WidgetTooltip>

          {segmentEntries.map((seg, i) => {
            if (seg.count === 0) return null;
            const pct = (seg.count / segments.total) * 100;
            return (
              <div
                key={seg.key}
                className="h-full transition-all"
                style={{
                  width: isVisible ? `${pct}%` : "0%",
                  backgroundColor: seg.color,
                  transitionProperty: "width, opacity",
                  transitionDuration: reducedMotion ? "200ms" : "400ms",
                  transitionDelay: reducedMotion ? "0ms" : `${i * 100}ms`,
                  transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  animation:
                    seg.key === "overdue" && isVisible && !reducedMotion
                      ? "task-pulse-overdue 600ms ease-in-out 1"
                      : undefined,
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
              <span key={seg.key} className="font-mono text-[10px] whitespace-nowrap" style={{ color: seg.color }}>
                {seg.count} {seg.label.toLowerCase()}
                {seg.key !== "upcoming" && <span className="text-text-quaternary mx-0.5">·</span>}
              </span>
            );
          })}
        </div>

        {/* MD: Actionable task rows */}
        {size === "md" && actionableTasks.length > 0 && (
          <div className="mt-2 flex flex-col gap-[2px]">
            {actionableTasks.map(({ task, isOverdue, isDueToday }, i) => (
              <div
                key={task.id}
                className="flex items-center gap-2 py-1 px-1.5 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                style={{
                  borderLeft: `2px solid ${isOverdue ? SEGMENT_COLORS.overdue : isDueToday ? SEGMENT_COLORS.dueToday : SEGMENT_COLORS.inProgress}`,
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? "translateY(0)" : "translateY(4px)",
                  transition: reducedMotion
                    ? "opacity 200ms ease"
                    : `opacity 300ms ease ${400 + i * 40}ms, transform 300ms ease ${400 + i * 40}ms`,
                }}
                onClick={() => task.projectId && onNavigate(`/projects/${task.projectId}`)}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-mohave text-[12px] text-text-primary truncate">
                    {task.customTitle || task.taskType?.display || "Task"}
                  </p>
                  {task.project && (
                    <p className="font-kosugi text-[9px] text-text-tertiary truncate">
                      {task.project.title}
                    </p>
                  )}
                </div>
                {task.teamMembers && task.teamMembers.length > 0 && (
                  <div
                    className="w-[20px] h-[20px] rounded-full bg-surface-secondary flex items-center justify-center shrink-0"
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
        )}
      </CardContent>

      {/* Overdue pulse keyframe */}
      <style jsx>{`
        @keyframes task-pulse-overdue {
          0% { opacity: 1; }
          50% { opacity: 0.7; }
          100% { opacity: 1; }
        }
      `}</style>
    </Card>
  );
}
