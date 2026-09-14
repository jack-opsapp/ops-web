import { describe, expect, it } from "vitest";
import {
  changeScope,
  runEngineTick,
  type PacingRow,
  type WorkerDependencies,
  type WorkerRepository,
} from "@/lib/ads/engine/worker";
import type { ApplyOutcome, ApplyProposalRecord, MutateOperation } from "@/lib/ads/engine/apply";
import type { NewPairTest } from "@/lib/ads/engine/pairs";
import type { ChangeRecord, EngineSettings, EntitySnapshot, TestRecord } from "@/lib/ads/engine/types";
import { NOW, R, settings, snapshot, tests as fixtureTests } from "./fixtures";

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
  opened: NewPairTest[];
  servingQueries: Array<{ control: string; challenger: string; since: string | null }>;
  historyQueries: string[][];
  cancelled: Array<{ id: string; stats: Record<string, unknown>; at: string }>;
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
  pacing?: PacingRow[] | null;
  operator?: null;
  heartbeat?: string | null;
  snapshot?: EntitySnapshot;
  /** Every test for the pair groups, any state; defaults to the running list. */
  history?: TestRecord[];
  /** First shared serving day per `control:challenger`. */
  served?: Record<string, string>;
  /** The group already has a running test by the time the insert lands. */
  openConflict?: boolean;
} = {}): Rig {
  const applied: ApplyProposalRecord[] = [];
  const concluded: Rig["concluded"] = [];
  const followUps: Rig["followUps"] = [];
  const verdicts: Rig["verdicts"] = [];
  const alerts: Rig["alerts"] = [];
  const mutations: Rig["mutations"] = [];
  const stallChecks: Rig["stallChecks"] = [];
  const opened: Rig["opened"] = [];
  const servingQueries: Rig["servingQueries"] = [];
  const historyQueries: Rig["historyQueries"] = [];
  const cancelled: Rig["cancelled"] = [];
  const counters = { cleared: 0, notified: 0 };
  const snap = options.snapshot ?? snapshot();
  const engineSettings = options.settings ?? settings({ heartbeat_at: options.heartbeat === undefined ? "2026-10-20T14:00:00.000Z" : options.heartbeat });
  const repository: WorkerRepository = {
    expireProposals: async () => 2,
    readSettings: async () => engineSettings,
    readSnapshot: async () => snap,
    listApplicableProposals: async () => options.auto ?? [],
    listRunningTests: async () => (options.tests ?? []).filter((t) => !cancelled.some((c) => c.id === t.id)),
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
    // The guardrail has its own suite (worker-guardrail.test.ts); here it has nothing to guard.
    listOpenGuardrailPauses: async () => [],
    openGuardrailPause: async () => null,
    markGuardrailPaused: async () => {},
    recordGuardrailPauseError: async () => {},
    closeGuardrailPause: async () => {},
    listEngineAdDecisions: async () => [],
    resolveAlerts: async () => 0,
    refreshSnapshot: async () => {},
    listPairTests: async (adGroupIds) => {
      historyQueries.push([...adGroupIds]);
      return (options.history ?? options.tests ?? [])
        .filter((t) => adGroupIds.includes(t.ad_group_id))
        .map((t) => (cancelled.some((c) => c.id === t.id) ? { ...t, state: "cancelled" as const, verdict_at: cancelled.find((c) => c.id === t.id)!.at } : t));
    },
    firstSharedServingDay: async (control, challenger, since) => {
      servingQueries.push({ control, challenger, since });
      return options.served?.[`${control}:${challenger}`] ?? null;
    },
    openPairTest: async (test) => {
      if (options.openConflict) return null;
      opened.push(test);
      return `tttttttt-tttt-4ttt-8ttt-${String(opened.length).padStart(12, "0")}`;
    },
    cancelTest: async (id, stats, at) => {
      cancelled.push({ id, stats, at });
      return true;
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
    gateway: {
      customerId: async () => "4454506598",
      mutate: async (operations, opts) => {
        mutations.push({ operations, validateOnly: opts.validateOnly });
        return { results: operations.map(() => ({ adGroupAdResult: { resourceName: "x" } })), failures: [] };
      },
    },
    reader: null,
    retiredAdIds: new Set<string>(),
    rehearsal: false,
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
    opened,
    servingQueries,
    historyQueries,
    cancelled,
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

  it("leaves the disapproved-ad guardrail idle on a clean account", async () => {
    const r = rig();
    const result = await runEngineTick(r.deps);
    expect(result).toMatchObject({ guardrail: "idle", disapproved: 0, held: 0, restored: 0, released: 0 });
    expect(r.mutations).toEqual([]);
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

describe("every live ad pair is judged", () => {
  /** Job management (201/202), Jobber alternative (204/205) and Brand (206/207) each run an enabled pair. */
  it("opens a test for a pair nobody is judging, started on the first day both ads served", async () => {
    const r = rig({ tests: [], served: { "201:202": "2026-10-01" } });
    const result = await runEngineTick(r.deps);
    expect(r.historyQueries).toEqual([["21", "31", "41"]]);
    expect(r.servingQueries).toEqual([
      { control: "201", challenger: "202", since: null },
      { control: "204", challenger: "205", since: null },
      { control: "206", challenger: "207", since: null },
    ]);
    expect(r.opened).toEqual([
      {
        campaign_id: "11",
        ad_group_id: "21",
        ad_group_name: "Job management",
        control_ad_id: "201",
        challenger_ad_id: "202",
        proposal_id: null,
        label: null,
        started_at: "2026-10-01T07:00:00.000Z",
      },
    ]);
    expect(result.testsOpened).toBe(1);
  });

  it("opens nothing while the pairs have never served — the twelve phase 2 groups, campaigns paused", async () => {
    const paused = snapshot();
    paused.campaigns = paused.campaigns.map((c) => ({ ...c, status: "PAUSED" as const }));
    const r = rig({ tests: [], snapshot: paused });
    const result = await runEngineTick(r.deps);
    expect(r.servingQueries).toHaveLength(3);
    expect(r.opened).toEqual([]);
    expect(result).toMatchObject({ testsOpened: 0, testsCancelled: 0 });
  });

  it("never opens a second test for a pair that already has a verdict, nor beside a running one", async () => {
    // 21 challenger_won, 31 running, 41 control_won.
    const r = rig({ tests: fixtureTests().filter((t) => t.state === "running"), history: fixtureTests(), served: { "201:202": "2026-10-01", "206:207": "2026-08-01" } });
    const result = await runEngineTick(r.deps);
    expect(r.servingQueries).toEqual([]);
    expect(r.opened).toEqual([]);
    expect(result.testsOpened).toBe(0);
  });

  it("judges a pair again after its test was cancelled, counting from the day after", async () => {
    const cancelled = { ...fixtureTests()[0], state: "cancelled" as const, verdict_at: "2026-10-05T15:00:00.000Z" };
    const r = rig({ tests: [], history: [cancelled], served: { "201:202": "2026-10-09" } });
    await runEngineTick(r.deps);
    expect(r.servingQueries[0]).toEqual({ control: "201", challenger: "202", since: "2026-10-06" });
    expect(r.opened.map((t) => t.started_at)).toEqual(["2026-10-09T07:00:00.000Z"]);
  });

  it("counts a lost race to open a test as nothing opened, not a failure", async () => {
    const r = rig({ tests: [], served: { "201:202": "2026-10-01" }, openConflict: true });
    const result = await runEngineTick(r.deps);
    expect(result.testsOpened).toBe(0);
  });

  it("cancels a test whose challenger the blueprint retired before judging it, then judges the pair that replaced it", async () => {
    const retired = snapshot();
    retired.ads = [
      ...retired.ads.map((ad) => (ad.resourceName === R.jaChallenger ? { ...ad, status: "PAUSED" as const } : ad)),
      { ...retired.ads.find((ad) => ad.resourceName === R.jaChallenger)!, resourceName: "customers/4454506598/adGroupAds/31~209", id: "209", status: "ENABLED" as const },
    ];
    const test = runningTest({ campaign_id: "13", ad_group_id: "31", ad_group_name: "Jobber alternative", control_ad_id: "204", challenger_ad_id: "205", started_at: "2026-09-01T15:00:00.000Z", stats: { days: 40, p: 0.2 } });
    const r = rig({
      snapshot: retired,
      tests: [test],
      history: [test],
      // Enough for a verdict on the old pair, had it been judged.
      arms: { "204": { impressions: 5000, clicks: 100, conversions: 0 }, "205": { impressions: 5000, clicks: 200, conversions: 0 } },
      served: { "204:209": "2026-10-16" },
    });
    const result = await runEngineTick(r.deps);
    expect(r.cancelled).toEqual([{ id: test.id, stats: { days: 40, p: 0.2, reason: "The challenger was paused outside the test.", cancelled_at: NOW.toISOString() }, at: NOW.toISOString() }]);
    expect(r.concluded).toEqual([]);
    expect(r.followUps).toEqual([]);
    expect(r.opened.map((t) => [t.ad_group_id, t.control_ad_id, t.challenger_ad_id, t.started_at])).toEqual([["31", "204", "209", "2026-10-16T07:00:00.000Z"]]);
    expect(result).toMatchObject({ testsCancelled: 1, testsOpened: 1, testsConcluded: 0 });
  });
});
