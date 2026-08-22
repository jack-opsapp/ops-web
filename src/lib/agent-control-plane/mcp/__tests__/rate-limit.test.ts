import { beforeEach, describe, expect, it, vi } from "vitest";

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
  actorUserId: "11111111-1111-4111-8111-111111111111",
  grantId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
});

beforeEach(() => {
  limiterCalls.length = 0;
  limiterResults.length = 0;
});

describe("MCP per-capability rate ceilings", () => {
  it("enforces actor, grant, then company ceilings for evidence/search reads", async () => {
    const result = await checkCapabilityRate({
      bucket: "evidence_search",
      ...RATE_IDENTITY,
    });

    expect(result).toEqual({ exceeded: false, retryAfterSec: 0 });
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
      checkCapabilityRate({ bucket: "evidence_search", ...RATE_IDENTITY })
    ).resolves.toEqual({
      exceeded: true,
      retryAfterSec: fixture.results.at(-1)!.retryAfterSec,
    });
    expect(limiterCalls).toHaveLength(fixture.expectedCalls);
  });

  it("retains the existing lightweight ceiling values for all three identities", async () => {
    await checkCapabilityRate({
      bucket: "lightweight_read",
      ...RATE_IDENTITY,
    });
    expect(limiterCalls.map((call) => call.limit)).toEqual([120, 120, 600]);
  });
});
