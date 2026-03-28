"use client";

import { useState, useMemo } from "react";
import { Search, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { TaskForm, type TaskFormValues } from "@/components/ops/task-form";
import { CreateProjectModal } from "@/components/ops/create-project-modal";
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
  onCreateNew,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  onCreateNew: (searchText: string) => void;
}) {
  const { data } = useProjects();
  const { data: taskTypesData } = useTaskTypes();
  const projects = data?.projects ?? [];
  const taskTypes = taskTypesData ?? [];
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  // Search across project name, client name, address, and task types
  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter((p) => {
      // Match project title
      if (p.title.toLowerCase().includes(q)) return true;
      // Match client name
      if (p.client?.name?.toLowerCase().includes(q)) return true;
      // Match address
      if (p.address?.toLowerCase().includes(q)) return true;
      // Match task type names associated with the project's tasks
      if (
        p.tasks?.some((t) => {
          const tt = taskTypes.find((type) => type.id === t.taskTypeId);
          return tt?.display?.toLowerCase().includes(q);
        })
      )
        return true;
      return false;
    });
  }, [projects, taskTypes, search]);

  const selected = projects.find((p) => p.id === value);

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
        Project
      </label>
      <div className="relative">
        {selected ? (
          <div className="flex items-center justify-between bg-background-input border border-border rounded-sm px-1.5 py-1.5">
            <div className="min-w-0">
              <span className="font-mohave text-body text-text-primary truncate block">
                {selected.title}
              </span>
              {selected.client?.name && (
                <span className="font-mohave text-caption-sm text-text-tertiary truncate block">
                  {selected.client.name}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setSearch("");
              }}
              className="text-text-tertiary hover:text-text-secondary shrink-0 ml-1"
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
              <div className="absolute z-10 left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] rounded-sm shadow-floating max-h-[240px] overflow-y-auto">
                {filtered.length === 0 && !search.trim() ? (
                  <div className="px-1.5 py-1 text-left">
                    <p className="font-mohave text-body-sm text-text-tertiary">
                      No projects found
                    </p>
                  </div>
                ) : (
                  <>
                    {filtered.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onMouseDown={() => {
                          onChange(project.id);
                          setShowDropdown(false);
                          setSearch("");
                        }}
                        className="w-full px-1.5 py-1 text-left hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                      >
                        <span className="font-mohave text-body text-text-secondary hover:text-text-primary block truncate">
                          {project.title}
                        </span>
                        {(project.client?.name || project.address) && (
                          <span className="font-mohave text-caption-sm text-text-tertiary block truncate">
                            {[project.client?.name, project.address]
                              .filter(Boolean)
                              .join(" \u00B7 ")}
                          </span>
                        )}
                      </button>
                    ))}

                    {/* No matches for search term */}
                    {filtered.length === 0 && search.trim() && (
                      <div className="px-1.5 py-1 text-left">
                        <p className="font-mohave text-body-sm text-text-tertiary">
                          No matching projects
                        </p>
                      </div>
                    )}
                  </>
                )}

                {/* Add to New Project option */}
                <div className="border-t border-[rgba(255,255,255,0.08)]">
                  <button
                    type="button"
                    onMouseDown={() => {
                      onCreateNew(search);
                      setShowDropdown(false);
                      setSearch("");
                    }}
                    className="w-full flex items-center gap-[6px] px-1.5 py-1 text-left hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                  >
                    <Plus className="w-[14px] h-[14px] text-ops-accent shrink-0" />
                    <span className="font-mohave text-body-sm text-ops-accent">
                      Create new project{search.trim() ? `: "${search.trim()}"` : ""}
                    </span>
                  </button>
                </div>
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
  const [showCreateProject, setShowCreateProject] = useState(false);

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
    <>
      <div className="space-y-2">
        <ProjectSelector
          value={projectId}
          onChange={setProjectId}
          onCreateNew={() => setShowCreateProject(true)}
        />

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

      {/* Create Project Modal */}
      <CreateProjectModal
        open={showCreateProject}
        onOpenChange={setShowCreateProject}
      />
    </>
  );
}
