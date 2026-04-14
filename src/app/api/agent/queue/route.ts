/**
 * GET  /api/agent/queue?status=...&actionType=...&priority=...&statsOnly=true&countOnly=true
 * POST /api/agent/queue — Propose a new action
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse, requireAdminOrOwner } from "../_lib/auth";
import { ApprovalQueueService } from "@/lib/api/services/approval-queue-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type {
  AgentActionStatus,
  AgentActionType,
  AgentActionPriority,
} from "@/lib/types/approval-queue";

// ─── GET: Fetch Queue / Stats / Count ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Route handlers have no Firebase user session, so the service layer's
  // requireSupabase() would otherwise fall through to the anon browser
  // client and RLS policies on agent_actions would filter every row out.
  // Override it with the service-role client for the duration of this call.
  setSupabaseOverride(getServiceRoleClient());

  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;

    // The approval queue exposes proposed financial actions (invoices,
    // payment reminders, etc.) with full context — only admin/owner users
    // may read it. Crew/operator users have no business inspecting it.
    const roleGate = requireAdminOrOwner(auth);
    if (roleGate) return roleGate;

    const url = new URL(request.url);
    const statsOnly = url.searchParams.get("statsOnly") === "true";
    const countOnly = url.searchParams.get("countOnly") === "true";

    if (statsOnly) {
      const stats = await ApprovalQueueService.getStats(auth.companyId);
      return NextResponse.json(stats);
    }

    if (countOnly) {
      const count = await ApprovalQueueService.getPendingCount(auth.companyId);
      return NextResponse.json({ count });
    }

    const status = url.searchParams.get("status") as AgentActionStatus | null;
    const actionType = url.searchParams.get("actionType") as AgentActionType | null;
    const priority = url.searchParams.get("priority") as AgentActionPriority | null;

    const actions = await ApprovalQueueService.getQueue(auth.companyId, {
      status: status ?? undefined,
      actionType: actionType ?? undefined,
      priority: priority ?? undefined,
    });

    return NextResponse.json({ actions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/queue GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}

// ─── POST: Propose Action ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  setSupabaseOverride(getServiceRoleClient());

  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;

    // Only admin/owner users can propose actions via this route
    const roleGate = requireAdminOrOwner(auth);
    if (roleGate) return roleGate;

    const body = await request.json();
    const {
      actionType,
      actionData,
      contextSummary,
      contextSource,
      sourceId,
      confidence,
      priority,
    } = body;

    if (!actionType || !actionData || !contextSummary) {
      return NextResponse.json(
        { error: "actionType, actionData, and contextSummary are required" },
        { status: 400 }
      );
    }

    const VALID_ACTION_TYPES = [
      "create_project", "create_task", "create_invoice",
      "send_email", "send_status_email", "send_invoice_email",
      "send_payment_reminder", "reassign_task", "archive_project",
      "client_health_alert", "financial_insight",
      "optimize_schedule", "reschedule_tasks",
      "send_appointment_confirmation", "send_day_before_reminder",
      "send_schedule_changed",
      "send_subcontractor_coordination", "process_reschedule_request",
    ];
    if (!VALID_ACTION_TYPES.includes(actionType)) {
      return NextResponse.json(
        { error: `Invalid action type: ${actionType}` },
        { status: 400 }
      );
    }

    const actionId = await ApprovalQueueService.proposeAction({
      companyId: auth.companyId,
      userId: auth.id,
      actionType,
      actionData,
      contextSummary,
      contextSource,
      sourceId,
      confidence,
      priority,
    });

    if (!actionId) {
      return NextResponse.json(
        { message: "Duplicate action already pending" },
        { status: 200 }
      );
    }

    return NextResponse.json({ actionId }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/queue POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
