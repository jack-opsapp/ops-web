"use client";

/**
 * Task Materials section — renders inside the calendar task detail
 * side panel. Shows task_materials (editable quantities + source),
 * supports add/remove rows, and reveals the inventory_deducted
 * state so crews know whether stock has been pulled yet.
 */

import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  useTaskMaterials,
  useSetTaskMaterials,
} from "@/lib/hooks";
import { useInventoryItems } from "@/lib/hooks/use-inventory";
import type { InventoryItem } from "@/lib/types/inventory";
import type {
  CreateTaskMaterial,
  MaterialSource,
} from "@/lib/types/product-materials";
import { toast } from "sonner";

interface Row {
  inventoryItemId: string;
  quantity: number;
  source: MaterialSource;
}

interface Props {
  taskId: string;
  inventoryDeducted: boolean;
}

export function TaskMaterialsSection({ taskId, inventoryDeducted }: Props) {
  const { data: materials = [], isLoading } = useTaskMaterials(taskId);
  const { data: inventory = [] } = useInventoryItems();
  const setMaterials = useSetTaskMaterials();

  const activeInventory = useMemo<InventoryItem[]>(
    () => inventory.filter((i: InventoryItem) => !i.deletedAt),
    [inventory]
  );

  const itemMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    activeInventory.forEach((i) => map.set(i.id, i));
    return map;
  }, [activeInventory]);

  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setRows(
      materials.map((m) => ({
        inventoryItemId: m.inventoryItemId,
        quantity: m.quantity,
        source: m.source,
      }))
    );
    setDirty(false);
  }, [materials]);

  const locked = inventoryDeducted;

  const addRow = () => {
    const firstUnused = activeInventory.find(
      (i) => !rows.some((r) => r.inventoryItemId === i.id)
    );
    if (!firstUnused) return;
    setRows((prev) => [
      ...prev,
      { inventoryItemId: firstUnused.id, quantity: 1, source: "stock" },
    ]);
    setDirty(true);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const handleSave = async () => {
    const payload: CreateTaskMaterial[] = rows
      .filter((r) => r.inventoryItemId && r.quantity > 0)
      .map((r) => ({
        taskId,
        inventoryItemId: r.inventoryItemId,
        quantity: r.quantity,
        source: r.source,
      }));

    try {
      await setMaterials.mutateAsync({ taskId, materials: payload });
      toast.success("Materials saved");
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save materials");
    }
  };

  return (
    <div className="space-y-[6px]">
      {locked && (
        <span className="block font-mono text-micro uppercase tracking-[0.08em] text-[#999999]">
          [deducted — reopen task to edit]
        </span>
      )}

      {isLoading ? (
        <span className="font-mono text-micro text-[#666666]">loading...</span>
      ) : rows.length === 0 ? (
        <span className="font-mono text-micro uppercase text-[#666666]">
          [no materials]
        </span>
      ) : (
        <div className="space-y-[4px]">
          {rows.map((row, idx) => {
            const item = itemMap.get(row.inventoryItemId);
            return (
              <div
                key={`${row.inventoryItemId}-${idx}`}
                className="grid grid-cols-[1fr_56px_56px_20px] gap-[4px] items-center"
              >
                <select
                  value={row.inventoryItemId}
                  onChange={(e) => updateRow(idx, { inventoryItemId: e.target.value })}
                  disabled={locked}
                  className="px-[6px] py-[4px] rounded-panel font-mohave text-[11px] text-white disabled:opacity-60"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  {item && !itemMap.has(row.inventoryItemId) && (
                    <option value={row.inventoryItemId}>unknown</option>
                  )}
                  {activeInventory.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  step={0.0001}
                  value={row.quantity}
                  onChange={(e) =>
                    updateRow(idx, { quantity: parseFloat(e.target.value) || 0 })
                  }
                  disabled={locked}
                  className="px-[6px] py-[4px] rounded-panel text-right font-mono text-[11px] text-white disabled:opacity-60"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                />
                <select
                  value={row.source}
                  onChange={(e) =>
                    updateRow(idx, { source: e.target.value as MaterialSource })
                  }
                  disabled={locked}
                  className="px-[4px] py-[4px] rounded-panel font-mono text-micro uppercase text-[#999999] disabled:opacity-60"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <option value="stock">stock</option>
                  <option value="order">order</option>
                </select>
                <button
                  onClick={() => removeRow(idx)}
                  disabled={locked}
                  className="p-[2px] text-[#666666] hover:text-[#C24F4F] transition-colors disabled:opacity-30"
                  aria-label="Remove material"
                >
                  <Trash2 className="w-[11px] h-[11px]" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!locked && (
        <div className="flex items-center justify-between pt-[2px]">
          <button
            onClick={addRow}
            disabled={activeInventory.length === 0}
            className="flex items-center gap-[4px] font-mono text-micro uppercase tracking-[0.08em] text-[#999999] hover:text-white transition-colors disabled:opacity-40"
          >
            <Plus className="w-[11px] h-[11px]" />
            Add material
          </button>
          {dirty && (
            <button
              onClick={handleSave}
              disabled={setMaterials.isPending}
              className="px-[8px] py-[4px] rounded-panel font-mono text-micro uppercase tracking-[0.08em] text-white transition-colors"
              style={{
                backgroundColor: "#6F94B0",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              {setMaterials.isPending ? "Saving..." : "Save"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
