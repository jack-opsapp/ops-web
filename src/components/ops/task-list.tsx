"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Plus,
  ChevronRight,
  ChevronDown,
  Trash2,
  Edit3,
  MoreVertical,
  Circle,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { StatusBadge, type TaskStatus as StatusBadgeTaskStatus } from "@/components/ops/status-badge";
import { SectionHeader } from "@/components/ops/section-header";
import { EmptyState } from "@/components/ops/empty-state";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { UserAvatar } from "@/components/ops/user-avatar";
import { TaskForm, type TaskFormValues } from "@/components/ops/task-form";
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
  getTaskDisplayTitle,
  nextTaskStatus,
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

const taskStatusIcons: Record<TaskStatus, React.ReactNode> = {
  [TaskStatus.Booked]: <Circle className="w-[16px] h-[16px] text-status-booked" />,
  [TaskStatus.InProgress]: <Clock className="w-[16px] h-[16px] text-ops-amber" />,
  [TaskStatus.Completed]: <CheckCircle2 className="w-[16px] h-[16px] text-status-success" />,
  [TaskStatus.Cancelled]: <XCircle className="w-[16px] h-[16px] text-text-disabled" />,
};

const STATUS_GROUP_ORDER: TaskStatus[] = [
  TaskStatus.Booked,
  TaskStatus.InProgress,
  TaskStatus.Completed,
  TaskStatus.Cancelled,
];

const STATUS_GROUP_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.Booked]: "Booked",
  [TaskStatus.InProgress]: "In Progress",
  [TaskStatus.Completed]: "Completed",
  [TaskStatus.Cancelled]: "Cancelled",
};

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
  onAdvanceStatus: (task: ProjectTask) => void;
  isUpdating: boolean;
}

function TaskRow({
  task,
  taskTypes,
  teamMembers,
  onEdit,
  onDelete,
  onAdvanceStatus,
  isUpdating,
}: TaskRowProps) {
  const title = getTaskDisplayTitle(task, task.taskType ?? taskTypes.find((t) => t.id === task.taskTypeId));
  const taskType = task.taskType ?? taskTypes.find((t) => t.id === task.taskTypeId);
  const isCompleted = task.status === TaskStatus.Completed;
  const isCancelled = task.status === TaskStatus.Cancelled;
  const isDone = isCompleted || isCancelled;
  const next = nextTaskStatus(task.status);

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
        "group flex items-center gap-1.5 px-1.5 py-1 rounded",
        "bg-background-card border border-border",
        "hover:border-ops-accent/40 transition-all",
        isDone && "opacity-60"
      )}
    >
      {/* Status icon */}
      <div className="shrink-0">{taskStatusIcons[task.status]}</div>

      {/* Color bar */}
      <div
        className="w-[4px] h-[28px] rounded-full shrink-0"
        style={{ backgroundColor: taskType?.color || task.taskColor || "#59779F" }}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "font-mohave text-body-sm leading-tight",
            isDone ? "text-text-tertiary line-through" : "text-text-primary"
          )}
        >
          {title}
        </p>
      </div>

      {/* Assigned members (compact avatars) */}
      {assignedMembers.length > 0 && (
        <div className="hidden sm:flex items-center -space-x-1 shrink-0">
          {assignedMembers.slice(0, 3).map((member) => (
            <UserAvatar
              key={member.id}
              name={getUserFullName(member)}
              imageUrl={member.profileImageURL}
              size="sm"
              color={member.userColor ?? undefined}
            />
          ))}
          {assignedMembers.length > 3 && (
            <span className="font-mono text-[10px] text-text-tertiary pl-[4px]">
              +{assignedMembers.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Status badge */}
      <StatusBadge status={taskStatusToKey(task.status)} />

      {/* Calendar date */}
      {task.calendarEvent?.startDate && (
        <span className="hidden sm:inline font-mono text-[11px] text-text-tertiary shrink-0">
          {new Date(task.calendarEvent.startDate).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      )}

      {/* Quick advance button */}
      {next && !isDone && (
        <Button
          variant="ghost"
          size="icon"
          className="h-[28px] w-[28px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onAdvanceStatus(task);
          }}
          disabled={isUpdating}
          title={`Advance to ${next}`}
        >
          <ArrowRight className="w-[14px] h-[14px] text-ops-accent" />
        </Button>
      )}

      {/* Actions menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-[4px] text-text-disabled hover:text-text-tertiary transition-colors shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="w-[14px] h-[14px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[160px]">
          <DropdownMenuItem
            onClick={() => onEdit(task)}
            className="gap-[6px] font-mohave"
          >
            <Edit3 className="w-[14px] h-[14px]" />
            Edit Task
          </DropdownMenuItem>
          {next && (
            <DropdownMenuItem
              onClick={() => onAdvanceStatus(task)}
              className="gap-[6px] font-mohave"
            >
              <ArrowRight className="w-[14px] h-[14px]" />
              {next}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onDelete(task)}
            className="gap-[6px] font-mohave text-ops-error focus:text-ops-error"
          >
            <Trash2 className="w-[14px] h-[14px]" />
            Delete Task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ─── Status Group Component ──────────────────────────────────────────────────

interface StatusGroupProps {
  status: TaskStatus;
  tasks: ProjectTask[];
  taskTypes: TaskType[];
  teamMembers: User[];
  onEdit: (task: ProjectTask) => void;
  onDelete: (task: ProjectTask) => void;
  onAdvanceStatus: (task: ProjectTask) => void;
  isUpdating: boolean;
}

function StatusGroup({
  status,
  tasks,
  taskTypes,
  teamMembers,
  onEdit,
  onDelete,
  onAdvanceStatus,
  isUpdating,
}: StatusGroupProps) {
  const [collapsed, setCollapsed] = useState(
    status === TaskStatus.Cancelled || status === TaskStatus.Completed
  );

  if (tasks.length === 0) return null;

  const statusColor = TASK_STATUS_COLORS[status];

  return (
    <div className="space-y-[4px]">
      {/* Group header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-[6px] py-[4px] w-full text-left group/header"
      >
        {collapsed ? (
          <ChevronRight className="w-[14px] h-[14px] text-text-tertiary" />
        ) : (
          <ChevronDown className="w-[14px] h-[14px] text-text-tertiary" />
        )}
        <span
          className="w-[8px] h-[8px] rounded-full shrink-0"
          style={{ backgroundColor: statusColor }}
        />
        <span className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
          {STATUS_GROUP_LABELS[status]}
        </span>
        <span className="font-mono text-[11px] text-text-disabled">
          {tasks.length}
        </span>
        <div className="flex-1 h-px bg-border-subtle" />
      </button>

      {/* Group items */}
      {!collapsed && (
        <div className="space-y-[4px] pl-[4px]">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              taskTypes={taskTypes}
              teamMembers={teamMembers}
              onEdit={onEdit}
              onDelete={onDelete}
              onAdvanceStatus={onAdvanceStatus}
              isUpdating={isUpdating}
            />
          ))}
        </div>
      )}
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
          className="h-[48px] bg-background-card border border-border rounded flex items-center gap-1.5 px-1.5"
        >
          <div className="w-[16px] h-[16px] bg-background-elevated rounded-full" />
          <div className="w-[4px] h-[24px] bg-background-elevated rounded-full" />
          <div className="flex-1">
            <div className="h-[14px] bg-background-elevated rounded w-1/3" />
          </div>
          <div className="h-[20px] w-[60px] bg-background-elevated rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Main TaskList Component ─────────────────────────────────────────────────

function TaskList({ projectId, companyId, className }: TaskListProps) {
  // ── State ─────────────────────────────────────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [deletingTask, setDeletingTask] = useState<ProjectTask | null>(null);

  // ── Data Hooks ────────────────────────────────────────────────
  const { data: tasks, isLoading: isLoadingTasks } = useProjectTasks(projectId);

  const { data: teamData } = useTeamMembers();
  const teamMembers = useMemo(() => teamData?.users ?? [], [teamData]);

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

  // ── Active tasks, grouped by status ───────────────────────────
  const activeTasks = useMemo(
    () => (tasks ?? []).filter((t) => !t.deletedAt),
    [tasks]
  );

  const groupedTasks = useMemo(() => {
    const groups: Record<TaskStatus, ProjectTask[]> = {
      [TaskStatus.Booked]: [],
      [TaskStatus.InProgress]: [],
      [TaskStatus.Completed]: [],
      [TaskStatus.Cancelled]: [],
    };

    for (const task of activeTasks) {
      const bucket = groups[task.status];
      if (bucket) {
        bucket.push(task);
      } else {
        groups[TaskStatus.Booked].push(task);
      }
    }

    // Sort within each group by displayOrder, then taskIndex
    for (const status of STATUS_GROUP_ORDER) {
      groups[status].sort((a, b) => {
        const orderA = a.displayOrder ?? a.taskIndex ?? 0;
        const orderB = b.displayOrder ?? b.taskIndex ?? 0;
        return orderA - orderB;
      });
    }

    return groups;
  }, [activeTasks]);

  // ── Handlers ──────────────────────────────────────────────────

  const handleCreateSubmit = useCallback(
    (values: TaskFormValues) => {
      const hasSchedule = values.startDate && values.startDate.length > 0;

      if (hasSchedule) {
        createTaskWithEventMutation.mutate(
          {
            task: {
              projectId,
              companyId,
              taskTypeId: values.taskTypeId,
              status: values.status,
              taskColor: values.taskColor || "#59779F",
              customTitle: values.customTitle,
              teamMemberIds: values.teamMemberIds || [],
              displayOrder: activeTasks.length,
            },
            calendarEvent: {
              title: values.customTitle,
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
            customTitle: values.customTitle,
            teamMemberIds: values.teamMemberIds || [],
            displayOrder: activeTasks.length,
          },
          {
            onSuccess: () => setShowCreateForm(false),
          }
        );
      }
    },
    [projectId, companyId, activeTasks.length, createTaskMutation, createTaskWithEventMutation]
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
            customTitle: values.customTitle,
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

  const handleAdvanceStatus = useCallback(
    (task: ProjectTask) => {
      const next = nextTaskStatus(task.status);
      if (!next) return;

      updateStatusMutation.mutate({
        id: task.id,
        status: next,
      });
    },
    [updateStatusMutation]
  );

  const handleDelete = useCallback(() => {
    if (!deletingTask) return;

    deleteTaskMutation.mutate(
      {
        id: deletingTask.id,
        calendarEventId: deletingTask.calendarEventId,
        projectId,
      },
      {
        onSuccess: () => setDeletingTask(null),
      }
    );
  }, [deletingTask, deleteTaskMutation, projectId]);

  // ── Render ────────────────────────────────────────────────────

  if (isLoadingTasks) {
    return (
      <div className={cn("space-y-2", className)}>
        <SectionHeader title="Tasks" />
        <TaskListSkeleton />
      </div>
    );
  }

  const hasGroups = STATUS_GROUP_ORDER.some(
    (status) => groupedTasks[status].length > 0
  );

  return (
    <div className={cn("space-y-2", className)}>
      {/* Header */}
      <SectionHeader
        title="Tasks"
        count={activeTasks.length}
        action={
          !showCreateForm &&
          !editingTask && (
            <Button
              size="sm"
              className="gap-[6px]"
              onClick={() => setShowCreateForm(true)}
            >
              <Plus className="w-[14px] h-[14px]" />
              Add Task
            </Button>
          )
        }
      />

      {/* Create form */}
      {showCreateForm && (
        <TaskForm
          taskTypes={taskTypes}
          teamMembers={teamMembers}
          isSubmitting={
            createTaskMutation.isPending ||
            createTaskWithEventMutation.isPending
          }
          onSubmit={handleCreateSubmit}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {/* Edit form */}
      {editingTask && (
        <TaskForm
          task={editingTask}
          taskTypes={taskTypes}
          teamMembers={teamMembers}
          isSubmitting={updateTaskMutation.isPending}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditingTask(null)}
          calendarStartDate={editingTask.calendarEvent?.startDate}
          calendarEndDate={editingTask.calendarEvent?.endDate}
        />
      )}

      {/* Task groups */}
      {!hasGroups && !showCreateForm ? (
        <EmptyState
          icon={<CheckCircle2 className="w-[48px] h-[48px]" />}
          title="No tasks yet"
          description="Add tasks to track work progress for this project."
          action={{
            label: "Add Task",
            onClick: () => setShowCreateForm(true),
          }}
        />
      ) : (
        <div className="space-y-1.5">
          {STATUS_GROUP_ORDER.map((status) => (
            <StatusGroup
              key={status}
              status={status}
              tasks={groupedTasks[status]}
              taskTypes={taskTypes}
              teamMembers={teamMembers}
              onEdit={(task) => {
                setShowCreateForm(false);
                setEditingTask(task);
              }}
              onDelete={(task) => setDeletingTask(task)}
              onAdvanceStatus={handleAdvanceStatus}
              isUpdating={isUpdating}
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
