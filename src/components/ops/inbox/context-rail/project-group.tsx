"use client";

/**
 * ProjectGroup — slim collapsible project row for the inbox right-rail
 * WORK tab (spec § 6.3).
 *
 * Header anatomy:
 *   ▸ Project name           [STAGE]   3/8     [OPEN ↗]
 *
 * Expanded (32px-padded task list):
 *   ☐ Task one                       Reed · Apr 26
 *   ☑ Task two                       You · Apr 24
 *   ◉ Task three                     You · TODAY 17:00
 *
 * INTENTIONALLY DIFFERENT from src/components/ops/inbox/context-rail/project-card.tsx,
 * which has its own accounting bar, invoice/estimate rows, and is consumed
 * by /projects + /portal/home. project-card.tsx stays untouched.
 *
 * Linked-to-thread state: when `project.threadId === currentThreadId`,
 * the row paints a 2px ops-accent left bar + a faint accent tint. Mirrors
 * the indicator on <PipelineList> opportunity rows.
 */

import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { StateTag, type StateTagTone } from "../state-tag";

/** Compact task wire shape the group renders. Mirrors ClientTaskRow but
 *  keeps the dependency surface small for tests. */
export interface ProjectGroupTask {
  id: string;
  label: string;
  /** Display name of the assignee — "You" gets text-text-2, else text-text-3. */
  assignee: string;
  /** Pre-formatted due string. "TODAY 17:00" / "Apr 26" / "—". */
  due: string;
  status: "todo" | "active" | "done";
  overdue: boolean;
}

/** Stage tone display — drives the [STAGE] tag color + label per spec § 6.3. */
export interface ProjectGroupStage {
  /** Visible label inside the bracketed StateTag (e.g. "ACTIVE", "QUOTED"). */
  label: string;
  /** Tone token for the StateTag. */
  tone: StateTagTone;
}

export interface ProjectGroupProject {
  id: string;
  name: string;
  stage: ProjectGroupStage;
  /** Owning thread id when linked. When this matches the current rail thread,
   *  the row gets the accent left-bar treatment. */
  threadId: string | null;
}

interface ProjectGroupProps {
  project: ProjectGroupProject;
  tasks: ProjectGroupTask[];
  /** Current rail thread id — used to derive linked-to-thread state. */
  currentThreadId: string;
  /** Optional click handler for the OPEN button. When omitted the button
   *  renders as a Link to `?project={id}` (preserves SSR-friendly nav). */
  onOpen?: (projectId: string) => void;
  defaultOpen?: boolean;
  className?: string;
}

const TNUM_ZERO = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

export function ProjectGroup({
  project,
  tasks,
  currentThreadId,
  onOpen,
  defaultOpen = false,
  className,
}: ProjectGroupProps) {
  const { t } = useDictionary("inbox");
  const [open, setOpen] = useState(defaultOpen);
  const linked = project.threadId === currentThreadId && project.threadId !== null;

  const total = tasks.length;
  // NOTE: useClientTasks currently strips Completed tasks before returning,
  // so `done` is effectively always 0 here. Total reflects open work, not
  // historical done count. Product team to revisit when 'done' semantics
  // for the rail are decided. See use-client-tasks.ts line 95.
  const done = tasks.filter((task) => task.status === "done").length;

  const ChevronIcon = open ? ChevronDown : ChevronRight;

  return (
    <div
      data-testid={`project-group-${project.id}`}
      data-current={linked ? "true" : "false"}
      className={cn(
        "relative rounded-[5px] border border-line bg-inbox-panel",
        linked && "bg-ops-accent/[0.04]",
        className,
      )}
    >
      {linked && (
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-[2px] bg-ops-accent"
        />
      )}

      {/* Header row */}
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={
            open
              ? `Collapse ${project.name}`
              : `Expand ${project.name}`
          }
          className="flex shrink-0 items-center justify-center text-text-3 transition-colors hover:text-text-2"
        >
          <ChevronIcon
            aria-hidden
            className="h-3.5 w-3.5"
            strokeWidth={1.5}
          />
        </button>

        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="min-w-0 flex-1 truncate text-left font-mohave text-[13px] font-medium text-text"
        >
          {project.name}
        </button>

        <StateTag
          tone={project.stage.tone}
          variant="solid"
          prefix={project.stage.label}
          bracketed
        />

        <span
          className="shrink-0 font-mono text-[11px] text-text-mute"
          style={TNUM_ZERO}
        >
          {done}/{total}
        </span>

        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(project.id)}
            aria-label={`Open project ${project.name}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-line bg-transparent px-1.5 py-[2px] font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-2 transition-colors hover:bg-inbox-elev"
          >
            {t("rail.openButton", "OPEN")}
            <ExternalLink
              aria-hidden
              className="h-3 w-3"
              strokeWidth={1.5}
            />
          </button>
        ) : (
          <Link
            href={`?project=${project.id}`}
            aria-label={`Open project ${project.name}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-line bg-transparent px-1.5 py-[2px] font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-2 transition-colors hover:bg-inbox-elev"
          >
            {t("rail.openButton", "OPEN")}
            <ExternalLink
              aria-hidden
              className="h-3 w-3"
              strokeWidth={1.5}
            />
          </Link>
        )}
      </div>

      {/* Expanded task list */}
      {open && (
        <ul
          data-testid={`project-group-${project.id}-tasks`}
          className="border-t border-line/50 bg-surface-hover-subtle py-1"
        >
          {tasks.length === 0 ? (
            <li className="pl-8 pr-3.5 py-1.5 font-mono text-[11px] text-text-3">
              {t("rail.empty.tasks", "No tasks for this thread")}
            </li>
          ) : (
            tasks.map((task) => {
              const checked = task.status === "done";
              const active = task.status === "active";
              return (
                <li
                  key={task.id}
                  className="flex items-center gap-2.5 pl-8 pr-3.5 py-1.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-3 w-3 shrink-0 items-center justify-center rounded-[2px] border-[1.25px]",
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
                  <span
                    className={cn(
                      "flex-1 truncate font-mohave text-[12px]",
                      checked
                        ? "text-text-mute line-through"
                        : active
                          ? "text-text"
                          : "text-text-2",
                    )}
                  >
                    {task.label}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[11px] uppercase tracking-[0.10em]",
                      task.overdue
                        ? "text-rose"
                        : task.assignee.toLowerCase() === "you"
                          ? "text-text-2"
                          : "text-text-3",
                    )}
                    style={TNUM_ZERO}
                  >
                    {task.assignee} · {task.due}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
