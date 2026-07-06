import { describe, expect, it, vi } from "vitest";

import { QuickBooksPullService } from "../quickbooks-pull-service";

function okResponse(body: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const SANDBOX_QUERY_BASE =
  "https://sandbox-quickbooks.api.intuit.com/v3/company/realm-1/query?query=";

function queryUrl(sql: string): string {
  return `${SANDBOX_QUERY_BASE}${encodeURIComponent(sql)}`;
}

/**
 * Regression lock for the inbound webhook "record not found" bug: an OPS
 * customer inactivation succeeds outbound, then QuickBooks fires a change event,
 * and the webhook fetch must still find the now-inactive customer. QBO's query
 * endpoint excludes inactive rows by default, so the Customer read MUST carry
 * `Active IN (true, false)` or the round-trip resolves nothing and skips.
 */
describe("QuickBooksPullService.fetchEntityById — inactive-inclusive customer read", () => {
  it("includes inactive customers so an inactivated customer still resolves", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        okResponse({ QueryResponse: { Customer: [{ Id: "70", Active: false }] } }),
      );
    const pull = new QuickBooksPullService("realm-1", "token", "sandbox", fetchImpl);

    const record = await pull.fetchEntityById("Customer", "70");

    expect(record).toEqual({ Id: "70", Active: false });
    expect(fetchImpl).toHaveBeenCalledWith(
      queryUrl("SELECT * FROM Customer WHERE Id = '70' AND Active IN (true, false)"),
      expect.objectContaining({ method: "GET" }),
    );
    // The webhook fetch path must stay read-only.
    expect(pull.qbWriteCalls).toBe(0);
  });

  it("does not add the Active filter for transaction entities", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse({ QueryResponse: { Invoice: [{ Id: "180" }] } }));
    const pull = new QuickBooksPullService("realm-1", "token", "sandbox", fetchImpl);

    await pull.fetchEntityById("Invoice", "180");

    expect(fetchImpl).toHaveBeenCalledWith(
      queryUrl("SELECT * FROM Invoice WHERE Id = '180'"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns null when QuickBooks reports no matching row", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ QueryResponse: {} }));
    const pull = new QuickBooksPullService("realm-1", "token", "sandbox", fetchImpl);

    expect(await pull.fetchEntityById("Customer", "70")).toBeNull();
  });
});
