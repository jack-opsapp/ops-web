import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { EntitySnapshot, SnapshotAd } from "@/lib/ads/engine/types";
import type {
  BlueprintGateway,
  BlueprintRepository,
  MutateResult,
} from "@/lib/ads/blueprint-apply";

/**
 * The routes are exercised end to end against a fake Google and a fake
 * warehouse: the real planner, the real apply logic and the real enable gate
 * all run. Only the two edges are stubbed.
 */
const fake = vi.hoisted(() => ({
  mutate: vi.fn(),
  readSnapshot: vi.fn(),
  refreshSnapshot: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/ads/blueprint-runtime", () => ({
  googleGateway: (): BlueprintGateway => ({ mutate: fake.mutate }),
  warehouseRepository: (): BlueprintRepository => ({
    readSnapshot: fake.readSnapshot,
    refreshSnapshot: fake.refreshSnapshot,
    record: fake.record,
  }),
}));

import {
  GET as blueprintGet,
  POST as blueprintPost,
} from "@/app/api/internal/ads/setup/blueprint/route";
import {
  GET as enableGet,
  POST as enablePost,
} from "@/app/api/internal/ads/setup/enable/route";
import { loadBlueprint } from "@/lib/ads/blueprint";

const SECRET = "test-cron-secret";
const clean: MutateResult = { results: [], failures: [], requestId: "req-1" };

const EMPTY: EntitySnapshot = {
  snapshotAt: "2026-09-09T00:00:00Z",
  campaigns: [],
  adGroups: [],
  ads: [],
  keywords: [],
  sharedSets: [],
  campaignNegatives: [],
  labels: [],
};

function post(path: string, body?: unknown, secret: string | null = SECRET) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** An account with one enabled campaign-shaped fixture, tunable per test. */
function accountWith(options: {
  labels?: string[];
  approvedAds?: number;
  status?: "PAUSED" | "ENABLED";
}): EntitySnapshot {
  const campaign = "customers/4454506598/campaigns/1";
  const adGroup = "customers/4454506598/adGroups/2";
  const ads: SnapshotAd[] = Array.from({ length: options.approvedAds ?? 0 }, (_, i) => ({
    resourceName: `customers/4454506598/adGroupAds/2~${i}`,
    id: String(i),
    adGroupResourceName: adGroup,
    status: "ENABLED",
    labels: [],
    role: i === 0 ? "control" : "challenger",
    approvalStatus: "APPROVED",
    reviewStatus: "REVIEWED",
    finalUrls: ["https://try.opsapp.co/compare/jobber"],
    headlines: [],
    descriptions: [],
    path1: null,
    path2: null,
  }));
  return {
    ...EMPTY,
    campaigns: [
      {
        resourceName: campaign,
        id: "1",
        name: "PRICING · US",
        status: options.status ?? "PAUSED",
        labels: options.labels ?? ["engine"],
        kind: "competitor",
        budgetResourceName: "customers/4454506598/campaignBudgets/9",
        dailyBudget: 18,
        biddingStrategy: "MAXIMIZE_CLICKS",
        cpcCeiling: 9,
        targetCpa: null,
      },
    ],
    adGroups: [
      {
        resourceName: adGroup,
        id: "2",
        name: "Jobber pricing",
        campaignResourceName: campaign,
        status: "ENABLED",
        labels: [],
        finalUrl: "https://try.opsapp.co/compare/jobber",
      },
    ],
    ads,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  fake.mutate.mockResolvedValue(clean);
  fake.readSnapshot.mockResolvedValue(EMPTY);
  fake.refreshSnapshot.mockResolvedValue(undefined);
  fake.record.mockResolvedValue(undefined);
});

describe("auth and method", () => {
  it("refuses both routes without the bearer, before touching Google", async () => {
    const responses = await Promise.all([
      blueprintPost(post("/api/internal/ads/setup/blueprint", undefined, null)),
      enablePost(post("/api/internal/ads/setup/enable", { campaigns: ["x"], confirm: "ENABLE" }, null)),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401]);
    expect(fake.mutate).not.toHaveBeenCalled();
  });

  it("refuses a wrong bearer", async () => {
    const response = await blueprintPost(post("/api/internal/ads/setup/blueprint", undefined, "nope"));
    expect(response.status).toBe(401);
    expect(fake.mutate).not.toHaveBeenCalled();
  });

  it("answers 405 on GET", async () => {
    for (const response of [await blueprintGet(), await enableGet()]) {
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });
});

describe("blueprint apply", () => {
  it("dry-runs by default: every mutate is validateOnly and nothing is written", async () => {
    const response = await blueprintPost(post("/api/internal/ads/setup/blueprint"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.validateOnly).toBe(true);
    expect(body.blueprintVersion).toBe(loadBlueprint().version);
    expect(fake.mutate).toHaveBeenCalledTimes(1);
    expect(fake.mutate.mock.calls[0][1]).toEqual({ validateOnly: true, partialFailure: false });
  });

  it("validates before it writes, and never with partial failure on", async () => {
    fake.readSnapshot
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValue(accountWith({ approvedAds: 0 }));
    const response = await blueprintPost(post("/api/internal/ads/setup/blueprint?validateOnly=0"));
    expect(response.status).toBe(200);
    const modes = fake.mutate.mock.calls.map((call) => call[1]);
    expect(modes[0]).toEqual({ validateOnly: true, partialFailure: false });
    expect(modes[1]).toEqual({ validateOnly: false, partialFailure: false });
    for (const mode of modes) expect(mode.partialFailure).toBe(false);
  });

  it("stops on a policy finding and never sends the real mutate", async () => {
    fake.mutate.mockResolvedValue({
      results: [],
      failures: [{ index: 3, code: "POLICY_FINDING", message: "Trademark in ad text" }],
      requestId: "req-policy",
    });
    const response = await blueprintPost(post("/api/internal/ads/setup/blueprint?validateOnly=0"));
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.failures[0].code).toBe("POLICY_FINDING");
    expect(fake.mutate).toHaveBeenCalledTimes(1);
    expect(fake.mutate.mock.calls[0][1].validateOnly).toBe(true);
  });

  it("plans nothing, and calls Google not at all, once the account matches", async () => {
    const built = await import("@/lib/ads/blueprint-planner");
    vi.spyOn(built, "planBlueprint").mockReturnValue([]);
    const response = await blueprintPost(post("/api/internal/ads/setup/blueprint?validateOnly=0"));
    const body = await response.json();
    expect(body.operations).toBe(0);
    expect(body.converged).toBe(true);
    expect(fake.mutate).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("records the outcome for the artifact", async () => {
    await blueprintPost(post("/api/internal/ads/setup/blueprint"));
    expect(fake.record).toHaveBeenCalledWith(
      "blueprint-apply",
      expect.objectContaining({ blueprintVersion: expect.any(String) })
    );
  });
});

describe("the enable gate", () => {
  it("refuses a campaign with no engine label", async () => {
    fake.readSnapshot.mockResolvedValue(accountWith({ labels: [], approvedAds: 4 }));
    const response = await enablePost(
      post("/api/internal/ads/setup/enable", { campaigns: ["PRICING · US"], confirm: "ENABLE" })
    );
    const body = await response.json();
    expect(body.changed).toEqual([]);
    expect(body.refused[0].reason).toMatch(/engine label/);
    expect(fake.mutate).not.toHaveBeenCalled();
  });

  it("refuses a campaign whose ads Google has not approved", async () => {
    fake.readSnapshot.mockResolvedValue(accountWith({ approvedAds: 1 }));
    const response = await enablePost(
      post("/api/internal/ads/setup/enable", { campaigns: ["PRICING · US"], confirm: "ENABLE" })
    );
    const body = await response.json();
    expect(body.changed).toEqual([]);
    expect(body.refused[0].reason).toMatch(/1 approved ads/);
    expect(fake.mutate).not.toHaveBeenCalled();
  });

  it("enables only when the label and two approved ads are both there", async () => {
    fake.readSnapshot.mockResolvedValue(accountWith({ approvedAds: 2 }));
    const response = await enablePost(
      post("/api/internal/ads/setup/enable", { campaigns: ["PRICING · US"], confirm: "ENABLE" })
    );
    const body = await response.json();
    expect(body.changed).toEqual([
      {
        name: "PRICING · US",
        resourceName: "customers/4454506598/campaigns/1",
        from: "PAUSED",
        to: "ENABLED",
      },
    ]);
    expect(fake.mutate.mock.calls[0][1].validateOnly).toBe(true);
    expect(fake.mutate.mock.calls[1][1].validateOnly).toBe(false);
    expect(fake.mutate.mock.calls[1][0][0]).toEqual({
      campaignOperation: {
        update: { resourceName: "customers/4454506598/campaigns/1", status: "ENABLED" },
        updateMask: "status",
      },
    });
  });

  it("pauses without any gate — stopping spend is always allowed", async () => {
    fake.readSnapshot.mockResolvedValue(
      accountWith({ labels: [], approvedAds: 0, status: "ENABLED" })
    );
    const response = await enablePost(
      post("/api/internal/ads/setup/enable", { campaigns: ["PRICING · US"], confirm: "PAUSE" })
    );
    const body = await response.json();
    expect(body.refused).toEqual([]);
    expect(body.changed[0].to).toBe("PAUSED");
  });

  it("refuses to act without an explicit confirm", async () => {
    for (const body of [
      { campaigns: ["PRICING · US"] },
      { campaigns: ["PRICING · US"], confirm: "yes" },
      { campaigns: [], confirm: "ENABLE" },
    ]) {
      const response = await enablePost(post("/api/internal/ads/setup/enable", body));
      expect(response.status).toBe(400);
    }
    expect(fake.mutate).not.toHaveBeenCalled();
  });

  it("names a campaign that does not exist rather than silently doing nothing", async () => {
    fake.readSnapshot.mockResolvedValue(accountWith({ approvedAds: 2 }));
    const response = await enablePost(
      post("/api/internal/ads/setup/enable", { campaigns: ["NOPE · US"], confirm: "ENABLE" })
    );
    const body = await response.json();
    expect(body.refused[0]).toEqual({
      campaign: "NOPE · US",
      reason: "No campaign by that name in the account.",
    });
  });
});
