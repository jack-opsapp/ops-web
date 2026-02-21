/**
 * DELETE /api/admin/users/[id]
 *
 * Soft-deletes a user by setting deleted_at in Supabase
 * and disabling their Firebase Auth account.
 * Requires dev_permission.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireDevPermission } from "@/lib/firebase/admin-auth-helpers";
import { getAdminAuth } from "@/lib/firebase/admin";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireDevPermission(req);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();

  // Fetch user to get firebase_uid
  const { data: user, error: fetchError } = await supabase
    .from("users")
    .select("id, firebase_uid")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    console.error("[admin/users/delete] Fetch error:", fetchError);
    return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Soft-delete in Supabase
  const { error: updateError } = await supabase
    .from("users")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) {
    console.error("[admin/users/delete] Update error:", updateError);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }

  // Disable Firebase account if it exists
  if (user.firebase_uid) {
    try {
      const adminAuth = getAdminAuth();
      await adminAuth.updateUser(user.firebase_uid, { disabled: true });
    } catch (err) {
      console.warn("[admin/users/delete] Failed to disable Firebase account:", err);
      // Non-fatal — Supabase soft-delete already succeeded
    }
  }

  return NextResponse.json({ success: true });
}
