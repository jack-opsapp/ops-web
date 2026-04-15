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
import {
  mapStripeStatus,
  planFromStripePriceId,
  MAX_SEATS_BY_PLAN,
} from "@/lib/stripe/subscription-mapping";

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

  // Idempotency check: if we've already successfully processed this event,
  // ack and exit. Recorded AFTER processing (see bottom of handler) so a
  // mid-handler failure still gets retried by Stripe.
  const { data: existingEvent } = await supabase
    .from("stripe_webhook_events")
    .select("event_id")
    .eq("event_id", event.id)
    .maybeSingle();

  if (existingEvent) {
    console.log(`[stripe-webhook] Duplicate event ${event.id} (${event.type}) — skipping`);
    return NextResponse.json({ received: true, duplicate: true });
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
      // Derive OPS subscription status from Stripe subscription state via the
      // shared mapper. mapStripeStatus returns null for `incomplete` so we
      // leave whatever /api/stripe/subscribe wrote untouched until payment
      // confirms. When cancel_at_period_end is true Stripe keeps status as
      // "active" until the period ends, so we do too.
      const mappedStatus = mapStripeStatus(subscription.status);

      const updates: Record<string, unknown> = {
        subscription_end: subscription.items.data[0]?.current_period_end
          ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
          : new Date().toISOString(),
        subscription_ids_json: JSON.stringify([subscription.id]),
      };

      if (mappedStatus !== null) {
        updates.subscription_status = mappedStatus;
      }

      // Derive plan + max_seats from the Stripe price. Keeps the tier seat
      // limit in sync when a customer upgrades/downgrades via the Stripe
      // dashboard or billing portal (outside our /subscribe route).
      const priceId = subscription.items.data[0]?.price?.id;
      const planInfo = planFromStripePriceId(priceId);
      if (planInfo) {
        updates.subscription_plan = planInfo.plan;
        updates.subscription_period = planInfo.period;
        updates.max_seats = MAX_SEATS_BY_PLAN[planInfo.plan];
      }

      // Persist trial window from Stripe — these are the canonical source.
      // trial_start/trial_end are top-level unix seconds on Stripe.Subscription,
      // present whenever the subscription has ever had a trial (even post-conversion).
      if (subscription.trial_start) {
        updates.trial_start_date = new Date(subscription.trial_start * 1000).toISOString();
      }
      if (subscription.trial_end) {
        updates.trial_end_date = new Date(subscription.trial_end * 1000).toISOString();
      }

      // Grace period lifecycle: enter on past_due, clear on return to active/trialing.
      // Writing null on recovery prevents a stale start date from lingering.
      if (mappedStatus === "grace") {
        updates.seat_grace_start_date = new Date().toISOString();
      } else if (mappedStatus === "active" || mappedStatus === "trial") {
        updates.seat_grace_start_date = null;
      }

      const { error: updErr } = await supabase
        .from("companies")
        .update(updates)
        .eq("id", company.id);

      if (updErr) {
        // Do NOT record the event in the dedup table — let Stripe retry.
        console.error(`[stripe-webhook] Failed to apply subscription update for ${company.id}:`, updErr.message);
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
      }

      console.log(`[stripe-webhook] Subscription ${event.type} for company ${company.id}, status: ${mappedStatus ?? "unchanged"}`);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    const { data: company } = await supabase
      .from("companies")
      .select("id, subscription_ids_json")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (company) {
      // Guard against late .deleted events from a previously-cancelled
      // subscription arriving AFTER the user has re-subscribed with a new
      // sub ID. Only apply the cancellation if the deleted subscription is
      // actually the one we're currently tracking (or we're tracking none).
      let currentIds: string[] = [];
      if (company.subscription_ids_json) {
        try {
          const parsed = JSON.parse(company.subscription_ids_json);
          if (Array.isArray(parsed)) currentIds = parsed.filter((v): v is string => typeof v === "string");
        } catch {
          // malformed json — treat as empty, proceed with cancellation
        }
      }

      if (currentIds.length > 0 && !currentIds.includes(subscription.id)) {
        console.log(
          `[stripe-webhook] Ignoring stale .deleted for ${subscription.id} — current tracked: ${currentIds.join(",")}`
        );
      } else {
        const { error: delErr } = await supabase
          .from("companies")
          .update({
            subscription_status: "cancelled",
            subscription_ids_json: null,
          })
          .eq("id", company.id);

        if (delErr) {
          console.error(`[stripe-webhook] Failed to mark company ${company.id} cancelled:`, delErr.message);
          return NextResponse.json({ error: "Update failed" }, { status: 500 });
        }

        console.log(`[stripe-webhook] Subscription deleted for company ${company.id}`);
      }
    }
  }

  // L4 — handle Stripe customer deletion (admin action via Stripe Dashboard).
  // Clears the dangling customer ID and marks the subscription cancelled so
  // the next /subscribe call creates a fresh Stripe customer.
  if (event.type === "customer.deleted") {
    const customer = event.data.object as Stripe.Customer;

    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("stripe_customer_id", customer.id)
      .maybeSingle();

    if (company) {
      const { error: delErr } = await supabase
        .from("companies")
        .update({
          subscription_status: "cancelled",
          stripe_customer_id: null,
          subscription_ids_json: null,
        })
        .eq("id", company.id);

      if (delErr) {
        console.error(`[stripe-webhook] Failed to clear deleted customer for ${company.id}:`, delErr.message);
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
      }

      console.log(`[stripe-webhook] Customer deleted, cleared company ${company.id}`);
    }
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = invoice.customer as string;

    const { data: company } = await supabase
      .from("companies")
      .select("id, seat_grace_start_date")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (company) {
      const updates: Record<string, unknown> = { subscription_status: "grace" };
      // Only set grace start on the first failure — subsequent retries must not
      // extend the window by overwriting it.
      if (!company.seat_grace_start_date) {
        updates.seat_grace_start_date = new Date().toISOString();
      }

      const { error: pfErr } = await supabase
        .from("companies")
        .update(updates)
        .eq("id", company.id);

      if (pfErr) {
        console.error(`[stripe-webhook] Failed to mark company ${company.id} grace:`, pfErr.message);
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
      }

      console.log(`[stripe-webhook] Payment failed for company ${company.id}`);
    }
  }

  // Record successful processing. Any unique-violation here means a concurrent
  // delivery of the same event beat us to it — still safe to ack.
  const { error: recordError } = await supabase
    .from("stripe_webhook_events")
    .insert({ event_id: event.id, event_type: event.type });

  if (recordError && (recordError as { code?: string }).code !== "23505") {
    console.error("[stripe-webhook] Failed to record event:", recordError.message);
    // Do not fail the response — the event was already applied. Stripe retrying
    // would re-apply idempotently, but we prefer to ack.
  }

  return NextResponse.json({ received: true });
}
