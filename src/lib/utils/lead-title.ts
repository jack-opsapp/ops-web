/**
 * OPS Web — canonical lead (opportunity) title grammar for MANUAL creation.
 *
 * The one sentence a lead is filed under on the pipeline board:
 *
 *     Contact Name (Client Name) - Source Lead
 *
 * degrading gracefully as parts go missing:
 *
 *     Sarah Mitchell (Mitchell Homes) - Referral Lead   ← all parts
 *     Sarah Mitchell (Mitchell Homes) - Lead            ← no source
 *     Sarah Mitchell - Referral Lead                    ← no client
 *     Sarah Mitchell - Lead                             ← contact only
 *     Mitchell Homes - Lead                             ← client only (no contact)
 *     ""                                                ← nothing to name from yet
 *
 * Methodology (bug 9b35e76f review, 2026-07-04): leads are named by
 * WHO + PROVENANCE — the person and where they came from — because that is
 * how an owner recalls an open conversation. Projects are named by WHERE
 * (`private.derive_project_name`: street line of the address) because a job
 * is a site. The two grammars are intentionally different and meet at
 * won-conversion, where `get_conversion_preflight.suggested_name` takes over.
 * Inbox-created leads carry email-derived titles (subject/summary lineage) —
 * that path owns its own builder; THIS builder is canon for the manual form.
 *
 * Rules:
 *  - The parenthetical client is dropped when it would repeat the name part
 *    (linking a client auto-fills the contact name with the client's name —
 *    "Acme Corp (Acme Corp)" is noise, not information).
 *  - A lead with a client but no contact person names itself by the client.
 *  - `sourceLabel` is the LOCALIZED display label the operator saw, not the
 *    enum value — the title is the operator's data, in the operator's words.
 */

export interface LeadTitleParts {
  /** The person behind the deal (form `contactName`). */
  contactName?: string | null;
  /** The linked client's display name, when one is linked. */
  clientName?: string | null;
  /** Localized source label ("Referral", "Repeat client", …) or null. */
  sourceLabel?: string | null;
  /**
   * Localized suffix word — "Lead" (en) / "Prospecto" (es). Callers pass the
   * `quickAdd.leadSuffix` dictionary value; defaults to "Lead".
   */
  suffix?: string | null;
}

/** Collapse whitespace and trim — titles never carry stray spacing. */
function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Build the canonical manual-lead title. Returns `""` when there is nothing
 * to name from (no contact, no client) — callers keep their placeholder.
 */
export function buildLeadTitle(parts: LeadTitleParts): string {
  const contact = clean(parts.contactName);
  const client = clean(parts.clientName);
  const source = clean(parts.sourceLabel);
  const suffixWord = clean(parts.suffix) || "Lead";

  const namePart = contact || client;
  if (!namePart) return "";

  const repeatsClient =
    client.length > 0 && namePart.toLowerCase() === client.toLowerCase();
  const parenthetical = contact && client && !repeatsClient ? ` (${client})` : "";

  const suffix = source ? `${source} ${suffixWord}` : suffixWord;

  return `${namePart}${parenthetical} - ${suffix}`;
}
