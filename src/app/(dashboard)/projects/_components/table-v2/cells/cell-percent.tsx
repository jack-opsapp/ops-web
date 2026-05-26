import { formatPercent } from "@/lib/utils/project-table-formatters";

export function CellPercent({ value }: { value: number | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatPercent(value)}</span>;
}
