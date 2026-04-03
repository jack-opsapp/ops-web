"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetInlineAction } from "./shared/widget-inline-action";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { useAnimatedValue } from "./shared/use-animated-value";
import { ScrollFade } from "./shared/scroll-fade";
import { widgetLineItemStyle } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { User, ProjectTask } from "@/lib/types/models";
import { TaskStatus } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Utilization color
// ---------------------------------------------------------------------------
function utilizationColor(pct: number): string {
  if (pct > 100) return WT.error;
  if (pct >= 60) return WT.success;
  if (pct >= 20) return WT.warning;
  return WT.muted;
}

function getInitials(user: User): string {
  return `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface CrewBoardWidgetProps {
  size: WidgetSize;
  teamMembers: User[];
  tasks: ProjectTask[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function CrewBoardWidget({
  size,
  teamMembers,
  tasks,
  isLoading,
  onNavigate,
}: CrewBoardWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;
  const reducedMotion = useReducedMotion();

  // ── Compute crew data ─────────────────────────────────────────────────
  const crewData = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const activeMembers = teamMembers.filter((m) => m.isActive !== false);

    const activeTasks = tasks.filter(
      (task) =>
        !task.deletedAt &&
        task.status !== TaskStatus.Completed &&
        task.status !== TaskStatus.Cancelled
    );

    // Tasks scheduled for today
    const todayTasks = activeTasks.filter((task) => {
      const start = task.startDate ? new Date(task.startDate) : null;
      if (!start) return false;
      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      return startDay.getTime() === today.getTime();
    });

    const maxTasks = 5;

    const members = activeMembers.map((member) => {
      const allAssigned = activeTasks.filter((task) => task.teamMemberIds.includes(member.id));
      const todayAssigned = todayTasks.filter((task) => task.teamMemberIds.includes(member.id));
      const utilization = Math.min(Math.round((allAssigned.length / maxTasks) * 100), 100);
      const currentTask = allAssigned.find((task) => task.status === TaskStatus.InProgress);

      // Availability status
      let availability: "available" | "busy" | "overloaded";
      if (todayAssigned.length === 0 && !currentTask) {
        availability = "available";
      } else if (todayAssigned.length >= 5) {
        availability = "overloaded";
      } else {
        availability = "busy";
      }

      return {
        member,
        allAssigned,
        todayAssigned,
        assignedCount: allAssigned.length,
        todayCount: todayAssigned.length,
        utilization,
        currentTask,
        availability,
      };
    });

    // Sort: in-progress first, then by today task count desc, then idle
    members.sort((a, b) => {
      if (a.currentTask && !b.currentTask) return -1;
      if (!a.currentTask && b.currentTask) return 1;
      return b.todayCount - a.todayCount;
    });

    const avgUtilization = members.length > 0
      ? Math.round(members.reduce((sum, m) => sum + m.utilization, 0) / members.length)
      : 0;

    return { members, avgUtilization };
  }, [teamMembers, tasks]);

  const animatedUtilization = useAnimatedValue(isVisible ? crewData.avgUtilization : 0, 1000);
  const avgColor = utilizationColor(crewData.avgUtilization);

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("crewBoard.title") ?? "Crew"}
          </span>
          <WidgetSkeleton variant="list" />
        </div>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  if (crewData.members.length === 0) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("crewBoard.title") ?? "Crew"}
          </span>
          <WidgetEmptyState
            message={t("crewBoard.noMembers") ?? "No team members"}
            className="flex-1"
          />
        </div>
      </Card>
    );
  }

  // ── XS: Hero = team utilization % ─────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/calendar")}>
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span
            className="font-mono text-display font-bold leading-none"
            style={{ color: avgColor }}
          >
            {animatedUtilization}%
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("crewBoard.title") ?? "Crew"}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {t("crewBoard.utilization") ?? "Utilization"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + utilization/members ──────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none" style={{ color: avgColor }}>
              {animatedUtilization}%
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/calendar"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("crewBoard.title") ?? "Crew"}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase mt-0.5">
            {t("crewBoard.utilization") ?? "Utilization"} · {crewData.members.length} {t("crewBoard.members") ?? "members"}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD: Per-member rows with today context ────────────────────────────
  const isLg = showActions(size);
  const maxMembers = isLg ? 8 : 4;
  const displayMembers = crewData.members.slice(0, maxMembers);
  const remaining = crewData.members.length - maxMembers;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("crewBoard.title") ?? "Crew"}
          </span>
          <span className="font-mono text-micro text-text-tertiary" style={{ color: avgColor }}>
            {crewData.avgUtilization}% avg
          </span>
        </div>

        {/* Detail zone — flex-1 so ScrollFade fills remaining vertical space */}
        <ScrollFade className="flex-1 min-h-0">
          <div className="flex flex-col gap-[6px]">
            {displayMembers.map((m, i) => {
              // Availability text and color
              const availText = m.availability === "available"
                ? (t("crewBoard.available") ?? "Available")
                : m.availability === "overloaded"
                  ? (t("crewBoard.overloaded") ?? "Overloaded")
                  : (m.currentTask?.customTitle || m.currentTask?.taskType?.display || null);
              const availColor = m.availability === "available"
                ? WT.success
                : m.availability === "overloaded"
                  ? WT.error
                  : undefined;

              return (
                <div
                  key={m.member.id}
                  className="flex flex-col gap-[2px]"
                  style={widgetLineItemStyle(i, isVisible, reducedMotion ?? null)}
                >
                  {/* Member row */}
                  <WidgetLineItem
                    indicator={{
                      type: "avatar",
                      color: "transparent",
                      initials: getInitials(m.member),
                    }}
                    primary={`${m.member.firstName ?? ""} ${m.member.lastName ?? ""}`.trim()}
                    secondary={`${m.todayCount} ${t("crewBoard.tasksToday") ?? "tasks today"}`}
                    metric={
                      availText ? (
                        <span className="font-mono text-micro-sm whitespace-nowrap" style={availColor ? { color: availColor } : undefined}>
                          {availText}
                        </span>
                      ) : undefined
                    }
                    action={isLg ? (
                      <WidgetInlineAction
                        icon={CalendarDays}
                        actions={[
                          { icon: CalendarDays, label: t("crewBoard.assignTask") ?? "Assign Task", onAction: () => onNavigate("/calendar") },
                          { icon: ArrowUpRight, label: t("crewBoard.viewSchedule") ?? "View Schedule", onAction: () => onNavigate("/calendar") },
                        ]}
                      />
                    ) : undefined}
                    onClick={() => onNavigate("/calendar")}
                  />

                  {/* Utilization bar */}
                  <div className="ml-[24px] w-[calc(100%-24px)]">
                    <div className="w-full h-[4px] rounded-sm overflow-hidden" style={{ backgroundColor: WT.faint }}>
                      <div
                        className="h-full rounded-sm"
                        style={{
                          width: isVisible ? `${m.utilization}%` : "0%",
                          backgroundColor: utilizationColor(m.utilization),
                          transitionProperty: "width",
                          transitionDuration: reducedMotion ? "200ms" : "500ms",
                          transitionDelay: reducedMotion ? "0ms" : `${i * 50 + 100}ms`,
                          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                      />
                    </div>
                  </div>

                  {/* LG: Sub-tasks */}
                  {isLg && m.todayAssigned.length > 0 && (
                    <div className="ml-[24px] flex flex-col">
                      {m.todayAssigned.slice(0, 3).map((task) => (
                        <WidgetLineItem
                          key={task.id}
                          indicator={{ type: "bar", color: task.taskColor || WT.accent }}
                          primary={task.customTitle || task.taskType?.display || "Task"}
                          secondary={task.project?.title ?? undefined}
                          onClick={() => task.projectId && onNavigate(`/projects/${task.projectId}`)}
                          className="py-[1px]"
                        />
                      ))}
                      {m.todayAssigned.length > 3 && (
                        <span className="font-mono text-micro-sm text-text-disabled px-1">
                          +{m.todayAssigned.length - 3} {t("widgets.more") ?? "more"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {remaining > 0 && (
            <button
              onClick={() => onNavigate("/calendar")}
              className="font-kosugi text-micro-sm text-text-tertiary cursor-pointer hover:text-text-secondary transition-colors block px-1 mt-1"
            >
              +{remaining} {t("widgets.more") ?? "more"}
            </button>
          )}
        </ScrollFade>

        {/* Footer */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/calendar")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("crewBoard.viewSchedule") ?? "View Schedule"}
          </button>
        )}
      </div>
    </Card>
  );
}
