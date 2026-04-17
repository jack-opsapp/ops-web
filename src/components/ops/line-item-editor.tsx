"use client";

import { useState, useCallback, useMemo } from "react";
import { Plus, Trash2, HelpCircle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import {
  calculateLineTotal,
  calculateLineTax,
  formatCurrency,
} from "@/lib/types/pipeline";
import type { Product } from "@/lib/types/pipeline";
import type { LineItemQuestion } from "@/lib/types/portal";
import { useStockIndicator } from "@/lib/hooks/use-stock-indicator";
import type { LineItemStockStatus } from "@/lib/types/product-materials";
import { LineItemMaterialsSection } from "./line-item-materials-section";

export interface LineItemRow {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  isTaxable: boolean;
  discountPercent: number;
  productId: string | null;
  unit: string;
  isOptional: boolean;
  isSelected: boolean;
}

interface LineItemEditorProps {
  items: LineItemRow[];
  onChange: (items: LineItemRow[]) => void;
  products?: Product[];
  taxRate?: number;
  className?: string;
  /** Questions grouped by line item ID — enables question badges */
  questionsByLineItem?: Record<string, LineItemQuestion[]>;
  /** Called when the user wants to edit questions for a line item */
  onEditQuestions?: (lineItemId: string) => void;
}

let nextId = 1;
function generateTempId(): string {
  return `temp-${nextId++}-${Date.now()}`;
}

export function createEmptyLineItem(): LineItemRow {
  return {
    id: generateTempId(),
    name: "",
    quantity: 1,
    unitPrice: 0,
    isTaxable: false,
    discountPercent: 0,
    productId: null,
    unit: "each",
    isOptional: false,
    isSelected: true,
  };
}

function computeAmount(item: LineItemRow, taxRate: number = 0) {
  const lineTotal = calculateLineTotal(item.quantity, item.unitPrice, item.discountPercent);
  const tax = item.isTaxable ? calculateLineTax(lineTotal, taxRate) : 0;
  return { lineTotal, tax, total: lineTotal + tax };
}

export function LineItemEditor({
  items,
  onChange,
  products = [],
  taxRate = 0,
  className,
  questionsByLineItem,
  onEditQuestions,
}: LineItemEditorProps) {
  const updateItem = useCallback(
    (id: string, field: keyof LineItemRow, value: string | number | boolean | null) => {
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
    onChange([...items, createEmptyLineItem()]);
  }, [items, onChange]);

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
                name: product.name,
                unitPrice: product.defaultPrice,
                isTaxable: product.isTaxable,
                unit: product.unit ?? "each",
              }
            : item
        )
      );
    },
    [items, onChange, products]
  );

  const totals = items.reduce(
    (acc, item) => {
      if (item.isOptional && !item.isSelected) return acc;
      const computed = computeAmount(item, taxRate);
      return {
        subtotal: acc.subtotal + computed.lineTotal,
        tax: acc.tax + computed.tax,
        total: acc.total + computed.total,
      };
    },
    { subtotal: 0, tax: 0, total: 0 }
  );

  // Stock indicator — batch query for all line items with a productId
  const stockInputs = useMemo(
    () =>
      items
        .filter((i) => i.productId)
        .map((i) => ({ id: i.id, productId: i.productId, quantity: i.quantity })),
    [items]
  );
  const { data: stockStatuses } = useStockIndicator(stockInputs);
  const stockByLine = useMemo(() => {
    const map = new Map<string, LineItemStockStatus>();
    (stockStatuses ?? []).forEach((s) => map.set(s.lineItemId, s));
    return map;
  }, [stockStatuses]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <TooltipProvider delayDuration={150}>
    <div className={cn("space-y-2", className)}>
      {/* Header */}
      <div className="hidden sm:grid grid-cols-[18px_1fr_80px_100px_60px_60px_16px_36px] gap-1 px-1">
        <span />
        <span className="font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
          Name
        </span>
        <span className="font-kosugi text-caption-sm text-text-3 uppercase tracking-widest text-right">
          Qty
        </span>
        <span className="font-kosugi text-caption-sm text-text-3 uppercase tracking-widest text-right">
          Price
        </span>
        <span className="font-kosugi text-caption-sm text-text-3 uppercase tracking-widest text-center">
          Tax
        </span>
        <span className="font-kosugi text-caption-sm text-text-3 uppercase tracking-widest text-right">
          Amount
        </span>
        <span />
        <span />
      </div>

      {/* Items */}
      <div className="space-y-1">
        {items.map((item) => {
          const computed = computeAmount(item, taxRate);
          const stock = item.productId ? stockByLine.get(item.id) : undefined;
          const expanded = expandedIds.has(item.id);
          const isTempId = item.id.startsWith("temp-");
          return (
            <div key={item.id} className="space-y-1">
            <div
              className="grid grid-cols-1 sm:grid-cols-[18px_1fr_80px_100px_60px_60px_16px_36px] gap-1 items-start bg-glass glass-surface border border-border rounded p-1 sm:p-0 sm:bg-transparent sm:border-0 sm:rounded-none"
            >
              {/* Expand chevron — only if the line item has a product */}
              <div className="hidden sm:flex items-center justify-center h-[36px]">
                {item.productId && (
                  <button
                    onClick={() => toggleExpand(item.id)}
                    className={cn(
                      "p-0.5 rounded text-text-mute hover:text-text-2 transition-all",
                      expanded && "rotate-90 text-text-2"
                    )}
                    aria-label={expanded ? "Collapse materials" : "Expand materials"}
                  >
                    <ChevronRight className="w-[12px] h-[12px]" />
                  </button>
                )}
              </div>

              {/* Name + Product Select */}
              <div className="space-y-0.5">
                {products.length > 0 && (
                  <select
                    value={item.productId ?? ""}
                    onChange={(e) => {
                      if (e.target.value) selectProduct(item.id, e.target.value);
                    }}
                    className="w-full bg-transparent border border-border rounded px-1 py-0.5 font-kosugi text-micro text-text-3"
                  >
                    <option value="">Select product/service...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatCurrency(p.defaultPrice)})
                      </option>
                    ))}
                  </select>
                )}
                <Input
                  value={item.name}
                  onChange={(e) => updateItem(item.id, "name", e.target.value)}
                  placeholder="Line item name"
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

              {/* Taxable (checkbox) */}
              <div className="flex items-center justify-center h-[36px]">
                <input
                  type="checkbox"
                  checked={item.isTaxable}
                  onChange={(e) => updateItem(item.id, "isTaxable", e.target.checked)}
                  className="rounded border-border"
                />
              </div>

              {/* Amount (computed) */}
              <div className="flex items-center justify-end h-[36px]">
                <span className="font-mono text-data-sm text-text">
                  {formatCurrency(computed.lineTotal)}
                </span>
              </div>

              {/* Stock Indicator */}
              <div className="hidden sm:flex items-center justify-center h-[36px]">
                {stock && stock.overallStatus !== "no_bom" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        aria-label={`Stock ${stock.overallStatus}`}
                        className={cn(
                          "block w-[8px] h-[8px] rounded-full",
                          stock.overallStatus === "sufficient" && "bg-status-success",
                          stock.overallStatus === "warning" && "bg-status-warning",
                          stock.overallStatus === "insufficient" && "bg-ops-error"
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px]">
                      <div className="space-y-1">
                        <p className="font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
                          Stock
                        </p>
                        {stock.materials.map((m) => (
                          <div
                            key={m.inventoryItemId}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="font-mohave text-body-sm text-text truncate">
                              {m.inventoryItemName}
                            </span>
                            <span
                              className={cn(
                                "font-mono text-data-sm",
                                m.status === "sufficient" && "text-status-success",
                                m.status === "warning" && "text-status-warning",
                                m.status === "insufficient" && "text-ops-error"
                              )}
                            >
                              {m.required} / {m.available}
                            </span>
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-center h-[36px] gap-0.5">
                {onEditQuestions && (
                  <button
                    onClick={() => onEditQuestions(item.id)}
                    className="relative p-[4px] rounded text-text-mute hover:text-text hover:bg-[rgba(255,255,255,0.08)] transition-colors"
                    title="Edit questions"
                  >
                    <HelpCircle className="w-[14px] h-[14px]" />
                    {questionsByLineItem?.[item.id]?.length ? (
                      <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-text-2 rounded-full text-micro text-background flex items-center justify-center leading-none">
                        {questionsByLineItem[item.id].length}
                      </span>
                    ) : null}
                  </button>
                )}
                <button
                  onClick={() => removeItem(item.id)}
                  disabled={items.length <= 1}
                  className={cn(
                    "p-[4px] rounded text-text-mute hover:text-ops-error hover:bg-ops-error-muted transition-colors",
                    items.length <= 1 && "opacity-30 cursor-not-allowed"
                  )}
                >
                  <Trash2 className="w-[14px] h-[14px]" />
                </button>
              </div>
            </div>

            {/* Expanded: materials override (existing saved items only) */}
            {expanded && item.productId && (
              <div className="border-t border-border pt-1.5 pb-1 pl-[22px] pr-1">
                {isTempId ? (
                  <p className="font-kosugi text-micro text-text-mute">
                    [save estimate to override materials on this line item]
                  </p>
                ) : (
                  <LineItemMaterialsSection
                    lineItemId={item.id}
                    productId={item.productId}
                    quantity={item.quantity}
                  />
                )}
              </div>
            )}
            </div>
          );
        })}
      </div>

      {/* Add Line Item */}
      <Button
        variant="ghost"
        size="sm"
        onClick={addItem}
        className="gap-1 text-text-3"
      >
        <Plus className="w-[14px] h-[14px]" />
        Add Line Item
      </Button>

      {/* Totals */}
      <div className="border-t border-border pt-1.5 space-y-0.5">
        <div className="flex justify-between">
          <span className="font-kosugi text-caption text-text-3">Subtotal</span>
          <span className="font-mono text-data text-text-2">
            {formatCurrency(totals.subtotal)}
          </span>
        </div>
        {totals.tax > 0 && (
          <div className="flex justify-between">
            <span className="font-kosugi text-caption text-text-3">Tax</span>
            <span className="font-mono text-data text-text-2">
              {formatCurrency(totals.tax)}
            </span>
          </div>
        )}
        <div className="flex justify-between pt-0.5 border-t border-border">
          <span className="font-mohave text-body-lg text-text uppercase">Total</span>
          <span className="font-mono text-data-lg text-text">
            {formatCurrency(totals.total)}
          </span>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}

export { computeAmount };
