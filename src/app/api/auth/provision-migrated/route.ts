/**
 * POST /api/auth/provision-migrated
 *
 * Auto-provisions a Firebase Auth account for users migrated from Bubble.io.
 * Called from the login page when email/password auth fails with INVALID_LOGIN_CREDENTIALS.
 *
 * No auth required — gated by Supabase query (user must have bubble_id set and no firebase_uid).
 *
 * Flow:
 *   1. Check Supabase for user with bubble_id IS NOT NULL, firebase_uid IS NULL, deleted_at IS NULL
 *   2. Create Firebase Auth account with random password
 *   3. Update firebase_uid in Supabase
 *   4. Send password reset email
 *   5. Return { provisioned: true } so the UI can show the "check your email" message
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { sendServerPasswordReset } from "@/lib/firebase/send-reset-email";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = body.email?.trim()?.toLowerCase();

    if (!email) {
      return NextResponse.json(
        { provisioned: false, error: "Email required" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();

    // Find migrated user without Firebase account
    const { data: user, error: queryError } = await supabase
      .from("users")
      .select("id, email, bubble_id, firebase_uid")
      .eq("email", email)
      .not("bubble_id", "is", null)
      .is("firebase_uid", null)
      .is("deleted_at", null)
      .maybeSingle();

    if (queryError) {
      console.error("[provision-migrated] Supabase query error:", queryError);
      return NextResponse.json({ provisioned: false }, { status: 500 });
    }

    if (!user) {
      // No migrated user found — could be wrong email or already provisioned
      return NextResponse.json({ provisioned: false });
    }

    // Create Firebase Auth account
    const adminAuth = getAdminAuth();
    let firebaseUid: string;

    try {
      const firebaseUser = await adminAuth.createUser({
        email: user.email,
        password: randomUUID(), // Random password — user will reset via email
      });
      firebaseUid = firebaseUser.uid;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;

      if (code === "auth/email-already-exists") {
        // Race condition or retry — user already exists in Firebase
        // Look up the existing account and link it
        try {
          const existingUser = await adminAuth.getUserByEmail(email);
          firebaseUid = existingUser.uid;
        } catch {
          console.error("[provision-migrated] Could not find existing Firebase user:", email);
          return NextResponse.json({ provisioned: false }, { status: 500 });
        }
      } else {
        console.error("[provision-migrated] Firebase createUser error:", err);
        return NextResponse.json({ provisioned: false }, { status: 500 });
      }
    }

    // Update Supabase with Firebase UID
    const { error: updateError } = await supabase
      .from("users")
      .update({ firebase_uid: firebaseUid })
      .eq("id", user.id);

    if (updateError) {
      console.error("[provision-migrated] Failed to update firebase_uid:", updateError);
      return NextResponse.json({ provisioned: false }, { status: 500 });
    }

    // Send password reset email
    try {
      await sendServerPasswordReset(email);
    } catch (err) {
      console.error("[provision-migrated] Failed to send reset email:", err);
      // Still return provisioned: true — the account exists, they can use "forgot password" manually
    }

    return NextResponse.json({
      provisioned: true,
      message: "Account created. Check your email to set your password.",
    });
  } catch (err) {
    console.error("[provision-migrated] Unexpected error:", err);
    return NextResponse.json({ provisioned: false }, { status: 500 });
  }
}
