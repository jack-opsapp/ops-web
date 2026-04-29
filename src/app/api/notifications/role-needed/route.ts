/**
 * POST /api/notifications/role-needed
 *
 * Notifies company admins (users with team.assign_roles permission) when
 * a new team member joins without a pre-assigned role. Delivers:
 *   1. In-app notification rail entry (persistent) for each admin.
 *   2. OneSignal push to each admin's registered mobile device.
 *
 * Email notification is intentionally excluded — it belongs to the email
 * PR series and is not part of this push-hardening PR.
 *
 * Body: { userId, userName, companyId }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { sendOneSignalPush } from "@/lib/notifications/onesignal";
import { getAppUrl } from "@/lib/utils/app-url";

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

    // Company existence check
    const { data: company } = await db
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();

    if (!company) {
      return NextResponse.json(
        { error: "Company not found" },
        { status: 404 }
      );
    }

    // Find roles that carry team.assign_roles permission
    const { data: rolePerms } = await db
      .from("role_permissions")
      .select("role_id")
      .eq("permission", "team.assign_roles");

    const roleIds = (rolePerms ?? []).map((rp) => rp.role_id as string);

    if (roleIds.length === 0) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    // Users holding those roles in this company
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

    // Fetch admin records — onesignal_player_id for push, id for rail
    const { data: admins } = await db
      .from("users")
      .select("id, onesignal_player_id")
      .in("id", adminUserIds)
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (!admins || admins.length === 0) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    const appUrl = getAppUrl();
    const assignUrl = `${appUrl}/settings?tab=team`;

    // Push copy (ops-copywriter validated — direct, imperative, under 60 chars)
    const firstName = userName.split(" ")[0] ?? userName;
    const pushTitle = `${firstName} needs a role`;
    const pushBody = "Tap to assign their role.";

    // 1. In-app notification rail (persistent — stays until admin acts)
    const notificationRows = admins.map((admin) => ({
      user_id: admin.id,
      company_id: companyId,
      type: "role_needed",
      title: pushTitle,
      body: `${userName} joined ${company.name as string} without a role.`,
      is_read: false,
      persistent: true,
      action_url: assignUrl,
      action_label: "ASSIGN ROLE",
      metadata: JSON.stringify({ targetUserId: userId }),
    }));

    const { error: notifError } = await db
      .from("notifications")
      .insert(notificationRows);

    if (notifError) {
      console.error(
        "[role-needed] in-app notification insert failed:",
        notifError
      );
    }

    // 2. OneSignal push — fan out to all admins with registered devices
    const playerIds = admins
      .map((a) => a.onesignal_player_id as string | null)
      .filter((id): id is string => !!id);

    if (playerIds.length > 0) {
      await sendOneSignalPush({
        playerIds,
        title: pushTitle,
        body: pushBody,
        data: {
          type: "role_needed",
          userId,
          companyId,
          deepLink: `ops://settings/team?user=${userId}`,
        },
      });
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
