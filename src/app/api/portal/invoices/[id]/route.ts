/**
 * GET /api/portal/invoices/[id]
 *
 * Fetches a single invoice with line items and payments for portal display.
 * Verifies client ownership.
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

    const invoice = await PortalService.getInvoiceForPortal(
      id,
      session.clientId
    );

    return NextResponse.json(invoice);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch invoice";

    if (message.includes("Access denied")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    console.error("[portal/invoices/[id]] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
