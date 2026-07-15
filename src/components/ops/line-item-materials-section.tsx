"use client";

/**
 * Inline materials override panel for a single estimate line item.
 * Shows the BOM defaults (calculated from product_materials * quantity)
 * or existing line_item_materials overrides, and lets the user edit
 * quantities + source and save them.
 */

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useLineItemMaterials,
  useSetLineItemMaterials,
  useProductMaterials,
} from "@/lib/hooks";
import { useInventoryItems } from "@/lib/hooks/use-inventory";
import type { InventoryItem } from "@/lib/types/inventory";
import type {
  CreateLineItemMaterial,
  MaterialSource,
} from "@/lib/types/product-materials";
import { toast } from "@/components/ui/toast";

interface Row {
  inventoryItemId: string;
  quantity: number;
  source: MaterialSource;
}

interface Props {
  lineItemId: string;
  productId: string;
  quantity: number;
}

export function LineItemMaterialsSection({ lineItemId, productId, quantity }: Props) {
  const { data: overrides = [], isLoading: loadingOverrides } = useLineItemMaterials(lineItemId);
  const { data: bom = [], isLoading: loadingBom } = useProductMaterials(productId);
  const { data: inventory = [] } = useInventoryItems();
  const setOverrides = useSetLineItemMaterials();

  const itemMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    inventory.forEach((i: InventoryItem) => map.set(i.id, i));
    return map;
  }, [inventory]);

  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (overrides.length > 0) {
      setRows(
        overrides.map((o) => ({
          inventoryItemId: o.inventoryItemId,
          quantity: o.quantity,
          source: o.source,
        }))
      );
    } else {
      setRows(
        bom.map((b) => ({
          inventoryItemId: b.inventoryItemId,
          quantity: quantity * b.quantityPerUnit,
          source: "stock" as MaterialSource,
        }))
      );
    }
    setDirty(false);
  }, [overrides, bom, quantity]);

  const isUsingDefaults = overrides.length === 0;

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const handleSave = async () => {
    const payload: CreateLineItemMaterial[] = rows
      .filter((r) => r.quantity > 0)
      .map((r) => ({
        lineItemId,
        inventoryItemId: r.inventoryItemId,
        quantity: r.quantity,
        source: r.source,
      }));

    try {
      await setOverrides.mutateAsync({ lineItemId, materials: payload });
      toast.success("Materials saved");
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save materials");
    }
  };

  const handleRevert = async () => {
    try {
      await setOverrides.mutateAsync({ lineItemId, materials: [] });
      toast.success("Reverted to product defaults");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revert");
    }
  };

  if (loadingOverrides || loadingBom) {
    return <p className="font-mono text-micro text-text-mute">loading...</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="font-mono text-micro text-text-mute">
        [no BOM defined — edit product to add materials]
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-micro uppercase tracking-widest text-text-3">
          Materials {isUsingDefaults ? "[product defaults]" : "[overridden]"}
        </span>
        {!isUsingDefaults && !dirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRevert}
            className="h-6 text-micro text-text-3"
          >
            Revert to defaults
          </Button>
        )}
      </div>

      <div className="space-y-0.5">
        {rows.map((row, idx) => {
          const item = itemMap.get(row.inventoryItemId);
          return (
            <div
              key={row.inventoryItemId}
              className="grid grid-cols-[1fr_80px_70px] gap-1 items-center"
            >
              <span className="font-mohave text-body-sm text-text truncate">
                {item?.name ?? "Unknown item"}
              </span>
              <Input
                type="number"
                min={0}
                step={0.0001}
                value={row.quantity}
                onChange={(e) =>
                  updateRow(idx, { quantity: parseFloat(e.target.value) || 0 })
                }
                className="text-right text-sm h-7"
              />
              <select
                value={row.source}
                onChange={(e) =>
                  updateRow(idx, { source: e.target.value as MaterialSource })
                }
                className="bg-fill-neutral-dim border border-border rounded px-1 py-1 font-mono text-micro uppercase text-text-2 h-7"
              >
                <option value="stock">stock</option>
                <option value="order">order</option>
              </select>
            </div>
          );
        })}
      </div>

      {dirty && (
        <div className="flex justify-end">
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={setOverrides.isPending}
          >
            {setOverrides.isPending ? "Saving..." : "Save materials"}
          </Button>
        </div>
      )}
    </div>
  );
}
