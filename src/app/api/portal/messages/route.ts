/**
 * GET  /api/portal/messages
 * POST /api/portal/messages
 *
 * GET:  Fetches paginated messages for the authenticated client.
 *       Query params: limit, offset, projectId, estimateId, invoiceId
 * POST: Sends a new message from the client.
 *       Body: { content: string, projectId?: string, estimateId?: string, invoiceId?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  isErrorResponse,
} from "@/lib/api/portal-api-helpers";
import { PortalMessageService } from "@/lib/api/services/portal-message-service";

export async function GET(req: NextRequest) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    // Preview mode: return demo messages
    if (session.isPreview) {
      const { getDemoPortalMessages } = await import("@/lib/api/services/portal-demo-data");
      return NextResponse.json({ messages: getDemoPortalMessages(session.companyId) });
    }

    const searchParams = req.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10);
    const projectId = searchParams.get("projectId") ?? undefined;
    const estimateId = searchParams.get("estimateId") ?? undefined;
    const invoiceId = searchParams.get("invoiceId") ?? undefined;

    const messages = await PortalMessageService.getMessages(
      session.clientId,
      session.companyId,
      { limit, offset, projectId, estimateId, invoiceId }
    );

    return NextResponse.json({ messages });
  } catch (error) {
    console.error("[portal/messages] GET Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    const body = await req.json();

    // Preview mode: no-op, return fake success
    if (session.isPreview) {
      return NextResponse.json({
        id: "preview-msg-new",
        content: body.content,
        senderType: "client",
        createdAt: new Date().toISOString(),
      }, { status: 201 });
    }

    if (!body.content || typeof body.content !== "string") {
      return NextResponse.json(
        { error: "Message content is required" },
        { status: 400 }
      );
    }

    if (body.content.trim().length === 0) {
      return NextResponse.json(
        { error: "Message content cannot be empty" },
        { status: 400 }
      );
    }

    if (body.content.length > 5000) {
      return NextResponse.json(
        { error: "Message content is too long (max 5000 characters)" },
        { status: 400 }
      );
    }

    const message = await PortalMessageService.sendMessage({
      companyId: session.companyId,
      clientId: session.clientId,
      senderType: "client",
      senderName: session.email,
      content: body.content.trim(),
      projectId: body.projectId ?? null,
      estimateId: body.estimateId ?? null,
      invoiceId: body.invoiceId ?? null,
    });

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error("[portal/messages] POST Error:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
