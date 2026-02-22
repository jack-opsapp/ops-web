/**
 * POST /api/webhooks/stripe
 *
 * Handles Stripe webhook events:
 *  - payment_intent.succeeded → records portal invoice payments
 *  - customer.subscription.created/updated → syncs subscription status to companies table
 *  - customer.subscription.deleted → marks subscription as cancelled
 *  - invoice.payment_failed → sets subscription status to grace
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

  const supabase = getServiceRoleClient();

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

  // Handle subscription events
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    // Find the company by stripe_customer_id
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (company) {
      const updates: Record<string, unknown> = {
        subscription_status: subscription.status === "active" ? "active" :
                            subscription.status === "trialing" ? "trial" :
                            subscription.status === "past_due" ? "grace" :
                            subscription.cancel_at_period_end ? "cancelled" : subscription.status,
        subscription_end: subscription.items.data[0]?.current_period_end
          ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
          : new Date().toISOString(),
        subscription_ids_json: JSON.stringify([subscription.id]),
      };

      await supabase
        .from("companies")
        .update(updates)
        .eq("id", company.id);

      console.log(`[stripe-webhook] Subscription ${event.type} for company ${company.id}`);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (company) {
      await supabase
        .from("companies")
        .update({
          subscription_status: "cancelled",
          subscription_ids_json: null,
        })
        .eq("id", company.id);

      console.log(`[stripe-webhook] Subscription deleted for company ${company.id}`);
    }
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = invoice.customer as string;

    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (company) {
      await supabase
        .from("companies")
        .update({ subscription_status: "grace" })
        .eq("id", company.id);

      console.log(`[stripe-webhook] Payment failed for company ${company.id}`);
    }
  }

  return NextResponse.json({ received: true });
}
