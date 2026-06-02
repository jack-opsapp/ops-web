// tests/unit/services/quickbooks-pull-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { QuickBooksPullService } from "@/lib/api/services/quickbooks-pull-service";

describe("QuickBooksPullService — host selection", () => {
  it("uses the production host only when QB_ENVIRONMENT==='production'", () => {
    const prod = new QuickBooksPullService("4620816365", "tok", "production");
    expect(prod.baseUrl).toBe("https://quickbooks.api.intuit.com/v3/company/4620816365");
  });

  it("uses the sandbox host for 'sandbox', unset, or any other value", () => {
    const sandbox = new QuickBooksPullService("4620816365", "tok", "sandbox");
    const fallback = new QuickBooksPullService("4620816365", "tok", undefined);
    const garbage = new QuickBooksPullService("4620816365", "tok", "staging");
    expect(sandbox.baseUrl).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365");
    expect(fallback.baseUrl).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365");
    expect(garbage.baseUrl).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365");
  });

  it("starts with qbWriteCalls at 0", () => {
    expect(new QuickBooksPullService("r", "t", "production").qbWriteCalls).toBe(0);
  });
});

describe("QuickBooksPullService — cutoff validation", () => {
  it("rejects a non-YYYY-MM-DD cutoff before issuing any request", async () => {
    const fetchSpy = vi.fn();
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await expect(svc.pullInvoices("2024/01/01")).rejects.toThrow("Invalid cutoff date");
    await expect(svc.pullInvoices("garbage")).rejects.toThrow("Invalid cutoff date");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a valid YYYY-MM-DD cutoff (no throw on validation)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 })
    );
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await expect(svc.pullInvoices("2024-06-01")).resolves.toBeInstanceOf(Array);
  });
});
