/**
 * OPS Web - Server-Side Permission Check
 *
 * Verifies that a user has a specific permission by querying Supabase.
 * Uses the `has_permission()` database function created in the permissions migration.
 *
 * Usage in API routes:
 *   const user = await verifyAdminAuth(req);
 *   if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *
 *   const allowed = await checkPermission(user.uid, "team.manage");
 *   if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 *
 * NEVER import this from client-side code.
 */

import { getServiceRoleClient } from "./server-client";
import { findUserByAuth } from "./find-user-by-auth";

/**
 * Check if a user (by Firebase auth_id) has a specific permission.
 * Resolves the user → user_roles → role_permissions chain server-side.
 */
export async function checkPermission(
  authId: string,
  permission: string,
  email?: string
): Promise<boolean> {
  // Look up the user's Supabase UUID from their auth credentials
  const user = await findUserByAuth(authId, email, "id");

  if (!user) return false;

  // Use the has_permission() function from the migration
  const db = getServiceRoleClient();
  const { data, error } = await db.rpc("has_permission", {
    p_user_id: user.id,
    p_permission: permission,
  });

  if (error) {
    console.error("[checkPermission] RPC error:", error);
    return false;
  }

  return data === true;
}

/**
 * Check if a user (by Supabase user UUID) has a specific permission.
 * Use when you already have the user's UUID.
 */
export async function checkPermissionById(
  userId: string,
  permission: string
): Promise<boolean> {
  const db = getServiceRoleClient();

  const { data, error } = await db.rpc("has_permission", {
    p_user_id: userId,
    p_permission: permission,
  });

  if (error) {
    console.error("[checkPermissionById] RPC error:", error);
    return false;
  }

  return data === true;
}
