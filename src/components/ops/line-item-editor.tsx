"use client";

import { useState, useCallback } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import {
  calculateLineItemAmount,
  calculateLineItemTax,
  calculateLineItemDiscount,
  formatCurrency,
  LineItemType,
} from "@/lib/types/models";
import type { Product } from "@/lib/types/models";

export interface LineItemRow {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountPercent: number;
  productId: string | null;
  type: LineItemType;
}

interface LineItemEditorProps {
  items: LineItemRow[];
  onChange: (items: LineItemRow[]) => void;
  products?: Product[];
  defaultTaxRate?: number;
  className?: string;
}

let nextId = 1;
function generateTempId(): string {
  return `temp-${nextId++}-${Date.now()}`;
}

export function createEmptyLineItem(defaultTaxRate: number = 0): LineItemRow {
  return {
    id: generateTempId(),
    description: "",
    quantity: 1,
    unitPrice: 0,
    taxRate: defaultTaxRate,
    discountPercent: 0,
    productId: null,
    type: LineItemType.Service,
  };
}

function computeAmount(item: LineItemRow) {
  const base = calculateLineItemAmount(item.quantity, item.unitPrice);
  const discount = calculateLineItemDiscount(base, item.discountPercent);
  const afterDiscount = base - discount;
  const tax = calculateLineItemTax(afterDiscount, item.taxRate);
  return { base, discount, tax, total: afterDiscount + tax };
}

export function LineItemEditor({
  items,
  onChange,
  products = [],
  defaultTaxRate = 0,
  className,
}: LineItemEditorProps) {
  const updateItem = useCallback(
    (id: string, field: keyof LineItemRow, value: string | number | null) => {
      onChange(
        items.map((item) =>
          item.id === id ? { ...item, [field]: value } : item
        )
      );
    },
    [items, onChange]
  );

  const removeItem = useCallback(
    (id: string) => {
      if (items.length <= 1) return;
      onChange(items.filter((item) => item.id !== id));
    },
    [items, onChange]
  );

  const addItem = useCallback(() => {
    onChange([...items, createEmptyLineItem(defaultTaxRate)]);
  }, [items, onChange, defaultTaxRate]);

  const selectProduct = useCallback(
    (itemId: string, productId: string) => {
      const product = products.find((p) => p.id === productId);
      if (!product) return;
      onChange(
        items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                productId: product.id,
                description: product.description || product.name,
                unitPrice: product.unitPrice,
                type: product.type === "product" ? LineItemType.Product : LineItemType.Service,
              }
            : item
        )
      );
    },
    [items, onChange, products]
  );

  const totals = items.reduce(
    (acc, item) => {
      const computed = computeAmount(item);
      return {
        subtotal: acc.subtotal + computed.base,
        discount: acc.discount + computed.discount,
        tax: acc.tax + computed.tax,
        total: acc.total + computed.total,
      };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 }
  );

  return (
    <div className={cn("space-y-2", className)}>
      {/* Header */}
      <div className="hidden sm:grid grid-cols-[1fr_80px_100px_80px_60px_36px] gap-1 px-1">
        <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
          Description
        </span>
        <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest text-right">
          Qty
        </span>
        <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest text-right">
          Price
        </span>
        <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest text-right">
          Tax %
        </span>
        <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest text-right">
          Amount
        </span>
        <span />
      </div>

      {/* Items */}
      <div className="space-y-1">
        {items.map((item) => {
          const computed = computeAmount(item);
          return (
            <div
              key={item.id}
              className="grid grid-cols-1 sm:grid-cols-[1fr_80px_100px_80px_60px_36px] gap-1 items-start bg-background-card border border-border rounded p-1 sm:p-0 sm:bg-transparent sm:border-0 sm:rounded-none"
            >
              {/* Description + Product Select */}
              <div className="space-y-0.5">
                {products.length > 0 && (
                  <select
                    value={item.productId ?? ""}
                    onChange={(e) => {
                      if (e.target.value) selectProduct(item.id, e.target.value);
                    }}
                    className="w-full bg-transparent border border-border rounded px-1 py-0.5 font-kosugi text-[10px] text-text-tertiary"
                  >
                    <option value="">Select product/service...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatCurrency(p.unitPrice)})
                      </option>
                    ))}
                  </select>
                )}
                <Input
                  value={item.description}
                  onChange={(e) => updateItem(item.id, "description", e.target.value)}
                  placeholder="Line item description"
                  className="text-sm"
                />
              </div>

              {/* Quantity */}
              <Input
                type="number"
                min={0}
                step={0.01}
                value={item.quantity}
                onChange={(e) => updateItem(item.id, "quantity", parseFloat(e.target.value) || 0)}
                className="text-right text-sm"
              />

              {/* Unit Price */}
              <Input
                type="number"
                min={0}
                step={0.01}
                value={item.unitPrice}
                onChange={(e) => updateItem(item.id, "unitPrice", parseFloat(e.target.value) || 0)}
                className="text-right text-sm"
              />

              {/* Tax Rate */}
              <Input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={item.taxRate}
                onChange={(e) => updateItem(item.id, "taxRate", parseFloat(e.target.value) || 0)}
                className="text-right text-sm"
              />

              {/* Amount (computed) */}
              <div className="flex items-center justify-end h-[36px]">
                <span className="font-mono text-data-sm text-text-primary">
                  {formatCurrency(computed.base)}
                </span>
              </div>

              {/* Delete */}
              <div className="flex items-center justify-center h-[36px]">
                <button
                  onClick={() => removeItem(item.id)}
                  disabled={items.length <= 1}
                  className={cn(
                    "p-[4px] rounded text-text-disabled hover:text-ops-error hover:bg-ops-error-muted transition-colors",
                    items.length <= 1 && "opacity-30 cursor-not-allowed"
                  )}
                >
                  <Trash2 className="w-[14px] h-[14px]" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Line Item */}
      <Button
        variant="ghost"
        size="sm"
        onClick={addItem}
        className="gap-1 text-text-tertiary"
      >
        <Plus className="w-[14px] h-[14px]" />
        Add Line Item
      </Button>

      {/* Totals */}
      <div className="border-t border-border pt-1.5 space-y-0.5">
        <div className="flex justify-between">
          <span className="font-kosugi text-caption text-text-tertiary">Subtotal</span>
          <span className="font-mono text-data text-text-secondary">
            {formatCurrency(totals.subtotal)}
          </span>
        </div>
        {totals.discount > 0 && (
          <div className="flex justify-between">
            <span className="font-kosugi text-caption text-text-tertiary">Discount</span>
            <span className="font-mono text-data text-status-success">
              -{formatCurrency(totals.discount)}
            </span>
          </div>
        )}
        {totals.tax > 0 && (
          <div className="flex justify-between">
            <span className="font-kosugi text-caption text-text-tertiary">Tax</span>
            <span className="font-mono text-data text-text-secondary">
              {formatCurrency(totals.tax)}
            </span>
          </div>
        )}
        <div className="flex justify-between pt-0.5 border-t border-border">
          <span className="font-mohave text-body-lg text-text-primary uppercase">Total</span>
          <span className="font-mono text-data-lg text-text-primary">
            {formatCurrency(totals.total)}
          </span>
        </div>
      </div>
    </div>
  );
}

export { computeAmount };
