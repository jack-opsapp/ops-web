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
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { checkPermission } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { sendTeamInvite } from "@/lib/email/sendgrid";
import { sendTeamInviteSMS } from "@/lib/sms/twilio";

// ─── Request Body ────────────────────────────────────────────────────────────

interface SendInviteBody {
  idToken: string;
  emails?: string[];
  phones?: string[];
  companyId: string;
  roleId?: string;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as SendInviteBody;
    const { idToken, emails, phones, companyId, roleId } = body;

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

    // Verify auth token (Supabase or Firebase)
    const firebaseUser = await verifyAuthToken(idToken);

    // Verify the requesting user exists and belongs to the specified company
    const db = getServiceRoleClient();
    const requestingUser = await findUserByAuth(firebaseUser.uid, firebaseUser.email, "id, company_id, first_name, last_name, email");

    if (!requestingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (requestingUser.company_id !== companyId) {
      return NextResponse.json(
        { error: "You can only send invites for your own company" },
        { status: 403 }
      );
    }

    // Verify user has permission to manage team (RBAC check + company admin fallback)
    const rbacAllowed = await checkPermission(firebaseUser.uid, "team.manage", firebaseUser.email);
    if (!rbacAllowed) {
      // Fallback: check if user is a company admin (in admin_ids)
      const { data: companyRow } = await db
        .from("companies")
        .select("admin_ids")
        .eq("id", companyId)
        .maybeSingle();

      const adminIds: string[] = (companyRow?.admin_ids as string[]) ?? [];
      const isCompanyAdmin = adminIds.includes(requestingUser.id as string);

      if (!isCompanyAdmin) {
        return NextResponse.json(
          { error: "You don't have permission to send invites" },
          { status: 403 }
        );
      }
    }

    // Verify the company exists
    const { data: company } = await db
      .from("companies")
      .select("id, name, company_code, logo_url")
      .eq("id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const inviteCode = company.company_code || company.id;
    const joinUrl = `${process.env.NEXT_PUBLIC_APP_URL}/join?code=${inviteCode}`;
    const inviterName = [requestingUser.first_name, requestingUser.last_name].filter(Boolean).join(" ") || "A team member";
    const inviterEmail = (requestingUser.email as string) || "";

    // Look up role name if a role was assigned
    let roleName: string | null = null;
    if (roleId) {
      const { data: roleRow } = await db
        .from("roles")
        .select("name")
        .eq("id", roleId)
        .maybeSingle();
      if (roleRow?.name && roleRow.name.toLowerCase() !== "unassigned") {
        roleName = roleRow.name;
      }
    }

    let emailsSent = 0;
    let smsSent = 0;

    // Create invitation records in team_invitations table
    const invitationRows: {
      company_id: string;
      email?: string;
      phone?: string;
      role_id?: string;
      invited_by: string;
      invite_code: string;
    }[] = [];

    if (hasEmails) {
      for (const email of emails) {
        invitationRows.push({
          company_id: companyId,
          email,
          role_id: roleId || undefined,
          invited_by: requestingUser.id as string,
          invite_code: inviteCode,
        });
      }
    }

    if (hasPhones) {
      for (const phone of phones) {
        invitationRows.push({
          company_id: companyId,
          phone,
          role_id: roleId || undefined,
          invited_by: requestingUser.id as string,
          invite_code: inviteCode,
        });
      }
    }

    if (invitationRows.length > 0) {
      const { error: inviteError } = await db
        .from("team_invitations")
        .insert(invitationRows);

      if (inviteError) {
        console.error("[api/auth/send-invite] Failed to create invitation records:", inviteError);
        // Non-blocking: continue sending invites even if record creation fails
      }
    }

    // Send email invites via SendGrid
    const emailErrors: string[] = [];
    if (hasEmails) {
      for (const email of emails) {
        try {
          await sendTeamInvite({
            email,
            companyName: company.name,
            joinUrl,
            logoUrl: company.logo_url,
            inviterName,
            inviterEmail,
            companyCode: inviteCode,
            roleName,
          });
          emailsSent++;
        } catch (emailError) {
          const msg = emailError instanceof Error ? emailError.message : String(emailError);
          console.error(`[api/auth/send-invite] Email failed for ${email}:`, emailError);
          emailErrors.push(`${email}: ${msg}`);
        }
      }
    }

    // Send SMS invites via Twilio
    const smsErrors: string[] = [];
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
          const msg = smsError instanceof Error ? smsError.message : String(smsError);
          console.error(`[api/auth/send-invite] SMS failed for ${phone}:`, smsError);
          smsErrors.push(`${phone}: ${msg}`);
        }
      }
    }

    const totalAttempted = (hasEmails ? emails.length : 0) + (hasPhones ? phones.length : 0);
    const totalSent = emailsSent + smsSent;

    // If all sends failed, return error
    if (totalSent === 0 && totalAttempted > 0) {
      const allErrors = [...emailErrors, ...smsErrors];
      return NextResponse.json(
        { error: `All invites failed to send: ${allErrors.join("; ")}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      emailsSent,
      smsSent,
      invitesSent: totalSent,
      ...(emailErrors.length > 0 || smsErrors.length > 0
        ? { partialErrors: [...emailErrors, ...smsErrors] }
        : {}),
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
