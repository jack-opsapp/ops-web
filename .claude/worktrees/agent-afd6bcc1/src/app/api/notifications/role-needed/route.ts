/**
 * POST /api/notifications/role-needed
 *
 * Creates in-app notifications, sends emails, and sends push notifications
 * to all company users with `team.assign_roles` permission when a new
 * team member joins without a pre-assigned role.
 *
 * Body: { userId, userName, companyId }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { roleNeededTemplate } from "@/lib/email/templates/role-needed";
import sgMail from "@sendgrid/mail";

export async function POST(req: NextRequest) {
  try {
    const { userId, userName, companyId } = await req.json();
    if (!userId || !userName || !companyId) {
      return NextResponse.json(
        { error: "Missing required fields: userId, userName, companyId" },
        { status: 400 }
      );
    }

    const db = getServiceRoleClient();

    // Get company info
    const { data: company } = await db
      .from("companies")
      .select("name, logo_url")
      .eq("id", companyId)
      .maybeSingle();

    if (!company) {
      return NextResponse.json(
        { error: "Company not found" },
        { status: 404 }
      );
    }

    // Find all role IDs that have team.assign_roles permission
    const { data: rolePerms } = await db
      .from("role_permissions")
      .select("role_id")
      .eq("permission", "team.assign_roles");

    const roleIds = (rolePerms ?? []).map(
      (rp) => rp.role_id as string
    );

    if (roleIds.length === 0) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    // Find users with those roles in this company
    const { data: userRoles } = await db
      .from("user_roles")
      .select("user_id")
      .in("role_id", roleIds);

    const adminUserIds = [
      ...new Set((userRoles ?? []).map((ur) => ur.user_id as string)),
    ];

    if (adminUserIds.length === 0) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    // Get admin user details
    const { data: admins } = await db
      .from("users")
      .select("id, email, device_token")
      .in("id", adminUserIds)
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (!admins || admins.length === 0) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";
    const assignUrl = `${appUrl}/settings?tab=team`;

    // 1. In-app notifications
    const notificationRows = admins.map((admin) => ({
      user_id: admin.id,
      company_id: companyId,
      type: "role_needed",
      title: `${userName} needs a role`,
      body: `${userName} joined ${company.name} and needs a role assigned.`,
      is_read: false,
      metadata: JSON.stringify({ targetUserId: userId }),
    }));

    const { error: notifError } = await db
      .from("notifications")
      .insert(notificationRows);
    if (notifError) {
      console.error(
        "[role-needed] Failed to create in-app notifications:",
        notifError
      );
    }

    // 2. Email notifications via SendGrid
    const sendgridKey = process.env.SENDGRID_API_KEY;
    if (sendgridKey) {
      sgMail.setApiKey(sendgridKey);
      const fromEmail =
        process.env.SENDGRID_FROM_EMAIL ?? "noreply@opsapp.co";

      const emailPromises = admins
        .filter((a) => a.email)
        .map((admin) => {
          const html = roleNeededTemplate({
            userName,
            companyName: company.name as string,
            assignUrl,
            accentColor: "#417394",
            logoUrl: (company.logo_url as string) ?? null,
          });

          return sgMail.send({
            to: admin.email as string,
            from: { email: fromEmail, name: "OPS" },
            subject: `${userName} joined ${company.name} and needs a role`,
            html,
          });
        });

      await Promise.allSettled(emailPromises);
    }

    // 3. Push notifications (OneSignal)
    const oneSignalAppId = process.env.ONESIGNAL_APP_ID;
    const oneSignalApiKey = process.env.ONESIGNAL_REST_API_KEY;

    if (oneSignalAppId && oneSignalApiKey) {
      const deviceTokens = admins
        .map((a) => a.device_token as string | null)
        .filter((t): t is string => !!t);

      if (deviceTokens.length > 0) {
        try {
          await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Basic ${oneSignalApiKey}`,
            },
            body: JSON.stringify({
              app_id: oneSignalAppId,
              include_player_ids: deviceTokens,
              headings: { en: "New team member" },
              contents: {
                en: `${userName} joined and needs a role assigned.`,
              },
              data: {
                type: "role_needed",
                userId,
                deepLink: `ops://settings/team?user=${userId}`,
              },
              ios_badgeType: "Increase",
              ios_badgeCount: 1,
            }),
          });
        } catch (pushErr) {
          console.error("[role-needed] Push notification failed:", pushErr);
        }
      }
    }

    return NextResponse.json({ success: true, notified: admins.length });
  } catch (err) {
    console.error("[role-needed] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
