import { describe, expect, it, vi } from "vitest";

import {
  createDurableMcpRateLimiter,
  DurableMcpRateLimitUnavailableError,
} from "../durable-rate-limit";

const IDENTITY = Object.freeze({
  requestId: "req-durable-1",
  grantId: "11111111-1111-4111-8111-111111111111",
  actorUserId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  capabilityId: "search_jobs",
  protocolEra: "modern" as const,
});

describe("durable MCP rate-limit adapter", () => {
  it("binds one fixed unit to the exact identity, capability, and closed policy", async () => {
    const rpc = vi.fn(
      async (
        _functionName: string,
        _args: Readonly<Record<string, unknown>>
      ) => ({
        data: [
          {
            allowed: true,
            remaining_units: 29,
            reset_at: "2026-08-23T18:21:00.000Z",
          },
        ],
        error: null,
      })
    );
    const limiter = createDurableMcpRateLimiter({ rpc });

    await expect(
      limiter.consume({
        ...IDENTITY,
        bucket: "evidence_search",
      })
    ).resolves.toEqual({
      allowed: true,
      remainingUnits: 29,
      resetAt: "2026-08-23T18:21:00.000Z",
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("consume_agent_mcp_rate_limit_as_system", {
      p_request_id: IDENTITY.requestId,
      p_grant_id: IDENTITY.grantId,
      p_actor_user_id: IDENTITY.actorUserId,
      p_company_id: IDENTITY.companyId,
      p_capability_id: IDENTITY.capabilityId,
      p_policy_id: "mcp-evidence-search:2026-08-23.v1",
      p_requested_units: 1,
      p_protocol_era: IDENTITY.protocolEra,
    });
  });

  it("maps the lightweight bucket to its immutable database policy", async () => {
    const rpc = vi.fn(
      async (
        _functionName: string,
        _args: Readonly<Record<string, unknown>>
      ) => ({
        data: [
          {
            allowed: false,
            remaining_units: 0,
            reset_at: "2026-08-23T18:21:00.000Z",
          },
        ],
        error: null,
      })
    );
    const limiter = createDurableMcpRateLimiter({ rpc });

    await limiter.consume({ ...IDENTITY, bucket: "lightweight_read" });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_policy_id: "mcp-lightweight-read:2026-08-23.v1",
      p_requested_units: 1,
    });
  });

  it.each([
    {
      label: "RPC rejection",
      response: { data: null, error: { code: "57014" } },
    },
    { label: "missing row", response: { data: [], error: null } },
    {
      label: "duplicate row",
      response: {
        data: [
          {
            allowed: true,
            remaining_units: 1,
            reset_at: "2026-08-23T18:21:00.000Z",
          },
          {
            allowed: true,
            remaining_units: 1,
            reset_at: "2026-08-23T18:21:00.000Z",
          },
        ],
        error: null,
      },
    },
    {
      label: "extra field",
      response: {
        data: [
          {
            allowed: true,
            remaining_units: 1,
            reset_at: "2026-08-23T18:21:00.000Z",
            bucket_digest: "must-not-cross",
          },
        ],
        error: null,
      },
    },
    {
      label: "invalid reset",
      response: {
        data: [{ allowed: true, remaining_units: 1, reset_at: "not-a-time" }],
        error: null,
      },
    },
    {
      label: "denial with remaining capacity",
      response: {
        data: [
          {
            allowed: false,
            remaining_units: 1,
            reset_at: "2026-08-23T18:21:00.000Z",
          },
        ],
        error: null,
      },
    },
  ])("fails closed on a malformed $label response", async ({ response }) => {
    const limiter = createDurableMcpRateLimiter({
      rpc: vi.fn(async () => response),
    });

    await expect(
      limiter.consume({ ...IDENTITY, bucket: "evidence_search" })
    ).rejects.toBeInstanceOf(DurableMcpRateLimitUnavailableError);
  });

  it("collapses thrown database details to one privacy-safe unavailable error", async () => {
    const limiter = createDurableMcpRateLimiter({
      rpc: vi.fn(async () => {
        throw new Error("private.mcp_oauth_grants leaked detail");
      }),
    });

    const failure = await limiter
      .consume({ ...IDENTITY, bucket: "evidence_search" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DurableMcpRateLimitUnavailableError);
    expect((failure as Error).message).toBe(
      "Durable MCP rate limiter is unavailable"
    );
    expect((failure as Error).message).not.toContain("mcp_oauth_grants");
  });

  it("fails closed at a bounded deadline without retrying an ambiguous consume", async () => {
    vi.useFakeTimers();
    let settled: unknown = null;
    const rpc = vi.fn(
      () =>
        new Promise<{ data: unknown; error: unknown }>((resolve) => {
          setTimeout(
            () =>
              resolve({
                data: [
                  {
                    allowed: true,
                    remaining_units: 29,
                    reset_at: "2026-08-23T18:21:00.000Z",
                  },
                ],
                error: null,
              }),
            5_000
          );
        })
    );
    const pending = createDurableMcpRateLimiter({ rpc })
      .consume({ ...IDENTITY, bucket: "evidence_search" })
      .then(
        (decision) => {
          settled = decision;
        },
        (error: unknown) => {
          settled = error;
        }
      );

    try {
      await vi.advanceTimersByTimeAsync(3_001);
      expect(settled).toBeInstanceOf(DurableMcpRateLimitUnavailableError);
      expect(rpc).toHaveBeenCalledOnce();
    } finally {
      await vi.runAllTimersAsync();
      await pending;
      vi.useRealTimers();
    }
  });
});
