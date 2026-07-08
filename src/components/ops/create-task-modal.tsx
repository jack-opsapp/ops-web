"use client";

import { useState, useMemo } from "react";
import { Search, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EntityPicker } from "@/components/ui/entity-picker";
import { TaskForm, type TaskFormValues } from "@/components/ops/task-form";
import { useDictionary } from "@/i18n/client";
import { useWindowStore } from "@/stores/window-store";
import { useProjects } from "@/lib/hooks/use-projects";
import { useTaskTypes } from "@/lib/hooks/use-task-types";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { useCreateTask, useCreateTaskWithEvent } from "@/lib/hooks/use-tasks";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { toast } from "sonner";
import type { Project } from "@/lib/types/models";

// ─── Project Selector ────────────────────────────────────────────────────────

function ProjectSelector({
  value,
  onChange,
  onCreateNew,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  onCreateNew: (searchText: string) => void;
}) {
  const { t } = useDictionary("projects");
  const { t: tp } = useDictionary("picker");
  const { data } = useProjects();
  const { data: taskTypesData } = useTaskTypes();
  const canCreateProject = usePermissionStore((s) => s.can("projects.create"));
  const projects = useMemo(() => data?.projects ?? [], [data?.projects]);
  const taskTypes = useMemo(() => taskTypesData ?? [], [taskTypesData]);
  const [open, setOpen] = useState(false);

  const selected = projects.find((p) => p.id === value);

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
        {t("taskForm.field.project", "Project")}
      </label>
      <EntityPicker<Project>
        trigger={
          selected ? (
            <div className="flex items-center justify-between bg-surface-input border border-border rounded-sm px-1.5 py-1.5">
              <div className="min-w-0">
                <span className="font-mohave text-body text-text truncate block">
                  {selected.title}
                </span>
                {selected.client?.name && (
                  <span className="font-mohave text-caption-sm text-text-3 truncate block">
                    {selected.client.name}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  // Clear without opening the picker.
                  e.stopPropagation();
                  onChange(null);
                }}
                className="text-text-3 hover:text-text-2 shrink-0 ml-1"
                aria-label={tp("clear")}
              >
                <X className="w-[16px] h-[16px]" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={cn(
                "flex items-center justify-between w-full",
                "bg-surface-input border rounded-sm",
                "px-1.5 py-1.5",
                "font-mohave text-body transition-all duration-150 ease-smooth",
                open ? "border-line-hi" : "border-border",
                "focus:border-line-hi focus:outline-none"
              )}
            >
              <span className="flex items-center gap-[6px] min-w-0">
                <Search className="w-[16px] h-[16px] text-text-3 shrink-0" />
                <span className="text-text-3 truncate">
                  {t("taskForm.field.projectPlaceholder", "Select project")}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "w-[16px] h-[16px] text-text-3 transition-transform duration-150 ease-smooth",
                  open && "rotate-180"
                )}
              />
            </button>
          )
        }
        open={open}
        onOpenChange={setOpen}
        label={t("taskForm.field.project", "Project")}
        items={projects}
        value={value}
        onChange={onChange}
        getId={(p) => p.id}
        getLabel={(p) => p.title}
        getDescription={(p) =>
          [p.client?.name, p.address].filter(Boolean).join(" · ") ||
          undefined
        }
        getKeywords={(p) =>
          [
            p.client?.name,
            p.address,
            ...(p.tasks ?? []).map(
              (task) =>
                taskTypes.find((type) => type.id === task.taskTypeId)?.display
            ),
          ].filter((k): k is string => Boolean(k))
        }
        searchPlaceholder={t("taskForm.field.projectSearch", "Search projects")}
        emptyLabel={t("taskForm.field.projectEmpty", "No projects")}
        clearLabel={tp("clear")}
        createAction={
          canCreateProject
            ? {
                label: (q) =>
                  q.trim()
                    ? t("taskForm.field.projectCreateNamed", { name: q.trim() })
                    : t("taskForm.field.projectCreateNew", "New project"),
                onCreate: (q) => onCreateNew(q),
              }
            : undefined
        }
        contentClassName="z-modal"
      />
    </div>
  );
}

// ─── Create Task Form ────────────────────────────────────────────────────────

interface CreateTaskFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  /** Pre-fill the project picker — used when opening from a project's "Add Task" action. */
  defaultProjectId?: string;
}

export function CreateTaskForm({ onSuccess, onCancel, defaultProjectId }: CreateTaskFormProps) {
  const { t } = useDictionary("forms");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);

  const { data: taskTypes } = useTaskTypes();
  const { data: teamData } = useTeamMembers();
  const createTask = useCreateTask();
  const createTaskWithEvent = useCreateTaskWithEvent();

  const teamMembers = teamData?.users ?? [];
  const isPending = createTask.isPending || createTaskWithEvent.isPending;

  function handleSubmit(values: TaskFormValues) {
    if (!projectId) {
      toast.error(t("createTask.selectFirst", "Please select a project first"));
      return;
    }
    if (!companyId) {
      toast.error(t("createTask.noCompany", "No company found. Please sign in again."));
      return;
    }

    // Resolve the task type display name for the calendar event title
    const taskType = (taskTypes ?? []).find((t) => t.id === values.taskTypeId);
    const eventTitle = taskType?.display ?? "Task";

    const taskData = {
      projectId,
      companyId,
      taskTypeId: values.taskTypeId,
      status: values.status,
      taskColor: values.taskColor,
      teamMemberIds: values.teamMemberIds ?? [],
    };

    const callbacks = {
      onSuccess: () => {
        toast.success(t("createTask.toast.created", "Task created"));
        onSuccess?.();
      },
      onError: (err: Error) => {
        toast.error(t("createTask.toast.failed", "Failed to create task"), {
          description: err.message ?? t("createTask.toast.tryAgain", "Please try again."),
        });
      },
    };

    const hasSchedule = !!(values.startDate || values.endDate);

    if (hasSchedule) {
      createTaskWithEvent.mutate(
        {
          task: taskData,
          schedule: {
            title: eventTitle,
            startDate: values.startDate
              ? new Date(values.startDate)
              : new Date(),
            endDate: values.endDate
              ? new Date(values.endDate)
              : undefined,
            color: values.taskColor,
            teamMemberIds: values.teamMemberIds ?? [],
          },
        },
        callbacks
      );
    } else {
      createTask.mutate(taskData, callbacks);
    }
  }

  return (
    <div className="max-h-full space-y-2 overflow-y-auto">
      <ProjectSelector
        value={projectId}
        onChange={setProjectId}
        onCreateNew={() =>
          // Opens the project workspace window in creating mode on top
          // of the task modal. The task form stays mounted, so when the
          // workspace finishes its create the new project id flows back
          // through `onProjectCreated` and auto-selects in the picker.
          openProjectWindow({
            projectId: null,
            mode: "creating",
            onProjectCreated: (newId) => setProjectId(newId),
          })
        }
      />

      {!projectId && (
        <p className="font-mono text-[11px] text-text-mute">
          {t("createTask.selectProject", "Select a project to create a task for.")}
        </p>
      )}

      {projectId && (
        <TaskForm
          taskTypes={taskTypes ?? []}
          teamMembers={teamMembers}
          isSubmitting={isPending}
          onSubmit={handleSubmit}
          onCancel={() => onCancel?.()}
        />
      )}
    </div>
  );
}
