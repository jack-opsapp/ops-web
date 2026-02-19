/**
 * GET /api/portal/estimates/[id]
 *
 * Fetches a single estimate with line items for portal display.
 * Also marks the estimate as viewed (first view only).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  isErrorResponse,
} from "@/lib/api/portal-api-helpers";
import { PortalService } from "@/lib/api/services/portal-service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    const { id } = await params;

    // Fetch estimate with line items (verifies client ownership)
    const estimate = await PortalService.getEstimateForPortal(
      id,
      session.clientId
    );

    // Mark as viewed in the background (don't block the response)
    PortalService.markEstimateViewed(id).catch((err) => {
      console.error("[portal/estimates] Failed to mark viewed:", err);
    });

    return NextResponse.json(estimate);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch estimate";

    if (message.includes("Access denied")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    console.error("[portal/estimates/[id]] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
