/**
 * POST /api/setup/complete
 *
 * Marks onboarding as complete. Step-specific data (identity, company,
 * starfield) should already be saved via /api/setup/progress.
 *
 * - Verifies Firebase/Supabase auth token
 * - Sets onboarding_completed.web: true on the user record (JSONB merge)
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
    const userRow = await findUserByAuth(verifiedUser.uid, verifiedUser.email, "id, auth_id, firebase_uid, company_id, is_active, onboarding_completed");

    if (!userRow) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const userId = userRow.id as string;
    if (userRow.is_active !== true || (userRow.auth_id !== verifiedUser.uid && userRow.firebase_uid !== verifiedUser.uid)) {
      return NextResponse.json({ error: "Sign in again to finish setup." }, { status: 403 });
    }
    if (!userRow.company_id) {
      return NextResponse.json({ error: "Finish company setup before continuing." }, { status: 409 });
    }
    const { data: company, error: companyError } = await db.from("companies")
      .select("id")
      .eq("id", userRow.company_id as string).is("deleted_at", null).maybeSingle();
    if (companyError) return NextResponse.json({ error: "Setup couldn't be checked. Try again." }, { status: 503 });
    if (!company) {
      return NextResponse.json({ error: "Finish company setup before continuing." }, { status: 409 });
    }

    // Mark web onboarding as complete (JSONB merge preserves ios flag)
    const currentOnboarding = (userRow as Record<string, unknown>).onboarding_completed as Record<string, boolean> | null;
    const { data: saved, error: saveError } = await db
      .from("users")
      .update({
        onboarding_completed: { ...currentOnboarding, web: true },
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .eq("company_id", userRow.company_id as string)
      .eq("is_active", true).is("deleted_at", null)
      .select("id").maybeSingle();

    if (saveError || !saved) {
      return NextResponse.json({ error: "Setup didn't save. Try again." }, { status: 500 });
    }

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
