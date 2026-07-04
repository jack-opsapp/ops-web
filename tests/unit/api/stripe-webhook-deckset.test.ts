import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  constructEventMock,
  getServiceRoleClientMock,
  insertCalls,
  rpcCalls,
  updateCalls,
} = vi.hoisted(() => ({
  constructEventMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  insertCalls: [] as Array<{ table: string; row: unknown }>,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  updateCalls: [] as Array<{ table: string; row: unknown }>,
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

function makeSupabaseDouble() {
  class Query {
    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq() {
      return this;
    }

    async maybeSingle() {
      if (this.table === "stripe_webhook_events") {
        return { data: null, error: null };
      }
      if (this.table === "companies") {
        return {
          data: {
            id: COMPANY_ID,
            subscription_ids_json: JSON.stringify(["sub_ops_base"]),
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }

    async insert(row: unknown) {
      insertCalls.push({ table: this.table, row });
      return { error: null };
    }

    update(row: unknown) {
      updateCalls.push({ table: this.table, row });
      return this;
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
    async rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      // mirror_deck_subscription returns true when the row was written.
      return { data: true, error: null };
    },
  };
}

function makeRequest() {
  return new NextRequest("http://test.local/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "stripe-signature": "sig_123",
    },
    body: "{}",
  });
}

describe("Stripe webhook Deckset subscriptions", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_MONTHLY", "price_deck_monthly");
    insertCalls.length = 0;
    rpcCalls.length = 0;
    updateCalls.length = 0;
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble());
    constructEventMock.mockReturnValue({
      id: "evt_deckset_subscription_updated",
      type: "customer.subscription.updated",
      created: 1890864000,
      data: {
        object: {
          id: "sub_deckset",
          customer: "cus_123",
          status: "active",
          metadata: {
            product: "deckset",
            entitlement: "deck_pro",
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
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("mirrors Deckset subscription status without touching OPS subscription columns", async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      product: "deckset",
    });
    expect(rpcCalls).toEqual([
      {
        fn: "mirror_deck_subscription",
        args: {
          p_row: expect.objectContaining({
            company_id: COMPANY_ID,
            entitlement: "deck_pro",
            status: "active",
            product_id: "deck_pro_monthly",
            store: "stripe",
            provider: "stripe",
            customer_id: "cus_123",
            stripe_customer_id: "cus_123",
            stripe_subscription_id: "sub_deckset",
            stripe_price_id: "price_deck_monthly",
            expires_at: "2030-01-01T00:00:00.000Z",
            last_event_at: "2029-12-02T00:00:00.000Z",
          }),
        },
      },
    ]);
    expect(updateCalls).toEqual([]);
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        {
          table: "stripe_webhook_events",
          row: {
            event_id: "evt_deckset_subscription_updated",
            event_type: "customer.subscription.updated",
          },
        },
      ])
    );
  });
});
