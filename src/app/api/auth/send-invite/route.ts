/**
 * POST /api/auth/send-invite
 *
 * Sends team invites via email (SendGrid) and/or SMS (Twilio).
 * - Verifies the Firebase ID token
 * - Validates the requesting user belongs to the specified company
 * - Sends email invites for each address in `emails`
 * - Sends SMS invites for each number in `phones`
 *
 * Body: { idToken, emails?: string[], phones?: string[], companyId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { sendTeamInvite } from "@/lib/email/sendgrid";
import { sendTeamInviteSMS } from "@/lib/sms/twilio";

// ─── Request Body ────────────────────────────────────────────────────────────

interface SendInviteBody {
  idToken: string;
  emails?: string[];
  phones?: string[];
  companyId: string;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as SendInviteBody;
    const { idToken, emails, phones, companyId } = body;

    if (!idToken || !companyId) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, companyId" },
        { status: 400 }
      );
    }

    const hasEmails = Array.isArray(emails) && emails.length > 0;
    const hasPhones = Array.isArray(phones) && phones.length > 0;

    if (!hasEmails && !hasPhones) {
      return NextResponse.json(
        { error: "At least one email or phone number is required" },
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
      .select("id, name, external_id, logo_url")
      .eq("id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const inviteCode = company.external_id || company.id;
    const joinUrl = `${process.env.NEXT_PUBLIC_APP_URL}/join?code=${inviteCode}`;
    let emailsSent = 0;
    let smsSent = 0;

    // Send email invites via SendGrid
    if (hasEmails) {
      for (const email of emails) {
        try {
          await sendTeamInvite({
            email,
            companyName: company.name,
            joinUrl,
            logoUrl: company.logo_url,
          });
          emailsSent++;
        } catch (emailError) {
          console.error(`[api/auth/send-invite] Email failed for ${email}:`, emailError);
        }
      }
    }

    // Send SMS invites via Twilio
    if (hasPhones) {
      for (const phone of phones) {
        try {
          await sendTeamInviteSMS({
            phone,
            companyName: company.name,
            joinUrl,
          });
          smsSent++;
        } catch (smsError) {
          console.error(`[api/auth/send-invite] SMS failed for ${phone}:`, smsError);
        }
      }
    }

    return NextResponse.json({
      success: true,
      emailsSent,
      smsSent,
      invitesSent: emailsSent + smsSent,
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
