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

    // Find user.
    //
    // A failed query returns no row AND an error. Reading only `data` makes a
    // transient fault look identical to an empty result, and the 404 below
    // then tells the client their account does not exist — a permanent answer
    // the setup UI treats as terminal. Separate the two.
    const { data: user, error: userError } = await db
      .from("users")
      .select("id, company_id, first_name, last_name, setup_progress")
      .eq("auth_id", firebaseUser.uid)
      .is("deleted_at", null)
      .maybeSingle();

    if (userError) {
      return NextResponse.json(
        { error: `Failed to look up user: ${userError.message}` },
        { status: 500 }
      );
    }

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

    // Also read current onboarding_completed to merge.
    //
    // Fatal on failure, deliberately. This read is the only source of the
    // flags other platforms have already set (`ios: true` for a crew member
    // who onboarded on the phone first). Falling back to {} and writing anyway
    // does not merely lose an error — the update below then replaces their
    // real onboarding state with `{ web: true }` alone, and nothing restores
    // it. Aborting costs a client retry; the route is idempotent.
    const { data: fullUser, error: onboardingError } = await db
      .from("users")
      .select("onboarding_completed")
      .eq("id", user.id)
      .single();

    if (onboardingError) {
      return NextResponse.json(
        {
          error: `Failed to read onboarding state: ${onboardingError.message}`,
        },
        { status: 500 }
      );
    }

    const currentOnboarding =
      (fullUser?.onboarding_completed as Record<string, boolean>) ?? {};

    const { error: progressError } = await db
      .from("users")
      .update({
        setup_progress: currentProgress,
        onboarding_completed: { ...currentOnboarding, web: true },
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (progressError) {
      // Fatal, deliberately. Returning `{ success: true }` with the completion
      // flag unwritten sends the user straight back through employee setup on
      // their next sign-in, with no sign anything went wrong.
      return NextResponse.json(
        { error: `Failed to save setup progress: ${progressError.message}` },
        { status: 500 }
      );
    }

    // Check if user has an assigned role (other than Unassigned).
    //
    // Fatal on failure, deliberately. A failed probe is indistinguishable from
    // "no role row", and the seed below upserts on the `user_roles_user_id_key`
    // unique index — so a transient read fault would REPLACE an operator's real
    // role with Unassigned and strip every permission they had. The constraint
    // trigger `private.guard_user_roles_final_state()` only guards admins, so
    // nothing downstream catches the demotion.
    const { data: userRole, error: userRoleError } = await db
      .from("user_roles")
      .select("role_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (userRoleError) {
      return NextResponse.json(
        { error: `Failed to read assigned role: ${userRoleError.message}` },
        { status: 500 }
      );
    }

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
