import { describe, expect, it } from "vitest";
import {
  applyProposal,
  planOperations,
  type AdsGateway,
  type ApplyProposalRecord,
  type ApplyRepository,
  type MutateOperation,
  type MutateResult,
} from "@/lib/ads/engine/apply";
import { goodRsa, NOW, R, snapshot } from "./fixtures";

const CUSTOMER = "4454506598";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function proposal(overrides: Partial<ApplyProposalRecord> = {}): ApplyProposalRecord {
  return {
    id: "pppppppp-pppp-4ppp-8ppp-000000000001",
    run_id: RUN_ID,
    kind: "add_negatives",
    target: "negatives:NEG · Job seekers:abcdef01",
    state: "approved",
    mode_at_submit: "propose",
    payload: {
      list: "NEG · Job seekers",
      listResourceName: R.negJobSeekers,
      classification: "job_seeker",
      terms: [
        { text: "job management jobs", matchType: "PHRASE" },
        { text: "job management course", matchType: "PHRASE" },
      ],
    },
    ...overrides,
  };
}

interface Rig {
  gateway: AdsGateway;
  repository: ApplyRepository;
  calls: Array<{ operations: MutateOperation[]; validateOnly: boolean; partialFailure: boolean }>;
  marks: Array<{ id: string; state: string; validation: unknown; resourceNames: string[] | null; label: string | null; error: string | null }>;
  validations: Array<{ id: string; validation: unknown }>;
  changes: Array<Record<string, unknown>>;
  tests: Array<Record<string, unknown>>;
  refreshed: number;
}

function rig(options: {
  validate?: MutateResult;
  real?: MutateResult;
  throwOnReal?: boolean;
  rehearsal?: boolean;
} = {}): Rig {
  const calls: Rig["calls"] = [];
  const marks: Rig["marks"] = [];
  const validations: Rig["validations"] = [];
  const changes: Rig["changes"] = [];
  const tests: Rig["tests"] = [];
  const state = { refreshed: 0 };
  const ok = (operations: MutateOperation[]): MutateResult => ({
    results: operations.map((op, index) => {
      const service = Object.keys(op)[0].replace(/Operation$/, "");
      const create = (op[Object.keys(op)[0] as `${string}Operation`] as { create?: { resourceName?: string }; update?: { resourceName?: string } });
      const name = create.create?.resourceName ?? create.update?.resourceName ?? `customers/${CUSTOMER}/${service}s/${900 + index}`;
      return { [`${service}Result`]: { resourceName: name.replace(/-\d+/g, (m) => String(700 + Number(m.slice(1)))) } };
    }),
    failures: [],
    requestId: "req-ok",
  });
  const gateway: AdsGateway = {
    customerId: async () => CUSTOMER,
    mutate: async (operations, opts) => {
      calls.push({ operations, validateOnly: opts.validateOnly, partialFailure: opts.partialFailure ?? true });
      if (opts.validateOnly) return options.validate ?? { ...ok(operations), requestId: "req-validate" };
      if (options.throwOnReal) throw new Error("Google Ads API error (500): upstream");
      return options.real ?? ok(operations);
    },
  };
  const repository: ApplyRepository = {
    readSnapshot: async () => snapshot(),
    recordValidation: async (id, validation) => {
      validations.push({ id, validation });
    },
    markApplied: async (id, st, validation, resourceNames, label, error) => {
      marks.push({ id, state: st, validation, resourceNames, label, error });
      return st;
    },
    recordChange: async (change) => {
      changes.push(change as unknown as Record<string, unknown>);
      return `cccccccc-cccc-4ccc-8ccc-${String(changes.length).padStart(12, "0")}`;
    },
    openTest: async (test) => {
      tests.push(test as unknown as Record<string, unknown>);
      return "tttttttt-tttt-4ttt-8ttt-000000000001";
    },
    refreshSnapshot: async () => {
      state.refreshed += 1;
    },
  };
  return {
    gateway,
    repository,
    calls,
    marks,
    validations,
    changes,
    tests,
    get refreshed() {
      return state.refreshed;
    },
  };
}

function apply(record: ApplyProposalRecord, r: Rig, rehearsal = false) {
  return applyProposal(record, { gateway: r.gateway, repository: r.repository, now: () => NOW, rehearsal, appliedBy: "operator" });
}

describe("planOperations", () => {
  const labels = { engine: `customers/${CUSTOMER}/labels/1`, "role-control": `customers/${CUSTOMER}/labels/3`, "role-challenger": `customers/${CUSTOMER}/labels/4` };

  it("add_negatives → one sharedCriterionOperation.create per term on the named list", () => {
    const plan = planOperations(proposal(), snapshot(), labels, CUSTOMER, NOW);
    expect(plan.operations).toEqual([
      { sharedCriterionOperation: { create: { sharedSet: R.negJobSeekers, keyword: { text: "job management jobs", matchType: "PHRASE" } } } },
      { sharedCriterionOperation: { create: { sharedSet: R.negJobSeekers, keyword: { text: "job management course", matchType: "PHRASE" } } } },
    ]);
    expect(plan.before).toEqual({ members: 2 });
    expect(plan.after).toEqual({ members: 4, added: ["job management jobs", "job management course"] });
  });

  it("pause_keyword → adGroupCriterionOperation.update status PAUSED", () => {
    const plan = planOperations(
      proposal({ kind: "pause_keyword", payload: { criterion: R.kwJobManagementApp, text: "job management app", matchType: "PHRASE", adGroup: R.jobManagement, campaign: R.core } }),
      snapshot(), labels, CUSTOMER, NOW
    );
    expect(plan.operations).toEqual([
      { adGroupCriterionOperation: { update: { resourceName: R.kwJobManagementApp, status: "PAUSED" }, updateMask: "status" } },
    ]);
    expect(plan.campaignId).toBe("11");
    expect(plan.adGroupId).toBe("21");
  });

  it("add_keywords → adGroupCriterionOperation.create phrase/exact with the engine label", () => {
    const plan = planOperations(
      proposal({ kind: "add_keywords", payload: { ad_group: R.jobManagement, campaign: R.core, terms: [{ text: "job tracking app", matchType: "PHRASE" }, { text: "job tracker", matchType: "EXACT" }] } }),
      snapshot(), labels, CUSTOMER, NOW
    );
    // The run's gen label does not exist yet, so it is created first (-1) and
    // the keywords take the next temporary ids.
    expect(plan.operations[0]).toEqual({ labelOperation: { create: { resourceName: `customers/${CUSTOMER}/labels/-1`, name: `gen-${RUN_ID}` } } });
    expect(plan.operations[1]).toEqual({
      adGroupCriterionOperation: { create: { resourceName: `customers/${CUSTOMER}/adGroupCriteria/21~-2`, adGroup: R.jobManagement, status: "ENABLED", keyword: { text: "job tracking app", matchType: "PHRASE" } } },
    });
    expect(plan.operations[2]).toEqual({
      adGroupCriterionOperation: { create: { resourceName: `customers/${CUSTOMER}/adGroupCriteria/21~-3`, adGroup: R.jobManagement, status: "ENABLED", keyword: { text: "job tracker", matchType: "EXACT" } } },
    });
    expect(plan.operations.filter((op) => "adGroupCriterionLabelOperation" in op)).toHaveLength(4);
  });

  it("create_rsa_challenger → an ENABLED RSA with pins, three labels (creating gen-<run>), and a test to open", () => {
    const rsa = goodRsa();
    const plan = planOperations(
      proposal({
        kind: "create_rsa_challenger",
        payload: { ad_group: R.crewScheduling, adGroupId: "22", adGroupName: "Crew scheduling", campaign: R.core, campaignId: "11", campaignKind: "core", controlAd: R.csControl, controlAdId: "203", hypothesis: "Crew first.", ...rsa },
      }),
      snapshot(), labels, CUSTOMER, NOW
    );
    const label = plan.operations.find((op) => "labelOperation" in op) as { labelOperation: { create: { resourceName: string; name: string } } };
    expect(label.labelOperation.create).toEqual({ resourceName: `customers/${CUSTOMER}/labels/-1`, name: `gen-${RUN_ID}` });
    const ad = plan.operations.find((op) => "adGroupAdOperation" in op) as { adGroupAdOperation: { create: Record<string, unknown> } };
    expect(ad.adGroupAdOperation.create).toEqual({
      resourceName: `customers/${CUSTOMER}/adGroupAds/22~-2`,
      adGroup: R.crewScheduling,
      status: "ENABLED",
      ad: {
        finalUrls: ["https://try.opsapp.co/scheduling"],
        responsiveSearchAd: {
          headlines: rsa.headlines,
          descriptions: rsa.descriptions,
          path1: "crews",
          path2: "schedule",
        },
      },
    });
    const adLabels = plan.operations.filter((op) => "adGroupAdLabelOperation" in op) as Array<{ adGroupAdLabelOperation: { create: { adGroupAd: string; label: string } } }>;
    expect(adLabels.map((op) => op.adGroupAdLabelOperation.create)).toEqual([
      { adGroupAd: `customers/${CUSTOMER}/adGroupAds/22~-2`, label: labels.engine },
      { adGroupAd: `customers/${CUSTOMER}/adGroupAds/22~-2`, label: `customers/${CUSTOMER}/labels/-1` },
      { adGroupAd: `customers/${CUSTOMER}/adGroupAds/22~-2`, label: labels["role-challenger"] },
    ]);
    expect(plan.test).toMatchObject({ ad_group_id: "22", control_ad_id: "203", campaign_id: "11" });
    expect(plan.label).toBe(`gen-${RUN_ID}`);
  });

  it("promote_challenger → pause the loser and relabel the winner as control", () => {
    const plan = planOperations(
      proposal({
        kind: "promote_challenger",
        payload: { test_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", verdict: "challenger_won", winner: R.jmChallenger, loser: R.jmControl, adGroup: R.jobManagement, adGroupId: "21", campaign: R.core, campaignId: "11" },
      }),
      snapshot(), labels, CUSTOMER, NOW
    );
    expect(plan.operations).toEqual([
      { adGroupAdOperation: { update: { resourceName: R.jmControl, status: "PAUSED" }, updateMask: "status" } },
      { adGroupAdLabelOperation: { remove: `customers/${CUSTOMER}/adGroupAdLabels/21~202~4` } },
      { adGroupAdLabelOperation: { create: { adGroupAd: R.jmChallenger, label: labels["role-control"] } } },
    ]);
    expect(plan.before).toEqual({ control: R.jmControl, challenger: R.jmChallenger });
    expect(plan.after).toEqual({ control: R.jmChallenger, paused: R.jmControl });
  });

  it("pause_ad, adjust_budget, adjust_cpc_cap, set_bidding_strategy → the matching single update", () => {
    expect(planOperations(proposal({ kind: "pause_ad", payload: { ad: R.jmControl, adId: "201", adGroup: R.jobManagement, adGroupId: "21", campaign: R.core, campaignId: "11", reason: "x" } }), snapshot(), labels, CUSTOMER, NOW).operations).toEqual([
      { adGroupAdOperation: { update: { resourceName: R.jmControl, status: "PAUSED" }, updateMask: "status" } },
    ]);
    const budget = planOperations(proposal({ kind: "adjust_budget", payload: { campaign: R.core, campaignId: "11", campaignName: "CORE · CA", budgetResourceName: R.coreBudget, currentDailyAmount: 32, new_daily_amount: 36, reason: "x" } }), snapshot(), labels, CUSTOMER, NOW);
    expect(budget.operations).toEqual([
      { campaignBudgetOperation: { update: { resourceName: R.coreBudget, amountMicros: "36000000" }, updateMask: "amountMicros" } },
    ]);
    expect(budget.before).toEqual({ dailyBudget: 32 });
    expect(budget.after).toEqual({ dailyBudget: 36 });
    expect(planOperations(proposal({ kind: "adjust_cpc_cap", payload: { campaign: R.core, campaignId: "11", campaignName: "CORE · CA", currentCpcCap: 8, new_cpc_cap: 9, reason: "x" } }), snapshot(), labels, CUSTOMER, NOW).operations).toEqual([
      { campaignOperation: { update: { resourceName: R.core, maximizeClicks: { cpcBidCeilingMicros: "9000000" } }, updateMask: "maximizeClicks.cpcBidCeilingMicros" } },
    ]);
    expect(planOperations(proposal({ kind: "set_bidding_strategy", payload: { campaign: R.core, campaignId: "11", campaignName: "CORE · CA", currentStrategy: "MAXIMIZE_CLICKS", strategy: "MAXIMIZE_CONVERSIONS", target_cpa: null, cpcCeiling: 8 } }), snapshot(), labels, CUSTOMER, NOW).operations).toEqual([
      { campaignOperation: { update: { resourceName: R.core, maximizeConversions: {} }, updateMask: "maximizeConversions" } },
    ]);
    expect(planOperations(proposal({ kind: "set_bidding_strategy", payload: { campaign: R.core, campaignId: "11", campaignName: "CORE · CA", currentStrategy: "MAXIMIZE_CONVERSIONS", strategy: "TARGET_CPA", target_cpa: 120, cpcCeiling: null } }), snapshot(), labels, CUSTOMER, NOW).operations).toEqual([
      { campaignOperation: { update: { resourceName: R.core, targetCpa: { targetCpaMicros: "120000000" } }, updateMask: "targetCpa" } },
    ]);
  });

  it("add_ad_group → the whole subtree with temporary ids wired parent to child", () => {
    const rsa = goodRsa("https://try.opsapp.co/job-management");
    const plan = planOperations(
      proposal({
        kind: "add_ad_group",
        payload: { campaign: R.core, campaignId: "11", campaignName: "CORE · CA", campaignKind: "core", name: "Deck builder software", theme: "deck", final_url: "https://try.opsapp.co/job-management", keywords: [{ text: "deck builder software", matchType: "PHRASE" }], ads: [rsa] },
      }),
      snapshot(), labels, CUSTOMER, NOW
    );
    const group = `customers/${CUSTOMER}/adGroups/-2`;
    expect(plan.operations[0]).toEqual({ labelOperation: { create: { resourceName: `customers/${CUSTOMER}/labels/-1`, name: `gen-${RUN_ID}` } } });
    expect(plan.operations[1]).toEqual({ adGroupOperation: { create: { resourceName: group, campaign: R.core, name: "Deck builder software", status: "ENABLED", type: "SEARCH_STANDARD" } } });
    expect(plan.operations[2]).toEqual({ adGroupCriterionOperation: { create: { resourceName: `customers/${CUSTOMER}/adGroupCriteria/-2~-3`, adGroup: group, status: "ENABLED", keyword: { text: "deck builder software", matchType: "PHRASE" } } } });
    const ad = plan.operations.find((op) => "adGroupAdOperation" in op) as { adGroupAdOperation: { create: { adGroup: string; resourceName: string } } };
    expect(ad.adGroupAdOperation.create.adGroup).toBe(group);
    expect(ad.adGroupAdOperation.create.resourceName).toBe(`customers/${CUSTOMER}/adGroupAds/-2~-4`);
    const roles = plan.operations.filter((op) => "adGroupAdLabelOperation" in op).map((op) => (op as { adGroupAdLabelOperation: { create: { label: string } } }).adGroupAdLabelOperation.create.label);
    expect(roles).toContain(labels["role-control"]);
  });

  it("observation → no operations", () => {
    expect(planOperations(proposal({ kind: "observation", payload: { text: "x" } }), snapshot(), labels, CUSTOMER, NOW).operations).toEqual([]);
  });
});

describe("applyProposal", () => {
  it("runs validateOnly first, then the real mutate with partialFailure off, then records the change", async () => {
    const r = rig();
    const outcome = await apply(proposal(), r);
    expect(r.calls.map((c) => [c.validateOnly, c.partialFailure])).toEqual([
      [true, false],
      [false, false],
    ]);
    expect(outcome.state).toBe("applied");
    expect(r.marks).toEqual([
      expect.objectContaining({ state: "applied", label: `gen-${RUN_ID}`, error: null }),
    ]);
    expect(r.marks[0].resourceNames).toHaveLength(2);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      proposal_id: proposal().id,
      kind: "add_negatives",
      label: `gen-${RUN_ID}`,
      measure_from: "2026-10-21",
      measure_to: "2026-11-03",
      before: { members: 2 },
    });
    expect(r.refreshed).toBe(1);
  });

  it("marks the proposal failed on a validateOnly policy finding and never sends the real mutate", async () => {
    const r = rig({
      validate: {
        results: [],
        failures: [{ index: 1, code: "POLICY_FINDING", message: "Policy violation: TRADEMARKS", topics: ["TRADEMARKS"] }],
        requestId: "req-policy",
      },
    });
    const outcome = await apply(proposal({ kind: "create_rsa_challenger", payload: { ad_group: R.crewScheduling, adGroupId: "22", adGroupName: "Crew scheduling", campaign: R.core, campaignId: "11", campaignKind: "core", controlAd: R.csControl, controlAdId: "203", hypothesis: "x", ...goodRsa() } }), r);
    expect(outcome).toMatchObject({ state: "failed", policyTopics: ["TRADEMARKS"] });
    expect(r.calls).toHaveLength(1);
    expect(r.marks[0]).toMatchObject({
      state: "failed",
      validation: { validateOnly: true, requestId: "req-policy", failures: [expect.objectContaining({ code: "POLICY_FINDING" })] },
    });
    expect(r.marks[0].error).toMatch(/POLICY_FINDING/);
    expect(r.changes).toHaveLength(0);
    expect(r.tests).toHaveLength(0);
  });

  it("stops after validation in rehearsal mode and leaves the proposal approved", async () => {
    const r = rig();
    const outcome = await apply(proposal(), r, true);
    expect(outcome.state).toBe("validated");
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].validateOnly).toBe(true);
    expect(r.marks).toHaveLength(0);
    expect(r.validations).toEqual([{ id: proposal().id, validation: expect.objectContaining({ validateOnly: true, rehearsal: true }) }]);
    expect(r.changes).toHaveLength(0);
  });

  it("opens the test when a challenger goes live", async () => {
    const r = rig();
    const outcome = await apply(proposal({ kind: "create_rsa_challenger", payload: { ad_group: R.crewScheduling, adGroupId: "22", adGroupName: "Crew scheduling", campaign: R.core, campaignId: "11", campaignKind: "core", controlAd: R.csControl, controlAdId: "203", hypothesis: "x", ...goodRsa() } }), r);
    expect(outcome.state).toBe("applied");
    expect(r.tests).toHaveLength(1);
    expect(r.tests[0]).toMatchObject({ ad_group_id: "22", control_ad_id: "203", proposal_id: proposal().id, label: `gen-${RUN_ID}` });
    expect(String(r.tests[0].challenger_ad_id)).toMatch(/^\d+$/);
    expect(r.changes[0]).toMatchObject({ kind: "create_rsa_challenger", ad_group_id: "22" });
  });

  it("marks failed with the error when the real mutate throws", async () => {
    const r = rig({ throwOnReal: true });
    const outcome = await apply(proposal(), r);
    expect(outcome.state).toBe("failed");
    expect(r.marks[0]).toMatchObject({ state: "failed", error: expect.stringContaining("upstream") });
    expect(r.changes).toHaveLength(0);
  });

  it("applies an observation without touching Google", async () => {
    const r = rig();
    const outcome = await apply(proposal({ kind: "observation", payload: { text: "Noted." } }), r);
    expect(outcome.state).toBe("applied");
    expect(r.calls).toHaveLength(0);
    expect(r.marks[0]).toMatchObject({ state: "applied", resourceNames: [] });
    expect(r.changes).toHaveLength(0);
  });

  it("refuses to apply anything not approved (or auto-mode proposed)", async () => {
    const r = rig();
    await expect(apply(proposal({ state: "rejected" }), r)).rejects.toThrow(/not applicable/);
    const auto = await apply(proposal({ state: "proposed", mode_at_submit: "auto" }), r);
    expect(auto.state).toBe("applied");
    expect(r.calls).toHaveLength(2);
  });
});
