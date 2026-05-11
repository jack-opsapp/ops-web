"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, Save, ChevronDown, Check } from "lucide-react";
import { trackTaskCreated, trackFormAbandoned } from "@/lib/analytics/analytics";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { CalendarScheduler } from "@/components/ops/calendar-scheduler";
import { TaskScheduleConfirmStrip } from "@/components/agent/task-schedule-confirm-strip";
import { useDictionary } from "@/i18n/client";
import {
  type ProjectTask,
  type TaskType,
  type User,
  TaskStatus,
  TASK_STATUS_COLORS,
  getUserFullName,
  getInitials,
} from "@/lib/types/models";
import { type TaskTypeDependency } from "@/lib/types/scheduling";

// ─── Validation Schema ───────────────────────────────────────────────────────

const taskFormSchema = z.object({
  status: z.nativeEnum(TaskStatus),
  taskTypeId: z.string().min(1, "Task type is required"),
  taskColor: z.string().optional().default("#59779F"),
  teamMemberIds: z.array(z.string()).optional().default([]),
  startDate: z.string().optional().default(""),
  endDate: z.string().optional().default(""),
  dependencyOverrides: z.array(z.object({
    depends_on_task_type_id: z.string(),
    overlap_percentage: z.number().min(0).max(100),
  })).nullable().optional(),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface TaskFormProps {
  /** Existing task to edit, or undefined for create mode */
  task?: ProjectTask | null;
  /** Available task types for the dropdown */
  taskTypes: TaskType[];
  /** Available team members for multi-select */
  teamMembers: User[];
  /** Whether the form is submitting */
  isSubmitting?: boolean;
  /** Callback when form is submitted */
  onSubmit: (values: TaskFormValues) => void;
  /** Callback when form is cancelled */
  onCancel: () => void;
  /** Start date from calendar event (for edit mode) */
  calendarStartDate?: Date | null;
  /** End date from calendar event (for edit mode) */
  calendarEndDate?: Date | null;
  /** Existing tasks in the project for calendar display */
  projectTasks?: ProjectTask[];
  /** Team scheduling conflicts from other projects */
  teamConflicts?: Array<{
    date: Date;
    memberName: string;
    projectTitle: string;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateInputValue(date: Date | null | undefined): string {
  if (!date) return "";
  try {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

// ─── Task Type Dropdown ──────────────────────────────────────────────────────

function TaskTypeDropdown({
  value,
  onChange,
  taskTypes,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  taskTypes: TaskType[];
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = taskTypes.find((t) => t.id === value);

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
        Task Type
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          className={cn(
            "flex items-center justify-between w-full",
            "bg-surface-input border rounded-sm",
            "px-1.5 py-1.5",
            "font-mohave text-body transition-all duration-150",
            open ? "border-[rgba(255,255,255,0.20)]" : error ? "border-status-error" : "border-border",
            "focus:border-[rgba(255,255,255,0.20)] focus:outline-none"
          )}
        >
          {selected ? (
            <span className="flex items-center gap-[6px]">
              <span
                className="w-[10px] h-[10px] rounded-full shrink-0"
                style={{ backgroundColor: selected.color }}
              />
              <span className="text-text">{selected.display}</span>
            </span>
          ) : (
            <span className="text-text-3">Select type</span>
          )}
          <ChevronDown
            className={cn(
              "w-[16px] h-[16px] text-text-3 transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>

        {open && (
          <div className="absolute z-[60] left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] rounded-sm max-h-[200px] overflow-y-auto">
            {taskTypes.length === 0 ? (
              <div className="px-1.5 py-1">
                <p className="font-mohave text-body-sm text-text-3">
                  No task types available
                </p>
              </div>
            ) : (
              taskTypes.map((tt) => (
                <button
                  key={tt.id}
                  type="button"
                  onMouseDown={() => {
                    onChange(tt.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-[6px] px-1.5 py-1 text-left",
                    "hover:bg-[rgba(255,255,255,0.05)] transition-colors",
                    "font-mohave text-body-sm",
                    value === tt.id
                      ? "text-text"
                      : "text-text-2"
                  )}
                >
                  <span
                    className="w-[10px] h-[10px] rounded-full shrink-0"
                    style={{ backgroundColor: tt.color }}
                  />
                  {tt.display}
                  {value === tt.id && (
                    <Check className="w-[14px] h-[14px] text-text-2 ml-auto shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="text-caption-sm text-status-error font-mohave">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Status Dropdown ─────────────────────────────────────────────────────────

function StatusDropdown({
  value,
  onChange,
}: {
  value: TaskStatus;
  onChange: (status: TaskStatus) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
        Status
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          className={cn(
            "flex items-center justify-between w-full",
            "bg-surface-input border border-border rounded-sm",
            "px-1.5 py-1.5",
            "font-mohave text-body transition-all duration-150",
            open && "border-[rgba(255,255,255,0.20)]",
            "focus:border-[rgba(255,255,255,0.20)] focus:outline-none"
          )}
        >
          <span className="flex items-center gap-[6px]">
            <span
              className="w-[8px] h-[8px] rounded-full shrink-0"
              style={{ backgroundColor: TASK_STATUS_COLORS[value] }}
            />
            <span className="text-text">{value}</span>
          </span>
          <ChevronDown
            className={cn(
              "w-[16px] h-[16px] text-text-3 transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>

        {open && (
          <div className="absolute z-[60] left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] rounded-sm max-h-[200px] overflow-y-auto">
            {/* In Progress is omitted: project_tasks.status has no DB slot
                for it (collapses to active on write, reads back as Booked).
                See task-list.tsx STATUS_OPTIONS and task-service.ts comment
                for context (bug 452d7865). */}
            {Object.values(TaskStatus)
              .filter((s) => s !== TaskStatus.InProgress)
              .map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={() => {
                  onChange(s);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-[6px] px-1.5 py-1 text-left",
                  "hover:bg-[rgba(255,255,255,0.05)] transition-colors",
                  "font-mohave text-body-sm",
                  value === s ? "text-text" : "text-text-2"
                )}
              >
                <span
                  className="w-[8px] h-[8px] rounded-full shrink-0"
                  style={{ backgroundColor: TASK_STATUS_COLORS[s] }}
                />
                {s}
                {value === s && (
                  <Check className="w-[14px] h-[14px] text-text-2 ml-auto shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Team Member Dropdown ────────────────────────────────────────────────────

function TeamMemberDropdown({
  selectedIds,
  onChange,
  members,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  members: User[];
}) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((i) => i !== id)
        : [...selectedIds, id]
    );
  }

  const count = selectedIds.length;

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
        Team Members
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          className={cn(
            "flex items-center justify-between w-full",
            "bg-surface-input border border-border rounded-sm",
            "px-1.5 py-1.5",
            "font-mohave text-body transition-all duration-150",
            open && "border-[rgba(255,255,255,0.20)]",
            "focus:border-[rgba(255,255,255,0.20)] focus:outline-none",
            count > 0 ? "text-text" : "text-text-3"
          )}
        >
          {count === 0 ? (
            <span>Select team members</span>
          ) : (
            <span className="flex items-center gap-[6px]">
              {/* Show first 3 avatars inline */}
              <span className="flex -space-x-1">
                {members
                  .filter((m) => selectedIds.includes(m.id))
                  .slice(0, 3)
                  .map((m) => (
                    <span
                      key={m.id}
                      className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-micro font-mohave text-white border border-background-input"
                      style={{
                        backgroundColor: m.userColor ?? "#59779F",
                      }}
                    >
                      {getInitials(getUserFullName(m))}
                    </span>
                  ))}
              </span>
              <span>
                {count} member{count !== 1 ? "s" : ""}
              </span>
            </span>
          )}
          <ChevronDown
            className={cn(
              "w-[16px] h-[16px] text-text-3 transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>

        {open && (
          <div className="absolute z-[60] left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] rounded-sm max-h-[240px] overflow-y-auto">
            {members.length === 0 ? (
              <div className="px-1.5 py-1">
                <p className="font-mohave text-body-sm text-text-3">
                  No team members available
                </p>
              </div>
            ) : (
              members.map((member) => {
                const isSelected = selectedIds.includes(member.id);
                const fullName = getUserFullName(member);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onMouseDown={() => toggle(member.id)}
                    className={cn(
                      "w-full flex items-center gap-1 px-1.5 py-1 text-left",
                      "hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                    )}
                  >
                    {/* Avatar */}
                    <span
                      className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-micro font-mohave text-white shrink-0"
                      style={{
                        backgroundColor: member.userColor ?? "#59779F",
                      }}
                    >
                      {getInitials(fullName)}
                    </span>
                    {/* Name */}
                    <span
                      className={cn(
                        "flex-1 font-mohave text-body-sm",
                        isSelected ? "text-text" : "text-text-2"
                      )}
                    >
                      {fullName}
                    </span>
                    {/* Checkmark */}
                    {isSelected && (
                      <Check className="w-[14px] h-[14px] text-text-2 shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dependency Section ──────────────────────────────────────────────────────

function DependencySection({
  dependencies,
  taskTypes,
  overrides,
  onOverridesChange,
}: {
  dependencies: TaskTypeDependency[];
  taskTypes: TaskType[];
  overrides: TaskTypeDependency[] | null;
  onOverridesChange: (overrides: TaskTypeDependency[] | null) => void;
}) {
  const { t } = useDictionary("projects");
  const [showOverride, setShowOverride] = useState(false);
  const activeDeps = overrides ?? dependencies;

  function overlapLabel(pct: number): string {
    if (pct === 0) return t("taskForm.noOverlap");
    if (pct === 100) return t("taskForm.fullOverlap");
    return `${pct}${t("taskForm.overlap")}`;
  }

  function resolveTaskTypeName(id: string): string {
    return taskTypes.find((tt) => tt.id === id)?.display ?? "Unknown";
  }

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
        {t("taskForm.dependencies")}
      </label>
      {activeDeps.length === 0 ? (
        <p className="font-mohave text-body-sm text-text-mute">{t("taskForm.noDependencies")}</p>
      ) : (
        <div className="space-y-1">
          {activeDeps.map((dep, i) => (
            <div key={dep.depends_on_task_type_id} className="flex items-center gap-2">
              {showOverride && (
                <button
                  type="button"
                  onClick={() => {
                    const next = activeDeps.filter((_, idx) => idx !== i);
                    onOverridesChange(next.length > 0 ? next : null);
                  }}
                  className="text-text-mute hover:text-ops-error p-0.5"
                >
                  <X className="w-[12px] h-[12px]" />
                </button>
              )}
              <span className="font-mohave text-body-sm text-text">
                {t("taskForm.afterTask")} {resolveTaskTypeName(dep.depends_on_task_type_id)}
              </span>
              {showOverride ? (
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={dep.overlap_percentage}
                  onChange={(e) => {
                    const next = [...activeDeps];
                    next[i] = { ...next[i], overlap_percentage: Number(e.target.value) };
                    onOverridesChange(next);
                  }}
                  className="w-[50px] font-mono text-data-sm bg-glass glass-surface border border-border rounded-[2px] px-1.5 py-0.5 text-text outline-none focus:border-[rgba(255,255,255,0.20)]"
                />
              ) : (
                <span className="font-mohave text-body-sm text-text-3">
                  ({overlapLabel(dep.overlap_percentage)})
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {!showOverride && activeDeps.length > 0 && (
        <button
          type="button"
          onClick={() => setShowOverride(true)}
          className="text-text-2 hover:text-text text-caption-sm cursor-pointer hover:underline self-start mt-0.5"
        >
          {t("taskForm.override")}
        </button>
      )}
      {showOverride && (
        <button
          type="button"
          onClick={() => {
            onOverridesChange(null);
            setShowOverride(false);
          }}
          className="text-text-2 hover:text-text text-caption-sm cursor-pointer hover:underline self-start mt-0.5"
        >
          {t("taskForm.resetDefaults")}
        </button>
      )}
    </div>
  );
}

// ─── TaskForm Component ──────────────────────────────────────────────────────

function TaskForm({
  task,
  taskTypes,
  teamMembers,
  isSubmitting = false,
  onSubmit,
  onCancel,
  calendarStartDate,
  calendarEndDate,
  projectTasks,
  teamConflicts,
}: TaskFormProps) {
  const { t } = useDictionary("projects");
  const isEditMode = !!task;

  const defaultValues: TaskFormValues = useMemo(
    () => ({
      status: task?.status || TaskStatus.Booked,
      taskTypeId:
        task?.taskTypeId || (taskTypes.length > 0 ? taskTypes[0].id : ""),
      taskColor: task?.taskColor || "#59779F",
      teamMemberIds: task?.teamMemberIds || [],
      startDate: toDateInputValue(calendarStartDate),
      endDate: toDateInputValue(calendarEndDate),
    }),
    [task, taskTypes, calendarStartDate, calendarEndDate]
  );

  const {
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues,
  });

  // Set initial taskTypeId when taskTypes loads (async)
  const currentTaskTypeId = watch("taskTypeId");
  useEffect(() => {
    if (!currentTaskTypeId && taskTypes.length > 0) {
      setValue("taskTypeId", taskTypes[0].id);
      setValue("taskColor", taskTypes[0].color);
    }
  }, [currentTaskTypeId, taskTypes, setValue]);

  // Update color when task type changes
  useEffect(() => {
    const selectedType = taskTypes.find((t) => t.id === currentTaskTypeId);
    if (selectedType) {
      setValue("taskColor", selectedType.color);
    }
  }, [currentTaskTypeId, taskTypes, setValue]);

  const selectedTeamMemberIds = watch("teamMemberIds") ?? [];
  const selectedStatus = watch("status");
  const startDate = watch("startDate");
  const endDate = watch("endDate");

  // ── Dependency logic ────────────────────────────────────────────────────
  const selectedTaskType = taskTypes.find((tt) => tt.id === currentTaskTypeId);
  const defaultDependencies: TaskTypeDependency[] = selectedTaskType?.dependencies ?? [];
  const currentOverrides = watch("dependencyOverrides");

  const blockedDates = useMemo(() => {
    const deps = currentOverrides ?? defaultDependencies;
    if (deps.length === 0 || !projectTasks) return [];

    const blocks: Array<{ start: Date; end: Date; reason: string }> = [];
    for (const dep of deps) {
      if (dep.overlap_percentage >= 100) continue;
      const depTasks = (projectTasks ?? []).filter(
        (pt) => pt.taskTypeId === dep.depends_on_task_type_id && pt.endDate
      );
      for (const depTask of depTasks) {
        if (!depTask.endDate) continue;
        const typeName = taskTypes.find((tt) => tt.id === dep.depends_on_task_type_id)?.display ?? "task";
        blocks.push({
          start: new Date(0),
          end: new Date(depTask.endDate),
          reason: `Cannot start before ${new Date(depTask.endDate).toLocaleDateString()} — depends on ${typeName}`,
        });
      }
    }
    return blocks;
  }, [currentOverrides, defaultDependencies, projectTasks, taskTypes]);

  function handleFormSubmit(values: TaskFormValues) {
    if (!isEditMode) {
      const hasSchedule = !!(values.startDate || values.endDate);
      const teamSize = (values.teamMemberIds || []).length;
      trackTaskCreated(hasSchedule, teamSize);
    }
    onSubmit(values);
  }

  function handleCancel() {
    if (isDirty) {
      const values = watch();
      const fieldsFilled =
        [values.taskTypeId, values.startDate, values.endDate].filter(Boolean)
          .length + ((values.teamMemberIds || []).length > 0 ? 1 : 0);
      trackFormAbandoned("task", fieldsFilled);
    }
    onCancel();
  }

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      className="p-4 space-y-3"
    >
      {/* Form Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-mohave text-body-lg text-text">
          {isEditMode ? t("taskForm.title.edit") : t("taskForm.title.create")}
        </h3>
        <button
          type="button"
          onClick={handleCancel}
          className="p-[4px] text-text-3 hover:text-text transition-colors"
        >
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* Task Type + Status + Team + Dependencies grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TaskTypeDropdown
          value={currentTaskTypeId}
          onChange={(id) => setValue("taskTypeId", id)}
          taskTypes={taskTypes}
          error={errors.taskTypeId?.message}
        />

        <StatusDropdown
          value={selectedStatus}
          onChange={(s) => setValue("status", s)}
        />

        <TeamMemberDropdown
          selectedIds={selectedTeamMemberIds}
          onChange={(ids) => setValue("teamMemberIds", ids)}
          members={teamMembers}
        />

        <DependencySection
          dependencies={defaultDependencies}
          taskTypes={taskTypes}
          overrides={currentOverrides ?? null}
          onOverridesChange={(ovr) => setValue("dependencyOverrides", ovr)}
        />
      </div>

      {/* Calendar Scheduler */}
      <CalendarScheduler
        startDate={startDate}
        endDate={endDate}
        onDateChange={(start, end) => {
          setValue("startDate", start);
          setValue("endDate", end);
        }}
        onClear={() => {
          setValue("startDate", "");
          setValue("endDate", "");
        }}
        projectTasks={projectTasks?.map((pt) => ({
          id: pt.id,
          startDate: pt.startDate,
          endDate: pt.endDate,
          taskColor: pt.taskColor,
          title: pt.customTitle || pt.taskTypeId,
        }))}
        teamConflicts={teamConflicts}
        blockedDates={blockedDates}
        alwaysExpanded
      />

      {/* Schedule confirmation (edit mode, phase_c, scheduled tasks only) */}
      {isEditMode && task && task.startDate && (
        <TaskScheduleConfirmStrip
          task={task}
          className="pt-1"
        />
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 pt-1 border-t border-border-subtle">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          {t("taskForm.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          className="gap-[6px]"
          disabled={isSubmitting}
          loading={isSubmitting}
        >
          <Save className="w-[14px] h-[14px]" />
          {isEditMode ? t("taskForm.saveChanges") : t("taskForm.createTask")}
        </Button>
      </div>
    </form>
  );
}

TaskForm.displayName = "TaskForm";

export { TaskForm, taskFormSchema };
export type { TaskFormValues };
