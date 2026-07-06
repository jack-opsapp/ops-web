/**
 * PUT /api/users/:id/permission-overrides
 *
 * Batch-applies per-member permission exceptions (user_permission_overrides).
 * The write path for the Team member access editor — writes go through the
 * service role behind a full guard chain (mirrors PATCH /api/users/:id/role):
 *
 *   1. Body shape: { idToken, set: [{permission, scope, granted}], clear: [permission] }
 *      — at least one change; set∩clear must be empty; every permission must
 *      exist in the shared registry (ALL_PERMISSIONS — spec.admin can never
 *      transit this route); a grant's scope must be one the action supports.
 *   2. Firebase token verify → caller lookup.
 *   3. Target must exist, be live, and share the caller's company.
 *   4. Target must NOT be a bypass admin (is_company_admin / account holder /
 *      admin_ids) — 409 target_is_admin; exceptions are meaningless for them
 *      and the DB functions would ignore the rows anyway.
 *   5. Caller must hold team.assign_roles (RPC) or be in admin_ids.
 *   6. Upsert on (user_id, permission) with the TARGET's company_id; delete
 *      cleared rows; notify the member (standard, dismissible — non-fatal).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { checkPermission } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { ALL_PERMISSIONS, getPermissionScopes } from "@/lib/types/permissions";
import type { PermissionScope } from "@/lib/types/permissions";

interface OverrideSetEntry {
  permission: string;
  scope: PermissionScope | null;
  granted: boolean;
}

interface OverridesBody {
  idToken: string;
  set: OverrideSetEntry[];
  clear: string[];
}

const VALID_SCOPES: ReadonlySet<string> = new Set(["all", "assigned", "own"]);
const REGISTERED: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

function validatePayload(set: OverrideSetEntry[], clear: string[]): string | null {
  if (set.length === 0 && clear.length === 0) {
    return "No changes in payload";
  }
  const seen = new Set<string>();
  for (const entry of set) {
    if (!entry || typeof entry.permission !== "string" || typeof entry.granted !== "boolean") {
      return "Malformed set entry";
    }
    if (!REGISTERED.has(entry.permission)) {
      return `Unknown permission: ${entry.permission}`;
    }
    if (entry.granted) {
      if (typeof entry.scope !== "string" || !VALID_SCOPES.has(entry.scope)) {
        return `A grant needs a scope: ${entry.permission}`;
      }
      if (!getPermissionScopes(entry.permission).includes(entry.scope)) {
        return `Scope ${entry.scope} not supported by ${entry.permission}`;
      }
    } else if (entry.scope !== null && entry.scope !== undefined) {
      return `A revoke carries no scope: ${entry.permission}`;
    }
    if (seen.has(entry.permission)) return `Duplicate permission in set: ${entry.permission}`;
    seen.add(entry.permission);
  }
  for (const permission of clear) {
    if (typeof permission !== "string" || !REGISTERED.has(permission)) {
      return `Unknown permission: ${String(permission)}`;
    }
    if (seen.has(permission)) return `Permission in both set and clear: ${permission}`;
    seen.add(permission);
  }
  return null;
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: targetUserId } = await context.params;
    const body = (await req.json()) as Partial<OverridesBody>;
    const idToken = body.idToken;
    const set = Array.isArray(body.set) ? (body.set as OverrideSetEntry[]) : [];
    const clear = Array.isArray(body.clear) ? (body.clear as string[]) : [];

    if (!idToken || !targetUserId) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, user id" },
        { status: 400 }
      );
    }

    const payloadError = validatePayload(set, clear);
    if (payloadError) {
      return NextResponse.json({ error: payloadError }, { status: 400 });
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
      .select("id, company_id, is_company_admin, first_name, last_name")
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

    const { data: companyRow } = await db
      .from("companies")
      .select("account_holder_id, admin_ids")
      .eq("id", caller.company_id as string)
      .maybeSingle();

    const adminIds: string[] = (companyRow?.admin_ids as string[]) ?? [];
    const targetIsAdmin =
      Boolean(targetRow.is_company_admin) ||
      companyRow?.account_holder_id === targetUserId ||
      adminIds.includes(targetUserId);

    if (targetIsAdmin) {
      // Bypass admins hold everything by definition — the DB functions ignore
      // override rows for them, so accepting writes would only mislead.
      return NextResponse.json({ error: "target_is_admin" }, { status: 409 });
    }

    // Permission check — team.assign_roles with company-admin fallback.
    const rbacAllowed = await checkPermission(
      firebaseUser.uid,
      "team.assign_roles",
      firebaseUser.email
    );
    if (!rbacAllowed && !adminIds.includes(caller.id as string)) {
      return NextResponse.json(
        { error: "You don't have permission to change member access" },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();

    if (set.length > 0) {
      const rows = set.map((entry) => ({
        user_id: targetUserId,
        company_id: targetRow.company_id,
        permission: entry.permission,
        scope: entry.granted ? entry.scope : null,
        granted: entry.granted,
        updated_at: now,
      }));
      const { error: upsertError } = await db
        .from("user_permission_overrides")
        .upsert(rows, { onConflict: "user_id,permission" });
      if (upsertError) {
        return NextResponse.json(
          { error: `Failed to apply exceptions: ${upsertError.message}` },
          { status: 500 }
        );
      }
    }

    if (clear.length > 0) {
      const { error: deleteError } = await db
        .from("user_permission_overrides")
        .delete()
        .eq("user_id", targetUserId)
        .in("permission", clear);
      if (deleteError) {
        return NextResponse.json(
          { error: `Failed to clear exceptions: ${deleteError.message}` },
          { status: 500 }
        );
      }
    }

    // Standard dismissible notification to the affected member. Non-fatal:
    // access is already changed; a failed notification must not fail the save.
    const { error: notifError } = await db.from("notifications").insert({
      user_id: targetUserId,
      company_id: targetRow.company_id,
      type: "permission_change",
      title: "Access updated",
      body: "Your access was updated. Changes are live now.",
      is_read: false,
      persistent: false,
    });
    if (notifError) {
      console.error(
        `[api/users/[id]/permission-overrides] notification insert failed: ${notifError.message}`
      );
    }

    return NextResponse.json({
      success: true,
      userId: targetUserId,
      applied: set.length,
      cleared: clear.length,
    });
  } catch (error) {
    console.error("[api/users/[id]/permission-overrides] Error:", error);
    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
