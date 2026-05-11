/**
 * POST /api/admin/users/provision
 *
 * Bulk or single-user Firebase provisioning for migrated Bubble users.
 * Requires dev_permission.
 *
 * Body: { mode: "all" } — provision all users needing setup
 *   or: { mode: "single", userId: string } — provision one user
 */

import { NextRequest, NextResponse } from "next/server";
import { requireDevPermission } from "@/lib/firebase/admin-auth-helpers";
import { getAdminAuth } from "@/lib/firebase/admin";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { sendServerPasswordReset } from "@/lib/firebase/send-reset-email";
import { randomUUID } from "crypto";

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const authResult = await requireDevPermission(req);
  if (authResult instanceof NextResponse) return authResult;

  const body = await req.json();
  const mode: string = body.mode;
  const userId: string | undefined = body.userId;

  if (mode !== "all" && mode !== "single") {
    return NextResponse.json(
      { error: 'mode must be "all" or "single"' },
      { status: 400 }
    );
  }

  if (mode === "single" && !userId) {
    return NextResponse.json(
      { error: "userId required for single mode" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();

  // Find users needing provisioning
  let query = supabase
    .from("users")
    .select("id, email, bubble_id")
    .is("firebase_uid", null)
    .is("deleted_at", null)
    .not("email", "is", null);

  if (mode === "single") {
    query = query.eq("id", userId);
  }

  const { data: users, error: queryError } = await query;

  if (queryError) {
    console.error("[admin/users/provision] Query error:", queryError);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }

  if (!users || users.length === 0) {
    return NextResponse.json({
      provisioned: 0,
      failed: 0,
      errors: [],
      results: [],
      message: "No users need provisioning",
    });
  }

  const adminAuth = getAdminAuth();
  const results: { id: string; email: string; success: boolean; error?: string }[] = [];
  let provisioned = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const user of users) {
    try {
      // Create Firebase account
      let firebaseUid: string;
      try {
        const firebaseUser = await adminAuth.createUser({
          email: user.email,
          password: randomUUID(),
        });
        firebaseUid = firebaseUser.uid;
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === "auth/email-already-exists") {
          const existing = await adminAuth.getUserByEmail(user.email);
          firebaseUid = existing.uid;
        } else {
          throw err;
        }
      }

      // Update Supabase
      await supabase
        .from("users")
        .update({ firebase_uid: firebaseUid })
        .eq("id", user.id);

      // Send reset email
      try {
        await sendServerPasswordReset(user.email);
      } catch (emailErr) {
        console.warn("[admin/users/provision] Reset email failed for", user.email, emailErr);
      }

      results.push({ id: user.id, email: user.email, success: true });
      provisioned++;

      // Rate limit: 200ms between Firebase creates
      if (users.indexOf(user) < users.length - 1) {
        await delay(200);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ id: user.id, email: user.email, success: false, error: message });
      errors.push(`${user.email}: ${message}`);
      failed++;
    }
  }

  return NextResponse.json({ provisioned, failed, errors, results });
}
