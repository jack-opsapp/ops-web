import { formatNumber } from "@/lib/utils/project-table-formatters";

export function CellNumber({ value }: { value: number | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatNumber(value)}</span>;
}
