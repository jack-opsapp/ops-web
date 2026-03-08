/**
 * POST /api/setup/complete
 *
 * Marks onboarding as complete. Step-specific data (identity, company,
 * starfield) should already be saved via /api/setup/progress.
 *
 * - Verifies Firebase/Supabase auth token
 * - Sets has_completed_onboarding: true on the user record
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

// ─── Request Body ────────────────────────────────────────────────────────────

interface SetupCompleteBody {
  token: string;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as SetupCompleteBody;
    const { token } = body;

    if (!token) {
      return NextResponse.json(
        { error: "Missing required field: token" },
        { status: 400 }
      );
    }

    // Verify auth token
    const verifiedUser = await verifyAuthToken(token);

    const db = getServiceRoleClient();

    // Find the user by auth credentials (auth_id → firebase_uid → email)
    const userRow = await findUserByAuth(verifiedUser.uid, verifiedUser.email, "id");

    if (!userRow) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const userId = userRow.id as string;

    // Mark onboarding as complete
    await db
      .from("users")
      .update({
        has_completed_onboarding: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/setup/complete] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
