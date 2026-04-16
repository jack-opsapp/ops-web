/**
 * POST /api/agent/unconfirm-schedule
 *
 * Reverts a schedule-confirmation. If the company's appointment_confirmation
 * reschedule_behavior is `draft` or `auto_send`, fires onConfirmedTaskRescheduled
 * to propose a "schedule changed" email before clearing the confirmation marker.
 *
 * Body: { taskId: string }
 * Returns: { unconfirmed: boolean, rescheduleAction: string | null }
 *
 * Admin/owner gated. Phase C gated.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  isErrorResponse,
  requireAdminOrOwner,
} from "../_lib/auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ClientSchedulingCommsService } from "@/lib/api/services/client-scheduling-comms-service";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;

    const roleErr = requireAdminOrOwner(auth);
    if (roleErr) return roleErr;

    const body = await request.json();
    const { taskId } = body as { taskId?: string };
    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
    }

    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      auth.companyId,
      "phase_c"
    );
    if (!phaseCEnabled) {
      return NextResponse.json(
        { error: "Phase C is not enabled for this company" },
        { status: 403 }
      );
    }

    const supabase = getServiceRoleClient();
    setSupabaseOverride(supabase);

    const { data: task } = await supabase
      .from("project_tasks")
      .select("id, schedule_confirmed_at")
      .eq("id", taskId)
      .eq("company_id", auth.companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    const wasConfirmed = !!task.schedule_confirmed_at;

    // Fire the "schedule changed" email propose before clearing the marker —
    // onConfirmedTaskRescheduled reads schedule_confirmed_at as the gate.
    // Only report a reschedule action when something was actually done:
    //   - do_nothing → null (no draft/send, no notification)
    //   - notify / draft / auto_send → report the behavior name
    let rescheduleAction: string | null = null;
    if (wasConfirmed) {
      const settings = await ClientSchedulingCommsService.getSettings(
        auth.companyId
      );
      const behavior = settings.appointment_confirmation.reschedule_behavior;
      rescheduleAction = behavior === "do_nothing" ? null : behavior;
      await ClientSchedulingCommsService.onConfirmedTaskRescheduled(
        auth.companyId,
        auth.id,
        taskId
      );
    }

    // Clear the confirmation marker
    await supabase
      .from("project_tasks")
      .update({
        schedule_confirmed_at: null,
        schedule_confirmed_by: null,
      })
      .eq("id", taskId)
      .eq("company_id", auth.companyId);

    return NextResponse.json({
      unconfirmed: true,
      rescheduleAction,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/unconfirm-schedule]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
