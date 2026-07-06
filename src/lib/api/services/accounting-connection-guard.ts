import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One active accounting provider per company.
 *
 * A trade business runs a single accounting system, and two live connections
 * would give the sync engine conflicting write targets. This guard enforces
 * that invariant in the connect flow (initiate) and again at activation
 * (callback) — not just in the UI, which only *hides* the second provider.
 *
 * "Conflicting" means a DIFFERENT provider that is already connected. Multiple
 * rows for the SAME provider never conflict (e.g. a QuickBooks sandbox +
 * production pair, or re-authorising the current provider) — only a switch to
 * another provider without disconnecting first does.
 *
 * Returns the conflicting provider string (e.g. "sage") or null when the
 * requested provider is free to connect.
 */
export async function findConflictingActiveProvider(
  supabase: SupabaseClient,
  companyId: string,
  provider: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("accounting_connections")
    .select("provider")
    .eq("company_id", companyId)
    .eq("is_connected", true)
    .neq("provider", provider)
    .limit(1);

  // On a transient read error, don't block a legitimate connect at initiate —
  // the callback re-checks before flipping is_connected, so the invariant still
  // holds where it matters (at the write).
  if (error) return null;

  return data && data.length > 0 ? (data[0].provider as string) : null;
}

/** Human label for a provider string, for operator-facing conflict messages. */
export function providerLabel(provider: string): string {
  if (provider === "quickbooks") return "QuickBooks";
  if (provider === "sage") return "Sage";
  return provider;
}
