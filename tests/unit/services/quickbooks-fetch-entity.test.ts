import { describe, it, expect, vi } from "vitest";
import { QuickBooksPullService } from "@/lib/api/services/quickbooks-pull-service";

function jsonFetch(payload: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
}

describe("QuickBooksPullService.fetchEntityById — id validation (injection guard)", () => {
  it("rejects a non-numeric id BEFORE issuing any request", async () => {
    const fetchSpy = vi.fn();
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await expect(svc.fetchEntityById("Invoice", "5'; DROP TABLE clients;--")).rejects.toThrow(
      "Invalid QuickBooks entity id"
    );
    await expect(svc.fetchEntityById("Invoice", "abc")).rejects.toThrow("Invalid QuickBooks entity id");
    await expect(svc.fetchEntityById("Invoice", "")).rejects.toThrow("Invalid QuickBooks entity id");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an unsupported entity type BEFORE issuing any request", async () => {
    const fetchSpy = vi.fn();
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await expect(svc.fetchEntityById("Item", "5")).rejects.toThrow("Unsupported QuickBooks entity type");
    await expect(svc.fetchEntityById("Vendor", "5")).rejects.toThrow("Unsupported QuickBooks entity type");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("issues a GET-only query for a valid numeric id and returns the single record", async () => {
    const record = { Id: "130", DocNumber: "1037" };
    const calls: Array<{ url: string; method: string }> = [];
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        method: (init?.method ?? "GET").toUpperCase(),
      });
      return new Response(JSON.stringify({ QueryResponse: { Invoice: [record] } }), { status: 200 });
    });
    const svc = new QuickBooksPullService("4620816365", "tok", "production", fetchSpy as unknown as typeof fetch);

    const result = await svc.fetchEntityById("Invoice", "130");

    expect(result).toEqual(record);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    const sql = decodeURIComponent(new URL(calls[0].url).searchParams.get("query")!);
    expect(sql).toBe("SELECT * FROM Invoice WHERE Id = '130'");
    expect(svc.qbWriteCalls).toBe(0);
  });

  it("includes inactive customers when fetching a customer by id for webhook apply", async () => {
    const record = { Id: "70", DisplayName: "OPS CRUD Delete Test", Active: false };
    const calls: Array<{ url: string; method: string }> = [];
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        method: (init?.method ?? "GET").toUpperCase(),
      });
      return new Response(JSON.stringify({ QueryResponse: { Customer: [record] } }), { status: 200 });
    });
    const svc = new QuickBooksPullService("4620816365", "tok", "sandbox", fetchSpy as unknown as typeof fetch);

    const result = await svc.fetchEntityById("Customer", "70");

    expect(result).toEqual(record);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    const sql = decodeURIComponent(new URL(calls[0].url).searchParams.get("query")!);
    expect(sql).toBe("SELECT * FROM Customer WHERE Id = '70' AND Active IN (true, false)");
    expect(svc.qbWriteCalls).toBe(0);
  });

  it("returns null when QuickBooks reports no matching record", async () => {
    const svc = new QuickBooksPullService(
      "r",
      "t",
      "production",
      jsonFetch({ QueryResponse: {} }) as unknown as typeof fetch
    );
    expect(await svc.fetchEntityById("Customer", "999")).toBeNull();
  });
});
