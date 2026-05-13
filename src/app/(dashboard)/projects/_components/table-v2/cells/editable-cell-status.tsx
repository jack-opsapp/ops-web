"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useDictionary } from "@/i18n/client";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import type { ProjectTableSaveState } from "@/lib/hooks/projects-table/use-cell-edit";
import { cn } from "@/lib/utils/cn";
import { CellStatus } from "./cell-status";

const STATUS_OPTIONS = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
  ProjectStatus.Archived,
] as const;

const STATUS_LABEL_KEYS = {
  [ProjectStatus.RFQ]: "status.rfq",
  [ProjectStatus.Estimated]: "status.estimated",
  [ProjectStatus.Accepted]: "status.accepted",
  [ProjectStatus.InProgress]: "status.inProgress",
  [ProjectStatus.Completed]: "status.completed",
  [ProjectStatus.Closed]: "status.closed",
  [ProjectStatus.Archived]: "status.archived",
} as const;

export function EditableCellStatus({
  status,
  saveState,
  onCommit,
  editing,
  onBeginEdit,
  onCancelEdit,
}: {
  status: ProjectStatus;
  saveState: ProjectTableSaveState;
  onCommit: (status: ProjectStatus) => Promise<void> | void;
  editing?: boolean;
  onBeginEdit?: () => void;
  onCancelEdit?: () => void;
}) {
  const { t } = useDictionary("projects");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = editing ?? internalOpen;
  const statusLabel = t("table.column.status");

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: globalThis.MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  });

  function openMenu() {
    onBeginEdit?.();
    if (editing == null) setInternalOpen(true);
  }

  function closeMenu() {
    onCancelEdit?.();
    if (editing == null) setInternalOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement | HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    }
  }

  async function handleSelect(event: ReactMouseEvent<HTMLButtonElement>, nextStatus: ProjectStatus) {
    event.stopPropagation();
    if (nextStatus === status) {
      closeMenu();
      return;
    }

    await onCommit(nextStatus);
    closeMenu();
  }

  return (
    <div ref={menuRef} className="relative flex h-full w-full min-w-0 items-center" onKeyDown={handleKeyDown}>
      <button
        type="button"
        aria-label={statusLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        className={cn(
          "flex h-full w-full min-w-0 items-center rounded-[5px] px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent",
          saveState === "saving" && "opacity-70",
          saveState === "saved" && "bg-surface-active",
        )}
      >
        <CellStatus status={status} />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={statusLabel}
          className="glass-dense absolute left-0 top-full z-[1000] mt-1 min-w-[156px] rounded-modal border border-border p-1"
        >
          {STATUS_OPTIONS.map((option) => {
            const selected = option === status;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={(event) => {
                  void handleSelect(event, option);
                }}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded-chip px-2 py-1.5 text-left font-mono text-micro uppercase tracking-wider transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                  selected ? "bg-surface-active text-text" : "text-text-2",
                )}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: PROJECT_STATUS_COLORS[option] }}
                />
                <span className="min-w-0 truncate">{t(STATUS_LABEL_KEYS[option])}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
