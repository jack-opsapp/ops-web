/**
 * Integration tests for the PMF billing_events insert layered onto the
 * existing Stripe webhook handler.
 *
 * The handler at src/app/api/webhooks/stripe/route.ts is the single Stripe
 * endpoint — it does subscription state sync AND now writes to billing_events
 * for the seven financially-meaningful event types. These tests verify only
 * the billing_events behaviour; the existing per-type handlers are exercised
 * by their own callers and are left untouched.
 *
 * Mocking strategy:
 *   - vi.mock("@/lib/supabase/server-client") returns a hand-rolled mock
 *     client that records every .insert(...) and .update(...) call so we can
 *     assert against the rows the handler tried to write.
 *   - We sign every payload with the real HMAC SHA-256 routine Stripe uses,
 *     so the actual Stripe SDK's signature verification path runs end-to-end.
 *   - We never hit a real Supabase or Stripe — the test is hermetic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const SECRET = "whsec_test_secret_for_pmf_billing_events";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_for_pmf_billing_events";

// Static import (matches sendgrid-webhook.test.ts pattern). The previous
// per-test `await import(...)` paid the route module's first-load compile
// cost inside test 1 ("invoice.paid"), which spiked to 4+ seconds and tipped
// past the 5000ms vitest default in CI. When test 1 timed out, its in-flight
// POST kept running and pushed a late insertCalls entry AFTER beforeEach had
// reset the array for test 2 ("charge.refunded"), making it see length 2.
// Hoisting the import to module load amortizes the cost out of any test body.
import { POST } from "@/app/api/webhooks/stripe/route";

// Recorders shared with the mock client below — reset between tests.
const insertCalls: Array<{ table: string; row: Record<string, unknown> }> = [];
const updateCalls: Array<{
  table: string;
  payload: Record<string, unknown>;
  eqColumn?: string;
  eqValue?: unknown;
}> = [];

// Per-table select stubs — each .from(x).select().eq().maybeSingle() returns
// `{ data: null, error: null }` by default so the existing handler treats the
// customer as unknown (which is fine for these tests).
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => makeMockClient(),
}));

interface MockBuilder {
  select: (cols?: string) => MockBuilder;
  eq: (col: string, val: unknown) => MockBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  insert: (
    row: Record<string, unknown>
  ) => Promise<{ error: { code?: string; message: string } | null }>;
  update: (payload: Record<string, unknown>) => MockBuilder;
}

function makeMockClient() {
  return {
    from(table: string): MockBuilder {
      const builder: MockBuilder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: async (row) => {
          insertCalls.push({ table, row });
          return { error: null };
        },
        update: (payload) => {
          // companies table updates use .update().eq() pattern; record on .eq
          const updateBuilder: MockBuilder = {
            ...builder,
            eq: (eqColumn: string, eqValue: unknown) => {
              updateCalls.push({ table, payload, eqColumn, eqValue });
              return {
                ...updateBuilder,
                eq: () => updateBuilder,
                // After .eq(), some callsites await directly. Make the result
                // thenable so `await supabase.from().update().eq()` resolves.
                then: (
                  onFulfilled?: (v: { error: null }) => unknown
                ) => Promise.resolve({ error: null }).then(onFulfilled),
              } as MockBuilder & {
                then: (onFulfilled?: (v: { error: null }) => unknown) => Promise<unknown>;
              };
            },
          };
          return updateBuilder;
        },
      };
      return builder;
    },
  };
}

function signEvent(payload: unknown): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = `${timestamp}.${body}`;
  const v1 = crypto.createHmac("sha256", SECRET).update(signed).digest("hex");
  return { body, signature: `t=${timestamp},v1=${v1}` };
}

function buildReq(payload: unknown): Request {
  const { body, signature } = signEvent(payload);
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "stripe-signature": signature,
      "content-type": "application/json",
    },
    body,
  });
}

describe("Stripe webhook → billing_events", () => {
  beforeEach(() => {
    insertCalls.length = 0;
    updateCalls.length = 0;
  });

  it("inserts a billing_events row for invoice.paid with the right shape", async () => {
    const evt = {
      id: `evt_test_paid_${Date.now()}`,
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          customer: "cus_test_invoice_paid",
          amount_paid: 4900,
          currency: "usd",
        },
      },
    };
    // Cast to NextRequest for the route signature; the handler only uses
    // standard Request interface methods (text, headers).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildReq(evt) as any);
    expect(res.status).toBe(200);

    const billingInserts = insertCalls.filter((c) => c.table === "billing_events");
    expect(billingInserts).toHaveLength(1);
    const row = billingInserts[0].row;
    expect(row.stripe_event_id).toBe(evt.id);
    expect(row.event_type).toBe("invoice.paid");
    expect(row.stripe_customer_id).toBe("cus_test_invoice_paid");
    expect(row.amount_cents).toBe(4900);
    expect(row.currency).toBe("usd");
    expect(typeof row.occurred_at).toBe("string");
    expect(row.company_id).toBeNull();
    expect(row.raw).toBeTypeOf("object");
  });

  it("inserts a billing_events row for charge.refunded using amount_refunded", async () => {
    const evt = {
      id: `evt_test_refund_${Date.now()}`,
      type: "charge.refunded",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          customer: "cus_test_refund",
          amount_refunded: 1000,
          currency: "usd",
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildReq(evt) as any);
    expect(res.status).toBe(200);

    const billingInserts = insertCalls.filter((c) => c.table === "billing_events");
    expect(billingInserts).toHaveLength(1);
    expect(billingInserts[0].row.event_type).toBe("charge.refunded");
    expect(billingInserts[0].row.amount_cents).toBe(1000);
  });

  it("inserts billing_events for customer.subscription.created", async () => {
    const evt = {
      id: `evt_test_sub_created_${Date.now()}`,
      type: "customer.subscription.created",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "sub_test_123",
          customer: "cus_test_sub",
          status: "trialing",
          items: { data: [{ price: { id: "price_x" }, current_period_end: 1234567890 }] },
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildReq(evt) as any);
    expect(res.status).toBe(200);

    const billingInserts = insertCalls.filter((c) => c.table === "billing_events");
    expect(billingInserts).toHaveLength(1);
    expect(billingInserts[0].row.event_type).toBe("customer.subscription.created");
    expect(billingInserts[0].row.stripe_customer_id).toBe("cus_test_sub");
  });

  it("does NOT insert into billing_events for an untracked event type", async () => {
    const evt = {
      id: `evt_test_other_${Date.now()}`,
      type: "customer.created",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: "cus_test_x" } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildReq(evt) as any);
    expect(res.status).toBe(200);

    const billingInserts = insertCalls.filter((c) => c.table === "billing_events");
    expect(billingInserts).toHaveLength(0);
  });

  it("does NOT insert into billing_events for payment_intent.succeeded (existing handler only)", async () => {
    const evt = {
      id: `evt_test_pi_${Date.now()}`,
      type: "payment_intent.succeeded",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "pi_test_1",
          amount: 5000,
          // No portal metadata — existing handler will short-circuit, but
          // billing_events should still be skipped because PI succeeded is
          // not in PMF_TRACKED_EVENTS.
          metadata: {},
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildReq(evt) as any);
    expect(res.status).toBe(200);

    const billingInserts = insertCalls.filter((c) => c.table === "billing_events");
    expect(billingInserts).toHaveLength(0);
  });

  it("does NOT ingest a Deckset invoice.paid into billing_events", async () => {
    const evt = {
      id: `evt_deck_invoice_${Date.now()}`,
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          customer: "cus_deck",
          amount_paid: 11900,
          currency: "usd",
          parent: {
            type: "subscription_details",
            subscription_details: {
              subscription: "sub_deck",
              metadata: { product: "deckset", entitlement: "deck_pro" },
            },
          },
          lines: { data: [] },
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildReq(evt) as any);
    expect(res.status).toBe(200);
    expect(insertCalls.filter((c) => c.table === "billing_events")).toHaveLength(0);
  });

  it("does NOT ingest a Deckset customer.subscription.created into billing_events", async () => {
    const evt = {
      id: `evt_deck_sub_${Date.now()}`,
      type: "customer.subscription.created",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "sub_deck_new",
          customer: "cus_deck",
          status: "active",
          metadata: { product: "deckset", entitlement: "deck_pro" },
          items: { data: [{ price: { id: "price_x" }, current_period_end: 1234567890 }] },
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildReq(evt) as any);
    expect(res.status).toBe(200);
    expect(insertCalls.filter((c) => c.table === "billing_events")).toHaveLength(0);
  });

  it("does NOT ingest a Deckset checkout.session.completed into billing_events", async () => {
    const evt = {
      id: `evt_deck_checkout_${Date.now()}`,
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "cs_deck",
          customer: "cus_deck",
          // No subscription id → the belt-and-suspenders mirror path no-ops
          // without a network call; we only assert the ledger exclusion here.
          subscription: null,
          amount_total: 11900,
          currency: "usd",
          client_reference_id: "00000000-0000-4000-8000-000000000001",
          metadata: {
            product: "deckset",
            entitlement: "deck_pro",
            companyId: "00000000-0000-4000-8000-000000000001",
          },
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(buildReq(evt) as any);
    expect(res.status).toBe(200);
    expect(insertCalls.filter((c) => c.table === "billing_events")).toHaveLength(0);
  });

  it("rejects with 400 on bad signature", async () => {
    const req = new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=0,v1=deadbeef" },
      body: "{}",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);

    expect(insertCalls.filter((c) => c.table === "billing_events")).toHaveLength(0);
  });

  it("rejects with 400 when stripe-signature header is missing", async () => {
    const req = new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });
});
