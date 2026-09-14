import { describe, expect, it } from "vitest";
import {
  challengerConflict,
  livePairs,
  pairTest,
  staleTests,
  testEndedByPause,
  untrackedPairs,
} from "@/lib/ads/engine/pairs";
import type { GuardrailPause } from "@/lib/ads/engine/disapprovals";
import type { EntitySnapshot, TestRecord } from "@/lib/ads/engine/types";
import { R, snapshot, tests } from "./fixtures";

const C = "customers/4454506598";

function test(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
    campaign_id: "13",
    ad_group_id: "31",
    ad_group_name: "Jobber alternative",
    control_ad_id: "204",
    challenger_ad_id: "205",
    started_at: "2026-10-12T15:00:00.000Z",
    min_days: 14,
    min_impressions: 2000,
    max_days: 56,
    state: "running",
    stats: null,
    verdict_at: null,
    ...overrides,
  };
}

function held(adResourceName: string, policyTopics: string[], state: "holding" | "paused" = "paused"): GuardrailPause {
  return {
    id: "9f0c1f4e-8f1a-4c8b-9a51-2b1d5e3c7a10",
    ad_resource_name: adResourceName,
    ad_id: adResourceName.split("~").pop() ?? "",
    ad_group_resource_name: R.jobberAlternative,
    ad_group_name: "Jobber alternative",
    campaign_resource_name: R.competitor,
    state,
    policy_topics: policyTopics,
    observed_at: "2026-10-18T14:59:20.000Z",
    pause_requested_at: state === "paused" ? "2026-10-19T14:59:28.900Z" : null,
    paused_at: state === "paused" ? "2026-10-19T14:59:29.400Z" : null,
    pause_error: null,
  };
}

function withAd(snap: EntitySnapshot, resourceName: string, patch: Partial<EntitySnapshot["ads"][number]>): EntitySnapshot {
  return { ...snap, ads: snap.ads.map((ad) => (ad.resourceName === resourceName ? { ...ad, ...patch } : ad)) };
}

/** The shape phase 2 left in every non-brand group on 2026-09-11: the retired challenger paused, the approved one enabled. */
function swappedGroup(): EntitySnapshot {
  const snap = snapshot();
  const retired = snap.ads.find((ad) => ad.resourceName === R.jaChallenger)!;
  return {
    ...snap,
    ads: [
      ...snap.ads.map((ad) => (ad.resourceName === R.jaChallenger ? { ...ad, status: "PAUSED" as const } : ad)),
      { ...retired, resourceName: `${C}/adGroupAds/31~209`, id: "209", status: "ENABLED", labels: ["engine", "role-challenger"] },
    ],
  };
}

describe("which ad pairs are live", () => {
  it("finds every engine group with one enabled control and one enabled challenger, and ignores a paused challenger beside them", () => {
    const pairs = livePairs(snapshot(), []);
    expect(pairs.map((pair) => [pair.adGroup.name, pair.control.id, pair.challenger.id])).toEqual([
      ["Job management", "201", "202"],
      ["Jobber alternative", "204", "205"],
      ["Brand", "206", "207"],
    ]);
    expect(pairs[0].campaign.id).toBe("11");
  });

  it("pairs the control with the challenger the blueprint approved, not the one it retired", () => {
    const pair = livePairs(swappedGroup(), []).find((p) => p.adGroup.id === "31");
    expect(pair?.challenger.id).toBe("209");
  });

  it("is not a pair when the group runs two challengers, because a test has one of each", () => {
    const snap = snapshot();
    const extra = { ...snap.ads.find((ad) => ad.resourceName === R.jmChallenger)!, resourceName: `${C}/adGroupAds/21~210`, id: "210" };
    const twoChallengers = { ...snap, ads: [...snap.ads, extra] };
    expect(livePairs(twoChallengers, []).map((pair) => pair.adGroup.id)).not.toContain("21");
  });

  it("is not a pair while the guardrail holds either ad paused, whatever the snapshot still says", () => {
    expect(livePairs(snapshot(), [held(R.jaChallenger, ["TRADEMARKS_IN_AD_TEXT"])]).map((pair) => pair.adGroup.id)).not.toContain("31");
    expect(livePairs(snapshot(), [held(R.jaControl, ["DESTINATION_NOT_WORKING"])]).map((pair) => pair.adGroup.id)).not.toContain("31");
    // Holding is not paused: the ad still runs.
    expect(livePairs(snapshot(), [held(R.jaChallenger, ["DESTINATION_NOT_WORKING"], "holding")]).map((pair) => pair.adGroup.id)).toContain("31");
  });

  it("never pairs ads outside the engine's campaigns", () => {
    const snap = snapshot();
    snap.campaigns = snap.campaigns.map((c) => (c.resourceName === R.brand ? { ...c, labels: [] } : c));
    expect(livePairs(snap, []).map((pair) => pair.adGroup.id)).not.toContain("41");
    const legacy = snapshot();
    legacy.campaigns = legacy.campaigns.map((c) => (c.resourceName === R.brand ? { ...c, kind: "legacy" as const, labels: ["engine", "legacy"] } : c));
    expect(livePairs(legacy, []).map((pair) => pair.adGroup.id)).not.toContain("41");
  });
});

describe("which live pairs no test is judging", () => {
  it("is every live pair when no test exists — the twelve phase 2 groups on 2026-09-11", () => {
    const untracked = untrackedPairs(livePairs(snapshot(), []), []);
    expect(untracked.map((pair) => [pair.adGroup.id, pair.since])).toEqual([
      ["21", null],
      ["31", null],
      ["41", null],
    ]);
  });

  it("leaves a group whose test is running, and a pair that already has a verdict", () => {
    // tests(): 21 challenger_won, 31 running, 41 control_won.
    expect(untrackedPairs(livePairs(snapshot(), []), tests())).toEqual([]);
  });

  it("judges a pair again after its test was cancelled, from the day after the cancellation", () => {
    const cancelled = test({ ad_group_id: "21", control_ad_id: "201", challenger_ad_id: "202", state: "cancelled", verdict_at: "2026-10-05T15:00:00.000Z" });
    const earlier = test({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10", ad_group_id: "21", control_ad_id: "201", challenger_ad_id: "202", state: "cancelled", verdict_at: "2026-09-20T15:00:00.000Z" });
    const untracked = untrackedPairs(livePairs(snapshot(), []), [earlier, cancelled]);
    expect(untracked.find((pair) => pair.adGroup.id === "21")?.since).toBe("2026-10-06");
  });

  it("never judges the same pair twice once it has a verdict, even after a later cancellation", () => {
    const verdict = test({ ad_group_id: "21", control_ad_id: "201", challenger_ad_id: "202", state: "no_verdict", verdict_at: "2026-09-01T15:00:00.000Z" });
    const cancelled = test({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10", ad_group_id: "21", control_ad_id: "201", challenger_ad_id: "202", state: "cancelled", verdict_at: "2026-10-05T15:00:00.000Z" });
    expect(untrackedPairs(livePairs(snapshot(), []), [verdict, cancelled]).map((pair) => pair.adGroup.id)).not.toContain("21");
  });

  it("judges a new challenger even when the control beat an earlier one", () => {
    const earlier = test({ state: "control_won", verdict_at: "2026-10-01T15:00:00.000Z" });
    expect(untrackedPairs(livePairs(swappedGroup(), []), [earlier]).map((pair) => [pair.adGroup.id, pair.challenger.id, pair.since])).toContainEqual(["31", "209", null]);
  });
});

describe("the test OPS opens for a pair", () => {
  it("starts at the beginning of the first account day both ads served, so the verdict window opens the day after", () => {
    const pair = untrackedPairs(livePairs(snapshot(), []), [])[0];
    expect(pairTest(pair, "2026-10-01")).toEqual({
      campaign_id: "11",
      ad_group_id: "21",
      ad_group_name: "Job management",
      control_ad_id: "201",
      challenger_ad_id: "202",
      proposal_id: null,
      label: null,
      // Midnight in Vancouver (permanent UTC-7), where the warehouse dates its days.
      started_at: "2026-10-01T07:00:00.000Z",
    });
  });
});

describe("tests that can no longer finish", () => {
  const running = [test()];

  it("keeps a test whose two ads are enabled", () => {
    expect(staleTests({ running, snapshot: snapshot(), pauses: [] })).toEqual([]);
  });

  it("cancels a test whose ad was paused by anything but the guardrail — the blueprint retiring it, a hand edit", () => {
    expect(staleTests({ running, snapshot: withAd(snapshot(), R.jaChallenger, { status: "PAUSED" }), pauses: [] })).toEqual([
      { test: running[0], reason: "The challenger was paused outside the test." },
    ]);
    expect(staleTests({ running, snapshot: withAd(snapshot(), R.jaControl, { status: "PAUSED" }), pauses: [] })).toEqual([
      { test: running[0], reason: "The control was paused outside the test." },
    ]);
  });

  it("cancels a test whose ad is gone from the account", () => {
    const snap = snapshot();
    snap.ads = snap.ads.filter((ad) => ad.resourceName !== R.jaChallenger);
    expect(staleTests({ running, snapshot: snap, pauses: [] })).toEqual([{ test: running[0], reason: "The challenger is no longer in the account." }]);
  });

  it("cancels a test whose challenger the guardrail paused for its copy, so a replacement can be written", () => {
    const snap = withAd(snapshot(), R.jaChallenger, { status: "PAUSED" });
    expect(staleTests({ running, snapshot: snap, pauses: [held(R.jaChallenger, ["TRADEMARKS_IN_AD_TEXT"])] })).toEqual([
      { test: running[0], reason: "Google disapproved the challenger for trademarks in ad text." },
    ]);
  });

  it("keeps a test through a landing-page hold, which the guardrail undoes once Google approves the ad", () => {
    const snap = withAd(snapshot(), R.jaChallenger, { status: "PAUSED" });
    expect(staleTests({ running, snapshot: snap, pauses: [held(R.jaChallenger, ["DESTINATION_NOT_WORKING"])] })).toEqual([]);
  });

  it("keeps a test whose control the guardrail holds, so the challenger can still earn its verdict", () => {
    const snap = withAd(snapshot(), R.jaControl, { status: "PAUSED" });
    expect(staleTests({ running, snapshot: snap, pauses: [held(R.jaControl, ["TRADEMARKS_IN_AD_TEXT"])] })).toEqual([]);
  });

  it("cannot judge a test whose ad group is missing from the snapshot, and leaves it alone", () => {
    const snap = snapshot();
    snap.adGroups = snap.adGroups.filter((group) => group.resourceName !== R.jobberAlternative);
    snap.ads = snap.ads.filter((ad) => ad.adGroupResourceName !== R.jobberAlternative);
    expect(staleTests({ running, snapshot: snap, pauses: [] })).toEqual([]);
  });

  it("ends a running test when the guardrail pauses its challenger for a copy verdict, and only then", () => {
    expect(testEndedByPause(test(), "205", ["TRADEMARKS_IN_AD_TEXT"])).toBe(true);
    expect(testEndedByPause(test(), "205", ["DESTINATION_NOT_WORKING"])).toBe(false);
    expect(testEndedByPause(test(), "204", ["TRADEMARKS_IN_AD_TEXT"])).toBe(false);
    expect(testEndedByPause(test({ state: "control_won" }), "205", ["TRADEMARKS_IN_AD_TEXT"])).toBe(false);
  });
});

describe("an approved challenger meets an account that moved on", () => {
  it("is clear when the group still has the approved control and no challenger", () => {
    expect(challengerConflict(snapshot(), { adGroupResourceName: R.crewScheduling, adGroupName: "Crew scheduling", controlAdId: "203" })).toBeNull();
  });

  it("refuses a second challenger in a group that already runs one", () => {
    expect(challengerConflict(snapshot(), { adGroupResourceName: R.jobManagement, adGroupName: "Job management", controlAdId: "201" })).toBe(
      "Job management already runs a challenger. Nothing changed in Google."
    );
  });

  it("refuses when the control it was written against is no longer the group's enabled control", () => {
    expect(challengerConflict(snapshot(), { adGroupResourceName: R.crewScheduling, adGroupName: "Crew scheduling", controlAdId: "999" })).toBe(
      "Crew scheduling has a new control since you approved this. Nothing changed in Google."
    );
    expect(
      challengerConflict(withAd(snapshot(), R.csControl, { status: "PAUSED" }), { adGroupResourceName: R.crewScheduling, adGroupName: "Crew scheduling", controlAdId: "203" })
    ).toBe("Crew scheduling has a new control since you approved this. Nothing changed in Google.");
  });
});
