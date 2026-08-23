import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DurableMcpRateLimiter,
  DurableMcpRateLimitInput,
} from "../durable-rate-limit";

const limiterCalls: Array<{
  readonly key: string;
  readonly limit: number;
  readonly windowSec: number;
}> = [];
const limiterResults: Array<{
  readonly exceeded: boolean;
  readonly retryAfterSec: number;
}> = [];

vi.mock("@/lib/utils/ratelimit", () => ({
  rateLimit: vi.fn(async (input: (typeof limiterCalls)[number]) => {
    limiterCalls.push(input);
    return limiterResults.shift() ?? { exceeded: false, retryAfterSec: 0 };
  }),
}));

import { checkCapabilityRate } from "../rate-limit";

const RATE_IDENTITY = Object.freeze({
  requestId: "req-rate-1",
  actorUserId: "11111111-1111-4111-8111-111111111111",
  grantId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  capabilityId: "search_jobs",
  protocolEra: "modern" as const,
});

const durableCalls: DurableMcpRateLimitInput[] = [];
const durableResults: Array<{
  readonly allowed: boolean;
  readonly remainingUnits: number;
  readonly resetAt: string;
}> = [];
let durableFailure: Error | null = null;

const durableLimiter: DurableMcpRateLimiter = Object.freeze({
  async consume(input: DurableMcpRateLimitInput) {
    durableCalls.push(input);
    if (durableFailure) throw durableFailure;
    return (
      durableResults.shift() ?? {
        allowed: true,
        remainingUnits: 29,
        resetAt: new Date(Date.now() + 30_000).toISOString(),
      }
    );
  },
});

beforeEach(() => {
  limiterCalls.length = 0;
  limiterResults.length = 0;
  durableCalls.length = 0;
  durableResults.length = 0;
  durableFailure = null;
});

describe("MCP per-capability rate ceilings", () => {
  it("enforces actor, grant, then company ceilings for evidence/search reads", async () => {
    const result = await checkCapabilityRate({
      durableLimiter,
      bucket: "evidence_search",
      ...RATE_IDENTITY,
    });

    expect(result).toEqual({ exceeded: false, retryAfterSec: 0 });
    expect(durableCalls).toEqual([
      { bucket: "evidence_search", ...RATE_IDENTITY },
    ]);
    expect(limiterCalls).toEqual([
      {
        key: `mcp:evidence_search:actor:${RATE_IDENTITY.actorUserId}`,
        limit: 30,
        windowSec: 60,
      },
      {
        key: `mcp:evidence_search:grant:${RATE_IDENTITY.grantId}`,
        limit: 30,
        windowSec: 60,
      },
      {
        key: `mcp:evidence_search:company:${RATE_IDENTITY.companyId}`,
        limit: 120,
        windowSec: 60,
      },
    ]);
  });

  it.each([
    {
      label: "actor",
      results: [{ exceeded: true, retryAfterSec: 11 }],
      expectedCalls: 1,
    },
    {
      label: "grant",
      results: [
        { exceeded: false, retryAfterSec: 0 },
        { exceeded: true, retryAfterSec: 17 },
      ],
      expectedCalls: 2,
    },
    {
      label: "company",
      results: [
        { exceeded: false, retryAfterSec: 0 },
        { exceeded: false, retryAfterSec: 0 },
        { exceeded: true, retryAfterSec: 23 },
      ],
      expectedCalls: 3,
    },
  ])("stops at the exceeded $label ceiling", async (fixture) => {
    limiterResults.push(...fixture.results);

    await expect(
      checkCapabilityRate({
        durableLimiter,
        bucket: "evidence_search",
        ...RATE_IDENTITY,
      })
    ).resolves.toEqual({
      exceeded: true,
      retryAfterSec: fixture.results.at(-1)!.retryAfterSec,
    });
    expect(limiterCalls).toHaveLength(fixture.expectedCalls);
  });

  it("retains the existing lightweight ceiling values for all three identities", async () => {
    await checkCapabilityRate({
      durableLimiter,
      bucket: "lightweight_read",
      ...RATE_IDENTITY,
    });
    expect(limiterCalls.map((call) => call.limit)).toEqual([120, 120, 600]);
  });

  it("returns a durable denial before touching the process/KV burst guard", async () => {
    durableResults.push({
      allowed: false,
      remainingUnits: 0,
      resetAt: new Date(Date.now() + 17_000).toISOString(),
    });

    await expect(
      checkCapabilityRate({
        durableLimiter,
        bucket: "evidence_search",
        ...RATE_IDENTITY,
      })
    ).resolves.toMatchObject({
      exceeded: true,
      retryAfterSec: expect.any(Number),
      durableAuditRecorded: true,
    });
    expect(limiterCalls).toEqual([]);
  });

  it("fails closed when the durable boundary is unavailable", async () => {
    durableFailure = new Error("database timeout");

    await expect(
      checkCapabilityRate({
        durableLimiter,
        bucket: "evidence_search",
        ...RATE_IDENTITY,
      })
    ).rejects.toThrow("database timeout");
    expect(limiterCalls).toEqual([]);
  });
});
