/**
 * POST /api/employee-setup/complete
 *
 * Marks employee onboarding as complete. If the user has no assigned role
 * (or has the Unassigned role), fires notifications to all company admins
 * with team.assign_roles permission.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { dispatchRoleNeededNotification } from "@/lib/notifications/server-notification-service";
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
    const currentProgress = (user.setup_progress as Record<
      string,
      unknown
    >) ?? { steps: {} };
    const steps = (currentProgress.steps as Record<string, boolean>) ?? {};
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
      // Ensure Unassigned role is assigned if no role exists.
      //
      // public.user_roles carries exactly id, user_id, role_id, created_at.
      // This payload previously also sent `assigned_at`/`assigned_by`, which
      // do not exist — PostgREST rejects unknown columns against its schema
      // cache (PGRST204) before the statement reaches Postgres, so the write
      // failed on every call. Nothing inspected the error, so a crew member
      // could finish employee setup with no user_roles row at all. This is
      // the only place the web path seeds a role for crew, so there was no
      // second line of defence. Keep this payload to real columns.
      //
      // The conflict target is the `user_roles_user_id_key` unique index.
      //
      // The constraint trigger `private.guard_user_roles_final_state()`
      // rejects any user_roles write whose target is already a company admin
      // (`target_is_admin`, SQLSTATE 42501). Crew reaching this route are not
      // admins, and this route grants nobody admin, so the guard never fires
      // here — but if an admin-granting update is ever added above, this
      // write has to stay ahead of it (see 9c39e56f for the owner path).
      if (!userRole) {
        const { error: roleError } = await db.from("user_roles").upsert(
          { user_id: user.id, role_id: PRESET_ROLE_IDS.UNASSIGNED },
          { onConflict: "user_id" }
        );
        if (roleError) {
          // Fatal, deliberately. Swallowing this is what let the write fail
          // unnoticed on every crew signup. The route is idempotent, so a
          // client retry is safe.
          return NextResponse.json(
            { error: `Failed to assign unassigned role: ${roleError.message}` },
            { status: 500 }
          );
        }
      }

      // Fire notifications to admins
      try {
        await dispatchRoleNeededNotification(String(user.id), db);
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
