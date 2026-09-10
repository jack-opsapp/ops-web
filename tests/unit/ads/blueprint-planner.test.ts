import { describe, expect, it } from "vitest";
import {
  BlueprintError,
  blueprintFinalUrls,
  loadBlueprint,
  parseBlueprint,
  type Blueprint,
} from "@/lib/ads/blueprint";
import {
  negativeBlocks,
  planBlueprint,
  PlannerError,
  STAGES,
  toMutateOperations,
  type PlannedOperation,
} from "@/lib/ads/blueprint-planner";
import type { EntitySnapshot } from "@/lib/ads/engine/types";

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

/** The smallest blueprint that says something true, for the unit rules. */
function minimal(overrides: Partial<Blueprint> = {}): Blueprint {
  return parseBlueprint({
    version: "test-v1",
    customerId: "4454506598",
    currency: "CAD",
    evidence: [],
    labels: ["engine", "legacy"],
    sharedNegativeLists: [
      {
        name: "NEG · Test",
        purpose: "Fixture.",
        keywords: [{ text: "free", matchType: "BROAD" }],
      },
    ],
    campaigns: [
      {
        name: "TEST · US",
        kind: "core",
        status: "PAUSED",
        budget: {
          name: "TEST · US budget",
          amountMicros: "12000000",
          deliveryMethod: "STANDARD",
        },
        bidding: { type: "MAXIMIZE_CLICKS", cpcBidCeilingMicros: "9000000" },
        network: {
          targetGoogleSearch: true,
          targetSearchNetwork: false,
          targetContentNetwork: false,
        },
        geo: {
          locations: ["geoTargetConstants/2840"],
          positiveGeoTargetType: "PRESENCE",
        },
        languages: ["languageConstants/1000"],
        negativeLists: ["NEG · Test"],
        campaignNegatives: [],
        adGroups: [
          {
            name: "Group",
            finalUrl: "https://try.opsapp.co/job-management",
            keywords: [{ text: "roofing software", matchType: "PHRASE" }],
            ads: [],
          },
        ],
      },
    ],
    ...overrides,
  });
}

const stages = (plan: PlannedOperation[]) => plan.map((entry) => entry.stage);
const first = (plan: PlannedOperation[], service: string) =>
  plan.find((entry) => Object.keys(entry.op)[0] === service);

describe("negativeBlocks", () => {
  it("broad blocks when every token appears, in any order", () => {
    expect(negativeBlocks({ text: "free", matchType: "BROAD" }, "free jobber alternatives")).toBe(true);
    expect(negativeBlocks({ text: "how much does", matchType: "BROAD" }, "how much does jobber cost")).toBe(true);
    expect(negativeBlocks({ text: "how much does", matchType: "BROAD" }, "how much is housecall pro")).toBe(false);
  });

  it("does not match plurals or close variants, as Google does not", () => {
    expect(negativeBlocks({ text: "jobs", matchType: "BROAD" }, "job management app")).toBe(false);
    expect(negativeBlocks({ text: "cleaning services", matchType: "BROAD" }, "cleaning business software")).toBe(false);
  });

  it("phrase needs the tokens contiguous and exact needs the whole term", () => {
    expect(negativeBlocks({ text: "lawn care", matchType: "PHRASE" }, "lawn care software")).toBe(true);
    expect(negativeBlocks({ text: "care lawn", matchType: "PHRASE" }, "lawn care software")).toBe(false);
    expect(negativeBlocks({ text: "roofing software", matchType: "EXACT" }, "roofing software")).toBe(true);
    expect(negativeBlocks({ text: "roofing software", matchType: "EXACT" }, "roofing software free")).toBe(false);
  });
});

describe("planBlueprint — empty account", () => {
  const plan = planBlueprint(minimal(), EMPTY);

  it("emits the full create tree in stage order", () => {
    expect(stages(plan)).toEqual([...stages(plan)].sort((a, b) => a - b));
    const services = plan.map((entry) => Object.keys(entry.op)[0]);
    expect(services).toContain("campaignBudgetOperation");
    expect(services).toContain("campaignOperation");
    expect(services).toContain("campaignCriterionOperation");
    expect(services).toContain("adGroupOperation");
    expect(services).toContain("adGroupCriterionOperation");
    expect(services).toContain("sharedSetOperation");
    expect(services).toContain("campaignSharedSetOperation");
  });

  it("wires temporary ids parent to child", () => {
    const budget = first(plan, "campaignBudgetOperation");
    const campaign = first(plan, "campaignOperation");
    const adGroup = first(plan, "adGroupOperation");
    const keyword = first(plan, "adGroupCriterionOperation");
    expect(budget?.temporaryId).toMatch(/campaignBudgets\/-\d+$/);
    expect((campaign?.op.campaignOperation?.create as Record<string, unknown>).campaignBudget).toBe(budget?.temporaryId);
    expect((adGroup?.op.adGroupOperation?.create as Record<string, unknown>).campaign).toBe(campaign?.temporaryId);
    expect((keyword?.op.adGroupCriterionOperation?.create as Record<string, unknown>).adGroup).toBe(adGroup?.temporaryId);
  });

  it("never creates an enabled campaign and never touches the display network", () => {
    for (const entry of plan) {
      const create = entry.op.campaignOperation?.create as Record<string, unknown> | undefined;
      if (!create) continue;
      expect(create.status).toBe("PAUSED");
      expect(create.advertisingChannelType).toBe("SEARCH");
      expect(create.networkSettings).toMatchObject({
        targetGoogleSearch: true,
        targetSearchNetwork: false,
        targetContentNetwork: false,
        targetPartnerSearchNetwork: false,
      });
    }
  });

  it("spells Maximize Clicks as the v25 proto does — target_spend, with a ceiling", () => {
    const create = first(plan, "campaignOperation")?.op.campaignOperation?.create as Record<string, unknown>;
    expect(create.targetSpend).toEqual({ cpcBidCeilingMicros: "9000000" });
    expect(create).not.toHaveProperty("maximizeClicks");
  });

  it("attaches the shared list only after the set that holds it exists", () => {
    const setIndex = plan.findIndex((e) => "sharedSetOperation" in e.op);
    const attachIndex = plan.findIndex((e) => "campaignSharedSetOperation" in e.op);
    expect(setIndex).toBeGreaterThanOrEqual(0);
    expect(attachIndex).toBeGreaterThan(setIndex);
  });
});

describe("planBlueprint — idempotence", () => {
  /** The account exactly as the minimal blueprint describes it. */
  function builtSnapshot(): EntitySnapshot {
    return {
      ...EMPTY,
      campaigns: [
        {
          resourceName: "customers/4454506598/campaigns/1",
          id: "1",
          name: "TEST · US",
          status: "PAUSED",
          labels: ["engine"],
          kind: "core",
          budgetResourceName: "customers/4454506598/campaignBudgets/9",
          dailyBudget: 12,
          biddingStrategy: "MAXIMIZE_CLICKS",
          cpcCeiling: 9,
          targetCpa: null,
        },
      ],
      adGroups: [
        {
          resourceName: "customers/4454506598/adGroups/2",
          id: "2",
          name: "Group",
          campaignResourceName: "customers/4454506598/campaigns/1",
          status: "ENABLED",
          labels: [],
          finalUrl: "https://try.opsapp.co/job-management",
        },
      ],
      keywords: [
        {
          resourceName: "customers/4454506598/adGroupCriteria/2~3",
          criterionId: "3",
          adGroupResourceName: "customers/4454506598/adGroups/2",
          text: "roofing software",
          matchType: "PHRASE",
          status: "ENABLED",
          negative: false,
        },
      ],
      sharedSets: [
        {
          resourceName: "customers/4454506598/sharedSets/4",
          id: "4",
          name: "NEG · Test",
          type: "NEGATIVE_KEYWORDS",
          members: [
            {
              resourceName: "customers/4454506598/sharedCriteria/4~5",
              text: "free",
              matchType: "BROAD",
            },
          ],
          campaignResourceNames: ["customers/4454506598/campaigns/1"],
        },
      ],
      labels: [
        { resourceName: "customers/4454506598/labels/6", name: "engine" },
      ],
    };
  }

  it("plans nothing against the account it already built", () => {
    expect(planBlueprint(minimal(), builtSnapshot())).toEqual([]);
  });

  it("a changed budget produces exactly one update with a narrow mask", () => {
    const snapshot = builtSnapshot();
    snapshot.campaigns[0].dailyBudget = 30;
    const plan = planBlueprint(minimal(), snapshot);
    expect(plan).toHaveLength(1);
    expect(plan[0].stage).toBe(STAGES.BUDGETS);
    expect(plan[0].op).toEqual({
      campaignBudgetOperation: {
        update: {
          resourceName: "customers/4454506598/campaignBudgets/9",
          amountMicros: "12000000",
        },
        updateMask: "amountMicros",
      },
    });
  });

  it("a changed CPC ceiling updates target_spend only, never status", () => {
    const snapshot = builtSnapshot();
    snapshot.campaigns[0].cpcCeiling = 4;
    const plan = planBlueprint(minimal(), snapshot);
    expect(plan).toHaveLength(1);
    const update = plan[0].op.campaignOperation?.update as Record<string, unknown>;
    expect(update).not.toHaveProperty("status");
    expect(plan[0].op.campaignOperation?.updateMask).toBe("target_spend.cpc_bid_ceiling_micros");
  });

  it("labels a campaign engine only when it is missing the label", () => {
    const snapshot = builtSnapshot();
    snapshot.campaigns[0].labels = [];
    const plan = planBlueprint(minimal(), snapshot);
    const assignments = plan.filter((e) => "campaignLabelOperation" in e.op);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].op.campaignLabelOperation?.create).toEqual({
      campaign: "customers/4454506598/campaigns/1",
      label: "customers/4454506598/labels/6",
    });
  });

  it("labels every campaign the blueprint does not own legacy, exactly once", () => {
    const snapshot = builtSnapshot();
    snapshot.campaigns.push(
      {
        ...snapshot.campaigns[0],
        resourceName: "customers/4454506598/campaigns/77",
        id: "77",
        name: "Old Search 2024",
        labels: [],
      },
      {
        ...snapshot.campaigns[0],
        resourceName: "customers/4454506598/campaigns/78",
        id: "78",
        name: "Old Display 2023",
        labels: ["legacy"],
      }
    );
    const plan = planBlueprint(minimal(), snapshot);
    const legacy = plan.filter(
      (e) =>
        (e.op.campaignLabelOperation?.create as Record<string, unknown>)?.campaign ===
        "customers/4454506598/campaigns/77"
    );
    expect(legacy).toHaveLength(1);
    expect(plan.some((e) => e.describe.includes("Old Display"))).toBe(false);
    // The legacy label did not exist, so it is created before it is assigned.
    const createIndex = plan.findIndex((e) => "labelOperation" in e.op);
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeLessThan(plan.indexOf(legacy[0]));
  });
});

describe("planBlueprint — refusals", () => {
  it("rejects a broad positive keyword", () => {
    const broad = JSON.parse(JSON.stringify(minimal())) as Blueprint;
    (broad.campaigns[0].adGroups[0].keywords[0] as { matchType: string }).matchType = "BROAD";
    expect(() => planBlueprint(broad, EMPTY)).toThrowError(PlannerError);
    try {
      planBlueprint(broad, EMPTY);
    } catch (error) {
      expect((error as PlannerError).code).toBe("BROAD_MATCH_REJECTED");
    }
  });

  it("rejects a negative that would block a keyword the same campaign bids on", () => {
    const clashing = minimal({
      sharedNegativeLists: [
        {
          name: "NEG · Test",
          purpose: "Fixture.",
          keywords: [{ text: "roofing", matchType: "BROAD" }],
        },
      ],
    });
    try {
      planBlueprint(clashing, EMPTY);
      throw new Error("expected the planner to refuse");
    } catch (error) {
      expect((error as PlannerError).code).toBe("NEGATIVE_BLOCKS_KEYWORD");
      expect((error as Error).message).toContain("roofing software");
    }
  });

  it("the schema refuses to describe an enabled campaign", () => {
    expect(() =>
      minimal({
        campaigns: [
          { ...minimal().campaigns[0], status: "ENABLED" } as never,
        ],
      })
    ).toThrowError(BlueprintError);
  });

  it("refuses Maximize Clicks with no ceiling", () => {
    expect(() =>
      minimal({
        campaigns: [
          {
            ...minimal().campaigns[0],
            bidding: { type: "MAXIMIZE_CLICKS" },
          },
        ],
      })
    ).toThrowError(/cpcBidCeilingMicros/);
  });

  it("refuses a campaign that attaches a list nothing defines", () => {
    expect(() =>
      minimal({
        campaigns: [
          { ...minimal().campaigns[0], negativeLists: ["NEG · Nope"] },
        ],
      })
    ).toThrowError(/sharedNegativeLists/);
  });
});

describe("the committed blueprint", () => {
  const blueprint = loadBlueprint();

  it("parses, and every campaign is paused on Search only", () => {
    expect(blueprint.campaigns).toHaveLength(5);
    for (const campaign of blueprint.campaigns) {
      expect(campaign.status).toBe("PAUSED");
      expect(campaign.network.targetSearchNetwork).toBe(false);
      expect(campaign.network.targetContentNetwork).toBe(false);
      expect(campaign.geo.positiveGeoTargetType).toBe("PRESENCE");
      expect(campaign.languages).toEqual(["languageConstants/1000"]);
      expect(campaign.negativeLists).toHaveLength(5);
    }
  });

  it("spends exactly the locked $50/day", () => {
    const daily = blueprint.campaigns.reduce(
      (total, campaign) => total + Number(campaign.budget.amountMicros) / 1_000_000,
      0
    );
    expect(daily).toBe(50);
  });

  it("puts the money where the searches are — the US carries $43 of $50", () => {
    const us = blueprint.campaigns
      .filter((c) => c.geo.locations.includes("geoTargetConstants/2840"))
      .reduce((total, c) => total + Number(c.budget.amountMicros) / 1_000_000, 0);
    expect(us).toBe(43);
  });

  it("carries no broad positive keyword and no self-blocking negative", () => {
    expect(() => planBlueprint(blueprint, EMPTY)).not.toThrow();
  });

  it("points only at pages the copy rules allow", () => {
    expect(blueprintFinalUrls(blueprint)).toEqual([
      "https://try.opsapp.co/",
      "https://try.opsapp.co/compare/housecall-pro",
      "https://try.opsapp.co/compare/jobber",
      "https://try.opsapp.co/compare/servicetitan",
      "https://try.opsapp.co/for/cleaning",
      "https://try.opsapp.co/for/landscaping",
      "https://try.opsapp.co/for/roofing",
      "https://try.opsapp.co/job-management",
    ]);
  });

  it("plans one whole account in a single mutate", () => {
    const plan = planBlueprint(blueprint, EMPTY);
    const operations = toMutateOperations(plan);
    expect(operations.length).toBe(plan.length);
    expect(plan.filter((e) => "campaignOperation" in e.op)).toHaveLength(5);
    expect(plan.filter((e) => "adGroupOperation" in e.op)).toHaveLength(12);
    expect(plan.filter((e) => "sharedSetOperation" in e.op)).toHaveLength(5);
    // Five lists on five campaigns.
    expect(plan.filter((e) => "campaignSharedSetOperation" in e.op)).toHaveLength(25);
  });
});
