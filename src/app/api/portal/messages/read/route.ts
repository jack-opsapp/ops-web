/**
 * POST /api/portal/messages/read
 *
 * Marks all unread company→client messages as read for the authenticated client.
 * Called when the client opens the messages page so the unread badge resets.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  isErrorResponse,
} from "@/lib/api/portal-api-helpers";
import { PortalMessageService } from "@/lib/api/services/portal-message-service";

export async function POST(req: NextRequest) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    // Preview mode: no-op
    if (session.isPreview) {
      return NextResponse.json({ success: true });
    }

    await PortalMessageService.markAllRead(session.clientId, session.companyId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[portal/messages/read] Error:", error);
    return NextResponse.json(
      { error: "Failed to mark messages as read" },
      { status: 500 }
    );
  }
}
