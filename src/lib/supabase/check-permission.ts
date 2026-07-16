/**
 * OPS Web - Server-Side Permission Check
 *
 * Verifies that a user has a specific permission by calling the
 * public.has_permission(p_user_id uuid, p_permission text, p_required_scope
 * text) RPC with the service-role client. Mirrors the client-side
 * PermissionStore.can() semantics: admins and account holders bypass; all
 * other users must hold a role whose scope for the permission satisfies the
 * requested scope (all > assigned > own).
 *
 * Fail-closed: any unexpected RPC error returns false so an endpoint cannot
 * accidentally open up due to a missing function or a transient error. Every
 * failure is logged with enough context (user, permission, code, message,
 * hint) to be actionable from server logs — silent `return false` was the
 * root cause of a recent production 403 storm on /api/inbox/threads that
 * took hours to diagnose because the RPC error was swallowed without trace.
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

export type PermissionScope = "all" | "assigned" | "own";

function logRpcFailure(
  context: "checkPermission" | "checkPermissionById",
  userId: string,
  permission: string,
  scope: PermissionScope | undefined,
  err: { code?: string; message?: string; details?: string; hint?: string }
) {
  // Single-line structured log so it survives log aggregation and is greppable.
  // Deliberately uses console.error — Next.js captures server logs and this
  // ensures the failure surfaces in Vercel / Railway / wherever the app runs.
  console.error(
    `[${context}] RPC has_permission failed (fail-closed) — ` +
      `user=${userId} permission=${permission}${scope ? ` scope=${scope}` : ""} ` +
      `code=${err.code ?? "?"} message=${err.message ?? "?"} ` +
      `hint=${err.hint ?? "?"} details=${err.details ?? "?"}`
  );
}

/**
 * Check if a user (by Firebase auth_id) has a specific permission.
 * Resolves the user → user_roles → role_permissions chain server-side.
 */
export async function checkPermission(
  authId: string,
  permission: string,
  email?: string,
  requiredScope?: PermissionScope
): Promise<boolean> {
  const user = await findUserByAuth(authId, email, "id");
  if (!user) return false;

  const db = getServiceRoleClient();
  const { data, error } = await db.rpc("has_permission", {
    p_user_id: user.id,
    p_permission: permission,
    ...(requiredScope ? { p_required_scope: requiredScope } : {}),
  });

  if (error) {
    logRpcFailure(
      "checkPermission",
      user.id as string,
      permission,
      requiredScope,
      error
    );
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
  permission: string,
  requiredScope?: PermissionScope
): Promise<boolean> {
  const db = getServiceRoleClient();

  const { data, error } = await db.rpc("has_permission", {
    p_user_id: userId,
    p_permission: permission,
    ...(requiredScope ? { p_required_scope: requiredScope } : {}),
  });

  if (error) {
    logRpcFailure(
      "checkPermissionById",
      userId,
      permission,
      requiredScope,
      error
    );
    return false;
  }

  return data === true;
}

/**
 * Resolve the caller's widest effective scope for one permission.
 *
 * `has_permission` already owns admin bypasses, per-user overrides, role
 * grants, and the all > assigned > own hierarchy. Asking it from widest to
 * narrowest keeps this server helper in lockstep with that canonical engine
 * without recreating permission joins in service-role routes.
 */
export async function resolvePermissionScopeById(
  userId: string,
  permission: string
): Promise<PermissionScope | null> {
  if (!userId.trim() || !permission.trim()) return null;

  if (await checkPermissionById(userId, permission, "all")) return "all";
  if (await checkPermissionById(userId, permission, "assigned")) {
    return "assigned";
  }
  if (await checkPermissionById(userId, permission, "own")) return "own";
  return null;
}
