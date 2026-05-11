/**
 * Tests for company-service subscription methods post-Bubble migration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
  parseDate: (v: unknown) => (v ? new Date(v as string) : null),
}));

import { requireSupabase } from "@/lib/supabase/helpers";
import { CompanyService } from "@/lib/api/services/company-service";

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  update: vi.fn().mockReturnThis(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabase).mockReturnValue(mockSupabase as never);
  // Mock fetch for API route calls
  global.fetch = vi.fn();
});

describe("CompanyService.fetchSubscriptionInfo (post-migration)", () => {
  it("reads subscription info from Supabase companies table", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        id: "co-uuid",
        subscription_status: "active",
        subscription_plan: "team",
        subscription_end: "2026-12-31T00:00:00Z",
        stripe_customer_id: "cus_abc",
        max_seats: 10,
        seated_employee_ids: ["u1", "u2"],
      },
      error: null,
    });

    const result = await CompanyService.fetchSubscriptionInfo("co-uuid");

    expect(result.subscriptionStatus).toBe("active");
    expect(result.subscriptionPlan).toBe("team");
    expect(result.stripeCustomerId).toBe("cus_abc");
  });
});

describe("CompanyService.createSetupIntent (post-migration)", () => {
  it("calls /api/stripe/subscription/setup-intent and returns client_secret", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clientSecret: "pi_xxx_secret_yyy", ephemeralKey: "ek_xxx" }),
    } as never);

    const result = await CompanyService.createSetupIntent("co-uuid", "user-uuid");

    expect(fetch).toHaveBeenCalledWith(
      "/api/stripe/subscription/setup-intent",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.clientSecret).toBe("pi_xxx_secret_yyy");
  });
});

describe("CompanyService.cancelSubscription (post-migration)", () => {
  it("calls /api/stripe/subscription/cancel", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as never);

    await CompanyService.cancelSubscription("co-uuid");

    expect(fetch).toHaveBeenCalledWith(
      "/api/stripe/subscription/cancel",
      expect.objectContaining({ method: "POST" })
    );
  });
});
