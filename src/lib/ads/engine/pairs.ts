/**
 * Google Ads engine — ad pairs and the tests that judge them (design spec §5.4).
 *
 * A test is one ad group, one control, one challenger, both enabled. The
 * engine's own challengers open their test when they are applied, but pairs
 * also come from places that open none: the blueprint builds a control and a
 * challenger in every group, an engine-built ad group arrives with two ads,
 * and a hand edit can add either. These rules keep one invariant across all
 * of them: every live pair is judged from the first day both ads served, a
 * test that can no longer finish is cancelled, and a group never gets a
 * second challenger while one is still in place.
 *
 * Pure. The worker supplies the snapshot, the tests, the guardrail's episodes
 * and the serving days.
 */
import { isTransient, policyReason, type GuardrailPause } from "./disapprovals";
import type { EntitySnapshot, SnapshotAd, SnapshotAdGroup, SnapshotCampaign, TestRecord } from "./types";

// Vancouver adopted permanent UTC-7 in March 2026; the warehouse dates its
// days in the account's time zone.
const VANCOUVER_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

type Episode = Pick<GuardrailPause, "ad_resource_name" | "state" | "policy_topics">;

export interface LivePair {
  campaign: SnapshotCampaign;
  adGroup: SnapshotAdGroup;
  control: SnapshotAd;
  challenger: SnapshotAd;
}

export interface UntrackedPair extends LivePair {
  /** The first account day a serving day may count from: the day after this pair's last cancelled test, or null. */
  since: string | null;
}

/** The `ads_tests` row for a pair nobody proposed: no proposal, no generation label. */
export interface NewPairTest {
  campaign_id: string;
  ad_group_id: string;
  ad_group_name: string;
  control_ad_id: string;
  challenger_ad_id: string;
  proposal_id: null;
  label: null;
  started_at: string;
}

function pausedByGuardrail(pauses: readonly Episode[]): Map<string, Episode> {
  return new Map(pauses.filter((pause) => pause.state === "paused").map((pause) => [pause.ad_resource_name, pause]));
}

function accountDay(iso: string): string {
  return new Date(Date.parse(iso) - VANCOUVER_OFFSET_MS).toISOString().slice(0, 10);
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10);
}

/**
 * Engine groups serving exactly one enabled control and one enabled
 * challenger. An ad the guardrail holds paused is not live whatever the
 * snapshot still says, and a group with two of either is not a pair.
 */
export function livePairs(snapshot: EntitySnapshot, pauses: readonly Episode[]): LivePair[] {
  const held = pausedByGuardrail(pauses);
  const pairs: LivePair[] = [];
  for (const adGroup of snapshot.adGroups) {
    const campaign = snapshot.campaigns.find((c) => c.resourceName === adGroup.campaignResourceName);
    if (!campaign || !campaign.labels.includes("engine") || campaign.kind === "legacy" || campaign.labels.includes("legacy")) continue;
    const live = snapshot.ads.filter((ad) => ad.adGroupResourceName === adGroup.resourceName && ad.status === "ENABLED" && !held.has(ad.resourceName));
    const controls = live.filter((ad) => ad.role === "control");
    const challengers = live.filter((ad) => ad.role === "challenger");
    if (controls.length === 1 && challengers.length === 1) pairs.push({ campaign, adGroup, control: controls[0], challenger: challengers[0] });
  }
  return pairs;
}

/**
 * The live pairs no test is judging. A group with a running test is judged
 * already; a pair that has had a verdict is never judged again — deciding
 * what happens to it is a proposal. A pair whose test was cancelled is judged
 * again, counting only from the day after that cancellation.
 */
export function untrackedPairs(pairs: readonly LivePair[], tests: readonly TestRecord[]): UntrackedPair[] {
  const untracked: UntrackedPair[] = [];
  for (const pair of pairs) {
    if (tests.some((t) => t.state === "running" && t.ad_group_id === pair.adGroup.id)) continue;
    const own = tests.filter((t) => t.control_ad_id === pair.control.id && t.challenger_ad_id === pair.challenger.id);
    if (own.some((t) => t.state !== "cancelled")) continue;
    const lastCancelled = own
      .map((t) => t.verdict_at)
      .filter((at): at is string => typeof at === "string")
      .sort()
      .pop();
    untracked.push({ ...pair, since: lastCancelled ? nextDay(accountDay(lastCancelled)) : null });
  }
  return untracked;
}

/**
 * The test for a pair, started at midnight of the first account day both ads
 * served. The verdict window opens the day after its start, as it does for a
 * challenger the engine applied, so every test measures whole shared days.
 */
export function pairTest(pair: LivePair, firstSharedDay: string): NewPairTest {
  return {
    campaign_id: pair.campaign.id,
    ad_group_id: pair.adGroup.id,
    ad_group_name: pair.adGroup.name,
    control_ad_id: pair.control.id,
    challenger_ad_id: pair.challenger.id,
    proposal_id: null,
    label: null,
    started_at: new Date(Date.parse(`${firstSharedDay}T00:00:00.000Z`) + VANCOUVER_OFFSET_MS).toISOString(),
  };
}

/**
 * Running tests that can no longer finish, with the reason. An ad the
 * guardrail holds keeps its test, because the guardrail switches it back on
 * once Google approves it — except a challenger held for its copy: Google
 * will not approve those words again, and ending the test is what lets a
 * replacement be written. A test whose ad group is missing from the snapshot
 * is left alone; an absent group says more about the snapshot than the test.
 */
export function staleTests(input: { running: readonly TestRecord[]; snapshot: EntitySnapshot; pauses: readonly Episode[] }): Array<{ test: TestRecord; reason: string }> {
  const held = pausedByGuardrail(input.pauses);
  const stale: Array<{ test: TestRecord; reason: string }> = [];
  for (const test of input.running) {
    if (test.state !== "running") continue;
    if (!input.snapshot.adGroups.some((group) => group.id === test.ad_group_id)) continue;
    for (const arm of ["control", "challenger"] as const) {
      const adId = arm === "control" ? test.control_ad_id : test.challenger_ad_id;
      const reason = armEnded(input.snapshot, held, arm, adId);
      if (reason) {
        stale.push({ test, reason });
        break;
      }
    }
  }
  return stale;
}

function armEnded(snapshot: EntitySnapshot, held: Map<string, Episode>, arm: "control" | "challenger", adId: string): string | null {
  const ad = snapshot.ads.find((candidate) => candidate.id === adId);
  if (!ad) return `The ${arm} is no longer in the account.`;
  const episode = held.get(ad.resourceName);
  if (episode) return arm === "challenger" && !isTransient(episode.policy_topics) ? disapprovedChallengerReason(episode.policy_topics) : null;
  return ad.status === "ENABLED" ? null : `The ${arm} was paused outside the test.`;
}

/** Why a test ended when Google disapproved its challenger's copy. */
export function disapprovedChallengerReason(topics: readonly string[]): string {
  return `Google disapproved the challenger for ${policyReason(topics)}.`;
}

/** Whether the guardrail pausing this ad ends the test: it is the running test's challenger, paused for its copy. */
export function testEndedByPause(test: TestRecord, adId: string, topics: readonly string[]): boolean {
  return test.state === "running" && test.challenger_ad_id === adId && !isTransient(topics);
}

/**
 * The last check before an approved challenger reaches Google: the group must
 * still have the control it was written against and no challenger of its own.
 * Days can pass between approval and apply, and a blueprint apply or a hand
 * edit can change the group in between.
 */
export function challengerConflict(snapshot: EntitySnapshot, input: { adGroupResourceName: string; adGroupName: string; controlAdId: string }): string | null {
  const ads = snapshot.ads.filter((ad) => ad.adGroupResourceName === input.adGroupResourceName && ad.status === "ENABLED");
  if (!ads.some((ad) => ad.role === "control" && ad.id === input.controlAdId))
    return `${input.adGroupName} has a new control since you approved this. Nothing changed in Google.`;
  if (ads.some((ad) => ad.role === "challenger")) return `${input.adGroupName} already runs a challenger. Nothing changed in Google.`;
  return null;
}
