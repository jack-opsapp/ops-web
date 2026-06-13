"use client";

/**
 * Add stock item — creates a "good" family plus its first default variant.
 * The barebones single-variant path; option axes are authored later on the
 * family. Mirrors the iOS New Good quick-add field set.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDictionary } from "@/i18n/client";
import { useCreateFamily } from "@/lib/hooks/use-catalog-stock";
import { useCatalogCategories, useCatalogUnits } from "@/lib/hooks/use-catalog-meta";

const labelCls = "font-mono text-[11px] uppercase tracking-[0.14em] text-text-3";
const selectCls =
  "w-full rounded-[5px] border border-border bg-surface-input px-2 py-2 font-mohave text-[14px] text-text focus:border-[rgba(255,255,255,0.2)] focus:outline-none";

export function AddStockDialog({ onClose }: { onClose: () => void }) {
  const { t } = useDictionary("catalog");
  const create = useCreateFamily();
  const { data: categories = [] } = useCatalogCategories();
  const { data: units = [] } = useCatalogUnits();

  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [unitId, setUnitId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [sku, setSku] = useState("");
  const [cost, setCost] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        categoryId: categoryId || null,
        unitId: unitId || null,
        quantity: Number(quantity) || 0,
        sku: sku.trim() || null,
        defaultUnitCost: cost.trim() === "" ? null : Number(cost),
        warningThreshold: null,
        criticalThreshold: null,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-cakemono text-[18px] font-light uppercase tracking-[0.02em] text-text">
            {t("add.good", "New good")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className={labelCls}>{t("add.itemName", "Item name")} *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>{t("add.quantity", "Quantity")}</label>
              <Input
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>{t("add.unit", "Unit")}</label>
              <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>{t("add.sku", "SKU")}</label>
              <Input
                value={sku}
                onChange={(e) => setSku(e.target.value.toUpperCase())}
                className="font-mono"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>{t("add.cost", "Unit cost")}</label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="font-mono"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className={labelCls}>{t("add.category", "Category")}</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={selectCls}
            >
              <option value="">—</option>
              {categories
                .filter((c) => !c.parentId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="flex justify-end gap-1.5 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("add.cancel", "CANCEL")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!name.trim()}
              loading={create.isPending}
              onClick={submit}
            >
              {t("add.create", "CREATE")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
