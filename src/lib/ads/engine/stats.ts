/**
 * Google Ads engine — the statistics OPS owns (design spec §5.4, §5.3).
 *
 * The routine never eyeballs significance. A test is a two-proportion z-test
 * on CTR with impressions as n; a change outcome is a CTR delta over matched
 * pre/post windows with an honest floor below which nothing is claimed.
 */
import type { ChangeVerdict, TestState } from "./types";

export interface ArmStats {
  impressions: number;
  clicks: number;
  conversions?: number;
}

export interface TestRules {
  minDays: number;
  minImpressions: number;
  maxDays: number;
  /** Two-tailed significance level. */
  alpha: number;
  /** Trial starts on the control that veto a non-converting challenger. */
  vetoControlTrials: number;
  /** The challenger needs at least this share of the control's clicks for the veto to apply. */
  vetoComparableClickShare: number;
}

export const DEFAULT_TEST_RULES: TestRules = {
  minDays: 14,
  minImpressions: 2000,
  maxDays: 56,
  alpha: 0.05,
  vetoControlTrials: 5,
  vetoComparableClickShare: 0.5,
};

export interface ChangeRules {
  minImpressions: number;
  /** CTR delta, in percent, that separates better/worse from flat. */
  deltaPct: number;
}

export const DEFAULT_CHANGE_RULES: ChangeRules = { minImpressions: 500, deltaPct: 10 };

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, error below 1.5e-7). */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export function twoProportionTest(a: ArmStats, b: ArmStats): { ctrA: number; ctrB: number; z: number; p: number } {
  const ctrA = a.impressions > 0 ? a.clicks / a.impressions : 0;
  const ctrB = b.impressions > 0 ? b.clicks / b.impressions : 0;
  const n = a.impressions + b.impressions;
  if (n === 0 || a.impressions === 0 || b.impressions === 0) return { ctrA, ctrB, z: 0, p: 1 };
  const pooled = (a.clicks + b.clicks) / n;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.impressions + 1 / b.impressions));
  if (se === 0) return { ctrA, ctrB, z: 0, p: 1 };
  const z = (ctrA - ctrB) / se;
  if (z === 0) return { ctrA, ctrB, z: 0, p: 1 };
  const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  return { ctrA, ctrB, z, p };
}

export interface TestStats {
  control: { impressions: number; clicks: number; ctr: number; trials: number };
  challenger: { impressions: number; clicks: number; ctr: number; trials: number };
  days: number;
  z: number;
  p: number;
  veto: boolean;
  computed_at?: string;
}

export function testVerdict(input: {
  control: ArmStats;
  challenger: ArmStats;
  days: number;
  rules: TestRules;
}): { state: Extract<TestState, "running" | "control_won" | "challenger_won" | "no_verdict">; stats: TestStats; reason: string } {
  const { control, challenger, days, rules } = input;
  const test = twoProportionTest(control, challenger);
  const controlTrials = control.conversions ?? 0;
  const challengerTrials = challenger.conversions ?? 0;
  const comparable = control.clicks > 0 && challenger.clicks >= control.clicks * rules.vetoComparableClickShare;
  const veto = controlTrials >= rules.vetoControlTrials && challengerTrials === 0 && comparable;
  const stats: TestStats = {
    control: { impressions: control.impressions, clicks: control.clicks, ctr: round6(test.ctrA), trials: controlTrials },
    challenger: { impressions: challenger.impressions, clicks: challenger.clicks, ctr: round6(test.ctrB), trials: challengerTrials },
    days,
    z: round6(test.z),
    p: round6(test.p),
    veto,
  };

  if (days < rules.minDays)
    return { state: "running", stats, reason: `${days} of ${rules.minDays} days.` };
  if (control.impressions < rules.minImpressions || challenger.impressions < rules.minImpressions)
    return { state: "running", stats, reason: `Both ads need ${rules.minImpressions} impressions (control ${control.impressions}, challenger ${challenger.impressions}).` };

  if (test.p < rules.alpha) {
    if (test.ctrB > test.ctrA) {
      if (veto)
        return {
          state: "control_won",
          stats,
          reason: `The challenger won on CTR (p ${stats.p}) but produced no trial start against the control's ${controlTrials}; the control keeps its place.`,
        };
      return { state: "challenger_won", stats, reason: `Challenger CTR ${pct(test.ctrB)} beat control ${pct(test.ctrA)} at p ${stats.p}.` };
    }
    return { state: "control_won", stats, reason: `Control CTR ${pct(test.ctrA)} beat challenger ${pct(test.ctrB)} at p ${stats.p}.` };
  }
  if (days >= rules.maxDays)
    return { state: "no_verdict", stats, reason: `No significant difference after ${rules.maxDays} days (p ${stats.p}).` };
  return { state: "running", stats, reason: `Not significant yet (p ${stats.p}) at day ${days}.` };
}

export function changeVerdict(
  pre: ArmStats,
  post: ArmStats,
  rules: ChangeRules = DEFAULT_CHANGE_RULES
): { verdict: ChangeVerdict; preCtr: number; postCtr: number; deltaPct: number | null } {
  const preCtr = pre.impressions > 0 ? pre.clicks / pre.impressions : 0;
  const postCtr = post.impressions > 0 ? post.clicks / post.impressions : 0;
  if (pre.impressions < rules.minImpressions || post.impressions < rules.minImpressions || preCtr === 0)
    return { verdict: "no_verdict", preCtr: round6(preCtr), postCtr: round6(postCtr), deltaPct: null };
  const deltaPct = Math.round(((postCtr - preCtr) / preCtr) * 10000) / 100;
  const verdict: ChangeVerdict = deltaPct >= rules.deltaPct ? "better" : deltaPct <= -rules.deltaPct ? "worse" : "flat";
  return { verdict, preCtr: round6(preCtr), postCtr: round6(postCtr), deltaPct };
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
