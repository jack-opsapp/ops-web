"use client";

import { useMemo, useRef } from "react";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { User, ProjectTask } from "@/lib/types/models";
import { TaskStatus } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

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
// Helpers
// ---------------------------------------------------------------------------
function utilizationColor(pct: number): string {
  if (pct >= 80) return "#B58289";  // Overloaded
  if (pct >= 50) return "#6B8F71";  // Healthy
  if (pct >= 20) return "#C4A868";  // Light
  return "rgba(255,255,255,0.2)";    // Idle
}

function getInitials(user: User): string {
  return `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();
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

  const crewData = useMemo(() => {
    const activeMembers = teamMembers.filter((m) => m.isActive !== false);

    // Count active tasks per member
    const activeTasks = tasks.filter(
      (task) =>
        !task.deletedAt &&
        task.status !== TaskStatus.Completed &&
        task.status !== TaskStatus.Cancelled
    );

    // Max tasks for utilization baseline (assume 5 concurrent tasks = 100%)
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

    // Sort by utilization descending
    members.sort((a, b) => b.utilization - a.utilization);

    const avgUtilization = members.length > 0
      ? Math.round(members.reduce((sum, m) => sum + m.utilization, 0) / members.length)
      : 0;

    return { members, avgUtilization };
  }, [teamMembers, tasks]);

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("crewBoard.title") ?? "Crew"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="list" />
        </CardContent>
      </Card>
    );
  }

  if (crewData.members.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("crewBoard.title") ?? "Crew"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 flex items-center justify-center h-[calc(100%-28px)]">
          <span className="font-mohave text-[13px] text-text-tertiary">
            {t("crewBoard.noMembers") ?? "No team members"}
          </span>
        </CardContent>
      </Card>
    );
  }

  // ── SM: Avg utilization + avatar row ────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full" ref={ref}>
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("crewBoard.title") ?? "Crew"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="font-mono text-[20px] font-medium" style={{ color: utilizationColor(crewData.avgUtilization) }}>
              {crewData.avgUtilization}%
            </span>
            <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
              {t("crewBoard.utilization") ?? "Utilization"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {crewData.members.slice(0, 6).map((m) => (
              <div
                key={m.member.id}
                className="w-[24px] h-[24px] rounded-full bg-surface-secondary flex items-center justify-center"
                style={{
                  borderBottom: `2px solid ${utilizationColor(m.utilization)}`,
                }}
                title={`${m.member.firstName} ${m.member.lastName}: ${m.assignedCount} tasks`}
              >
                <span className="font-kosugi text-[8px] text-text-tertiary">{getInitials(m.member)}</span>
              </div>
            ))}
            {crewData.members.length > 6 && (
              <span className="font-mono text-[10px] text-text-tertiary">+{crewData.members.length - 6}</span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG: Utilization bars ───────────────────────────────────────────
  const maxMembers = size === "lg" ? 7 : 4;
  const displayMembers = crewData.members.slice(0, maxMembers);

  return (
    <Card className="h-full" ref={ref}>
      <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("crewBoard.title") ?? "Crew"}
        </CardTitle>
        <span className="font-mono text-[11px] text-text-tertiary">
          {crewData.avgUtilization}% avg
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden">
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
                  <span className="font-mohave text-[11px] text-text-secondary truncate">
                    {m.member.firstName} {m.member.lastName}
                  </span>
                  <span className="font-mono text-[10px] text-text-tertiary shrink-0 ml-1">
                    {m.assignedCount} {t("crewBoard.tasks") ?? "tasks"}
                  </span>
                </div>
                <div className="w-full h-[6px] rounded-sm overflow-hidden bg-[rgba(255,255,255,0.04)]">
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{
                      width: isVisible ? `${m.utilization}%` : "0%",
                      backgroundColor: utilizationColor(m.utilization),
                      transitionDuration: reducedMotion ? "200ms" : "500ms",
                      transitionDelay: reducedMotion ? "0ms" : `${i * 50 + 100}ms`,
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  />
                </div>
                {/* Current task (lg only) */}
                {size === "lg" && m.currentTask && (
                  <p className="font-kosugi text-[9px] text-text-tertiary truncate mt-[1px]">
                    {m.currentTask.customTitle || m.currentTask.taskType?.display || "Task"}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        {crewData.members.length > maxMembers && (
          <span className="font-mono text-[10px] text-text-tertiary mt-1 block">
            +{crewData.members.length - maxMembers} more
          </span>
        )}
      </CardContent>
    </Card>
  );
}
