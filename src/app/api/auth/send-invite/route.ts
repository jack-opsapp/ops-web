/**
 * POST /api/auth/send-invite
 *
 * Sends team invite emails for a company.
 * - Verifies the Firebase ID token
 * - Validates the requesting user belongs to the specified company
 * - Returns success (actual email sending via SendGrid to be wired later)
 *
 * Body: { idToken, emails: string[], companyId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

// ─── Request Body ────────────────────────────────────────────────────────────

interface SendInviteBody {
  idToken: string;
  emails: string[];
  companyId: string;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as SendInviteBody;
    const { idToken, emails, companyId } = body;

    if (!idToken || !emails || !companyId) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, emails, companyId" },
        { status: 400 }
      );
    }

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { error: "emails must be a non-empty array" },
        { status: 400 }
      );
    }

    // Verify Firebase ID token
    const firebaseUser = await verifyFirebaseToken(idToken);

    // Verify the requesting user exists and belongs to the specified company
    const db = getServiceRoleClient();
    const { data: requestingUser } = await db
      .from("users")
      .select("id, company_id")
      .eq("auth_id", firebaseUser.uid)
      .is("deleted_at", null)
      .maybeSingle();

    if (!requestingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (requestingUser.company_id !== companyId) {
      return NextResponse.json(
        { error: "You can only send invites for your own company" },
        { status: 403 }
      );
    }

    // Verify the company exists
    const { data: company } = await db
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // TODO: Wire up SendGrid email integration here.
    // For each email in `emails`, send an invite email with the company code
    // and a link to join the company. The company's external_id or id can be
    // used as the invite code.

    return NextResponse.json({
      success: true,
      invitesSent: emails.length,
    });
  } catch (error) {
    console.error("[api/auth/send-invite] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
