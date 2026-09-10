import { describe, expect, it } from "vitest";
import {
  changeScope,
  runEngineTick,
  type PacingRow,
  type WorkerDependencies,
  type WorkerRepository,
} from "@/lib/ads/engine/worker";
import type { ApplyOutcome, ApplyProposalRecord, MutateOperation } from "@/lib/ads/engine/apply";
import type { ChangeRecord, EngineSettings, TestRecord } from "@/lib/ads/engine/types";
import { NOW, R, settings, snapshot } from "./fixtures";

const OPERATOR = { userId: "operator", companyId: "11111111-1111-4111-8111-111111111111" };

function runningTest(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: "tttttttt-tttt-4ttt-8ttt-000000000001",
    campaign_id: "11",
    ad_group_id: "21",
    ad_group_name: "Job management",
    control_ad_id: "201",
    challenger_ad_id: "202",
    started_at: "2026-09-20T15:00:00.000Z",
    min_days: 14,
    min_impressions: 2000,
    max_days: 56,
    state: "running",
    stats: null,
    verdict_at: null,
    ...overrides,
  };
}

function pendingChange(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-000000000001",
    proposal_id: "pppppppp-pppp-4ppp-8ppp-000000000009",
    kind: "adjust_cpc_cap",
    campaign_id: "11",
    ad_group_id: null,
    resource_names: [R.core],
    before: { cpcCeiling: 7 },
    after: { cpcCeiling: 8 },
    applied_at: "2026-09-20T16:00:00.000Z",
    measure_from: "2026-09-21",
    measure_to: "2026-10-04",
    pre_metrics: null,
    post_metrics: null,
    verdict: "pending",
    verdict_at: null,
    ...overrides,
  };
}

function autoProposal(overrides: Partial<ApplyProposalRecord> = {}): ApplyProposalRecord {
  return {
    id: "pppppppp-pppp-4ppp-8ppp-000000000001",
    run_id: "22222222-2222-4222-8222-222222222222",
    kind: "add_negatives",
    target: "negatives:NEG · Job seekers:abcdef01",
    state: "proposed",
    mode_at_submit: "auto",
    payload: { list: "NEG · Job seekers", listResourceName: R.negJobSeekers, classification: "job_seeker", terms: [{ text: "x", matchType: "PHRASE" }] },
    ...overrides,
  };
}

interface Rig {
  deps: WorkerDependencies;
  applied: ApplyProposalRecord[];
  concluded: Array<{ id: string; state: string; stats: Record<string, unknown> }>;
  followUps: Array<Record<string, unknown>>;
  verdicts: Array<{ id: string; verdict: string; pre: Record<string, unknown>; post: Record<string, unknown> }>;
  alerts: Array<{ kind: string; dedupeKey: string; title: string; body: string; persistent: boolean }>;
  mutations: Array<{ operations: MutateOperation[]; validateOnly: boolean }>;
  stallChecks: Array<{ staleHours: number; campaignsLive: boolean }>;
  cleared: number;
  notified: number;
}

function rig(options: {
  settings?: EngineSettings;
  auto?: ApplyProposalRecord[];
  tests?: TestRecord[];
  arms?: Record<string, { impressions: number; clicks: number; conversions: number }>;
  changes?: ChangeRecord[];
  entityMetrics?: (change: ChangeRecord, window: { from: string; to: string }) => { impressions: number; clicks: number; conversions: number };
  applyOutcome?: (p: ApplyProposalRecord) => ApplyOutcome;
  apply?: null;
  gateway?: null;
  disapproved?: boolean;
  pacing?: PacingRow[] | null;
  operator?: null;
  heartbeat?: string | null;
} = {}): Rig {
  const applied: ApplyProposalRecord[] = [];
  const concluded: Rig["concluded"] = [];
  const followUps: Rig["followUps"] = [];
  const verdicts: Rig["verdicts"] = [];
  const alerts: Rig["alerts"] = [];
  const mutations: Rig["mutations"] = [];
  const stallChecks: Rig["stallChecks"] = [];
  const counters = { cleared: 0, notified: 0 };
  const snap = snapshot();
  if (options.disapproved) snap.ads[1] = { ...snap.ads[1], approvalStatus: "DISAPPROVED" };
  const engineSettings = options.settings ?? settings({ heartbeat_at: options.heartbeat === undefined ? "2026-10-20T14:00:00.000Z" : options.heartbeat });
  const repository: WorkerRepository = {
    expireProposals: async () => 2,
    readSettings: async () => engineSettings,
    readSnapshot: async () => snap,
    listApplicableProposals: async () => options.auto ?? [],
    listRunningTests: async () => options.tests ?? [],
    adArmMetrics: async (adIds) =>
      Object.fromEntries(adIds.map((id) => [id, options.arms?.[id] ?? { impressions: 0, clicks: 0, conversions: 0 }])),
    recordTestStats: async (id, state, stats) => {
      concluded.push({ id, state, stats });
    },
    openWorkerProposal: async (input) => {
      followUps.push(input as unknown as Record<string, unknown>);
      return `wwwwwwww-wwww-4www-8www-${String(followUps.length).padStart(12, "0")}`;
    },
    linkTestProposal: async () => {},
    listPendingChanges: async () => options.changes ?? [],
    entityMetrics: async (change, window) =>
      options.entityMetrics ? options.entityMetrics(change, window) : { impressions: 2000, clicks: 60, conversions: 1 },
    setChangeVerdict: async (id, verdict, pre, post) => {
      verdicts.push({ id, verdict, pre, post });
    },
    raiseAlert: async (alert) => {
      alerts.push(alert);
      return true;
    },
    notify: async () => {
      counters.notified += 3;
      return 3;
    },
    checkStall: async (_operator, staleHours, campaignsLive) => {
      stallChecks.push({ staleHours, campaignsLive });
      return false;
    },
    clearStall: async () => {
      counters.cleared += 1;
      return 1;
    },
  };
  const deps: WorkerDependencies = {
    repository,
    now: () => NOW,
    operator: options.operator === null ? null : OPERATOR,
    apply:
      options.apply === null
        ? null
        : async (proposal) => {
            applied.push(proposal);
            return options.applyOutcome
              ? options.applyOutcome(proposal)
              : { state: "applied", validation: { results: [], failures: [] }, resourceNames: ["x"], label: "gen-x", changeId: "c", testId: null };
          },
    gateway:
      options.gateway === null
        ? null
        : {
            customerId: async () => "4454506598",
            mutate: async (operations, opts) => {
              mutations.push({ operations, validateOnly: opts.validateOnly });
              return { results: operations.map(() => ({ adGroupAdResult: { resourceName: "x" } })), failures: [] };
            },
          },
    readBudgetPacing: options.pacing === undefined ? null : options.pacing === null ? null : async () => options.pacing as PacingRow[],
  };
  return {
    deps,
    applied,
    concluded,
    followUps,
    verdicts,
    alerts,
    mutations,
    stallChecks,
    get cleared() {
      return counters.cleared;
    },
    get notified() {
      return counters.notified;
    },
  };
}

describe("runEngineTick", () => {
  it("expires proposals, notifies, and checks the stall rule with the live-campaign signal", async () => {
    const r = rig();
    const result = await runEngineTick(r.deps);
    expect(result.expired).toBe(2);
    expect(result.notified).toBe(3);
    expect(r.stallChecks).toEqual([{ staleHours: 50, campaignsLive: true }]);
    // The heartbeat is an hour old: any open stall alarm is cleared.
    expect(r.cleared).toBe(1);
  });

  it("does not clear the stall alarm while the routine is still silent", async () => {
    const r = rig({ heartbeat: "2026-10-17T14:00:00.000Z" });
    await runEngineTick(r.deps);
    expect(r.cleared).toBe(0);
  });

  it("reports a dark account to the stall check so silence before launch is never an alarm", async () => {
    const r = rig();
    const snap = snapshot();
    for (const campaign of snap.campaigns) campaign.status = "PAUSED";
    r.deps.repository.readSnapshot = async () => snap;
    await runEngineTick(r.deps);
    expect(r.stallChecks[0].campaignsLive).toBe(false);
  });

  it("skips the rail entirely without an operator", async () => {
    const r = rig({ operator: null });
    const result = await runEngineTick(r.deps);
    expect(result.notified).toBe(0);
    expect(r.stallChecks).toEqual([]);
  });

  it("applies auto-mode proposals whose kind is still auto, skips human-only kinds and flipped-back kinds", async () => {
    const r = rig({
      settings: settings({ modes: { ...settings().modes, add_negatives: "auto", pause_keyword: "propose", adjust_budget: "auto" } }),
      auto: [
        autoProposal(),
        autoProposal({ id: "pppppppp-pppp-4ppp-8ppp-000000000002", kind: "pause_keyword", target: "keyword:x", payload: {} }),
        autoProposal({ id: "pppppppp-pppp-4ppp-8ppp-000000000003", kind: "adjust_budget", target: "budget:x", payload: {} }),
      ],
    });
    const result = await runEngineTick(r.deps);
    expect(r.applied.map((p) => p.kind)).toEqual(["add_negatives"]);
    expect(result.autoApplied).toBe(1);
    expect(result.autoSkipped).toBe(2);
  });

  it("applies a proposal Jackson approved whatever its kind or mode, so a timed-out review still lands", async () => {
    const r = rig({
      auto: [autoProposal({ id: "pppppppp-pppp-4ppp-8ppp-000000000004", kind: "adjust_budget", target: "budget:x", state: "approved", mode_at_submit: "propose", payload: {} })],
    });
    const result = await runEngineTick(r.deps);
    expect(r.applied.map((p) => p.id)).toEqual(["pppppppp-pppp-4ppp-8ppp-000000000004"]);
    expect(result.autoApplied).toBe(1);
  });

  it("raises ADS CHANGE FAILED when an auto apply fails, once per proposal", async () => {
    const r = rig({
      settings: settings({ modes: { ...settings().modes, add_negatives: "auto" } }),
      auto: [autoProposal()],
      applyOutcome: () => ({ state: "failed", validation: null, error: "POLICY_FINDING@0: Trademark", policyTopics: ["TRADEMARKS"] }),
    });
    const result = await runEngineTick(r.deps);
    expect(result.autoFailed).toBe(1);
    expect(r.alerts).toEqual([
      expect.objectContaining({
        kind: "apply_failed",
        dedupeKey: `ads-engine:apply-failed:${autoProposal().id}`,
        title: "ADS CHANGE FAILED",
        persistent: true,
      }),
    ]);
    expect(r.alerts[0].body).toMatch(/Trademark/);
  });

  it("leaves auto proposals waiting when Google cannot be reached", async () => {
    const r = rig({ settings: settings({ modes: { ...settings().modes, add_negatives: "auto" } }), auto: [autoProposal()], apply: null });
    const result = await runEngineTick(r.deps);
    expect(result.autoSkipped).toBe(1);
    expect(result.autoApplied).toBe(0);
  });

  it("concludes a test the challenger won and opens the promotion proposal in propose mode", async () => {
    const r = rig({
      settings: settings({ modes: { ...settings().modes, promote_challenger: "auto" } }),
      tests: [runningTest()],
      arms: { "201": { impressions: 4000, clicks: 120, conversions: 1 }, "202": { impressions: 4000, clicks: 170, conversions: 1 } },
    });
    const result = await runEngineTick(r.deps);
    expect(result.testsConcluded).toBe(1);
    expect(r.concluded[0]).toMatchObject({ state: "challenger_won" });
    expect(r.concluded[0].stats).toMatchObject({ days: 27, control: { clicks: 120 }, challenger: { clicks: 170 } });
    expect(r.followUps).toEqual([
      expect.objectContaining({
        kind: "promote_challenger",
        target: `test:${runningTest().id}`,
        // Never auto-promote in v1, whatever the settings say.
        mode: "propose",
        payload: expect.objectContaining({ winner: R.jmChallenger, loser: R.jmControl, adGroup: R.jobManagement, campaign: R.core, test_id: runningTest().id }),
      }),
    ]);
  });

  it("retires the losing challenger through a pause proposal when the control wins", async () => {
    const r = rig({
      settings: settings({ modes: { ...settings().modes, pause_ad: "auto" } }),
      tests: [runningTest()],
      arms: { "201": { impressions: 4000, clicks: 170, conversions: 1 }, "202": { impressions: 4000, clicks: 120, conversions: 1 } },
    });
    await runEngineTick(r.deps);
    expect(r.concluded[0].state).toBe("control_won");
    expect(r.followUps).toEqual([
      expect.objectContaining({ kind: "pause_ad", target: `ad:${R.jmChallenger}`, mode: "auto", payload: expect.objectContaining({ ad: R.jmChallenger }) }),
    ]);
  });

  it("records interim stats on a test that is still running and opens nothing", async () => {
    const r = rig({
      tests: [runningTest({ started_at: "2026-10-12T15:00:00.000Z" })],
      arms: { "201": { impressions: 900, clicks: 30, conversions: 0 }, "202": { impressions: 900, clicks: 40, conversions: 0 } },
    });
    const result = await runEngineTick(r.deps);
    expect(result.testsConcluded).toBe(0);
    expect(r.concluded[0]).toMatchObject({ state: "running", stats: { days: 5 } });
    expect(r.followUps).toEqual([]);
  });

  it("computes change verdicts over the matched pre and post windows once the post window has closed", async () => {
    const seen: Array<{ from: string; to: string }> = [];
    const r = rig({
      changes: [pendingChange()],
      entityMetrics: (_change, window) => {
        seen.push(window);
        return window.from === "2026-09-06" ? { impressions: 2000, clicks: 60, conversions: 1 } : { impressions: 2000, clicks: 72, conversions: 1 };
      },
    });
    const result = await runEngineTick(r.deps);
    expect(result.verdicts).toBe(1);
    // Pre = the fourteen days before the change landed (the applied day excluded); post = the ledger's window.
    expect(seen).toEqual([
      { from: "2026-09-06", to: "2026-09-19" },
      { from: "2026-09-21", to: "2026-10-04" },
    ]);
    expect(r.verdicts[0]).toMatchObject({ id: pendingChange().id, verdict: "better" });
    expect(r.verdicts[0].post).toMatchObject({ ctr: 0.036, deltaPct: 20 });
  });

  it("pauses a disapproved ad with validateOnly first and raises AD DISAPPROVED", async () => {
    const r = rig({ disapproved: true });
    const result = await runEngineTick(r.deps);
    expect(result.disapproved).toBe(1);
    expect(r.mutations.map((m) => m.validateOnly)).toEqual([true, false]);
    expect(r.mutations[0].operations).toEqual([
      { adGroupAdOperation: { update: { resourceName: R.jmChallenger, status: "PAUSED" }, updateMask: "status" } },
    ]);
    expect(r.alerts).toEqual([
      expect.objectContaining({ kind: "ad_disapproved", dedupeKey: `ads-engine:disapproved:${R.jmChallenger}`, title: "AD DISAPPROVED", persistent: true }),
    ]);
    expect(r.alerts[0].body).toMatch(/paused it/);
  });

  it("still raises AD DISAPPROVED when Google cannot be reached to pause the ad", async () => {
    const r = rig({ disapproved: true, gateway: null });
    await runEngineTick(r.deps);
    expect(r.mutations).toEqual([]);
    expect(r.alerts[0].body).toMatch(/could not pause/);
  });

  it("raises ADS BUDGET PACING when a campaign is capped three days running, and not for two", async () => {
    const capped = (campaignId: string, dates: string[], share = 0.45): PacingRow[] =>
      dates.map((date) => ({ date, campaignId, campaignName: campaignId === "11" ? "CORE · CA" : "COMPETITOR · CA", lostShare: share }));
    const r = rig({
      pacing: [...capped("11", ["2026-10-15", "2026-10-16", "2026-10-17"]), ...capped("13", ["2026-10-16", "2026-10-17"]), ...capped("99", ["2026-10-15", "2026-10-16", "2026-10-17"])],
    });
    const result = await runEngineTick(r.deps);
    expect(result.pacing).toBe(1);
    expect(r.alerts).toEqual([
      expect.objectContaining({ kind: "budget_pacing", dedupeKey: "ads-engine:pacing:11:2026-10-17", title: "ADS BUDGET PACING", persistent: false }),
    ]);
    expect(r.alerts[0].body).toMatch(/CORE · CA/);
  });
});

describe("changeScope", () => {
  it("measures money changes on the campaign, negatives on the account, and the rest on the ad group", () => {
    expect(changeScope(pendingChange())).toEqual({ level: "campaign", id: "11" });
    expect(changeScope(pendingChange({ kind: "add_negatives", campaign_id: null }))).toEqual({ level: "account", id: null });
    expect(changeScope(pendingChange({ kind: "pause_keyword", ad_group_id: "21" }))).toEqual({ level: "ad_group", id: "21" });
    expect(changeScope(pendingChange({ kind: "add_ad_group", ad_group_id: null, resource_names: ["customers/1/adGroups/777", "customers/1/adGroupCriteria/777~1"] }))).toEqual({ level: "ad_group", id: "777" });
  });
});
