/**
 * POST /api/agent/queue/bulk — Bulk approve or reject actions (max 25)
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse, requireAdminOrOwner } from "../../_lib/auth";
import { ApprovalQueueService } from "@/lib/api/services/approval-queue-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

const MAX_BULK_ACTIONS = 25;

export async function POST(request: NextRequest) {
  setSupabaseOverride(getServiceRoleClient());

  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;

    // Bulk operations require admin/owner role
    const roleErr = requireAdminOrOwner(auth);
    if (roleErr) return roleErr;

    const body = await request.json();
    const { actionIds, action, notes } = body as {
      actionIds: string[];
      action: "approve" | "reject";
      notes?: string;
    };

    if (
      !Array.isArray(actionIds) ||
      actionIds.length === 0 ||
      (action !== "approve" && action !== "reject")
    ) {
      return NextResponse.json(
        { error: "actionIds (non-empty array) and action ('approve'|'reject') are required" },
        { status: 400 }
      );
    }

    if (actionIds.length > MAX_BULK_ACTIONS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BULK_ACTIONS} actions per batch` },
        { status: 400 }
      );
    }

    let result;
    if (action === "approve") {
      result = await ApprovalQueueService.bulkApprove(actionIds, auth.companyId, auth.id);
    } else {
      result = await ApprovalQueueService.bulkReject(actionIds, auth.companyId, auth.id, notes);
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agent/queue/bulk POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
