/**
 * POST /api/portal/estimates/[id]/approve
 *
 * Approves an estimate on behalf of the authenticated client.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  isErrorResponse,
} from "@/lib/api/portal-api-helpers";
import { PortalService } from "@/lib/api/services/portal-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    const { id } = await params;

    await PortalService.approveEstimate(id, session.clientId);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to approve estimate";

    if (message.includes("Access denied")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (message.includes("Cannot approve")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    console.error("[portal/estimates/[id]/approve] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
