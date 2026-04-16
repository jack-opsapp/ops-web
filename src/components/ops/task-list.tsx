"use client";

import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { useState, useMemo, useCallback } from "react";
import {
  Plus,
  Trash2,
  Edit3,
  MoreVertical,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { StatusBadge, type TaskStatus as StatusBadgeTaskStatus } from "@/components/ops/status-badge";
import { EmptyState } from "@/components/ops/empty-state";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { UserAvatar } from "@/components/ops/user-avatar";
import { UnscheduledBadge, UnassignedBadge } from "@/components/ops/task-badge";
import { PermissionGate } from "@/components/ops/permission-gate";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { TaskForm, type TaskFormValues } from "@/components/ops/task-form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTeamScheduleConflicts } from "@/lib/hooks/use-team-conflicts";
import {
  MiniCalendarPopover,
  MiniTeamPickerPopover,
} from "@/components/ops/badge-popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useProjectTasks,
  useCreateTask,
  useCreateTaskWithEvent,
  useUpdateTask,
  useUpdateTaskStatus,
  useDeleteTask,
} from "@/lib/hooks/use-tasks";
import { useTeamMembers } from "@/lib/hooks/use-users";
import {
  type ProjectTask,
  type TaskType,
  type User,
  TaskStatus,
  TASK_STATUS_COLORS,
  UserRole,
  getTaskDisplayTitle,
  getUserFullName,
} from "@/lib/types/models";
import { TaskTypeService } from "@/lib/api/services";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";

// ─── Status Helpers ──────────────────────────────────────────────────────────

function taskStatusToKey(status: TaskStatus): StatusBadgeTaskStatus {
  switch (status) {
    case TaskStatus.Booked:
      return "booked";
    case TaskStatus.InProgress:
      return "in-progress";
    case TaskStatus.Completed:
      return "completed";
    case TaskStatus.Cancelled:
      return "cancelled";
    default:
      return "booked";
  }
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: TaskStatus.Booked, label: "Booked" },
  { value: TaskStatus.InProgress, label: "In Progress" },
  { value: TaskStatus.Completed, label: "Completed" },
  { value: TaskStatus.Cancelled, label: "Cancelled" },
];

// ─── Date Helpers ────────────────────────────────────────────────────────────

function formatDateRange(startDate: Date | null, endDate: Date | null, locale: Locale): string {
  if (!startDate) return "";
  const dateLocale = getDateLocale(locale);
  const startStr = startDate.toLocaleDateString(dateLocale, { month: "short", day: "numeric" });
  if (!endDate) return startStr;
  const sameMonth = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();
  if (sameMonth) {
    return `${startStr} – ${endDate.getDate()}`;
  }
  const endStr = endDate.toLocaleDateString(dateLocale, { month: "short", day: "numeric" });
  return `${startStr} – ${endStr}`;
}

function isTaskPastDue(task: ProjectTask): boolean {
  if (!task.endDate) return false;
  if (task.status === TaskStatus.Completed || task.status === TaskStatus.Cancelled) return false;
  return new Date(task.endDate) < new Date();
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TaskListProps {
  projectId: string;
  companyId: string;
  className?: string;
}

// ─── Task Row Component ──────────────────────────────────────────────────────

interface TaskRowProps {
  task: ProjectTask;
  taskTypes: TaskType[];
  teamMembers: User[];
  onEdit: (task: ProjectTask) => void;
  onDelete: (task: ProjectTask) => void;
  onStatusChange: (task: ProjectTask, status: TaskStatus) => void;
  isUpdating: boolean;
  onScheduleSave: (task: ProjectTask, start: string, end: string) => void;
  onAssignSave: (task: ProjectTask, memberIds: string[]) => void;
  projectTasks: ProjectTask[];
  teamConflicts: Array<{ date: Date; memberName: string; projectTitle: string }>;
}

function TaskRow({
  task,
  taskTypes,
  teamMembers,
  onEdit,
  onDelete,
  onStatusChange,
  isUpdating,
  onScheduleSave,
  onAssignSave,
  projectTasks,
  teamConflicts,
}: TaskRowProps) {
  const { locale } = useLocale();
  const title = getTaskDisplayTitle(task, task.taskType ?? taskTypes.find((t) => t.id === task.taskTypeId));
  const taskType = task.taskType ?? taskTypes.find((t) => t.id === task.taskTypeId);
  const isCompleted = task.status === TaskStatus.Completed;
  const isCancelled = task.status === TaskStatus.Cancelled;
  const isDone = isCompleted || isCancelled;
  const isPastDue = isTaskPastDue(task);

  const hasStartDate = !!task.startDate;
  const dateRange = formatDateRange(task.startDate, task.endDate, locale);

  // Resolve team member names
  const assignedMembers = useMemo(
    () =>
      task.teamMemberIds
        .map((id) => teamMembers.find((m) => m.id === id))
        .filter(Boolean) as User[],
    [task.teamMemberIds, teamMembers]
  );

  return (
    <div
      className={cn(
        "group flex items-center gap-3.5 px-4 py-3 rounded-[3px]",
        "bg-background-card border border-border",
        "hover:border-[rgba(255,255,255,0.3)] transition-all",
        isDone && "opacity-60",
        isPastDue && !isDone && "border-ops-error/30"
      )}
    >
      {/* Color bar */}
      <div
        className="w-[3px] h-8 rounded-[1px] shrink-0"
        style={{ backgroundColor: taskType?.color || task.taskColor || "#59779F" }}
      />

      {/* Task name */}
      <p
        className={cn(
          "font-mohave text-body text-text flex-1 truncate",
          isDone && "line-through text-text-3"
        )}
      >
        {title}
      </p>

      {/* Assignee avatars */}
      <div className="hidden sm:flex items-center shrink-0">
        {assignedMembers.length > 0 ? (
          <div className="flex items-center">
            {assignedMembers.slice(0, 3).map((member, idx) => (
              <UserAvatar
                key={member.id}
                name={getUserFullName(member)}
                imageUrl={member.profileImageURL}
                size="sm"
                color={member.userColor ?? undefined}
                showTooltip
                className={cn(idx > 0 && "-ml-1.5")}
              />
            ))}
            {assignedMembers.length > 3 && (
              <span className="font-mono text-[10px] text-text-3 pl-[4px]">
                +{assignedMembers.length - 3}
              </span>
            )}
          </div>
        ) : (
          <MiniTeamPickerPopover
            trigger={
              <button className="cursor-pointer">
                <UnassignedBadge />
              </button>
            }
            selectedIds={task.teamMemberIds}
            members={teamMembers}
            onSave={(ids) => onAssignSave(task, ids)}
            onEditFullTask={() => onEdit(task)}
          />
        )}
      </div>

      {/* Date range */}
      <div className="hidden sm:flex items-center shrink-0">
        {hasStartDate ? (
          <span
            className={cn(
              "font-mono text-data-sm text-text-2",
              isPastDue && !isDone && "text-ops-error"
            )}
          >
            {dateRange}
          </span>
        ) : (
          <MiniCalendarPopover
            trigger={
              <button className="cursor-pointer">
                <UnscheduledBadge />
              </button>
            }
            task={task}
            projectTasks={projectTasks}
            teamConflicts={teamConflicts}
            onSave={(start, end) => onScheduleSave(task, start, end)}
            onEditFullTask={() => onEdit(task)}
          />
        )}
      </div>

      {/* Status badge — clickable inline select */}
      <Select
        value={task.status}
        onValueChange={(value) => onStatusChange(task, value as TaskStatus)}
        disabled={isUpdating}
      >
        <SelectTrigger
          className="h-auto w-auto border-0 bg-transparent p-0 focus:shadow-none focus:border-0 [&>svg]:hidden gap-0"
          onClick={(e) => e.stopPropagation()}
        >
          <SelectValue>
            <StatusBadge status={taskStatusToKey(task.status)} className="cursor-pointer" />
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <div className="flex items-center gap-2">
                <span
                  className="w-[8px] h-[8px] rounded-full shrink-0"
                  style={{ backgroundColor: TASK_STATUS_COLORS[opt.value] }}
                />
                {opt.label}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Overflow menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-[4px] text-text-mute hover:text-text-3 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="w-[14px] h-[14px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[160px]">
          <PermissionGate permission="tasks.edit">
            <DropdownMenuItem
              onClick={() => onEdit(task)}
              className="gap-[6px] font-mohave"
            >
              <Edit3 className="w-[14px] h-[14px]" />
              Edit Task
            </DropdownMenuItem>
          </PermissionGate>
          <DropdownMenuSeparator />
          <PermissionGate permission="tasks.delete">
            <DropdownMenuItem
              onClick={() => onDelete(task)}
              className="gap-[6px] font-mohave text-ops-error focus:text-ops-error"
            >
              <Trash2 className="w-[14px] h-[14px]" />
              Delete Task
            </DropdownMenuItem>
          </PermissionGate>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function TaskListSkeleton() {
  return (
    <div className="space-y-[4px] animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-[52px] bg-background-card border border-border rounded-[3px] flex items-center gap-3.5 px-4"
        >
          <div className="w-[3px] h-8 bg-background-elevated rounded-[1px]" />
          <div className="flex-1">
            <div className="h-[14px] bg-background-elevated rounded w-1/3" />
          </div>
          <div className="hidden sm:flex items-center gap-1">
            <div className="w-[26px] h-[26px] bg-background-elevated rounded-full" />
          </div>
          <div className="hidden sm:block h-[14px] w-[80px] bg-background-elevated rounded" />
          <div className="h-[20px] w-[60px] bg-background-elevated rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Main TaskList Component ─────────────────────────────────────────────────

function TaskList({ projectId, companyId, className }: TaskListProps) {
  const { t } = useDictionary("projects");
  const { locale } = useLocale();
  const canCreateTask = usePermissionStore((s) => s.can("tasks.create"));

  // ── State ─────────────────────────────────────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [deletingTask, setDeletingTask] = useState<ProjectTask | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  // ── Data Hooks ────────────────────────────────────────────────
  const { data: tasks, isLoading: isLoadingTasks } = useProjectTasks(projectId);

  const { data: teamData } = useTeamMembers();
  const teamMembers = useMemo(() => teamData?.users ?? [], [teamData]);

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of teamMembers) {
      map.set(m.id, getUserFullName(m));
    }
    return map;
  }, [teamMembers]);

  const { data: teamConflicts = [] } = useTeamScheduleConflicts(
    teamMembers.map((m) => m.id),
    projectId,
    memberNameMap
  );

  const { data: taskTypes = [] } = useQuery({
    queryKey: queryKeys.taskTypes.list(companyId),
    queryFn: () => TaskTypeService.fetchTaskTypes(companyId),
    enabled: !!companyId,
  });

  // ── Mutations ─────────────────────────────────────────────────
  const createTaskMutation = useCreateTask();
  const createTaskWithEventMutation = useCreateTaskWithEvent();
  const updateTaskMutation = useUpdateTask();
  const updateStatusMutation = useUpdateTaskStatus();
  const deleteTaskMutation = useDeleteTask();

  const isUpdating =
    updateStatusMutation.isPending ||
    updateTaskMutation.isPending;

  // ── Active tasks, sorted flat ──────────────────────────────────
  const activeTasks = useMemo(
    () => (tasks ?? []).filter((t) => !t.deletedAt),
    [tasks]
  );

  // ── Team members scoped to the current project ────────────────
  // Scope the New Task picker to (a) users already assigned to a task
  // on this project, plus (b) Admin and Owner users who can legitimately
  // add anyone on any project. Operators must prove project involvement
  // via existing task assignment — they are not included in the fallback.
  const createFormTeamMembers = useMemo(() => {
    const assignedIds = new Set<string>();
    for (const task of activeTasks) {
      for (const id of task.teamMemberIds) assignedIds.add(id);
    }
    return teamMembers.filter(
      (m) =>
        assignedIds.has(m.id) ||
        m.role === UserRole.Admin ||
        m.role === UserRole.Owner
    );
  }, [teamMembers, activeTasks]);

  const sortedTasks = useMemo(() => {
    return [...activeTasks].sort((a, b) => {
      const orderA = a.displayOrder ?? a.taskIndex ?? 0;
      const orderB = b.displayOrder ?? b.taskIndex ?? 0;
      return orderA - orderB;
    });
  }, [activeTasks]);

  // ── Handlers ──────────────────────────────────────────────────

  const handleCreateSubmit = useCallback(
    (values: TaskFormValues) => {
      const hasSchedule = values.startDate && values.startDate.length > 0;

      if (hasSchedule) {
        const taskType = taskTypes.find((t) => t.id === values.taskTypeId);
        const eventTitle = taskType?.display ?? "Task";
        createTaskWithEventMutation.mutate(
          {
            task: {
              projectId,
              companyId,
              taskTypeId: values.taskTypeId,
              status: values.status,
              taskColor: values.taskColor || "#59779F",
              teamMemberIds: values.teamMemberIds || [],
              displayOrder: activeTasks.length,
            },
            schedule: {
              title: eventTitle,
              startDate: new Date(values.startDate!),
              endDate: values.endDate ? new Date(values.endDate) : undefined,
              color: values.taskColor || "#59779F",
              teamMemberIds: values.teamMemberIds || [],
            },
          },
          {
            onSuccess: () => setShowCreateForm(false),
          }
        );
      } else {
        createTaskMutation.mutate(
          {
            projectId,
            companyId,
            taskTypeId: values.taskTypeId,
            status: values.status,
            taskColor: values.taskColor || "#59779F",
            teamMemberIds: values.teamMemberIds || [],
            displayOrder: activeTasks.length,
          },
          {
            onSuccess: () => setShowCreateForm(false),
          }
        );
      }
    },
    [projectId, companyId, activeTasks.length, taskTypes, createTaskMutation, createTaskWithEventMutation]
  );

  const handleEditSubmit = useCallback(
    (values: TaskFormValues) => {
      if (!editingTask) return;

      updateTaskMutation.mutate(
        {
          id: editingTask.id,
          data: {
            status: values.status,
            taskTypeId: values.taskTypeId,
            taskColor: values.taskColor || "#59779F",
            teamMemberIds: values.teamMemberIds || [],
          },
        },
        {
          onSuccess: () => setEditingTask(null),
        }
      );
    },
    [editingTask, updateTaskMutation]
  );

  const handleStatusChange = useCallback(
    (task: ProjectTask, newStatus: TaskStatus) => {
      updateStatusMutation.mutate({ id: task.id, status: newStatus });
    },
    [updateStatusMutation]
  );

  const handleDelete = useCallback(() => {
    if (!deletingTask) return;

    deleteTaskMutation.mutate(
      {
        id: deletingTask.id,
        projectId,
      },
      {
        onSuccess: () => setDeletingTask(null),
      }
    );
  }, [deletingTask, deleteTaskMutation, projectId]);

  const handleScheduleSave = useCallback(
    (task: ProjectTask, start: string, end: string) => {
      updateTaskMutation.mutate({
        id: task.id,
        data: {
          startDate: start ? new Date(start + "T00:00:00") : null,
          endDate: end ? new Date(end + "T00:00:00") : null,
        },
      });
    },
    [updateTaskMutation]
  );

  const handleAssignSave = useCallback(
    (task: ProjectTask, memberIds: string[]) => {
      updateTaskMutation.mutate({
        id: task.id,
        data: { teamMemberIds: memberIds },
      });
    },
    [updateTaskMutation]
  );

  // ── Render ────────────────────────────────────────────────────

  if (isLoadingTasks) {
    return (
      <div className={cn("space-y-2", className)}>
        <TaskListSkeleton />
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-0">
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "font-mohave text-body-sm rounded-[3px] px-3 py-1.5 transition-colors",
              viewMode === "list"
                ? "bg-background-card border border-border text-text"
                : "border border-border-subtle text-text-3 hover:text-text-2"
            )}
          >
            {t("taskList.list")}
          </button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  disabled
                  className="font-mohave text-body-sm rounded-[3px] px-3 py-1.5 border border-border-subtle text-text-mute cursor-not-allowed"
                >
                  {t("taskList.calendar")}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("taskList.calendarSoon")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {canCreateTask && !editingTask && (
          <Popover
            open={showCreateForm}
            onOpenChange={(open) => {
              if (!open) setShowCreateForm(false);
            }}
          >
            <PopoverTrigger asChild>
              <button
                onClick={() => setShowCreateForm(true)}
                className="bg-ops-accent text-white font-mohave text-body-sm rounded-[3px] px-4 py-1.5 hover:opacity-90 transition-opacity"
              >
                + {t("taskList.addTask")}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="end"
              className="w-[480px] p-0"
              collisionPadding={16}
            >
              <TaskForm
                taskTypes={taskTypes}
                teamMembers={createFormTeamMembers}
                isSubmitting={
                  createTaskMutation.isPending ||
                  createTaskWithEventMutation.isPending
                }
                onSubmit={handleCreateSubmit}
                onCancel={() => setShowCreateForm(false)}
                projectTasks={activeTasks}
                teamConflicts={teamConflicts}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Edit form popover (no visible trigger — opened programmatically) */}
      <Popover
        open={!!editingTask}
        onOpenChange={(open) => {
          if (!open) setEditingTask(null);
        }}
      >
        <PopoverTrigger asChild>
          <span className="sr-only" />
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="center"
          className="w-[480px] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {editingTask && (
            <TaskForm
              task={editingTask}
              taskTypes={taskTypes}
              teamMembers={teamMembers}
              isSubmitting={updateTaskMutation.isPending}
              onSubmit={handleEditSubmit}
              onCancel={() => setEditingTask(null)}
              calendarStartDate={editingTask.startDate}
              calendarEndDate={editingTask.endDate}
              projectTasks={activeTasks}
              teamConflicts={teamConflicts}
            />
          )}
        </PopoverContent>
      </Popover>

      {/* Task rows */}
      {sortedTasks.length === 0 && !showCreateForm ? (
        <EmptyState
          icon={<CheckCircle2 className="w-[48px] h-[48px]" />}
          title={t("taskList.noTasks")}
          description={t("taskList.noTasksDesc")}
          action={{
            label: t("taskList.addTask"),
            onClick: () => setShowCreateForm(true),
          }}
        />
      ) : (
        <div className="space-y-[4px]">
          {sortedTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              taskTypes={taskTypes}
              teamMembers={teamMembers}
              onEdit={(task) => {
                setShowCreateForm(false);
                setEditingTask(task);
              }}
              onDelete={(task) => setDeletingTask(task)}
              onStatusChange={handleStatusChange}
              isUpdating={isUpdating}
              onScheduleSave={handleScheduleSave}
              onAssignSave={handleAssignSave}
              projectTasks={activeTasks}
              teamConflicts={teamConflicts}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deletingTask}
        onOpenChange={(open) => {
          if (!open) setDeletingTask(null);
        }}
        title="Delete Task"
        description={
          deletingTask
            ? `Are you sure you want to delete "${getTaskDisplayTitle(
                deletingTask,
                deletingTask.taskType ?? taskTypes.find((t) => t.id === deletingTask.taskTypeId)
              )}"? This will also remove the associated calendar event.`
            : ""
        }
        confirmLabel="Delete Task"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteTaskMutation.isPending}
      />
    </div>
  );
}

TaskList.displayName = "TaskList";

export { TaskList };
