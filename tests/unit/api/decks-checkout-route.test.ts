import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  bucketedIdempotencyKeyMock,
  checkoutSessionCreateMock,
  ensureDecksetStripeCustomerMock,
  findUserByAuthMock,
  getServiceRoleClientMock,
  verifyAuthTokenMock,
} = vi.hoisted(() => ({
  bucketedIdempotencyKeyMock: vi.fn(),
  checkoutSessionCreateMock: vi.fn(),
  ensureDecksetStripeCustomerMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  verifyAuthTokenMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: verifyAuthTokenMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/stripe/checkout-helpers", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: checkoutSessionCreateMock,
      },
    },
  }),
  bucketedIdempotencyKey: bucketedIdempotencyKeyMock,
}));

// ensureDecksetStripeCustomer is the only decks-billing symbol we double; the
// route also imports pure helpers (price/period/metadata) from this module,
// so re-export the real implementations and override just the customer path.
vi.mock("@/lib/decks/billing/stripe-deckset", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/decks/billing/stripe-deckset")
  >("@/lib/decks/billing/stripe-deckset");
  return {
    ...actual,
    ensureDecksetStripeCustomer: ensureDecksetStripeCustomerMock,
  };
});

import { POST } from "@/app/api/decks/checkout/route";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_COMPANY_ID = "00000000-0000-4000-8000-000000000002";

type QueryResult = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

function makeSupabaseDouble(args: {
  mirror?: QueryResult;
  company?: QueryResult;
}) {
  class Query {
    constructor(private readonly result: QueryResult) {}

    select() {
      return this;
    }

    eq() {
      return this;
    }

    is() {
      return this;
    }

    async maybeSingle() {
      return this.result;
    }
  }

  return {
    from(table: string) {
      if (table === "deck_subscriptions") {
        return new Query(args.mirror ?? { data: null, error: null });
      }
      if (table === "companies") {
        return new Query(
          args.company ?? {
            data: {
              id: COMPANY_ID,
              name: "Deckset Field Co",
              email: "billing@example.com",
              stripe_customer_id: null,
            },
            error: null,
          }
        );
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function makeRequest(body: Record<string, unknown>, token = "valid-token") {
  return new NextRequest("http://test.local/api/decks/checkout", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    company_id: COMPANY_ID,
    period: "Monthly",
    entitlement: "deck_pro",
    source_app: "ops_decks",
    ...overrides,
  };
}

describe("POST /api/decks/checkout", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.opsapp.co");
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_MONTHLY", "price_deck_monthly");
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_ANNUAL", "price_deck_annual");

    verifyAuthTokenMock.mockResolvedValue({
      uid: "firebase-123",
      email: "deck@example.com",
      claims: {},
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: COMPANY_ID,
    });
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble({}));
    ensureDecksetStripeCustomerMock.mockResolvedValue("cus_123");
    bucketedIdempotencyKeyMock.mockReturnValue("idem-company-deckset");
    checkoutSessionCreateMock.mockResolvedValue({
      id: "cs_123",
      url: "https://checkout.stripe.com/c/cs_123",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 401 when the standalone app omits a bearer token", async () => {
    const response = await POST(
      new NextRequest("http://test.local/api/decks/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "unauthorized",
      message: "Missing Authorization bearer token",
    });
    expect(checkoutSessionCreateMock).not.toHaveBeenCalled();
  });

  it("rejects non-Deckset checkout payloads", async () => {
    const response = await POST(
      makeRequest(validBody({ entitlement: "ops_business" }))
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "bad_request",
      message: "company_id, period, entitlement, and source_app are required.",
    });
    expect(checkoutSessionCreateMock).not.toHaveBeenCalled();
  });

  it("accepts a company_id that differs from the auth scope only by case", async () => {
    // iOS persists the provisioning response verbatim; guard against a
    // historical uppercase copy failing a byte-equality compare.
    const letteredId = "00000000-0000-4000-8000-0000000000ab";
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: letteredId,
    });

    const response = await POST(
      makeRequest(validBody({ company_id: letteredId.toUpperCase() }))
    );

    expect(response.status).toBe(200);
    expect(checkoutSessionCreateMock).toHaveBeenCalled();
  });

  it("blocks company scope mismatches before Stripe is touched", async () => {
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: OTHER_COMPANY_ID,
    });

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "company_scope_mismatch",
      message: "Company scope mismatch",
    });
    expect(checkoutSessionCreateMock).not.toHaveBeenCalled();
  });

  it("does not create duplicate checkout when Deckset Pro already unlocks", async () => {
    getServiceRoleClientMock.mockReturnValue(
      makeSupabaseDouble({
        mirror: { data: { status: "active" }, error: null },
      })
    );

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "already_subscribed",
      message: "Deckset Pro is already active for this company.",
    });
    expect(checkoutSessionCreateMock).not.toHaveBeenCalled();
  });

  it("creates a Stripe Checkout session with Deckset-only metadata", async () => {
    const response = await POST(makeRequest(validBody({ period: "Annual" })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://checkout.stripe.com/c/cs_123",
    });
    expect(ensureDecksetStripeCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        company: expect.objectContaining({
          id: COMPANY_ID,
          name: "Deckset Field Co",
          email: "billing@example.com",
          stripe_customer_id: null,
        }),
        fallbackEmail: "deck@example.com",
        existingDeckCustomerId: null,
      })
    );
    expect(checkoutSessionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_123",
        client_reference_id: COMPANY_ID,
        line_items: [{ price: "price_deck_annual", quantity: 1 }],
        success_url:
          "https://app.opsapp.co/decks/checkout/result?status=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url:
          "https://app.opsapp.co/decks/checkout/result?status=cancelled",
        allow_promotion_codes: true,
        metadata: expect.objectContaining({
          product: "deckset",
          entitlement: "deck_pro",
          productId: "deck_pro_annual",
          companyId: COMPANY_ID,
          period: "Annual",
          purchasedByAuthUid: "firebase-123",
          sourceApp: "ops_decks",
        }),
        subscription_data: {
          metadata: expect.objectContaining({
            product: "deckset",
            entitlement: "deck_pro",
            productId: "deck_pro_annual",
            companyId: COMPANY_ID,
            period: "Annual",
            purchasedByAuthUid: "firebase-123",
            sourceApp: "ops_decks",
          }),
        },
      }),
      { idempotencyKey: "idem-company-deckset" }
    );
  });

  it("surfaces configuration errors before creating Stripe sessions", async () => {
    vi.stubEnv("STRIPE_PRICE_DECK_PRO_MONTHLY", "");

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "config_missing",
      message: "Deckset Pro checkout is not configured.",
      env: "STRIPE_PRICE_DECK_PRO_MONTHLY",
    });
    expect(checkoutSessionCreateMock).not.toHaveBeenCalled();
  });
});
