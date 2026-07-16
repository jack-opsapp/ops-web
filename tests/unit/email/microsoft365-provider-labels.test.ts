import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

import { ProviderApiError } from "@/lib/api/services/email-provider";
import { Microsoft365Provider } from "@/lib/api/services/providers/microsoft365-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function connection(): EmailConnection {
  const now = new Date("2026-07-15T00:00:00.000Z");
  return {
    id: "m365-connection",
    companyId: "company-1",
    provider: "microsoft365",
    type: "company",
    userId: null,
    email: "shared@canpro.ca",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date("2099-07-16T00:00:00.000Z"),
    historyId: null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 60,
    syncFilters: {},
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: "category-guid",
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function graphMessage(): Record<string, unknown> {
  return {
    id: "message-1",
    conversationId: "conversation-exact",
    from: { emailAddress: { address: "customer@example.com" } },
    toRecipients: [{ emailAddress: { address: "shared@canpro.ca" } }],
    ccRecipients: [],
    subject: "Deck inquiry",
    bodyPreview: "Can you quote this?",
    body: { contentType: "text", content: "Can you quote this?" },
    uniqueBody: { contentType: "text", content: "Can you quote this?" },
    receivedDateTime: "2026-07-15T00:00:00.000Z",
    categories: ["Customer category"],
    isDraft: false,
    isRead: true,
    hasAttachments: false,
  };
}

function providerHarness(
  categories: Array<{ id: string; displayName: string }>
) {
  const patchBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/me/outlook/masterCategories")) {
        return jsonResponse({ value: categories });
      }
      if (url.includes("/me/messages?") && init?.method !== "PATCH") {
        return jsonResponse({ value: [graphMessage()] });
      }
      if (url.endsWith("/me/messages/message-1") && init?.method === "PATCH") {
        patchBodies.push(
          JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>
        );
        return jsonResponse({});
      }
      throw new Error(`Unexpected Graph request: ${url}`);
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  const provider = new Microsoft365Provider(connection());
  const sendEmail = vi.spyOn(provider, "sendEmail");
  return { provider, fetchMock, patchBodies, sendEmail };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Microsoft365Provider category assignment", () => {
  it("resolves a stored master-category GUID to the required display name", async () => {
    const harness = providerHarness([
      { id: "category-guid", displayName: "OPS Pipeline" },
    ]);

    await harness.provider.applyLabel("conversation-exact", "category-guid");

    expect(harness.patchBodies).toEqual([
      { categories: ["Customer category", "OPS Pipeline"] },
    ]);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it("accepts a stored display name but still verifies the master category", async () => {
    const harness = providerHarness([
      { id: "category-guid", displayName: "OPS Pipeline" },
    ]);

    await harness.provider.applyLabel("conversation-exact", "OPS Pipeline");

    expect(harness.patchBodies).toEqual([
      { categories: ["Customer category", "OPS Pipeline"] },
    ]);
    expect(harness.fetchMock).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
      expect.anything()
    );
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it("fails before reading or mutating a thread when the category is missing", async () => {
    const harness = providerHarness([
      { id: "different-guid", displayName: "Different category" },
    ]);

    const result = harness.provider.applyLabel(
      "conversation-exact",
      "category-guid"
    );

    await expect(result).rejects.toBeInstanceOf(ProviderApiError);
    await expect(result).rejects.toMatchObject({
      code: "provider_api_error",
      providerStatus: 409,
    });
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.patchBodies).toEqual([]);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });
});
