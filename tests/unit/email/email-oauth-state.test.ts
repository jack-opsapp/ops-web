import { beforeEach, describe, expect, it, vi } from "vitest";

const { randomBytesMock, createHashMock } = vi.hoisted(() => ({
  randomBytesMock: vi.fn(),
  createHashMock: vi.fn(),
}));

vi.mock("node:crypto", () => ({
  default: {
    randomBytes: randomBytesMock,
    createHash: createHashMock,
  },
  randomBytes: randomBytesMock,
  createHash: createHashMock,
}));

import {
  consumeEmailOAuthState,
  createEmailOAuthState,
  resolveEmailOAuthAlertConnection,
} from "@/lib/email/email-oauth-state";

describe("email OAuth state", () => {
  const insert = vi.fn();
  const cleanupLt = vi.fn();
  const cleanupDelete = vi.fn(() => ({ lt: cleanupLt }));
  const rpc = vi.fn();
  const supabase = {
    from: vi.fn(() => ({ insert, delete: cleanupDelete })),
    rpc,
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    randomBytesMock.mockReturnValue({
      toString: vi.fn(() => "opaque-state-token"),
    });
    createHashMock.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => "state-token-sha256"),
    });
    insert.mockResolvedValue({ error: null });
    cleanupLt.mockResolvedValue({ error: null });
  });

  it("stores only a digest while returning an opaque, short-lived nonce", async () => {
    const now = new Date("2026-07-13T12:00:00.000Z");

    const token = await createEmailOAuthState(
      supabase,
      {
        provider: "gmail",
        companyId: "company-1",
        userId: "user-1",
        type: "company",
        source: "wizard",
      },
      now
    );

    expect(token).toBe("opaque-state-token");
    expect(insert).toHaveBeenCalledWith({
      nonce_hash: "state-token-sha256",
      provider: "gmail",
      company_id: "company-1",
      user_id: "user-1",
      connection_type: "company",
      source: "wizard",
      connection_id: null,
      expected_email: null,
      return_to: null,
      expires_at: "2026-07-13T12:10:00.000Z",
    });
    expect(JSON.stringify(insert.mock.calls[0]?.[0])).not.toContain(
      "opaque-state-token"
    );
  });

  it("binds alert state to one server-verified connection and mailbox", async () => {
    await createEmailOAuthState(supabase, {
      provider: "microsoft365",
      companyId: "company-1",
      userId: "user-1",
      type: "individual",
      source: "alert",
      connectionId: "connection-1",
      expectedEmail: "Crew@Example.com ",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "alert",
        connection_id: "connection-1",
        expected_email: "crew@example.com",
      })
    );
  });

  it("atomically consumes a nonce through the service-role-only RPC", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          company_id: "company-1",
          user_id: "user-1",
          connection_type: "individual",
          source: "alert",
          connection_id: "connection-1",
          expected_email: "crew@example.com",
          return_to: "/pipeline",
        },
      ],
      error: null,
    });

    await expect(
      consumeEmailOAuthState(supabase, "gmail", "opaque-state-token")
    ).resolves.toEqual({
      companyId: "company-1",
      userId: "user-1",
      type: "individual",
      source: "alert",
      connectionId: "connection-1",
      expectedEmail: "crew@example.com",
      returnTo: "/pipeline",
    });
    expect(rpc).toHaveBeenCalledWith("consume_email_oauth_state", {
      p_nonce_hash: "state-token-sha256",
      p_provider: "gmail",
    });
  });

  it("rejects expired, replayed, wrong-provider, and malformed state", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(
      consumeEmailOAuthState(supabase, "gmail", "expired-or-replayed")
    ).resolves.toBeNull();

    rpc.mockResolvedValueOnce({
      data: [
        {
          company_id: "company-1",
          user_id: null,
          connection_type: "company",
          source: "wizard",
        },
      ],
      error: null,
    });
    await expect(
      consumeEmailOAuthState(supabase, "microsoft365", "malformed")
    ).resolves.toBeNull();

    rpc.mockResolvedValueOnce({
      data: [
        {
          company_id: "company-1",
          user_id: "user-1",
          connection_type: "company",
          source: "alert",
          connection_id: null,
          expected_email: null,
        },
      ],
      error: null,
    });
    await expect(
      consumeEmailOAuthState(supabase, "gmail", "unbound-alert")
    ).resolves.toBeNull();
  });

  it("fails closed when state persistence or consumption fails", async () => {
    insert.mockResolvedValueOnce({ error: { message: "insert failed" } });
    await expect(
      createEmailOAuthState(supabase, {
        provider: "gmail",
        companyId: "company-1",
        userId: "user-1",
        type: "company",
        source: "wizard",
      })
    ).rejects.toThrow("Failed to persist email OAuth state");

    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "consume failed" },
    });
    await expect(
      consumeEmailOAuthState(supabase, "gmail", "opaque-state-token")
    ).rejects.toThrow("Failed to consume email OAuth state");
  });

  it("resolves an alert binding only through the exact tenant, provider, type, connection, and mailbox", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "connection-1",
        email: "Crew@Example.com",
        provider: "gmail",
        type: "company",
        status: "needs_reconnect",
        sync_enabled: true,
      },
      error: null,
    });
    const query = {
      eq: vi.fn(),
      maybeSingle,
    };
    query.eq.mockReturnValue(query);
    const exactSupabase = {
      from: vi.fn(() => ({ select: vi.fn(() => query) })),
    } as never;

    await expect(
      resolveEmailOAuthAlertConnection(exactSupabase, {
        companyId: "company-1",
        provider: "gmail",
        type: "company",
        connectionId: "connection-1",
        expectedEmail: " Crew@Example.com ",
      })
    ).resolves.toEqual({
      connectionId: "connection-1",
      expectedEmail: "crew@example.com",
    });
    expect(query.eq.mock.calls).toEqual([
      ["id", "connection-1"],
      ["company_id", "company-1"],
      ["provider", "gmail"],
      ["type", "company"],
    ]);
  });

  it("fails closed when an alert connection lookup errors or does not match", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "read failed" } })
      .mockResolvedValueOnce({ data: null, error: null });
    const query = { eq: vi.fn(), maybeSingle };
    query.eq.mockReturnValue(query);
    const exactSupabase = {
      from: vi.fn(() => ({ select: vi.fn(() => query) })),
    } as never;
    const context = {
      companyId: "company-1",
      provider: "gmail" as const,
      type: "company" as const,
      connectionId: "connection-1",
      expectedEmail: "crew@example.com",
    };

    await expect(
      resolveEmailOAuthAlertConnection(exactSupabase, context)
    ).rejects.toThrow("Failed to verify alert email connection");
    await expect(
      resolveEmailOAuthAlertConnection(exactSupabase, context)
    ).resolves.toBeNull();
  });

  it.each([
    [{ status: "disconnected", sync_enabled: false }],
    [{ status: "active", sync_enabled: false }],
    [{ status: "setup_incomplete", sync_enabled: true }],
  ])(
    "rejects a stale alert after the mailbox is disabled (%o)",
    async (connectionState) => {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: "connection-1",
          email: "crew@example.com",
          ...connectionState,
        },
        error: null,
      });
      const query = { eq: vi.fn(), maybeSingle };
      query.eq.mockReturnValue(query);
      const exactSupabase = {
        from: vi.fn(() => ({ select: vi.fn(() => query) })),
      } as never;

      await expect(
        resolveEmailOAuthAlertConnection(exactSupabase, {
          companyId: "company-1",
          provider: "gmail",
          type: "company",
          connectionId: "connection-1",
          expectedEmail: "crew@example.com",
        })
      ).resolves.toBeNull();
    }
  );
});
