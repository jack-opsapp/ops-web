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
import { useClients } from "@/lib/hooks/use-clients";
import { matchesAllTokens } from "@/lib/utils/search";
import { cn } from "@/lib/utils/cn";
import type { OpportunityCellSaveState } from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import { CellRelation } from "./cell-relation";

/**
 * Inline client picker for the pipeline `client` column. Mirrors
 * {@link EditableCellAssignee}'s popover idiom exactly — trigger renders the
 * linked client's name (or "—" when unlinked), opening a searchable
 * `role="listbox"` of the company's clients plus a "No client" option that
 * unlinks. Selecting commits the client id (or `null`). Click-outside
 * (`mousedown`) and Escape close; `glass-dense` panel, borders only.
 *
 * Clients load lazily (only while open) via {@link useClients}, keeping the
 * closed cell cheap across a virtualized table. The search uses the shared
 * token-AND grammar (`lib/utils/search`) so multi-word queries match like
 * every other list surface.
 */
export function EditableCellClient({
  clientId,
  clientName,
  saveState,
  editing,
  onBeginEdit,
  onCancelEdit,
  onCommit,
}: {
  clientId: string | null;
  clientName: string | null;
  saveState: OpportunityCellSaveState;
  editing?: boolean;
  onBeginEdit?: () => void;
  onCancelEdit?: () => void;
  onCommit: (clientId: string | null) => Promise<void> | void;
}) {
  const { t } = useDictionary("pipeline");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const open = editing ?? internalOpen;

  const clientsQuery = useClients(undefined, {
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const clients = useMemo(() => {
    const source = (clientsQuery.data?.clients ?? [])
      .filter((client) => !client.deletedAt)
      .map((client) => ({ id: client.id, name: client.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!search.trim()) return source;
    return source.filter((client) =>
      matchesAllTokens(client.name.toLowerCase(), search),
    );
  }, [clientsQuery.data?.clients, search]);

  // Focus + click-outside subscribe ONCE per open→close transition (deps:
  // [open]); the listener reads the latest close handler through a ref —
  // identical to the assignee cell's effect scoping.
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
    nextClientId: string | null,
  ) {
    event.preventDefault();
    event.stopPropagation();
    await onCommit(nextClientId);
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
        aria-label={t("table.cell.client.triggerLabel")}
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
        <CellRelation value={clientName} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t("table.cell.client.title")}
          className="glass-dense absolute left-0 top-full z-[1000] mt-1 w-[280px] rounded-modal border border-border p-2"
        >
          <label className="flex h-7 items-center gap-1.5 rounded border border-border bg-surface-input px-2 focus-within:ring-1 focus-within:ring-ops-accent">
            <Search className="h-3 w-3 shrink-0 text-text-3" strokeWidth={1.5} />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("table.cell.client.search")}
              className="min-w-0 flex-1 bg-transparent font-mono text-micro uppercase text-text outline-none placeholder:text-text-3"
            />
          </label>

          <div
            role="listbox"
            aria-label={t("table.cell.client.title")}
            className="mt-2 max-h-[220px] overflow-auto"
          >
            <button
              type="button"
              role="option"
              aria-selected={clientId == null}
              onClick={(event) => {
                void handleSelect(event, null);
              }}
              className={cn(
                "flex h-8 w-full min-w-0 items-center gap-2 rounded px-2 text-left font-mono text-micro uppercase transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                clientId == null ? "bg-surface-active text-text" : "text-text-2",
              )}
            >
              <span className="w-3 shrink-0">
                {clientId == null ? <Check className="h-3 w-3" strokeWidth={1.5} /> : null}
              </span>
              <span className="truncate">{t("table.cell.client.none")}</span>
            </button>

            {clients.map((client) => {
              const selected = client.id === clientId;
              return (
                <button
                  key={client.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={(event) => {
                    void handleSelect(event, client.id);
                  }}
                  className={cn(
                    "flex h-8 w-full min-w-0 items-center gap-2 rounded px-2 text-left font-mono text-micro uppercase transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                    selected ? "bg-surface-active text-text" : "text-text-2",
                  )}
                >
                  <span className="w-3 shrink-0">
                    {selected ? <Check className="h-3 w-3" strokeWidth={1.5} /> : null}
                  </span>
                  <span className="truncate">{client.name}</span>
                </button>
              );
            })}

            {clients.length === 0 ? (
              <p className="px-2 py-2 font-mono text-micro uppercase tracking-[0.16em] text-text-3">
                {t("table.cell.client.empty")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
