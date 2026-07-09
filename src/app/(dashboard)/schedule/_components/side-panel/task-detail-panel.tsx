"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { toast } from "@/components/ui/toast";
import { Trash2, Check, ArrowRight, ArrowLeft, Zap, Plus, X } from "lucide-react";
import { useScheduleStore } from "@/stores/schedule-store";
import {
  useTask,
  useUpdateTask,
  useDeleteTask,
  useTaskTypes,
  useTeamMembers,
  useProjectTasks,
  useCompany,
  useRecurrence,
  useCreateRecurrence,
  useUpdateRecurrence,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { RepeatPicker } from "./repeat-picker";
import { useRecurrenceEditPrompt } from "@/components/ui/recurrence-edit-prompt";
import {
  TaskStatus,
  getInitials,
  getTaskDisplayTitle,
} from "@/lib/types/models";
import { pushByDays, calculateCascade } from "@/lib/scheduling/engine";
import { taskToSchedulable } from "@/lib/scheduling/adapters";
import { SidePanelShell } from "./side-panel-shell";
import { TaskMaterialsSection } from "@/components/ops/task-materials-section";
import { useDictionary } from "@/i18n/client";

// ─── Status options ─────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: TaskStatus; labelKey: string }[] = [
  { value: TaskStatus.Booked, labelKey: "panel.taskStatus.booked" },
  { value: TaskStatus.InProgress, labelKey: "panel.taskStatus.inProgress" },
  { value: TaskStatus.Completed, labelKey: "panel.taskStatus.completed" },
  { value: TaskStatus.Cancelled, labelKey: "panel.taskStatus.cancelled" },
];

const UUID_LIKE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanPanelLabel(value: string | null | undefined): string | null {
  const label = value?.trim();
  if (!label || UUID_LIKE_RE.test(label)) return null;
  return label;
}

// ─── Styled Select ──────────────────────────────────────────────────────────

function DarkSelect({
  value,
  onChange,
  options,
  unmappedLabel,
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  unmappedLabel: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedLabel =
    cleanPanelLabel(options.find((o) => o.value === value)?.label) ??
    cleanPanelLabel(value) ??
    unmappedLabel;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left px-[10px] py-[6px] rounded-panel text-[12px] font-mono text-white"
        style={{
          backgroundColor: "#141414",
          border: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        {selectedLabel}
      </button>
      {isOpen && (
        <div
          className="absolute top-full left-0 right-0 z-10 mt-[2px] rounded-panel overflow-hidden"
          style={{
            backgroundColor: "var(--surface-glass-dense)",
            backdropFilter: "blur(28px) saturate(1.3)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className="w-full text-left px-[10px] py-[6px] text-[12px] font-mono text-[var(--text-3)] hover:text-white hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              style={opt.value === value ? { color: "#FFFFFF" } : undefined}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section Label ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <span className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-3)] block mb-[6px]">
      {children}
    </span>
  );
}

// ─── Team Member Pill ───────────────────────────────────────────────────────

function TeamPill({
  member,
  onRemove,
  t,
}: {
  member: { id: string; firstName: string; lastName: string };
  onRemove: () => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const initials = getInitials(`${member.firstName} ${member.lastName}`);
  const name =
    `${member.firstName} ${member.lastName}`.trim() ||
    t("panel.unknownMember");

  return (
    <span
      className="inline-flex items-center gap-[4px] px-[8px] py-[3px] rounded-full text-[11px] text-white"
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <span className="font-mono text-micro uppercase text-[var(--text-3)]">
        {initials}
      </span>
      <span className="font-mono text-micro uppercase">{name}</span>
      <button
        onClick={onRemove}
        className="ml-[2px] text-[var(--text-3)] hover:text-white transition-colors"
        aria-label={t("panel.removeMember", { name })}
      >
        <X className="w-[10px] h-[10px]" />
      </button>
    </span>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function TaskDetailPanel() {
  const { sidePanelMode, selectedTaskId, closeSidePanel } = useScheduleStore();
  const { t } = useDictionary("schedule");

  const isOpen = sidePanelMode === "task-detail" && !!selectedTaskId;

  // Data queries
  const { data: task } = useTask(selectedTaskId ?? undefined);
  const { data: taskTypes } = useTaskTypes();
  const { data: teamMembersData } = useTeamMembers();
  const { data: projectTasksData } = useProjectTasks(
    task?.projectId ?? undefined
  );

  // Company defaults — used to seed time when toggling all_day off (Phase 3)
  const { data: company } = useCompany();
  const { currentUser } = useAuthStore();

  // Phase 3 — fetch the parent recurrence template if this task is generated.
  const { data: recurrence } = useRecurrence(task?.recurrenceId ?? undefined);

  // Mutations
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const createRecurrence = useCreateRecurrence();
  const updateRecurrence = useUpdateRecurrence();
  const recurrencePrompt = useRecurrenceEditPrompt();

  // Local state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTeamAdd, setShowTeamAdd] = useState(false);

  // Derived
  const taskType = useMemo(() => {
    if (!task || !taskTypes) return null;
    return taskTypes.find((tt) => tt.id === task.taskTypeId) ?? null;
  }, [task, taskTypes]);

  const teamMembers = useMemo(() => {
    const allMembers = teamMembersData?.users ?? [];
    const memberIds = task?.teamMemberIds ?? [];
    return allMembers.filter((m) => memberIds.includes(m.id));
  }, [teamMembersData, task]);

  const availableTeamMembers = useMemo(() => {
    const allMembers = teamMembersData?.users ?? [];
    const memberIds = task?.teamMemberIds ?? [];
    return allMembers.filter(
      (m) => !memberIds.includes(m.id) && m.isActive !== false
    );
  }, [teamMembersData, task]);

  const projectTasks = useMemo(
    () => projectTasksData ?? [],
    [projectTasksData]
  );

  const displayTitle = useMemo(() => {
    if (!task) return t("panel.unknownTask");
    return getTaskDisplayTitle(task, taskType);
  }, [task, taskType, t]);

  const statusOptions = useMemo(
    () =>
      STATUS_OPTIONS.map((opt) => ({
        value: opt.value,
        label: t(opt.labelKey),
      })),
    [t]
  );

  const taskColor = useMemo(() => {
    return taskType?.color ?? task?.taskColor ?? "#6F94B0";
  }, [taskType, task]);

  const taskTypeOptions = useMemo(() => {
    const base =
      taskTypes?.map((tt) => ({
        value: tt.id,
        label: tt.display,
      })) ?? [];

    if (!task?.taskTypeId || base.some((opt) => opt.value === task.taskTypeId)) {
      return base;
    }

    return [
      {
        value: task.taskTypeId,
        label: cleanPanelLabel(taskType?.display) ?? t("panel.unmappedType"),
      },
      ...base,
    ];
  }, [task?.taskTypeId, taskType?.display, taskTypes, t]);

  // Dependencies
  const dependencies = useMemo(() => {
    if (!task || !taskTypes) return { predecessors: [], successors: [] };

    const effectiveDeps =
      task.dependencyOverrides ?? taskType?.dependencies ?? [];

    // Predecessors: task types this task depends on.
    // Unresolved dependency types (no matching task type) are dropped so the
    // panel only lists real predecessors.
    const predecessors = effectiveDeps
      .map((dep) => {
        const depType = taskTypes.find(
          (tt) => tt.id === dep.depends_on_task_type_id
        );
        const depTask = projectTasks.find(
          (pt) => pt.taskTypeId === dep.depends_on_task_type_id
        );
        return {
          typeName: depType?.display ?? t("panel.unknownDependency"),
          resolved: !!depType,
          isCompleted: depTask?.status === TaskStatus.Completed,
          typeId: dep.depends_on_task_type_id,
        };
      })
      .filter((d) => d.resolved);

    // Successors: task types that depend on this task's type
    const successors: { typeName: string; typeId: string }[] = [];
    for (const tt of taskTypes) {
      const deps = tt.dependencies ?? [];
      if (deps.some((d) => d.depends_on_task_type_id === task.taskTypeId)) {
        successors.push({ typeName: tt.display, typeId: tt.id });
      }
    }

    return { predecessors, successors };
  }, [task, taskType, taskTypes, projectTasks, t]);

  // Duration computed
  const durationLabel = useMemo(() => {
    if (!task?.startDate || !task?.endDate) return null;
    const start = task.startDate instanceof Date ? task.startDate : new Date(task.startDate);
    const end = task.endDate instanceof Date ? task.endDate : new Date(task.endDate);
    const days = differenceInCalendarDays(end, start) + 1;
    return days !== 1
      ? t("panel.durationDaysPlural", { count: days })
      : t("panel.durationDays", { count: days });
  }, [task?.startDate, task?.endDate, t]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleTitleBlur = useCallback(() => {
    setEditingTitle(false);
    if (!task || !selectedTaskId || !titleValue.trim()) return;
    const newTitle = titleValue.trim();
    if (newTitle === displayTitle) return;

    updateTask.mutate(
      { id: selectedTaskId, data: { customTitle: newTitle } },
      {
        onError: (err) =>
          toast.error(t("panel.errorUpdateTitle"), { description: err.message }),
      }
    );
  }, [task, selectedTaskId, titleValue, displayTitle, updateTask, t]);

  const handleStatusChange = useCallback(
    (newStatus: string) => {
      if (!selectedTaskId) return;
      updateTask.mutate(
        { id: selectedTaskId, data: { status: newStatus as TaskStatus } },
        {
          onError: (err) =>
            toast.error(t("panel.errorUpdateStatus"), {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, updateTask, t]
  );

  const handleTaskTypeChange = useCallback(
    (newTaskTypeId: string) => {
      if (!selectedTaskId || !taskTypes) return;
      const newType = taskTypes.find((tt) => tt.id === newTaskTypeId);
      updateTask.mutate(
        {
          id: selectedTaskId,
          data: {
            taskTypeId: newTaskTypeId,
            taskColor: newType?.color ?? task?.taskColor ?? "#6F94B0",
          },
        },
        {
          onError: (err) =>
            toast.error(t("panel.errorUpdateType"), {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, taskTypes, task, updateTask, t]
  );

  const handleRemoveTeamMember = useCallback(
    (memberId: string) => {
      if (!selectedTaskId || !task) return;
      const newIds = task.teamMemberIds.filter((id) => id !== memberId);
      updateTask.mutate(
        { id: selectedTaskId, data: { teamMemberIds: newIds } },
        {
          onError: (err) =>
            toast.error(t("panel.errorRemoveMember"), {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, task, updateTask, t]
  );

  const handleAddTeamMember = useCallback(
    (memberId: string) => {
      if (!selectedTaskId || !task) return;
      const newIds = [...task.teamMemberIds, memberId];
      updateTask.mutate(
        { id: selectedTaskId, data: { teamMemberIds: newIds } },
        {
          onError: (err) =>
            toast.error(t("panel.errorAddMember"), {
              description: err.message,
            }),
        }
      );
      setShowTeamAdd(false);
    },
    [selectedTaskId, task, updateTask, t]
  );

  const handleStartDateChange = useCallback(
    (value: string) => {
      if (!selectedTaskId || !value) return;
      const newStart = new Date(value);
      updateTask.mutate(
        { id: selectedTaskId, data: { startDate: newStart } },
        {
          onError: (err) =>
            toast.error(t("panel.errorUpdateStartDate"), {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, updateTask, t]
  );

  const handleEndDateChange = useCallback(
    (value: string) => {
      if (!selectedTaskId || !value) return;
      const newEnd = new Date(value);
      updateTask.mutate(
        { id: selectedTaskId, data: { endDate: newEnd } },
        {
          onError: (err) =>
            toast.error(t("panel.errorUpdateEndDate"), {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, updateTask, t]
  );

  // Phase 3 — All-day toggle + time inputs
  const handleAllDayToggle = useCallback(
    (nextAllDay: boolean) => {
      if (!selectedTaskId || !task) return;
      const patch: Partial<typeof task> = { allDay: nextAllDay };
      // When switching off all-day, seed start/end time from company defaults
      // (or existing values if already set).
      if (!nextAllDay) {
        patch.startTime = task.startTime ?? company?.defaultWorkStart ?? "08:00:00";
        patch.endTime = task.endTime ?? company?.defaultWorkEnd ?? "17:00:00";
      }
      updateTask.mutate(
        { id: selectedTaskId, data: patch },
        {
          onError: (err) =>
            toast.error(t("panel.errorUpdateAllDay"), {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, task, company, updateTask, t]
  );

  const handleStartTimeChange = useCallback(
    (value: string) => {
      if (!selectedTaskId) return;
      // <input type="time"> emits "HH:mm" — append seconds for Postgres TIME.
      const next = value ? `${value}:00` : null;
      updateTask.mutate(
        { id: selectedTaskId, data: { startTime: next } },
        {
          onError: (err) =>
            toast.error(t("panel.errorUpdateStartTime"), {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, updateTask, t]
  );

  const handleEndTimeChange = useCallback(
    (value: string) => {
      if (!selectedTaskId) return;
      const next = value ? `${value}:00` : null;
      updateTask.mutate(
        { id: selectedTaskId, data: { endTime: next } },
        {
          onError: (err) =>
            toast.error(t("panel.errorUpdateEndTime"), {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, updateTask, t]
  );

  const handleNotesBlur = useCallback(() => {
    setEditingNotes(false);
    if (!selectedTaskId || notesValue === (task?.taskNotes ?? "")) return;
    updateTask.mutate(
      { id: selectedTaskId, data: { taskNotes: notesValue || null } },
      {
        onError: (err) =>
          toast.error(t("panel.errorUpdateNotes"), { description: err.message }),
      }
    );
  }, [selectedTaskId, notesValue, task, updateTask, t]);

  // ─── Phase 3 — Repeat handling ───────────────────────────────────────────

  const handleRepeatChange = useCallback(
    async (nextRrule: string | null) => {
      if (!task || !selectedTaskId) return;
      const startAnchor = task.startDate
        ? format(
            task.startDate instanceof Date
              ? task.startDate
              : new Date(task.startDate),
            "yyyy-MM-dd"
          )
        : null;

      // ── Case A: not a series yet, user is enabling recurrence
      if (!task.recurrenceId) {
        if (!nextRrule) return; // Off → still off, no-op
        if (!startAnchor) {
          toast.error(t("panel.errorSetStartDate"));
          return;
        }
        try {
          await createRecurrence.mutateAsync({
            companyId: task.companyId,
            projectId: task.projectId,
            clientId: null,
            taskTypeId: task.taskTypeId,
            title: task.customTitle ?? taskType?.display ?? "Task",
            teamMemberIds: task.teamMemberIds,
            rrule: nextRrule,
            startAnchor,
            endAnchor: null,
            allDay: task.allDay,
            startTime: task.startTime ?? null,
            endTime: task.endTime ?? null,
            duration: task.duration > 0 ? task.duration : 1,
            notes: task.taskNotes,
            createdBy: currentUser?.id ?? null,
          });
          // Soft-delete the seed task — the cron will materialize the first
          // occurrence (and every future occurrence) within minutes.
          deleteTask.mutate(
            { id: selectedTaskId, projectId: task.projectId },
            {
              onSuccess: () => {
                toast.success(t("panel.seriesCreated"), {
                  description: t("panel.seriesCreatedDescription"),
                });
                closeSidePanel();
              },
            }
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : t("panel.unknownError");
          toast.error(t("panel.errorCreateSeries"), { description: message });
        }
        return;
      }

      // ── Case B: already a series, user is editing the rule
      if (!recurrence) {
        toast.error(t("panel.errorTemplateNotLoaded"));
        return;
      }

      // Off = stop the series. Treat as edit-following: cap end_anchor at
      // current occurrence and don't fork. (No new template needed.)
      if (!nextRrule) {
        try {
          await updateRecurrence.mutateAsync({
            id: recurrence.id,
            patch: {
              endAnchor: task.recurrenceOriginDate ?? startAnchor ?? undefined,
            },
          });
          toast.success(t("panel.seriesStopped"));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : t("panel.unknownError");
          toast.error(t("panel.errorStopSeries"), { description: message });
        }
        return;
      }

      // Editing the rule itself — prompt for scope, then patch the template.
      const scope = await recurrencePrompt.request({
        title: t("panel.changeRepeatRuleTitle"),
        description: t("panel.changeRepeatRuleDescription"),
      });
      if (!scope) return;

      if (scope === "this") {
        toast.error(t("panel.errorSingleOccurrenceRule"));
        return;
      }

      try {
        if (scope === "all") {
          await updateRecurrence.mutateAsync({
            id: recurrence.id,
            patch: { rrule: nextRrule },
          });
          toast.success(t("panel.seriesUpdated"));
        } else {
          // this_and_following — cap original at originalDate-1, fork a new
          // template starting at originalDate with the new rule.
          const originalDate =
            task.recurrenceOriginDate ?? startAnchor ?? null;
          if (!originalDate) {
            toast.error(t("panel.errorMissingAnchor"));
            return;
          }
          const splitDate = new Date(`${originalDate}T00:00:00Z`);
          const cappedEnd = new Date(splitDate);
          cappedEnd.setUTCDate(cappedEnd.getUTCDate() - 1);
          const cappedKey = format(cappedEnd, "yyyy-MM-dd");

          await updateRecurrence.mutateAsync({
            id: recurrence.id,
            patch: { endAnchor: cappedKey },
          });
          await createRecurrence.mutateAsync({
            companyId: recurrence.companyId,
            projectId: recurrence.projectId,
            clientId: recurrence.clientId,
            taskTypeId: recurrence.taskTypeId,
            title: recurrence.title,
            teamMemberIds: recurrence.teamMemberIds,
            rrule: nextRrule,
            startAnchor: originalDate,
            endAnchor: recurrence.endAnchor,
            allDay: recurrence.allDay,
            startTime: recurrence.startTime,
            endTime: recurrence.endTime,
            duration: recurrence.duration,
            notes: recurrence.notes,
            createdBy: currentUser?.id ?? null,
          });
          toast.success(t("panel.seriesSplit"));
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("panel.unknownError");
        toast.error(t("panel.errorUpdateSeries"), { description: message });
      }
    },
    [
      task,
      selectedTaskId,
      recurrence,
      taskType,
      currentUser,
      createRecurrence,
      updateRecurrence,
      deleteTask,
      recurrencePrompt,
      closeSidePanel,
      t,
    ]
  );

  const handlePush = useCallback(
    (days: number) => {
      if (!task || !selectedTaskId || !taskTypes) return;
      const schedulable = taskToSchedulable(task, taskTypes);
      const { newStart, newEnd } = pushByDays(schedulable, days);

      updateTask.mutate(
        {
          id: selectedTaskId,
          data: { startDate: newStart, endDate: newEnd },
        },
        {
          onSuccess: () =>
            toast.success(
              days === 1
                ? t("panel.pushedOneDay")
                : t("panel.pushedDays", { days })
            ),
          onError: (err) =>
            toast.error(t("panel.errorPushTask"), {
              description: err.message,
            }),
        }
      );
    },
    [task, selectedTaskId, taskTypes, updateTask, t]
  );

  const handleCascade = useCallback(() => {
    if (!task || !selectedTaskId || !taskTypes) return;

    // Push +1 day then cascade
    const schedulable = taskToSchedulable(task, taskTypes);
    const { newStart, newEnd } = pushByDays(schedulable, 1);

    // Build all schedulable tasks for cascade (only tasks with dates)
    const allSchedulable = projectTasks
      .filter((pt) => pt.startDate)
      .map((pt) => taskToSchedulable(pt, taskTypes));

    const cascadeResult = calculateCascade(
      task.id,
      newStart,
      newEnd,
      allSchedulable
    );

    // Apply the push to current task
    updateTask.mutate({
      id: selectedTaskId,
      data: { startDate: newStart, endDate: newEnd },
    });

    // Apply cascade changes
    for (const change of cascadeResult.changes) {
      updateTask.mutate({
        id: change.id,
        data: {
          startDate: change.newStartDate,
          endDate: change.newEndDate,
        },
      });
    }

    const movedCount = cascadeResult.changes.length + 1;
    toast.success(
      cascadeResult.changes.length > 0
        ? t("panel.cascadedPlural", { count: movedCount })
        : t("panel.cascaded", { count: movedCount })
    );
  }, [task, selectedTaskId, taskTypes, projectTasks, updateTask, t]);

  const handleDelete = useCallback(() => {
    if (!selectedTaskId || !task) return;
    deleteTask.mutate(
      {
        id: selectedTaskId,
        projectId: task.projectId,
      },
      {
        onSuccess: () => {
          toast.success(t("panel.taskDeleted"));
          closeSidePanel();
        },
        onError: (err) =>
          toast.error(t("panel.errorDeleteTask"), { description: err.message }),
      }
    );
  }, [selectedTaskId, task, deleteTask, closeSidePanel, t]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  const startDate = task?.startDate
    ? (task.startDate instanceof Date ? task.startDate : new Date(task.startDate))
    : null;
  const endDate = task?.endDate
    ? (task.endDate instanceof Date ? task.endDate : new Date(task.endDate))
    : null;

  return (
    <SidePanelShell
      isOpen={isOpen}
      onClose={closeSidePanel}
      title={t("panel.taskDetailTitle")}
    >
      <div className="flex flex-col h-full">
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* ── Header Section ─────────────────────────────────────────── */}
          <div className="px-[16px] py-[12px]">
            <div className="flex items-center gap-[8px] mb-[4px]">
              <div
                className="w-[8px] h-[8px] rounded-full shrink-0"
                style={{ backgroundColor: taskColor }}
              />
              {editingTitle ? (
                <input
                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      setEditingTitle(false);
                      setTitleValue(displayTitle);
                    }
                  }}
                  autoFocus
                  className="flex-1 bg-transparent font-mohave font-semibold text-[16px] text-white outline-none px-[4px] py-[2px] rounded-bar"
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    backgroundColor: "#141414",
                  }}
                />
              ) : (
                <button
                  onClick={() => {
                    setTitleValue(displayTitle);
                    setEditingTitle(true);
                  }}
                  className="flex-1 text-left font-mohave font-semibold text-[16px] text-white hover:text-[var(--text-3)] transition-colors truncate"
                >
                  {displayTitle}
                </button>
              )}
            </div>
            {(taskType || task?.taskTypeId) && (
              <span
                className="inline-block font-mono text-micro uppercase tracking-[0.08em] px-[6px] py-[2px] rounded-bar ml-[16px]"
                style={{
                  backgroundColor: `${taskColor}20`,
                  color: taskColor,
                  border: `1px solid ${taskColor}40`,
                }}
              >
                {cleanPanelLabel(taskType?.display) ?? t("panel.unmappedType")}
              </span>
            )}
          </div>

          {/* ── Status Section ─────────────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>{t("panel.sectionStatus")}</SectionLabel>
            <DarkSelect
              value={task?.status ?? TaskStatus.Booked}
              onChange={handleStatusChange}
              options={statusOptions}
              unmappedLabel={t("panel.unmappedType")}
            />
          </div>

          {/* ── Task Type Section ──────────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>{t("panel.sectionType")}</SectionLabel>
            <DarkSelect
              value={task?.taskTypeId ?? ""}
              onChange={handleTaskTypeChange}
              options={taskTypeOptions}
              unmappedLabel={t("panel.unmappedType")}
            />
          </div>

          {/* ── Team Section ───────────────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>{t("panel.sectionTeam")}</SectionLabel>
            <div className="flex flex-wrap gap-[6px] items-center">
              {teamMembers.map((member) => (
                <TeamPill
                  key={member.id}
                  member={member}
                  onRemove={() => handleRemoveTeamMember(member.id)}
                  t={t}
                />
              ))}
              {teamMembers.length === 0 && !showTeamAdd && (
                <span className="font-mono text-micro uppercase text-[var(--text-3)]">
                  {t("panel.noTeamAssigned")}
                </span>
              )}
              <div className="relative">
                <button
                  onClick={() => setShowTeamAdd(!showTeamAdd)}
                  className="inline-flex items-center gap-[2px] px-[8px] py-[3px] rounded-full text-micro font-mono uppercase text-[var(--text-3)] hover:text-white transition-colors"
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <Plus className="w-[10px] h-[10px]" />
                  {t("panel.add")}
                </button>
                {showTeamAdd && availableTeamMembers.length > 0 && (
                  <div
                    className="absolute top-full left-0 z-10 mt-[4px] w-[200px] max-h-[160px] overflow-y-auto rounded-panel"
                    style={{
                      backgroundColor: "var(--surface-glass-dense)",
                      backdropFilter: "blur(28px) saturate(1.3)",
                      border: "1px solid rgba(255,255,255,0.10)",
                    }}
                  >
                    {availableTeamMembers.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => handleAddTeamMember(m.id)}
                        className="w-full text-left px-[10px] py-[6px] text-[11px] font-mono uppercase text-[var(--text-3)] hover:text-white hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                      >
                        {m.firstName} {m.lastName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Schedule Section ────────────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>{t("panel.sectionSchedule")}</SectionLabel>
            <div className="space-y-[8px]">
              {/* Date range */}
              <div className="flex items-center gap-[8px]">
                <input
                  type="datetime-local"
                  value={
                    startDate
                      ? format(startDate, "yyyy-MM-dd'T'HH:mm")
                      : ""
                  }
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="flex-1 px-[8px] py-[4px] rounded-panel text-[12px] font-mono text-white outline-none"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid rgba(255,255,255,0.10)",
                    colorScheme: "dark",
                  }}
                />
                <ArrowRight className="w-[12px] h-[12px] text-[var(--text-3)] shrink-0" />
                <input
                  type="datetime-local"
                  value={
                    endDate ? format(endDate, "yyyy-MM-dd'T'HH:mm") : ""
                  }
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  className="flex-1 px-[8px] py-[4px] rounded-panel text-[12px] font-mono text-white outline-none"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid rgba(255,255,255,0.10)",
                    colorScheme: "dark",
                  }}
                />
              </div>

              {/* Phase 3 — All-day toggle (two-state segmented row) */}
              <div className="flex items-center gap-[6px] pt-[2px]">
                <span
                  className="font-mono text-micro uppercase tracking-[0.08em]"
                  style={{ color: "var(--text-mute)" }}
                >
                  {t("panel.allDay")}
                </span>
                <div className="ml-auto flex items-center" role="group">
                  <button
                    type="button"
                    onClick={() => handleAllDayToggle(true)}
                    aria-pressed={!!task?.allDay}
                    className="px-[10px] py-[3px] font-mono text-micro uppercase tracking-[0.16em] transition-colors"
                    style={{
                      color: task?.allDay ? "var(--text)" : "var(--text-3)",
                      background: task?.allDay
                        ? "rgba(255,255,255,0.08)"
                        : "transparent",
                      border: task?.allDay
                        ? "1px solid rgba(255,255,255,0.18)"
                        : "1px solid var(--line)",
                      borderRadius: "5px 0 0 5px",
                    }}
                  >
                    {t("panel.on")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAllDayToggle(false)}
                    aria-pressed={!task?.allDay}
                    className="px-[10px] py-[3px] font-mono text-micro uppercase tracking-[0.16em] transition-colors"
                    style={{
                      color: !task?.allDay ? "var(--text)" : "var(--text-3)",
                      background: !task?.allDay
                        ? "rgba(255,255,255,0.08)"
                        : "transparent",
                      border: !task?.allDay
                        ? "1px solid rgba(255,255,255,0.18)"
                        : "1px solid var(--line)",
                      borderLeft: "none",
                      borderRadius: "0 5px 5px 0",
                    }}
                  >
                    {t("panel.off")}
                  </button>
                </div>
              </div>

              {/* Phase 3 — Time inputs (only meaningful when allDay = false) */}
              <div className="flex items-center gap-[8px]">
                <div className="flex-1 flex flex-col gap-[2px]">
                  <span
                    className="font-mono text-[11px] uppercase tracking-[0.08em]"
                    style={{
                      color: task?.allDay ? "var(--text-mute)" : "var(--text-3)",
                    }}
                  >
                    {t("panel.start")}
                  </span>
                  <input
                    type="time"
                    step={900}
                    disabled={!!task?.allDay}
                    value={
                      task?.startTime
                        ? task.startTime.slice(0, 5)
                        : ""
                    }
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                    className="w-full px-[8px] py-[4px] rounded text-[13px] font-mono outline-none tabular-nums"
                    style={{
                      backgroundColor: "var(--surface-input)",
                      border: "1px solid var(--line)",
                      colorScheme: "dark",
                      color: task?.allDay
                        ? "var(--text-mute)"
                        : "var(--text)",
                      fontFeatureSettings: '"tnum" 1, "zero" 1',
                      opacity: task?.allDay ? 0.5 : 1,
                    }}
                  />
                </div>
                <ArrowRight
                  className="w-[12px] h-[12px] shrink-0 mt-[14px]"
                  style={{
                    color: task?.allDay ? "var(--text-mute)" : "var(--text-3)",
                  }}
                />
                <div className="flex-1 flex flex-col gap-[2px]">
                  <span
                    className="font-mono text-[11px] uppercase tracking-[0.08em]"
                    style={{
                      color: task?.allDay ? "var(--text-mute)" : "var(--text-3)",
                    }}
                  >
                    {t("panel.end")}
                  </span>
                  <input
                    type="time"
                    step={900}
                    disabled={!!task?.allDay}
                    value={
                      task?.endTime
                        ? task.endTime.slice(0, 5)
                        : ""
                    }
                    onChange={(e) => handleEndTimeChange(e.target.value)}
                    className="w-full px-[8px] py-[4px] rounded text-[13px] font-mono outline-none tabular-nums"
                    style={{
                      backgroundColor: "var(--surface-input)",
                      border: "1px solid var(--line)",
                      colorScheme: "dark",
                      color: task?.allDay
                        ? "var(--text-mute)"
                        : "var(--text)",
                      fontFeatureSettings: '"tnum" 1, "zero" 1',
                      opacity: task?.allDay ? 0.5 : 1,
                    }}
                  />
                </div>
              </div>

              {durationLabel && (
                <span className="font-mono text-micro uppercase text-[var(--text-3)]">
                  {t("panel.duration", { label: durationLabel })}
                </span>
              )}
            </div>
          </div>

          {/* ── Repeat Section (Phase 3) ───────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>{t("panel.sectionRepeat")}</SectionLabel>
            {startDate ? (
              <RepeatPicker
                anchor={startDate}
                value={recurrence?.rrule ?? null}
                onChange={handleRepeatChange}
                disabled={
                  createRecurrence.isPending ||
                  updateRecurrence.isPending
                }
              />
            ) : (
              <span className="font-mono text-micro uppercase text-[var(--text-3)]">
                {t("panel.setStartDateForRepeat")}
              </span>
            )}
            {task?.recurrenceId && task.recurrenceOriginDate && (
              <span
                className="block mt-[6px] font-mono text-micro uppercase tracking-[0.16em]"
                style={{ color: "var(--text-mute)" }}
              >
                {t("panel.partOfSeries", {
                  origin: task.recurrenceOriginDate,
                })}
              </span>
            )}
          </div>

          {/* ── Dependencies Section ───────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>{t("panel.sectionDependencies")}</SectionLabel>
            {dependencies.predecessors.length === 0 &&
            dependencies.successors.length === 0 ? (
              <span className="font-mono text-micro uppercase text-[var(--text-3)]">
                {t("panel.none")}
              </span>
            ) : (
              <div className="space-y-[4px]">
                {dependencies.predecessors.map((dep) => (
                  <div
                    key={dep.typeId}
                    className="flex items-center gap-[6px] text-[11px]"
                  >
                    <ArrowLeft className="w-[10px] h-[10px] text-[var(--text-3)]" />
                    <span className="font-mono uppercase text-white">
                      {dep.typeName}
                    </span>
                    {dep.isCompleted ? (
                      <Check className="w-[10px] h-[10px] text-[var(--olive)]" />
                    ) : (
                      <ArrowRight className="w-[10px] h-[10px] text-[var(--tan)]" />
                    )}
                  </div>
                ))}
                {dependencies.successors.map((dep) => (
                  <div
                    key={dep.typeId}
                    className="flex items-center gap-[6px] text-[11px]"
                  >
                    <ArrowRight className="w-[10px] h-[10px] text-[var(--text-3)]" />
                    <span className="font-mono uppercase text-white">
                      {dep.typeName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Materials Section ──────────────────────────────────────── */}
          {selectedTaskId && task && (
            <div
              className="px-[16px] py-[12px]"
              style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              <SectionLabel>{t("panel.sectionMaterials")}</SectionLabel>
              <TaskMaterialsSection
                taskId={selectedTaskId}
                inventoryDeducted={task.inventoryDeducted ?? false}
              />
            </div>
          )}

          {/* ── Notes Section ──────────────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>{t("panel.sectionNotes")}</SectionLabel>
            <textarea
              value={
                editingNotes ? notesValue : task?.taskNotes ?? ""
              }
              onFocus={() => {
                setNotesValue(task?.taskNotes ?? "");
                setEditingNotes(true);
              }}
              onChange={(e) => setNotesValue(e.target.value)}
              onBlur={handleNotesBlur}
              rows={3}
              placeholder={t("panel.addNotesPlaceholder")}
              className="w-full px-[8px] py-[6px] rounded-panel text-[12px] text-white placeholder-[var(--text-mute)] outline-none resize-none"
              style={{
                backgroundColor: "#141414",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            />
          </div>

          {/* Spacer for sticky footer */}
          <div className="h-[120px]" />
        </div>

        {/* ── Quick Actions (sticky bottom) ──────────────────────────── */}
        <div
          className="sticky bottom-0 px-[16px] py-[12px] shrink-0"
          style={{
            backgroundColor: "var(--surface-glass)",
            backdropFilter: "blur(28px) saturate(1.3)",
            borderTop: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <div className="flex gap-[6px] mb-[10px]">
            <button
              onClick={() => handlePush(1)}
              className="flex-1 px-[8px] py-[6px] rounded-panel font-mono text-micro uppercase text-white transition-colors hover:bg-[rgba(255,255,255,0.05)]"
              style={{
                backgroundColor: "#141414",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              {t("panel.pushOne")}
            </button>
            <button
              onClick={() => handlePush(7)}
              className="flex-1 px-[8px] py-[6px] rounded-panel font-mono text-micro uppercase text-white transition-colors hover:bg-[rgba(255,255,255,0.05)]"
              style={{
                backgroundColor: "#141414",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              {t("panel.pushOneWeek")}
            </button>
            <button
              onClick={handleCascade}
              className="flex-1 px-[8px] py-[6px] rounded-panel font-mono text-micro uppercase text-white transition-colors hover:bg-[rgba(255,255,255,0.05)] flex items-center justify-center gap-[4px]"
              style={{
                backgroundColor: "#141414",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <Zap className="w-[10px] h-[10px]" />
              {t("panel.cascade")}
            </button>
          </div>

          {/* Delete */}
          {showDeleteConfirm ? (
            <div className="flex items-center gap-[8px]">
              <span className="font-mono text-micro uppercase text-red-400">
                {t("panel.areYouSure")}
              </span>
              <button
                onClick={handleDelete}
                disabled={deleteTask.isPending}
                className="px-[10px] py-[4px] rounded-panel font-mono text-micro uppercase text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {deleteTask.isPending
                  ? t("panel.deleting")
                  : t("panel.yesDelete")}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-[10px] py-[4px] rounded-panel font-mono text-micro uppercase text-[var(--text-3)] hover:text-white transition-colors"
                style={{ border: "1px solid rgba(255,255,255,0.10)" }}
              >
                {t("panel.cancel")}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full text-left font-mono text-micro uppercase text-red-400 hover:text-red-300 transition-colors flex items-center gap-[4px] py-[4px]"
            >
              <Trash2 className="w-[12px] h-[12px]" />
              {t("panel.deleteTask")}
            </button>
          )}
        </div>
      </div>
      {/* Phase 3 — recurrence scope prompt (Radix portal at z-modal=3000) */}
      {recurrencePrompt.promptElement}
    </SidePanelShell>
  );
}
