"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { OpportunityCellSaveState } from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import { CellCurrency } from "./cell-currency";

/**
 * Inline-editable currency cell for the pipeline `value` column. Mirrors the
 * projects-table editable-text idiom (begin/cancel/commit, `skipBlurRef` +
 * `committingRef`, commit on Enter/blur, Escape cancels, save-state styling) but
 * swaps the text input for a numeric entry that parses to `number | null` on
 * commit. The read (non-editing) state renders the shared {@link CellCurrency}.
 *
 * Empty or non-numeric input commits as `null` (clears the field) — matching the
 * hook's `toEstimatedValue` coercion, so the displayed value and the persisted
 * value never diverge.
 */

/** Normalize a raw numeric draft to `number | null`. Empty / NaN → null. */
function normalizeNumericDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Seed the input with the raw number (no currency formatting) so the user edits a clean value. */
function valueToDraft(value: number | null): string {
  return value == null ? "" : String(value);
}

function valuesMatch(left: number | null, right: number | null): boolean {
  return (left ?? null) === (right ?? null);
}

export function EditableCellCurrency({
  value,
  saveState,
  onCommit,
  editing,
  onBeginEdit,
  onCancelEdit,
}: {
  value: number | null;
  saveState: OpportunityCellSaveState;
  onCommit: (value: number | null) => Promise<void> | void;
  editing?: boolean;
  onBeginEdit?: () => void;
  onCancelEdit?: () => void;
}) {
  const { t } = useDictionary("pipeline");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurRef = useRef(false);
  const committingRef = useRef(false);
  const [internalEditing, setInternalEditing] = useState(false);
  const [draft, setDraft] = useState(() => valueToDraft(value));
  const isEditing = editing ?? internalEditing;
  const label = t("table.column.value");

  useEffect(() => {
    if (isEditing) {
      setDraft(valueToDraft(value));
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing, value]);

  function beginEdit() {
    onBeginEdit?.();
    if (editing == null) setInternalEditing(true);
  }

  function cancelEdit() {
    setDraft(valueToDraft(value));
    onCancelEdit?.();
    if (editing == null) setInternalEditing(false);
  }

  async function commitDraft() {
    if (committingRef.current) return;
    const nextValue = normalizeNumericDraft(draft);
    committingRef.current = true;
    if (valuesMatch(value, nextValue)) {
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
        type="text"
        inputMode="decimal"
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
          "h-[28px] w-full min-w-0 rounded-[5px] border border-border bg-surface-input px-2 text-right font-mono tabular-nums text-text outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
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
        "flex h-full w-full min-w-0 items-center justify-end rounded-[5px] px-1 text-right outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent",
        saveState === "saving" && "opacity-70",
        saveState === "saved" && "bg-surface-active",
      )}
    >
      <CellCurrency value={value} />
    </button>
  );
}
