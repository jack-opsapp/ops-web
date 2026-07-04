import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureStripeCustomer } from "@/lib/stripe/checkout-helpers";

export const DECKSET_SOURCE_APP = "ops_decks";
export const DECKSET_PRODUCT_KEY = "deckset";
export const DECKSET_PRO_ENTITLEMENT = "deck_pro";

export type DecksetBillingPeriod = "Monthly" | "Annual";
export type DecksetSubscriptionStatus =
  | "active"
  | "trialing"
  | "in_grace"
  | "expired"
  | "cancelled"
  | "revoked";

const ACTIVE_DECKSET_STATUSES = new Set<DecksetSubscriptionStatus>([
  "active",
  "trialing",
  "in_grace",
]);

export function decksetPriceEnvName(period: DecksetBillingPeriod): string {
  return period === "Annual"
    ? "STRIPE_PRICE_DECK_PRO_ANNUAL"
    : "STRIPE_PRICE_DECK_PRO_MONTHLY";
}

export function decksetPriceId(
  period: DecksetBillingPeriod
): string | undefined {
  return process.env[decksetPriceEnvName(period)];
}

export function decksetProductId(period: DecksetBillingPeriod): string {
  return period === "Annual" ? "deck_pro_annual" : "deck_pro_monthly";
}

export function decksetPeriodFromStripePriceId(
  priceId: string | null | undefined
): DecksetBillingPeriod | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_DECK_PRO_MONTHLY) return "Monthly";
  if (priceId === process.env.STRIPE_PRICE_DECK_PRO_ANNUAL) return "Annual";
  return null;
}

export function isDecksetProStripePrice(
  priceId: string | null | undefined
): boolean {
  return decksetPeriodFromStripePriceId(priceId) !== null;
}

export function isDecksetCheckoutSession(
  session: Stripe.Checkout.Session
): boolean {
  return (
    session.metadata?.product === DECKSET_PRODUCT_KEY &&
    session.metadata?.entitlement === DECKSET_PRO_ENTITLEMENT
  );
}

export function isDecksetSubscription(
  subscription: Stripe.Subscription
): boolean {
  const itemPriceId = subscription.items.data[0]?.price?.id;
  return (
    isDecksetProStripePrice(itemPriceId) ||
    (subscription.metadata?.product === DECKSET_PRODUCT_KEY &&
      subscription.metadata?.entitlement === DECKSET_PRO_ENTITLEMENT)
  );
}

/** Subscription id an invoice bills (Basil parent.subscription_details shape). */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription;
  if (typeof sub === "string") return sub;
  if (sub && typeof sub === "object" && "id" in sub) return sub.id;
  return null;
}

/** Snapshot of the subscription metadata captured at invoice finalization. */
export function invoiceSubscriptionMetadata(
  invoice: Stripe.Invoice
): Stripe.Metadata | null {
  return invoice.parent?.subscription_details?.metadata ?? null;
}

/** Price ids across the invoice's line items (pricing.price_details shape). */
export function invoiceLinePriceIds(invoice: Stripe.Invoice): string[] {
  return (invoice.lines?.data ?? [])
    .map((line) => {
      const price = line.pricing?.price_details?.price;
      if (typeof price === "string") return price;
      if (price && typeof price === "object" && "id" in price) return price.id;
      return null;
    })
    .filter((priceId): priceId is string => typeof priceId === "string");
}

/**
 * True when an invoice bills the Deckset Pro subscription — by the metadata
 * snapshot (product + entitlement stamped at checkout) or by any line item
 * pricing a Deckset Pro price. Pure/synchronous.
 */
export function isDecksetInvoice(invoice: Stripe.Invoice): boolean {
  const metadata = invoiceSubscriptionMetadata(invoice);
  if (
    metadata?.product === DECKSET_PRODUCT_KEY &&
    metadata?.entitlement === DECKSET_PRO_ENTITLEMENT
  ) {
    return true;
  }
  return invoiceLinePriceIds(invoice).some(isDecksetProStripePrice);
}

export function mapStripeSubscriptionStatusToDecksetStatus(
  status: Stripe.Subscription.Status
): DecksetSubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "paused":
      return "in_grace";
    case "canceled":
      return "cancelled";
    case "incomplete_expired":
    case "unpaid":
    case "incomplete":
      return "expired";
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return "expired";
    }
  }
}

export function decksetStatusUnlocksPro(
  status: DecksetSubscriptionStatus
): boolean {
  return ACTIVE_DECKSET_STATUSES.has(status);
}

export function buildDecksetCheckoutReturnUrls(params: { appUrl: string }): {
  successUrl: string;
  cancelUrl: string;
} {
  const base = `${params.appUrl}/decks/checkout/result`;
  return {
    successUrl: `${base}?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}?status=cancelled`,
  };
}

/**
 * Comp-grant signature shape (subset of companies). Fields the detector reads.
 */
export interface CompGrantSignatureFields {
  stripe_customer_id: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_end: string | null;
}

// Permanent comp/free grants encode themselves in companies as
// status=active + plan=business + a sentinel far-future subscription_end +
// stripe_customer_id NULL (the NULL is load-bearing: it keeps the account off
// the StoreKit/Stripe billing gate). No legitimate paid subscription ends this
// far out, so the sentinel year is a safe discriminator.
const COMP_GRANT_SENTINEL_MS = Date.parse("2098-01-01T00:00:00.000Z");

export function isCompGrantCompany(
  company: CompGrantSignatureFields
): boolean {
  if (company.stripe_customer_id) return false;
  if (company.subscription_status !== "active") return false;
  if (company.subscription_plan !== "business") return false;
  if (!company.subscription_end) return false;
  const endMs = Date.parse(company.subscription_end);
  return Number.isFinite(endMs) && endMs >= COMP_GRANT_SENTINEL_MS;
}

/**
 * Resolve the Stripe customer for a Deckset checkout, isolating the
 * load-bearing NULL of a comp-granted company.
 *
 *  1. Reuse a customer already recorded on the mirror (a prior Deckset
 *     subscription) so a re-buy after cancellation never orphans a customer.
 *  2. Comp-granted company → mint a Deckset-dedicated customer and DO NOT
 *     write companies.stripe_customer_id. The permanent grant is encoded by
 *     that NULL; CAS-writing it (as the generic path does) would silently
 *     revoke free access. The webhook records this id on
 *     deck_subscriptions.stripe_customer_id.
 *  3. Otherwise → the generic reuse-or-CAS path on companies (unchanged).
 */
export async function ensureDecksetStripeCustomer(params: {
  stripe: Stripe;
  supabase: SupabaseClient;
  company: CompGrantSignatureFields & {
    id: string;
    name: string;
    email: string | null;
  };
  fallbackEmail: string | null;
  existingDeckCustomerId: string | null;
}): Promise<string> {
  if (params.existingDeckCustomerId) return params.existingDeckCustomerId;

  const email = (params.company.email ?? params.fallbackEmail) || null;

  if (isCompGrantCompany(params.company)) {
    const customer = await params.stripe.customers.create(
      {
        email: email ?? undefined,
        name: params.company.name,
        metadata: {
          companyId: params.company.id,
          product: DECKSET_PRODUCT_KEY,
        },
      },
      { idempotencyKey: `company-${params.company.id}-deckset-customer` }
    );
    return customer.id;
  }

  return ensureStripeCustomer({
    stripe: params.stripe,
    supabase: params.supabase,
    companyId: params.company.id,
    companyName: params.company.name,
    email,
    existingCustomerId: params.company.stripe_customer_id,
  });
}

/**
 * Classify whether a PMF-tracked Stripe event is a Deckset event, so it can be
 * kept out of the billing_events ledger (which drives OPS MRR, first_paid,
 * churn, and retention cohorts — none of which may count Deckset revenue).
 *
 * Subscription / checkout / invoice events classify synchronously off their
 * own payload. Charge events (refund / dispute) carry no direct product
 * marker, so we trace charge → payment_intent → invoice payment → invoice and
 * classify that; any failure or ambiguity FAILS OPEN (treated as non-Deckset,
 * i.e. ingested) so a genuine OPS refund is never silently dropped.
 */
export async function isDecksetBillingEvent(
  event: Stripe.Event,
  stripe: Stripe
): Promise<boolean> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return isDecksetSubscription(event.data.object as Stripe.Subscription);
    case "checkout.session.completed":
      return isDecksetCheckoutSession(
        event.data.object as Stripe.Checkout.Session
      );
    case "invoice.paid":
    case "invoice.payment_failed":
      return isDecksetInvoice(event.data.object as Stripe.Invoice);
    case "charge.refunded":
    case "charge.dispute.created":
      return isDecksetChargeEvent(event, stripe);
    default:
      return false;
  }
}

function chargePaymentIntentId(event: Stripe.Event): string | null {
  const obj = event.data.object as {
    payment_intent?: string | { id?: string } | null;
  };
  const pi = obj.payment_intent;
  if (typeof pi === "string") return pi;
  if (pi && typeof pi === "object" && typeof pi.id === "string") return pi.id;
  return null;
}

async function isDecksetChargeEvent(
  event: Stripe.Event,
  stripe: Stripe
): Promise<boolean> {
  const paymentIntentId = chargePaymentIntentId(event);
  if (!paymentIntentId) return false; // one-off / non-invoice charge — fail open

  try {
    const payments = await stripe.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: paymentIntentId },
      expand: ["data.invoice"],
      limit: 1,
    });
    const invoice = payments.data[0]?.invoice;
    if (invoice && typeof invoice === "object" && "lines" in invoice) {
      return isDecksetInvoice(invoice as Stripe.Invoice);
    }
    return false;
  } catch (err) {
    // Fail open — never drop a real OPS refund because a lookup failed.
    console.warn(
      `[stripe-deckset] Deckset charge classification failed for ${event.id}; ingesting as OPS:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

export function decksetSubscriptionMirrorRow(params: {
  companyId: string;
  subscription: Stripe.Subscription;
  eventCreated: number;
  checkoutSessionId?: string | null;
}): Record<string, unknown> {
  const { companyId, subscription, eventCreated, checkoutSessionId } = params;
  const item = subscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const period = decksetPeriodFromStripePriceId(priceId);
  // Live price id first — a Stripe portal plan-switch (monthly ⇄ annual)
  // updates the line item but leaves subscription.metadata.productId stamped
  // at checkout, so trusting metadata would pin a stale SKU. Metadata is the
  // fallback only when the price is unmapped (legacy/unknown).
  const productId =
    (period ? decksetProductId(period) : null) ??
    subscription.metadata?.productId ??
    priceId ??
    DECKSET_PRO_ENTITLEMENT;
  const currentPeriodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : (subscription.customer?.id ?? null);

  return {
    company_id: companyId,
    entitlement: DECKSET_PRO_ENTITLEMENT,
    status: mapStripeSubscriptionStatusToDecksetStatus(subscription.status),
    product_id: productId,
    store: "stripe",
    provider: "stripe",
    customer_id: customerId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    stripe_checkout_session_id: checkoutSessionId ?? null,
    current_period_end: currentPeriodEnd,
    expires_at: currentPeriodEnd,
    last_event_at: new Date(eventCreated * 1000).toISOString(),
    deleted_at: null,
  };
}
