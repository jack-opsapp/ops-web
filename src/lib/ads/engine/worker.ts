/**
 * Google Ads engine — the daily worker tick (design spec §5.3, §5.4, §5.6, §7).
 *
 * Runs once a day before the routine claims: expires stale proposals, applies
 * the kinds Jackson has flipped to auto, keeps every live ad pair under test
 * (opens a test for a pair nobody is judging from the first day both ads
 * served, cancels one that can no longer finish), concludes tests by OPS's own
 * statistics and opens the follow-up proposals (never auto-promoting), scores
 * applied changes over matched pre/post windows, guards against disapproved
 * ads (pauses them on Google's live verdict, holds a landing-page verdict for
 * one daily check, and switches an ad back on once Google approves it — only
 * when the pause is provably its own), watches budget pacing, delivers the
 * operator rail, and raises the stall alarm while ads are live. Pure over an
 * injected repository.
 */
import { describeGoogleError, type AdsGateway, type ApplyOutcome, type ApplyProposalRecord, type MutateOperation, type MutateResult } from "./apply";
import {
  alertKeys,
  changeWindow,
  engineClaim,
  graceElapsed,
  isApprovedAgain,
  isTransient,
  pauseFailedAlert,
  pauseProvenance,
  pausedAlert,
  replacementDue,
  restoreFailedAlert,
  restoredAlert,
  routineActive,
  withinChangeHistory,
  type AdChangeEvent,
  type EngineAdDecision,
  type GuardrailPause,
  type LiveAdState,
  type ReleaseReason,
} from "./disapprovals";
import { HUMAN_ONLY_KINDS } from "./guardrails";
import { metricWindows, type DateWindow } from "./metrics";
import { disapprovedChallengerReason, livePairs, pairTest, staleTests, testEndedByPause, untrackedPairs, type NewPairTest } from "./pairs";
import { changeVerdict, DEFAULT_TEST_RULES, testVerdict, type ArmStats, type TestRules, type TestStats } from "./stats";
import type { ChangeRecord, ChangeVerdict, EngineSettings, EntitySnapshot, ProposalKind, SnapshotAd, SnapshotAdGroup, TestRecord, TestState } from "./types";

export interface EngineOperator {
  userId: string;
  companyId: string;
}

export interface PacingRow {
  date: string;
  campaignId: string;
  campaignName: string;
  /** Google's search_budget_lost_impression_share, 0..1. */
  lostShare: number;
}

export interface EngineAlert {
  kind: "ad_disapproved" | "ad_restored" | "budget_pacing" | "apply_failed";
  dedupeKey: string;
  title: string;
  body: string;
  persistent: boolean;
  actionUrl?: string;
}

export interface WorkerProposalInput {
  kind: ProposalKind;
  target: string;
  payload: Record<string, unknown>;
  evidence: unknown[];
  rationale: string;
  mode: "propose" | "auto";
}

export interface WorkerRepository {
  expireProposals(): Promise<number>;
  readSettings(): Promise<EngineSettings>;
  readSnapshot(): Promise<EntitySnapshot>;
  /** Approved proposals not yet applied, plus proposed ones filed under auto mode. */
  listApplicableProposals(): Promise<ApplyProposalRecord[]>;
  listRunningTests(): Promise<TestRecord[]>;
  adArmMetrics(adIds: string[], window: DateWindow): Promise<Record<string, ArmStats>>;
  recordTestStats(id: string, state: TestState, stats: Record<string, unknown>, verdictAt: string | null): Promise<void>;
  /** Files a worker-authored proposal; null when the same target is already open. */
  openWorkerProposal(input: WorkerProposalInput): Promise<string | null>;
  linkTestProposal(testId: string, proposalId: string): Promise<void>;
  listPendingChanges(measureToOnOrBefore: string): Promise<ChangeRecord[]>;
  entityMetrics(change: ChangeRecord, window: DateWindow): Promise<ArmStats>;
  setChangeVerdict(id: string, verdict: ChangeVerdict, pre: Record<string, unknown>, post: Record<string, unknown>, verdictAt: string): Promise<void>;
  raiseAlert(alert: EngineAlert): Promise<boolean>;
  notify(operator: EngineOperator): Promise<number>;
  checkStall(operator: EngineOperator, staleHours: number, campaignsLive: boolean): Promise<boolean>;
  clearStall(operator: EngineOperator): Promise<number>;
  /** The guardrail's open episodes (`ads_guardrail_pauses` holding or paused). */
  listOpenGuardrailPauses(): Promise<GuardrailPause[]>;
  /** Opens an episode in state holding; null when the ad already has an open one. */
  openGuardrailPause(input: NewGuardrailPause): Promise<GuardrailPause | null>;
  markGuardrailPaused(id: string, input: GuardrailPausedInput): Promise<void>;
  recordGuardrailPauseError(id: string, error: string): Promise<void>;
  closeGuardrailPause(id: string, outcome: GuardrailClose): Promise<void>;
  /** Open or applied proposals that pause an ad, promote over it, or put a challenger in its group. */
  listEngineAdDecisions(): Promise<EngineAdDecision[]>;
  /** Resolves engine alerts and their rail rows; returns how many open alerts it closed. */
  resolveAlerts(dedupeKeys: string[]): Promise<number>;
  refreshSnapshot(): Promise<void>;
  /** Every test, in any state, for these ad groups: the history that decides whether a pair is judged again. */
  listPairTests(adGroupIds: string[]): Promise<TestRecord[]>;
  /** The first account day, on or after `since`, on which both ads recorded impressions; null when they have not served together. */
  firstSharedServingDay(controlAdId: string, challengerAdId: string, since: string | null): Promise<string | null>;
  /** Opens the test for a pair; null when the group already has a running test. */
  openPairTest(test: NewPairTest): Promise<string | null>;
  /** Cancels a test that is still running; false when it no longer is. */
  cancelTest(id: string, stats: Record<string, unknown>, cancelledAt: string): Promise<boolean>;
}

/** Google reads the guardrail decides on: the live verdict and the change history. */
export interface GuardrailReader {
  readAdStates(resourceNames: string[]): Promise<LiveAdState[]>;
  /** Every ad change between two account-local dates (YYYY-MM-DD), and whether Google's row limit cut it short. */
  readAdChanges(startDate: string, endDate: string): Promise<{ events: AdChangeEvent[]; truncated: boolean }>;
}

export interface NewGuardrailPause {
  ad_resource_name: string;
  ad_id: string;
  ad_group_resource_name: string;
  ad_group_name: string;
  campaign_resource_name: string;
  policy_topics: string[];
  policy_entries: unknown[];
  observed_at: string;
}

export interface GuardrailPausedInput {
  /** Just before the real mutate; with `pausedAt`, the window Google's commit falls in. */
  pauseRequestedAt: string;
  pausedAt: string;
  requestId: string | null;
  topics: string[];
  entries: unknown[];
}

export interface GuardrailClose {
  state: "restored" | "released";
  reason: ReleaseReason | "restored";
  requestId?: string | null;
}

export interface WorkerDependencies {
  repository: WorkerRepository;
  now: () => Date;
  operator: EngineOperator | null;
  /** Applies one proposal; null when Google cannot be reached (auto work waits). */
  apply: ((proposal: ApplyProposalRecord) => Promise<ApplyOutcome>) | null;
  /** For the guardrail's pauses and restores; null when Google cannot be reached. */
  gateway: AdsGateway | null;
  /** The guardrail's live reads; null when Google cannot be reached (the guardrail waits). */
  reader: GuardrailReader | null;
  /** Ad ids the blueprint retires (`retire.adIds`); null when the blueprint cannot be read, and then nothing is switched back on. */
  retiredAdIds: ReadonlySet<string> | null;
  /** `ADS_ENGINE_REHEARSAL=1`: the guardrail validates with Google and writes nothing. */
  rehearsal?: boolean;
  readBudgetPacing: ((window: DateWindow) => Promise<PacingRow[]>) | null;
  testRules?: TestRules;
}

export interface TickResult {
  expired: number;
  autoApplied: number;
  autoFailed: number;
  autoSkipped: number;
  /** Tests opened for live pairs nobody was judging. */
  testsOpened: number;
  /** Running tests cancelled because an ad left the pair. */
  testsCancelled: number;
  testsConcluded: number;
  followUps: number;
  verdicts: number;
  /** Ads the guardrail paused this tick. */
  disapproved: number;
  /** Landing-page verdicts held for the next daily check. */
  held: number;
  /** Ads the guardrail switched back on after Google approved them. */
  restored: number;
  /** Episodes the guardrail let go without acting. */
  released: number;
  guardrail: "idle" | "checked" | "unavailable";
  pacing: number;
  notified: number;
  stalled: boolean;
  campaignsLive: boolean;
}

export const PACING_LOST_SHARE = 0.3;
export const PACING_DAYS = 3;
export const PRE_WINDOW_DAYS = 14;

const KIND_LABELS: Record<ProposalKind, string> = {
  add_negatives: "Negative keywords",
  pause_keyword: "Keyword pause",
  add_keywords: "New keywords",
  create_rsa_challenger: "Challenger ad",
  promote_challenger: "Challenger promotion",
  pause_ad: "Ad pause",
  adjust_budget: "Budget change",
  adjust_cpc_cap: "CPC cap change",
  set_bidding_strategy: "Bidding change",
  add_ad_group: "New ad group",
  observation: "Observation",
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000) + 1;
}

/** Where a change's outcome is measured. */
export function changeScope(change: ChangeRecord): { level: "account" | "campaign" | "ad_group"; id: string | null } {
  switch (change.kind) {
    case "add_negatives":
      return { level: "account", id: null };
    case "adjust_budget":
    case "adjust_cpc_cap":
    case "set_bidding_strategy":
      return { level: "campaign", id: change.campaign_id };
    default: {
      const fromResource = change.resource_names.map((name) => name.match(/\/adGroups\/(\d+)$/)?.[1]).find((id) => id);
      return { level: "ad_group", id: change.ad_group_id ?? fromResource ?? null };
    }
  }
}

function campaignsLiveIn(snapshot: EntitySnapshot): boolean {
  return snapshot.campaigns.some((c) => c.status === "ENABLED" && c.labels.includes("engine") && c.kind !== "legacy");
}

async function applyPending(d: WorkerDependencies, settings: EngineSettings, result: TickResult): Promise<void> {
  const proposals = await d.repository.listApplicableProposals();
  for (const proposal of proposals) {
    // An approved proposal is Jackson's decision; it applies whatever the mode.
    // A proposed one applies only while its kind is still auto and never for a
    // kind that stays human in v1.
    const approved = proposal.state === "approved";
    const autoAllowed = settings.modes[proposal.kind] === "auto" && !HUMAN_ONLY_KINDS.has(proposal.kind);
    if (!d.apply || (!approved && !autoAllowed)) {
      result.autoSkipped += 1;
      continue;
    }
    let outcome: ApplyOutcome;
    try {
      outcome = await d.apply(proposal);
    } catch (error) {
      outcome = { state: "failed", validation: null, error: error instanceof Error ? error.message : String(error), policyTopics: [] };
    }
    if (outcome.state === "applied") {
      result.autoApplied += 1;
    } else if (outcome.state === "failed") {
      result.autoFailed += 1;
      await d.repository.raiseAlert({
        kind: "apply_failed",
        dedupeKey: `ads-engine:apply-failed:${proposal.id}`,
        title: "ADS CHANGE FAILED",
        body: `${KIND_LABELS[proposal.kind]} could not be applied: ${outcome.error}`.slice(0, 600),
        persistent: true,
      });
    } else {
      result.autoSkipped += 1;
    }
  }
}

/**
 * Keep every live pair under test (spec §5.4; rules in pairs.ts). Runs before
 * the verdicts so a test whose ad left the pair is never judged, and so a
 * pair's first shared day is on record before the routine claims its brief.
 */
async function trackPairs(d: WorkerDependencies, snapshot: EntitySnapshot, now: Date, result: TickResult): Promise<void> {
  const [running, pauses] = await Promise.all([d.repository.listRunningTests(), d.repository.listOpenGuardrailPauses()]);
  const cancelledAt = now.toISOString();
  for (const { test, reason } of staleTests({ running, snapshot, pauses })) {
    if (await d.repository.cancelTest(test.id, { ...(test.stats ?? {}), reason, cancelled_at: cancelledAt }, cancelledAt)) result.testsCancelled += 1;
  }

  const pairs = livePairs(snapshot, pauses);
  if (pairs.length === 0) return;
  const history = await d.repository.listPairTests([...new Set(pairs.map((pair) => pair.adGroup.id))]);
  for (const pair of untrackedPairs(pairs, history)) {
    const firstDay = await d.repository.firstSharedServingDay(pair.control.id, pair.challenger.id, pair.since);
    if (!firstDay) continue;
    if (await d.repository.openPairTest(pairTest(pair, firstDay))) result.testsOpened += 1;
  }
}

async function concludeTests(d: WorkerDependencies, settings: EngineSettings, snapshot: EntitySnapshot, today: string, now: Date, result: TickResult): Promise<void> {
  const rules = d.testRules ?? DEFAULT_TEST_RULES;
  for (const test of await d.repository.listRunningTests()) {
    const from = shiftDay(isoDay(new Date(test.started_at)), 1);
    if (from > today) continue;
    const window = { from, to: today };
    const days = daysBetweenInclusive(from, today);
    const arms = await d.repository.adArmMetrics([test.control_ad_id, test.challenger_ad_id], window);
    const control = arms[test.control_ad_id] ?? { impressions: 0, clicks: 0, conversions: 0 };
    const challenger = arms[test.challenger_ad_id] ?? { impressions: 0, clicks: 0, conversions: 0 };
    const verdict = testVerdict({
      control,
      challenger,
      days,
      rules: { ...rules, minDays: test.min_days, minImpressions: test.min_impressions, maxDays: test.max_days },
    });
    const stats: Record<string, unknown> = { ...verdict.stats, computed_at: now.toISOString(), reason: verdict.reason, window };
    await d.repository.recordTestStats(test.id, verdict.state, stats, verdict.state === "running" ? null : now.toISOString());
    if (verdict.state === "running") continue;
    result.testsConcluded += 1;

    const winner = snapshot.ads.find((ad) => ad.id === test.challenger_ad_id);
    const loser = snapshot.ads.find((ad) => ad.id === test.control_ad_id);
    const adGroup = snapshot.adGroups.find((g) => g.id === test.ad_group_id);
    const campaign = adGroup ? snapshot.campaigns.find((c) => c.resourceName === adGroup.campaignResourceName) : undefined;
    if (!winner || !loser || !adGroup || !campaign) continue;
    const evidence = [
      { arm: "control", ad: loser.resourceName, impressions: control.impressions, clicks: control.clicks, trials: control.conversions ?? 0 },
      { arm: "challenger", ad: winner.resourceName, impressions: challenger.impressions, clicks: challenger.clicks, trials: challenger.conversions ?? 0 },
      { days, z: verdict.stats.z, p: verdict.stats.p },
    ];

    let proposalId: string | null = null;
    if (verdict.state === "challenger_won") {
      proposalId = await d.repository.openWorkerProposal({
        kind: "promote_challenger",
        target: `test:${test.id}`,
        payload: {
          test_id: test.id,
          verdict: verdict.state,
          winner: winner.resourceName,
          loser: loser.resourceName,
          adGroup: adGroup.resourceName,
          adGroupId: adGroup.id,
          adGroupName: adGroup.name,
          campaign: campaign.resourceName,
          campaignId: campaign.id,
          campaignName: campaign.name,
        },
        evidence,
        rationale: verdict.reason,
        // Never auto-promote in v1: the winner takes the control's place only on Jackson's approval.
        mode: "propose",
      });
    } else if (verdict.state === "control_won") {
      proposalId = await d.repository.openWorkerProposal({
        kind: "pause_ad",
        target: `ad:${winner.resourceName}`,
        payload: {
          ad: winner.resourceName,
          adId: winner.id,
          adGroup: adGroup.resourceName,
          adGroupId: adGroup.id,
          adGroupName: adGroup.name,
          campaign: campaign.resourceName,
          campaignId: campaign.id,
          campaignName: campaign.name,
          reason: verdict.reason,
        },
        evidence,
        rationale: `The challenger lost its test. ${verdict.reason}`,
        mode: settings.modes.pause_ad === "auto" ? "auto" : "propose",
      });
    }
    if (proposalId) {
      result.followUps += 1;
      await d.repository.linkTestProposal(test.id, proposalId);
    }
  }
}

async function scoreChanges(d: WorkerDependencies, today: string, now: Date, result: TickResult): Promise<void> {
  for (const change of await d.repository.listPendingChanges(today)) {
    const appliedDay = isoDay(new Date(change.applied_at));
    const pre: DateWindow = { from: shiftDay(appliedDay, -PRE_WINDOW_DAYS), to: shiftDay(appliedDay, -1) };
    const post: DateWindow = { from: change.measure_from, to: change.measure_to };
    const [preMetrics, postMetrics] = await Promise.all([d.repository.entityMetrics(change, pre), d.repository.entityMetrics(change, post)]);
    const verdict = changeVerdict(preMetrics, postMetrics);
    await d.repository.setChangeVerdict(
      change.id,
      verdict.verdict,
      { ...preMetrics, ctr: verdict.preCtr, window: pre, scope: changeScope(change) },
      { ...postMetrics, ctr: verdict.postCtr, deltaPct: verdict.deltaPct, window: post, scope: changeScope(change) },
      now.toISOString()
    );
    result.verdicts += 1;
  }
}

// ─── The disapproved-ad guardrail (spec §5.6; rules in disapprovals.ts) ──────

type StatusWrite = { outcome: "written"; requestId: string | null } | { outcome: "refused"; error: string } | { outcome: "validated" };

interface GuardContext {
  /** Running tests, read once and only if a pause needs them. */
  tests: TestRecord[] | null;
  /** The guardrail's episodes as this tick found them. */
  pauses: GuardrailPause[];
  /** Whether the account changed, so the snapshot is refreshed once at the end. */
  mutated: boolean;
}

function statusOperation(resourceName: string, status: "PAUSED" | "ENABLED"): MutateOperation[] {
  return [{ adGroupAdOperation: { update: { resourceName, status }, updateMask: "status" } }];
}

function failureCodes(result: MutateResult): string {
  return [...new Set(result.failures.map((f) => f.code))].join(", ");
}

function topicsOf(state: LiveAdState): string[] {
  return state.policyTopics.map((entry) => entry.topic);
}

/** validateOnly, then the real write with partial failure off. In rehearsal it stops after validation. */
async function writeStatus(d: WorkerDependencies, gateway: AdsGateway, resourceName: string, status: "PAUSED" | "ENABLED"): Promise<StatusWrite> {
  const operations = statusOperation(resourceName, status);
  try {
    const validation = await gateway.mutate(operations, { validateOnly: true, partialFailure: false });
    if (validation.failures.length > 0) return { outcome: "refused", error: failureCodes(validation) };
    if (d.rehearsal) return { outcome: "validated" };
    const real = await gateway.mutate(operations, { validateOnly: false, partialFailure: false });
    if (real.failures.length > 0) return { outcome: "refused", error: failureCodes(real) };
    return { outcome: "written", requestId: real.requestId ?? null };
  } catch (error) {
    return { outcome: "refused", error: describeGoogleError(error instanceof Error ? error.message : String(error)) };
  }
}

async function releaseEpisode(d: WorkerDependencies, pause: GuardrailPause, reason: ReleaseReason, result: TickResult): Promise<void> {
  await d.repository.closeGuardrailPause(pause.id, { state: "released", reason });
  await d.repository.resolveAlerts(alertKeys.ofPause(pause.id));
  result.released += 1;
}

async function pauseEpisode(
  d: WorkerDependencies,
  gateway: AdsGateway,
  settings: EngineSettings,
  snapshot: EntitySnapshot,
  now: Date,
  pause: GuardrailPause,
  state: LiveAdState,
  ctx: GuardContext,
  result: TickResult
): Promise<void> {
  const topics = topicsOf(state);
  const requestedAt = d.now();
  const write = await writeStatus(d, gateway, pause.ad_resource_name, "PAUSED");
  if (write.outcome === "validated") return;
  if (write.outcome === "refused") {
    await d.repository.recordGuardrailPauseError(pause.id, write.error);
    await d.repository.raiseAlert({
      kind: "ad_disapproved",
      dedupeKey: alertKeys.pauseFailed(pause.id),
      ...pauseFailedAlert({ adGroupName: pause.ad_group_name, topics, error: write.error }),
      persistent: true,
    });
    return;
  }
  await d.repository.markGuardrailPaused(pause.id, {
    pauseRequestedAt: requestedAt.toISOString(),
    pausedAt: d.now().toISOString(),
    requestId: write.requestId,
    topics,
    entries: state.policyTopics,
  });
  ctx.mutated = true;
  result.disapproved += 1;
  if (pause.pause_error) await d.repository.resolveAlerts([alertKeys.pauseFailed(pause.id)]);
  ctx.tests ??= await d.repository.listRunningTests();
  // A challenger paused for its copy cannot finish its test, and Google will
  // not approve those words again: end the test now, so the replacement below
  // is one the validator will accept on the routine's next run.
  const cancelledAt = d.now().toISOString();
  for (const test of ctx.tests.filter((t) => testEndedByPause(t, pause.ad_id, topics))) {
    const reason = disapprovedChallengerReason(topics);
    if (await d.repository.cancelTest(test.id, { ...(test.stats ?? {}), reason, cancelled_at: cancelledAt }, cancelledAt)) result.testsCancelled += 1;
    ctx.tests = ctx.tests.filter((t) => t.id !== test.id);
  }
  // A replacement is promised only when the routine is running and the brief
  // will name this group in its creative duty — the same predicate decides both.
  const replacement =
    routineActive(settings, now) &&
    replacementDue({ adResourceName: pause.ad_resource_name, adGroupResourceName: pause.ad_group_resource_name, policyTopics: topics, snapshot, tests: ctx.tests, pauses: ctx.pauses });
  await d.repository.raiseAlert({
    kind: "ad_disapproved",
    dedupeKey: alertKeys.paused(pause.id),
    ...pausedAlert({ adGroupName: pause.ad_group_name, topics, replacement }),
    persistent: true,
  });
}

/**
 * Switch back on the approved ads whose pause is provably the guardrail's own:
 * not retired by the blueprint, not claimed by an engine decision, and last
 * touched by the guardrail itself in Google's change history. Anything it
 * cannot prove waits for the next tick; anything someone else has decided is
 * let go.
 */
async function restoreApproved(
  d: WorkerDependencies,
  gateway: AdsGateway,
  reader: GuardrailReader,
  now: Date,
  approved: GuardrailPause[],
  ctx: GuardContext,
  result: TickResult
): Promise<void> {
  if (!d.retiredAdIds) {
    console.warn("[ads-engine] guardrail: the blueprint's retire list cannot be read; approved ads stay paused this tick");
    return;
  }
  const decisions = await d.repository.listEngineAdDecisions();
  const candidates: GuardrailPause[] = [];
  for (const pause of approved) {
    if (d.retiredAdIds.has(pause.ad_id)) {
      await releaseEpisode(d, pause, "retired_by_blueprint", result);
      continue;
    }
    const claim = engineClaim(pause, decisions);
    if (claim === "applied") {
      await releaseEpisode(d, pause, "engine_decision", result);
      continue;
    }
    if (claim === "pending") continue;
    if (!withinChangeHistory(pause, now)) {
      await releaseEpisode(d, pause, "unverifiable", result);
      continue;
    }
    candidates.push(pause);
  }
  if (candidates.length === 0) return;

  const window = changeWindow(candidates, now);
  let history: { events: AdChangeEvent[]; truncated: boolean };
  try {
    history = await reader.readAdChanges(window.startDate, window.endDate);
  } catch (error) {
    console.error("[ads-engine] guardrail: change history read failed; approved ads stay paused this tick", error);
    return;
  }
  if (history.truncated) {
    console.warn("[ads-engine] guardrail: change history hit Google's row limit; approved ads stay paused this tick");
    return;
  }

  const restored: GuardrailPause[] = [];
  for (const pause of candidates) {
    const provenance = pauseProvenance(pause, history.events);
    if (provenance === "touched") {
      await releaseEpisode(d, pause, "changed_elsewhere", result);
      continue;
    }
    if (provenance === "unknown") continue;
    const write = await writeStatus(d, gateway, pause.ad_resource_name, "ENABLED");
    if (write.outcome === "validated") continue;
    if (write.outcome === "refused") {
      await d.repository.raiseAlert({
        kind: "ad_restored",
        dedupeKey: alertKeys.restoreFailed(pause.id),
        ...restoreFailedAlert({ adGroupName: pause.ad_group_name, error: write.error }),
        persistent: true,
      });
      continue;
    }
    await d.repository.closeGuardrailPause(pause.id, { state: "restored", reason: "restored", requestId: write.requestId });
    await d.repository.resolveAlerts(alertKeys.ofPause(pause.id));
    ctx.mutated = true;
    result.restored += 1;
    restored.push(pause);
  }
  if (restored.length > 0)
    await d.repository.raiseAlert({
      kind: "ad_restored",
      dedupeKey: alertKeys.restored(restored.map((pause) => pause.id)),
      ...restoredAlert(restored.map((pause) => pause.ad_group_name)),
      persistent: false,
    });
}

async function guardDisapprovals(d: WorkerDependencies, settings: EngineSettings, snapshot: EntitySnapshot, now: Date, result: TickResult): Promise<void> {
  const open = await d.repository.listOpenGuardrailPauses();
  const engineCampaigns = new Set(snapshot.campaigns.filter((c) => c.labels.includes("engine") && c.kind !== "legacy").map((c) => c.resourceName));
  const tracked = new Set(open.map((pause) => pause.ad_resource_name));
  // The snapshot only nominates suspects; every decision below is made on
  // Google's live verdict, because the snapshot can be most of a day old.
  const suspects: Array<{ ad: SnapshotAd; adGroup: SnapshotAdGroup }> = [];
  for (const ad of snapshot.ads) {
    if (ad.status !== "ENABLED" || ad.approvalStatus !== "DISAPPROVED" || tracked.has(ad.resourceName)) continue;
    const adGroup = snapshot.adGroups.find((g) => g.resourceName === ad.adGroupResourceName);
    if (adGroup && engineCampaigns.has(adGroup.campaignResourceName)) suspects.push({ ad, adGroup });
  }
  if (open.length === 0 && suspects.length === 0) {
    result.guardrail = "idle";
    return;
  }
  if (!d.reader || !d.gateway) {
    result.guardrail = "unavailable";
    console.warn("[ads-engine] guardrail: Google cannot be reached; disapprovals wait for the next tick");
    return;
  }
  let live: Map<string, LiveAdState>;
  try {
    const states = await d.reader.readAdStates([...suspects.map((s) => s.ad.resourceName), ...open.map((pause) => pause.ad_resource_name)]);
    live = new Map(states.map((state) => [state.resourceName, state]));
  } catch (error) {
    result.guardrail = "unavailable";
    console.error("[ads-engine] guardrail: live ad read failed; disapprovals wait for the next tick", error);
    return;
  }
  result.guardrail = "checked";
  const ctx: GuardContext = { tests: null, pauses: open, mutated: false };

  for (const { ad, adGroup } of suspects) {
    const state = live.get(ad.resourceName);
    if (!state || state.status !== "ENABLED" || state.approvalStatus !== "DISAPPROVED") continue;
    const pause = await d.repository.openGuardrailPause({
      ad_resource_name: ad.resourceName,
      ad_id: ad.id,
      ad_group_resource_name: adGroup.resourceName,
      ad_group_name: adGroup.name,
      campaign_resource_name: adGroup.campaignResourceName,
      policy_topics: topicsOf(state),
      policy_entries: state.policyTopics,
      observed_at: now.toISOString(),
    });
    if (!pause) continue;
    if (isTransient(topicsOf(state))) {
      result.held += 1;
      continue;
    }
    await pauseEpisode(d, d.gateway, settings, snapshot, now, pause, state, ctx, result);
  }

  const approved: GuardrailPause[] = [];
  for (const pause of open) {
    const state = live.get(pause.ad_resource_name);
    if (!state || state.status === "REMOVED") {
      await releaseEpisode(d, pause, "ad_gone", result);
      continue;
    }
    if (pause.state === "holding") {
      if (state.status !== "ENABLED") {
        await releaseEpisode(d, pause, "changed_elsewhere", result);
        continue;
      }
      if (state.approvalStatus !== "DISAPPROVED") {
        await releaseEpisode(d, pause, "cleared_before_pause", result);
        continue;
      }
      if (isTransient(topicsOf(state)) && !graceElapsed(pause.observed_at, now)) continue;
      await pauseEpisode(d, d.gateway, settings, snapshot, now, pause, state, ctx, result);
      continue;
    }
    // Paused by the guardrail. Switched back on by anyone else: theirs now.
    if (state.status === "ENABLED") {
      await releaseEpisode(d, pause, "changed_elsewhere", result);
      continue;
    }
    if (isApprovedAgain(state)) approved.push(pause);
  }
  if (approved.length > 0) await restoreApproved(d, d.gateway, d.reader, now, approved, ctx, result);

  if (ctx.mutated) {
    try {
      await d.repository.refreshSnapshot();
    } catch (error) {
      console.error("[ads-engine] snapshot refresh after the guardrail failed", error);
    }
  }
}

async function watchPacing(d: WorkerDependencies, snapshot: EntitySnapshot, today: string, result: TickResult): Promise<void> {
  if (!d.readBudgetPacing) return;
  let rows: PacingRow[];
  try {
    rows = await d.readBudgetPacing({ from: shiftDay(today, -(PACING_DAYS - 1)), to: today });
  } catch (error) {
    console.error("[ads-engine] budget pacing read failed", error);
    return;
  }
  const engineIds = new Set(snapshot.campaigns.filter((c) => c.labels.includes("engine") && c.kind !== "legacy").map((c) => c.id));
  const byCampaign = new Map<string, { name: string; cappedDates: Set<string> }>();
  for (const row of rows) {
    if (!engineIds.has(row.campaignId) || row.lostShare <= PACING_LOST_SHARE) continue;
    const entry = byCampaign.get(row.campaignId) ?? { name: row.campaignName, cappedDates: new Set<string>() };
    entry.cappedDates.add(row.date);
    byCampaign.set(row.campaignId, entry);
  }
  for (const [campaignId, entry] of byCampaign) {
    if (entry.cappedDates.size < PACING_DAYS) continue;
    result.pacing += 1;
    await d.repository.raiseAlert({
      kind: "budget_pacing",
      dedupeKey: `ads-engine:pacing:${campaignId}:${today}`,
      title: "ADS BUDGET PACING",
      body: `${entry.name} has been capped by its budget three days running. A budget proposal is the engine's call; approve it if the spend is earning trials.`,
      persistent: false,
    });
  }
}

export async function runEngineTick(d: WorkerDependencies): Promise<TickResult> {
  const now = d.now();
  const today = metricWindows(now).metrics28d.to;
  const result: TickResult = {
    expired: 0,
    autoApplied: 0,
    autoFailed: 0,
    autoSkipped: 0,
    testsOpened: 0,
    testsCancelled: 0,
    testsConcluded: 0,
    followUps: 0,
    verdicts: 0,
    disapproved: 0,
    held: 0,
    restored: 0,
    released: 0,
    guardrail: "idle",
    pacing: 0,
    notified: 0,
    stalled: false,
    campaignsLive: false,
  };

  result.expired = await d.repository.expireProposals();
  const [settings, snapshot] = await Promise.all([d.repository.readSettings(), d.repository.readSnapshot()]);
  result.campaignsLive = campaignsLiveIn(snapshot);

  await applyPending(d, settings, result);
  await trackPairs(d, snapshot, now, result);
  await concludeTests(d, settings, snapshot, today, now, result);
  await scoreChanges(d, today, now, result);
  await guardDisapprovals(d, settings, snapshot, now, result);
  await watchPacing(d, snapshot, today, result);

  if (d.operator) {
    result.notified = await d.repository.notify(d.operator);
    result.stalled = await d.repository.checkStall(d.operator, settings.stall_hours, result.campaignsLive);
    const heartbeat = settings.heartbeat_at ? Date.parse(settings.heartbeat_at) : Number.NaN;
    if (Number.isFinite(heartbeat) && now.getTime() - heartbeat < settings.stall_hours * 3_600_000) {
      await d.repository.clearStall(d.operator);
    }
  }
  return result;
}
