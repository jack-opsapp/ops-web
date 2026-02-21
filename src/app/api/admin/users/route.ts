/**
 * GET /api/admin/users
 *
 * Lists all non-deleted users with their Firebase provisioning status.
 * Requires dev_permission.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireDevPermission } from "@/lib/firebase/admin-auth-helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

type FirebaseStatus = "provisioned" | "needs_setup" | "no_email";

export async function GET(req: NextRequest) {
  const authResult = await requireDevPermission(req);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = getServiceRoleClient();

  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, first_name, last_name, role, bubble_id, firebase_uid, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/users] Query error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }

  const mapped = (users || []).map((u) => {
    let firebaseStatus: FirebaseStatus;
    if (!u.email) {
      firebaseStatus = "no_email";
    } else if (u.firebase_uid) {
      firebaseStatus = "provisioned";
    } else {
      firebaseStatus = "needs_setup";
    }

    return {
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      role: u.role,
      bubbleId: u.bubble_id,
      firebaseUid: u.firebase_uid,
      firebaseStatus,
      createdAt: u.created_at,
    };
  });

  const stats = {
    total: mapped.length,
    provisioned: mapped.filter((u) => u.firebaseStatus === "provisioned").length,
    needsSetup: mapped.filter((u) => u.firebaseStatus === "needs_setup").length,
    noEmail: mapped.filter((u) => u.firebaseStatus === "no_email").length,
  };

  return NextResponse.json({ users: mapped, stats });
}
