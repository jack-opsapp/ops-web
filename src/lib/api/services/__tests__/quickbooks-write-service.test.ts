import { describe, expect, it, vi } from "vitest";

import { QuickBooksWriteService } from "../quickbooks-write-service";

function okResponse(body: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function failResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: async () => body,
  } as Response;
}

describe("QuickBooksWriteService", () => {
  it("posts Customer create to the sandbox host and increments write count", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        Customer: {
          Id: "123",
          SyncToken: "0",
          MetaData: { LastUpdatedTime: "2026-06-05T10:00:00Z" },
        },
      }),
    );
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "token",
      environment: "sandbox",
      fetchImpl,
    });

    const result = await service.create("Customer", {
      DisplayName: "Maverick Projects",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/462081636529/customer?minorversion=75",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ DisplayName: "Maverick Projects" }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        qbId: "123",
        syncToken: "0",
        metaUpdatedAt: "2026-06-05T10:00:00Z",
      }),
    );
    expect(service.writeCalls).toBe(1);
  });

  it("rejects unsafe ids before URL interpolation", async () => {
    const fetchImpl = vi.fn();
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "token",
      environment: "sandbox",
      fetchImpl,
    });

    await expect(service.fetchCurrent("Invoice", "1 or 1=1")).rejects.toThrow(
      "Invalid QuickBooks id",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not increment write count for GET fetches", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        Invoice: {
          Id: "90",
          SyncToken: "2",
          MetaData: { LastUpdatedTime: "2026-06-05T10:00:00Z" },
        },
      }),
    );
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "token",
      environment: "sandbox",
      fetchImpl,
    });

    await service.fetchCurrent("Invoice", "90");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/462081636529/invoice/90?minorversion=75",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          Accept: "application/json",
        }),
      }),
    );
    expect(service.writeCalls).toBe(0);
  });

  it("selects the production host when environment is production", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        Payment: { Id: "77", SyncToken: "0" },
      }),
    );
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "token",
      environment: "production",
      fetchImpl,
    });

    await service.create("Payment", { TotalAmt: 125 });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://quickbooks.api.intuit.com/v3/company/462081636529/payment?minorversion=75",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws a token-free error when the provider response omits the entity body or id", async () => {
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "sensitive-token",
      environment: "sandbox",
      fetchImpl: vi.fn().mockResolvedValue(okResponse({ Customer: {} })),
    });

    await expect(service.create("Customer", { DisplayName: "Bad" })).rejects.toThrow(
      "QuickBooks response missing Customer.Id",
    );
    await expect(service.create("Customer", { DisplayName: "Bad" })).rejects.not.toThrow(
      "sensitive-token",
    );
  });

  it("surfaces HTTP write failures with status only", async () => {
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "sensitive-token",
      environment: "sandbox",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(failResponse(400, "provider body with sensitive detail")),
    });

    await expect(service.create("Customer", { DisplayName: "Bad" })).rejects.toThrow(
      "QuickBooks write failed: 400",
    );
    await expect(service.create("Customer", { DisplayName: "Bad" })).rejects.not.toThrow(
      "provider body",
    );
  });
});
