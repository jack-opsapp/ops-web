"use client";

import { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Check, ChevronRight, Loader2, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { TaskStatus, getTaskDisplayTitle } from "@/lib/types/models";
import type { ProjectTask, TaskType, Project, Client } from "@/lib/types/models";
import { useUpdateTaskStatus, useTaskTypes } from "@/lib/hooks";
import { format, isSameDay } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

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
  const maxTasks = size === "sm" ? 1 : size === "lg" ? 6 : 3;
  const visibleTasks = tasks.slice(0, maxTasks);

  // Build lookup maps for project and client enrichment
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

  // lg: group by day
  const groupedTasks = useMemo(() => {
    if (size !== "lg") return null;
    const groups: Record<string, ProjectTask[]> = {};
    for (const task of visibleTasks) {
      const eventDate = task.startDate
        ? new Date(task.startDate)
        : null;
      const key = eventDate
        ? isSameDay(eventDate, today)
          ? t("taskList.today")
          : format(eventDate, "EEE, MMM d")
        : t("taskList.unscheduled");
      if (!groups[key]) groups[key] = [];
      groups[key].push(task);
    }
    return groups;
  }, [size, visibleTasks, today]);

  // sm: next task only
  if (size === "sm") {
    const nextTask = visibleTasks[0];
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">{t("taskList.nextTask")}</CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">{t("taskList.loadingShort")}</span>
            </div>
          ) : !nextTask ? (
            <p className="font-mohave text-body-sm text-text-disabled">{t("taskList.empty")}</p>
          ) : (
            <TaskRow task={nextTask} today={today} onNavigate={onNavigate} showCheckbox taskTypes={taskTypes} projectMap={projectMap} clientMap={clientMap} compact />
          )}
        </CardContent>
      </Card>
    );
  }

  // lg: grouped by day
  if (size === "lg" && groupedTasks) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">{t("taskList.title")}</CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">{t("taskList.next7days")}</span>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled ml-1">{t("taskList.loading")}</span>
            </div>
          ) : visibleTasks.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled py-2">{t("taskList.empty")}</p>
          ) : (
            <div className="space-y-1.5">
              {Object.entries(groupedTasks).map(([day, dayTasks]) => (
                <div key={day}>
                  <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                    {day}
                  </span>
                  <div className="space-y-[4px] mt-[4px]">
                    <AnimatePresence>
                      {dayTasks.map((task) => (
                        <TaskRow key={task.id} task={task} today={today} onNavigate={onNavigate} showCheckbox taskTypes={taskTypes} projectMap={projectMap} clientMap={clientMap} />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}
              {tasks.length > maxTasks && (
                <span className="font-mono text-[11px] text-text-disabled block px-1">
                  +{tasks.length - maxTasks} {t("taskList.more")}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // md: flat list
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">{t("taskList.title")}</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">{t("taskList.todayPlus7days")}</span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">{t("taskList.loading")}</span>
          </div>
        ) : visibleTasks.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">{t("taskList.empty")}</p>
        ) : (
          <div className="space-y-[4px]">
            <AnimatePresence>
              {visibleTasks.map((task) => (
                <TaskRow key={task.id} task={task} today={today} onNavigate={onNavigate} showCheckbox taskTypes={taskTypes} projectMap={projectMap} clientMap={clientMap} />
              ))}
            </AnimatePresence>
            {tasks.length > maxTasks && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{tasks.length - maxTasks} {t("taskList.more")}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Task row with one-click complete checkbox + project/client/address enrichment
// ---------------------------------------------------------------------------
function TaskRow({
  task,
  today,
  onNavigate,
  showCheckbox,
  taskTypes,
  projectMap,
  clientMap,
  compact,
}: {
  task: ProjectTask;
  today: Date;
  onNavigate: (path: string) => void;
  showCheckbox?: boolean;
  taskTypes: TaskType[];
  projectMap: Map<string, Project>;
  clientMap: Map<string, Client>;
  compact?: boolean;
}) {
  const { t } = useDictionary("dashboard");
  const [completing, setCompleting] = useState(false);
  const updateStatus = useUpdateTaskStatus();

  const isInProgress = task.status === TaskStatus.InProgress;
  const resolvedTaskType = task.taskType ?? taskTypes.find((tt) => tt.id === task.taskTypeId) ?? null;
  const displayTitle = getTaskDisplayTitle(task, resolvedTaskType);
  const eventDate = task.startDate
    ? new Date(task.startDate)
    : null;
  const timeDisplay = eventDate
    ? isSameDay(eventDate, today)
      ? `${t("taskList.today")} ${format(eventDate, "h:mm a")}`
      : format(eventDate, "EEE h:mm a")
    : t("taskList.unscheduled");

  // Enrichment: project name, client name, address
  const project = task.projectId ? projectMap.get(task.projectId) : null;
  const client = project?.clientId ? clientMap.get(project.clientId) : null;
  const projectName = project?.title || null;
  const clientName = client?.name || null;
  const address = project?.address || null;

  const handleComplete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (completing) return;
      setCompleting(true);
      updateStatus.mutate(
        { id: task.id, status: TaskStatus.Completed },
        { onError: () => setCompleting(false) }
      );
    },
    [task.id, completing, updateStatus]
  );

  return (
    <motion.div
      layout
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.25 }}
      onClick={() => onNavigate(task.projectId ? `/projects/${task.projectId}` : "/calendar")}
      className={cn(
        "flex items-start gap-1 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group",
        completing && "opacity-50"
      )}
    >
      {/* One-click complete checkbox */}
      {showCheckbox && (
        <button
          onClick={handleComplete}
          className={cn(
            "w-[18px] h-[18px] rounded border flex items-center justify-center shrink-0 transition-all duration-200 mt-[1px]",
            completing
              ? "bg-status-success border-status-success"
              : "border-border-medium hover:border-ops-accent hover:bg-ops-accent/10"
          )}
          title={t("taskList.completeTask")}
        >
          {completing && <Check className="w-[12px] h-[12px] text-white" />}
        </button>
      )}

      {!showCheckbox && (
        <div className="mt-[1px]">
          {isInProgress ? (
            <Clock className="w-[16px] h-[16px] text-text-secondary shrink-0" />
          ) : (
            <div className="w-[16px] h-[16px] rounded-full border border-border-medium shrink-0" />
          )}
        </div>
      )}

      <div
        className="w-[3px] rounded-full shrink-0 mt-[2px]"
        style={{
          backgroundColor: task.taskColor || "#5C6070",
          height: compact ? "16px" : (projectName || clientName || address) ? "32px" : "16px",
        }}
      />
      <div className="flex-1 min-w-0">
        <p className={cn(
          "font-mohave text-body-sm text-text-primary truncate transition-all duration-200",
          completing && "line-through text-text-disabled"
        )}>
          {displayTitle}
        </p>
        {/* Enrichment line: project · client · address */}
        {!compact && (projectName || clientName || address) && (
          <div className="flex items-center gap-[3px] mt-[1px] min-w-0">
            {projectName && (
              <span className="font-mono text-[10px] text-text-tertiary truncate shrink min-w-0">
                {projectName}
              </span>
            )}
            {projectName && clientName && (
              <span className="font-mono text-[10px] text-text-disabled shrink-0">·</span>
            )}
            {clientName && (
              <span className="font-mono text-[10px] text-text-disabled truncate shrink min-w-0">
                {clientName}
              </span>
            )}
            {(projectName || clientName) && address && (
              <span className="font-mono text-[10px] text-text-disabled shrink-0">·</span>
            )}
            {address && (
              <span className="flex items-center gap-[2px] shrink min-w-0">
                <MapPin className="w-[8px] h-[8px] text-text-disabled shrink-0" />
                <span className="font-mono text-[10px] text-text-disabled truncate">
                  {address}
                </span>
              </span>
            )}
          </div>
        )}
      </div>
      <span className="font-mono text-[11px] text-text-tertiary shrink-0 mt-[1px]">
        {timeDisplay}
      </span>
      <ChevronRight className="w-[12px] h-[12px] text-text-disabled opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-[2px]" />
    </motion.div>
  );
}
