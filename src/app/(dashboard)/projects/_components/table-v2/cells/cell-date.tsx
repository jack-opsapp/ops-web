import { formatDate } from "@/lib/utils/project-table-formatters";

export function CellDate({ value }: { value: string | null }) {
  return <span className="font-mono tabular-nums text-text-2">{formatDate(value)}</span>;
}
