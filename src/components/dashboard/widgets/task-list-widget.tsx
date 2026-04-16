"use client";

import { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { ScrollFade } from "./shared/scroll-fade";
import { useReducedMotion } from "./shared/use-reduced-motion";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { TaskStatus, getTaskDisplayTitle } from "@/lib/types/models";
import type { ProjectTask, TaskType, Project, Client } from "@/lib/types/models";
import { useUpdateTaskStatus, useTaskTypes } from "@/lib/hooks";
import { format, isSameDay } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { SegmentedPicker } from "@/components/ops/segmented-picker";
import { useDictionary } from "@/i18n/client";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WT, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useAuthStore } from "@/lib/store/auth-store";

interface TaskListWidgetProps {
  size: WidgetSize;
  tasks: ProjectTask[];
  projects?: Project[];
  clients?: Client[];
  isLoading: boolean;
  today: Date;
  onNavigate: (path: string) => void;
}

export function TaskListWidget({
  size,
  tasks,
  projects = [],
  clients = [],
  isLoading,
  today,
  onNavigate,
}: TaskListWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { data: taskTypes = [] } = useTaskTypes();
  const reducedMotion = useReducedMotion();
  const canViewAll = usePermissionStore((s) => s.can("tasks.view", "all"));
  const currentUserId = useAuthStore((s) => s.currentUser?.id);
  const [viewMode, setViewMode] = useState<"mine" | "all">("mine");
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  // Build lookup maps
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

  // ── Filter tasks by view mode ─────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    if (viewMode === "all" || !currentUserId) return tasks;
    return tasks.filter((task) => task.teamMemberIds.includes(currentUserId));
  }, [tasks, viewMode, currentUserId]);

  // ── Categorize: today, completed, overdue, unscheduled ────────────────
  const { todayTasks, completedTasks, overdueTasks, unscheduledTasks, heroCounts } = useMemo(() => {
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const todayArr: ProjectTask[] = [];
    const completedArr: ProjectTask[] = [];
    const overdueArr: ProjectTask[] = [];
    const unscheduledArr: ProjectTask[] = [];

    for (const task of filteredTasks) {
      if (task.deletedAt) continue;

      // Completed tasks (show in MD/LG)
      if (task.status === TaskStatus.Completed) {
        const start = task.startDate ? new Date(task.startDate) : null;
        if (start && isSameDay(start, today)) {
          completedArr.push(task);
        }
        continue;
      }
      if (task.status === TaskStatus.Cancelled) continue;

      const start = task.startDate ? new Date(task.startDate) : null;
      if (!start) {
        unscheduledArr.push(task);
        continue;
      }

      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      if (startDay < todayStart) {
        overdueArr.push(task);
      } else if (startDay.getTime() === todayStart.getTime()) {
        todayArr.push(task);
      }
    }

    return {
      todayTasks: todayArr,
      completedTasks: completedArr,
      overdueTasks: overdueArr,
      unscheduledTasks: unscheduledArr,
      heroCounts: {
        today: todayArr.length,
        overdue: overdueArr.length,
        unscheduled: unscheduledArr.length,
      },
    };
  }, [filteredTasks, today]);

  // ── SM: hero + title + next task ──────────────────────────────────────
  if (size === "sm") {
    const nextTask = todayTasks[0];
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <span className="font-mono text-data-lg font-bold leading-none text-text">
            {isLoading ? "—" : todayTasks.length}
          </span>
          <span className="font-kosugi text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("taskList.title") ?? "Task List"}
          </span>
          <WidgetTrendContext variant="snapshot" label={t("trend.today") ?? "Today"} />
          {!isLoading && nextTask && (
            <span className="font-mohave text-caption-sm text-text-2 mt-0.5 truncate">
              {t("taskList.next") ?? "Next"}: {nextTask.customTitle || nextTask.taskType?.display || "Task"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── Visibility toggle (MD+) ───────────────────────────────────────────
  const viewToggleOptions = useMemo(() => [
    { value: "all" as const, label: t("taskList.all") ?? "All" },
    { value: "mine" as const, label: t("taskList.mine") ?? "Mine" },
  ], [t]);

  const viewToggle = canViewAll ? (
    <SegmentedPicker
      options={viewToggleOptions}
      value={viewMode}
      onChange={setViewMode}
    />
  ) : null;

  // ── LG: Hero metric boxes ─────────────────────────────────────────────
  const heroSection = showActions(size) ? (
    <WidgetHeroCollapse collapsed={heroCollapsed} collapsedHeight="0px" expandedHeight="80px" className="mb-2">
      <div className="flex items-center gap-3 pb-2 border-b border-border-subtle">
        {/* Unscheduled */}
        <div className="flex-1 flex flex-col items-center py-1">
          <span className="font-mono text-data-sm font-bold text-text-2">
            {heroCounts.unscheduled}
          </span>
          <span className="font-kosugi text-[8px] text-text-mute uppercase tracking-wider">
            {t("taskList.unscheduledCount") ?? "Unscheduled"}
          </span>
        </div>
        {/* Today */}
        <div className="flex-1 flex flex-col items-center py-1">
          <span className="font-mono text-data-sm font-bold" style={{ color: WT.accent }}>
            {heroCounts.today}
          </span>
          <span className="font-kosugi text-[8px] text-text-mute uppercase tracking-wider">
            {t("taskList.todayCount") ?? "Today"}
          </span>
        </div>
        {/* Overdue */}
        <div className="flex-1 flex flex-col items-center py-1">
          <span className="font-mono text-data-sm font-bold" style={{ color: heroCounts.overdue > 0 ? WT.error : "var(--text-disabled)" }}>
            {heroCounts.overdue}
          </span>
          <span className="font-kosugi text-[8px] text-text-mute uppercase tracking-wider">
            {t("taskList.overdueCount") ?? "Overdue"}
          </span>
        </div>
      </div>
    </WidgetHeroCollapse>
  ) : null;

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-kosugi text-micro uppercase tracking-wider text-text-3">
              {t("taskList.title") ?? "Task List"}
            </span>
            {viewToggle}
          </div>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-mute animate-spin" />
            <span className="font-mono text-[11px] text-text-mute ml-1">{t("taskList.loading")}</span>
          </div>
        </div>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  const allEmpty = todayTasks.length === 0 && completedTasks.length === 0 && overdueTasks.length === 0;
  if (allEmpty) {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-kosugi text-micro uppercase tracking-wider text-text-3">
              {t("taskList.title") ?? "Task List"}
            </span>
            {viewToggle}
          </div>
          {heroSection}
          <WidgetEmptyState
            message={t("taskList.emptyToday") ?? "No tasks scheduled today"}
            cta={{ label: t("taskList.viewCalendar") ?? "View Calendar", onClick: () => onNavigate("/calendar") }}
            className="flex-1"
          />
        </div>
      </Card>
    );
  }

  // ── MD / LG: Full task list ───────────────────────────────────────────
  return (
    <Card className="h-full p-0">
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-3">
            {t("taskList.title") ?? "Task List"}
          </span>
          {viewToggle}
        </div>

        {/* LG: Hero counts */}
        {heroSection}

        {/* Task list */}
        <ScrollFade>
          {/* Today's tasks */}
          <AnimatePresence>
            {todayTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                onNavigate={onNavigate}
                showCheckbox
                taskTypes={taskTypes}
                projectMap={projectMap}
                clientMap={clientMap}
                isCompleted={false}
                reducedMotion={reducedMotion}
              />
            ))}
          </AnimatePresence>

          {/* Completed tasks (strikethrough) */}
          {showDetail(size) && completedTasks.length > 0 && (
            <AnimatePresence>
              {completedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  onNavigate={onNavigate}
                  showCheckbox={false}
                  taskTypes={taskTypes}
                  projectMap={projectMap}
                  clientMap={clientMap}
                  isCompleted
                  reducedMotion={reducedMotion}
                />
              ))}
            </AnimatePresence>
          )}

          {/* Overdue section */}
          {showDetail(size) && overdueTasks.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border-subtle">
              <span className="font-kosugi text-[10px] text-text-3 uppercase tracking-widest block mb-1" style={{ color: WT.error }}>
                {t("taskList.overdue") ?? "Overdue"}
              </span>
              <AnimatePresence>
                {overdueTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    today={today}
                    onNavigate={onNavigate}
                    showCheckbox
                    taskTypes={taskTypes}
                    projectMap={projectMap}
                    clientMap={clientMap}
                    isCompleted={false}
                    isOverdue
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </ScrollFade>

      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Task row with checkbox + enrichment
// ---------------------------------------------------------------------------
function TaskRow({
  task,
  today,
  onNavigate,
  showCheckbox,
  taskTypes,
  projectMap,
  clientMap,
  isCompleted,
  isOverdue,
  reducedMotion,
}: {
  task: ProjectTask;
  today: Date;
  onNavigate: (path: string) => void;
  showCheckbox: boolean;
  taskTypes: TaskType[];
  projectMap: Map<string, Project>;
  clientMap: Map<string, Client>;
  isCompleted: boolean;
  isOverdue?: boolean;
  reducedMotion?: boolean | null;
}) {
  const { t } = useDictionary("dashboard");
  const [completing, setCompleting] = useState(false);
  const updateStatus = useUpdateTaskStatus();

  const resolvedTaskType = task.taskType ?? taskTypes.find((tt) => tt.id === task.taskTypeId) ?? null;
  const displayTitle = getTaskDisplayTitle(task, resolvedTaskType);
  const eventDate = task.startDate ? new Date(task.startDate) : null;
  const timeDisplay = eventDate
    ? isSameDay(eventDate, today)
      ? format(eventDate, "h:mm a")
      : format(eventDate, "EEE h:mm a")
    : t("taskList.unscheduled");

  const project = task.projectId ? projectMap.get(task.projectId) : null;
  const client = project?.clientId ? clientMap.get(project.clientId) : null;
  const projectName = project?.title || null;
  const clientName = client?.name || null;
  const address = project?.address || null;

  // Always build a secondary line: project · client · address
  const secondaryParts: string[] = [];
  if (projectName) secondaryParts.push(projectName);
  if (clientName) secondaryParts.push(clientName);
  if (address) secondaryParts.push(address);
  if (secondaryParts.length === 0) secondaryParts.push(timeDisplay ?? "");
  const secondaryText = secondaryParts.join(" · ");

  const handleComplete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (completing || isCompleted) return;
      setCompleting(true);
      updateStatus.mutate(
        { id: task.id, status: TaskStatus.Completed },
        { onError: () => setCompleting(false) }
      );
    },
    [task.id, completing, isCompleted, updateStatus]
  );

  const isDone = isCompleted || completing;

  return (
    <motion.div
      layout={!reducedMotion}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: reducedMotion ? 0.15 : 0.25, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onNavigate(task.projectId ? `/projects/${task.projectId}` : "/calendar")}
      className={cn(
        "flex items-center gap-1 px-1 py-2 rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group",
        isDone && "opacity-40"
      )}
    >
      {/* Checkbox */}
      {showCheckbox && (
        <button
          onClick={handleComplete}
          className={cn(
            "w-[18px] h-[18px] rounded border flex items-center justify-center shrink-0 transition-all duration-200",
            completing
              ? "bg-status-success border-status-success"
              : isCompleted
                ? "bg-status-success/30 border-status-success/50"
                : "border-border-medium hover:border-ops-accent hover:bg-ops-accent/10"
          )}
          title={t("taskList.completeTask")}
        >
          {(completing || isCompleted) && <Check className="w-[12px] h-[12px] text-white" />}
        </button>
      )}

      {/* Status indicator for completed (no checkbox) */}
      {!showCheckbox && isCompleted && (
        <div className="w-[18px] h-[18px] rounded-full bg-status-success/30 flex items-center justify-center shrink-0">
          <Check className="w-[12px] h-[12px] text-status-success" />
        </div>
      )}

      {/* Color bar */}
      <div
        className="w-[3px] rounded-full shrink-0 self-stretch"
        style={{
          backgroundColor: isOverdue ? WT.error : (task.taskColor || WT.muted),
        }}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          "font-mohave text-body-sm text-text truncate transition-all duration-200",
          isDone && "line-through text-text-mute"
        )}>
          {displayTitle}
        </p>
        <span className="font-kosugi text-micro text-text-mute truncate block">
          {secondaryText}
        </span>
      </div>

      {/* Time metric (only when secondary already has client/project context) */}
      {(clientName || projectName) && (
        <span className={cn(
          "font-mono text-micro text-text-2 shrink-0 ml-1",
          isDone && "text-text-mute"
        )}>
          {timeDisplay}
        </span>
      )}

      <ChevronRight className="w-[12px] h-[12px] text-text-mute opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </motion.div>
  );
}
