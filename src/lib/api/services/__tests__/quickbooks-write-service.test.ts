import { describe, expect, it, vi } from "vitest";

import customerCreateResponse from "../../../../../tests/fixtures/qbo/push/customer-create-response.json";
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

async function rejectedMessage(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error("Expected action to reject");
}

describe("QuickBooksWriteService", () => {
  it("posts Customer create to the sandbox host and increments write count", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(customerCreateResponse));
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

  it("rejects update payloads without Id before making a write call", async () => {
    const fetchImpl = vi.fn();
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "token",
      environment: "sandbox",
      fetchImpl,
    });

    await expect(service.update("Customer", { SyncToken: "1" })).rejects.toThrow(
      "QuickBooks update Id required",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(service.writeCalls).toBe(0);
  });

  it("rejects update payloads without SyncToken before making a write call", async () => {
    const fetchImpl = vi.fn();
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "token",
      environment: "sandbox",
      fetchImpl,
    });

    await expect(service.update("Invoice", { Id: "90" })).rejects.toThrow(
      "QuickBooks update SyncToken required",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(service.writeCalls).toBe(0);
  });

  it("posts Customer updates only when Id and SyncToken are present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(customerCreateResponse));
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "token",
      environment: "sandbox",
      fetchImpl,
    });

    await service.update("Customer", {
      Id: "123",
      SyncToken: "0",
      DisplayName: "Maverick Projects",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/462081636529/customer?minorversion=75",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          Id: "123",
          SyncToken: "0",
          DisplayName: "Maverick Projects",
        }),
      }),
    );
    expect(service.writeCalls).toBe(1);
  });

  it("posts transaction updates only when Id and SyncToken are present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        Invoice: {
          Id: "90",
          SyncToken: "6",
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

    await service.update("Invoice", { Id: "90", SyncToken: "5", TotalAmt: 125 });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/462081636529/invoice?minorversion=75",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ Id: "90", SyncToken: "5", TotalAmt: 125 }),
      }),
    );
    expect(service.writeCalls).toBe(1);
  });

  it("posts Invoice voids to operation=void with the minimum payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        Invoice: {
          Id: "90",
          SyncToken: "6",
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

    await service.void("Invoice", { Id: "90", SyncToken: "5" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/462081636529/invoice?operation=void&minorversion=75",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ Id: "90", SyncToken: "5" }),
      }),
    );
  });

  it("posts Payment voids as sparse update include=void", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        Payment: {
          Id: "77",
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

    await service.void("Payment", { Id: "77", SyncToken: "1", sparse: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/462081636529/payment?operation=update&include=void&minorversion=75",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ Id: "77", SyncToken: "1", sparse: true }),
      }),
    );
  });

  it("rejects Payment voids without sparse=true before making a write call", async () => {
    const fetchImpl = vi.fn();
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "token",
      environment: "sandbox",
      fetchImpl,
    });

    await expect(service.void("Payment", { Id: "77", SyncToken: "1" })).rejects.toThrow(
      "QuickBooks Payment void sparse=true required",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(service.writeCalls).toBe(0);
  });

  it("throws a token-free error when the provider response omits the entity body or id", async () => {
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "sensitive-token",
      environment: "sandbox",
      fetchImpl: vi.fn().mockResolvedValue(okResponse({ Customer: {} })),
    });

    const message = await rejectedMessage(() =>
      service.create("Customer", { DisplayName: "Bad" }),
    );

    expect(message).toBe("QuickBooks response missing Customer.Id");
    expect(message).not.toContain("sensitive-token");
  });

  it("throws a token-free error when the provider response omits the entity body", async () => {
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "sensitive-token",
      environment: "sandbox",
      fetchImpl: vi.fn().mockResolvedValue(okResponse({})),
    });

    const message = await rejectedMessage(() =>
      service.create("Customer", { DisplayName: "Bad" }),
    );

    expect(message).toBe("QuickBooks response missing Customer body");
    expect(message).not.toContain("sensitive-token");
    expect(message).not.toContain("{}");
  });

  it("surfaces sanitized QuickBooks Fault detail for HTTP write failures", async () => {
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "sensitive-token",
      environment: "sandbox",
      fetchImpl: vi.fn().mockResolvedValue(
        failResponse(
          400,
          JSON.stringify({
            Fault: {
              type: "ValidationFault",
              Error: [
                {
                  code: "2500",
                  Message: "Invalid Reference Id",
                  Detail:
                    "Something you're trying to use has been made inactive. Check the fields with accounts, customers, items, vendors or employees.",
                },
              ],
            },
          }),
        ),
      ),
    });

    const message = await rejectedMessage(() =>
      service.create("Customer", { DisplayName: "Bad" }),
    );

    expect(message).toContain("QuickBooks write failed: 400");
    expect(message).toContain("[2500] Invalid Reference Id");
    expect(message).toContain("Something you're trying to use has been made inactive");
    expect(message).not.toContain("sensitive-token");
  });

  it("does not echo unstructured provider error bodies", async () => {
    const service = new QuickBooksWriteService({
      realmId: "462081636529",
      accessToken: "sensitive-token",
      environment: "sandbox",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(failResponse(400, "provider body with sensitive detail")),
    });

    const message = await rejectedMessage(() =>
      service.create("Customer", { DisplayName: "Bad" }),
    );

    expect(message).toBe("QuickBooks write failed: 400");
    expect(message).not.toContain("provider body");
    expect(message).not.toContain("sensitive-token");
  });
});
