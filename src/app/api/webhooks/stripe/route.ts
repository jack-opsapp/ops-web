/**
 * POST /api/webhooks/stripe
 *
 * Handles Stripe webhook events for portal invoice payments.
 * Verifies the signature, then records the payment in the payments table.
 * The existing DB trigger updates invoice balance_due and status automatically.
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Verify webhook signature
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("[stripe-webhook] Signature verification failed:", message);
    return NextResponse.json({ error: `Webhook signature verification failed` }, { status: 400 });
  }

  // Handle payment_intent.succeeded
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const { invoiceId, invoiceNumber, clientId, companyId } = paymentIntent.metadata;

    if (!invoiceId || !clientId || !companyId) {
      // Not a portal payment — ignore (might be from another integration)
      console.log("[stripe-webhook] Ignoring payment_intent without portal metadata:", paymentIntent.id);
      return NextResponse.json({ received: true });
    }

    // Check for duplicate — don't record the same PaymentIntent twice
    const supabase = getServiceRoleClient();
    const { data: existing } = await supabase
      .from("payments")
      .select("id")
      .eq("stripe_payment_intent", paymentIntent.id)
      .maybeSingle();

    if (existing) {
      console.log("[stripe-webhook] Payment already recorded for:", paymentIntent.id);
      return NextResponse.json({ received: true });
    }

    // Record the payment — DB trigger handles balance_due and invoice status
    const { error } = await supabase.from("payments").insert({
      company_id: companyId,
      invoice_id: invoiceId,
      client_id: clientId,
      amount: paymentIntent.amount / 100, // cents → dollars
      payment_method: "stripe",
      reference_number: paymentIntent.id,
      notes: `Portal payment for invoice #${invoiceNumber ?? "unknown"}`,
      payment_date: new Date().toISOString(),
      stripe_payment_intent: paymentIntent.id,
      created_by: null, // Portal client — no user ID
    });

    if (error) {
      console.error("[stripe-webhook] Failed to record payment:", error.message);
      return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
    }

    console.log(
      `[stripe-webhook] Payment recorded: $${(paymentIntent.amount / 100).toFixed(2)} for invoice ${invoiceId}`
    );
  }

  return NextResponse.json({ received: true });
}
