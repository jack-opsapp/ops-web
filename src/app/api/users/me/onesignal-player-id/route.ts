/**
 * PATCH /api/users/me/onesignal-player-id
 *
 * Persists the caller's OneSignal subscription ID (player ID) to
 * users.onesignal_player_id. Called by the iOS app after login once
 * OneSignal.User.pushSubscription.id is available.
 *
 * Body: { idToken: string; playerId: string }
 *
 * Security:
 *   - Firebase ID token verified via verifyAuthToken.
 *   - User identified from auth_id / firebase_uid / email (findUserByAuth).
 *   - User can only update their own record (userId from token, not body).
 *   - Write uses service-role client (bypasses RLS).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

interface PatchBody {
  idToken: string;
  playerId: string;
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as PatchBody;
    const { idToken, playerId } = body;

    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json(
        { error: "Missing required field: idToken" },
        { status: 400 }
      );
    }

    if (!playerId || typeof playerId !== "string" || playerId.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing required field: playerId" },
        { status: 400 }
      );
    }

    const firebaseUser = await verifyAuthToken(idToken);

    const user = await findUserByAuth(
      firebaseUser.uid,
      firebaseUser.email,
      "id, company_id"
    );

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const db = getServiceRoleClient();

    const { error: updateError } = await db
      .from("users")
      .update({ onesignal_player_id: playerId.trim() })
      .eq("id", user.id as string);

    if (updateError) {
      console.error(
        "[api/users/me/onesignal-player-id] update failed:",
        updateError
      );
      return NextResponse.json(
        { error: "Failed to update player ID" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/users/me/onesignal-player-id] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
