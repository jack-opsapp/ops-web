import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decksetPeriodFromStripePriceId,
  decksetPriceEnvName,
  decksetProductId,
  decksetStatusUnlocksPro,
  decksetSubscriptionMirrorRow,
  isDecksetProStripePrice,
  mapStripeSubscriptionStatusToDecksetStatus,
} from "@/lib/decks/billing/stripe-deckset";
import type Stripe from "stripe";

describe("Deckset Stripe billing helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves Deckset price ids and product ids without touching OPS plan ids", () => {
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_MONTHLY", "price_deck_monthly");
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_ANNUAL", "price_deck_annual");

    expect(decksetPriceEnvName("Monthly")).toBe(
      "STRIPE_PRICE_DECK_PRO_MONTHLY"
    );
    expect(decksetPriceEnvName("Annual")).toBe("STRIPE_PRICE_DECK_PRO_ANNUAL");
    expect(decksetProductId("Monthly")).toBe("deck_pro_monthly");
    expect(decksetProductId("Annual")).toBe("deck_pro_annual");
    expect(decksetPeriodFromStripePriceId("price_deck_monthly")).toBe(
      "Monthly"
    );
    expect(decksetPeriodFromStripePriceId("price_deck_annual")).toBe("Annual");
    expect(isDecksetProStripePrice("price_team_monthly")).toBe(false);
  });

  it("maps Stripe subscription status to Deckset entitlement status", () => {
    expect(mapStripeSubscriptionStatusToDecksetStatus("active")).toBe("active");
    expect(mapStripeSubscriptionStatusToDecksetStatus("trialing")).toBe(
      "trialing"
    );
    expect(mapStripeSubscriptionStatusToDecksetStatus("past_due")).toBe(
      "in_grace"
    );
    expect(mapStripeSubscriptionStatusToDecksetStatus("paused")).toBe(
      "in_grace"
    );
    expect(mapStripeSubscriptionStatusToDecksetStatus("canceled")).toBe(
      "cancelled"
    );
    expect(mapStripeSubscriptionStatusToDecksetStatus("unpaid")).toBe(
      "expired"
    );
    expect(decksetStatusUnlocksPro("active")).toBe(true);
    expect(decksetStatusUnlocksPro("in_grace")).toBe(true);
    expect(decksetStatusUnlocksPro("cancelled")).toBe(false);
  });

  it("builds a dedicated mirror row from a Stripe subscription", () => {
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_MONTHLY", "price_deck_monthly");
    const subscription = {
      id: "sub_123",
      customer: "cus_123",
      status: "active",
      metadata: {
        productId: "deck_pro_monthly",
      },
      items: {
        data: [
          {
            current_period_end: 1893456000,
            price: { id: "price_deck_monthly" },
          },
        ],
      },
    } as unknown as Stripe.Subscription;

    expect(
      decksetSubscriptionMirrorRow({
        companyId: "00000000-0000-4000-8000-000000000001",
        subscription,
        eventCreated: 1890864000,
        checkoutSessionId: "cs_123",
      })
    ).toMatchObject({
      company_id: "00000000-0000-4000-8000-000000000001",
      entitlement: "deck_pro",
      status: "active",
      product_id: "deck_pro_monthly",
      store: "stripe",
      provider: "stripe",
      customer_id: "cus_123",
      stripe_customer_id: "cus_123",
      stripe_subscription_id: "sub_123",
      stripe_price_id: "price_deck_monthly",
      stripe_checkout_session_id: "cs_123",
      expires_at: "2030-01-01T00:00:00.000Z",
      last_event_at: "2029-12-02T00:00:00.000Z",
      deleted_at: null,
    });
  });

  it("derives product_id from the live price id, not stale metadata", () => {
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_MONTHLY", "price_deck_monthly");
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_ANNUAL", "price_deck_annual");
    // Portal plan switch monthly → annual: the line item now bills the
    // annual price, but the subscription metadata still carries the SKU
    // stamped at checkout. The live price must win.
    const subscription = {
      id: "sub_switch",
      customer: "cus_123",
      status: "active",
      metadata: { productId: "deck_pro_monthly" },
      items: {
        data: [
          {
            current_period_end: 1893456000,
            price: { id: "price_deck_annual" },
          },
        ],
      },
    } as unknown as Stripe.Subscription;

    expect(
      decksetSubscriptionMirrorRow({
        companyId: "00000000-0000-4000-8000-000000000001",
        subscription,
        eventCreated: 1890864000,
      })
    ).toMatchObject({
      product_id: "deck_pro_annual",
      stripe_price_id: "price_deck_annual",
    });
  });

  it("falls back to metadata productId when the price is unknown", () => {
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_MONTHLY", "price_deck_monthly");
    const subscription = {
      id: "sub_meta",
      customer: "cus_123",
      status: "active",
      metadata: { product: "deckset", entitlement: "deck_pro", productId: "deck_pro_monthly" },
      items: {
        data: [
          {
            current_period_end: 1893456000,
            price: { id: "price_unmapped_legacy" },
          },
        ],
      },
    } as unknown as Stripe.Subscription;

    expect(
      decksetSubscriptionMirrorRow({
        companyId: "00000000-0000-4000-8000-000000000001",
        subscription,
        eventCreated: 1890864000,
      })
    ).toMatchObject({ product_id: "deck_pro_monthly" });
  });
});
