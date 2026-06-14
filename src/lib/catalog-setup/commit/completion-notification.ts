// Completion side-effects after a successful catalog_setup_save: stamp the
// company-scoped completion flag, fire a header-rail notification, and produce
// the success toast/notification copy. All three are best-effort — the route
// calls them fire-and-forget so a notification/stamp failure never fails the
// commit (the rows are already written; the "data exists" signal independently
// flips the first-run takeover off).
//
// Direct-insert (not the dispatch route): /api/notifications/dispatch filters out
// the acting user, but the operator IS the completion recipient — so dispatch
// would no-op. The rail notification therefore inserts directly, scoped to the
// operator (same pattern as the PMF pipeline + the CLAUDE.md rail example).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CommitCounts {
  products: number;
  stock: number;
}

/** "24 products, 12 in stock" — omits any zero clause; "" when both are zero. */
export function commitCountPhrase({ products, stock }: CommitCounts): string {
  const parts: string[] = [];
  if (products > 0) {
    parts.push(`${products} ${products === 1 ? "product" : "products"}`);
  }
  if (stock > 0) parts.push(`${stock} in stock`);
  return parts.join(", ");
}

/** Sonner toast on commit success — terse, sentence case, no exclamation. */
export function catalogCommitToastMessage(counts: CommitCounts): string {
  const phrase = commitCountPhrase(counts);
  return phrase ? `Catalog ready — ${phrase}` : "Catalog ready";
}

/** Header-rail notification body. "—" stands in for a count of zero (never N/A). */
export function catalogReadyNotificationBody(counts: CommitCounts): string {
  const phrase = commitCountPhrase(counts);
  return phrase
    ? `Your price book is live. ${phrase}.`
    : "Your price book is live.";
}

/**
 * Stamp company-scoped completion. `company_settings.company_id` is TEXT (PK) —
 * pass it as-is, never cast to uuid. Best-effort: a missing settings row simply
 * updates nothing (the data-exists signal still suppresses the takeover).
 */
export async function stampCatalogSetupCompleted(
  db: SupabaseClient,
  companyId: string,
  nowIso: string = new Date().toISOString(),
): Promise<{ error: unknown }> {
  const { error } = await db
    .from("company_settings")
    .update({ catalog_setup_completed_at: nowIso })
    .eq("company_id", companyId);
  return { error };
}

export interface CatalogReadyArgs {
  userId: string;
  companyId: string;
  productCount: number;
  stockCount: number;
}

/**
 * Insert the operator-scoped "catalog ready" rail notification. Uses the existing
 * `system_alert` type (no schema change); a dedicated `catalog_ready` type is a
 * future additive nicety. Standard (dismissible), not persistent.
 */
export async function insertCatalogReadyNotification(
  db: SupabaseClient,
  { userId, companyId, productCount, stockCount }: CatalogReadyArgs,
): Promise<{ error: unknown }> {
  const { error } = await db.from("notifications").insert({
    user_id: userId,
    company_id: companyId,
    type: "system_alert",
    title: "Catalog ready",
    body: catalogReadyNotificationBody({
      products: productCount,
      stock: stockCount,
    }),
    is_read: false,
    persistent: false,
    action_url: "/catalog",
    action_label: "OPEN CATALOG",
  });
  return { error };
}
