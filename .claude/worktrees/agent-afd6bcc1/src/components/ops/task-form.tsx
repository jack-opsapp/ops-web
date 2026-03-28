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
import {
  type ProjectTask,
  type TaskType,
  type User,
  TaskStatus,
  TASK_STATUS_COLORS,
  getUserFullName,
  getInitials,
} from "@/lib/types/models";

// ─── Validation Schema ───────────────────────────────────────────────────────

const taskFormSchema = z.object({
  status: z.nativeEnum(TaskStatus),
  taskTypeId: z.string().min(1, "Task type is required"),
  taskColor: z.string().optional().default("#59779F"),
  teamMemberIds: z.array(z.string()).optional().default([]),
  startDate: z.string().optional().default(""),
  endDate: z.string().optional().default(""),
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
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
        Task Type
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          className={cn(
            "flex items-center justify-between w-full",
            "bg-background-input border rounded-sm",
            "px-1.5 py-1.5",
            "font-mohave text-body transition-all duration-150",
            open ? "border-ops-accent" : error ? "border-status-error" : "border-border",
            "focus:border-ops-accent focus:outline-none"
          )}
        >
          {selected ? (
            <span className="flex items-center gap-[6px]">
              <span
                className="w-[10px] h-[10px] rounded-full shrink-0"
                style={{ backgroundColor: selected.color }}
              />
              <span className="text-text-primary">{selected.display}</span>
            </span>
          ) : (
            <span className="text-text-tertiary">Select type</span>
          )}
          <ChevronDown
            className={cn(
              "w-[16px] h-[16px] text-text-tertiary transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>

        {open && (
          <div className="absolute z-[60] left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] rounded-sm shadow-floating max-h-[200px] overflow-y-auto">
            {taskTypes.length === 0 ? (
              <div className="px-1.5 py-1">
                <p className="font-mohave text-body-sm text-text-tertiary">
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
                      ? "text-text-primary"
                      : "text-text-secondary"
                  )}
                >
                  <span
                    className="w-[10px] h-[10px] rounded-full shrink-0"
                    style={{ backgroundColor: tt.color }}
                  />
                  {tt.display}
                  {value === tt.id && (
                    <Check className="w-[14px] h-[14px] text-ops-accent ml-auto shrink-0" />
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
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
        Status
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          className={cn(
            "flex items-center justify-between w-full",
            "bg-background-input border border-border rounded-sm",
            "px-1.5 py-1.5",
            "font-mohave text-body transition-all duration-150",
            open && "border-ops-accent",
            "focus:border-ops-accent focus:outline-none"
          )}
        >
          <span className="flex items-center gap-[6px]">
            <span
              className="w-[8px] h-[8px] rounded-full shrink-0"
              style={{ backgroundColor: TASK_STATUS_COLORS[value] }}
            />
            <span className="text-text-primary">{value}</span>
          </span>
          <ChevronDown
            className={cn(
              "w-[16px] h-[16px] text-text-tertiary transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>

        {open && (
          <div className="absolute z-[60] left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] rounded-sm shadow-floating max-h-[200px] overflow-y-auto">
            {Object.values(TaskStatus).map((s) => (
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
                  value === s ? "text-text-primary" : "text-text-secondary"
                )}
              >
                <span
                  className="w-[8px] h-[8px] rounded-full shrink-0"
                  style={{ backgroundColor: TASK_STATUS_COLORS[s] }}
                />
                {s}
                {value === s && (
                  <Check className="w-[14px] h-[14px] text-ops-accent ml-auto shrink-0" />
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
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
        Team Members
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          className={cn(
            "flex items-center justify-between w-full",
            "bg-background-input border border-border rounded-sm",
            "px-1.5 py-1.5",
            "font-mohave text-body transition-all duration-150",
            open && "border-ops-accent",
            "focus:border-ops-accent focus:outline-none",
            count > 0 ? "text-text-primary" : "text-text-tertiary"
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
                      className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[9px] font-mohave text-white border border-background-input"
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
              "w-[16px] h-[16px] text-text-tertiary transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>

        {open && (
          <div className="absolute z-[60] left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] rounded-sm shadow-floating max-h-[240px] overflow-y-auto">
            {members.length === 0 ? (
              <div className="px-1.5 py-1">
                <p className="font-mohave text-body-sm text-text-tertiary">
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
                      className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-[10px] font-mohave text-white shrink-0"
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
                        isSelected ? "text-text-primary" : "text-text-secondary"
                      )}
                    >
                      {fullName}
                    </span>
                    {/* Checkmark */}
                    {isSelected && (
                      <Check className="w-[14px] h-[14px] text-ops-accent shrink-0" />
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
}: TaskFormProps) {
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
      className={cn(
        "bg-background-elevated border border-border-medium rounded-sm p-2",
        "animate-fade-in space-y-2"
      )}
    >
      {/* Form Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-mohave text-body-lg text-text-primary">
          {isEditMode ? "Edit Task" : "New Task"}
        </h3>
        <button
          type="button"
          onClick={handleCancel}
          className="p-[4px] text-text-tertiary hover:text-text-primary transition-colors"
        >
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* Task Type + Status row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
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
      />

      {/* Team Members */}
      <TeamMemberDropdown
        selectedIds={selectedTeamMemberIds}
        onChange={(ids) => setValue("teamMemberIds", ids)}
        members={teamMembers}
      />

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 pt-1 border-t border-border-subtle">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="gap-[6px]"
          disabled={isSubmitting}
          loading={isSubmitting}
        >
          <Save className="w-[14px] h-[14px]" />
          {isEditMode ? "Save Changes" : "Create Task"}
        </Button>
      </div>
    </form>
  );
}

TaskForm.displayName = "TaskForm";

export { TaskForm, taskFormSchema };
export type { TaskFormValues };
