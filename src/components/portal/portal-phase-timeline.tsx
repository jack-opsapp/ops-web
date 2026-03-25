"use client";

import { useState, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { useDictionary } from "@/i18n/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskItem {
  id: string;
  title: string;
  status: string;
  displayOrder: number;
  taskType: { id: string; name: string; color: string } | null;
}

interface Phase {
  id: string;
  name: string;
  color: string;
  status: "completed" | "in_progress" | "upcoming";
  tasks: TaskItem[];
}

export interface PortalPhaseTimelineProps {
  tasks: TaskItem[];
}

// ─── Status helpers ──────────────────────────────────────────────────────────

const COMPLETED_STATUSES = new Set(["Completed", "completed", "done"]);
const IN_PROGRESS_STATUSES = new Set(["In Progress", "in_progress", "started"]);

function isCompleted(status: string): boolean {
  return COMPLETED_STATUSES.has(status);
}

function isInProgress(status: string): boolean {
  return IN_PROGRESS_STATUSES.has(status);
}

function computePhaseStatus(tasks: TaskItem[]): "completed" | "in_progress" | "upcoming" {
  if (tasks.length === 0) return "upcoming";
  if (tasks.every((t) => isCompleted(t.status))) return "completed";
  if (tasks.some((t) => isInProgress(t.status) || isCompleted(t.status))) return "in_progress";
  return "upcoming";
}

// ─── Task status display ─────────────────────────────────────────────────────

const STATUS_KEYS: Record<string, string> = {
  Booked: "taskTimeline.booked",
  booked: "taskTimeline.booked",
  "In Progress": "taskTimeline.inProgress",
  in_progress: "taskTimeline.inProgress",
  Completed: "taskTimeline.completed",
  completed: "taskTimeline.completed",
  Cancelled: "taskTimeline.cancelled",
  cancelled: "taskTimeline.cancelled",
};

function getStatusLabel(status: string, t: (key: string) => string): string {
  const key = STATUS_KEYS[status];
  if (key) return t(key);
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PortalPhaseTimeline({ tasks }: PortalPhaseTimelineProps) {
  const { t } = useDictionary("portal");

  // Group tasks by taskType into phases
  const phases = useMemo<Phase[]>(() => {
    const grouped = new Map<string, { name: string; color: string; tasks: TaskItem[] }>();

    const sorted = [...tasks].sort((a, b) => a.displayOrder - b.displayOrder);

    for (const task of sorted) {
      const typeId = task.taskType?.id ?? "__other__";
      const existing = grouped.get(typeId);
      if (existing) {
        existing.tasks.push(task);
      } else {
        grouped.set(typeId, {
          name: task.taskType?.name ?? t("phaseTimeline.other"),
          color: task.taskType?.color ?? "#9CA3AF",
          tasks: [task],
        });
      }
    }

    return Array.from(grouped.entries()).map(([id, group]) => ({
      id,
      name: group.name,
      color: group.color,
      status: computePhaseStatus(group.tasks),
      tasks: group.tasks,
    }));
  }, [tasks, t]);

  // Track which phases are expanded (desktop = all expanded, mobile = toggle)
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  function togglePhase(phaseId: string) {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  }

  if (phases.length === 0) return null;

  return (
    <div
      className="rounded-xl"
      style={{
        padding: "var(--portal-card-padding, 24px)",
        backgroundColor: "var(--portal-card)",
        border: "1px solid var(--portal-border)",
        borderRadius: "var(--portal-radius-lg)",
      }}
    >
      <div className="relative">
        {phases.map((phase, phaseIndex) => {
          const isLastPhase = phaseIndex === phases.length - 1;
          const isMobileExpanded = expandedPhases.has(phase.id);

          // Status dot color based on phase status
          const dotColor =
            phase.status === "completed"
              ? "var(--portal-success, #9DB582)"
              : phase.status === "in_progress"
                ? "var(--portal-accent)"
                : "var(--portal-text-tertiary)";

          // Dot style: filled for completed/in-progress, outline for upcoming
          const dotIsFilled = phase.status !== "upcoming";

          return (
            <div key={phase.id} style={{ paddingBottom: isLastPhase ? 0 : 20 }}>
              {/* Phase connector line */}
              {!isLastPhase && (
                <div
                  className="absolute"
                  style={{
                    left: 9,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    backgroundColor: "var(--portal-border)",
                    pointerEvents: "none",
                  }}
                />
              )}

              {/* Phase header — clickable on mobile to expand */}
              <button
                type="button"
                onClick={() => togglePhase(phase.id)}
                className="relative flex items-center gap-3 w-full text-left md:cursor-default"
              >
                {/* Phase dot */}
                <div
                  className="relative shrink-0 z-[1]"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    backgroundColor: dotIsFilled ? dotColor : "var(--portal-card)",
                    border: `3px solid ${dotColor}`,
                    boxShadow: phase.status === "in_progress"
                      ? `0 0 0 3px color-mix(in srgb, ${dotColor} 25%, transparent)`
                      : undefined,
                  }}
                />

                {/* Phase name + status */}
                <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-sm font-semibold truncate"
                      style={{
                        fontFamily: "var(--portal-heading-font)",
                        fontWeight: "var(--portal-heading-weight)",
                        color:
                          phase.status === "upcoming"
                            ? "var(--portal-text-tertiary)"
                            : "var(--portal-text)",
                      }}
                    >
                      {phase.name}
                    </span>
                    {phase.status === "in_progress" && (
                      <span
                        className="shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
                        style={{
                          backgroundColor: `color-mix(in srgb, var(--portal-accent) 15%, transparent)`,
                          color: "var(--portal-accent)",
                        }}
                      >
                        {t("phaseTimeline.current")}
                      </span>
                    )}
                  </div>
                  <span
                    className="shrink-0 text-xs"
                    style={{ color: "var(--portal-text-tertiary)" }}
                  >
                    {phase.tasks.filter((tk) => isCompleted(tk.status)).length}/
                    {phase.tasks.length}
                  </span>
                </div>

                {/* Mobile expand chevron */}
                <ChevronDown
                  className="w-4 h-4 shrink-0 md:hidden transition-transform"
                  style={{
                    color: "var(--portal-text-tertiary)",
                    transform: isMobileExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                />
              </button>

              {/* Phase progress bar */}
              <div
                className="ml-[30px] mt-2 mb-2 overflow-hidden"
                style={{
                  height: "var(--portal-progress-height, 4px)",
                  borderRadius: "var(--portal-progress-radius, 2px)",
                  backgroundColor: "var(--portal-border)",
                }}
              >
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${phase.tasks.length > 0
                      ? (phase.tasks.filter((tk) => isCompleted(tk.status)).length / phase.tasks.length) * 100
                      : 0
                    }%`,
                    backgroundColor: dotColor,
                    borderRadius: "var(--portal-progress-radius, 2px)",
                  }}
                />
              </div>

              {/* Individual tasks — always visible on desktop, collapsible on mobile */}
              <div
                className={`ml-[30px] space-y-1.5 overflow-hidden transition-all duration-300 ${
                  isMobileExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 md:max-h-[2000px] md:opacity-100"
                }`}
              >
                {phase.tasks.map((task) => {
                  const taskCompleted = isCompleted(task.status);
                  const taskInProgress = isInProgress(task.status);

                  return (
                    <div
                      key={task.id}
                      className="flex items-center justify-between gap-2 py-1.5 px-3 rounded-md"
                      style={{
                        backgroundColor: taskInProgress
                          ? `color-mix(in srgb, var(--portal-accent) 5%, transparent)`
                          : "transparent",
                        borderRadius: "var(--portal-radius-sm)",
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Task completion indicator */}
                        <div
                          className="shrink-0 flex items-center justify-center"
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            backgroundColor: taskCompleted
                              ? "var(--portal-success, #9DB582)"
                              : "transparent",
                            border: taskCompleted
                              ? "none"
                              : taskInProgress
                                ? "2px solid var(--portal-accent)"
                                : "2px solid var(--portal-border)",
                          }}
                        >
                          {taskCompleted && (
                            <svg
                              width="8"
                              height="8"
                              viewBox="0 0 8 8"
                              fill="none"
                              style={{ color: "var(--portal-card)" }}
                            >
                              <path
                                d="M1.5 4L3 5.5L6.5 2"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>
                        <span
                          className="text-sm truncate"
                          style={{
                            color: taskCompleted
                              ? "var(--portal-text-tertiary)"
                              : "var(--portal-text)",
                            textDecoration: taskCompleted ? "line-through" : "none",
                          }}
                        >
                          {task.title}
                        </span>
                      </div>
                      <span
                        className="shrink-0 text-xs"
                        style={{
                          color: taskCompleted
                            ? "var(--portal-text-tertiary)"
                            : taskInProgress
                              ? "var(--portal-accent)"
                              : "var(--portal-text-tertiary)",
                        }}
                      >
                        {getStatusLabel(task.status, t)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
