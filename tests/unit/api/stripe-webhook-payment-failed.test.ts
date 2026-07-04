import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { constructEventMock, getServiceRoleClientMock, insertCalls, updateCalls } =
  vi.hoisted(() => ({
    constructEventMock: vi.fn(),
    getServiceRoleClientMock: vi.fn(),
    insertCalls: [] as Array<{ table: string; row: unknown }>,
    updateCalls: [] as Array<{ table: string; row: Record<string, unknown> }>,
  }));

vi.mock("stripe", () => ({
  default: vi.fn(() => ({
    webhooks: {
      constructEvent: constructEventMock,
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  })),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/email/sendgrid", () => ({
  sendDataSetupRequest: vi.fn(),
  sendPrioritySupportActivated: vi.fn(),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";

function makeSupabaseDouble(companyRow: Record<string, unknown> | null) {
  class Query {
    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(_column?: string, _value?: unknown) {
      return this;
    }

    async maybeSingle() {
      if (this.table === "companies") {
        return { data: companyRow, error: null };
      }
      return { data: null, error: null };
    }

    async insert(row: unknown) {
      insertCalls.push({ table: this.table, row });
      return { error: null };
    }

    update(row: Record<string, unknown>) {
      updateCalls.push({ table: this.table, row });
      return {
        eq: async () => ({ error: null }),
      };
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
  };
}

function makeRequest() {
  return new NextRequest("http://test.local/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig_123" },
    body: "{}",
  });
}

interface InvoiceEventArgs {
  subscriptionId?: string | null;
  subscriptionMetadata?: Record<string, string>;
  linePriceIds?: Array<string | null>;
  hasSubscriptionParent?: boolean;
}

function stubInvoicePaymentFailed(args: InvoiceEventArgs) {
  const {
    subscriptionId = null,
    subscriptionMetadata = {},
    linePriceIds = [],
    hasSubscriptionParent = true,
  } = args;

  constructEventMock.mockReturnValue({
    id: "evt_invoice_payment_failed",
    type: "invoice.payment_failed",
    created: 1890864000,
    data: {
      object: {
        id: "in_123",
        object: "invoice",
        customer: "cus_123",
        currency: "usd",
        amount_paid: 0,
        parent: hasSubscriptionParent
          ? {
              type: "subscription_details",
              subscription_details: {
                subscription: subscriptionId,
                metadata: subscriptionMetadata,
              },
            }
          : null,
        lines: {
          data: linePriceIds.map((priceId) => ({
            id: "il_1",
            pricing: priceId
              ? { price_details: { price: priceId } }
              : null,
          })),
        },
      },
    },
  });
}

function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID,
    seat_grace_start_date: null,
    subscription_ids_json: JSON.stringify(["sub_ops_base"]),
    ...overrides,
  };
}

function companyUpdates() {
  return updateCalls.filter((c) => c.table === "companies");
}

describe("Stripe webhook invoice.payment_failed guard", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_PRICE_TEAM_MONTHLY", "price_ops_team_monthly");
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_MONTHLY", "price_deck_monthly");
    vi.stubEnv(
      "STRIPE_PRICE_PRIORITY_SUPPORT_MONTHLY",
      "price_priority_monthly"
    );
    insertCalls.length = 0;
    updateCalls.length = 0;
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(companyRow()));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("keeps the grace flip for a tracked OPS base-plan invoice", async () => {
    stubInvoicePaymentFailed({
      subscriptionId: "sub_ops_base",
      linePriceIds: ["price_ops_team_monthly"],
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(companyUpdates()).toEqual([
      {
        table: "companies",
        row: {
          subscription_status: "grace",
          seat_grace_start_date: expect.any(String),
        },
      },
    ]);
  });

  it("flips grace for a tracked subscription even on a legacy price", async () => {
    stubInvoicePaymentFailed({
      subscriptionId: "sub_ops_base",
      linePriceIds: ["price_legacy_grandfathered"],
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(companyUpdates()).toHaveLength(1);
  });

  it("flips grace on a base-plan price when tracking is not yet written", async () => {
    getServiceRoleClientMock.mockReturnValue(
      makeSupabaseDouble(companyRow({ subscription_ids_json: null }))
    );
    stubInvoicePaymentFailed({
      subscriptionId: "sub_brand_new",
      linePriceIds: ["price_ops_team_monthly"],
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(companyUpdates()).toHaveLength(1);
  });

  it("does not extend the grace window on repeat failures", async () => {
    getServiceRoleClientMock.mockReturnValue(
      makeSupabaseDouble(
        companyRow({ seat_grace_start_date: "2026-06-01T00:00:00.000Z" })
      )
    );
    stubInvoicePaymentFailed({
      subscriptionId: "sub_ops_base",
      linePriceIds: ["price_ops_team_monthly"],
    });

    await POST(makeRequest());

    expect(companyUpdates()).toEqual([
      { table: "companies", row: { subscription_status: "grace" } },
    ]);
  });

  it("never flips the company to grace for a Deckset invoice", async () => {
    stubInvoicePaymentFailed({
      subscriptionId: "sub_deckset",
      subscriptionMetadata: { product: "deckset", entitlement: "deck_pro" },
      linePriceIds: ["price_deck_monthly"],
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(companyUpdates()).toEqual([]);
    // The event still completes and is recorded for dedup.
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        {
          table: "stripe_webhook_events",
          row: {
            event_id: "evt_invoice_payment_failed",
            event_type: "invoice.payment_failed",
          },
        },
      ])
    );
  });

  it("never flips the company to grace for a priority-support add-on invoice", async () => {
    stubInvoicePaymentFailed({
      subscriptionId: "sub_priority_addon",
      linePriceIds: ["price_priority_monthly"],
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(companyUpdates()).toEqual([]);
  });

  it("never flips the company to grace for a one-off invoice with no subscription", async () => {
    stubInvoicePaymentFailed({
      hasSubscriptionParent: false,
      linePriceIds: ["price_one_off_line"],
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(companyUpdates()).toEqual([]);
  });
});
