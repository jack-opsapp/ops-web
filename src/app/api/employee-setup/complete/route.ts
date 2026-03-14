/**
 * POST /api/employee-setup/complete
 *
 * Marks employee onboarding as complete. If the user has no assigned role
 * (or has the Unassigned role), fires notifications to all company admins
 * with team.assign_roles permission.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { PRESET_ROLE_IDS } from "@/lib/types/permissions";

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    if (!idToken) {
      return NextResponse.json({ error: "Missing idToken" }, { status: 401 });
    }

    const firebaseUser = await verifyAuthToken(idToken);
    const db = getServiceRoleClient();

    // Find user
    const { data: user } = await db
      .from("users")
      .select("id, company_id, first_name, last_name, setup_progress")
      .eq("auth_id", firebaseUser.uid)
      .is("deleted_at", null)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Mark employee onboarding complete in setup_progress
    const currentProgress =
      (user.setup_progress as Record<string, unknown>) ?? { steps: {} };
    const steps =
      (currentProgress.steps as Record<string, boolean>) ?? {};
    steps.employee_onboarding = true;
    currentProgress.steps = steps;

    // Also read current onboarding_completed to merge
    const { data: fullUser } = await db
      .from("users")
      .select("onboarding_completed")
      .eq("id", user.id)
      .single();
    const currentOnboarding =
      (fullUser?.onboarding_completed as Record<string, boolean>) ?? {};

    await db
      .from("users")
      .update({
        setup_progress: currentProgress,
        onboarding_completed: { ...currentOnboarding, web: true },
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    // Check if user has an assigned role (other than Unassigned)
    const { data: userRole } = await db
      .from("user_roles")
      .select("role_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const hasRealRole =
      userRole && userRole.role_id !== PRESET_ROLE_IDS.UNASSIGNED;

    if (!hasRealRole && user.company_id) {
      // Ensure Unassigned role is assigned if no role exists
      if (!userRole) {
        await db.from("user_roles").upsert(
          {
            user_id: user.id,
            role_id: PRESET_ROLE_IDS.UNASSIGNED,
            assigned_at: new Date().toISOString(),
            assigned_by: null,
          },
          { onConflict: "user_id" }
        );
      }

      // Fire notifications to admins
      try {
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";
        await fetch(`${appUrl}/api/notifications/role-needed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            userName: `${user.first_name} ${user.last_name}`.trim(),
            companyId: user.company_id,
          }),
        });
      } catch (notifErr) {
        console.error(
          "[employee-setup/complete] Failed to send role-needed notifications:",
          notifErr
        );
      }
    }

    return NextResponse.json({ success: true, needsRole: !hasRealRole });
  } catch (err) {
    console.error("[employee-setup/complete] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
