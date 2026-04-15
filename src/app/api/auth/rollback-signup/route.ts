/**
 * POST /api/auth/rollback-signup
 *
 * Deletes a just-created Firebase Auth user when the Supabase sync step of
 * signup fails. Prevents the "half-created account" state where Firebase has
 * the user but Supabase doesn't, which would otherwise block all future
 * signup/login attempts for that email.
 *
 * Security: the caller must present the Firebase ID token of the account to
 * be deleted — we verify the token matches the UID before deleting, so an
 * attacker cannot weaponize this endpoint to nuke arbitrary accounts.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";
import { getAdminAuth } from "@/lib/firebase/admin-sdk";

interface RollbackBody {
  idToken: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { idToken } = (await req.json()) as RollbackBody;

    if (!idToken) {
      return NextResponse.json(
        { error: "Missing idToken" },
        { status: 400 }
      );
    }

    // Verify the token is valid and extract the UID. This ensures the caller
    // owns the account they are asking us to delete.
    const verified = await verifyFirebaseToken(idToken);
    const uid = verified.uid;

    // Delete the Firebase Auth user. Idempotent: if the user is already gone
    // (e.g. double-rollback), treat as success.
    const auth = getAdminAuth();
    try {
      await auth.deleteUser(uid);
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "auth/user-not-found") {
        throw err;
      }
    }

    return NextResponse.json({ success: true, uid });
  } catch (err) {
    console.error("[api/auth/rollback-signup] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Rollback failed" },
      { status: 500 }
    );
  }
}
