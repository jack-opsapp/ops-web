"use client";

/**
 * Product quick-add — the iOS 3-field create (name / price / unit + kind).
 * Deep configuration (options, modifiers, recipe) happens afterwards in the
 * full editor at /catalog/products/[id], which the caller navigates to.
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
import { SegmentControl } from "@/components/ui/segment-control";
import { useDictionary } from "@/i18n/client";
import { useCreateProduct } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import type { ProductKind } from "@/lib/types/pipeline";

const labelCls = "font-mono text-[11px] uppercase tracking-[0.14em] text-text-3";

export function ProductQuickAdd({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useDictionary("catalog");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const create = useCreateProduct();

  const [name, setName] = useState("");
  const [price, setPrice] = useState("0");
  const [unit, setUnit] = useState("each");
  const [kind, setKind] = useState<ProductKind>("service");

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        companyId,
        name: name.trim(),
        description: null,
        defaultPrice: Number(price) || 0,
        unitCost: null,
        unit,
        unitId: null,
        category: null,
        categoryId: null,
        kind,
        type: kind === "good" ? "MATERIAL" : "LABOR",
        taskTypeId: null,
        isTaxable: true,
        isActive: true,
        sku: null,
        minimumCharge: null,
        minimumQuantity: null,
        isFavorite: false,
        showBomOnEstimate: false,
      },
      { onSuccess: (p) => onCreated(p.id) },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-cakemono text-[18px] font-light uppercase tracking-[0.02em] text-text">
            {t("products.newProduct", "+ NEW PRODUCT")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <SegmentControl<ProductKind>
            options={[
              { value: "service", label: t("filter.services", "SERVICE") },
              { value: "good", label: t("filter.goods", "GOOD") },
            ]}
            value={kind}
            onChange={setKind}
          />

          <div className="space-y-1">
            <label className={labelCls}>{t("add.itemName", "Name")} *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>{t("products.col.price", "Price")} *</label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>{t("add.unit", "Unit")}</label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
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
