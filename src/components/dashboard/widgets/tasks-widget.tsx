"use client";

import { useMemo } from "react";
import { Clock, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { TaskStatus, getTaskDisplayTitle } from "@/lib/types/models";
import type { ProjectTask } from "@/lib/types/models";
import { format, isSameDay } from "@/lib/utils/date";

interface TasksWidgetProps {
  size: WidgetSize;
  tasks: ProjectTask[];
  isLoading: boolean;
  today: Date;
  onNavigate: (path: string) => void;
}

export function TasksWidget({
  size,
  tasks,
  isLoading,
  today,
  onNavigate,
}: TasksWidgetProps) {
  // sm: 1, md: 5, lg: 10
  const maxTasks = size === "sm" ? 1 : size === "lg" ? 10 : 5;
  const visibleTasks = tasks.slice(0, maxTasks);

  // lg: group by day
  const groupedTasks = useMemo(() => {
    if (size !== "lg") return null;
    const groups: Record<string, ProjectTask[]> = {};
    for (const task of visibleTasks) {
      const eventDate = task.calendarEvent?.startDate
        ? new Date(task.calendarEvent.startDate)
        : null;
      const key = eventDate
        ? isSameDay(eventDate, today)
          ? "Today"
          : format(eventDate, "EEE, MMM d")
        : "Unscheduled";
      if (!groups[key]) groups[key] = [];
      groups[key].push(task);
    }
    return groups;
  }, [size, visibleTasks, today]);

  // sm: next task only
  if (size === "sm") {
    const nextTask = visibleTasks[0];
    return (
      <Card className="p-2">
        <CardHeader className="pb-1">
          <CardTitle className="text-card-subtitle">Next Task</CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">Loading...</span>
            </div>
          ) : !nextTask ? (
            <p className="font-mohave text-body-sm text-text-disabled">No upcoming tasks</p>
          ) : (
            <div
              onClick={() => onNavigate(nextTask.projectId ? `/projects/${nextTask.projectId}` : "/calendar")}
              className="cursor-pointer"
            >
              <p className="font-mohave text-body-sm text-text-primary truncate">
                {getTaskDisplayTitle(nextTask, nextTask.taskType)}
              </p>
              <span className="font-mono text-[10px] text-text-tertiary">
                {nextTask.calendarEvent?.startDate
                  ? isSameDay(new Date(nextTask.calendarEvent.startDate), today)
                    ? `Today ${format(new Date(nextTask.calendarEvent.startDate), "h:mm a")}`
                    : format(new Date(nextTask.calendarEvent.startDate), "EEE h:mm a")
                  : "Unscheduled"}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // lg: grouped by day
  if (size === "lg" && groupedTasks) {
    return (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">Upcoming Tasks</CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">Next 7 days</span>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled ml-1">Loading tasks...</span>
            </div>
          ) : visibleTasks.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled py-2">No upcoming tasks</p>
          ) : (
            <div className="space-y-1.5">
              {Object.entries(groupedTasks).map(([day, dayTasks]) => (
                <div key={day}>
                  <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                    {day}
                  </span>
                  <div className="space-y-[4px] mt-[4px]">
                    {dayTasks.map((task) => (
                      <TaskRow key={task.id} task={task} today={today} onNavigate={onNavigate} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // md: 5 tasks flat list (current default)
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Upcoming Tasks</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">Today + 7 days</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">Loading tasks...</span>
          </div>
        ) : visibleTasks.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">No upcoming tasks</p>
        ) : (
          <div className="space-y-[4px]">
            {visibleTasks.map((task) => (
              <TaskRow key={task.id} task={task} today={today} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shared task row component
// ---------------------------------------------------------------------------
function TaskRow({
  task,
  today,
  onNavigate,
}: {
  task: ProjectTask;
  today: Date;
  onNavigate: (path: string) => void;
}) {
  const isInProgress = task.status === TaskStatus.InProgress;
  const displayTitle = getTaskDisplayTitle(task, task.taskType);
  const eventDate = task.calendarEvent?.startDate
    ? new Date(task.calendarEvent.startDate)
    : null;
  const timeDisplay = eventDate
    ? isSameDay(eventDate, today)
      ? `Today ${format(eventDate, "h:mm a")}`
      : format(eventDate, "EEE h:mm a")
    : "Unscheduled";

  return (
    <div
      onClick={() => onNavigate(task.projectId ? `/projects/${task.projectId}` : "/calendar")}
      className="flex items-center gap-1 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group"
    >
      {isInProgress ? (
        <Clock className="w-[16px] h-[16px] text-text-secondary shrink-0" />
      ) : (
        <CheckCircle2 className="w-[16px] h-[16px] text-text-disabled shrink-0" />
      )}
      <div
        className="w-[3px] h-[16px] rounded-full shrink-0"
        style={{ backgroundColor: task.taskColor || "#5C6070" }}
      />
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-body-sm text-text-primary truncate">
          {displayTitle}
        </p>
      </div>
      <span className="font-mono text-[11px] text-text-tertiary shrink-0">
        {timeDisplay}
      </span>
      <ChevronRight className="w-[12px] h-[12px] text-text-disabled opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </div>
  );
}
