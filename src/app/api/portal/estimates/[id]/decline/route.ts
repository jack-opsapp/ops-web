/**
 * POST /api/portal/estimates/[id]/decline
 *
 * Declines an estimate on behalf of the authenticated client.
 * Accepts an optional reason in the request body.
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
    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason : undefined;

    await PortalService.declineEstimate(id, session.clientId, reason);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to decline estimate";

    if (message.includes("Access denied")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (message.includes("Cannot decline")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    console.error("[portal/estimates/[id]/decline] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
