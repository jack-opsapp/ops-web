import { CellText } from "./cell-text";

/**
 * Assignee cell. Read-only by design — renders the resolved display name as
 * plain text (or "—" when unassigned). Rows are for scanning; reassignment is a
 * verb and lives behind the row, in the lead-detail window's assignee field
 * (LeadMapBand → AssigneeField), not inline in the table. The column stays a
 * quiet, glanceable ownership readout.
 */
export function CellAssignee({ name }: { name: string | null }) {
  return <CellText value={name} className="text-text-2" />;
}
