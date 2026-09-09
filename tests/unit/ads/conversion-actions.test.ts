/**
 * Conversion-action planner + idempotent setup (Task 3 of the Google Ads
 * engine, phase 1). The planner is pure: the live list of conversion actions
 * in, mutate operations out. `ensureConversionActions` is exercised with
 * injected transport + repository fakes so no network or database is needed.
 */
import { describe, it, expect, vi } from "vitest";
import {
  planConversionActionOperations,
  ensureConversionActions,
  OPS_CONVERSION_ACTION_TARGETS,
  type ExistingConversionAction,
} from "@/lib/ads/conversion-actions";
import type { MutateResult } from "@/lib/analytics/google-ads-client";

const CUSTOMER = "customers/4454506598";

function existing(
  over: Partial<ExistingConversionAction> & { id: string; name: string }
): ExistingConversionAction {
  return {
    resourceName: `${CUSTOMER}/conversionActions/${over.id}`,
    type: "WEBPAGE",
    category: "SIGNUP",
    status: "ENABLED",
    primaryForGoal: true,
    includeInConversionsMetric: true,
    countingType: "MANY_PER_CLICK",
    clickThroughLookbackWindowDays: 30,
    ...over,
  };
}

/** The live account on 2026-09-09 (probe artifact), non-REMOVED actions only. */
const LIVE_ACCOUNT: ExistingConversionAction[] = [
  existing({ id: "7035851989", name: "Ops App (web) purchase", type: "GOOGLE_ANALYTICS_4_PURCHASE", category: "PURCHASE", status: "HIDDEN", primaryForGoal: false, includeInConversionsMetric: false, clickThroughLookbackWindowDays: 90 }),
  existing({ id: "7048105860", name: "Join Ops SIgnup" }),
  existing({ id: "7049099216", name: "Homepage Signup" }),
  existing({ id: "7049322928", name: "Quiz Signup v2" }),
  existing({ id: "7395116875", name: "OPS APP First open", type: "FIREBASE_IOS_FIRST_OPEN", category: "DOWNLOAD", countingType: "ONE_PER_CLICK" }),
  existing({ id: "7395296151", name: "ops-ios-app - co.opsapp.ops.OPS (iOS) sign_up", type: "FIREBASE_IOS_CUSTOM", clickThroughLookbackWindowDays: 90 }),
  existing({ id: "7395299889", name: "ops-ios-app - co.opsapp.ops.OPS (iOS) login", type: "FIREBASE_IOS_CUSTOM", clickThroughLookbackWindowDays: 90 }),
  // Hidden Android twins: inert, never touched.
  existing({ id: "7547589501", name: "ops-ios-app - co.opsapp.ops (Android) sign_up", type: "FIREBASE_ANDROID_CUSTOM", status: "HIDDEN", clickThroughLookbackWindowDays: 90 }),
  existing({ id: "7547589504", name: "ops-ios-app - co.opsapp.ops (Android) login", type: "FIREBASE_ANDROID_CUSTOM", category: "DEFAULT", status: "HIDDEN", clickThroughLookbackWindowDays: 90 }),
];

/** The three OPS actions exactly as the planner wants them, as live rows. */
function opsActionsAsLive(): ExistingConversionAction[] {
  return OPS_CONVERSION_ACTION_TARGETS.map((t, i) => ({
    resourceName: `${CUSTOMER}/conversionActions/${9000 + i}`,
    id: String(9000 + i),
    name: t.name,
    type: t.type,
    category: t.category,
    status: t.status,
    primaryForGoal: t.primaryForGoal,
    includeInConversionsMetric: t.includeInConversionsMetric,
    countingType: t.countingType,
    clickThroughLookbackWindowDays: t.clickThroughLookbackWindowDays,
  }));
}

describe("planConversionActionOperations", () => {
  it("creates the three OPS actions when none exist", () => {
    const ops = planConversionActionOperations([]);
    expect(ops.map((o) => o.conversionActionOperation.create?.name)).toEqual([
      "OPS · Trial started",
      "OPS · Trial activated",
      "OPS · Paid subscription",
    ]);
    expect(ops[0].conversionActionOperation.create).toMatchObject({
      type: "UPLOAD_CLICKS",
      category: "SIGNUP",
      primaryForGoal: true,
      countingType: "ONE_PER_CLICK",
      clickThroughLookbackWindowDays: 30,
      status: "ENABLED",
    });
    expect(ops[1].conversionActionOperation.create).toMatchObject({
      category: "QUALIFIED_LEAD",
      primaryForGoal: false,
      clickThroughLookbackWindowDays: 30,
    });
    expect(ops[2].conversionActionOperation.create).toMatchObject({
      category: "SUBSCRIBE_PAID",
      primaryForGoal: false,
      clickThroughLookbackWindowDays: 90,
    });
    // Read-only on Google's side (IMMUTABLE_FIELD): never sent.
    for (const op of ops) {
      expect(op.conversionActionOperation.create).not.toHaveProperty("includeInConversionsMetric");
    }
  });

  it("is idempotent once the actions exist with the right settings", () => {
    expect(planConversionActionOperations(opsActionsAsLive())).toEqual([]);
  });

  it("repairs a drifted OPS action with a minimal update mask", () => {
    const live = opsActionsAsLive();
    live[0] = { ...live[0], primaryForGoal: false, status: "HIDDEN" };
    const ops = planConversionActionOperations(live);
    expect(ops).toHaveLength(1);
    expect(ops[0].conversionActionOperation.update).toEqual({
      resourceName: live[0].resourceName,
      primaryForGoal: true,
      status: "ENABLED",
    });
    expect(ops[0].conversionActionOperation.updateMask).toBe("primaryForGoal,status");
  });

  it("demotes the Firebase iOS actions and removes the Bubble-era ones", () => {
    const ops = planConversionActionOperations(LIVE_ACCOUNT);
    const creates = ops.filter((o) => o.conversionActionOperation.create);
    const updates = ops.filter((o) => o.conversionActionOperation.update);
    const removes = ops.filter((o) => o.conversionActionOperation.remove);

    expect(creates.map((o) => o.conversionActionOperation.create?.name)).toEqual([
      "OPS · Trial started",
      "OPS · Trial activated",
      "OPS · Paid subscription",
    ]);
    expect(updates.map((o) => o.conversionActionOperation.update?.resourceName).sort()).toEqual(
      ["7395116875", "7395296151", "7395299889"].map((id) => `${CUSTOMER}/conversionActions/${id}`)
    );
    for (const op of updates) {
      expect(op.conversionActionOperation.update).toEqual({
        resourceName: op.conversionActionOperation.update?.resourceName,
        primaryForGoal: false,
      });
      expect(op.conversionActionOperation.updateMask).toBe("primaryForGoal");
    }
    expect(removes.map((o) => o.conversionActionOperation.remove).sort()).toEqual(
      ["7048105860", "7049099216", "7049322928"].map((id) => `${CUSTOMER}/conversionActions/${id}`)
    );
    // Hidden twins and the GA4 purchase action are untouched.
    const touched = [...updates, ...removes].map(
      (o) => o.conversionActionOperation.update?.resourceName ?? o.conversionActionOperation.remove
    );
    expect(touched).not.toContain(`${CUSTOMER}/conversionActions/7547589501`);
    expect(touched).not.toContain(`${CUSTOMER}/conversionActions/7547589504`);
    expect(touched).not.toContain(`${CUSTOMER}/conversionActions/7035851989`);
    expect(ops).toHaveLength(9);
  });

  it("is idempotent after the demotions and removals have landed", () => {
    // includeInConversionsMetric is whatever Google derives; it never drives a plan.
    const after = [
      ...opsActionsAsLive(),
      existing({ id: "7395116875", name: "OPS APP First open", type: "FIREBASE_IOS_FIRST_OPEN", category: "DOWNLOAD", countingType: "ONE_PER_CLICK", primaryForGoal: false, includeInConversionsMetric: true }),
      existing({ id: "7395296151", name: "ops-ios-app - co.opsapp.ops.OPS (iOS) sign_up", type: "FIREBASE_IOS_CUSTOM", primaryForGoal: false, includeInConversionsMetric: false }),
      existing({ id: "7395299889", name: "ops-ios-app - co.opsapp.ops.OPS (iOS) login", type: "FIREBASE_IOS_CUSTOM", primaryForGoal: false, includeInConversionsMetric: false }),
    ];
    expect(planConversionActionOperations(after)).toEqual([]);
  });

  it("never touches unknown actions", () => {
    const ops = planConversionActionOperations([
      existing({ id: "1", name: "Website lead form" }),
      existing({ id: "2", name: "Newsletter signup", primaryForGoal: false }),
    ]);
    expect(ops).toHaveLength(3);
    expect(ops.every((o) => !!o.conversionActionOperation.create)).toBe(true);
  });
});

describe("ensureConversionActions", () => {
  function fakeDeps(opts: {
    listings: ExistingConversionAction[][];
    mutateResults?: MutateResult[];
  }) {
    const listings = [...opts.listings];
    const results = [...(opts.mutateResults ?? [])];
    const mutate = vi.fn(async () => results.shift() ?? { results: [], failures: [] });
    const listExisting = vi.fn(async () => listings.shift() ?? []);
    const recordActions = vi.fn(async () => {});
    return { mutate, listExisting, recordActions };
  }

  it("validateOnly plans, mutates once with validateOnly, and records nothing", async () => {
    const deps = fakeDeps({ listings: [[]] });
    const out = await ensureConversionActions({ validateOnly: true }, deps);
    expect(out.operations).toHaveLength(3);
    expect(deps.mutate).toHaveBeenCalledTimes(1);
    expect(deps.mutate.mock.calls[0][1]).toEqual({ validateOnly: true });
    expect(deps.recordActions).not.toHaveBeenCalled();
    expect(out.recorded).toEqual([]);
    expect(out.validated).toBe(true);
  });

  it("mutates nothing when the plan is empty but still re-records the ledger", async () => {
    // Self-healing: a lost ads_conversion_actions row is repaired by any re-run.
    const deps = fakeDeps({ listings: [opsActionsAsLive()] });
    const out = await ensureConversionActions({ validateOnly: false }, deps);
    expect(out.operations).toEqual([]);
    expect(deps.mutate).not.toHaveBeenCalled();
    expect(deps.recordActions).toHaveBeenCalledTimes(1);
    expect(out.recorded.map((r) => r.kind)).toEqual(["trial_started", "trial_activated", "paid"]);
    expect(out.unresolved).toEqual([]);
  });

  it("validateOnly with an empty plan touches nothing", async () => {
    const deps = fakeDeps({ listings: [opsActionsAsLive()] });
    const out = await ensureConversionActions({ validateOnly: true }, deps);
    expect(deps.mutate).not.toHaveBeenCalled();
    expect(deps.recordActions).not.toHaveBeenCalled();
    expect(out.recorded).toEqual([]);
  });

  it("validates first, then applies, then records the three OPS actions by name", async () => {
    const deps = fakeDeps({
      listings: [[], opsActionsAsLive()],
      mutateResults: [
        { results: [{}, {}, {}], failures: [], requestId: "validate-1" },
        { results: [{}, {}, {}], failures: [], requestId: "apply-1" },
      ],
    });
    const out = await ensureConversionActions({ validateOnly: false }, deps);
    // One validate pass, then one apply phase (the plan is creates only).
    expect(deps.mutate).toHaveBeenCalledTimes(2);
    expect(deps.mutate.mock.calls[0][1]).toEqual({ validateOnly: true });
    expect(deps.mutate.mock.calls[1][1]).toEqual({ validateOnly: false });
    expect(out.validated).toBe(true);
    expect(out.result.requestId).toBe("apply-1");
    expect(deps.recordActions).toHaveBeenCalledTimes(1);
    expect(out.recorded).toEqual([
      { kind: "trial_started", resourceName: `${CUSTOMER}/conversionActions/9000`, googleId: "9000", name: "OPS · Trial started" },
      { kind: "trial_activated", resourceName: `${CUSTOMER}/conversionActions/9001`, googleId: "9001", name: "OPS · Trial activated" },
      { kind: "paid", resourceName: `${CUSTOMER}/conversionActions/9002`, googleId: "9002", name: "OPS · Paid subscription" },
    ]);
  });

  it("applies creates, updates, and removes as separate phases and re-indexes failures", async () => {
    const deps = fakeDeps({
      listings: [LIVE_ACCOUNT, [...opsActionsAsLive()]],
      mutateResults: [
        { results: [{}, {}, {}, {}, {}, {}, {}, {}, {}], failures: [], requestId: "validate-3" },
        { results: [{ resourceName: "c1" }, { resourceName: "c2" }, { resourceName: "c3" }], failures: [], requestId: "creates" },
        { results: [{}, {}, {}], failures: [{ index: 1, code: "INTERNAL_ERROR", message: "x" }], requestId: "updates" },
        { results: [{}, {}, {}], failures: [], requestId: "removes" },
      ],
    });
    const out = await ensureConversionActions({ validateOnly: false }, deps);
    expect(deps.mutate).toHaveBeenCalledTimes(4);
    expect(deps.mutate.mock.calls[0][0]).toHaveLength(9);
    expect(deps.mutate.mock.calls[0][1]).toEqual({ validateOnly: true });
    const phases = deps.mutate.mock.calls.slice(1).map(([ops]) =>
      (ops as Array<{ conversionActionOperation: Record<string, unknown> }>).map((o) =>
        o.conversionActionOperation.create ? "create" : o.conversionActionOperation.update ? "update" : "remove"
      )
    );
    expect(phases).toEqual([
      ["create", "create", "create"],
      ["update", "update", "update"],
      ["remove", "remove", "remove"],
    ]);
    // The second update sits at position 4 in the original plan (3 creates first).
    expect(out.result.failures).toEqual([{ index: 4, code: "INTERNAL_ERROR", message: "x" }]);
    expect(out.result.results[0]).toEqual({ resourceName: "c1" });
    expect(out.result.requestId).toBe("removes");
    expect(out.recorded).toHaveLength(3);
  });

  it("refuses to apply when the validateOnly pass reports a failure", async () => {
    const deps = fakeDeps({
      listings: [[]],
      mutateResults: [
        { results: [{}, {}, {}], failures: [{ index: 2, code: "DUPLICATE_NAME", message: "dup" }], requestId: "validate-2" },
      ],
    });
    const out = await ensureConversionActions({ validateOnly: false }, deps);
    expect(deps.mutate).toHaveBeenCalledTimes(1);
    expect(out.validated).toBe(false);
    expect(out.result.failures).toHaveLength(1);
    expect(deps.recordActions).not.toHaveBeenCalled();
    expect(out.recorded).toEqual([]);
  });

  it("records only the kinds it can resolve after apply and reports the rest", async () => {
    const live = opsActionsAsLive().slice(0, 2); // paid never showed up
    const deps = fakeDeps({
      listings: [[], live],
      mutateResults: [
        { results: [{}, {}, {}], failures: [] },
        { results: [{}, {}, {}], failures: [] },
      ],
    });
    const out = await ensureConversionActions({ validateOnly: false }, deps);
    expect(out.recorded.map((r) => r.kind)).toEqual(["trial_started", "trial_activated"]);
    expect(out.unresolved).toEqual(["paid"]);
  });
});
