"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import { Trash2, Check, ArrowRight, ArrowLeft, Zap, Plus, X } from "lucide-react";
import { useCalendarStore } from "@/stores/calendar-store";
import {
  useTask,
  useUpdateTask,
  useDeleteTask,
  useTaskTypes,
  useTeamMembers,
  useProjectTasks,
} from "@/lib/hooks";
import {
  TaskStatus,
  getInitials,
  getTaskDisplayTitle,
} from "@/lib/types/models";
import { pushByDays, calculateCascade } from "@/lib/scheduling/engine";
import { taskToSchedulable } from "@/lib/scheduling/adapters";
import { SidePanelShell } from "./side-panel-shell";

// ─── Status options ─────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: TaskStatus.Booked, label: "Booked" },
  { value: TaskStatus.InProgress, label: "In Progress" },
  { value: TaskStatus.Completed, label: "Completed" },
  { value: TaskStatus.Cancelled, label: "Cancelled" },
];

// ─── Styled Select ──────────────────────────────────────────────────────────

function DarkSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
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
    options.find((o) => o.value === value)?.label ?? value;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left px-[10px] py-[6px] rounded-[3px] text-[12px] font-kosugi text-white"
        style={{
          backgroundColor: "#141414",
          border: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        {selectedLabel}
      </button>
      {isOpen && (
        <div
          className="absolute top-full left-0 right-0 z-10 mt-[2px] rounded-[3px] overflow-hidden"
          style={{
            backgroundColor: "rgba(10,10,10,0.95)",
            backdropFilter: "blur(20px) saturate(1.2)",
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
              className="w-full text-left px-[10px] py-[6px] text-[12px] font-kosugi text-[#999999] hover:text-white hover:bg-[rgba(255,255,255,0.05)] transition-colors"
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
    <span className="font-kosugi text-[10px] uppercase tracking-[0.08em] text-[#999999] block mb-[6px]">
      {children}
    </span>
  );
}

// ─── Team Member Pill ───────────────────────────────────────────────────────

function TeamPill({
  member,
  onRemove,
}: {
  member: { id: string; firstName: string; lastName: string };
  onRemove: () => void;
}) {
  const initials = getInitials(`${member.firstName} ${member.lastName}`);
  const name = `${member.firstName} ${member.lastName}`.trim() || "Unknown";

  return (
    <span
      className="inline-flex items-center gap-[4px] px-[8px] py-[3px] rounded-full text-[11px] text-white"
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <span className="font-kosugi text-[9px] uppercase text-[#999999]">
        {initials}
      </span>
      <span className="font-kosugi text-[10px] uppercase">{name}</span>
      <button
        onClick={onRemove}
        className="ml-[2px] text-[#999999] hover:text-white transition-colors"
        aria-label={`Remove ${name}`}
      >
        <X className="w-[10px] h-[10px]" />
      </button>
    </span>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function TaskDetailPanel() {
  const { sidePanelMode, selectedTaskId, closeSidePanel } = useCalendarStore();

  const isOpen = sidePanelMode === "task-detail" && !!selectedTaskId;

  // Data queries
  const { data: task } = useTask(selectedTaskId ?? undefined);
  const { data: taskTypes } = useTaskTypes();
  const { data: teamMembersData } = useTeamMembers();
  const { data: projectTasksData } = useProjectTasks(
    task?.projectId ?? undefined
  );

  // Mutations
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

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
    if (!task) return "Task";
    return getTaskDisplayTitle(task, taskType);
  }, [task, taskType]);

  const taskColor = useMemo(() => {
    return taskType?.color ?? task?.taskColor ?? "#597794";
  }, [taskType, task]);

  // Dependencies
  const dependencies = useMemo(() => {
    if (!task || !taskTypes) return { predecessors: [], successors: [] };

    const effectiveDeps =
      task.dependencyOverrides ?? taskType?.dependencies ?? [];

    // Predecessors: task types this task depends on
    const predecessors = effectiveDeps
      .map((dep) => {
        const depType = taskTypes.find(
          (tt) => tt.id === dep.depends_on_task_type_id
        );
        const depTask = projectTasks.find(
          (pt) => pt.taskTypeId === dep.depends_on_task_type_id
        );
        return {
          typeName: depType?.display ?? "Unknown",
          isCompleted: depTask?.status === TaskStatus.Completed,
          typeId: dep.depends_on_task_type_id,
        };
      })
      .filter((d) => d.typeName !== "Unknown");

    // Successors: task types that depend on this task's type
    const successors: { typeName: string; typeId: string }[] = [];
    for (const tt of taskTypes) {
      const deps = tt.dependencies ?? [];
      if (deps.some((d) => d.depends_on_task_type_id === task.taskTypeId)) {
        successors.push({ typeName: tt.display, typeId: tt.id });
      }
    }

    return { predecessors, successors };
  }, [task, taskType, taskTypes, projectTasks]);

  // Duration computed
  const durationLabel = useMemo(() => {
    if (!task?.startDate || !task?.endDate) return null;
    const start = task.startDate instanceof Date ? task.startDate : new Date(task.startDate);
    const end = task.endDate instanceof Date ? task.endDate : new Date(task.endDate);
    const days = differenceInCalendarDays(end, start) + 1;
    return `${days} day${days !== 1 ? "s" : ""}`;
  }, [task?.startDate, task?.endDate]);

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
          toast.error("Failed to update title", { description: err.message }),
      }
    );
  }, [task, selectedTaskId, titleValue, displayTitle, updateTask]);

  const handleStatusChange = useCallback(
    (newStatus: string) => {
      if (!selectedTaskId) return;
      updateTask.mutate(
        { id: selectedTaskId, data: { status: newStatus as TaskStatus } },
        {
          onError: (err) =>
            toast.error("Failed to update status", {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, updateTask]
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
            taskColor: newType?.color ?? task?.taskColor ?? "#597794",
          },
        },
        {
          onError: (err) =>
            toast.error("Failed to update type", {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, taskTypes, task, updateTask]
  );

  const handleRemoveTeamMember = useCallback(
    (memberId: string) => {
      if (!selectedTaskId || !task) return;
      const newIds = task.teamMemberIds.filter((id) => id !== memberId);
      updateTask.mutate(
        { id: selectedTaskId, data: { teamMemberIds: newIds } },
        {
          onError: (err) =>
            toast.error("Failed to remove member", {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, task, updateTask]
  );

  const handleAddTeamMember = useCallback(
    (memberId: string) => {
      if (!selectedTaskId || !task) return;
      const newIds = [...task.teamMemberIds, memberId];
      updateTask.mutate(
        { id: selectedTaskId, data: { teamMemberIds: newIds } },
        {
          onError: (err) =>
            toast.error("Failed to add member", {
              description: err.message,
            }),
        }
      );
      setShowTeamAdd(false);
    },
    [selectedTaskId, task, updateTask]
  );

  const handleStartDateChange = useCallback(
    (value: string) => {
      if (!selectedTaskId || !value) return;
      const newStart = new Date(value);
      updateTask.mutate(
        { id: selectedTaskId, data: { startDate: newStart } },
        {
          onError: (err) =>
            toast.error("Failed to update start date", {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, updateTask]
  );

  const handleEndDateChange = useCallback(
    (value: string) => {
      if (!selectedTaskId || !value) return;
      const newEnd = new Date(value);
      updateTask.mutate(
        { id: selectedTaskId, data: { endDate: newEnd } },
        {
          onError: (err) =>
            toast.error("Failed to update end date", {
              description: err.message,
            }),
        }
      );
    },
    [selectedTaskId, updateTask]
  );

  const handleNotesBlur = useCallback(() => {
    setEditingNotes(false);
    if (!selectedTaskId || notesValue === (task?.taskNotes ?? "")) return;
    updateTask.mutate(
      { id: selectedTaskId, data: { taskNotes: notesValue || null } },
      {
        onError: (err) =>
          toast.error("Failed to update notes", { description: err.message }),
      }
    );
  }, [selectedTaskId, notesValue, task, updateTask]);

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
              `Pushed ${days === 1 ? "+1 day" : `+${days} days`}`
            ),
          onError: (err) =>
            toast.error("Failed to push task", {
              description: err.message,
            }),
        }
      );
    },
    [task, selectedTaskId, taskTypes, updateTask]
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

    toast.success(
      `Cascaded: ${cascadeResult.changes.length + 1} task${cascadeResult.changes.length > 0 ? "s" : ""} moved`
    );
  }, [task, selectedTaskId, taskTypes, projectTasks, updateTask]);

  const handleDelete = useCallback(() => {
    if (!selectedTaskId || !task) return;
    deleteTask.mutate(
      {
        id: selectedTaskId,
        projectId: task.projectId,
      },
      {
        onSuccess: () => {
          toast.success("Task deleted");
          closeSidePanel();
        },
        onError: (err) =>
          toast.error("Failed to delete task", { description: err.message }),
      }
    );
  }, [selectedTaskId, task, deleteTask, closeSidePanel]);

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
      title="Task Detail"
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
                  className="flex-1 bg-transparent font-mohave font-semibold text-[16px] text-white outline-none px-[4px] py-[2px] rounded-[2px]"
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
                  className="flex-1 text-left font-mohave font-semibold text-[16px] text-white hover:text-[#999999] transition-colors truncate"
                >
                  {displayTitle}
                </button>
              )}
            </div>
            {taskType && (
              <span
                className="inline-block font-kosugi text-[9px] uppercase tracking-[0.08em] px-[6px] py-[2px] rounded-[2px] ml-[16px]"
                style={{
                  backgroundColor: `${taskColor}20`,
                  color: taskColor,
                  border: `1px solid ${taskColor}40`,
                }}
              >
                {taskType.display}
              </span>
            )}
          </div>

          {/* ── Status Section ─────────────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>STATUS</SectionLabel>
            <DarkSelect
              value={task?.status ?? TaskStatus.Booked}
              onChange={handleStatusChange}
              options={STATUS_OPTIONS}
            />
          </div>

          {/* ── Task Type Section ──────────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>TYPE</SectionLabel>
            <DarkSelect
              value={task?.taskTypeId ?? ""}
              onChange={handleTaskTypeChange}
              options={
                taskTypes?.map((tt) => ({
                  value: tt.id,
                  label: tt.display,
                })) ?? []
              }
            />
          </div>

          {/* ── Team Section ───────────────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>TEAM</SectionLabel>
            <div className="flex flex-wrap gap-[6px] items-center">
              {teamMembers.map((member) => (
                <TeamPill
                  key={member.id}
                  member={member}
                  onRemove={() => handleRemoveTeamMember(member.id)}
                />
              ))}
              {teamMembers.length === 0 && !showTeamAdd && (
                <span className="font-kosugi text-[10px] uppercase text-[#999999]">
                  No team assigned
                </span>
              )}
              <div className="relative">
                <button
                  onClick={() => setShowTeamAdd(!showTeamAdd)}
                  className="inline-flex items-center gap-[2px] px-[8px] py-[3px] rounded-full text-[10px] font-kosugi uppercase text-[#999999] hover:text-white transition-colors"
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <Plus className="w-[10px] h-[10px]" />
                  ADD
                </button>
                {showTeamAdd && availableTeamMembers.length > 0 && (
                  <div
                    className="absolute top-full left-0 z-10 mt-[4px] w-[200px] max-h-[160px] overflow-y-auto rounded-[3px]"
                    style={{
                      backgroundColor: "rgba(10,10,10,0.95)",
                      backdropFilter: "blur(20px) saturate(1.2)",
                      border: "1px solid rgba(255,255,255,0.10)",
                    }}
                  >
                    {availableTeamMembers.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => handleAddTeamMember(m.id)}
                        className="w-full text-left px-[10px] py-[6px] text-[11px] font-kosugi uppercase text-[#999999] hover:text-white hover:bg-[rgba(255,255,255,0.05)] transition-colors"
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
            <SectionLabel>SCHEDULE</SectionLabel>
            <div className="space-y-[6px]">
              <div className="flex items-center gap-[8px]">
                <input
                  type="datetime-local"
                  value={
                    startDate
                      ? format(startDate, "yyyy-MM-dd'T'HH:mm")
                      : ""
                  }
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="flex-1 px-[8px] py-[4px] rounded-[3px] text-[12px] font-mono text-white outline-none"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid rgba(255,255,255,0.10)",
                    colorScheme: "dark",
                  }}
                />
                <ArrowRight className="w-[12px] h-[12px] text-[#999999] shrink-0" />
                <input
                  type="datetime-local"
                  value={
                    endDate ? format(endDate, "yyyy-MM-dd'T'HH:mm") : ""
                  }
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  className="flex-1 px-[8px] py-[4px] rounded-[3px] text-[12px] font-mono text-white outline-none"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid rgba(255,255,255,0.10)",
                    colorScheme: "dark",
                  }}
                />
              </div>
              {durationLabel && (
                <span className="font-kosugi text-[10px] uppercase text-[#999999]">
                  Duration: {durationLabel}
                </span>
              )}
            </div>
          </div>

          {/* ── Dependencies Section ───────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>DEPENDENCIES</SectionLabel>
            {dependencies.predecessors.length === 0 &&
            dependencies.successors.length === 0 ? (
              <span className="font-kosugi text-[10px] uppercase text-[#999999]">
                None
              </span>
            ) : (
              <div className="space-y-[4px]">
                {dependencies.predecessors.map((dep) => (
                  <div
                    key={dep.typeId}
                    className="flex items-center gap-[6px] text-[11px]"
                  >
                    <ArrowLeft className="w-[10px] h-[10px] text-[#999999]" />
                    <span className="font-kosugi uppercase text-white">
                      {dep.typeName}
                    </span>
                    {dep.isCompleted ? (
                      <Check className="w-[10px] h-[10px] text-[#9DB582]" />
                    ) : (
                      <ArrowRight className="w-[10px] h-[10px] text-[#C4A868]" />
                    )}
                  </div>
                ))}
                {dependencies.successors.map((dep) => (
                  <div
                    key={dep.typeId}
                    className="flex items-center gap-[6px] text-[11px]"
                  >
                    <ArrowRight className="w-[10px] h-[10px] text-[#999999]" />
                    <span className="font-kosugi uppercase text-white">
                      {dep.typeName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Notes Section ──────────────────────────────────────────── */}
          <div
            className="px-[16px] py-[12px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <SectionLabel>NOTES</SectionLabel>
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
              placeholder="Add notes..."
              className="w-full px-[8px] py-[6px] rounded-[3px] text-[12px] text-white placeholder-[#666666] outline-none resize-none"
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
            backgroundColor: "rgba(10,10,10,0.70)",
            backdropFilter: "blur(20px) saturate(1.2)",
            borderTop: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <div className="flex gap-[6px] mb-[10px]">
            <button
              onClick={() => handlePush(1)}
              className="flex-1 px-[8px] py-[6px] rounded-[3px] font-kosugi text-[10px] uppercase text-white transition-colors hover:bg-[rgba(255,255,255,0.05)]"
              style={{
                backgroundColor: "#141414",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              Push +1
            </button>
            <button
              onClick={() => handlePush(7)}
              className="flex-1 px-[8px] py-[6px] rounded-[3px] font-kosugi text-[10px] uppercase text-white transition-colors hover:bg-[rgba(255,255,255,0.05)]"
              style={{
                backgroundColor: "#141414",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              Push +1 Week
            </button>
            <button
              onClick={handleCascade}
              className="flex-1 px-[8px] py-[6px] rounded-[3px] font-kosugi text-[10px] uppercase text-white transition-colors hover:bg-[rgba(255,255,255,0.05)] flex items-center justify-center gap-[4px]"
              style={{
                backgroundColor: "#141414",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <Zap className="w-[10px] h-[10px]" />
              Cascade
            </button>
          </div>

          {/* Delete */}
          {showDeleteConfirm ? (
            <div className="flex items-center gap-[8px]">
              <span className="font-kosugi text-[10px] uppercase text-red-400">
                Are you sure?
              </span>
              <button
                onClick={handleDelete}
                disabled={deleteTask.isPending}
                className="px-[10px] py-[4px] rounded-[3px] font-kosugi text-[10px] uppercase text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {deleteTask.isPending ? "Deleting..." : "Yes, Delete"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-[10px] py-[4px] rounded-[3px] font-kosugi text-[10px] uppercase text-[#999999] hover:text-white transition-colors"
                style={{ border: "1px solid rgba(255,255,255,0.10)" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full text-left font-kosugi text-[10px] uppercase text-red-400 hover:text-red-300 transition-colors flex items-center gap-[4px] py-[4px]"
            >
              <Trash2 className="w-[12px] h-[12px]" />
              Delete Task
            </button>
          )}
        </div>
      </div>
    </SidePanelShell>
  );
}
