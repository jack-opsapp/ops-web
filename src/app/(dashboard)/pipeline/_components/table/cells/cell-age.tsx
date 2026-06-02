import { formatAgeDays } from "@/lib/utils/pipeline-table-formatters";

/** Right-aligned age-in-stage cell, rendered with a compact day suffix ("9d"). */
export function CellAge({ value }: { value: number | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatAgeDays(value)}</span>;
}
