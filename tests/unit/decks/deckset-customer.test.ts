import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isCompGrantCompany,
  ensureDecksetStripeCustomer,
} from "@/lib/decks/billing/stripe-deckset";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";

function compGrantCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID,
    name: "Comped Field Co",
    email: "comp@example.com",
    stripe_customer_id: null,
    subscription_status: "active",
    subscription_plan: "business",
    subscription_end: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStripeDouble() {
  const create = vi.fn(async () => ({ id: "cus_new_deckset" }));
  return {
    stripe: { customers: { create } } as unknown as Stripe,
    create,
  };
}

/** Records companies.update calls so we can assert companies is never touched. */
function makeSupabaseDouble(existingCustomerId: string | null = null) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      return {
        update(row: Record<string, unknown>) {
          updateCalls.push(row);
          return {
            eq() {
              return {
                is() {
                  return {
                    select() {
                      return {
                        maybeSingle: async () => ({
                          data: existingCustomerId
                            ? { stripe_customer_id: existingCustomerId }
                            : { stripe_customer_id: "cus_cas_written" },
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, updateCalls };
}

describe("isCompGrantCompany", () => {
  it("detects the durable comp-grant signature", () => {
    expect(isCompGrantCompany(compGrantCompany())).toBe(true);
  });

  it("is false once a Stripe customer exists (grant already lost NULL)", () => {
    expect(
      isCompGrantCompany(compGrantCompany({ stripe_customer_id: "cus_x" }))
    ).toBe(false);
  });

  it("is false for a normal trial company", () => {
    expect(
      isCompGrantCompany(
        compGrantCompany({
          subscription_status: "trial",
          subscription_plan: "trial",
          subscription_end: "2026-08-01T00:00:00.000Z",
        })
      )
    ).toBe(false);
  });

  it("is false when the end date is not far-future", () => {
    expect(
      isCompGrantCompany(
        compGrantCompany({ subscription_end: "2027-01-01T00:00:00.000Z" })
      )
    ).toBe(false);
  });
});

describe("ensureDecksetStripeCustomer", () => {
  afterEach(() => vi.clearAllMocks());

  it("reuses a Stripe customer already recorded on the mirror", async () => {
    const { stripe, create } = makeStripeDouble();
    const { client, updateCalls } = makeSupabaseDouble();

    const result = await ensureDecksetStripeCustomer({
      stripe,
      supabase: client,
      company: compGrantCompany(),
      fallbackEmail: null,
      existingDeckCustomerId: "cus_prior_deck",
    });

    expect(result).toBe("cus_prior_deck");
    expect(create).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it("gives a comp-grant company a dedicated customer without touching companies", async () => {
    const { stripe, create } = makeStripeDouble();
    const { client, updateCalls } = makeSupabaseDouble();

    const result = await ensureDecksetStripeCustomer({
      stripe,
      supabase: client,
      company: compGrantCompany(),
      fallbackEmail: "fallback@example.com",
      existingDeckCustomerId: null,
    });

    expect(result).toBe("cus_new_deckset");
    // companies.stripe_customer_id must stay NULL — the grant depends on it.
    expect(updateCalls).toEqual([]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Comped Field Co",
        email: "comp@example.com",
        metadata: { companyId: COMPANY_ID, product: "deckset" },
      }),
      { idempotencyKey: `company-${COMPANY_ID}-deckset-customer` }
    );
  });

  it("delegates to the normal path for a non-comp company with a customer", async () => {
    const { stripe, create } = makeStripeDouble();
    const { client, updateCalls } = makeSupabaseDouble();

    const result = await ensureDecksetStripeCustomer({
      stripe,
      supabase: client,
      company: compGrantCompany({
        subscription_status: "trial",
        subscription_plan: "trial",
        subscription_end: "2026-08-01T00:00:00.000Z",
        stripe_customer_id: "cus_existing_ops",
      }),
      fallbackEmail: null,
      existingDeckCustomerId: null,
    });

    // ensureStripeCustomer short-circuits on an existing customer id.
    expect(result).toBe("cus_existing_ops");
    expect(create).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it("CAS-writes companies for a normal company with no customer yet", async () => {
    const { stripe, create } = makeStripeDouble();
    const { client, updateCalls } = makeSupabaseDouble();

    const result = await ensureDecksetStripeCustomer({
      stripe,
      supabase: client,
      company: compGrantCompany({
        subscription_status: "trial",
        subscription_plan: "trial",
        subscription_end: "2026-08-01T00:00:00.000Z",
        stripe_customer_id: null,
      }),
      fallbackEmail: null,
      existingDeckCustomerId: null,
    });

    expect(create).toHaveBeenCalledTimes(1);
    // Non-comp companies keep the pre-existing behavior: CAS-write companies.
    expect(updateCalls).toEqual([{ stripe_customer_id: "cus_new_deckset" }]);
    expect(result).toBe("cus_cas_written");
  });
});
