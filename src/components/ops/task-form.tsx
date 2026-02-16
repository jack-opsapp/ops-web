"use client";

import { useEffect, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, Save } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/ops/user-avatar";
import {
  type ProjectTask,
  type TaskType,
  type User,
  TaskStatus,
  TASK_STATUS_COLORS,
  getUserFullName,
} from "@/lib/types/models";

// ─── Validation Schema ───────────────────────────────────────────────────────

const taskFormSchema = z.object({
  customTitle: z.string().min(1, "Title is required").max(200, "Title must be under 200 characters"),
  taskNotes: z.string().max(5000, "Notes must be under 5000 characters").optional().default(""),
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

// ─── Helper ──────────────────────────────────────────────────────────────────

function toDateInputValue(date: Date | null | undefined): string {
  if (!date) return "";
  try {
    const d = new Date(date);
    return d.toISOString().split("T")[0];
  } catch {
    return "";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

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
      customTitle: task?.customTitle || task?.taskType?.display || "",
      taskNotes: task?.taskNotes || "",
      status: task?.status || TaskStatus.Booked,
      taskTypeId: task?.taskTypeId || (taskTypes.length > 0 ? taskTypes[0].id : ""),
      taskColor: task?.taskColor || "#59779F",
      teamMemberIds: task?.teamMemberIds || [],
      startDate: toDateInputValue(calendarStartDate),
      endDate: toDateInputValue(calendarEndDate),
    }),
    [task, taskTypes, calendarStartDate, calendarEndDate]
  );

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues,
  });

  // Update color when task type changes
  const selectedTaskTypeId = watch("taskTypeId");
  useEffect(() => {
    const selectedType = taskTypes.find((t) => t.id === selectedTaskTypeId);
    if (selectedType) {
      setValue("taskColor", selectedType.color);
    }
  }, [selectedTaskTypeId, taskTypes, setValue]);

  const selectedTeamMemberIds = watch("teamMemberIds");

  function toggleTeamMember(memberId: string) {
    const current = selectedTeamMemberIds || [];
    if (current.includes(memberId)) {
      setValue(
        "teamMemberIds",
        current.filter((id) => id !== memberId)
      );
    } else {
      setValue("teamMemberIds", [...current, memberId]);
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className={cn(
        "bg-background-elevated border border-border-medium rounded-lg p-2",
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
          onClick={onCancel}
          className="p-[4px] text-text-tertiary hover:text-text-primary transition-colors"
        >
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* Title + Task Type row */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-1.5">
        <Input
          label="Title"
          placeholder="Task title..."
          error={errors.customTitle?.message}
          {...register("customTitle")}
        />

        <Controller
          name="taskTypeId"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-0.5">
              <Label>Type</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-[44px]">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {taskTypes.map((tt) => (
                    <SelectItem key={tt.id} value={tt.id}>
                      <span className="flex items-center gap-[6px]">
                        <span
                          className="w-[10px] h-[10px] rounded-full shrink-0"
                          style={{ backgroundColor: tt.color }}
                        />
                        {tt.display}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.taskTypeId && (
                <p className="text-caption-sm text-ops-error font-mohave">
                  {errors.taskTypeId.message}
                </p>
              )}
            </div>
          )}
        />
      </div>

      {/* Status + Dates row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-0.5">
              <Label>Status</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(TaskStatus).map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className="flex items-center gap-[6px]">
                        <span
                          className="w-[8px] h-[8px] rounded-full shrink-0"
                          style={{ backgroundColor: TASK_STATUS_COLORS[s] }}
                        />
                        {s}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        />

        <Input
          type="date"
          label="Start Date"
          {...register("startDate")}
        />

        <Input
          type="date"
          label="End Date"
          {...register("endDate")}
        />
      </div>

      {/* Notes */}
      <Textarea
        label="Notes"
        placeholder="Task notes, instructions, or details..."
        className="min-h-[60px]"
        {...register("taskNotes")}
        error={errors.taskNotes?.message}
      />

      {/* Team Members */}
      {teamMembers.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <Label>Assign Team Members</Label>
          <div className="flex flex-wrap gap-1 p-1 bg-background-card border border-border rounded-lg max-h-[160px] overflow-y-auto">
            {teamMembers.map((member) => {
              const isSelected = (selectedTeamMemberIds || []).includes(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleTeamMember(member.id)}
                  className={cn(
                    "flex items-center gap-[6px] px-1 py-[6px] rounded transition-all",
                    "border text-body-sm font-mohave",
                    isSelected
                      ? "bg-ops-accent/15 border-ops-accent/50 text-text-primary"
                      : "bg-transparent border-border text-text-tertiary hover:border-border-medium hover:text-text-secondary"
                  )}
                >
                  <UserAvatar
                    name={getUserFullName(member)}
                    imageUrl={member.profileImageURL}
                    size="sm"
                    color={member.userColor ?? undefined}
                  />
                  <span className="truncate max-w-[120px]">
                    {getUserFullName(member)}
                  </span>
                  {isSelected && (
                    <span className="w-[14px] h-[14px] rounded-full bg-ops-accent flex items-center justify-center shrink-0">
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <path d="M1.5 4L3.25 5.75L6.5 2.25" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 pt-1 border-t border-border-subtle">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
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
