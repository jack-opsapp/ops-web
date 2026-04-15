/**
 * PATCH /api/users/:id/role
 *
 * Assigns an RBAC role to a user. Also marks any related role_needed
 * notifications (for the caller's company admins) as read so the rail
 * notification disappears immediately after action.
 *
 * Body: { idToken, roleId }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { checkPermission } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

interface AssignRoleBody {
  idToken: string;
  roleId: string;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: targetUserId } = await context.params;
    const body = (await req.json()) as AssignRoleBody;
    const { idToken, roleId } = body;

    if (!idToken || !roleId || !targetUserId) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, roleId, user id" },
        { status: 400 }
      );
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

    const { data: targetRow } = await db
      .from("users")
      .select("id, company_id")
      .eq("id", targetUserId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!targetRow) {
      return NextResponse.json({ error: "Target user not found" }, { status: 404 });
    }

    if (targetRow.company_id !== caller.company_id) {
      return NextResponse.json(
        { error: "Target user is not in your company" },
        { status: 403 }
      );
    }

    // Permission check — team.assign_roles with company-admin fallback
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
          { error: "You don't have permission to assign roles" },
          { status: 403 }
        );
      }
    }

    const { data: roleRow } = await db
      .from("roles")
      .select("id, name")
      .eq("id", roleId)
      .maybeSingle();
    if (!roleRow) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const { error: upsertError } = await db
      .from("user_roles")
      .upsert(
        { user_id: targetUserId, role_id: roleId },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to assign role: ${upsertError.message}` },
        { status: 500 }
      );
    }

    // Sync users.role legacy column
    const legacyRoleName = (roleRow.name as string).toLowerCase();
    const legacyValue = ["admin", "owner", "office", "operator", "crew", "unassigned"].includes(
      legacyRoleName
    )
      ? legacyRoleName
      : "unassigned";

    await db
      .from("users")
      .update({ role: legacyValue, updated_at: new Date().toISOString() })
      .eq("id", targetUserId);

    // Mark related role_needed notifications for this member as read.
    // The notification action_url contains ?assignRole=<memberId> so we
    // can match by LIKE on that substring.
    const actionUrlFragment = `%assignRole=${targetUserId}%`;
    await db
      .from("notifications")
      .update({ is_read: true })
      .eq("company_id", caller.company_id as string)
      .eq("type", "role_needed")
      .like("action_url", actionUrlFragment)
      .eq("is_read", false);

    return NextResponse.json({
      success: true,
      userId: targetUserId,
      roleId,
      roleName: roleRow.name,
    });
  } catch (error) {
    console.error("[api/users/[id]/role] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
