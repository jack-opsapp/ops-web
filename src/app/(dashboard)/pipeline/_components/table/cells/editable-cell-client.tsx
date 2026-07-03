"use client";

import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { EntityPicker } from "@/components/ui/entity-picker";
import { useDictionary } from "@/i18n/client";
import { useClients } from "@/lib/hooks/use-clients";
import { useClientCreateAction } from "@/lib/hooks/use-client-create-action";
import { cn } from "@/lib/utils/cn";
import type { OpportunityCellSaveState } from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import { CellRelation } from "./cell-relation";

interface ClientLite {
  id: string;
  name: string;
}

/**
 * Inline client picker for the pipeline `client` column, on the canonical
 * {@link EntityPicker} (the one component behind client / team / assignee
 * pickers app-wide — same wiring as the projects table's client cell).
 * Preserves the grid's controlled-edit contract (`editing` / `onBeginEdit` /
 * `onCancelEdit` / `onCommit`) and the saving/saved trigger states. Selecting
 * commits + closes; the "No client" row unlinks. Clients load lazily (only
 * while open), keeping the closed cell cheap across a virtualized table.
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
  const { t: tp } = useDictionary("picker");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = editing ?? internalOpen;

  const clientsQuery = useClients(undefined, {
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const clients = useMemo<ClientLite[]>(
    () =>
      (clientsQuery.data?.clients ?? [])
        .filter((client) => !client.deletedAt)
        .map((client) => ({ id: client.id, name: client.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clientsQuery.data?.clients],
  );

  function setOpen(next: boolean) {
    if (next) {
      onBeginEdit?.();
      if (editing == null) setInternalOpen(true);
    } else {
      onCancelEdit?.();
      if (editing == null) setInternalOpen(false);
    }
  }

  function handleChange(id: string | null) {
    void onCommit(id);
  }

  // "+ New client" — create by the typed name and link it (the undo toast the
  // commit raises covers the link, same as picking an existing client).
  const onCreated = useCallback(
    (id: string) => {
      void onCommit(id);
    },
    [onCommit],
  );
  const createAction = useClientCreateAction(onCreated);

  const trigger = (
    <button
      type="button"
      aria-label={t("table.cell.client.triggerLabel")}
      onClick={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
      className={cn(
        "flex h-full w-full min-w-0 items-center rounded px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent",
        saveState === "saving" && "opacity-70",
        saveState === "saved" && "bg-surface-active",
      )}
    >
      <CellRelation value={clientName} />
    </button>
  );

  return (
    <EntityPicker<ClientLite>
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      label={t("table.cell.client.title")}
      items={clients}
      value={clientId}
      onChange={handleChange}
      getId={(client) => client.id}
      getLabel={(client) => client.name}
      clearLabel={tp("clear")}
      searchPlaceholder={t("table.cell.client.search")}
      emptyLabel={t("table.cell.client.empty")}
      noneOption
      noneLabel={t("table.cell.client.none")}
      createAction={createAction}
    />
  );
}
