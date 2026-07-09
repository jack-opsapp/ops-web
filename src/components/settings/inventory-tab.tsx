"use client";

import { useState } from "react";
import { Plus, Trash2, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  RegisterTable,
  RegisterEmpty,
  Tag,
  TablePrimary,
  type RegisterTableColumn,
} from "@/components/ui/register-table";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import type { InventoryUnit } from "@/lib/types/inventory";

// Direct imports since these aren't in the hooks barrel yet
import { useInventoryUnits, useCreateInventoryUnit, useDeleteInventoryUnit } from "@/lib/hooks/use-inventory";

export function InventoryTab() {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const { data: units, isLoading } = useInventoryUnits();
  const createUnit = useCreateInventoryUnit();
  const deleteUnit = useDeleteInventoryUnit();

  const [newUnitName, setNewUnitName] = useState("");

  function handleAdd() {
    const trimmed = newUnitName.trim();
    if (!trimmed) return;

    createUnit.mutate(
      { companyId, display: trimmed },
      {
        onSuccess: () => {
          toast.success(t("inventory.toast.unitAdded"));
          setNewUnitName("");
        },
        onError: (err) => toast.error(t("inventory.toast.unitAddFailed"), { description: err.message }),
      }
    );
  }

  function handleDelete(unitId: string, unitName: string) {
    deleteUnit.mutate(unitId, {
      onSuccess: () => toast.success(`${unitName} ${t("inventory.toast.unitRemoved")}`),
      onError: (err) => toast.error(t("inventory.toast.unitRemoveFailed"), { description: err.message }),
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-[2px] animate-pulse motion-reduce:animate-none">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[56px] rounded-chip bg-surface-input/40 border border-border-subtle"
          />
        ))}
      </div>
    );
  }

  const sortedUnits = [...(units ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const columns: RegisterTableColumn<InventoryUnit>[] = [
    {
      id: "unit",
      header: t("inventory.unitColumn"),
      cell: (unit) => (
        <div className="flex items-center gap-2">
          <TablePrimary>{unit.display}</TablePrimary>
          {unit.isDefault && <Tag variant="dim">{t("inventory.default")}</Tag>}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      className: "w-[1%]",
      cell: (unit) => (
        <button
          type="button"
          onClick={() => handleDelete(unit.id, unit.display)}
          disabled={deleteUnit.isPending}
          aria-label={t("inventory.removeUnit")}
          className="text-text-mute hover:text-rose transition-colors p-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-[14px] h-[14px]" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-3 max-w-3xl">
      <Card>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Package className="w-[16px] h-[16px] text-text-3" />
            <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
              <span className="text-text-mute">{"// "}</span>
              {t("inventory.unitsTitle")}
            </span>
          </div>
          <p className="font-mono text-[11px] text-text-mute">
            {t("inventory.unitsDescription")}
          </p>

          {/* Add new unit */}
          <div className="flex gap-2">
            <Input
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder={t("inventory.unitPlaceholder")}
              className="flex-1"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleAdd}
              disabled={!newUnitName.trim() || createUnit.isPending}
              className="gap-1"
            >
              <Plus className="w-[14px] h-[14px]" />
              {t("inventory.addUnit")}
            </Button>
          </div>

          {/* Unit list */}
          {sortedUnits.length === 0 ? (
            <RegisterEmpty noun={t("inventory.unitsNoun")} hint={t("inventory.noUnits")} />
          ) : (
            <RegisterTable
              columns={columns}
              rows={sortedUnits}
              getRowId={(unit) => unit.id}
              minWidth={320}
              ariaLabel={t("inventory.unitsTitle")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
