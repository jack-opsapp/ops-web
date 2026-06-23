"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { OpportunityCellSaveState } from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import { CellDate } from "./cell-date";

/**
 * Inline-editable date cell for the pipeline `next_follow_up` and
 * `expected_close` columns. Mirrors the projects-table editable-date idiom
 * almost verbatim: an `<input type="date">` whose value is the ISO/yyyy-mm-dd
 * string, commit on Enter/blur, Escape cancels, save-state styling. The read
 * (non-editing) state renders the shared {@link CellDate}.
 *
 * The native date input expects a `yyyy-mm-dd` value; the row's ISO date string
 * round-trips through it cleanly (the adapter serializes dates to ISO). Empty
 * commits as `null` (clears the field).
 */

const DATE_LABEL_KEYS = {
  next_follow_up: "table.column.next_follow_up",
  expected_close: "table.column.expected_close",
} as const;

/** Coerce an ISO date string to the `yyyy-mm-dd` the native date input expects. */
function toDateInputValue(value: string | null): string {
  if (!value) return "";
  // Already date-only — pass straight through.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function EditableCellDate({
  value,
  columnId,
  saveState,
  onCommit,
  editing,
  onBeginEdit,
  onCancelEdit,
  overdue = false,
}: {
  value: string | null;
  columnId: "next_follow_up" | "expected_close";
  saveState: OpportunityCellSaveState;
  onCommit: (value: string | null) => Promise<void> | void;
  editing?: boolean;
  onBeginEdit?: () => void;
  onCancelEdit?: () => void;
  /**
   * Aging/triage signal for the read (non-editing) state. When the date has
   * passed on a still-active deal, the read display renders the rose `[OVERDUE]`
   * emphasis; the edit input itself stays neutral.
   */
  overdue?: boolean;
}) {
  const { t } = useDictionary("pipeline");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurRef = useRef(false);
  const committingRef = useRef(false);
  const [internalEditing, setInternalEditing] = useState(false);
  const [draft, setDraft] = useState(() => toDateInputValue(value));
  const isEditing = editing ?? internalEditing;
  const label = t(DATE_LABEL_KEYS[columnId]);

  useEffect(() => {
    if (isEditing) {
      setDraft(toDateInputValue(value));
      inputRef.current?.focus();
    }
  }, [isEditing, value]);

  function beginEdit() {
    onBeginEdit?.();
    if (editing == null) setInternalEditing(true);
  }

  function cancelEdit() {
    setDraft(toDateInputValue(value));
    onCancelEdit?.();
    if (editing == null) setInternalEditing(false);
  }

  async function commitDraft() {
    if (committingRef.current) return;
    const nextValue = draft.trim() || null;
    committingRef.current = true;
    if ((toDateInputValue(value) || "") === (nextValue ?? "")) {
      skipBlurRef.current = true;
      cancelEdit();
      committingRef.current = false;
      return;
    }

    try {
      await onCommit(nextValue);
      skipBlurRef.current = true;
      onCancelEdit?.();
      if (editing == null) setInternalEditing(false);
    } finally {
      committingRef.current = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      skipBlurRef.current = true;
      cancelEdit();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void commitDraft();
    }
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        aria-label={label}
        type="date"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          void commitDraft();
        }}
        className={cn(
          "h-[28px] w-full min-w-0 rounded border border-border bg-surface-input px-2 font-mono tabular-nums text-text outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
          saveState === "saving" && "opacity-70",
        )}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={beginEdit}
      className={cn(
        "flex h-full w-full min-w-0 items-center rounded px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent",
        saveState === "saving" && "opacity-70",
        saveState === "saved" && "bg-surface-active",
      )}
    >
      <CellDate
        value={value}
        overdue={overdue}
        signalKind={columnId === "expected_close" ? "close" : "follow_up"}
      />
    </button>
  );
}
