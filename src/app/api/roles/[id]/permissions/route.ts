/**
 * PUT /api/roles/:id/permissions
 *
 * Replaces a custom role's permission set. This is the working write path for
 * the Roles editor — the previous client-side direct-table write bounced off
 * RLS (anon has no write grant on role_permissions), leaving the editor a
 * facade. Writes run through the service role behind the same guard chain as
 * the other team routes:
 *
 *   1. Body: { idToken, permissions: [{permission, scope}] } — every
 *      permission registered (ALL_PERMISSIONS), every scope supported by its
 *      action. An empty list clears the role.
 *   2. Firebase token verify → caller lookup.
 *   3. Role must exist, be non-preset, and belong to the caller's company.
 *   4. Caller must hold team.assign_roles (RPC) or be in admin_ids.
 *   5. Transactional-ish replace: snapshot → delete → insert; on insert
 *      failure the snapshot is restored.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { checkPermission } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { ALL_PERMISSIONS, getPermissionScopes } from "@/lib/types/permissions";
import type { PermissionScope } from "@/lib/types/permissions";

interface RolePermissionEntry {
  permission: string;
  scope: PermissionScope;
}

const REGISTERED: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

function validatePermissions(permissions: RolePermissionEntry[]): string | null {
  const seen = new Set<string>();
  for (const entry of permissions) {
    if (!entry || typeof entry.permission !== "string" || typeof entry.scope !== "string") {
      return "Malformed permission entry";
    }
    if (!REGISTERED.has(entry.permission)) {
      return `Unknown permission: ${entry.permission}`;
    }
    if (!getPermissionScopes(entry.permission).includes(entry.scope)) {
      return `Scope ${entry.scope} not supported by ${entry.permission}`;
    }
    if (seen.has(entry.permission)) {
      return `Duplicate permission: ${entry.permission}`;
    }
    seen.add(entry.permission);
  }
  return null;
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: roleId } = await context.params;
    const body = (await req.json()) as {
      idToken?: string;
      permissions?: RolePermissionEntry[];
    };
    const idToken = body.idToken;
    const permissions = Array.isArray(body.permissions) ? body.permissions : null;

    if (!idToken || !roleId || permissions === null) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, role id, permissions" },
        { status: 400 }
      );
    }

    const validationError = validatePermissions(permissions);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const firebaseUser = await verifyAuthToken(idToken);
    const caller = await findUserByAuth(
      firebaseUser.uid,
      firebaseUser.email,
      "id, company_id"
    );
    if (!caller) {
      return NextResponse.json({ error: "Caller not found" }, { status: 404 });
    }

    const db = getServiceRoleClient();

    const { data: roleRow } = await db
      .from("roles")
      .select("id, is_preset, company_id")
      .eq("id", roleId)
      .maybeSingle();

    if (!roleRow) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }
    if (roleRow.is_preset) {
      return NextResponse.json(
        { error: "Preset roles cannot be edited" },
        { status: 403 }
      );
    }
    if (roleRow.company_id !== caller.company_id) {
      return NextResponse.json(
        { error: "Role is not in your company" },
        { status: 403 }
      );
    }

    // Permission check — team.assign_roles with company-admin fallback.
    const rbacAllowed = await checkPermission(
      firebaseUser.uid,
      "team.assign_roles",
      firebaseUser.email
    );
    if (!rbacAllowed) {
      const { data: companyRow } = await db
        .from("companies")
        .select("admin_ids")
        .eq("id", caller.company_id as string)
        .maybeSingle();
      const adminIds: string[] = (companyRow?.admin_ids as string[]) ?? [];
      if (!adminIds.includes(caller.id as string)) {
        return NextResponse.json(
          { error: "You don't have permission to edit roles" },
          { status: 403 }
        );
      }
    }

    // Snapshot existing permissions so a failed insert can restore them.
    const { data: existing } = await db
      .from("role_permissions")
      .select("role_id, permission, scope")
      .eq("role_id", roleId);

    const { error: deleteError } = await db
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId);

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to clear role permissions: ${deleteError.message}` },
        { status: 500 }
      );
    }

    if (permissions.length > 0) {
      const rows = permissions.map((p) => ({
        role_id: roleId,
        permission: p.permission,
        scope: p.scope,
      }));
      const { error: insertError } = await db.from("role_permissions").insert(rows);

      if (insertError) {
        if (existing && existing.length > 0) {
          await db.from("role_permissions").insert(existing);
        }
        return NextResponse.json(
          { error: `Failed to set role permissions: ${insertError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, roleId, count: permissions.length });
  } catch (error) {
    console.error("[api/roles/[id]/permissions] Error:", error);
    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
