import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: vi.fn().mockResolvedValue("test-jwt"),
}));
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
  parseDate: (value: string | null | undefined) =>
    value ? new Date(value) : null,
}));

import {
  AccountingRequestError,
  AccountingService,
} from "@/lib/api/services/accounting-service";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AccountingService Sage business selection", () => {
  it("loads the exact ephemeral session with authenticated query parameters", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        businesses: [
          { id: " business-a ", name: " North Ledger " },
          { id: "business-b", name: "South Ledger" },
        ],
        providerEnvironment: "sandbox",
      }),
    });

    await expect(
      AccountingService.getSageBusinessSelection("company-1", "session-1")
    ).resolves.toEqual({
      businesses: [
        { id: "business-a", name: "North Ledger" },
        { id: "business-b", name: "South Ledger" },
      ],
      providerEnvironment: "sandbox",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "/api/integrations/sage/businesses?companyId=company-1&sessionId=session-1"
    );
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
  });

  it("fails closed on malformed provider identity data", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        businesses: [{ id: "business-a" }],
        providerEnvironment: "production",
      }),
    });

    await expect(
      AccountingService.getSageBusinessSelection("company-1", "session-1")
    ).rejects.toMatchObject({
      name: "AccountingRequestError",
      status: 500,
    });
  });

  it("preserves an expired-session status for safe UI recovery", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ error: "Sage business selection expired" }),
    });

    const promise = AccountingService.getSageBusinessSelection(
      "company-1",
      "session-1"
    );
    await expect(promise).rejects.toBeInstanceOf(AccountingRequestError);
    await expect(promise).rejects.toMatchObject({ status: 410 });
  });

  it("submits only the selected business and validates the bound identity", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        providerEnvironment: "production",
        businessName: "North Ledger",
      }),
    });

    await expect(
      AccountingService.selectSageBusiness(
        "company-1",
        "session-1",
        "business-a"
      )
    ).resolves.toEqual({
      success: true,
      providerEnvironment: "production",
      businessName: "North Ledger",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/integrations/sage/businesses");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
    expect(JSON.parse(init.body)).toEqual({
      companyId: "company-1",
      sessionId: "session-1",
      businessId: "business-a",
    });
  });
});
