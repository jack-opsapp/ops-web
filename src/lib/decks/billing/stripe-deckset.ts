import type Stripe from "stripe";

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
  const productId =
    subscription.metadata?.productId ??
    (period ? decksetProductId(period) : priceId) ??
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
