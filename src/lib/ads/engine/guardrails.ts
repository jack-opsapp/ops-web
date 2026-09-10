/**
 * Google Ads engine — money and pace guardrails (design spec §5.2, §5.6).
 *
 * Pure helpers. Every threshold comes from `ads_engine_settings` through the
 * caller; nothing here repeats a number the settings row already owns.
 */
import { createHash } from "node:crypto";
import type {
  BiddingStrategy,
  CampaignKind,
  ChangeRecord,
  FunnelSignals,
  KeywordMetric,
  ProposalKind,
  SnapshotAdGroup,
  SnapshotCampaign,
} from "./types";

/** Kinds that add structure; at most `max_structural_per_run` per run. */
export const STRUCTURAL_KINDS: ReadonlySet<ProposalKind> = new Set<ProposalKind>([
  "add_keywords",
  "create_rsa_challenger",
  "add_ad_group",
]);

/** Kinds that stay human-reviewed in v1; settings refuse `auto` for them. */
export const HUMAN_ONLY_KINDS: ReadonlySet<ProposalKind> = new Set<ProposalKind>([
  "create_rsa_challenger",
  "adjust_budget",
  "adjust_cpc_cap",
  "set_bidding_strategy",
  "add_ad_group",
]);

/** Kinds whose ledger entries start the budget/cap cooldown on a campaign. */
export const COOLDOWN_KINDS: ReadonlySet<ProposalKind> = new Set<ProposalKind>([
  "adjust_budget",
  "adjust_cpc_cap",
]);

export const BIDDING_LADDER: readonly BiddingStrategy[] = [
  "MAXIMIZE_CLICKS",
  "MAXIMIZE_CONVERSIONS",
  "TARGET_CPA",
];

/** Trial starts per 30 days that unlock each rung (spec §5.2). */
export const LADDER_TRIGGERS: Record<
  "MAXIMIZE_CONVERSIONS" | "TARGET_CPA",
  { perMonth: number; consecutiveMonths: 1 | 2 }
> = {
  MAXIMIZE_CONVERSIONS: { perMonth: 15, consecutiveMonths: 2 },
  TARGET_CPA: { perMonth: 30, consecutiveMonths: 1 },
};

/** The pause rule's fixed parts; the spend multiple's base is a setting. */
export const PAUSE_KEYWORD_RULE = {
  minClicks: 30,
  minDays: 28,
  spendMultiple: 3,
} as const;

/** The next rung above the current strategy, or null at the top. */
export function ladderNextRung(current: BiddingStrategy): BiddingStrategy | null {
  if (current === "MANUAL_CPC" || current === "OTHER") return "MAXIMIZE_CLICKS";
  const index = BIDDING_LADDER.indexOf(current);
  return index >= 0 && index < BIDDING_LADDER.length - 1
    ? BIDDING_LADDER[index + 1]
    : null;
}

export function ladderTriggerMet(
  target: BiddingStrategy,
  funnel: FunnelSignals
): boolean {
  if (target === "MAXIMIZE_CLICKS") return true;
  if (target !== "MAXIMIZE_CONVERSIONS" && target !== "TARGET_CPA") return false;
  const trigger = LADDER_TRIGGERS[target];
  if (funnel.trialStartsLast30 < trigger.perMonth) return false;
  return trigger.consecutiveMonths === 1
    ? true
    : funnel.trialStartsPrev30 >= trigger.perMonth;
}

/** Percentage change of `next` against `current`, absolute. */
export function changePct(current: number, next: number): number {
  if (current <= 0) return Number.POSITIVE_INFINITY;
  return (Math.abs(next - current) / current) * 100;
}

export function changeWithinLimit(
  current: number,
  next: number,
  maxPct: number
): boolean {
  return changePct(current, next) <= maxPct + 1e-9;
}

/** The most recent budget or cap change on a campaign, if any. */
export function lastCooldownChange(
  ledger: ChangeRecord[],
  campaignId: string
): ChangeRecord | null {
  let latest: ChangeRecord | null = null;
  for (const change of ledger) {
    if (change.campaign_id !== campaignId || !COOLDOWN_KINDS.has(change.kind))
      continue;
    if (!latest || Date.parse(change.applied_at) > Date.parse(latest.applied_at))
      latest = change;
  }
  return latest;
}

export function cooldownSatisfied(
  lastChangeAt: string | null,
  now: Date,
  cooldownDays: number
): boolean {
  if (!lastChangeAt) return true;
  const elapsedDays = (now.getTime() - Date.parse(lastChangeAt)) / 86_400_000;
  return elapsedDays >= cooldownDays;
}

/**
 * Sum of daily budgets across the engine's serving campaigns with one
 * campaign's budget replaced. A paused target counts too: the change is what
 * it will spend once it serves.
 */
export function dailyBudgetSum(
  campaigns: SnapshotCampaign[],
  targetResourceName: string,
  newAmount: number
): number {
  let sum = 0;
  for (const campaign of campaigns) {
    if (campaign.kind === "legacy") continue;
    if (campaign.resourceName === targetResourceName) {
      sum += newAmount;
      continue;
    }
    if (campaign.status !== "ENABLED") continue;
    sum += campaign.dailyBudget ?? 0;
  }
  return sum;
}

export function projectedMonthSpend(
  monthToDateSpend: number,
  dailySum: number,
  daysLeftInMonth: number
): number {
  return monthToDateSpend + dailySum * Math.max(0, daysLeftInMonth);
}

/**
 * Whether a keyword has earned a pause: thirty clicks and no trial over at
 * least four weeks, or spend three times the target cost per trial with none.
 */
export function pauseKeywordJustified(
  metric: KeywordMetric,
  targetCostPerTrial: number,
  now: Date
): { ok: true } | { ok: false; reason: string } {
  if (metric.conversions > 0)
    return {
      ok: false,
      reason: `The keyword produced ${metric.conversions} trial start(s) in the window; a keyword that converts is never paused.`,
    };
  const ageDays = metric.firstSeen
    ? (now.getTime() - Date.parse(metric.firstSeen)) / 86_400_000
    : 0;
  const byClicks =
    metric.clicks >= PAUSE_KEYWORD_RULE.minClicks &&
    ageDays >= PAUSE_KEYWORD_RULE.minDays;
  const bySpend =
    metric.spend >= PAUSE_KEYWORD_RULE.spendMultiple * targetCostPerTrial;
  if (byClicks || bySpend) return { ok: true };
  return {
    ok: false,
    reason: `${metric.clicks} clicks over ${Math.floor(ageDays)} days and $${metric.spend.toFixed(2)} spent; a pause needs ${PAUSE_KEYWORD_RULE.minClicks} clicks over ${PAUSE_KEYWORD_RULE.minDays} days with no trial, or $${(PAUSE_KEYWORD_RULE.spendMultiple * targetCostPerTrial).toFixed(2)} spent with none.`,
  };
}

/** Landing-page themes: stems any keyword in that ad group must carry. */
export const LANDING_THEMES: Record<string, string[]> = {
  "/job-management": ["job", "work order", "project", "task"],
  "/scheduling": ["schedul", "dispatch", "crew", "calendar"],
  "/quotes-invoices": ["quote", "invoic", "estimat", "bill"],
  "/compare/jobber": ["jobber"],
  "/compare/housecall-pro": ["housecall"],
  "/": ["ops"],
};

const STOP_WORDS = new Set(["and", "the", "for", "app", "software", "tool"]);

/** Stems a keyword must share with its ad group: name tokens plus page theme. */
export function themeStems(adGroup: Pick<SnapshotAdGroup, "name" | "finalUrl">): string[] {
  const stems = new Set<string>();
  for (const token of adGroup.name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length >= 3 && !STOP_WORDS.has(token)) stems.add(token);
  }
  if (adGroup.finalUrl) {
    try {
      const path = new URL(adGroup.finalUrl).pathname.replace(/\/$/, "") || "/";
      for (const stem of LANDING_THEMES[path] ?? []) stems.add(stem);
    } catch {
      // An unparseable landing URL contributes no theme.
    }
  }
  return [...stems];
}

export function matchesTheme(term: string, stems: string[]): boolean {
  const lower = term.toLowerCase();
  return stems.some((stem) => lower.includes(stem));
}

export function hash8(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** The copy-rules campaign kind; anything not brand or competitor is core. */
export function copyKindOf(kind: CampaignKind): "brand" | "core" | "competitor" {
  return kind === "brand" || kind === "competitor" ? kind : "core";
}
