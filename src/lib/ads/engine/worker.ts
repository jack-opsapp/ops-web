/**
 * Google Ads engine — the daily worker tick (design spec §5.3, §5.4, §5.6, §7).
 *
 * Runs once a day before the routine claims: expires stale proposals, applies
 * the kinds Jackson has flipped to auto, concludes tests by OPS's own
 * statistics and opens the follow-up proposals (never auto-promoting), scores
 * applied changes over matched pre/post windows, pauses any disapproved ad
 * immediately, watches budget pacing, delivers the operator rail, and raises
 * the stall alarm while ads are live. Pure over an injected repository.
 */
import type { AdsGateway, ApplyOutcome, ApplyProposalRecord } from "./apply";
import { HUMAN_ONLY_KINDS } from "./guardrails";
import { metricWindows, type DateWindow } from "./metrics";
import { changeVerdict, DEFAULT_TEST_RULES, testVerdict, type ArmStats, type TestRules, type TestStats } from "./stats";
import type { ChangeRecord, ChangeVerdict, EngineSettings, EntitySnapshot, ProposalKind, TestRecord, TestState } from "./types";

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
  kind: "ad_disapproved" | "budget_pacing" | "apply_failed";
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
}

export interface WorkerDependencies {
  repository: WorkerRepository;
  now: () => Date;
  operator: EngineOperator | null;
  /** Applies one proposal; null when Google cannot be reached (auto work waits). */
  apply: ((proposal: ApplyProposalRecord) => Promise<ApplyOutcome>) | null;
  /** For pausing a disapproved ad immediately; null when Google cannot be reached. */
  gateway: AdsGateway | null;
  readBudgetPacing: ((window: DateWindow) => Promise<PacingRow[]>) | null;
  testRules?: TestRules;
}

export interface TickResult {
  expired: number;
  autoApplied: number;
  autoFailed: number;
  autoSkipped: number;
  testsConcluded: number;
  followUps: number;
  verdicts: number;
  disapproved: number;
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
    const stats: TestStats & { reason: string; window: DateWindow } = { ...verdict.stats, computed_at: now.toISOString(), reason: verdict.reason, window };
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

async function pauseDisapproved(d: WorkerDependencies, snapshot: EntitySnapshot, result: TickResult): Promise<void> {
  const engineCampaigns = new Set(snapshot.campaigns.filter((c) => c.labels.includes("engine") && c.kind !== "legacy").map((c) => c.resourceName));
  for (const ad of snapshot.ads) {
    if (ad.status !== "ENABLED" || ad.approvalStatus !== "DISAPPROVED") continue;
    const adGroup = snapshot.adGroups.find((g) => g.resourceName === ad.adGroupResourceName);
    if (!adGroup || !engineCampaigns.has(adGroup.campaignResourceName)) continue;
    let paused = false;
    let reason = "Google could not be reached";
    if (d.gateway) {
      const operations = [{ adGroupAdOperation: { update: { resourceName: ad.resourceName, status: "PAUSED" }, updateMask: "status" } }];
      try {
        const validation = await d.gateway.mutate(operations, { validateOnly: true, partialFailure: false });
        if (validation.failures.length === 0) {
          const real = await d.gateway.mutate(operations, { validateOnly: false, partialFailure: false });
          paused = real.failures.length === 0;
          if (!paused) reason = real.failures.map((f) => f.code).join(", ");
        } else {
          reason = validation.failures.map((f) => f.code).join(", ");
        }
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
    }
    result.disapproved += 1;
    await d.repository.raiseAlert({
      kind: "ad_disapproved",
      dedupeKey: `ads-engine:disapproved:${ad.resourceName}`,
      title: "AD DISAPPROVED",
      body: paused
        ? `Google disapproved an ad in ${adGroup.name}. OPS paused it; the next run writes a replacement.`
        : `Google disapproved an ad in ${adGroup.name}. OPS could not pause it (${reason}); pause it in Google Ads.`.slice(0, 600),
      persistent: true,
    });
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
    testsConcluded: 0,
    followUps: 0,
    verdicts: 0,
    disapproved: 0,
    pacing: 0,
    notified: 0,
    stalled: false,
    campaignsLive: false,
  };

  result.expired = await d.repository.expireProposals();
  const [settings, snapshot] = await Promise.all([d.repository.readSettings(), d.repository.readSnapshot()]);
  result.campaignsLive = campaignsLiveIn(snapshot);

  await applyPending(d, settings, result);
  await concludeTests(d, settings, snapshot, today, now, result);
  await scoreChanges(d, today, now, result);
  await pauseDisapproved(d, snapshot, result);
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
