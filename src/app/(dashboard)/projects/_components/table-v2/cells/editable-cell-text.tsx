"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableSaveState } from "@/lib/hooks/projects-table/use-cell-edit";
import type { ProjectTableEditableColumnId } from "@/lib/types/project-table";
import { CellText } from "./cell-text";

const TEXT_LABEL_KEYS: Partial<Record<ProjectTableEditableColumnId, string>> = {
  name: "table.column.name",
  address: "table.column.address",
};

function normalizeTextValue(value: string, required: boolean): string | null {
  const trimmed = value.trim();
  if (!trimmed && !required) return null;
  return trimmed;
}

function valuesMatch(left: string | null, right: string | null) {
  return (left ?? "") === (right ?? "");
}

export function EditableCellText({
  value,
  columnId,
  required = false,
  saveState,
  onCommit,
  editing,
  onBeginEdit,
  onCancelEdit,
}: {
  value: string | null;
  columnId: ProjectTableEditableColumnId;
  required?: boolean;
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
  const [invalid, setInvalid] = useState(false);
  const isEditing = editing ?? internalEditing;
  const label = t(TEXT_LABEL_KEYS[columnId] ?? "detail.project");

  useEffect(() => {
    if (isEditing) {
      setDraft(value ?? "");
      setInvalid(false);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing, value]);

  function beginEdit() {
    onBeginEdit?.();
    if (editing == null) setInternalEditing(true);
  }

  function cancelEdit() {
    setDraft(value ?? "");
    setInvalid(false);
    onCancelEdit?.();
    if (editing == null) setInternalEditing(false);
  }

  async function commitDraft() {
    if (committingRef.current) return;
    const nextValue = normalizeTextValue(draft, required);
    if (required && !nextValue) {
      setInvalid(true);
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

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
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (invalid) setInvalid(false);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          void commitDraft();
        }}
        className={cn(
          "h-[28px] w-full min-w-0 rounded-[5px] border border-border bg-surface-input px-2 font-mohave text-text outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
          invalid && "border-rose text-rose",
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
        "flex h-full w-full min-w-0 items-center rounded-[5px] px-[4px] text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent",
        saveState === "saving" && "opacity-70",
        saveState === "saved" && "bg-surface-active",
      )}
    >
      <CellText value={value} className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" />
    </button>
  );
}
