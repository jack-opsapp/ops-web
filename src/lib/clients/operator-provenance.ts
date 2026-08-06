/**
 * OPS Web — Operator provenance for manual client edits.
 *
 * Field-level provenance is what stops the email pipeline overwriting a name,
 * email, phone, or address a human typed. Sync and enrichment have always
 * written their own rows; a manual edit in the client workspace wrote none, so
 * an operator-corrected name looked exactly like a machine-minted one to every
 * downstream guard.
 *
 * This selects the customer facts a client edit touched. Everything else on
 * the row (notes, coordinates, avatar, tenancy) is plumbing, not a fact any
 * extractor competes for, so it is not tracked.
 */

/** Client columns that map onto a lead_field_provenance field_name. */
const PROVENANCE_TRACKED_CLIENT_COLUMNS = [
  "name",
  "email",
  "phone_number",
  "address",
] as const;

export function buildOperatorClientProvenanceUpdates(
  row: Record<string, unknown>
): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const column of PROVENANCE_TRACKED_CLIENT_COLUMNS) {
    const value = row[column];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    updates[column] = trimmed;
  }
  return updates;
}
