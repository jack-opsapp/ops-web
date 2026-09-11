/**
 * Google Ads engine — the disapproved-ad guardrail's rules (design spec §5.6, §7).
 *
 * Pure. The worker (`worker.ts`) reads Google live and the ledger, then asks
 * these rules what to do: whether a verdict waits a tick, whether an ad OPS
 * paused is approved again, whether anything other than the guardrail has
 * decided the ad's fate since, and what the alert may truthfully say.
 *
 * The guardrail owns exactly the pauses it made. It records each one in
 * `ads_guardrail_pauses` with Google's policy topics, and it switches an ad
 * back on only when every one of these holds: Google's review is finished and
 * lets the ad serve; the blueprint does not retire the ad; no engine proposal
 * pauses it, promotes over it, or replaces it; and Google's change history
 * shows OPS's own pause as the last thing that happened to the ad.
 */
import { hash8 } from "./guardrails";
import type { EngineSettings, EntitySnapshot, TestRecord } from "./types";

/**
 * Verdicts that are often a crawl that failed once rather than a problem with
 * the ad. DESTINATION_NOT_WORKING is what stranded 22 ads on 2026-09-10: Google
 * cached the verdict before the landing pages were deployed and cleared it on
 * its own the next morning. A disapproved ad serves nothing, so holding the
 * pause for one daily check costs no money and no reach.
 */
export const TRANSIENT_POLICY_TOPICS: ReadonlySet<string> = new Set(["DESTINATION_NOT_WORKING"]);

/** A transient verdict still standing this long after the first sighting is acted on. Shorter than a day so the next daily check is the one that acts. */
export const DESTINATION_GRACE_HOURS = 20;

/** Google refuses a change_event read that starts more than 30 days back; one day of margin. */
export const CHANGE_HISTORY_DAYS = 29;

/** Slack around the guardrail's own pause when finding its commit in Google's history. */
export const OWN_COMMIT_TOLERANCE_MS = 60_000;

/** Finished-review verdicts under which Google serves the ad. */
export const SERVING_VERDICTS: ReadonlySet<string> = new Set(["APPROVED", "APPROVED_LIMITED", "AREA_OF_INTEREST_ONLY"]);

// Vancouver adopted permanent UTC-7 in March 2026; the account's change
// history is dated in America/Vancouver.
const VANCOUVER_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const ALERT_BODY_MAX = 600;
const NAME_MAX = 80;
const ERROR_MAX = 200;

export interface LiveAdState {
  resourceName: string;
  status: string;
  approvalStatus: string | null;
  reviewStatus: string | null;
  policyTopics: Array<{ topic: string; type: string | null }>;
}

export interface AdChangeEvent {
  /** UTC epoch microseconds of Google's commit. */
  micros: number;
  resourceName: string;
  operation: string;
  changedFields: string[];
  clientType: string | null;
  userEmail: string | null;
  oldStatus: string | null;
  newStatus: string | null;
}

export type GuardrailState = "holding" | "paused" | "restored" | "released";

/**
 * Why the guardrail let go of an episode without switching the ad back on:
 * the verdict cleared during the hold, the ad is gone, someone else changed
 * it, an engine decision now owns it, the blueprint retires it, or Google's
 * history no longer reaches back far enough to prove the pause was OPS's.
 */
export type ReleaseReason =
  | "cleared_before_pause"
  | "ad_gone"
  | "changed_elsewhere"
  | "engine_decision"
  | "retired_by_blueprint"
  | "unverifiable";

/** An open guardrail episode (`ads_guardrail_pauses` in state holding or paused). */
export interface GuardrailPause {
  id: string;
  ad_resource_name: string;
  ad_id: string;
  ad_group_resource_name: string;
  ad_group_name: string;
  campaign_resource_name: string;
  state: "holding" | "paused";
  policy_topics: string[];
  observed_at: string;
  pause_requested_at: string | null;
  paused_at: string | null;
  pause_error: string | null;
}

/** An engine proposal that decides an ad's fate: it pauses it, promotes over it, or replaces it. */
export interface EngineAdDecision {
  id: string;
  kind: "pause_ad" | "promote_challenger" | "create_rsa_challenger";
  state: "proposed" | "approved" | "applied";
  payload: Record<string, unknown>;
  created_at: string;
  applied_at: string | null;
}

export function isTransient(topics: readonly string[]): boolean {
  return topics.length > 0 && topics.every((topic) => TRANSIENT_POLICY_TOPICS.has(topic));
}

export function graceElapsed(observedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(observedAt) >= DESTINATION_GRACE_HOURS * 3_600_000;
}

export function isApprovedAgain(live: LiveAdState): boolean {
  return live.reviewStatus === "REVIEWED" && SERVING_VERDICTS.has(live.approvalStatus ?? "");
}

function decides(decision: EngineAdDecision, pause: GuardrailPause): boolean {
  switch (decision.kind) {
    case "pause_ad":
      return decision.payload.ad === pause.ad_resource_name;
    case "promote_challenger":
      return decision.payload.loser === pause.ad_resource_name;
    case "create_rsa_challenger":
      return decision.payload.ad_group === pause.ad_group_resource_name;
    default:
      return false;
  }
}

/**
 * Whether the engine has its own say over a paused ad. `applied` — a pause, a
 * promotion that retires it, or a challenger for its group landed after the
 * guardrail first saw the verdict: the ad belongs to that decision now.
 * `pending` — one waits on Jackson's review: switching the ad on could put a
 * third ad in the group or undo a pause he is about to approve. `none` — the
 * pause is the guardrail's alone.
 */
export function engineClaim(pause: GuardrailPause, decisions: readonly EngineAdDecision[]): "none" | "pending" | "applied" {
  let pending = false;
  for (const decision of decisions) {
    if (!decides(decision, pause)) continue;
    if (decision.state === "applied") {
      if (decision.applied_at && Date.parse(decision.applied_at) >= Date.parse(pause.observed_at)) return "applied";
      continue;
    }
    if (decision.state === "proposed" || decision.state === "approved") pending = true;
  }
  return pending ? "pending" : "none";
}

/**
 * Whether Google's change history proves the pause is still OPS's own. The
 * guardrail's commit is the status change to PAUSED inside the window it
 * recorded around its mutate. Every actor OPS has shares one service account,
 * so identity cannot separate them; time can — anything that touched the ad
 * after that commit (a person, a script, the blueprint) made a later decision.
 * `unknown` when the commit cannot be found: fail closed and look again.
 */
export function pauseProvenance(pause: GuardrailPause, events: readonly AdChangeEvent[]): "ours" | "touched" | "unknown" {
  if (!pause.pause_requested_at || !pause.paused_at) return "unknown";
  const from = (Date.parse(pause.pause_requested_at) - OWN_COMMIT_TOLERANCE_MS) * 1000;
  const to = (Date.parse(pause.paused_at) + OWN_COMMIT_TOLERANCE_MS) * 1000;
  const mine = events.filter((event) => event.resourceName === pause.ad_resource_name);
  const own = mine
    .filter((event) => event.newStatus === "PAUSED" && event.micros >= from && event.micros <= to)
    .sort((a, b) => b.micros - a.micros)[0];
  if (!own) return "unknown";
  return mine.some((event) => event.micros > own.micros) ? "touched" : "ours";
}

function vancouverDay(ms: number): string {
  return new Date(ms - VANCOUVER_OFFSET_MS).toISOString().slice(0, 10);
}

/** The account-local dates to read change history across: the day before the earliest pause through tomorrow, never further back than Google allows. */
export function changeWindow(pauses: readonly GuardrailPause[], now: Date): { startDate: string; endDate: string } {
  const today = now.getTime();
  const earliest = pauses.reduce(
    (min, pause) => Math.min(min, Date.parse(pause.pause_requested_at ?? pause.observed_at)),
    today
  );
  const start = vancouverDay(earliest - DAY_MS);
  const floor = vancouverDay(today - CHANGE_HISTORY_DAYS * DAY_MS);
  return { startDate: start < floor ? floor : start, endDate: vancouverDay(today + DAY_MS) };
}

/** Whether Google's change history still reaches back to this pause. */
export function withinChangeHistory(pause: GuardrailPause, now: Date): boolean {
  const at = pause.pause_requested_at ?? pause.observed_at;
  return vancouverDay(Date.parse(at)) >= vancouverDay(now.getTime() - CHANGE_HISTORY_DAYS * DAY_MS);
}

/**
 * Whether the routine will write a replacement for a paused ad. Mirrors what
 * the brief names in its creative duty and what the validator accepts: the
 * verdict is about the ad's copy (a landing-page verdict is not — a new ad on
 * the same page fails the same way), the campaign is a serving engine
 * campaign, the group serves, it still has an enabled control other than the
 * paused ad to test against, and no test is running there. `computeDuties`
 * calls this too, so the promise in the alert and the duty in the brief can
 * never disagree.
 */
export function replacementDue(input: {
  adResourceName: string;
  adGroupResourceName: string;
  policyTopics: readonly string[];
  snapshot: EntitySnapshot;
  tests: readonly TestRecord[];
}): boolean {
  if (isTransient(input.policyTopics)) return false;
  const group = input.snapshot.adGroups.find((g) => g.resourceName === input.adGroupResourceName);
  if (!group || group.status !== "ENABLED") return false;
  const campaign = input.snapshot.campaigns.find((c) => c.resourceName === group.campaignResourceName);
  if (!campaign || campaign.status !== "ENABLED" || !campaign.labels.includes("engine") || campaign.kind === "legacy") return false;
  if (input.tests.some((t) => t.state === "running" && t.ad_group_id === group.id)) return false;
  return input.snapshot.ads.some(
    (ad) => ad.adGroupResourceName === group.resourceName && ad.status === "ENABLED" && ad.role === "control" && ad.resourceName !== input.adResourceName
  );
}

/**
 * The ad ids the blueprint retires (`retire.adIds`), or null when the
 * blueprint cannot be read. Null, never an empty set: an unreadable retire
 * list must stop every restore, not clear them all.
 */
export function retiredAdIdsFrom(load: () => { retire: { adIds: readonly string[] } }): ReadonlySet<string> | null {
  try {
    return new Set(load().retire.adIds);
  } catch (error) {
    console.error("[ads-engine] guardrail: the blueprint cannot be read; nothing is switched back on", error);
    return null;
  }
}

/** Whether the routine is running: it checked in within the stall window and challengers are not switched off. */
export function routineActive(settings: EngineSettings, now: Date): boolean {
  if (settings.modes.create_rsa_challenger === "off" || !settings.heartbeat_at) return false;
  return now.getTime() - Date.parse(settings.heartbeat_at) < settings.stall_hours * 3_600_000;
}

// ─── Alert copy (through the OPS copywriter: plain, what happened, what next) ─

const TOPIC_WORDS: Record<string, string> = {
  DESTINATION_NOT_WORKING: "a landing page that is not working",
};

function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  if (items.length === 3) return `${items[0]}, ${items[1]} and ${items[2]}`;
  return `${items.slice(0, 3).join(", ")} and ${items.length - 3} more`;
}

/** Google's policy topics in plain words. */
export function policyReason(topics: readonly string[]): string {
  if (topics.length === 0) return "a policy issue";
  return list(topics.map((topic) => TOPIC_WORDS[topic] ?? topic.toLowerCase().replace(/_/g, " ")));
}

function name(value: string): string {
  return value.length > NAME_MAX ? `${value.slice(0, NAME_MAX - 1)}…` : value;
}

function reasonText(error: string): string {
  const flat = error.replace(/\s+/g, " ").trim();
  return flat.length > ERROR_MAX ? `${flat.slice(0, ERROR_MAX - 1)}…` : flat;
}

function body(text: string): string {
  return text.length > ALERT_BODY_MAX ? `${text.slice(0, ALERT_BODY_MAX - 1)}…` : text;
}

export interface AlertCopy {
  title: string;
  body: string;
}

export function pausedAlert(input: { adGroupName: string; topics: readonly string[]; replacement: boolean }): AlertCopy {
  const group = name(input.adGroupName);
  const lead = isTransient(input.topics)
    ? `Google says the landing page for an ad in ${group} is not working. OPS paused the ad and turns it back on once Google approves it. If the page loads, appeal in Google Ads.`
    : `Google disapproved an ad in ${group} for ${policyReason(input.topics)}. OPS paused it and turns it back on once Google approves it.`;
  return {
    title: "AD DISAPPROVED",
    body: body(input.replacement ? `${lead} The engine writes a replacement for your review on its next run.` : lead),
  };
}

export function pauseFailedAlert(input: { adGroupName: string; topics: readonly string[]; error: string }): AlertCopy {
  const group = name(input.adGroupName);
  const error = reasonText(input.error);
  return {
    title: "AD DISAPPROVED",
    body: body(
      isTransient(input.topics)
        ? `Google says the landing page for an ad in ${group} is not working. OPS could not pause the ad (${error}) and tries again tomorrow.`
        : `Google disapproved an ad in ${group} for ${policyReason(input.topics)}. OPS could not pause it (${error}) and tries again tomorrow.`
    ),
  };
}

export function restoreFailedAlert(input: { adGroupName: string; error: string }): AlertCopy {
  return {
    title: "AD STILL PAUSED",
    body: body(`Google approved the ad OPS paused in ${name(input.adGroupName)}. OPS could not switch it back on (${reasonText(input.error)}) and tries again tomorrow.`),
  };
}

export function restoredAlert(adGroupNames: readonly string[]): AlertCopy {
  const groups = [...new Set(adGroupNames.map(name))];
  if (adGroupNames.length === 1)
    return { title: "AD BACK ON", body: body(`Google approved the ad OPS paused in ${groups[0]}. OPS switched it back on.`) };
  return {
    title: "ADS BACK ON",
    body: body(`Google approved ${adGroupNames.length} ads OPS paused in ${list(groups)}. OPS switched them back on.`),
  };
}

/** Every alert belongs to one guardrail episode, so a second episode on the same ad alerts afresh. */
export const alertKeys = {
  paused: (pauseId: string) => `ads-engine:disapproved:${pauseId}`,
  pauseFailed: (pauseId: string) => `ads-engine:pause-failed:${pauseId}`,
  restoreFailed: (pauseId: string) => `ads-engine:restore-failed:${pauseId}`,
  restored: (pauseIds: readonly string[]) => `ads-engine:restored:${hash8([...pauseIds].sort().join(","))}`,
  /** Everything an episode may have raised, for closing it. */
  ofPause: (pauseId: string) => [alertKeys.paused(pauseId), alertKeys.pauseFailed(pauseId), alertKeys.restoreFailed(pauseId)],
};
