import { formatNumber } from "@/lib/utils/pipeline-table-formatters";

/** Right-aligned plain-number cell (correspondence count). */
export function CellNumber({ value }: { value: number | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatNumber(value)}</span>;
}
