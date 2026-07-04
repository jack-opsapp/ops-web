import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { constructEventMock, getServiceRoleClientMock, insertCalls, rpcCalls } =
  vi.hoisted(() => ({
    constructEventMock: vi.fn(),
    getServiceRoleClientMock: vi.fn(),
    insertCalls: [] as Array<{ table: string; row: unknown }>,
    rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  }));

vi.mock("stripe", () => ({
  default: vi.fn(() => ({
    webhooks: { constructEvent: constructEventMock },
    subscriptions: { retrieve: vi.fn() },
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

/**
 * The out-of-order guard is enforced atomically inside the
 * mirror_deck_subscription SQL function (verified against the live database):
 * a stale event returns false, a fresh/newer event returns true. This double
 * lets each test dictate that return so we can assert the handler delegates to
 * the RPC and handles both outcomes (always 200, always records dedup).
 */
function makeSupabaseDouble(mirrorWritten: boolean) {
  class Query {
    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq() {
      return this;
    }

    async maybeSingle() {
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
  }

  return {
    from(table: string) {
      return new Query(table);
    },
    async rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return { data: mirrorWritten, error: null };
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

function stubDecksetEvent(
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  status: string,
  createdUnix: number
) {
  constructEventMock.mockReturnValue({
    id: `evt_${type}_${createdUnix}`,
    type,
    created: createdUnix,
    data: {
      object: {
        id: "sub_deckset",
        customer: "cus_123",
        status,
        metadata: { product: "deckset", entitlement: "deck_pro" },
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
}

const NEWER_UNIX = 1900000000;
const OLDER_UNIX = 1880000000;

function mirrorRpcCalls() {
  return rpcCalls.filter((c) => c.fn === "mirror_deck_subscription");
}

describe("Stripe webhook Deckset out-of-order guard", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_MONTHLY", "price_deck_monthly");
    insertCalls.length = 0;
    rpcCalls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("delegates every Deckset event to the atomic mirror RPC with the built row", async () => {
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(true));
    stubDecksetEvent("customer.subscription.updated", "active", NEWER_UNIX);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, product: "deckset" });
    expect(mirrorRpcCalls()).toHaveLength(1);
    expect(mirrorRpcCalls()[0].args).toEqual({
      p_row: expect.objectContaining({
        company_id: COMPANY_ID,
        status: "active",
        stripe_subscription_id: "sub_deckset",
        last_event_at: new Date(NEWER_UNIX * 1000).toISOString(),
      }),
    });
    // The dedup record is always written.
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        {
          table: "stripe_webhook_events",
          row: {
            event_id: "evt_customer.subscription.updated_1900000000",
            event_type: "customer.subscription.updated",
          },
        },
      ])
    );
  });

  it("acks and records dedup when the RPC reports the event was stale (skipped)", async () => {
    // The SQL guard skipped the write (stored row is newer); RPC returns false.
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(false));
    stubDecksetEvent("customer.subscription.updated", "active", OLDER_UNIX);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, product: "deckset" });
    expect(mirrorRpcCalls()).toHaveLength(1);
    expect(insertCalls.some((c) => c.table === "stripe_webhook_events")).toBe(
      true
    );
  });

  it("routes a Deckset subscription.deleted through the same atomic RPC path", async () => {
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(true));
    stubDecksetEvent("customer.subscription.deleted", "canceled", NEWER_UNIX);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(mirrorRpcCalls()).toHaveLength(1);
    expect(mirrorRpcCalls()[0].args).toEqual({
      p_row: expect.objectContaining({ status: "cancelled" }),
    });
  });

  it("500s (Stripe retries) when the mirror RPC errors", async () => {
    getServiceRoleClientMock.mockReturnValue({
      from(table: string) {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => (table === "companies" ? { data: { id: COMPANY_ID, subscription_ids_json: JSON.stringify(["sub_ops_base"]) }, error: null } : { data: null, error: null }) }) }),
          insert: async () => ({ error: null }),
        };
      },
      async rpc() {
        return { data: null, error: { message: "db down" } };
      },
    });
    stubDecksetEvent("customer.subscription.updated", "active", NEWER_UNIX);

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
  });
});
