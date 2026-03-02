"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";
import { useInventoryItems } from "@/lib/hooks/use-inventory";
import type { ColumnMapping, InventoryField } from "./map-columns-step";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreviewItem {
  /** Temporary key for React list rendering */
  _key: number;
  name: string;
  quantity: number;
  unit: string;
  sku: string;
  tags: string;
  description: string;
  notes: string;
}

interface PreviewStepProps {
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping;
  previewItems: PreviewItem[];
  onPreviewItemsChange: (items: PreviewItem[]) => void;
}

// ─── Build preview items from raw CSV data + mapping ─────────────────────────

export function buildPreviewItems(
  rows: string[][],
  mapping: ColumnMapping
): PreviewItem[] {
  // Build a reverse lookup: field -> column index
  const fieldToCol: Partial<Record<InventoryField, number>> = {};
  for (const [colStr, field] of Object.entries(mapping)) {
    if (field !== "skip") {
      fieldToCol[field] = Number(colStr);
    }
  }

  return rows.map((row, i) => ({
    _key: i,
    name: fieldToCol.name !== undefined ? (row[fieldToCol.name] ?? "") : "",
    quantity:
      fieldToCol.quantity !== undefined
        ? Number(row[fieldToCol.quantity]) || 0
        : 0,
    unit: fieldToCol.unit !== undefined ? (row[fieldToCol.unit] ?? "") : "",
    sku: fieldToCol.sku !== undefined ? (row[fieldToCol.sku] ?? "") : "",
    tags: fieldToCol.tags !== undefined ? (row[fieldToCol.tags] ?? "") : "",
    description:
      fieldToCol.description !== undefined
        ? (row[fieldToCol.description] ?? "")
        : "",
    notes:
      fieldToCol.notes !== undefined ? (row[fieldToCol.notes] ?? "") : "",
  }));
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PreviewStep({
  previewItems,
  onPreviewItemsChange,
}: PreviewStepProps) {
  const { data: existingItems = [] } = useInventoryItems();

  // Set of existing item names (lowercased) for duplicate detection
  const existingNames = useMemo(
    () => new Set(existingItems.map((item) => item.name.toLowerCase())),
    [existingItems]
  );

  const duplicateCount = useMemo(
    () =>
      previewItems.filter((item) =>
        existingNames.has(item.name.toLowerCase())
      ).length,
    [previewItems, existingNames]
  );

  function removeRow(key: number) {
    onPreviewItemsChange(previewItems.filter((item) => item._key !== key));
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      {/* Summary */}
      <div className="flex items-center gap-2">
        <p className="font-mohave text-body text-text-primary">
          {previewItems.length} item{previewItems.length !== 1 ? "s" : ""} ready
          to import
        </p>
        {duplicateCount > 0 && (
          <Badge variant="warning">
            {duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""} detected
          </Badge>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-background-primary z-10">
            <tr>
              <th className="text-left p-2 border-b border-border font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
                Name
              </th>
              <th className="text-left p-2 border-b border-border font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
                Qty
              </th>
              <th className="text-left p-2 border-b border-border font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
                Unit
              </th>
              <th className="text-left p-2 border-b border-border font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
                SKU
              </th>
              <th className="text-left p-2 border-b border-border font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
                Tags
              </th>
              <th className="text-left p-2 border-b border-border font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
                Description
              </th>
              <th className="w-8 p-2 border-b border-border" />
            </tr>
          </thead>
          <tbody>
            {previewItems.map((item) => {
              const isDuplicate = existingNames.has(item.name.toLowerCase());
              return (
                <tr
                  key={item._key}
                  className={cn(
                    "border-b border-border/50 transition-colors",
                    isDuplicate
                      ? "bg-status-warning/10"
                      : "hover:bg-[rgba(255,255,255,0.02)]"
                  )}
                >
                  <td className="p-2 font-mohave text-body-sm text-text-primary">
                    <div className="flex items-center gap-1.5">
                      {item.name}
                      {isDuplicate && (
                        <Badge variant="warning" className="text-[10px]">
                          DUP
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-2 font-mohave text-body-sm text-text-secondary">
                    {item.quantity}
                  </td>
                  <td className="p-2 font-mohave text-body-sm text-text-secondary">
                    {item.unit || "—"}
                  </td>
                  <td className="p-2 font-mohave text-body-sm text-text-secondary">
                    {item.sku || "—"}
                  </td>
                  <td className="p-2 font-mohave text-body-sm text-text-secondary">
                    {item.tags || "—"}
                  </td>
                  <td className="p-2 font-mohave text-body-sm text-text-secondary truncate max-w-[200px]">
                    {item.description || "—"}
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => removeRow(item._key)}
                      className="text-text-tertiary hover:text-ops-error transition-colors"
                      title="Remove row"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {previewItems.length === 0 && (
        <p className="font-mohave text-body-sm text-text-disabled text-center py-4">
          No items to import. Go back and adjust your configuration.
        </p>
      )}
    </div>
  );
}
