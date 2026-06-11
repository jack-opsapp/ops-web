"use client";

import { useMemo, useRef, useState } from "react";
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
import { WidgetMoreButton } from "./shared/widget-more-button";
import { widgetLineItemStyle } from "./shared/widget-motion";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
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
  const [listExpanded, setListExpanded] = useState(false);

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
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
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider">
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
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span
            className="font-mono text-display font-bold leading-none"
            style={{ color: avgColor }}
          >
            {animatedUtilization}%
          </span>
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("crewBoard.title") ?? "Crew"}
          </span>
          <WidgetTrendContext variant="snapshot" label={t("trend.today") ?? "Today"} />
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
              onClick={(e) => { e.stopPropagation(); onNavigate("/schedule"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-mute" />
            </button>
          </div>
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("crewBoard.title") ?? "Crew"}
          </span>
          <span className="font-mono text-micro text-text-mute uppercase mt-0.5">
            {t("crewBoard.utilization") ?? "Utilization"} · {crewData.members.length} {t("crewBoard.members") ?? "members"}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD: Per-member rows with today context ────────────────────────────
  const isLg = showActions(size);
  const defaultMaxMembers = isLg ? 8 : 4;
  const maxMembers = listExpanded ? crewData.members.length : defaultMaxMembers;
  const displayMembers = crewData.members.slice(0, maxMembers);
  const remaining = crewData.members.length - defaultMaxMembers;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {t("crewBoard.title") ?? "Crew"}
          </span>
          <span className="font-mono text-micro text-text-3" style={{ color: avgColor }}>
            {crewData.avgUtilization}% avg
          </span>
        </div>

        {/* Detail zone — flex-1 so ScrollFade fills remaining vertical space */}
        <div className="flex-1 min-h-0 flex flex-col">
          {listExpanded ? (
            <ScrollFade>
              <div className="flex flex-col gap-[6px]">
                {displayMembers.map((m, i) => (
                  <CrewMemberRow
                    key={m.member.id}
                    m={m}
                    i={i}
                    isLg={isLg}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                    onNavigate={onNavigate}
                    t={t}
                  />
                ))}
              </div>
              <WidgetMoreButton remaining={remaining} expanded={listExpanded} onToggle={() => setListExpanded((v) => !v)} className="mt-1" />
            </ScrollFade>
          ) : (
            <>
              <div className="flex flex-col gap-[6px]">
                {displayMembers.map((m, i) => (
                  <CrewMemberRow
                    key={m.member.id}
                    m={m}
                    i={i}
                    isLg={isLg}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                    onNavigate={onNavigate}
                    t={t}
                  />
                ))}
              </div>
              {remaining > 0 && (
                <WidgetMoreButton remaining={remaining} expanded={listExpanded} onToggle={() => setListExpanded((v) => !v)} className="mt-1" />
              )}
            </>
          )}
        </div>

      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Crew Member Row (extracted for reuse in collapsed/expanded branches)
// ---------------------------------------------------------------------------
interface CrewMemberRowProps {
  m: {
    member: User;
    todayAssigned: ProjectTask[];
    todayCount: number;
    utilization: number;
    currentTask: ProjectTask | undefined;
    availability: "available" | "busy" | "overloaded";
  };
  i: number;
  isLg: boolean;
  isVisible: boolean;
  reducedMotion: boolean | null;
  onNavigate: (path: string) => void;
  t: (key: string) => string;
}

function CrewMemberRow({ m, i, isLg, isVisible, reducedMotion, onNavigate, t }: CrewMemberRowProps) {
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
            <span className="font-mono text-micro whitespace-nowrap" style={availColor ? { color: availColor } : undefined}>
              {availText}
            </span>
          ) : undefined
        }
        action={isLg ? (
          <WidgetInlineAction
            icon={CalendarDays}
            actions={[
              { icon: CalendarDays, label: t("crewBoard.assignTask") ?? "Assign Task", onAction: () => onNavigate("/schedule") },
              { icon: ArrowUpRight, label: t("crewBoard.viewSchedule") ?? "View Schedule", onAction: () => onNavigate("/schedule") },
            ]}
          />
        ) : undefined}
        onClick={() => onNavigate("/schedule")}
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
            <span className="font-mono text-micro text-text-mute px-1">
              +{m.todayAssigned.length - 3} {t("widgets.more") ?? "more"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
