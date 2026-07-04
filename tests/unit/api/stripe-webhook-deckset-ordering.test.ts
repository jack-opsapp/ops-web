import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { constructEventMock, getServiceRoleClientMock, insertCalls, upsertCalls } =
  vi.hoisted(() => ({
    constructEventMock: vi.fn(),
    getServiceRoleClientMock: vi.fn(),
    insertCalls: [] as Array<{ table: string; row: unknown }>,
    upsertCalls: [] as Array<{ table: string; row: unknown }>,
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

function makeSupabaseDouble(existingLastEventAt: string | null) {
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
      if (this.table === "deck_subscriptions") {
        return {
          data: existingLastEventAt
            ? { last_event_at: existingLastEventAt }
            : null,
          error: null,
        };
      }
      return { data: null, error: null };
    }

    async insert(row: unknown) {
      insertCalls.push({ table: this.table, row });
      return { error: null };
    }

    async upsert(row: unknown) {
      upsertCalls.push({ table: this.table, row });
      return { error: null };
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

// Fresh event created AFTER the mirror's last_event_at (2030-01-01).
const NEWER_UNIX = 1900000000; // 2030-03-17
// Stale event created BEFORE the mirror's last_event_at.
const OLDER_UNIX = 1880000000; // 2029-07-29
const MIRROR_LAST_EVENT_AT = "2030-01-01T00:00:00.000Z"; // 1893456000000ms

describe("Stripe webhook Deckset out-of-order guard", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_MONTHLY", "price_deck_monthly");
    insertCalls.length = 0;
    upsertCalls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("skips the mirror write when a stale event arrives after a newer one", async () => {
    getServiceRoleClientMock.mockReturnValue(
      makeSupabaseDouble(MIRROR_LAST_EVENT_AT)
    );
    // Stale active update landing after the row already recorded a newer event.
    stubDecksetEvent("customer.subscription.updated", "active", OLDER_UNIX);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      product: "deckset",
    });
    // Mirror not rewritten...
    expect(upsertCalls).toEqual([]);
    // ...but the event is still recorded for dedup.
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        {
          table: "stripe_webhook_events",
          row: {
            event_id: "evt_customer.subscription.updated_1880000000",
            event_type: "customer.subscription.updated",
          },
        },
      ])
    );
  });

  it("stale cancellation does not overwrite a newer active mirror", async () => {
    getServiceRoleClientMock.mockReturnValue(
      makeSupabaseDouble(MIRROR_LAST_EVENT_AT)
    );
    stubDecksetEvent("customer.subscription.deleted", "canceled", OLDER_UNIX);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(upsertCalls).toEqual([]);
  });

  it("applies a newer event over an older mirror", async () => {
    getServiceRoleClientMock.mockReturnValue(
      makeSupabaseDouble(MIRROR_LAST_EVENT_AT)
    );
    stubDecksetEvent("customer.subscription.updated", "canceled", NEWER_UNIX);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toMatchObject({
      table: "deck_subscriptions",
      row: { status: "cancelled" },
    });
  });

  it("writes the first mirror when no prior event exists", async () => {
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(null));
    stubDecksetEvent("customer.subscription.updated", "active", OLDER_UNIX);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(upsertCalls).toHaveLength(1);
  });
});
