/**
 * POST /api/employee-setup/progress
 *
 * Saves employee onboarding data incrementally.
 * Requires Firebase ID token in body.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function POST(req: NextRequest) {
  try {
    const { idToken, ...fields } = await req.json();
    if (!idToken) {
      return NextResponse.json({ error: "Missing idToken" }, { status: 401 });
    }

    const firebaseUser = await verifyAuthToken(idToken);
    const db = getServiceRoleClient();

    // Find user by auth_id
    const { data: user } = await db
      .from("users")
      .select("id")
      .eq("auth_id", firebaseUser.uid)
      .is("deleted_at", null)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Build update payload from allowed fields
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (fields.firstName !== undefined) update.first_name = fields.firstName;
    if (fields.lastName !== undefined) update.last_name = fields.lastName;
    if (fields.phone !== undefined) update.phone = fields.phone;
    if (fields.profileImageURL !== undefined)
      update.profile_image_url = fields.profileImageURL;
    if (fields.emergencyContactName !== undefined)
      update.emergency_contact_name = fields.emergencyContactName;
    if (fields.emergencyContactPhone !== undefined)
      update.emergency_contact_phone = fields.emergencyContactPhone;
    if (fields.emergencyContactRelationship !== undefined)
      update.emergency_contact_relationship =
        fields.emergencyContactRelationship;

    const { error: updateError } = await db
      .from("users")
      .update(update)
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[employee-setup/progress] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
