"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Check, Search } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { getUserFullName } from "@/lib/types/models";
import { cn } from "@/lib/utils/cn";
import type { OpportunityCellSaveState } from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import { CellAssignee } from "./cell-assignee";

/**
 * Inline owner picker for the pipeline `assignee` column. Mirrors the
 * projects-table editable-client popover idiom: a trigger button that renders
 * the current display name (or "—" when unassigned), opening a searchable
 * `role="listbox"` of team members plus an "Unassigned" option that clears the
 * field. Selecting commits the team member's user id (or `null`). Click-outside
 * (`mousedown`) and Escape close the popover; the panel uses `glass-dense` like
 * the client picker — borders only, no box-shadow.
 *
 * Team members load lazily (only while open) via {@link useTeamMembers}, keeping
 * the closed cell cheap across a virtualized table.
 */
export function EditableCellAssignee({
  assigneeId,
  assigneeName,
  saveState,
  editing,
  onBeginEdit,
  onCancelEdit,
  onCommit,
}: {
  assigneeId: string | null;
  assigneeName: string | null;
  saveState: OpportunityCellSaveState;
  editing?: boolean;
  onBeginEdit?: () => void;
  onCancelEdit?: () => void;
  onCommit: (userId: string | null) => Promise<void> | void;
}) {
  const { t } = useDictionary("pipeline");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const open = editing ?? internalOpen;

  const teamQuery = useTeamMembers(undefined, {
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const members = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = (teamQuery.data?.users ?? []).filter((user) => user.isActive !== false);
    const named = source.map((user) => ({ id: user.id, name: getUserFullName(user) }));
    if (!query) return named;
    return named.filter((member) => member.name.toLowerCase().includes(query));
  }, [teamQuery.data?.users, search]);

  // The open-state effect schedules focus + subscribes the click-outside listener
  // ONCE per open→close transition (deps: [open]). Without a dep array it re-ran
  // every render — re-scheduling the focus timeout and churning the listener on
  // each keystroke. `closePopover` closes over `onCancelEdit`/`editing`, so we
  // read the latest copy through a ref (mirrors how `cell-stage-action` scopes
  // its identical `mousedown` effect to `[open]`) — the listener always closes
  // correctly without re-subscribing on every render.
  const closePopoverRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => searchInputRef.current?.focus(), 0);

    function handlePointerDown(event: globalThis.MouseEvent) {
      if (popoverRef.current?.contains(event.target as Node)) return;
      closePopoverRef.current();
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  function openPopover() {
    onBeginEdit?.();
    setSearch("");
    if (editing == null) setInternalOpen(true);
  }

  function closePopover() {
    onCancelEdit?.();
    if (editing == null) setInternalOpen(false);
  }

  closePopoverRef.current = closePopover;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePopover();
    }
  }

  async function handleSelect(
    event: ReactMouseEvent<HTMLButtonElement>,
    userId: string | null,
  ) {
    event.preventDefault();
    event.stopPropagation();
    await onCommit(userId);
    closePopover();
  }

  return (
    <div
      ref={popoverRef}
      className="relative flex h-full w-full min-w-0 items-center"
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-label={t("table.cell.assignee.triggerLabel")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            closePopover();
          } else {
            openPopover();
          }
        }}
        className={cn(
          "flex h-full w-full min-w-0 items-center rounded px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent",
          saveState === "saving" && "opacity-70",
          saveState === "saved" && "bg-surface-active",
        )}
      >
        <CellAssignee name={assigneeName} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t("table.cell.assignee.title")}
          className="glass-dense absolute left-0 top-full z-[1000] mt-1 w-[280px] rounded-modal border border-border p-2"
        >
          <label className="flex h-7 items-center gap-1.5 rounded border border-border bg-surface-input px-2 focus-within:ring-1 focus-within:ring-ops-accent">
            <Search className="h-3 w-3 shrink-0 text-text-3" strokeWidth={1.5} />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("table.cell.assignee.search")}
              className="min-w-0 flex-1 bg-transparent font-mono text-micro uppercase text-text outline-none placeholder:text-text-3"
            />
          </label>

          <div
            role="listbox"
            aria-label={t("table.cell.assignee.title")}
            className="mt-2 max-h-[220px] overflow-auto"
          >
            <button
              type="button"
              role="option"
              aria-selected={assigneeId == null}
              onClick={(event) => {
                void handleSelect(event, null);
              }}
              className={cn(
                "flex h-8 w-full min-w-0 items-center gap-2 rounded px-2 text-left font-mono text-micro uppercase transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                assigneeId == null ? "bg-surface-active text-text" : "text-text-2",
              )}
            >
              <span className="w-3 shrink-0">
                {assigneeId == null ? <Check className="h-3 w-3" strokeWidth={1.5} /> : null}
              </span>
              <span className="truncate">{t("table.cell.assignee.unassigned")}</span>
            </button>

            {members.map((member) => {
              const selected = member.id === assigneeId;
              return (
                <button
                  key={member.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={(event) => {
                    void handleSelect(event, member.id);
                  }}
                  className={cn(
                    "flex h-8 w-full min-w-0 items-center gap-2 rounded px-2 text-left font-mono text-micro uppercase transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                    selected ? "bg-surface-active text-text" : "text-text-2",
                  )}
                >
                  <span className="w-3 shrink-0">
                    {selected ? <Check className="h-3 w-3" strokeWidth={1.5} /> : null}
                  </span>
                  <span className="truncate">{member.name}</span>
                </button>
              );
            })}

            {members.length === 0 ? (
              <p className="px-2 py-2 font-mono text-micro uppercase tracking-[0.16em] text-text-3">
                {t("table.cell.assignee.empty")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
