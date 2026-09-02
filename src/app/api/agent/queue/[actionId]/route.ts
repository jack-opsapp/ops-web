/**
 * PATCH  /api/agent/queue/:actionId — Approve or reject an action
 * DELETE /api/agent/queue/:actionId — Cancel a pending action
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse, requirePermission } from "../../_lib/auth";
import { ApprovalQueueService } from "@/lib/api/services/approval-queue-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

/** Action types that require admin/owner role to approve */
const FINANCIAL_ACTION_TYPES = ["create_invoice", "send_invoice_email"];

// ─── PATCH: Approve or Reject ─────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> }
) {
  // Pin the service layer to the service-role client so RLS doesn't
  // filter out the target row when reading it back for the atomic
  // approve/reject update.
  setSupabaseOverride(getServiceRoleClient());

  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;

    // Approving or rejecting a proposal requires the granular
    // `agent.review` grant.
    const gate = await requirePermission(auth, "agent.review");
    if (gate) return gate;

    const { actionId } = await params;
    const body = await request.json();
    const { action, notes, editedActionData } = body as {
      action: "approve" | "reject";
      notes?: string;
      editedActionData?: Record<string, unknown>;
    };

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "action must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }

    let result;
    if (action === "approve") {
      result = await ApprovalQueueService.approveAction(actionId, auth.companyId, auth.id, editedActionData);
    } else {
      result = await ApprovalQueueService.rejectAction(actionId, auth.companyId, auth.id, notes);
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/queue PATCH]", message);
    const status = message.includes("not found") || message.includes("already handled") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    setSupabaseOverride(null);
  }
}

// ─── DELETE: Cancel ───────────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> }
) {
  setSupabaseOverride(getServiceRoleClient());

  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;

    // Cancelling a pending action requires the granular `agent.review`
    // grant — nobody without queue access reaches in and kills a queued
    // financial or comms action.
    const gate = await requirePermission(auth, "agent.review");
    if (gate) return gate;

    const { actionId } = await params;
    await ApprovalQueueService.cancelAction(actionId, auth.companyId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/queue DELETE]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
