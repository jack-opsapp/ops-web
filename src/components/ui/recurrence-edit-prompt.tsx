"use client";

/**
 * RecurrenceEditPrompt — Phase 3
 *
 * Modal that asks the user how broadly to apply an edit on a recurring task.
 * Returns the chosen scope through `onScope`. Used by:
 *   - Task detail panel rule changes (TASK 13)
 *   - Drag-end handlers in month / crew views (TASK 15)
 *
 * Layered at z-modal=3000 via Radix AlertDialog portal. Uses .glass-dense
 * tokens from `.interface-design/system.md`.
 *
 * Imperative mode: caller can also use `useRecurrenceEditPrompt()` to await
 * a scope choice as a Promise — handy from drag handlers that already run
 * inside async mutation logic.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { RecurrenceEditScope } from "@/lib/types/models";

// ─── Component ──────────────────────────────────────────────────────────────

export interface RecurrenceEditPromptProps {
  open: boolean;
  /**
   * Called when the user selects a scope OR cancels (null on cancel).
   */
  onScope: (scope: RecurrenceEditScope | null) => void;
  /**
   * Optional title override. Defaults to "// EDIT RECURRING TASK".
   */
  title?: string;
  /**
   * Optional one-line description shown below the title.
   */
  description?: string;
}

const SCOPE_OPTIONS: Array<{
  value: RecurrenceEditScope;
  label: string;
  hint: string;
}> = [
  {
    value: "this",
    label: "// EDIT THIS OCCURRENCE",
    hint: "Apply only to this date.",
  },
  {
    value: "this_and_following",
    label: "// THIS AND FOLLOWING",
    hint: "Edit from here forward — earlier occurrences are unchanged.",
  },
  {
    value: "all",
    label: "// ENTIRE SERIES",
    hint: "Update every past, present, and future occurrence.",
  },
];

export function RecurrenceEditPrompt({
  open,
  onScope,
  title = "// EDIT RECURRING TASK",
  description = "This task is part of a recurring series. Choose what to update.",
}: RecurrenceEditPromptProps) {
  // Focus the default ("// EDIT THIS OCCURRENCE") when opening.
  const defaultRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => defaultRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onScope(null);
      }}
    >
      <AlertDialogContent>
        <div className="flex flex-col gap-[12px]">
          <AlertDialogTitle className="font-cakemono font-light uppercase text-[15px] tracking-[0.04em]">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription
            className="font-mohave text-[14px]"
            style={{ color: "var(--text-2)" }}
          >
            {description}
          </AlertDialogDescription>

          <div className="flex flex-col gap-[6px]">
            {SCOPE_OPTIONS.map((opt, i) => (
              <button
                key={opt.value}
                ref={i === 0 ? defaultRef : null}
                type="button"
                onClick={() => onScope(opt.value)}
                className="text-left px-[12px] py-[10px] rounded-[5px] transition-colors"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--line)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(255,255,255,0.08)";
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "rgba(255,255,255,0.18)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(255,255,255,0.04)";
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "var(--line)";
                }}
              >
                <span
                  className="block font-cakemono font-light uppercase tracking-wider"
                  style={{ fontSize: 13, color: "var(--text)" }}
                >
                  {opt.label}
                </span>
                <span
                  className="block font-mohave mt-[2px]"
                  style={{ fontSize: 12, color: "var(--text-3)" }}
                >
                  {opt.hint}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onScope(null)}
            className="self-start px-[6px] py-[2px] font-mono uppercase tracking-wider transition-colors"
            style={{
              fontSize: 11,
              color: "var(--text-3)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = "var(--text-3)";
            }}
          >
            [ CANCEL ]
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Imperative hook ────────────────────────────────────────────────────────

interface PromptControl {
  /** Mount this in your tree (e.g. inside the calendar layout). */
  promptElement: React.ReactElement;
  /** Awaits the user's choice. Resolves to null on cancel. */
  request: (init?: {
    title?: string;
    description?: string;
  }) => Promise<RecurrenceEditScope | null>;
}

export function useRecurrenceEditPrompt(): PromptControl {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<{
    title?: string;
    description?: string;
  }>({});
  const resolverRef = useRef<
    ((scope: RecurrenceEditScope | null) => void) | null
  >(null);

  const request = useCallback(
    (init?: { title?: string; description?: string }) =>
      new Promise<RecurrenceEditScope | null>((resolve) => {
        setOverrides(init ?? {});
        resolverRef.current = resolve;
        setOpen(true);
      }),
    []
  );

  const handleScope = useCallback((scope: RecurrenceEditScope | null) => {
    setOpen(false);
    const resolver = resolverRef.current;
    resolverRef.current = null;
    if (resolver) resolver(scope);
  }, []);

  const promptElement = (
    <RecurrenceEditPrompt
      open={open}
      onScope={handleScope}
      title={overrides.title}
      description={overrides.description}
    />
  );

  return { promptElement, request };
}
