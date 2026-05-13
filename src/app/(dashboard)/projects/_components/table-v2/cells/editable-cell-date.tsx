"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableSaveState } from "@/lib/hooks/projects-table/use-cell-edit";
import { CellDate } from "./cell-date";

const DATE_LABEL_KEYS = {
  start_date: "table.column.startDate",
  end_date: "table.column.endDate",
} as const;

export function EditableCellDate({
  value,
  columnId,
  saveState,
  onCommit,
  editing,
  onBeginEdit,
  onCancelEdit,
}: {
  value: string | null;
  columnId: "start_date" | "end_date";
  saveState: ProjectTableSaveState;
  onCommit: (value: string | null) => Promise<void> | void;
  editing?: boolean;
  onBeginEdit?: () => void;
  onCancelEdit?: () => void;
}) {
  const { t } = useDictionary("projects");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurRef = useRef(false);
  const committingRef = useRef(false);
  const [internalEditing, setInternalEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const isEditing = editing ?? internalEditing;
  const label = t(DATE_LABEL_KEYS[columnId]);

  useEffect(() => {
    if (isEditing) {
      setDraft(value ?? "");
      inputRef.current?.focus();
    }
  }, [isEditing, value]);

  function beginEdit() {
    onBeginEdit?.();
    if (editing == null) setInternalEditing(true);
  }

  function cancelEdit() {
    setDraft(value ?? "");
    onCancelEdit?.();
    if (editing == null) setInternalEditing(false);
  }

  async function commitDraft() {
    if (committingRef.current) return;
    const nextValue = draft.trim() || null;
    committingRef.current = true;
    if ((value ?? "") === (nextValue ?? "")) {
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
          "h-[28px] w-full min-w-0 rounded-[5px] border border-border bg-surface-input px-2 font-mono text-text outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
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
        "flex h-full w-full min-w-0 items-center rounded-[5px] px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent",
        saveState === "saving" && "opacity-70",
        saveState === "saved" && "bg-surface-active",
      )}
    >
      <CellDate value={value} />
    </button>
  );
}
