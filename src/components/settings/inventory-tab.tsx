"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2, Package } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";

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
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
        </CardContent>
      </Card>
    );
  }

  const sortedUnits = [...(units ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="w-[16px] h-[16px] text-text-secondary" />
            <CardTitle>{t("inventory.unitsTitle")}</CardTitle>
          </div>
          <p className="font-kosugi text-[11px] text-text-disabled mt-1">
            {t("inventory.unitsDescription")}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Add new unit */}
          <div className="flex gap-2">
            <Input
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder={t("inventory.unitPlaceholder")}
              className="flex-1 h-[32px]"
            />
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!newUnitName.trim() || createUnit.isPending}
            >
              <Plus className="w-[14px] h-[14px] mr-1" />
              {t("inventory.addUnit")}
            </Button>
          </div>

          {/* Unit list */}
          {sortedUnits.length === 0 ? (
            <p className="font-kosugi text-[11px] text-text-disabled py-4 text-center">
              {t("inventory.noUnits")}
            </p>
          ) : (
            <div className="space-y-1">
              {sortedUnits.map((unit) => (
                <div
                  key={unit.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded border border-border bg-background-input"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mohave text-body text-text-primary">{unit.display}</span>
                    {unit.isDefault && (
                      <span className="font-kosugi text-[10px] text-ops-accent bg-ops-accent-muted px-1.5 py-0.5 rounded">
                        {t("inventory.default")}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(unit.id, unit.display)}
                    disabled={deleteUnit.isPending}
                    className="text-text-disabled hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 className="w-[14px] h-[14px]" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
