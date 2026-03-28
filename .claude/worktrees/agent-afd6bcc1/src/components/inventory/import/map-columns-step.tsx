"use client";

import { cn } from "@/lib/utils/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ───────────────────────────────────────────────────────────────────

export type InventoryField =
  | "name"
  | "quantity"
  | "unit"
  | "sku"
  | "tags"
  | "description"
  | "notes"
  | "skip";

export type ColumnMapping = Record<number, InventoryField>;

interface MapColumnsStepProps {
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
}

// ─── Field labels ────────────────────────────────────────────────────────────

const FIELD_OPTIONS: { value: InventoryField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "quantity", label: "Quantity" },
  { value: "unit", label: "Unit" },
  { value: "sku", label: "SKU" },
  { value: "tags", label: "Tags" },
  { value: "description", label: "Description" },
  { value: "notes", label: "Notes" },
  { value: "skip", label: "Skip this column" },
];

// ─── Validation ──────────────────────────────────────────────────────────────

export function isMappingValid(mapping: ColumnMapping): boolean {
  const values = Object.values(mapping);
  return values.includes("name") && values.includes("quantity");
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MapColumnsStep({
  headers,
  rows,
  mapping,
  onMappingChange,
}: MapColumnsStepProps) {
  const previewRows = rows.slice(0, 3);
  const valid = isMappingValid(mapping);

  function setColumnMapping(colIndex: number, field: InventoryField) {
    onMappingChange({ ...mapping, [colIndex]: field });
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      {/* Validation message */}
      {!valid && (
        <p className="font-mohave text-body-sm text-ops-error">
          Name and Quantity columns must be mapped before continuing
        </p>
      )}

      {/* Mapping table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {headers.map((header, colIndex) => (
                <th
                  key={colIndex}
                  className="text-left p-2 border-b border-border"
                >
                  <div className="flex flex-col gap-1.5">
                    <span className="font-mohave text-body-sm text-text-secondary truncate max-w-[160px]">
                      {header}
                    </span>
                    <Select
                      value={mapping[colIndex] ?? "skip"}
                      onValueChange={(val) =>
                        setColumnMapping(colIndex, val as InventoryField)
                      }
                    >
                      <SelectTrigger className="min-w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={cn(
                  "border-b border-border/50",
                  rowIndex % 2 === 0
                    ? "bg-transparent"
                    : "bg-[rgba(255,255,255,0.02)]"
                )}
              >
                {headers.map((_, colIndex) => (
                  <td
                    key={colIndex}
                    className="p-2 font-mohave text-body-sm text-text-tertiary truncate max-w-[160px]"
                  >
                    {row[colIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="font-mohave text-caption-sm text-text-disabled">
        Showing first {previewRows.length} of {rows.length} rows
      </p>
    </div>
  );
}
