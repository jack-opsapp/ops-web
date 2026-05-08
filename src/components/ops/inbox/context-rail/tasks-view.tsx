"use client";

/**
 * TasksView — Tasks tab in the right context rail. Renders open tasks
 * scoped to the current thread/client. Each row: 12×12 checkbox + label
 * (Mohave 12.5 / -0.003em) + assignee · due date in mono.
 *
 * Per the production mockup:
 *   ☐ You · TODAY 17:00
 *   ☐ Reed · Apr 26
 */

import { Check } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface RailTask {
  id: string;
  label: string;
  assignee: string;
  /** Pre-formatted: "TODAY 17:00" or "Apr 26" */
  due: string;
  /** When set, indicates the task is overdue. */
  overdue?: boolean;
  status: "todo" | "active" | "done";
}

interface TasksViewProps {
  tasks: RailTask[];
  onToggle?: (id: string) => void;
  className?: string;
}

export function TasksView({ tasks, onToggle, className }: TasksViewProps) {
  const { t } = useDictionary("inbox");
  if (tasks.length === 0) {
    return (
      <div
        className={cn(
          "px-1 py-6 font-mono text-[11px] text-text-3",
          className,
        )}
      >
        {t("rail.empty.tasks", "No tasks for this thread")}
      </div>
    );
  }
  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {tasks.map((task) => {
        const checked = task.status === "done";
        const active = task.status === "active";
        return (
          <li key={task.id}>
            <button
              type="button"
              onClick={onToggle ? () => onToggle(task.id) : undefined}
              disabled={!onToggle}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-chip border border-transparent px-1.5 py-1.5 text-left transition-colors",
                onToggle ? "hover:border-line hover:bg-inbox-elev/40" : "cursor-default",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-3 w-3 shrink-0 items-center justify-center rounded-[2px] border-[1.25px] transition-colors",
                  checked
                    ? "border-olive bg-olive text-black"
                    : active
                      ? "border-ops-accent"
                      : "border-text-mute",
                )}
              >
                {checked && (
                  <Check
                    aria-hidden
                    className="h-2 w-2"
                    strokeWidth={1.5}
                  />
                )}
                {active && !checked && (
                  <span className="h-1 w-1 rounded-full bg-ops-accent" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate font-mohave text-[12px] tracking-[-0.003em]",
                    checked
                      ? "text-text-3 line-through"
                      : active
                        ? "text-text"
                        : "text-text-2",
                  )}
                >
                  {task.label}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 font-mono text-[11px]",
                  task.overdue
                    ? "text-rose"
                    : task.assignee.toLowerCase() === "you"
                      ? "text-text-2"
                      : "text-text-3",
                )}
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {task.assignee} · {task.due}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
