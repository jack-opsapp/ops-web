import { describe, expect, it, vi } from "vitest";

import {
  createDurableMcpRateLimiter,
  DurableMcpRateLimitUnavailableError,
} from "../durable-rate-limit";

const IDENTITY = Object.freeze({
  requestId: "req-durable-1",
  grantId: "11111111-1111-4111-8111-111111111111",
  actorUserId: "d2222222-2222-4222-d222-222222222222",
  companyId: "00000000-0000-0000-0000-000000000001",
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

  it("routes closeout preparation to its exact durable 6/6/30 policy", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          allowed: true,
          remaining_units: 5,
          reset_at: "2026-08-31T03:01:00.000Z",
        },
      ],
      error: null,
    }));
    const limiter = createDurableMcpRateLimiter({ rpc });

    await limiter.consume({
      ...IDENTITY,
      capabilityId: "prepare_day_closeout",
      bucket: "prepare",
    });

    expect(rpc).toHaveBeenCalledWith(
      "consume_agent_day_closeout_prepare_rate_limit_as_system",
      expect.objectContaining({
        p_capability_id: "prepare_day_closeout",
        p_policy_id: "mcp-day-closeout-prepare:2026-08-30.v1",
        p_requested_units: 1,
      })
    );
  });

  it("routes collections preparation to its separate durable policy", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          allowed: true,
          remaining_units: 5,
          reset_at: "2026-08-31T18:01:00.000Z",
        },
      ],
      error: null,
    }));
    const limiter = createDurableMcpRateLimiter({ rpc });

    await limiter.consume({
      ...IDENTITY,
      capabilityId: "prepare_collections",
      bucket: "prepare",
    });

    expect(rpc).toHaveBeenCalledWith(
      "consume_agent_collections_prepare_rate_limit_as_system",
      expect.objectContaining({
        p_capability_id: "prepare_collections",
        p_policy_id: "mcp-collections-prepare:2026-08-31.v1",
        p_requested_units: 1,
      })
    );
  });

  it("keeps the OAuth grant id on the strict RFC boundary", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const limiter = createDurableMcpRateLimiter({ rpc });

    await expect(
      limiter.consume({
        ...IDENTITY,
        grantId: "d1111111-1111-4111-d111-111111111111",
        bucket: "evidence_search",
      })
    ).rejects.toBeInstanceOf(DurableMcpRateLimitUnavailableError);
    expect(rpc).not.toHaveBeenCalled();
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
