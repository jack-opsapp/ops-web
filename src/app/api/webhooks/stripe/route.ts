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
  addonFromPriceId,
  isPrioritySupportPrice,
  MAX_SEATS_BY_PLAN,
} from "@/lib/stripe/subscription-mapping";
import {
  sendDataSetupRequest,
  sendPrioritySupportActivated,
} from "@/lib/email/sendgrid";
import {
  isDecksetCheckoutSession,
  isDecksetSubscription,
  decksetSubscriptionMirrorRow,
} from "@/lib/decks/billing/stripe-deckset";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

// Constant for the per-type branch that routes add-on Checkout completions.
const PMF_CHECKOUT_TRACKED = "checkout.session.completed";

// PMF — events whose financial impact we capture into billing_events for the
// PMF analytics dashboard. This set is intentionally narrow: the existing
// per-type handlers below run regardless of this set, and billing_events is
// strictly an append-only ledger for analytics, not a state-machine input.
//
// `checkout.session.completed` is included so one-time add-on revenue
// (Data Setup) lands in the ledger — invoice.paid covers recurring add-on
// revenue (Priority Support) via the customer's invoices.
const PMF_TRACKED_EVENTS = new Set<string>([
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
  "charge.dispute.created",
  "checkout.session.completed",
]);

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

  // PMF — capture financially-meaningful events into billing_events. Runs
  // independently of the per-type handlers below: billing_events is the PMF
  // analytics ledger, not a state-machine action. The unique constraint on
  // stripe_event_id absorbs duplicate replays (a 23505 here is benign).
  if (PMF_TRACKED_EVENTS.has(event.type)) {
    const customer = extractCustomerId(event);
    const amountCents = extractAmountCents(event);
    const occurredAt = new Date(event.created * 1000).toISOString();

    let companyId: string | null = null;
    if (customer) {
      const { data: company } = await supabase
        .from("companies")
        .select("id")
        .eq("stripe_customer_id", customer)
        .maybeSingle();
      companyId = (company as { id?: string } | null)?.id ?? null;
    }

    const { error: billingError } = await supabase.from("billing_events").insert({
      stripe_event_id: event.id,
      event_type: event.type,
      stripe_customer_id: customer,
      company_id: companyId,
      amount_cents: amountCents,
      currency: extractCurrency(event),
      occurred_at: occurredAt,
      raw: event as unknown as Record<string, unknown>,
    });

    if (billingError) {
      const code = (billingError as { code?: string }).code;
      if (code !== "23505") {
        // Real DB failure — return 500 so Stripe retries the event.
        // Without retry, the billing_events row would be permanently missing
        // because the dedup early-return above will short-circuit subsequent
        // deliveries once stripe_webhook_events is recorded at the end of
        // the handler. The downstream billing_events_first_paid trigger that
        // drives pmf_deals.first_paid_at would silently skip this customer.
        //
        // Returning 500 here also blocks the per-type handlers from running on
        // this delivery, which is intentional: those handlers are idempotent
        // (own dedup at top + behavior-level idempotency in each branch), so
        // Stripe's retry will re-apply them safely.
        console.error(
          "[stripe-webhook] billing_events insert failed:",
          billingError.message
        );
        return NextResponse.json({ error: "billing_events insert failed" }, { status: 500 });
      }
      // 23505 = unique_violation: a concurrent delivery of the same event beat
      // us to the insert. Safe to ignore — that's exactly what the unique
      // constraint is for.
    }
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

  // Handle add-on Checkout completions (Data Setup one-time, Priority Support
  // recurring). Routes off `metadata.addon` set by the /api/stripe/addon/* routes.
  // Idempotency: Stripe never replays a checkout.session.completed for the same
  // session, and the dedup table at the top blocks event-id replays. Each
  // branch is also internally idempotent (column writes are deterministic;
  // data_setup_requests has a unique index on stripe_payment_intent_id; the
  // notification RPC does ON CONFLICT DO NOTHING).
  if (event.type === PMF_CHECKOUT_TRACKED) {
    const session = event.data.object as Stripe.Checkout.Session;
    const companyIdMeta = session.metadata?.companyId as string | undefined;
    const companyId = companyIdMeta ?? (session.client_reference_id ?? null);

    if (isDecksetCheckoutSession(session) && companyId) {
      const result = await handleDecksetCheckoutCompleted({
        supabase,
        stripe: getStripe(),
        session,
        companyId,
        eventCreated: event.created,
      });
      if (result) return result;
    }

    const addon = session.metadata?.addon as
      | "data_setup"
      | "priority_support"
      | undefined;

    if (!addon || !companyId) {
      // Not an add-on Checkout we own. Silently pass — record dedup at the bottom.
      console.log(
        `[stripe-webhook] checkout.session.completed without addon metadata (id=${session.id}) — skipping`
      );
    } else if (addon === "data_setup") {
      const result = await handleDataSetupCheckout({ supabase, stripe: getStripe(), session, companyId });
      if (result) return result;
    } else if (addon === "priority_support") {
      const result = await handlePrioritySupportCheckout({ supabase, stripe: getStripe(), session, companyId });
      if (result) return result;
    }
  }

  // Handle subscription events
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    // Find the company by stripe_customer_id
    const { data: company } = await supabase
      .from("companies")
      .select("id, subscription_ids_json")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    // Add-on subscriptions (Priority Support today; future add-ons here too)
    // run on the same Stripe customer as the base plan but are NOT the base
    // plan. We must NOT let an add-on subscription overwrite subscription_*
    // columns that belong to the base plan. Detect via the line item's price.
    const itemPriceId = subscription.items.data[0]?.price?.id;
    const isAddonSubscription = !!addonFromPriceId(itemPriceId);

    if (company && isDecksetSubscription(subscription)) {
      const result = await handleDecksetSubscriptionChange({
        supabase,
        companyId: company.id as string,
        subscription,
        eventCreated: event.created,
      });
      if (result) return result;

      await supabase
        .from("stripe_webhook_events")
        .insert({ event_id: event.id, event_type: event.type });
      return NextResponse.json({ received: true, product: "deckset" });
    }

    if (company && isAddonSubscription && isPrioritySupportPrice(itemPriceId)) {
      // Priority Support entitlement tracking. Stripe statuses we treat as
      // "active for entitlement purposes": active, trialing, past_due
      // (grace), paused. Anything else (canceled, incomplete_expired, unpaid,
      // incomplete) → entitlement off. The mapping mirrors mapStripeStatus
      // intent but operates on the addon flag rather than subscription_status.
      const activeForEntitlement: Stripe.Subscription.Status[] = [
        "active",
        "trialing",
        "past_due",
        "paused",
      ];
      const entitled = activeForEntitlement.includes(subscription.status);

      // Persist the billing cadence so the UI can render "Active · Annual"
      // without a Stripe roundtrip per render. Cleared on cancellation.
      const period =
        addonFromPriceId(itemPriceId) === "priority_support_annual"
          ? "annual"
          : "monthly";

      const { error: addonErr } = await supabase
        .from("companies")
        .update({
          has_priority_support: entitled,
          priority_support_period: entitled ? period : null,
        })
        .eq("id", company.id);

      if (addonErr) {
        console.error(
          `[stripe-webhook] Failed to update priority support entitlement for ${company.id}:`,
          addonErr.message
        );
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
      }
      console.log(
        `[stripe-webhook] Priority support ${entitled ? "ON" : "OFF"} for company ${company.id} (sub=${subscription.id}, status=${subscription.status})`
      );

      // Record dedup and return — do NOT fall through to base-plan logic.
      await supabase
        .from("stripe_webhook_events")
        .insert({ event_id: event.id, event_type: event.type });
      return NextResponse.json({ received: true, addon: "priority_support" });
    }

    if (company && isAddonSubscription) {
      // Unknown add-on (future use). Skip base-plan handling so we never
      // accidentally clobber subscription_status with an add-on event.
      console.log(
        `[stripe-webhook] Skipping non-priority addon subscription event (sub=${subscription.id}, price=${itemPriceId})`
      );
      await supabase
        .from("stripe_webhook_events")
        .insert({ event_id: event.id, event_type: event.type });
      return NextResponse.json({ received: true, addon: "unknown" });
    }

    if (company) {
      // N4 — Skip late events for terminal-state subscriptions that aren't
      // currently tracked. Scenario: company has sub_OLD that gets cancelled,
      // then user re-subscribes with sub_NEW (subscription_ids_json=[sub_NEW]),
      // then Stripe re-delivers a stale sub_OLD.updated from before the
      // cancellation. Without this guard we'd overwrite subscription_ids_json
      // with [sub_OLD], clobbering tracking of the current sub.
      let currentIds: string[] = [];
      if (company.subscription_ids_json) {
        try {
          const parsed = JSON.parse(company.subscription_ids_json);
          if (Array.isArray(parsed)) currentIds = parsed.filter((v): v is string => typeof v === "string");
        } catch {
          // malformed json — fall through, treat as untracked
        }
      }
      const terminalStripeStatuses: Stripe.Subscription.Status[] = [
        "canceled",
        "incomplete_expired",
        "unpaid",
      ];
      const isTerminal = terminalStripeStatuses.includes(subscription.status);
      if (
        currentIds.length > 0 &&
        !currentIds.includes(subscription.id) &&
        isTerminal
      ) {
        console.log(
          `[stripe-webhook] Skipping late ${event.type} (${subscription.status}) for ${subscription.id} — current tracked: ${currentIds.join(",")}`
        );
        // Record the event in dedup and return — it's handled by being skipped.
        await supabase
          .from("stripe_webhook_events")
          .insert({ event_id: event.id, event_type: event.type });
        return NextResponse.json({ received: true, skipped: "stale-terminal" });
      }

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

    // Same add-on guard as in subscription.updated — do NOT clobber the base
    // plan's subscription_status when an add-on subscription is deleted.
    const itemPriceId = subscription.items.data[0]?.price?.id;
    if (company && isDecksetSubscription(subscription)) {
      const result = await handleDecksetSubscriptionChange({
        supabase,
        companyId: company.id as string,
        subscription,
        eventCreated: event.created,
      });
      if (result) return result;

      await supabase
        .from("stripe_webhook_events")
        .insert({ event_id: event.id, event_type: event.type });
      return NextResponse.json({ received: true, product: "deckset" });
    }

    if (company && isPrioritySupportPrice(itemPriceId)) {
      const { error: offErr } = await supabase
        .from("companies")
        .update({
          has_priority_support: false,
          priority_support_period: null,
        })
        .eq("id", company.id);

      if (offErr) {
        console.error(
          `[stripe-webhook] Failed to disable priority support for ${company.id}:`,
          offErr.message
        );
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
      }

      console.log(
        `[stripe-webhook] Priority support OFF for company ${company.id} (deletion of ${subscription.id})`
      );

      await supabase
        .from("stripe_webhook_events")
        .insert({ event_id: event.id, event_type: event.type });
      return NextResponse.json({ received: true, addon: "priority_support" });
    }

    if (company && addonFromPriceId(itemPriceId)) {
      console.log(
        `[stripe-webhook] Skipping non-priority addon subscription deletion (sub=${subscription.id})`
      );
      await supabase
        .from("stripe_webhook_events")
        .insert({ event_id: event.id, event_type: event.type });
      return NextResponse.json({ received: true, addon: "unknown" });
    }

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

// PMF helpers -----------------------------------------------------------------

/**
 * Extract a Stripe customer ID from any event we track. Handles three shapes:
 *  - object.customer is a string (most common — invoices, charges, subs)
 *  - object.customer is a hydrated Customer/DeletedCustomer object
 *  - object IS a Customer (its id starts with "cus_") — for customer.* events
 *
 * Note: returns null if no customer can be determined (e.g. a charge made
 * with no customer attached). The billing_events row is still inserted with
 * stripe_customer_id=null in that case.
 */
function extractCustomerId(event: Stripe.Event): string | null {
  const obj = event.data.object as {
    customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
    id?: string;
  };
  if (typeof obj.customer === "string") return obj.customer;
  if (obj.customer && typeof obj.customer === "object" && "id" in obj.customer) {
    return obj.customer.id;
  }
  if (typeof obj.id === "string" && obj.id.startsWith("cus_")) return obj.id;
  return null;
}

/**
 * Extract the cents amount that best represents the financial impact of the
 * event. Tries fields in order of relevance:
 *   - amount_paid (Invoice)
 *   - amount_total (Checkout.Session) — for one-time add-on revenue
 *   - amount (Charge, PaymentIntent)
 *   - amount_refunded (Charge with refund)
 * Returns null for events with no amount (e.g. customer.subscription.created
 * before any invoice is paid).
 */
function extractAmountCents(event: Stripe.Event): number | null {
  const obj = event.data.object as {
    amount_paid?: number;
    amount_total?: number;
    amount?: number;
    amount_refunded?: number;
  };
  return (
    obj.amount_paid ??
    obj.amount_total ??
    obj.amount ??
    obj.amount_refunded ??
    null
  );
}

/**
 * Extract the ISO 4217 currency code from the event object. Invoice and Charge
 * carry `currency` directly; subscription events do not, in which case we fall
 * back to "usd" to preserve the prior hardcoded behavior. Defends against
 * silent miscategorization if the company ever takes payments in another
 * currency.
 */
function extractCurrency(event: Stripe.Event): string {
  const obj = event.data.object as { currency?: string };
  return obj.currency ?? "usd";
}

// Add-on Checkout helpers -----------------------------------------------------

type SupabaseClient = ReturnType<typeof getServiceRoleClient>;

/**
 * Format a Stripe amount in minor units to a human display string.
 * `4900` USD → "$49.00 USD". Falls back to a numeric repr if formatting fails.
 */
function formatAmount(amountMinor: number, currency: string): string {
  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    });
    return `${formatter.format(amountMinor / 100)} ${currency.toUpperCase()}`;
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/**
 * Resolve the user UUID and contact info to attach to a data_setup_requests
 * row + the fulfillment notification. Falls back to the company account
 * holder when the purchaser can't be matched (rare; e.g. user signed in via
 * a Firebase token but the users row has no auth_id link yet).
 */
async function resolveCompanyContext(
  supabase: SupabaseClient,
  companyId: string,
  authUid: string | null
): Promise<{
  company: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    account_holder_id: string | null;
    admin_ids: string[];
  };
  requestedBy: string | null;
  railRecipients: { userIdText: string; companyIdText: string }[];
} | null> {
  const { data: company } = await supabase
    .from("companies")
    .select("id, name, email, phone, account_holder_id, admin_ids")
    .eq("id", companyId)
    .maybeSingle();

  if (!company) return null;

  // Locate the purchaser. Match the auth-pattern used in
  // /api/auth/join-company: try auth_id first, then firebase_uid. Most
  // production users only have firebase_uid set (auth_id is the optional
  // Supabase Auth bridge that's not yet populated for legacy accounts).
  // Fall back to any admin in the company so the FK insert never fails.
  let requestedBy: string | null = null;
  if (authUid) {
    const { data: byAuthId } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", authUid)
      .maybeSingle();
    requestedBy = (byAuthId?.id as string | undefined) ?? null;

    if (!requestedBy) {
      const { data: byFirebaseUid } = await supabase
        .from("users")
        .select("id")
        .eq("firebase_uid", authUid)
        .maybeSingle();
      requestedBy = (byFirebaseUid?.id as string | undefined) ?? null;
    }
  }
  if (!requestedBy) {
    const { data: anyAdmin } = await supabase
      .from("users")
      .select("id")
      .eq("company_id", companyId)
      .eq("is_company_admin", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    requestedBy = (anyAdmin?.id as string | undefined) ?? null;
  }

  // Notification rail recipients: every admin user in the company. The
  // notifications table types user_id and company_id as TEXT (legacy from
  // the Bubble-era schema), so cast UUID strings here.
  const { data: admins } = await supabase
    .from("users")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_company_admin", true);

  const rail = (admins ?? []).map((u) => ({
    userIdText: u.id as string,
    companyIdText: company.id as string,
  }));

  return {
    company: {
      id: company.id as string,
      name: company.name as string,
      email: (company.email as string | null) ?? null,
      phone: (company.phone as string | null) ?? null,
      account_holder_id: (company.account_holder_id as string | null) ?? null,
      admin_ids: (company.admin_ids as string[] | null) ?? [],
    },
    requestedBy,
    railRecipients: rail,
  };
}

/**
 * Drop a notification on the rail for every admin in the company. Uses the
 * dedup RPC so retries don't pile up duplicates.
 */
async function notifyAdmins(
  supabase: SupabaseClient,
  recipients: { userIdText: string; companyIdText: string }[],
  params: {
    type: string;
    title: string;
    body: string;
    persistent: boolean;
    actionUrl?: string;
    actionLabel?: string;
  }
): Promise<void> {
  await Promise.all(
    recipients.map(async (r) => {
      const { error } = await supabase.rpc("create_notification_if_new", {
        p_user_id: r.userIdText,
        p_company_id: r.companyIdText,
        p_type: params.type,
        p_title: params.title,
        p_body: params.body,
        p_persistent: params.persistent,
        p_action_url: params.actionUrl ?? null,
        p_action_label: params.actionLabel ?? null,
        p_project_id: null,
      });
      if (error) {
        console.error(
          `[stripe-webhook] notification RPC failed for ${r.userIdText}:`,
          error.message
        );
      }
    })
  );
}

/**
 * Handle Data Setup checkout completion. Idempotent across retries:
 *  - companies.data_setup_purchased is a boolean — re-write is a no-op
 *  - data_setup_requests has a unique index on stripe_payment_intent_id
 *  - notification RPC is INSERT ... ON CONFLICT DO NOTHING
 *  - email send is the only side effect that's NOT naturally idempotent;
 *    the dedup table at the top of the handler keeps Stripe retries from
 *    re-triggering the email (the duplicate-event check returns early
 *    before we get here on retries).
 */
async function handleDataSetupCheckout(args: {
  supabase: SupabaseClient;
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  companyId: string;
}): Promise<NextResponse | null> {
  const { supabase, stripe, session, companyId } = args;

  const ctx = await resolveCompanyContext(
    supabase,
    companyId,
    (session.metadata?.purchasedByAuthUid as string | undefined) ?? null
  );
  if (!ctx) {
    console.error(
      `[stripe-webhook] data_setup checkout for unknown company ${companyId} (session ${session.id})`
    );
    return NextResponse.json(
      { error: "Company not found" },
      { status: 404 }
    );
  }

  // Hydrate the payment intent so we have the real charge id + amount.
  // session.amount_total is set on Checkout, but the PI id we want for the
  // data_setup_requests row lives on session.payment_intent (string when not
  // expanded, object when expanded). Always retrieve to normalize.
  let paymentIntentId: string | null = null;
  if (typeof session.payment_intent === "string") {
    paymentIntentId = session.payment_intent;
  } else if (session.payment_intent && "id" in session.payment_intent) {
    paymentIntentId = session.payment_intent.id;
  }

  const amountMinor = session.amount_total ?? 0;
  const currency = (session.currency ?? "usd").toUpperCase();

  // 1. Flip the entitlement column.
  const { error: companyErr } = await supabase
    .from("companies")
    .update({ data_setup_purchased: true })
    .eq("id", companyId);
  if (companyErr) {
    console.error(
      `[stripe-webhook] Failed to set data_setup_purchased for ${companyId}:`,
      companyErr.message
    );
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // 2. Insert the request row. We need a `requested_by` UUID — RLS is
  //    bypassed because we're on the service role client, but the FK still
  //    must point to a real user. If we somehow can't resolve one, error
  //    out so Stripe retries.
  if (!ctx.requestedBy) {
    console.error(
      `[stripe-webhook] data_setup checkout has no resolvable requester for ${companyId} (session ${session.id})`
    );
    return NextResponse.json(
      { error: "No resolvable requester" },
      { status: 500 }
    );
  }

  const { error: insertErr } = await supabase
    .from("data_setup_requests")
    .insert({
      company_id: companyId,
      requested_by: ctx.requestedBy,
      status: "pending",
      stripe_payment_intent_id: paymentIntentId,
      amount_paid_cents: amountMinor,
      contact_email:
        (session.customer_details?.email as string | null) ??
        ctx.company.email,
      contact_phone: ctx.company.phone,
    });

  // 23505 = unique-violation on stripe_payment_intent_id; means we've
  // already inserted this row from a prior delivery. Safe to swallow.
  if (insertErr && (insertErr as { code?: string }).code !== "23505") {
    console.error(
      `[stripe-webhook] data_setup_requests insert failed for ${companyId}:`,
      insertErr.message
    );
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  // 3. Send fulfillment email to the OPS team. ADDON_FULFILLMENT_EMAIL is
  //    required — surface as 500 if unset so Stripe retries instead of
  //    silently swallowing the purchase notification.
  const fulfillmentTo = process.env.ADDON_FULFILLMENT_EMAIL;
  if (!fulfillmentTo) {
    console.error(
      "[stripe-webhook] ADDON_FULFILLMENT_EMAIL not set — cannot deliver Data Setup notification"
    );
    return NextResponse.json(
      { error: "Fulfillment email not configured" },
      { status: 500 }
    );
  }

  const purchasedAtSecs = session.created ?? Math.floor(Date.now() / 1000);
  const purchasedAt = new Date(purchasedAtSecs * 1000);
  const purchasedAtDisplay = purchasedAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";
  const adminUrl = `${appUrl}/admin/companies/${companyId}`;

  try {
    await sendDataSetupRequest({
      to: fulfillmentTo,
      companyName: ctx.company.name,
      contactEmail:
        (session.customer_details?.email as string | null) ??
        ctx.company.email ??
        "(no email on file)",
      contactPhone: ctx.company.phone,
      sourceSoftware: null, // captured later in the call; admin can fill via notes
      stripePaymentIntentId: paymentIntentId ?? "(no PI id)",
      amountDisplay: formatAmount(amountMinor, currency),
      purchasedAtDisplay,
      adminUrl,
    });
    console.log(
      `[stripe-webhook] Data Setup fulfillment email sent to ${fulfillmentTo} for ${companyId}`
    );
  } catch (err) {
    console.error(
      "[stripe-webhook] Failed to send Data Setup fulfillment email:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Email send failed" },
      { status: 500 }
    );
  }

  // 4. Notify admins via the rail (persistent until status leaves pending).
  await notifyAdmins(supabase, ctx.railRecipients, {
    type: "system",
    title: "Data Setup purchased",
    body: "We'll reach out within 24 hours to schedule your migration.",
    persistent: true,
    actionUrl: "/settings?tab=subscription",
    actionLabel: "View",
  });

  // Suppress unused-arg warning — `stripe` is hoisted into the call site for
  // future expansion (e.g. retrieving the PI to grab the charge id directly).
  void stripe;

  // Return null so the main POST handler writes the dedup record + 200.
  return null;
}

/**
 * Belt-and-suspenders Deckset fulfillment. The canonical mirror update is the
 * customer.subscription.* branch, but checkout.session.completed can arrive
 * first. When the subscription id is available here, mirror it immediately so
 * Deckset unlock state does not wait on a second webhook delivery.
 */
async function handleDecksetCheckoutCompleted(args: {
  supabase: SupabaseClient;
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  companyId: string;
  eventCreated: number;
}): Promise<NextResponse | null> {
  const { supabase, stripe, session, companyId, eventCreated } = args;

  let subscription: Stripe.Subscription | null = null;
  if (typeof session.subscription === "string") {
    subscription = await stripe.subscriptions.retrieve(session.subscription);
  } else if (session.subscription && "id" in session.subscription) {
    subscription = session.subscription as Stripe.Subscription;
  }

  if (!subscription) return null;

  return handleDecksetSubscriptionChange({
    supabase,
    companyId,
    subscription,
    eventCreated,
    checkoutSessionId: session.id,
  });
}

async function handleDecksetSubscriptionChange(args: {
  supabase: SupabaseClient;
  companyId: string;
  subscription: Stripe.Subscription;
  eventCreated: number;
  checkoutSessionId?: string | null;
}): Promise<NextResponse | null> {
  const { supabase, companyId, subscription, eventCreated, checkoutSessionId } =
    args;

  const row = decksetSubscriptionMirrorRow({
    companyId,
    subscription,
    eventCreated,
    checkoutSessionId,
  });

  const { error } = await supabase
    .from("deck_subscriptions")
    .upsert(row, { onConflict: "company_id" });

  if (error) {
    console.error(
      `[stripe-webhook] Failed to mirror Deckset subscription for ${companyId}:`,
      error.message
    );
    return NextResponse.json(
      { error: "Deckset subscription mirror failed" },
      { status: 500 }
    );
  }

  console.log(
    `[stripe-webhook] Deckset subscription mirrored for company ${companyId} (sub=${subscription.id}, status=${subscription.status})`
  );
  return null;
}

/**
 * Handle Priority Support checkout completion. The actual entitlement flip
 * (companies.has_priority_support) happens via the customer.subscription.*
 * branch above when Stripe fires the subscription event. We use this hook
 * for the customer-facing confirmation email + notification rail entry.
 */
async function handlePrioritySupportCheckout(args: {
  supabase: SupabaseClient;
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  companyId: string;
}): Promise<NextResponse | null> {
  const { supabase, stripe, session, companyId } = args;

  // Derive period from the line item's price ID (the canonical source) and
  // fall back to the session metadata only if the expand fails. The metadata
  // is set by our own endpoint, but Stripe-side dashboard edits or future
  // migrations could leave it stale — the price ID can't lie.
  let period: "monthly" | "annual" =
    (session.metadata?.period as "monthly" | "annual") ?? "monthly";
  try {
    const expanded = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["line_items"],
    });
    const itemPriceId = expanded.line_items?.data[0]?.price?.id;
    const addon = addonFromPriceId(itemPriceId);
    if (addon === "priority_support_annual") period = "annual";
    else if (addon === "priority_support_monthly") period = "monthly";
  } catch (err) {
    // Stripe API failure here isn't fatal — metadata fallback is good enough
    // for the email subject line; the entitlement column is set by the
    // customer.subscription.* handler from the price directly.
    console.warn(
      "[stripe-webhook] Could not expand line_items for period derivation, using metadata fallback:",
      err instanceof Error ? err.message : err
    );
  }

  const ctx = await resolveCompanyContext(
    supabase,
    companyId,
    (session.metadata?.purchasedByAuthUid as string | undefined) ?? null
  );
  if (!ctx) {
    console.error(
      `[stripe-webhook] priority_support checkout for unknown company ${companyId} (session ${session.id})`
    );
    return NextResponse.json(
      { error: "Company not found" },
      { status: 404 }
    );
  }

  // Belt-and-suspenders flip: the subscription event will also set this to
  // true, but we set it here too so the UI doesn't lag on the (rare) case
  // where checkout.session.completed lands before customer.subscription.*.
  const { error: flipErr } = await supabase
    .from("companies")
    .update({ has_priority_support: true })
    .eq("id", companyId);
  if (flipErr) {
    console.error(
      `[stripe-webhook] Failed to flip has_priority_support for ${companyId}:`,
      flipErr.message
    );
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Confirmation email to the buyer (or company billing email if no buyer).
  const recipient =
    (session.customer_details?.email as string | null) ?? ctx.company.email;

  if (recipient) {
    const startedAt = new Date(
      (session.created ?? Math.floor(Date.now() / 1000)) * 1000
    );
    const startedAtDisplay = startedAt.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";
    const fulfillmentInbox =
      process.env.ADDON_FULFILLMENT_EMAIL ?? "jack@opsapp.co";

    try {
      await sendPrioritySupportActivated({
        to: recipient,
        companyName: ctx.company.name,
        period,
        startedAtDisplay,
        contactEmail: fulfillmentInbox,
        manageUrl: `${appUrl}/settings?tab=subscription`,
      });
      console.log(
        `[stripe-webhook] Priority support confirmation sent to ${recipient} for ${companyId}`
      );
    } catch (err) {
      console.error(
        "[stripe-webhook] Failed to send priority support confirmation:",
        err instanceof Error ? err.message : err
      );
      // Non-fatal — entitlement is already flipped. Logging is enough; the
      // user can still see the change in the UI and email re-send is cheap.
    }
  } else {
    console.log(
      `[stripe-webhook] Priority support confirmation skipped — no recipient email for ${companyId}`
    );
  }

  // Standard (dismissible) notification.
  await notifyAdmins(supabase, ctx.railRecipients, {
    type: "system",
    title: "Priority Support active",
    body: "Email priority support directly from the subscription tab.",
    persistent: false,
    actionUrl: "/settings?tab=subscription",
    actionLabel: "Open",
  });

  return null; // fall through to dedup record at the bottom of POST
}
