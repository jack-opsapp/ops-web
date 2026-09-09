/**
 * Google Ads engine — deterministic proposal validation (design spec §5.2, §5.6).
 *
 * Pure: the whole account context is passed in, so the boundary is proved
 * without a database. Every rejection carries a fixable code and issues the
 * routine can act on; every acceptance carries a normalised payload built from
 * the snapshot, never from what the routine claimed.
 */
import {
  validateRsa,
  isAllowedFinalUrl,
  type CopyContext,
  type RsaCandidate,
} from "../copy-rules";
import {
  STRUCTURAL_KINDS,
  changeWithinLimit,
  cooldownSatisfied,
  copyKindOf,
  dailyBudgetSum,
  hash8,
  ladderNextRung,
  ladderTriggerMet,
  lastCooldownChange,
  matchesTheme,
  pauseKeywordJustified,
  projectedMonthSpend,
  slug,
  themeStems,
} from "./guardrails";
import { envelopeSchema, issuesOf, payloadSchemas, type PayloadFor, type RsaPayload } from "./proposal-schemas";
import type {
  NormalizedProposal,
  ProposalKind,
  SnapshotAd,
  SnapshotAdGroup,
  SnapshotCampaign,
  ValidationCode,
  ValidationContext,
  ValidationIssue,
  ValidationResult,
} from "./types";

type Fail = { ok: false; code: ValidationCode; issues: ValidationIssue[] };
type Pass = {
  target: string;
  payload: Record<string, unknown>;
};

function fail(code: ValidationCode, field: string, message: string, ref?: string): Fail {
  return { ok: false, code, issues: [ref ? { code, field, message, ref } : { code, field, message }] };
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\/[^/]+$/.test(trimmed)) return `${trimmed}/`;
  return trimmed.length > 1 && trimmed.endsWith("/") && trimmed.split("/").length > 4
    ? trimmed.slice(0, -1)
    : trimmed;
}

function sameUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && normalizeUrl(a) === normalizeUrl(b);
}

class Lookup {
  constructor(private readonly ctx: ValidationContext) {}

  campaign(resourceName: string, field: string): SnapshotCampaign | Fail {
    const campaign = this.ctx.snapshot.campaigns.find((c) => c.resourceName === resourceName);
    if (!campaign) return fail("UNKNOWN_ENTITY", field, `No campaign ${resourceName} in the snapshot.`);
    return this.engineOnly(campaign, field);
  }

  engineOnly(campaign: SnapshotCampaign, field: string): SnapshotCampaign | Fail {
    if (campaign.kind === "legacy" || campaign.labels.includes("legacy"))
      return fail("LEGACY_ENTITY", field, `${campaign.name} carries the legacy label; the engine never touches it.`);
    if (!campaign.labels.includes("engine"))
      return fail("UNKNOWN_ENTITY", field, `${campaign.name} is not an engine-managed campaign (no engine label).`);
    return campaign;
  }

  adGroup(resourceName: string, field: string): { adGroup: SnapshotAdGroup; campaign: SnapshotCampaign } | Fail {
    const adGroup = this.ctx.snapshot.adGroups.find((g) => g.resourceName === resourceName);
    if (!adGroup) return fail("UNKNOWN_ENTITY", field, `No ad group ${resourceName} in the snapshot.`);
    const campaign = this.campaign(adGroup.campaignResourceName, field);
    if ("ok" in campaign) return campaign;
    return { adGroup, campaign };
  }

  ad(resourceName: string, field: string): { ad: SnapshotAd; adGroup: SnapshotAdGroup; campaign: SnapshotCampaign } | Fail {
    const ad = this.ctx.snapshot.ads.find((a) => a.resourceName === resourceName);
    if (!ad) return fail("UNKNOWN_ENTITY", field, `No ad ${resourceName} in the snapshot.`);
    const owner = this.adGroup(ad.adGroupResourceName, field);
    if ("ok" in owner) return owner;
    return { ad, ...owner };
  }

  runningTestFor(adGroupId: string) {
    return this.ctx.tests.find((t) => t.state === "running" && t.ad_group_id === adGroupId) ?? null;
  }

  runningTestWithAd(adId: string) {
    return (
      this.ctx.tests.find(
        (t) => t.state === "running" && (t.control_ad_id === adId || t.challenger_ad_id === adId)
      ) ?? null
    );
  }
}

function copyContext(campaign: SnapshotCampaign, finalUrl: string): CopyContext {
  return { campaignKind: copyKindOf(campaign.kind), allowedFinalUrls: [finalUrl] };
}

function toCandidate(rsa: RsaPayload): RsaCandidate {
  return {
    headlines: rsa.headlines,
    descriptions: rsa.descriptions,
    path1: rsa.path1,
    path2: rsa.path2,
    finalUrl: rsa.final_url,
  };
}

function copyRejected(rsa: RsaPayload, campaign: SnapshotCampaign, finalUrl: string, prefix = ""): Fail | null {
  const issues = validateRsa(toCandidate(rsa), copyContext(campaign, finalUrl));
  if (issues.length === 0) return null;
  return {
    ok: false,
    code: "COPY_REJECTED",
    issues: issues.map((issue) => ({
      code: issue.code,
      field: prefix ? `${prefix}.${issue.field}` : issue.field,
      message: issue.message,
    })),
  };
}

// ─── Per-kind rules ──────────────────────────────────────────────────────────

function addNegatives(p: PayloadFor<"add_negatives">, ctx: ValidationContext): Pass | Fail {
  const list = ctx.snapshot.sharedSets.find(
    (s) => s.name.trim() === p.list.trim() && s.type === "NEGATIVE_KEYWORDS"
  );
  if (!list) return fail("UNKNOWN_ENTITY", "payload.list", `No shared negative list named "${p.list}".`);
  const existing = new Set(list.members.map((m) => m.text.trim().toLowerCase()));
  const report = new Map(ctx.metrics28d.searchTerms.map((t) => [t.term.trim().toLowerCase(), t]));
  const pending = new Map<string, string>();
  for (const open of ctx.openProposals) {
    if (open.kind !== "add_negatives" || !open.payload) continue;
    const terms = (open.payload as { terms?: Array<{ text?: unknown }> }).terms ?? [];
    for (const term of terms)
      if (typeof term.text === "string") pending.set(term.text.trim().toLowerCase(), open.id);
  }
  const kept: Array<{ text: string; matchType: "BROAD" | "PHRASE" | "EXACT" }> = [];
  const seen = new Set<string>();
  for (const [index, term] of p.terms.entries()) {
    const key = term.text.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (existing.has(key) || pending.has(key)) continue;
    const row = report.get(key);
    if (!row)
      return fail("TERM_NOT_IN_REPORT", `payload.terms[${index}]`, `"${term.text}" is not in the 28-day search-term report; only observed terms become negatives.`);
    if (row.conversions > 0)
      return fail("TERM_PRODUCED_TRIAL", `payload.terms[${index}]`, `"${term.text}" produced ${row.conversions} trial start(s); a term that converts is never blocked.`);
    kept.push({ text: key, matchType: term.matchType });
  }
  if (kept.length === 0) {
    const waiting = p.terms.map((t) => pending.get(t.text.trim().toLowerCase())).find((id) => id);
    if (waiting)
      return fail("DUPLICATE_PROPOSAL", "payload.terms", `Every term is already waiting in open proposal ${waiting}.`, waiting);
    return fail("ALREADY_APPLIED", "payload.terms", `Every term is already in "${list.name}".`);
  }
  const target = `negatives:${list.name}:${hash8(kept.map((t) => t.text).sort().join("\n"))}`;
  return {
    target,
    payload: {
      list: list.name,
      listResourceName: list.resourceName,
      classification: p.classification,
      terms: kept,
    },
  };
}

function pauseKeyword(p: PayloadFor<"pause_keyword">, ctx: ValidationContext, look: Lookup): Pass | Fail {
  const keyword = ctx.snapshot.keywords.find((k) => k.resourceName === p.criterion && !k.negative);
  if (!keyword) return fail("UNKNOWN_ENTITY", "payload.criterion", `No keyword ${p.criterion} in the snapshot.`);
  const owner = look.adGroup(keyword.adGroupResourceName, "payload.criterion");
  if ("ok" in owner) return owner;
  if (keyword.status === "PAUSED")
    return fail("ALREADY_APPLIED", "payload.criterion", `"${keyword.text}" is already paused.`);
  const metric = ctx.metrics28d.keywords.find((m) => m.criterionId === keyword.criterionId && m.adGroupId === owner.adGroup.id);
  if (!metric)
    return fail("INSUFFICIENT_DATA", "payload.criterion", `No 28-day metrics for "${keyword.text}" yet.`);
  const verdict = pauseKeywordJustified(metric, ctx.settings.target_cost_per_trial, ctx.now);
  if (!verdict.ok) return fail("INSUFFICIENT_DATA", "payload.criterion", verdict.reason);
  return {
    target: `keyword:${keyword.resourceName}`,
    payload: {
      criterion: keyword.resourceName,
      text: keyword.text,
      matchType: keyword.matchType,
      adGroup: owner.adGroup.resourceName,
      campaign: owner.campaign.resourceName,
      metrics: {
        clicks: metric.clicks,
        spend: metric.spend,
        conversions: metric.conversions,
        firstSeen: metric.firstSeen,
      },
    },
  };
}

function addKeywords(p: PayloadFor<"add_keywords">, ctx: ValidationContext, look: Lookup): Pass | Fail {
  const owner = look.adGroup(p.ad_group, "payload.ad_group");
  if ("ok" in owner) return owner;
  const stems = themeStems(owner.adGroup);
  const existing = new Set(
    ctx.snapshot.keywords
      .filter((k) => k.adGroupResourceName === owner.adGroup.resourceName && !k.negative)
      .map((k) => `${k.text.trim().toLowerCase()}|${k.matchType}`)
  );
  const kept: Array<{ text: string; matchType: "PHRASE" | "EXACT" }> = [];
  for (const [index, term] of p.terms.entries()) {
    if (term.matchType === "BROAD")
      return fail("BROAD_MATCH_REJECTED", `payload.terms[${index}]`, "No broad match. Use PHRASE or EXACT.");
    if (!matchesTheme(term.text, stems))
      return fail("THEME_MISMATCH", `payload.terms[${index}]`, `"${term.text}" does not match the ${owner.adGroup.name} theme (${stems.join(", ")}).`);
    const key = `${term.text.trim().toLowerCase()}|${term.matchType}`;
    if (existing.has(key)) continue;
    kept.push({ text: term.text.trim().toLowerCase(), matchType: term.matchType });
  }
  if (kept.length === 0)
    return fail("ALREADY_APPLIED", "payload.terms", `Every keyword is already in ${owner.adGroup.name}.`);
  return {
    target: `keywords:${owner.adGroup.resourceName}:${hash8(kept.map((t) => `${t.text}|${t.matchType}`).sort().join("\n"))}`,
    payload: {
      ad_group: owner.adGroup.resourceName,
      campaign: owner.campaign.resourceName,
      terms: kept,
    },
  };
}

function createChallenger(p: PayloadFor<"create_rsa_challenger">, ctx: ValidationContext, look: Lookup): Pass | Fail {
  const owner = look.adGroup(p.ad_group, "payload.ad_group");
  if ("ok" in owner) return owner;
  const running = look.runningTestFor(owner.adGroup.id);
  if (running)
    return fail("TEST_NOT_CONCLUDED", "payload.ad_group", `${owner.adGroup.name} already has a running test (${running.id}); wait for its verdict.`);
  const control = ctx.snapshot.ads.find(
    (a) => a.adGroupResourceName === owner.adGroup.resourceName && a.status === "ENABLED" && a.role === "control"
  );
  if (!control)
    return fail("NO_CONTROL_AD", "payload.ad_group", `${owner.adGroup.name} has no enabled control ad to test against.`);
  const landing = owner.adGroup.finalUrl ?? control.finalUrls[0] ?? null;
  if (!landing || !sameUrl(p.final_url, landing) || !isAllowedFinalUrl(landing, ctx.allowedFinalUrls))
    return fail("URL_NOT_ALLOWED", "payload.final_url", `A challenger lands on its ad group's page: ${landing ?? "unknown"}.`);
  const copy = copyRejected(p, owner.campaign, landing);
  if (copy) return copy;
  const { ad_group: _adGroup, hypothesis, ...rsa } = p;
  void _adGroup;
  return {
    target: `challenger:${owner.adGroup.resourceName}`,
    payload: {
      ad_group: owner.adGroup.resourceName,
      adGroupId: owner.adGroup.id,
      adGroupName: owner.adGroup.name,
      campaign: owner.campaign.resourceName,
      campaignId: owner.campaign.id,
      campaignKind: owner.campaign.kind,
      controlAd: control.resourceName,
      controlAdId: control.id,
      hypothesis,
      ...rsa,
      final_url: landing,
    },
  };
}

function promoteChallenger(p: PayloadFor<"promote_challenger">, ctx: ValidationContext, look: Lookup): Pass | Fail {
  const test = ctx.tests.find((t) => t.id === p.test_id);
  if (!test) return fail("UNKNOWN_ENTITY", "payload.test_id", `No test ${p.test_id}.`);
  if (test.state === "running")
    return fail("TEST_NOT_CONCLUDED", "payload.test_id", "The test is still running; OPS computes the verdict.");
  if (test.state === "control_won" || test.state === "cancelled")
    return fail("VERDICT_MISMATCH", "payload.test_id", `The verdict is ${test.state}; retire the challenger with pause_ad instead of promoting it.`);
  const winner = ctx.snapshot.ads.find((a) => a.id === test.challenger_ad_id);
  const loser = ctx.snapshot.ads.find((a) => a.id === test.control_ad_id);
  if (!winner || !loser)
    return fail("UNKNOWN_ENTITY", "payload.test_id", "The test's ads are no longer in the snapshot.");
  const owner = look.ad(winner.resourceName, "payload.test_id");
  if ("ok" in owner) return owner;
  return {
    target: `test:${test.id}`,
    payload: {
      test_id: test.id,
      verdict: test.state,
      winner: winner.resourceName,
      loser: loser.resourceName,
      adGroup: owner.adGroup.resourceName,
      adGroupId: owner.adGroup.id,
      campaign: owner.campaign.resourceName,
      campaignId: owner.campaign.id,
    },
  };
}

function pauseAd(p: PayloadFor<"pause_ad">, ctx: ValidationContext, look: Lookup): Pass | Fail {
  const owner = look.ad(p.ad, "payload.ad");
  if ("ok" in owner) return owner;
  if (owner.ad.status !== "ENABLED")
    return fail("ALREADY_APPLIED", "payload.ad", "The ad is not enabled.");
  const running = look.runningTestWithAd(owner.ad.id);
  if (running && owner.ad.approvalStatus !== "DISAPPROVED")
    return fail("TEST_NOT_CONCLUDED", "payload.ad", `The ad is one arm of running test ${running.id}.`);
  return {
    target: `ad:${owner.ad.resourceName}`,
    payload: {
      ad: owner.ad.resourceName,
      adId: owner.ad.id,
      adGroup: owner.adGroup.resourceName,
      adGroupId: owner.adGroup.id,
      campaign: owner.campaign.resourceName,
      campaignId: owner.campaign.id,
      reason: p.reason,
    },
  };
}

function cooldownFor(campaign: SnapshotCampaign, ctx: ValidationContext): Fail | null {
  const last = lastCooldownChange(ctx.ledger, campaign.id);
  if (!cooldownSatisfied(last?.applied_at ?? null, ctx.now, ctx.settings.budget_cooldown_days))
    return fail("COOLDOWN", "payload.campaign", `${campaign.name} changed on ${last!.applied_at.slice(0, 10)}; wait ${ctx.settings.budget_cooldown_days} days between budget or cap changes.`);
  return null;
}

function adjustBudget(p: PayloadFor<"adjust_budget">, ctx: ValidationContext, look: Lookup): Pass | Fail {
  const campaign = look.campaign(p.campaign, "payload.campaign");
  if ("ok" in campaign) return campaign;
  if (campaign.dailyBudget == null || !campaign.budgetResourceName)
    return fail("UNKNOWN_ENTITY", "payload.campaign", `${campaign.name} has no budget in the snapshot.`);
  if (!changeWithinLimit(campaign.dailyBudget, p.new_daily_amount, ctx.settings.max_budget_change_pct))
    return fail("CHANGE_TOO_LARGE", "payload.new_daily_amount", `$${campaign.dailyBudget} to $${p.new_daily_amount} is more than ${ctx.settings.max_budget_change_pct}%.`);
  const cooldown = cooldownFor(campaign, ctx);
  if (cooldown) return cooldown;
  if (p.new_daily_amount > campaign.dailyBudget) {
    const sum = dailyBudgetSum(ctx.snapshot.campaigns, campaign.resourceName, p.new_daily_amount);
    if (sum > ctx.settings.daily_cap)
      return fail("DAILY_CAP", "payload.new_daily_amount", `Daily budgets would total $${sum.toFixed(2)}, above the $${ctx.settings.daily_cap} daily cap.`);
    const projected = projectedMonthSpend(ctx.funnel.monthToDateSpend, sum, ctx.funnel.daysLeftInMonth);
    if (projected > ctx.settings.monthly_cap)
      return fail("BUDGET_CAP", "payload.new_daily_amount", `Projected month spend $${projected.toFixed(2)} is above the $${ctx.settings.monthly_cap} monthly cap.`);
  }
  return {
    target: `budget:${campaign.resourceName}`,
    payload: {
      campaign: campaign.resourceName,
      campaignId: campaign.id,
      campaignName: campaign.name,
      budgetResourceName: campaign.budgetResourceName,
      currentDailyAmount: campaign.dailyBudget,
      new_daily_amount: p.new_daily_amount,
      reason: p.reason,
    },
  };
}

function adjustCpcCap(p: PayloadFor<"adjust_cpc_cap">, ctx: ValidationContext, look: Lookup): Pass | Fail {
  const campaign = look.campaign(p.campaign, "payload.campaign");
  if ("ok" in campaign) return campaign;
  if (campaign.biddingStrategy !== "MAXIMIZE_CLICKS" || campaign.cpcCeiling == null)
    return fail("UNKNOWN_ENTITY", "payload.campaign", `${campaign.name} is not on Maximize Clicks with a CPC ceiling.`);
  if (!changeWithinLimit(campaign.cpcCeiling, p.new_cpc_cap, ctx.settings.max_budget_change_pct))
    return fail("CHANGE_TOO_LARGE", "payload.new_cpc_cap", `$${campaign.cpcCeiling} to $${p.new_cpc_cap} is more than ${ctx.settings.max_budget_change_pct}%.`);
  const cooldown = cooldownFor(campaign, ctx);
  if (cooldown) return cooldown;
  return {
    target: `cpc:${campaign.resourceName}`,
    payload: {
      campaign: campaign.resourceName,
      campaignId: campaign.id,
      campaignName: campaign.name,
      currentCpcCap: campaign.cpcCeiling,
      new_cpc_cap: p.new_cpc_cap,
      reason: p.reason,
    },
  };
}

function setBiddingStrategy(p: PayloadFor<"set_bidding_strategy">, ctx: ValidationContext, look: Lookup): Pass | Fail {
  const campaign = look.campaign(p.campaign, "payload.campaign");
  if ("ok" in campaign) return campaign;
  const next = ladderNextRung(campaign.biddingStrategy);
  if (!next || next !== p.strategy)
    return fail("LADDER_NOT_MET", "payload.strategy", `${campaign.name} is on ${campaign.biddingStrategy}; the only next rung is ${next ?? "none"}.`);
  if (!ladderTriggerMet(p.strategy, ctx.funnel))
    return fail("LADDER_NOT_MET", "payload.strategy", `${p.strategy} needs the trial-start trigger (last 30 days: ${ctx.funnel.trialStartsLast30}, previous 30: ${ctx.funnel.trialStartsPrev30}).`);
  if (p.strategy === "TARGET_CPA" && !p.target_cpa)
    return fail("LADDER_NOT_MET", "payload.target_cpa", "Target CPA needs a target.");
  return {
    target: `bidding:${campaign.resourceName}`,
    payload: {
      campaign: campaign.resourceName,
      campaignId: campaign.id,
      campaignName: campaign.name,
      currentStrategy: campaign.biddingStrategy,
      strategy: p.strategy,
      target_cpa: p.target_cpa ?? null,
      cpcCeiling: campaign.cpcCeiling,
    },
  };
}

function addAdGroup(p: PayloadFor<"add_ad_group">, ctx: ValidationContext, look: Lookup): Pass | Fail {
  const campaign = look.campaign(p.campaign, "payload.campaign");
  if ("ok" in campaign) return campaign;
  const clash = ctx.snapshot.adGroups.find(
    (g) => g.campaignResourceName === campaign.resourceName && g.name.trim().toLowerCase() === p.name.trim().toLowerCase()
  );
  if (clash) return fail("ALREADY_APPLIED", "payload.name", `${campaign.name} already has an ad group named "${clash.name}".`);
  if (!isAllowedFinalUrl(p.final_url, ctx.allowedFinalUrls))
    return fail("URL_NOT_ALLOWED", "payload.final_url", `Landing URL must be one of ${ctx.allowedFinalUrls.join(", ")}.`);
  for (const [index, term] of p.keywords.entries()) {
    if (term.matchType === "BROAD")
      return fail("BROAD_MATCH_REJECTED", `payload.keywords[${index}]`, "No broad match. Use PHRASE or EXACT.");
  }
  for (const [index, ad] of p.ads.entries()) {
    if (!sameUrl(ad.final_url, p.final_url))
      return fail("URL_NOT_ALLOWED", `payload.ads[${index}].final_url`, "Every ad lands on the ad group's page.");
    const copy = copyRejected(ad, campaign, p.final_url, `payload.ads[${index}]`);
    if (copy) return copy;
  }
  return {
    target: `ad_group:${campaign.resourceName}:${slug(p.name)}`,
    payload: {
      campaign: campaign.resourceName,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignKind: campaign.kind,
      name: p.name.trim(),
      theme: p.theme.trim(),
      final_url: p.final_url,
      keywords: p.keywords.map((k) => ({ text: k.text.trim().toLowerCase(), matchType: k.matchType })),
      ads: p.ads,
    },
  };
}

function observation(p: PayloadFor<"observation">): Pass {
  return { target: `observation:${hash8(p.text.trim().toLowerCase())}`, payload: { text: p.text.trim() } };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function validateProposal(input: unknown, ctx: ValidationContext): ValidationResult {
  const envelope = envelopeSchema.safeParse(input);
  if (!envelope.success) return { ok: false, code: "SCHEMA_INVALID", issues: issuesOf(envelope.error) };
  const kind: ProposalKind = envelope.data.kind;
  const parsed = payloadSchemas[kind].safeParse(envelope.data.payload);
  if (!parsed.success) return { ok: false, code: "SCHEMA_INVALID", issues: issuesOf(parsed.error, "payload") };

  const structural = STRUCTURAL_KINDS.has(kind);
  if (structural && ctx.structuralAcceptedThisRun >= ctx.settings.max_structural_per_run)
    return fail("STRUCTURAL_LIMIT", "kind", `This run already filed ${ctx.structuralAcceptedThisRun} structural proposals; the limit is ${ctx.settings.max_structural_per_run}.`);

  const look = new Lookup(ctx);
  let outcome: Pass | Fail;
  switch (kind) {
    case "add_negatives":
      outcome = addNegatives(parsed.data as PayloadFor<"add_negatives">, ctx);
      break;
    case "pause_keyword":
      outcome = pauseKeyword(parsed.data as PayloadFor<"pause_keyword">, ctx, look);
      break;
    case "add_keywords":
      outcome = addKeywords(parsed.data as PayloadFor<"add_keywords">, ctx, look);
      break;
    case "create_rsa_challenger":
      outcome = createChallenger(parsed.data as PayloadFor<"create_rsa_challenger">, ctx, look);
      break;
    case "promote_challenger":
      outcome = promoteChallenger(parsed.data as PayloadFor<"promote_challenger">, ctx, look);
      break;
    case "pause_ad":
      outcome = pauseAd(parsed.data as PayloadFor<"pause_ad">, ctx, look);
      break;
    case "adjust_budget":
      outcome = adjustBudget(parsed.data as PayloadFor<"adjust_budget">, ctx, look);
      break;
    case "adjust_cpc_cap":
      outcome = adjustCpcCap(parsed.data as PayloadFor<"adjust_cpc_cap">, ctx, look);
      break;
    case "set_bidding_strategy":
      outcome = setBiddingStrategy(parsed.data as PayloadFor<"set_bidding_strategy">, ctx, look);
      break;
    case "add_ad_group":
      outcome = addAdGroup(parsed.data as PayloadFor<"add_ad_group">, ctx, look);
      break;
    case "observation":
      outcome = observation(parsed.data as PayloadFor<"observation">);
      break;
  }
  if ("ok" in outcome) return outcome;

  const duplicate = ctx.openProposals.find((open) => open.target === outcome.target);
  if (duplicate)
    return fail("DUPLICATE_PROPOSAL", "kind", `The same change is already waiting (${duplicate.state}, proposal ${duplicate.id}).`, duplicate.id);

  const normalized: NormalizedProposal = {
    kind,
    target: outcome.target,
    payload: outcome.payload,
    evidence: envelope.data.evidence,
    rationale: envelope.data.rationale,
    structural,
  };
  return { ok: true, normalized };
}
