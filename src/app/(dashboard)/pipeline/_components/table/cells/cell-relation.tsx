import { CellText } from "./cell-text";

/** Client relation cell — display name, secondary color, truncates, "—" if unlinked. */
export function CellRelation({ value }: { value: string | null }) {
  return <CellText value={value} className="text-text-2" />;
}
