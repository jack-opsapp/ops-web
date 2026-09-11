/**
 * The disapproved-ad guardrail inside the daily worker tick (design spec §5.6).
 *
 * The 2026-09-10 incident is the first scenario: Google's stale
 * DESTINATION_NOT_WORKING verdict on 22 ads that were fine. The rest pin the
 * restore path's rule — OPS switches an ad back on only when the pause is
 * provably its own and nothing else has claimed the ad since.
 */
import { describe, expect, it } from "vitest";
import {
  runEngineTick,
  type EngineAlert,
  type GuardrailReader,
  type WorkerDependencies,
  type WorkerRepository,
} from "@/lib/ads/engine/worker";
import type { MutateOperation, MutateResult } from "@/lib/ads/engine/apply";
import {
  alertKeys,
  type AdChangeEvent,
  type EngineAdDecision,
  type GuardrailPause,
  type GuardrailState,
  type LiveAdState,
} from "@/lib/ads/engine/disapprovals";
import type { EngineSettings, EntitySnapshot, TestRecord } from "@/lib/ads/engine/types";
import { NOW, R, settings, snapshot } from "./fixtures";

const OPERATOR = { userId: "operator", companyId: "11111111-1111-4111-8111-111111111111" };
const PAUSE_ID = "5d2c7a1e-3b4f-4c6d-8e9f-0a1b2c3d4e5f";
const DNW = [{ topic: "DESTINATION_NOT_WORKING", type: "PROHIBITED" }];
const TRADEMARK = [{ topic: "TRADEMARKS_IN_AD_TEXT", type: "PROHIBITED" }];
const API_USER = "firebase-adminsdk-fbsvc@ops-ios-app.iam.gserviceaccount.com";

function live(
  resourceName: string,
  status: string,
  approvalStatus: string,
  policyTopics: LiveAdState["policyTopics"] = [],
  reviewStatus = "REVIEWED"
): LiveAdState {
  return { resourceName, status, approvalStatus, reviewStatus, policyTopics };
}

function openPause(overrides: Partial<GuardrailPause> = {}): GuardrailPause {
  return {
    id: PAUSE_ID,
    ad_resource_name: R.jmChallenger,
    ad_id: "202",
    ad_group_resource_name: R.jobManagement,
    ad_group_name: "Job management",
    campaign_resource_name: R.core,
    state: "paused",
    policy_topics: ["TRADEMARKS_IN_AD_TEXT"],
    observed_at: "2026-10-18T14:59:20.000Z",
    pause_requested_at: "2026-10-18T14:59:28.900Z",
    paused_at: "2026-10-18T14:59:29.400Z",
    pause_error: null,
    ...overrides,
  };
}

/** The guardrail's own commit, as Google's change history shows it. */
function ownPause(resourceName: string = R.jmChallenger): AdChangeEvent {
  return {
    micros: Date.parse("2026-10-18T14:59:29.290Z") * 1000,
    resourceName,
    operation: "UPDATE",
    changedFields: ["ad", "status"],
    clientType: "GOOGLE_ADS_API",
    userEmail: API_USER,
    oldStatus: "ENABLED",
    newStatus: "PAUSED",
  };
}

function disapprovedIn(resourceName: string): EntitySnapshot {
  const snap = snapshot();
  snap.ads = snap.ads.map((ad) => (ad.resourceName === resourceName ? { ...ad, approvalStatus: "DISAPPROVED" } : ad));
  return snap;
}

type StoredPause = Omit<GuardrailPause, "state"> & {
  state: GuardrailState;
  close_reason: string | null;
  pause_request_id: string | null;
  restore_request_id: string | null;
  policy_entries: unknown[];
};

interface RigOptions {
  snapshot?: EntitySnapshot;
  settings?: EngineSettings;
  tests?: TestRecord[];
  open?: GuardrailPause[];
  live?: LiveAdState[] | "throws" | null;
  history?: { events: AdChangeEvent[]; truncated: boolean } | "throws";
  decisions?: EngineAdDecision[];
  retired?: string[] | null;
  mutate?: (operations: MutateOperation[], options: { validateOnly: boolean; partialFailure?: boolean }) => MutateResult;
  rehearsal?: boolean;
}

function rig(o: RigOptions = {}) {
  const store = new Map<string, StoredPause>();
  for (const pause of o.open ?? [])
    store.set(pause.id, { ...pause, close_reason: null, pause_request_id: null, restore_request_id: null, policy_entries: [] });
  const mutations: Array<{ operations: MutateOperation[]; validateOnly: boolean; partialFailure: boolean | undefined }> = [];
  const alerts: EngineAlert[] = [];
  const resolved: string[] = [];
  const reads: string[][] = [];
  const windows: Array<{ start: string; end: string }> = [];
  const counters = { refreshed: 0, opened: 0 };
  const openRows = () => [...store.values()].filter((p) => p.state === "holding" || p.state === "paused");

  const repository: WorkerRepository = {
    expireProposals: async () => 0,
    readSettings: async () => o.settings ?? settings(),
    readSnapshot: async () => o.snapshot ?? snapshot(),
    listApplicableProposals: async () => [],
    listRunningTests: async () => o.tests ?? [],
    adArmMetrics: async () => ({}),
    recordTestStats: async () => {},
    openWorkerProposal: async () => null,
    linkTestProposal: async () => {},
    listPendingChanges: async () => [],
    entityMetrics: async () => ({ impressions: 0, clicks: 0, conversions: 0 }),
    setChangeVerdict: async () => {},
    raiseAlert: async (alert) => {
      alerts.push(alert);
      return true;
    },
    notify: async () => 0,
    checkStall: async () => false,
    clearStall: async () => 0,
    listOpenGuardrailPauses: async () => openRows().map((row) => ({ ...row }) as GuardrailPause),
    openGuardrailPause: async (input) => {
      if (openRows().some((row) => row.ad_resource_name === input.ad_resource_name)) return null;
      counters.opened += 1;
      const id = `00000000-0000-4000-8000-${String(counters.opened).padStart(12, "0")}`;
      const row: StoredPause = {
        ...input,
        id,
        state: "holding",
        pause_requested_at: null,
        paused_at: null,
        pause_error: null,
        close_reason: null,
        pause_request_id: null,
        restore_request_id: null,
      };
      store.set(id, row);
      return { ...row } as GuardrailPause;
    },
    markGuardrailPaused: async (id, input) => {
      Object.assign(store.get(id)!, {
        state: "paused",
        pause_requested_at: input.pauseRequestedAt,
        paused_at: input.pausedAt,
        pause_request_id: input.requestId,
        policy_topics: input.topics,
        policy_entries: input.entries,
        pause_error: null,
      });
    },
    recordGuardrailPauseError: async (id, error) => {
      store.get(id)!.pause_error = error;
    },
    closeGuardrailPause: async (id, outcome) => {
      Object.assign(store.get(id)!, { state: outcome.state, close_reason: outcome.reason, restore_request_id: outcome.requestId ?? null });
    },
    listEngineAdDecisions: async () => o.decisions ?? [],
    resolveAlerts: async (keys) => {
      resolved.push(...keys);
      return keys.length;
    },
    refreshSnapshot: async () => {
      counters.refreshed += 1;
    },
  };

  const reader: GuardrailReader | null =
    o.live === null
      ? null
      : {
          readAdStates: async (names) => {
            reads.push([...names]);
            if (o.live === "throws") throw new Error("Google Ads API error (503): unavailable");
            return (o.live ?? []).filter((state) => names.includes(state.resourceName));
          },
          readAdChanges: async (start, end) => {
            windows.push({ start, end });
            if (o.history === "throws") throw new Error("Google Ads API error (500): internal");
            return o.history ?? { events: [], truncated: false };
          },
        };

  const deps: WorkerDependencies = {
    repository,
    now: () => NOW,
    operator: OPERATOR,
    apply: null,
    gateway: {
      customerId: async () => "4454506598",
      mutate: async (operations, options) => {
        mutations.push({ operations, validateOnly: options.validateOnly, partialFailure: options.partialFailure });
        if (o.mutate) return o.mutate(operations, options);
        return {
          results: operations.map(() => ({ adGroupAdResult: { resourceName: "x" } })),
          failures: [],
          requestId: options.validateOnly ? "validate-req" : "real-req",
        };
      },
    },
    reader,
    retiredAdIds: o.retired === null ? null : new Set(o.retired ?? []),
    rehearsal: o.rehearsal ?? false,
    readBudgetPacing: null,
  };

  return {
    deps,
    store,
    mutations,
    alerts,
    resolved,
    reads,
    windows,
    get refreshed() {
      return counters.refreshed;
    },
  };
}

const statusOp = (resourceName: string, status: "PAUSED" | "ENABLED") => [
  { adGroupAdOperation: { update: { resourceName, status }, updateMask: "status" } },
];

describe("the guardrail on a fresh disapproval", () => {
  it("replays 2026-09-10: a landing-page verdict is held for a day, not paused, and nothing is alerted", async () => {
    const r = rig({ snapshot: disapprovedIn(R.jmChallenger), live: [live(R.jmChallenger, "ENABLED", "DISAPPROVED", DNW)] });
    const result = await runEngineTick(r.deps);
    expect(result).toMatchObject({ held: 1, disapproved: 0, restored: 0, released: 0, guardrail: "checked" });
    expect(r.mutations).toEqual([]);
    expect(r.alerts).toEqual([]);
    expect([...r.store.values()]).toEqual([
      expect.objectContaining({
        ad_resource_name: R.jmChallenger,
        ad_id: "202",
        ad_group_resource_name: R.jobManagement,
        ad_group_name: "Job management",
        campaign_resource_name: R.core,
        state: "holding",
        policy_topics: ["DESTINATION_NOT_WORKING"],
        policy_entries: DNW,
        observed_at: NOW.toISOString(),
      }),
    ]);
    expect(r.refreshed).toBe(0);
  });

  it("and lets it go the next morning when Google has approved the ad, still without a word", async () => {
    const r = rig({
      open: [openPause({ state: "holding", policy_topics: ["DESTINATION_NOT_WORKING"], observed_at: "2026-10-19T15:04:00.000Z", pause_requested_at: null, paused_at: null })],
      live: [live(R.jmChallenger, "ENABLED", "APPROVED")],
    });
    const result = await runEngineTick(r.deps);
    expect(result).toMatchObject({ released: 1, disapproved: 0 });
    expect(r.store.get(PAUSE_ID)).toMatchObject({ state: "released", close_reason: "cleared_before_pause" });
    expect(r.mutations).toEqual([]);
    expect(r.alerts).toEqual([]);
  });

  it("keeps holding a landing-page verdict until twenty hours have passed", async () => {
    const r = rig({
      open: [openPause({ state: "holding", policy_topics: ["DESTINATION_NOT_WORKING"], observed_at: "2026-10-20T13:05:00.000Z", pause_requested_at: null, paused_at: null })],
      live: [live(R.jmChallenger, "ENABLED", "DISAPPROVED", DNW)],
    });
    await runEngineTick(r.deps);
    expect(r.store.get(PAUSE_ID)?.state).toBe("holding");
    expect(r.mutations).toEqual([]);
    expect(r.alerts).toEqual([]);
  });

  it("pauses a landing-page verdict still standing at the next daily check, records why, and alerts once", async () => {
    const r = rig({
      open: [openPause({ state: "holding", policy_topics: ["DESTINATION_NOT_WORKING"], observed_at: "2026-10-19T15:04:00.000Z", pause_requested_at: null, paused_at: null })],
      live: [live(R.jmChallenger, "ENABLED", "DISAPPROVED", DNW)],
    });
    const result = await runEngineTick(r.deps);
    expect(result).toMatchObject({ disapproved: 1, held: 0 });
    expect(r.mutations).toEqual([
      { operations: statusOp(R.jmChallenger, "PAUSED"), validateOnly: true, partialFailure: false },
      { operations: statusOp(R.jmChallenger, "PAUSED"), validateOnly: false, partialFailure: false },
    ]);
    expect(r.store.get(PAUSE_ID)).toMatchObject({
      state: "paused",
      pause_requested_at: NOW.toISOString(),
      paused_at: NOW.toISOString(),
      pause_request_id: "real-req",
      policy_topics: ["DESTINATION_NOT_WORKING"],
      policy_entries: DNW,
    });
    expect(r.alerts).toEqual([
      {
        kind: "ad_disapproved",
        dedupeKey: alertKeys.paused(PAUSE_ID),
        title: "AD DISAPPROVED",
        // The routine is running, but a new ad on the same page would fail the
        // same way, so the only honest next step is the page or an appeal.
        body: "Google says the landing page for an ad in Job management is not working. OPS paused the ad and turns it back on once Google approves it. If the page loads, appeal in Google Ads.",
        persistent: true,
      },
    ]);
    expect(r.refreshed).toBe(1);
  });

  it("pauses any other verdict at once, with its policy topics on the record", async () => {
    const r = rig({
      snapshot: disapprovedIn(R.jmChallenger),
      settings: settings({ heartbeat_at: null }),
      live: [live(R.jmChallenger, "ENABLED", "DISAPPROVED", TRADEMARK)],
    });
    const result = await runEngineTick(r.deps);
    expect(result).toMatchObject({ disapproved: 1, held: 0 });
    const [row] = [...r.store.values()];
    expect(row).toMatchObject({ state: "paused", policy_topics: ["TRADEMARKS_IN_AD_TEXT"], policy_entries: TRADEMARK, pause_request_id: "real-req" });
    expect(r.alerts).toEqual([
      {
        kind: "ad_disapproved",
        dedupeKey: alertKeys.paused(row.id),
        title: "AD DISAPPROVED",
        // The routine has never checked in, so nothing promises a replacement.
        body: "Google disapproved an ad in Job management for trademarks in ad text. OPS paused it and turns it back on once Google approves it.",
        persistent: true,
      },
    ]);
  });

  it("promises a replacement for a copy verdict while the routine is running and the group can take one", async () => {
    const r = rig({ snapshot: disapprovedIn(R.jmChallenger), live: [live(R.jmChallenger, "ENABLED", "DISAPPROVED", TRADEMARK)] });
    await runEngineTick(r.deps);
    expect(r.alerts.map((a) => a.body)).toEqual([
      "Google disapproved an ad in Job management for trademarks in ad text. OPS paused it and turns it back on once Google approves it. The engine writes a replacement for your review on its next run.",
    ]);
  });

  it("never promises a replacement for a control, which no challenger can be tested against", async () => {
    const r = rig({ snapshot: disapprovedIn(R.jmControl), live: [live(R.jmControl, "ENABLED", "DISAPPROVED", TRADEMARK)] });
    await runEngineTick(r.deps);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].body).not.toMatch(/replacement/);
  });

  it("decides on Google's live verdict, not the warehouse copy", async () => {
    const r = rig({ snapshot: disapprovedIn(R.jmChallenger), live: [live(R.jmChallenger, "ENABLED", "APPROVED")] });
    const result = await runEngineTick(r.deps);
    expect(r.reads).toEqual([[R.jmChallenger]]);
    expect(r.store.size).toBe(0);
    expect(r.mutations).toEqual([]);
    expect(result.guardrail).toBe("checked");
  });

  it("never looks at ads outside the engine's campaigns", async () => {
    const snap = snapshot();
    snap.ads.push({ ...snap.ads[0], resourceName: "customers/4454506598/adGroupAds/91~901", id: "901", adGroupResourceName: R.legacyGroup, approvalStatus: "DISAPPROVED" });
    const r = rig({ snapshot: snap, live: [live("customers/4454506598/adGroupAds/91~901", "ENABLED", "DISAPPROVED", TRADEMARK)] });
    const result = await runEngineTick(r.deps);
    expect(result.guardrail).toBe("idle");
    expect(r.reads).toEqual([]);
    expect(r.store.size).toBe(0);
  });

  it("raises a failed-pause alert when Google refuses, and the next check pauses it and clears that alert", async () => {
    const refused = rig({
      snapshot: disapprovedIn(R.jmChallenger),
      live: [live(R.jmChallenger, "ENABLED", "DISAPPROVED", TRADEMARK)],
      mutate: (operations) => ({ results: operations.map(() => ({})), failures: [{ index: 0, code: "RESOURCE_NOT_FOUND", message: "gone" }] }),
    });
    const first = await runEngineTick(refused.deps);
    const [row] = [...refused.store.values()];
    expect(first.disapproved).toBe(0);
    expect(refused.mutations.map((m) => m.validateOnly)).toEqual([true]);
    expect(row).toMatchObject({ state: "holding", pause_error: "RESOURCE_NOT_FOUND" });
    expect(refused.alerts).toEqual([
      {
        kind: "ad_disapproved",
        dedupeKey: alertKeys.pauseFailed(row.id),
        title: "AD DISAPPROVED",
        body: "Google disapproved an ad in Job management for trademarks in ad text. OPS could not pause it (RESOURCE_NOT_FOUND) and tries again tomorrow.",
        persistent: true,
      },
    ]);

    const retried = rig({
      open: [openPause({ state: "holding", pause_error: "RESOURCE_NOT_FOUND", pause_requested_at: null, paused_at: null })],
      live: [live(R.jmChallenger, "ENABLED", "DISAPPROVED", TRADEMARK)],
    });
    const second = await runEngineTick(retried.deps);
    expect(second.disapproved).toBe(1);
    expect(retried.resolved).toContain(alertKeys.pauseFailed(PAUSE_ID));
    expect(retried.alerts.map((a) => a.dedupeKey)).toEqual([alertKeys.paused(PAUSE_ID)]);
  });
});

describe("the guardrail on an ad it paused", () => {
  it("switches it back on once Google approves it — validateOnly first, then real, partial failure off — clears its alerts, and says so once", async () => {
    const r = rig({
      open: [openPause()],
      live: [live(R.jmChallenger, "PAUSED", "APPROVED")],
      history: { events: [ownPause()], truncated: false },
    });
    const result = await runEngineTick(r.deps);
    expect(result).toMatchObject({ restored: 1, released: 0, disapproved: 0 });
    expect(r.windows).toEqual([{ start: "2026-10-17", end: "2026-10-21" }]);
    expect(r.mutations).toEqual([
      { operations: statusOp(R.jmChallenger, "ENABLED"), validateOnly: true, partialFailure: false },
      { operations: statusOp(R.jmChallenger, "ENABLED"), validateOnly: false, partialFailure: false },
    ]);
    expect(r.store.get(PAUSE_ID)).toMatchObject({ state: "restored", close_reason: "restored", restore_request_id: "real-req" });
    expect(r.resolved).toEqual(expect.arrayContaining(alertKeys.ofPause(PAUSE_ID)));
    expect(r.alerts).toEqual([
      {
        kind: "ad_restored",
        dedupeKey: alertKeys.restored([PAUSE_ID]),
        title: "AD BACK ON",
        body: "Google approved the ad OPS paused in Job management. OPS switched it back on.",
        persistent: false,
      },
    ]);
    expect(r.refreshed).toBe(1);
  });

  it("never switches on an ad the blueprint retired, and closes the episode quietly", async () => {
    const r = rig({ open: [openPause()], live: [live(R.jmChallenger, "PAUSED", "APPROVED")], history: { events: [ownPause()], truncated: false }, retired: ["202"] });
    const result = await runEngineTick(r.deps);
    expect(result.released).toBe(1);
    expect(r.store.get(PAUSE_ID)).toMatchObject({ state: "released", close_reason: "retired_by_blueprint" });
    expect(r.mutations).toEqual([]);
    expect(r.windows).toEqual([]);
    expect(r.resolved).toEqual(expect.arrayContaining(alertKeys.ofPause(PAUSE_ID)));
    expect(r.alerts).toEqual([]);
  });

  it("waits while an engine decision about the ad is pending review, and lets go once one lands", async () => {
    const pending: EngineAdDecision = { id: "d1", kind: "create_rsa_challenger", state: "proposed", payload: { ad_group: R.jobManagement }, created_at: "2026-10-19T15:10:00.000Z", applied_at: null };
    const waiting = rig({ open: [openPause()], live: [live(R.jmChallenger, "PAUSED", "APPROVED")], history: { events: [ownPause()], truncated: false }, decisions: [pending] });
    await runEngineTick(waiting.deps);
    expect(waiting.store.get(PAUSE_ID)?.state).toBe("paused");
    expect(waiting.mutations).toEqual([]);

    const landed = rig({
      open: [openPause()],
      live: [live(R.jmChallenger, "PAUSED", "APPROVED")],
      history: { events: [ownPause()], truncated: false },
      decisions: [{ ...pending, kind: "pause_ad", state: "applied", payload: { ad: R.jmChallenger }, applied_at: "2026-10-19T15:20:00.000Z" }],
    });
    await runEngineTick(landed.deps);
    expect(landed.store.get(PAUSE_ID)).toMatchObject({ state: "released", close_reason: "engine_decision" });
    expect(landed.mutations).toEqual([]);
  });

  it("never switches on an ad someone changed after OPS paused it", async () => {
    const later: AdChangeEvent = { ...ownPause(), micros: Date.parse("2026-10-19T18:00:00.000Z") * 1000, clientType: "GOOGLE_ADS_WEB_CLIENT", userEmail: "person@example.com", oldStatus: "PAUSED", newStatus: "PAUSED" };
    const r = rig({ open: [openPause()], live: [live(R.jmChallenger, "PAUSED", "APPROVED")], history: { events: [ownPause(), later], truncated: false } });
    await runEngineTick(r.deps);
    expect(r.store.get(PAUSE_ID)).toMatchObject({ state: "released", close_reason: "changed_elsewhere" });
    expect(r.mutations).toEqual([]);
  });

  it("waits when Google's history cannot vouch for the pause: own commit missing, history cut short, or unreadable", async () => {
    for (const history of [{ events: [], truncated: false }, { events: [ownPause()], truncated: true }, "throws" as const]) {
      const r = rig({ open: [openPause()], live: [live(R.jmChallenger, "PAUSED", "APPROVED")], history });
      const result = await runEngineTick(r.deps);
      expect(r.store.get(PAUSE_ID)?.state).toBe("paused");
      expect(r.mutations).toEqual([]);
      expect(result.restored + result.released).toBe(0);
    }
  });

  it("lets go of a pause older than Google's change history, because it can no longer be proved", async () => {
    const r = rig({
      open: [openPause({ observed_at: "2026-09-10T14:59:20.000Z", pause_requested_at: "2026-09-10T14:59:28.900Z", paused_at: "2026-09-10T14:59:29.400Z" })],
      live: [live(R.jmChallenger, "PAUSED", "APPROVED")],
    });
    await runEngineTick(r.deps);
    expect(r.store.get(PAUSE_ID)).toMatchObject({ state: "released", close_reason: "unverifiable" });
    expect(r.windows).toEqual([]);
    expect(r.mutations).toEqual([]);
  });

  it("lets go when someone switched the ad back on, removed it, or it is gone from the account", async () => {
    const onAgain = openPause();
    const removed = openPause({ id: "6e3d8b2f-4c5a-4d7e-9f0a-1b2c3d4e5f60", ad_resource_name: R.csControl, ad_id: "203", ad_group_resource_name: R.crewScheduling, ad_group_name: "Crew scheduling" });
    const gone = openPause({ id: "7f4e9c3a-5d6b-4e8f-8a1b-2c3d4e5f6071", ad_resource_name: R.jaControl, ad_id: "204", ad_group_resource_name: R.jobberAlternative, ad_group_name: "Jobber alternative", campaign_resource_name: R.competitor });
    const r = rig({
      open: [onAgain, removed, gone],
      live: [live(R.jmChallenger, "ENABLED", "APPROVED"), live(R.csControl, "REMOVED", "APPROVED")],
    });
    const result = await runEngineTick(r.deps);
    expect(result.released).toBe(3);
    expect(r.store.get(onAgain.id)?.close_reason).toBe("changed_elsewhere");
    expect(r.store.get(removed.id)?.close_reason).toBe("ad_gone");
    expect(r.store.get(gone.id)?.close_reason).toBe("ad_gone");
    expect(r.mutations).toEqual([]);
    expect(r.alerts).toEqual([]);
  });

  it("keeps the pause while the verdict stands or an appeal is still open", async () => {
    for (const state of [live(R.jmChallenger, "PAUSED", "DISAPPROVED", TRADEMARK), live(R.jmChallenger, "PAUSED", "DISAPPROVED", TRADEMARK, "UNDER_APPEAL")]) {
      const r = rig({ open: [openPause()], live: [state], history: { events: [ownPause()], truncated: false } });
      await runEngineTick(r.deps);
      expect(r.store.get(PAUSE_ID)?.state).toBe("paused");
      expect(r.mutations).toEqual([]);
      expect(r.alerts).toEqual([]);
    }
  });

  it("switches nothing on while the blueprint's retire list cannot be read", async () => {
    const r = rig({ open: [openPause()], live: [live(R.jmChallenger, "PAUSED", "APPROVED")], history: { events: [ownPause()], truncated: false }, retired: null });
    await runEngineTick(r.deps);
    expect(r.store.get(PAUSE_ID)?.state).toBe("paused");
    expect(r.mutations).toEqual([]);
  });

  it("raises AD STILL PAUSED when Google refuses the restore, and keeps the episode open to try again", async () => {
    const r = rig({
      open: [openPause()],
      live: [live(R.jmChallenger, "PAUSED", "APPROVED")],
      history: { events: [ownPause()], truncated: false },
      mutate: (operations, options) =>
        options.validateOnly
          ? { results: operations.map(() => ({})), failures: [] }
          : { results: operations.map(() => ({})), failures: [{ index: 0, code: "ACTION_NOT_PERMITTED", message: "no" }] },
    });
    const result = await runEngineTick(r.deps);
    expect(result.restored).toBe(0);
    expect(r.store.get(PAUSE_ID)?.state).toBe("paused");
    expect(r.alerts).toEqual([
      {
        kind: "ad_restored",
        dedupeKey: alertKeys.restoreFailed(PAUSE_ID),
        title: "AD STILL PAUSED",
        body: "Google approved the ad OPS paused in Job management. OPS could not switch it back on (ACTION_NOT_PERMITTED) and tries again tomorrow.",
        persistent: true,
      },
    ]);
  });
});

describe("the guardrail when it cannot see", () => {
  it("does nothing it cannot verify when Google cannot be read", async () => {
    for (const reader of [null, "throws" as const]) {
      const r = rig({ snapshot: disapprovedIn(R.jmChallenger), open: [openPause()], live: reader });
      const result = await runEngineTick(r.deps);
      expect(result.guardrail).toBe("unavailable");
      expect(r.store.size).toBe(1);
      expect(r.store.get(PAUSE_ID)?.state).toBe("paused");
      expect(r.mutations).toEqual([]);
      expect(r.alerts).toEqual([]);
    }
  });

  it("stays idle and reads nothing when no ad is disapproved and nothing is paused", async () => {
    const r = rig();
    const result = await runEngineTick(r.deps);
    expect(result).toMatchObject({ guardrail: "idle", held: 0, disapproved: 0, restored: 0, released: 0 });
    expect(r.reads).toEqual([]);
  });

  it("in rehearsal only validates with Google and changes nothing it owns", async () => {
    const r = rig({
      snapshot: disapprovedIn(R.jmChallenger),
      open: [openPause({ ad_resource_name: R.csControl, ad_id: "203", ad_group_resource_name: R.crewScheduling, ad_group_name: "Crew scheduling" })],
      live: [live(R.jmChallenger, "ENABLED", "DISAPPROVED", TRADEMARK), live(R.csControl, "PAUSED", "APPROVED")],
      history: { events: [ownPause(R.csControl)], truncated: false },
      rehearsal: true,
    });
    const result = await runEngineTick(r.deps);
    expect(r.mutations.length).toBeGreaterThan(0);
    expect(r.mutations.every((m) => m.validateOnly)).toBe(true);
    expect(r.store.get(PAUSE_ID)?.state).toBe("paused");
    expect([...r.store.values()].find((row) => row.ad_resource_name === R.jmChallenger)?.state).toBe("holding");
    expect(r.alerts).toEqual([]);
    expect(result).toMatchObject({ disapproved: 0, restored: 0 });
    expect(r.refreshed).toBe(0);
  });
});
