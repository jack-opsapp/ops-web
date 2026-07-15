import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { hashMicrosoft365ClientState } from "@/lib/email/microsoft365-webhook-security";

const { afterCallbacks, getServiceRoleClientMock } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  getServiceRoleClientMock: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: vi.fn((callback: () => Promise<void> | void) => {
      afterCallbacks.push(callback);
    }),
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/utils/app-url", () => ({
  getAppUrl: () => "https://ops.test",
}));

import { POST } from "@/app/api/integrations/email/webhook/microsoft365/route";

function request(value: unknown): NextRequest {
  return new NextRequest(
    "https://ops.test/api/integrations/email/webhook/microsoft365",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    }
  );
}

function supabaseDouble(expectedSecret: string) {
  return {
    from: vi.fn(() => {
      const filters = new Map<string, unknown>();
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          filters.set(column, value);
          return query;
        }),
        maybeSingle: vi.fn(async () => {
          const valid =
            filters.get("provider") === "microsoft365" &&
            filters.get("status") === "active" &&
            filters.get("sync_enabled") === true &&
            filters.get("webhook_subscription_id") === "subscription-1" &&
            filters.get("webhook_client_state_hash") ===
              (await hashMicrosoft365ClientState(expectedSecret));
          return {
            data: valid ? { id: "connection-1", last_synced_at: null } : null,
            error: null,
          };
        }),
      };
      return query;
    }),
  };
}

describe("Microsoft 365 webhook route", () => {
  beforeEach(() => {
    afterCallbacks.length = 0;
    process.env.CRON_SECRET = "cron-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("binds subscription id and random clientState before dispatching sync", async () => {
    getServiceRoleClientMock.mockReturnValue(supabaseDouble("random-secret"));

    const response = await POST(
      request([
        {
          subscriptionId: "subscription-1",
          clientState: "random-secret",
        },
      ])
    );

    expect(response.status).toBe(202);
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(fetch).toHaveBeenCalledWith(
      "https://ops.test/api/integrations/email/manual-sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer cron-secret",
        }),
        body: JSON.stringify({
          connectionId: "connection-1",
          source: "webhook",
        }),
      })
    );
  });

  it("rejects a forged clientState without dispatching service-role work", async () => {
    getServiceRoleClientMock.mockReturnValue(supabaseDouble("expected-secret"));

    const response = await POST(
      request([
        {
          subscriptionId: "subscription-1",
          clientState: "forged-secret",
        },
      ])
    );

    expect(response.status).toBe(401);
    expect(afterCallbacks).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
