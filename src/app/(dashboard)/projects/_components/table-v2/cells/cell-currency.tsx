import { formatCurrency } from "@/lib/utils/project-table-formatters";

export function CellCurrency({ value }: { value: number | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatCurrency(value)}</span>;
}
