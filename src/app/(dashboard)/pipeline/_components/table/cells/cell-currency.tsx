import { formatCurrency } from "@/lib/utils/pipeline-table-formatters";

/** Right-aligned currency cell. Mono + tabular so columns line up on the decimal. */
export function CellCurrency({ value }: { value: number | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatCurrency(value)}</span>;
}
