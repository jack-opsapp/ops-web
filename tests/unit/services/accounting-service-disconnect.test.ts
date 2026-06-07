import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: vi.fn().mockResolvedValue("test-jwt"),
}));
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
  parseDate: (value: string | null | undefined) =>
    value ? new Date(value) : null,
}));

import { AccountingService } from "@/lib/api/services/accounting-service";
import { AccountingProvider } from "@/lib/types/pipeline";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AccountingService.initiateOAuth", () => {
  it("sends the Firebase token to the OAuth initiation route", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authUrl: "https://appcenter.intuit.test/connect" }),
    });

    await AccountingService.initiateOAuth(
      "a612edc0-5c18-4c4d-af97-55b9410dd077",
      AccountingProvider.QuickBooks
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/integrations/quickbooks");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
    expect(JSON.parse(init.body)).toEqual({
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
    });
  });
});

describe("AccountingService.disconnectProvider", () => {
  it("sends the selected provider environment to the disconnect route", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    await AccountingService.disconnectProvider(
      "a612edc0-5c18-4c4d-af97-55b9410dd077",
      AccountingProvider.QuickBooks,
      "sandbox"
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/integrations/quickbooks");
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
    expect(JSON.parse(init.body)).toEqual({
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      providerEnvironment: "sandbox",
    });
  });

  it("throws the API error when disconnect fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "No quickbooks sandbox connection found" }),
    });

    await expect(
      AccountingService.disconnectProvider(
        "a612edc0-5c18-4c4d-af97-55b9410dd077",
        AccountingProvider.QuickBooks,
        "sandbox"
      )
    ).rejects.toThrow("No quickbooks sandbox connection found");
  });
});
