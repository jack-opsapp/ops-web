import { CellText } from "./cell-text";

export function CellRelation({ value }: { value: string | null }) {
  return <CellText value={value} className="text-text-2" />;
}
