/**
 * POST /api/portal/invoices/[id]/pay
 *
 * Creates a Stripe PaymentIntent for an invoice payment.
 * Body: { amount: number } (in dollars, converted to cents for Stripe)
 * Returns: { clientSecret: string }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  isErrorResponse,
} from "@/lib/api/portal-api-helpers";
import { PortalService } from "@/lib/api/services/portal-service";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    const { id: invoiceId } = await params;
    const body = await req.json();

    // Validate amount
    if (typeof body.amount !== "number" || body.amount <= 0) {
      return NextResponse.json(
        { error: "Amount must be a positive number" },
        { status: 400 }
      );
    }

    // Fetch invoice to verify ownership and get metadata
    const invoice = await PortalService.getInvoiceForPortal(
      invoiceId,
      session.clientId
    );

    // Ensure payment doesn't exceed balance due
    if (body.amount > invoice.balanceDue) {
      return NextResponse.json(
        {
          error: `Payment amount ($${body.amount.toFixed(2)}) exceeds balance due ($${invoice.balanceDue.toFixed(2)})`,
        },
        { status: 400 }
      );
    }

    // Create Stripe PaymentIntent (amount in cents)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(body.amount * 100),
      currency: "usd",
      metadata: {
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        clientId: session.clientId,
        companyId: session.companyId,
      },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create payment";

    if (message.includes("Access denied")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    console.error("[portal/invoices/[id]/pay] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
