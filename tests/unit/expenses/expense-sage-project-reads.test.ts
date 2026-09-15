// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createSageReadClient } from "@/lib/api/services/sage-api-client";

describe("explicit Sage project detail attributes", () => {
  it("requests complete category and parent details from the exact business with no write", async () => {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({ url, init });
        const body = url.pathname.endsWith("/category-id")
          ? { id: "category-id", analysis_type: { id: "type-id" } }
          : {
              id: "type-id",
              active_areas: ["JOURNALS"],
              analysis_type_level: { identifier: "TRANSACTION" },
            };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    );
    const client = createSageReadClient({
      businessId: "exact-business",
      getAccessToken: async () => "test-token",
      refreshAccessToken: vi.fn(),
      onDisconnect: vi.fn(),
      fetchFn,
    });
    await client.get("analysis_type_categories", "category-id", {
      attributes: "all",
    });
    await client.get("analysis_types", "type-id", { attributes: "all" });
    for (const resource of [
      "tax_rates",
      "ledger_accounts",
      "bank_accounts",
      "payment_methods",
    ])
      await client.get(resource, "resource-id", { attributes: "all" });
    expect(calls.map((call) => call.url.toString())).toEqual([
      "https://api.accounting.sage.com/v3.1/analysis_type_categories/category-id?attributes=all",
      "https://api.accounting.sage.com/v3.1/analysis_types/type-id?attributes=all",
      "https://api.accounting.sage.com/v3.1/tax_rates/resource-id?attributes=all",
      "https://api.accounting.sage.com/v3.1/ledger_accounts/resource-id?attributes=all",
      "https://api.accounting.sage.com/v3.1/bank_accounts/resource-id?attributes=all",
      "https://api.accounting.sage.com/v3.1/payment_methods/resource-id?attributes=all",
    ]);
    for (const call of calls) {
      expect(call.init?.method).toBe("GET");
      expect(new Headers(call.init?.headers).get("X-Business")).toBe(
        "exact-business"
      );
      expect(call.init?.body).toBeUndefined();
    }
  });
});
