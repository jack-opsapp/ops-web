"use client";

import { useCallback, useState, type MouseEvent } from "react";
import { EntityPicker } from "@/components/ui/entity-picker";
import { useDictionary } from "@/i18n/client";
import { useClients } from "@/lib/hooks/use-clients";
import { useClientCreateAction } from "@/lib/hooks/use-client-create-action";
import { useAuthStore } from "@/lib/store/auth-store";
import type { ProjectTableSaveState } from "@/lib/hooks/projects-table/use-cell-edit";
import type { ProjectTableClientEditValue } from "@/lib/types/project-table";
import { cn } from "@/lib/utils/cn";
import { CellText } from "./cell-text";

interface ClientLite {
  id: string;
  name: string;
}

/**
 * EditableCellClient — single-select client picker for a project row.
 *
 * Built on EntityPicker (portaled, real focus + outside-click) — replaces the
 * hand-rolled absolute div + manual mousedown listener. Preserves the table's
 * controlled-edit contract (`editing` / `onBeginEdit` / `onCancelEdit` /
 * `onCommit`) and the saving/saved trigger states. Selecting commits + closes;
 * the "—" row clears the client.
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
  saveState: ProjectTableSaveState;
  editing?: boolean;
  onBeginEdit?: () => void;
  onCancelEdit?: () => void;
  onCommit: (value: ProjectTableClientEditValue) => Promise<void> | void;
}) {
  const { t } = useDictionary("projects");
  const { t: tp } = useDictionary("picker");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = editing ?? internalOpen;
  const companyId = useAuthStore((state) => state.company?.id ?? "");
  const clientsQuery = useClients(undefined, {
    enabled: open && Boolean(companyId),
    staleTime: 5 * 60 * 1000,
  });
  const clients: ClientLite[] = clientsQuery.data?.clients ?? [];

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
    if (id == null) {
      void onCommit({ clientId: null, clientName: null });
      return;
    }
    const match = clients.find((client) => client.id === id);
    void onCommit({ clientId: id, clientName: match?.name ?? clientName });
  }

  // "+ New client" — create by the typed name and link it to this project row.
  const onCreated = useCallback(
    (id: string, name: string) => {
      void onCommit({ clientId: id, clientName: name });
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
        "flex h-full w-full min-w-0 items-center rounded px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        saveState === "saving" && "opacity-70",
        saveState === "saved" && "bg-surface-active",
      )}
    >
      <CellText value={clientName} className="text-text-2" />
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
      searchPlaceholder={t("table.cell.client.search")}
      clearLabel={tp("clear")}
      emptyLabel={t("table.cell.client.empty")}
      noneOption
      noneLabel="—"
      createAction={createAction}
    />
  );
}
