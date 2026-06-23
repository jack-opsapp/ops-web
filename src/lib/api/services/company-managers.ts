import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve a company's authoritative MANAGEMENT user-ids — the account holder
 * plus the `admin_ids` list (the same set the permission system bypasses to
 * full access in `PermissionStore.fetchPermissions`).
 *
 * This replaces the banned `.in("role", ["admin", "owner"])` recipient queries
 * (root CLAUDE.md: never filter by role name): notification recipients are
 * derived from the explicit, intentional management list, never a role NAME.
 * `account_holder_id ∪ admin_ids` is the faithful equivalent of "owner + admins"
 * and is more reliable than the free-text `users.role` field, which can drift.
 *
 * Returns a deduped array (empty if the company is unconfigured — callers keep
 * their own non-role final fallback). Server-only — never import from client code.
 *
 * `admin_ids` is `text[]` in Supabase; some legacy rows stored a comma-separated
 * string, so both shapes are handled defensively (matching task-service's resolver).
 */
export async function getCompanyManagerUserIds(
  supabase: SupabaseClient,
  companyId: string
): Promise<string[]> {
  const { data: company } = await supabase
    .from("companies")
    .select("account_holder_id, admin_ids")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return [];

  const ids = new Set<string>();

  const holder = (company as { account_holder_id?: string | null }).account_holder_id;
  if (typeof holder === "string" && holder.length > 0) ids.add(holder);

  const rawAdminIds = (company as { admin_ids?: unknown }).admin_ids;
  if (Array.isArray(rawAdminIds)) {
    for (const v of rawAdminIds) {
      if (typeof v === "string" && v.length > 0) ids.add(v);
    }
  } else if (typeof rawAdminIds === "string" && rawAdminIds.length > 0) {
    for (const v of rawAdminIds.split(",").map((s) => s.trim())) {
      if (v) ids.add(v);
    }
  }

  return [...ids];
}
