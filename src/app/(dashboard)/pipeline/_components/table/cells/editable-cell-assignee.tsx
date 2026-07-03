"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { EntityPicker } from "@/components/ui/entity-picker";
import { useDictionary } from "@/i18n/client";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { getUserFullName } from "@/lib/types/models";
import { cn } from "@/lib/utils/cn";
import type { OpportunityCellSaveState } from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import { CellAssignee } from "./cell-assignee";

interface MemberLite {
  id: string;
  name: string;
}

/**
 * Inline owner picker for the pipeline `assignee` column, on the canonical
 * {@link EntityPicker} (previously a hand-rolled popover — the Picker kit
 * docstring mandates the shared shell, and the sibling client cell + the
 * projects table already use it). Same controlled-edit contract as every
 * grid cell; the "Unassigned" row clears the field. Team members load
 * lazily (only while open) via {@link useTeamMembers}.
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
  const { t: tp } = useDictionary("picker");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = editing ?? internalOpen;

  const teamQuery = useTeamMembers(undefined, {
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const members = useMemo<MemberLite[]>(
    () =>
      (teamQuery.data?.users ?? [])
        .filter((user) => user.isActive !== false)
        .map((user) => ({ id: user.id, name: getUserFullName(user) })),
    [teamQuery.data?.users],
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

  const trigger = (
    <button
      type="button"
      aria-label={t("table.cell.assignee.triggerLabel")}
      onClick={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
      className={cn(
        "flex h-full w-full min-w-0 items-center rounded px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent",
        saveState === "saving" && "opacity-70",
        saveState === "saved" && "bg-surface-active",
      )}
    >
      <CellAssignee name={assigneeName} />
    </button>
  );

  return (
    <EntityPicker<MemberLite>
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      label={t("table.cell.assignee.title")}
      items={members}
      value={assigneeId}
      onChange={handleChange}
      getId={(member) => member.id}
      getLabel={(member) => member.name}
      clearLabel={tp("clear")}
      searchPlaceholder={t("table.cell.assignee.search")}
      emptyLabel={t("table.cell.assignee.empty")}
      noneOption
      noneLabel={t("table.cell.assignee.unassigned")}
    />
  );
}
