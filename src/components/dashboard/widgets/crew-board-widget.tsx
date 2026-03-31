"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useAnimatedValue } from "./shared/use-animated-value";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { User, ProjectTask } from "@/lib/types/models";
import { TaskStatus } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Utilization color — from WT tokens, thresholds per widget reference spec
// ---------------------------------------------------------------------------
function utilizationColor(pct: number): string {
  if (pct > 100) return WT.error;     // Overloaded
  if (pct >= 60) return WT.success;   // Healthy
  if (pct >= 20) return WT.warning;   // Light
  return WT.muted;                     // Idle
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

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  // ── Compute crew data ─────────────────────────────────────────────────
  const crewData = useMemo(() => {
    const activeMembers = teamMembers.filter((m) => m.isActive !== false);

    const activeTasks = tasks.filter(
      (task) =>
        !task.deletedAt &&
        task.status !== TaskStatus.Completed &&
        task.status !== TaskStatus.Cancelled
    );

    // 5 concurrent tasks = 100% utilization baseline
    const maxTasks = 5;

    const members = activeMembers.map((member) => {
      const assigned = activeTasks.filter((task) =>
        task.teamMemberIds.includes(member.id)
      );
      const utilization = Math.min(Math.round((assigned.length / maxTasks) * 100), 100);
      const currentTask = assigned.find((task) => task.status === TaskStatus.InProgress);
      return {
        member,
        assignedCount: assigned.length,
        utilization,
        currentTask,
      };
    });

    members.sort((a, b) => b.utilization - a.utilization);

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
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("crewBoard.title") ?? "Crew"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="list" />
        </CardContent>
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
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${heroClass} font-bold text-text-disabled leading-none`}>
              0%
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("crewBoard.noMembers") ?? "No team members"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
              {t("crewBoard.viewSchedule") ?? "View Schedule"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── XS: Hero = team utilization % ─────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/calendar")}>
        <div className="h-full flex flex-col pt-3">
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
          {/* Row 1: Hero number + tiny nav icon */}
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
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("crewBoard.title") ?? "Crew"}
          </span>
          {/* Row 3: Utilization + members */}
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase mt-0.5">
            {t("crewBoard.utilization") ?? "Utilization"} · {crewData.members.length} {t("crewBoard.members") ?? "members"}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD / LG: Utilization bars ─────────────────────────────────────────
  const maxMembers = showActions(size) ? 7 : 4;
  const displayMembers = crewData.members.slice(0, maxMembers);

  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("crewBoard.title") ?? "Crew"}
          </span>
          <span className="font-mono text-micro text-text-tertiary" style={{ color: avgColor }}>
            {crewData.avgUtilization}% avg
          </span>
        </div>

        {/* Detail zone */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <div className="flex flex-col gap-[6px]">
            {displayMembers.map((m, i) => (
              <div
                key={m.member.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] rounded-sm px-1 py-[2px] transition-colors"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? "translateX(0)" : "translateX(-4px)",
                  transition: reducedMotion
                    ? "opacity 200ms ease"
                    : `opacity 300ms ease ${i * 50}ms, transform 300ms ease ${i * 50}ms`,
                }}
                onClick={() => onNavigate("/calendar")}
              >
                {/* Avatar */}
                <div className="w-[22px] h-[22px] rounded-full bg-surface-secondary flex items-center justify-center shrink-0">
                  <span className="font-kosugi text-[8px] text-text-tertiary">{getInitials(m.member)}</span>
                </div>
                {/* Name + bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-[2px]">
                    <span className="font-mohave text-micro text-text-secondary truncate">
                      {m.member.firstName} {m.member.lastName}
                    </span>
                    <span className="font-mono text-micro-sm text-text-tertiary shrink-0 ml-1">
                      {m.assignedCount} {t("crewBoard.tasks") ?? "tasks"}
                    </span>
                  </div>
                  <div className="w-full h-[6px] rounded-sm overflow-hidden" style={{ backgroundColor: WT.faint }}>
                    <div
                      className="h-full rounded-sm"
                      style={{
                        width: isVisible ? `${m.utilization}%` : "0%",
                        backgroundColor: utilizationColor(m.utilization),
                        transitionProperty: "width",
                        transitionDuration: reducedMotion ? "200ms" : "500ms",
                        transitionDelay: reducedMotion ? "0ms" : `${i * 50 + 100}ms`,
                        transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                      }}
                    />
                  </div>
                  {/* Current task (LG only) */}
                  {showActions(size) && m.currentTask && (
                    <p className="font-kosugi text-micro-sm text-text-disabled truncate mt-[1px]">
                      {m.currentTask.customTitle || m.currentTask.taskType?.display || "Task"}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {crewData.members.length > maxMembers && (
            <span className="font-mono text-micro-sm text-text-tertiary mt-1 block">
              +{crewData.members.length - maxMembers} more
            </span>
          )}
        </div>

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
