/**
 * SPEC operator gate — TypeScript mirror of `private.is_spec_operator()`.
 *
 * Why this exists: OPS-Web auth is Firebase, not Supabase auth. The SQL helper
 * `private.is_spec_operator()` resolves the calling user via `public.get_user_id()`
 * which reads `auth.jwt() ->> 'email'`. When we call Supabase with the service-role
 * client (the only way to read SPEC tables from the app), there is no `auth.jwt()` —
 * so the SQL helper would return false even for valid operators. We re-implement
 * the check in TS using the same data sources and grant logic.
 *
 * Locked invariants (must match the SQL function exactly):
 *  - Operator iff:
 *      (a) `role_permissions(permission='spec.admin', scope='all')` for any role
 *          held by the user via `user_roles`, OR
 *      (b) `user_permission_overrides(permission='spec.admin', granted=true)` for
 *          the user (the delegated-operator path).
 *  - NEVER consult `is_company_admin`, `account_holder_id`, or `admin_ids` — those
 *    are the customer-company admin trap that `public.has_permission()` falls into.
 *
 * SERVER ONLY. Never import from client components.
 */

import { getAdminSupabase } from "@/lib/supabase/admin-client";

const db = () => getAdminSupabase();

/**
 * Returns true iff the given OPS user holds the SPEC Operator gate.
 *
 * The `userId` is the OPS `public.users.id` (uuid). `user_roles.user_id` is `text`
 * (stores `users.id::text`); we pass the uuid string and Supabase casts it.
 * `user_permission_overrides.user_id` is `uuid`; same value works directly.
 */
export async function isSpecOperator(userId: string): Promise<boolean> {
  if (!userId) return false;

  // Path (a): SPEC Operator role grant
  const { data: heldRoles, error: rolesErr } = await db()
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);

  if (rolesErr) {
    console.error("[isSpecOperator] user_roles lookup failed:", rolesErr.message);
    return false;
  }

  const roleIds = (heldRoles ?? []).map((r) => r.role_id as string);
  if (roleIds.length > 0) {
    const { count, error: permErr } = await db()
      .from("role_permissions")
      .select("*", { count: "exact", head: true })
      .in("role_id", roleIds)
      .eq("permission", "spec.admin")
      .eq("scope", "all");

    if (permErr) {
      console.error("[isSpecOperator] role_permissions lookup failed:", permErr.message);
      return false;
    }
    if ((count ?? 0) > 0) return true;
  }

  // Path (b): user_permission_overrides (delegated operator)
  const { count: overrideCount, error: overrideErr } = await db()
    .from("user_permission_overrides")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("permission", "spec.admin")
    .eq("granted", true);

  if (overrideErr) {
    console.error(
      "[isSpecOperator] user_permission_overrides lookup failed:",
      overrideErr.message,
    );
    return false;
  }

  return (overrideCount ?? 0) > 0;
}

/**
 * Returns the list of OPS user_ids that satisfy `isSpecOperator(...)`. Used by
 * notification dispatch to fan an operator-facing event out to every operator.
 * Phase 1 currently only routes the gate to one or two operators; this scales
 * automatically if more operators are added via `user_permission_overrides`.
 */
export async function getSpecOperatorUserIds(): Promise<string[]> {
  const out = new Set<string>();

  // Operators via the SPEC Operator role grant.
  const { data: roleRows } = await db()
    .from("role_permissions")
    .select("role_id")
    .eq("permission", "spec.admin")
    .eq("scope", "all");

  const operatorRoleIds = (roleRows ?? []).map((r) => r.role_id as string);
  if (operatorRoleIds.length > 0) {
    const { data: roleHolders } = await db()
      .from("user_roles")
      .select("user_id")
      .in("role_id", operatorRoleIds);
    for (const row of roleHolders ?? []) {
      const uid = (row as { user_id: string }).user_id;
      if (uid) out.add(uid);
    }
  }

  // Operators via user_permission_overrides.
  const { data: overrideHolders } = await db()
    .from("user_permission_overrides")
    .select("user_id")
    .eq("permission", "spec.admin")
    .eq("granted", true);
  for (const row of overrideHolders ?? []) {
    const uid = (row as { user_id: string }).user_id;
    if (uid) out.add(uid);
  }

  return Array.from(out);
}
