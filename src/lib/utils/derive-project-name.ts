/**
 * Client-side mirror of the SQL `private.derive_project_name()` street-line
 * rule (won-conversion migration). Used purely for the LIVE auto-name PREVIEW
 * in the Won dialog and the project create/edit form — the authoritative name
 * is always assigned server-side by the `projects_autoname_biud` trigger.
 *
 * The street line is the substring before the first comma, trimmed; a
 * comma-less address (a manually-typed one) falls back to the whole string —
 * exactly what the SQL does with `split_part(p_address, ',', 1)`.
 */
export function deriveStreetLine(
  address: string | null | undefined,
): string | null {
  const trimmed = (address ?? "").trim();
  if (!trimmed) return null;
  const beforeComma = trimmed.split(",")[0]?.trim() ?? "";
  return beforeComma || trimmed;
}

export interface ProjectNamePreviewInput {
  /** Current site address (the editable field's value). */
  address?: string | null;
  /**
   * The server's `derive_project_name(opp.address, client.name)` preview, used
   * verbatim for the no-address case (it already encodes the `{Client}'s
   * Project` / `New project` fallbacks the SQL produces).
   */
  suggestedName?: string | null;
  /** Localized "New project" placeholder — last-resort fallback. */
  newProjectName: string;
}

/**
 * What the project will be named, previewed live as the operator edits the
 * address. Street line wins (and self-heals as the address changes); with no
 * address we defer to the server's suggested name (client fallback / "New
 * project"); failing both, the localized placeholder.
 */
export function deriveProjectNamePreview({
  address,
  suggestedName,
  newProjectName,
}: ProjectNamePreviewInput): string {
  const street = deriveStreetLine(address);
  if (street) return street;
  const suggested = (suggestedName ?? "").trim();
  if (suggested) return suggested;
  return newProjectName;
}
