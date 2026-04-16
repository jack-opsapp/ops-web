"use client";

/**
 * Product BOM Editor — inline section for editing a product's
 * bill-of-materials (product_materials). Self-contained: fetches
 * current BOM, lets the user add/remove/edit material rows, and
 * saves via its own "Save Materials" button.
 */

import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import {
  useProductMaterials,
  useSetProductBom,
} from "@/lib/hooks";
import { useInventoryItems } from "@/lib/hooks/use-inventory";
import type { InventoryItem } from "@/lib/types/inventory";
import type { CreateProductMaterial } from "@/lib/types/product-materials";
import { toast } from "sonner";

interface Row {
  inventoryItemId: string;
  quantityPerUnit: number;
  notes: string;
}

interface ProductBomEditorProps {
  productId: string;
  productUnit?: string;
  className?: string;
}

export function ProductBomEditor({ productId, productUnit, className }: ProductBomEditorProps) {
  const { data: materials = [], isLoading } = useProductMaterials(productId);
  const { data: inventory = [] } = useInventoryItems();
  const setBom = useSetProductBom();

  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setRows(
      materials.map((m) => ({
        inventoryItemId: m.inventoryItemId,
        quantityPerUnit: m.quantityPerUnit,
        notes: m.notes ?? "",
      }))
    );
    setDirty(false);
  }, [materials]);

  const activeInventory = useMemo<InventoryItem[]>(
    () => inventory.filter((i: InventoryItem) => !i.deletedAt),
    [inventory]
  );

  const addRow = () => {
    const firstUnused = activeInventory.find(
      (i) => !rows.some((r) => r.inventoryItemId === i.id)
    );
    setRows((prev) => [
      ...prev,
      {
        inventoryItemId: firstUnused?.id ?? "",
        quantityPerUnit: 1,
        notes: "",
      },
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
    const payload: CreateProductMaterial[] = rows
      .filter((r) => r.inventoryItemId && r.quantityPerUnit > 0)
      .map((r) => ({
        productId,
        inventoryItemId: r.inventoryItemId,
        quantityPerUnit: r.quantityPerUnit,
        notes: r.notes.trim() || null,
      }));

    try {
      await setBom.mutateAsync({ productId, materials: payload });
      toast.success("Materials saved");
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save materials");
    }
  };

  if (activeInventory.length === 0) {
    return (
      <div className={cn("space-y-1", className)}>
        <p className="font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
          Materials / BOM
        </p>
        <p className="font-kosugi text-[10px] text-text-mute">
          [add inventory items first to define a material recipe]
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <p className="font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
          Materials / BOM
        </p>
        <span className="font-kosugi text-[10px] text-text-mute">
          [per 1 {productUnit ?? "unit"}]
        </span>
      </div>

      {isLoading ? (
        <p className="font-kosugi text-[10px] text-text-mute">loading...</p>
      ) : rows.length === 0 ? (
        <p className="font-kosugi text-[10px] text-text-mute">
          [no materials — this product does not deduct inventory]
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((row, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[1fr_80px_80px_28px] gap-1 items-center"
            >
              <select
                value={row.inventoryItemId}
                onChange={(e) => updateRow(idx, { inventoryItemId: e.target.value })}
                className="bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body-sm text-text"
              >
                <option value="">Select item...</option>
                {activeInventory.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                min={0}
                step={0.0001}
                value={row.quantityPerUnit}
                onChange={(e) =>
                  updateRow(idx, { quantityPerUnit: parseFloat(e.target.value) || 0 })
                }
                className="text-right text-sm"
              />
              <Input
                value={row.notes}
                onChange={(e) => updateRow(idx, { notes: e.target.value })}
                placeholder="notes"
                className="text-sm"
              />
              <button
                onClick={() => removeRow(idx)}
                className="p-1 rounded text-text-mute hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                aria-label="Remove material"
              >
                <Trash2 className="w-[14px] h-[14px]" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={addRow}
          className="gap-1 text-text-3"
        >
          <Plus className="w-[12px] h-[12px]" />
          Add material
        </Button>
        {dirty && (
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={setBom.isPending}
          >
            {setBom.isPending ? "Saving..." : "Save materials"}
          </Button>
        )}
      </div>
    </div>
  );
}
