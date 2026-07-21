import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  activeClient: null as unknown,
  client: null as unknown,
  fetchGmailRead: vi.fn(),
  getValidGmailToken: vi.fn(),
  requireEmailCompanyAccess: vi.fn(),
  resolveEmailConnectionOperationAccess: vi.fn(),
  runWithEmailConnectionSyncLock: vi.fn(),
  runWithSupabase: vi.fn(),
  setSupabaseOverride: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => mocks.client,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: (...args: unknown[]) => mocks.runWithSupabase(...args),
  setSupabaseOverride: (...args: unknown[]) =>
    mocks.setSupabaseOverride(...args),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailCompanyAccess: (...args: unknown[]) =>
    mocks.requireEmailCompanyAccess(...args),
}));

vi.mock("@/lib/email/email-connection-operation-access", () => ({
  resolveEmailConnectionOperationAccess: (...args: unknown[]) =>
    mocks.resolveEmailConnectionOperationAccess(...args),
}));

vi.mock("@/lib/api/services/gmail-token", () => ({
  getValidGmailToken: (...args: unknown[]) => mocks.getValidGmailToken(...args),
}));

vi.mock("@/lib/api/services/providers/gmail-read", () => ({
  fetchGmailRead: (...args: unknown[]) => mocks.fetchGmailRead(...args),
}));

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  runWithEmailConnectionSyncLock: (...args: unknown[]) =>
    mocks.runWithEmailConnectionSyncLock(...args),
}));

function makeClient(provider = "gmail") {
  class Query {
    select() {
      return this;
    }

    eq() {
      return this;
    }

    async single() {
      return {
        data: {
          id: "connection-1",
          company_id: "company-1",
          provider,
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: "2999-01-01T00:00:00.000Z",
        },
        error: null,
      };
    }
  }

  return {
    from: vi.fn(() => new Query()),
  };
}

describe("Gmail labels route provider deadline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T09:00:00.000Z"));

    mocks.client = makeClient();
    mocks.activeClient = null;
    mocks.requireEmailCompanyAccess.mockResolvedValue(null);
    mocks.resolveEmailConnectionOperationAccess.mockResolvedValue({
      allowed: true,
      actor: { userId: "user-1", companyId: "company-1" },
      connections: [
        {
          id: "connection-1",
          company_id: "company-1",
          provider: "gmail",
          type: "company",
          user_id: null,
          status: "active",
          sync_enabled: true,
        },
      ],
      connectionIds: ["connection-1"],
    });
    mocks.runWithEmailConnectionSyncLock.mockImplementation(
      async ({ run }: { run: () => Promise<unknown> }) => ({
        acquired: true,
        value: await run(),
      })
    );
    mocks.runWithSupabase.mockImplementation(
      async (client: unknown, callback: () => Promise<unknown>) => {
        mocks.activeClient = client;
        try {
          return await callback();
        } finally {
          mocks.activeClient = null;
        }
      }
    );
    mocks.getValidGmailToken.mockImplementation(
      async (_connection: unknown, options: { deadlineAt?: number }) => {
        expect(mocks.activeClient).toBe(mocks.client);
        expect(options.deadlineAt).toBe(Date.now() + 45_000);
        return "bounded-access-token";
      }
    );
    mocks.fetchGmailRead.mockImplementation(
      async (
        _input: string,
        _init: RequestInit,
        policy: { deadlineAt?: number }
      ) => {
        expect(mocks.activeClient).toBe(mocks.client);
        expect(policy.deadlineAt).toBe(Date.now() + 45_000);
        return Response.json({
          labels: [{ id: "INBOX", name: "Inbox", type: "system" }],
        });
      }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("labels route used an unbounded raw provider fetch");
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses one ALS-scoped deadline for token refresh, Gmail headers, and response body", async () => {
    const { GET } = await import("@/app/api/integrations/gmail/labels/route");
    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/labels?connectionId=connection-1"
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      labels: [{ id: "INBOX", name: "Inbox", type: "system" }],
    });
    expect(mocks.runWithSupabase).toHaveBeenCalledWith(
      mocks.client,
      expect.any(Function)
    );
    expect(mocks.getValidGmailToken).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connection-1" }),
      expect.objectContaining({
        deadlineAt: Date.now() + 45_000,
        context: "Gmail labels",
        client: mocks.client,
        requirePersistence: true,
      })
    );
    expect(mocks.fetchGmailRead).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      { headers: { Authorization: "Bearer bounded-access-token" } },
      {
        deadlineAt: Date.now() + 45_000,
        context: "labels.list",
      }
    );
    expect(mocks.setSupabaseOverride).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns busy before refreshing a token or reading Gmail labels", async () => {
    mocks.runWithEmailConnectionSyncLock.mockResolvedValue({ acquired: false });
    const { GET } = await import("@/app/api/integrations/gmail/labels/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/labels?connectionId=connection-1"
      )
    );

    expect(response.status).toBe(409);
    expect(mocks.getValidGmailToken).not.toHaveBeenCalled();
    expect(mocks.fetchGmailRead).not.toHaveBeenCalled();
  });

  it("fails closed on canonical mailbox denial before token or provider access", async () => {
    mocks.resolveEmailConnectionOperationAccess.mockResolvedValue({
      allowed: false,
      reason: "forbidden",
      status: 403,
    });
    const { GET } = await import("@/app/api/integrations/gmail/labels/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/labels?connectionId=connection-1"
      )
    );

    expect(response.status).toBe(403);
    expect(mocks.resolveEmailConnectionOperationAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "connection-1",
        requireUsable: true,
        supabase: mocks.client,
      })
    );
    expect(mocks.runWithEmailConnectionSyncLock).not.toHaveBeenCalled();
    expect(mocks.getValidGmailToken).not.toHaveBeenCalled();
    expect(mocks.fetchGmailRead).not.toHaveBeenCalled();
  });

  it("rejects a non-Gmail connection before any token or provider access", async () => {
    mocks.client = makeClient("microsoft365");
    mocks.resolveEmailConnectionOperationAccess.mockResolvedValue({
      allowed: true,
      actor: { userId: "user-1", companyId: "company-1" },
      connections: [
        {
          id: "connection-1",
          company_id: "company-1",
          provider: "microsoft365",
          type: "company",
          user_id: null,
          status: "active",
          sync_enabled: true,
        },
      ],
      connectionIds: ["connection-1"],
    });
    const { GET } = await import("@/app/api/integrations/gmail/labels/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/labels?connectionId=connection-1"
      )
    );

    expect(response.status).toBe(404);
    expect(mocks.runWithEmailConnectionSyncLock).not.toHaveBeenCalled();
    expect(mocks.getValidGmailToken).not.toHaveBeenCalled();
    expect(mocks.fetchGmailRead).not.toHaveBeenCalled();
  });
});
