/**
 * POST /api/agent/confirm-schedule
 *
 * Marks a task as schedule-confirmed and fires the configured dispatcher
 * (draft/auto-send/etc.). Admin/owner gated. Phase C gated.
 *
 * Body: { taskId: string }
 * Returns: { confirmed: boolean, actionTaken: string, actionId: string | null }
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

    // Verify the task exists and belongs to the caller's company
    const { data: task, error: taskErr } = await supabase
      .from("project_tasks")
      .select(
        "id, company_id, schedule_confirmed_at, confirmed_schedule_version, schedule_version, start_date"
      )
      .eq("id", taskId)
      .eq("company_id", auth.companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (taskErr || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Guard: can't confirm a task that has no scheduled date yet.
    if (!task.start_date) {
      return NextResponse.json(
        { error: "Task has no scheduled date" },
        { status: 400 }
      );
    }

    const result =
      await ClientSchedulingCommsService.confirmTaskScheduleAndDispatch(
        auth.companyId,
        auth.id,
        taskId,
        task.schedule_version,
        "manual"
      );

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/confirm-schedule]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
