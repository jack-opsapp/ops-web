import { formatPercentInt } from "@/lib/utils/pipeline-table-formatters";

/**
 * Win-probability cell. Pipeline win probability is already an integer percent,
 * so this uses `formatPercentInt` (no ×100) — see the formatter's note.
 */
export function CellPercent({ value }: { value: number | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatPercentInt(value)}</span>;
}
