/**
 * POST /api/admin/users/create
 *
 * Creates a new user in both Supabase and Firebase.
 * Sends a password reset email so the user can set their password.
 * Requires dev_permission.
 *
 * Body: { email, firstName, lastName, role, companyId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireDevPermission } from "@/lib/firebase/admin-auth-helpers";
import { getAdminAuth } from "@/lib/firebase/admin";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { sendServerPasswordReset } from "@/lib/firebase/send-reset-email";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const authResult = await requireDevPermission(req);
  if (authResult instanceof NextResponse) return authResult;

  const body = await req.json();
  const { email, firstName, lastName, role, companyId } = body;

  if (!email || !firstName || !lastName) {
    return NextResponse.json(
      { error: "email, firstName, and lastName are required" },
      { status: 400 }
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  const supabase = getServiceRoleClient();

  // Check for existing user with same email
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 }
    );
  }

  // Create Firebase account
  const adminAuth = getAdminAuth();
  let firebaseUid: string;

  try {
    const firebaseUser = await adminAuth.createUser({
      email: normalizedEmail,
      password: randomUUID(),
      displayName: `${firstName} ${lastName}`,
    });
    firebaseUid = firebaseUser.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      // Account exists in Firebase but not Supabase — link it
      try {
        const existingFirebase = await adminAuth.getUserByEmail(normalizedEmail);
        firebaseUid = existingFirebase.uid;
      } catch {
        return NextResponse.json(
          { error: "Firebase account exists but could not be retrieved" },
          { status: 500 }
        );
      }
    } else {
      console.error("[admin/users/create] Firebase createUser error:", err);
      return NextResponse.json(
        { error: "Failed to create Firebase account" },
        { status: 500 }
      );
    }
  }

  // Create Supabase user row
  const userId = randomUUID();
  const { error: insertError } = await supabase.from("users").insert({
    id: userId,
    email: normalizedEmail,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    role: role || "Field Crew",
    company_id: companyId || null,
    firebase_uid: firebaseUid,
  });

  if (insertError) {
    console.error("[admin/users/create] Supabase insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to create user in database" },
      { status: 500 }
    );
  }

  // Send password reset email
  try {
    await sendServerPasswordReset(normalizedEmail);
  } catch (err) {
    console.warn("[admin/users/create] Reset email failed:", err);
  }

  return NextResponse.json({
    user: {
      id: userId,
      email: normalizedEmail,
      firebaseUid,
    },
  });
}
