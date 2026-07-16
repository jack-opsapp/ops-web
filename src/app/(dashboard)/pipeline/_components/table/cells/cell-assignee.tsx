import { CellText } from "./cell-text";

/**
 * Assignee cell. Read-only for this phase — renders the resolved display name as
 * plain text (or "—" when unassigned). A real avatar + inline assignee picker
 * arrives in Phase 4; this keeps the column legible until then.
 */
export function CellAssignee({ name }: { name: string | null }) {
  return <CellText value={name} className="text-text-2" />;
}
