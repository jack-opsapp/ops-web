"use client";

import { useState, useMemo } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { TaskForm, type TaskFormValues } from "@/components/ops/task-form";
import { useProjects } from "@/lib/hooks/use-projects";
import { useTaskTypes } from "@/lib/hooks/use-task-types";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { useCreateTask, useCreateTaskWithEvent } from "@/lib/hooks/use-tasks";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";

// ─── Project Selector ────────────────────────────────────────────────────────

function ProjectSelector({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { data } = useProjects();
  const projects = data?.projects ?? [];
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const filtered = useMemo(
    () =>
      projects.filter((p) =>
        p.title.toLowerCase().includes(search.toLowerCase())
      ),
    [projects, search]
  );

  const selected = projects.find((p) => p.id === value);

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
        Project
      </label>
      <div className="relative">
        {selected ? (
          <div className="flex items-center justify-between bg-background-input border border-[rgba(255,255,255,0.2)] rounded px-1.5 py-1.5">
            <span className="font-mohave text-body text-text-primary truncate">
              {selected.title}
            </span>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setSearch("");
              }}
              className="text-text-tertiary hover:text-text-secondary shrink-0"
            >
              <X className="w-[16px] h-[16px]" />
            </button>
          </div>
        ) : (
          <div>
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              prefixIcon={<Search className="w-[16px] h-[16px]" />}
            />
            {showDropdown && (
              <div className="absolute z-10 left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] rounded shadow-floating max-h-[200px] overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="px-1.5 py-1 text-left">
                    <p className="font-mohave text-body-sm text-text-tertiary">
                      {projects.length === 0 ? "No projects found" : "No matching projects"}
                    </p>
                  </div>
                ) : (
                  filtered.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onMouseDown={() => {
                        onChange(project.id);
                        setShowDropdown(false);
                        setSearch("");
                      }}
                      className="w-full px-1.5 py-1 text-left font-mohave text-body text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                    >
                      {project.title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Create Task Form ────────────────────────────────────────────────────────

interface CreateTaskFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function CreateTaskForm({ onSuccess, onCancel }: CreateTaskFormProps) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [projectId, setProjectId] = useState<string | null>(null);

  const { data: taskTypes } = useTaskTypes();
  const { data: teamData } = useTeamMembers();
  const createTask = useCreateTask();
  const createTaskWithEvent = useCreateTaskWithEvent();

  const teamMembers = teamData?.users ?? [];
  const isPending = createTask.isPending || createTaskWithEvent.isPending;

  function handleSubmit(values: TaskFormValues) {
    if (!projectId) {
      toast.error("Please select a project first");
      return;
    }
    if (!companyId) {
      toast.error("No company found. Please sign in again.");
      return;
    }

    const taskData = {
      projectId,
      companyId,
      taskTypeId: values.taskTypeId,
      customTitle: values.customTitle,
      status: values.status,
      taskColor: values.taskColor,
      teamMemberIds: values.teamMemberIds ?? [],
    };

    const callbacks = {
      onSuccess: () => {
        toast.success("Task created");
        onSuccess?.();
      },
      onError: (err: Error) => {
        toast.error("Failed to create task", {
          description: err.message ?? "Please try again.",
        });
      },
    };

    const hasSchedule = !!(values.startDate || values.endDate);

    if (hasSchedule) {
      createTaskWithEvent.mutate(
        {
          task: taskData,
          calendarEvent: {
            title: values.customTitle,
            startDate: values.startDate ? new Date(values.startDate) : new Date(),
            endDate: values.endDate ? new Date(values.endDate) : undefined,
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
    <div className="space-y-2">
      <ProjectSelector value={projectId} onChange={setProjectId} />

      {!projectId && (
        <p className="font-kosugi text-[11px] text-text-disabled">
          Select a project to create a task for.
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
