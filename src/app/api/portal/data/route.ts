/**
 * GET /api/portal/data
 *
 * Fetches all portal data for the authenticated client: client info,
 * company info, branding, estimates, invoices, projects, and unread count.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  isErrorResponse,
} from "@/lib/api/portal-api-helpers";
import { PortalService } from "@/lib/api/services/portal-service";

export async function GET(req: NextRequest) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    const data = await PortalService.getPortalData(
      session.clientId,
      session.companyId
    );

    return NextResponse.json(data);
  } catch (error) {
    console.error("[portal/data] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch portal data" },
      { status: 500 }
    );
  }
}
