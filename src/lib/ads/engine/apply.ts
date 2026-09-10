/**
 * Google Ads engine — applying an approved proposal (design spec §5.3).
 *
 * `planOperations` is pure: proposal + snapshot → Google mutate operations
 * with temporary ids wired parent to child, the before/after the ledger
 * records, and the test to open. `applyProposal` runs validateOnly first and
 * only re-sends on a clean pass, with partial failure OFF so a change lands
 * whole or not at all. In rehearsal mode (`ADS_ENGINE_REHEARSAL=1`) it stops
 * after validation and leaves the proposal approved.
 *
 * Google labels attach to ads, keywords and ad groups; budgets, bidding and
 * shared negatives cannot carry one, so every change also records its
 * `gen-<run id>` label in the ledger.
 */
import type { EntitySnapshot, ProposalKind, ProposalState } from "./types";

// ─── Gateway contract (mirrors phase 1's mutateGoogleAds) ────────────────────

export interface MutateOperation {
  [service: `${string}Operation`]: Record<string, unknown>;
}
export interface MutateFailure {
  index: number | null;
  code: string;
  message: string;
  /** Policy topics when the failure is a POLICY_FINDING. */
  topics?: string[];
}
export interface MutateResult {
  results: Array<Record<string, unknown>>;
  failures: MutateFailure[];
  requestId?: string;
}

export interface AdsGateway {
  customerId(): Promise<string>;
  mutate(
    operations: MutateOperation[],
    options: { validateOnly: boolean; partialFailure?: boolean }
  ): Promise<MutateResult>;
}

// ─── Repository contract ─────────────────────────────────────────────────────

export interface ApplyProposalRecord {
  id: string;
  run_id: string;
  kind: ProposalKind;
  target: string;
  state: ProposalState;
  mode_at_submit: "propose" | "auto";
  payload: Record<string, unknown>;
}

export interface NewChange {
  proposal_id: string;
  kind: ProposalKind;
  campaign_id: string | null;
  ad_group_id: string | null;
  resource_names: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  label: string | null;
  applied_at: string;
  measure_from: string;
  measure_to: string;
}

export interface NewTest {
  campaign_id: string | null;
  ad_group_id: string;
  ad_group_name: string | null;
  control_ad_id: string;
  challenger_ad_id: string;
  proposal_id: string;
  label: string | null;
  started_at: string;
}

export interface ApplyRepository {
  readSnapshot(): Promise<EntitySnapshot>;
  recordValidation(id: string, validation: Record<string, unknown>): Promise<void>;
  markApplied(
    id: string,
    state: "applied" | "failed",
    validation: Record<string, unknown> | null,
    resourceNames: string[] | null,
    label: string | null,
    error: string | null
  ): Promise<string | null>;
  recordChange(change: NewChange): Promise<string>;
  openTest(test: NewTest): Promise<string>;
  refreshSnapshot(): Promise<void>;
}

export interface ApplyDependencies {
  gateway: AdsGateway;
  repository: ApplyRepository;
  now: () => Date;
  /** Stop after validateOnly; the proposal stays approved. */
  rehearsal: boolean;
  appliedBy: "operator" | "auto";
}

export type ApplyOutcome =
  | { state: "applied"; validation: MutateResult; resourceNames: string[]; label: string | null; changeId: string | null; testId: string | null }
  | { state: "validated"; validation: MutateResult; label: string | null }
  | { state: "failed"; validation: MutateResult | null; error: string; policyTopics: string[] };

// ─── Google refusals in one line ─────────────────────────────────────────────

/**
 * The client throws "Google Ads API error (400): <GoogleAdsFailure json>".
 * The card shows one line a person can act on: the error code, Google's
 * message, the field it points at and the request id; the raw text stays in
 * the validation record for anyone who needs the whole thing.
 */
export function describeGoogleError(raw: string): string {
  const match = /^Google Ads API error \((\d{3})\): ([\s\S]*)$/.exec(raw.trim());
  if (!match) return raw;
  const status = match[1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[2]);
  } catch {
    return `Google refused this change (${status}): ${match[2].slice(0, 300)}`;
  }
  const body = Array.isArray(parsed) ? parsed[0] : parsed;
  const err = isRecord(body) && isRecord(body.error) ? body.error : null;
  const details = err && Array.isArray(err.details) ? err.details : [];
  const failure = details.find((d): d is Record<string, unknown> => isRecord(d) && Array.isArray(d.errors));
  const first = failure && Array.isArray(failure.errors) && isRecord(failure.errors[0]) ? failure.errors[0] : null;
  const codeMap = first && isRecord(first.errorCode) ? first.errorCode : null;
  const code = codeMap ? Object.values(codeMap).find((v) => typeof v === "string") : null;
  const message = first && typeof first.message === "string" ? first.message.replace(/\.$/, "") : err && typeof err.message === "string" ? err.message : "no detail";
  const location = first && isRecord(first.location) && Array.isArray(first.location.fieldPathElements)
    ? first.location.fieldPathElements
        .map((e) => (isRecord(e) && typeof e.fieldName === "string" ? (typeof e.index === "number" ? `${e.fieldName}[${e.index}]` : e.fieldName) : null))
        .filter((x): x is string => !!x)
        .join(".")
    : "";
  const requestId = failure && typeof failure.requestId === "string" ? failure.requestId : null;
  const parts = [`Google refused this change (${status}${code ? ` ${code}` : ""}): ${message}`];
  if (location) parts.push(location);
  if (requestId) parts.push(`request ${requestId}`);
  return parts.join(" · ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── Planning ────────────────────────────────────────────────────────────────

export interface Plan {
  operations: MutateOperation[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  campaignId: string | null;
  adGroupId: string | null;
  label: string | null;
  /** A test to open once the ad exists; the challenger id comes from the result. */
  test: Omit<NewTest, "challenger_ad_id" | "proposal_id" | "label" | "started_at"> & { adOperationIndex: number } | null;
}

export const MEASUREMENT_WINDOW_DAYS = 14;
export const MEASUREMENT_START_OFFSET_DAYS = 1;

const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const micros = (dollars: number): string => String(Math.round(dollars * 1_000_000));

class TempIds {
  private next = -1;
  take(): number {
    const id = this.next;
    this.next -= 1;
    return id;
  }
}

function labelsFor(runId: string): { gen: string } {
  return { gen: `gen-${runId}` };
}

/**
 * Resolve a label to a resource name, creating it in the same mutate when the
 * account does not have it yet. Returns the operations to prepend.
 */
function ensureLabel(
  name: string,
  known: Record<string, string>,
  customerId: string,
  temp: TempIds,
  operations: MutateOperation[]
): string {
  if (known[name]) return known[name];
  const resourceName = `customers/${customerId}/labels/${temp.take()}`;
  operations.push({ labelOperation: { create: { resourceName, name } } });
  known[name] = resourceName;
  return resourceName;
}

function rsaCreate(rsa: Record<string, unknown>): Record<string, unknown> {
  const assets = (value: unknown) =>
    Array.isArray(value)
      ? value.map((asset) => {
          const a = asset as { text: string; pinnedField?: string };
          return a.pinnedField ? { text: a.text, pinnedField: a.pinnedField } : { text: a.text };
        })
      : [];
  const ad: Record<string, unknown> = {
    finalUrls: [str(rsa.final_url)],
    responsiveSearchAd: {
      headlines: assets(rsa.headlines),
      descriptions: assets(rsa.descriptions),
      ...(rsa.path1 ? { path1: str(rsa.path1) } : {}),
      ...(rsa.path2 ? { path2: str(rsa.path2) } : {}),
    },
  };
  return ad;
}

export function planOperations(
  proposal: ApplyProposalRecord,
  snapshot: EntitySnapshot,
  knownLabels: Record<string, string>,
  customerId: string,
  now: Date
): Plan {
  void now;
  const p = proposal.payload;
  const temp = new TempIds();
  const labels = { ...knownLabels };
  const operations: MutateOperation[] = [];
  const { gen } = labelsFor(proposal.run_id);
  const empty: Plan = { operations, before: null, after: null, campaignId: null, adGroupId: null, label: gen, test: null };

  switch (proposal.kind) {
    case "add_negatives": {
      const list = snapshot.sharedSets.find((s) => s.resourceName === str(p.listResourceName));
      const terms = (p.terms as Array<{ text: string; matchType: string }>) ?? [];
      for (const term of terms)
        operations.push({ sharedCriterionOperation: { create: { sharedSet: str(p.listResourceName), keyword: { text: term.text, matchType: term.matchType } } } });
      return {
        ...empty,
        before: { members: list?.members.length ?? 0 },
        after: { members: (list?.members.length ?? 0) + terms.length, added: terms.map((t) => t.text) },
      };
    }
    case "pause_keyword": {
      const adGroup = snapshot.adGroups.find((g) => g.resourceName === str(p.adGroup));
      const campaign = snapshot.campaigns.find((c) => c.resourceName === str(p.campaign));
      operations.push({ adGroupCriterionOperation: { update: { resourceName: str(p.criterion), status: "PAUSED" }, updateMask: "status" } });
      return {
        ...empty,
        before: { status: "ENABLED", text: str(p.text), matchType: str(p.matchType) },
        after: { status: "PAUSED" },
        campaignId: campaign?.id ?? null,
        adGroupId: adGroup?.id ?? null,
      };
    }
    case "add_keywords": {
      const adGroup = snapshot.adGroups.find((g) => g.resourceName === str(p.ad_group));
      const campaign = snapshot.campaigns.find((c) => c.resourceName === str(p.campaign));
      const engine = ensureLabel("engine", labels, customerId, temp, operations);
      const genLabel = ensureLabel(gen, labels, customerId, temp, operations);
      const terms = (p.terms as Array<{ text: string; matchType: string }>) ?? [];
      const created: string[] = [];
      for (const term of terms) {
        const resourceName = `customers/${customerId}/adGroupCriteria/${adGroup?.id ?? "0"}~${temp.take()}`;
        created.push(resourceName);
        operations.push({ adGroupCriterionOperation: { create: { resourceName, adGroup: str(p.ad_group), status: "ENABLED", keyword: { text: term.text, matchType: term.matchType } } } });
      }
      for (const resourceName of created) {
        operations.push({ adGroupCriterionLabelOperation: { create: { adGroupCriterion: resourceName, label: engine } } });
        operations.push({ adGroupCriterionLabelOperation: { create: { adGroupCriterion: resourceName, label: genLabel } } });
      }
      return {
        ...empty,
        before: { keywords: snapshot.keywords.filter((k) => k.adGroupResourceName === str(p.ad_group) && !k.negative).length },
        after: { added: terms.map((t) => `${t.text} [${t.matchType}]`) },
        campaignId: campaign?.id ?? null,
        adGroupId: adGroup?.id ?? null,
      };
    }
    case "create_rsa_challenger": {
      const adGroupId = str(p.adGroupId);
      const genLabel = ensureLabel(gen, labels, customerId, temp, operations);
      const engine = ensureLabel("engine", labels, customerId, temp, operations);
      const challenger = ensureLabel("role-challenger", labels, customerId, temp, operations);
      const resourceName = `customers/${customerId}/adGroupAds/${adGroupId}~${temp.take()}`;
      const adOperationIndex = operations.length;
      operations.push({ adGroupAdOperation: { create: { resourceName, adGroup: str(p.ad_group), status: "ENABLED", ad: rsaCreate(p) } } });
      operations.push({ adGroupAdLabelOperation: { create: { adGroupAd: resourceName, label: engine } } });
      operations.push({ adGroupAdLabelOperation: { create: { adGroupAd: resourceName, label: genLabel } } });
      operations.push({ adGroupAdLabelOperation: { create: { adGroupAd: resourceName, label: challenger } } });
      return {
        ...empty,
        before: { control: str(p.controlAd) },
        after: { challenger: "new", hypothesis: str(p.hypothesis), finalUrl: str(p.final_url) },
        campaignId: str(p.campaignId) || null,
        adGroupId: adGroupId || null,
        test: {
          campaign_id: str(p.campaignId) || null,
          ad_group_id: adGroupId,
          ad_group_name: str(p.adGroupName) || null,
          control_ad_id: str(p.controlAdId),
          adOperationIndex,
        },
      };
    }
    case "promote_challenger": {
      const winner = snapshot.ads.find((a) => a.resourceName === str(p.winner));
      const loser = str(p.loser);
      const control = ensureLabel("role-control", labels, customerId, temp, operations);
      operations.push({ adGroupAdOperation: { update: { resourceName: loser, status: "PAUSED" }, updateMask: "status" } });
      const challengerLabel = snapshot.labels.find((l) => l.name === "role-challenger");
      if (winner && challengerLabel && winner.labels.includes("role-challenger")) {
        const labelId = challengerLabel.resourceName.split("/").pop();
        operations.push({ adGroupAdLabelOperation: { remove: `customers/${customerId}/adGroupAdLabels/${str(p.adGroupId)}~${winner.id}~${labelId}` } });
      }
      operations.push({ adGroupAdLabelOperation: { create: { adGroupAd: str(p.winner), label: control } } });
      return {
        ...empty,
        before: { control: loser, challenger: str(p.winner) },
        after: { control: str(p.winner), paused: loser },
        campaignId: str(p.campaignId) || null,
        adGroupId: str(p.adGroupId) || null,
      };
    }
    case "pause_ad":
      operations.push({ adGroupAdOperation: { update: { resourceName: str(p.ad), status: "PAUSED" }, updateMask: "status" } });
      return { ...empty, before: { status: "ENABLED" }, after: { status: "PAUSED", reason: str(p.reason) }, campaignId: str(p.campaignId) || null, adGroupId: str(p.adGroupId) || null };
    case "adjust_budget":
      operations.push({ campaignBudgetOperation: { update: { resourceName: str(p.budgetResourceName), amountMicros: micros(Number(p.new_daily_amount)) }, updateMask: "amountMicros" } });
      return { ...empty, before: { dailyBudget: Number(p.currentDailyAmount) }, after: { dailyBudget: Number(p.new_daily_amount) }, campaignId: str(p.campaignId) || null };
    case "adjust_cpc_cap":
      operations.push({ campaignOperation: { update: { resourceName: str(p.campaign), targetSpend: { cpcBidCeilingMicros: micros(Number(p.new_cpc_cap)) } }, updateMask: "target_spend.cpc_bid_ceiling_micros" } });
      return { ...empty, before: { cpcCeiling: Number(p.currentCpcCap) }, after: { cpcCeiling: Number(p.new_cpc_cap) }, campaignId: str(p.campaignId) || null };
    case "set_bidding_strategy": {
      const strategy = str(p.strategy);
      if (strategy === "TARGET_CPA")
        operations.push({ campaignOperation: { update: { resourceName: str(p.campaign), targetCpa: { targetCpaMicros: micros(Number(p.target_cpa)) } }, updateMask: "targetCpa" } });
      else if (strategy === "MAXIMIZE_CONVERSIONS")
        operations.push({ campaignOperation: { update: { resourceName: str(p.campaign), maximizeConversions: {} }, updateMask: "maximizeConversions" } });
      else
        operations.push({ campaignOperation: { update: { resourceName: str(p.campaign), targetSpend: p.cpcCeiling != null ? { cpcBidCeilingMicros: micros(Number(p.cpcCeiling)) } : {} }, updateMask: "target_spend" } });
      return { ...empty, before: { strategy: str(p.currentStrategy) }, after: { strategy, targetCpa: p.target_cpa ?? null }, campaignId: str(p.campaignId) || null };
    }
    case "add_ad_group": {
      const genLabel = ensureLabel(gen, labels, customerId, temp, operations);
      const engine = ensureLabel("engine", labels, customerId, temp, operations);
      const control = ensureLabel("role-control", labels, customerId, temp, operations);
      const challenger = ensureLabel("role-challenger", labels, customerId, temp, operations);
      const groupTemp = temp.take();
      const group = `customers/${customerId}/adGroups/${groupTemp}`;
      operations.push({ adGroupOperation: { create: { resourceName: group, campaign: str(p.campaign), name: str(p.name), status: "ENABLED", type: "SEARCH_STANDARD" } } });
      const keywords = (p.keywords as Array<{ text: string; matchType: string }>) ?? [];
      const keywordNames: string[] = [];
      for (const term of keywords) {
        const resourceName = `customers/${customerId}/adGroupCriteria/${groupTemp}~${temp.take()}`;
        keywordNames.push(resourceName);
        operations.push({ adGroupCriterionOperation: { create: { resourceName, adGroup: group, status: "ENABLED", keyword: { text: term.text, matchType: term.matchType } } } });
      }
      const ads = (p.ads as Array<Record<string, unknown>>) ?? [];
      ads.forEach((rsa, index) => {
        const resourceName = `customers/${customerId}/adGroupAds/${groupTemp}~${temp.take()}`;
        operations.push({ adGroupAdOperation: { create: { resourceName, adGroup: group, status: "ENABLED", ad: rsaCreate({ ...rsa, final_url: rsa.final_url ?? p.final_url }) } } });
        operations.push({ adGroupAdLabelOperation: { create: { adGroupAd: resourceName, label: engine } } });
        operations.push({ adGroupAdLabelOperation: { create: { adGroupAd: resourceName, label: genLabel } } });
        operations.push({ adGroupAdLabelOperation: { create: { adGroupAd: resourceName, label: index === 0 ? control : challenger } } });
      });
      for (const resourceName of keywordNames)
        operations.push({ adGroupCriterionLabelOperation: { create: { adGroupCriterion: resourceName, label: engine } } });
      return {
        ...empty,
        before: { adGroups: snapshot.adGroups.filter((g) => g.campaignResourceName === str(p.campaign)).length },
        after: { name: str(p.name), theme: str(p.theme), finalUrl: str(p.final_url), keywords: keywords.length, ads: ads.length },
        campaignId: str(p.campaignId) || null,
      };
    }
    case "observation":
      return { ...empty, label: null };
  }
}

// ─── Application ─────────────────────────────────────────────────────────────

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resourceNamesOf(result: MutateResult): string[] {
  const names: string[] = [];
  for (const entry of result.results) {
    for (const value of Object.values(entry)) {
      const name = (value as { resourceName?: unknown } | null)?.resourceName;
      if (typeof name === "string") names.push(name);
    }
  }
  return names;
}

function validationRecord(result: MutateResult, validateOnly: boolean, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { validateOnly, requestId: result.requestId ?? null, failures: result.failures, results: result.results.length, ...extra };
}

function policyTopicsOf(result: MutateResult): string[] {
  const topics = new Set<string>();
  for (const failure of result.failures) {
    if (failure.code !== "POLICY_FINDING" && !/POLICY/i.test(failure.code)) continue;
    for (const topic of failure.topics ?? []) topics.add(topic);
    if (!failure.topics?.length) topics.add(failure.message);
  }
  return [...topics];
}

function failureSummary(result: MutateResult): string {
  return result.failures.map((f) => `${f.code}${f.index != null ? `@${f.index}` : ""}: ${f.message}`).join("; ").slice(0, 3900);
}

export async function applyProposal(proposal: ApplyProposalRecord, deps: ApplyDependencies): Promise<ApplyOutcome> {
  const applicable = proposal.state === "approved" || (proposal.state === "proposed" && proposal.mode_at_submit === "auto");
  if (!applicable) throw new Error(`Proposal ${proposal.id} is ${proposal.state}; not applicable.`);

  const now = deps.now();
  const [snapshot, customerId] = await Promise.all([deps.repository.readSnapshot(), deps.gateway.customerId()]);
  const knownLabels = Object.fromEntries(snapshot.labels.map((l) => [l.name, l.resourceName]));
  const plan = planOperations(proposal, snapshot, knownLabels, customerId, now);

  if (plan.operations.length === 0) {
    await deps.repository.markApplied(proposal.id, "applied", { validateOnly: false, noop: true }, [], plan.label, null);
    return { state: "applied", validation: { results: [], failures: [] }, resourceNames: [], label: plan.label, changeId: null, testId: null };
  }

  let validation: MutateResult;
  try {
    validation = await deps.gateway.mutate(plan.operations, { validateOnly: true, partialFailure: false });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = describeGoogleError(raw);
    await deps.repository.markApplied(proposal.id, "failed", { validateOnly: true, error: raw }, null, plan.label, message);
    return { state: "failed", validation: null, error: message, policyTopics: [] };
  }
  if (validation.failures.length > 0) {
    const error = failureSummary(validation);
    await deps.repository.markApplied(proposal.id, "failed", validationRecord(validation, true), null, plan.label, error);
    return { state: "failed", validation, error, policyTopics: policyTopicsOf(validation) };
  }

  if (deps.rehearsal) {
    await deps.repository.recordValidation(proposal.id, validationRecord(validation, true, { rehearsal: true, at: now.toISOString() }));
    return { state: "validated", validation, label: plan.label };
  }

  let real: MutateResult;
  try {
    real = await deps.gateway.mutate(plan.operations, { validateOnly: false, partialFailure: false });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = describeGoogleError(raw);
    await deps.repository.markApplied(proposal.id, "failed", validationRecord(validation, true, { realError: raw }), null, plan.label, message);
    return { state: "failed", validation, error: message, policyTopics: [] };
  }
  if (real.failures.length > 0) {
    const error = failureSummary(real);
    await deps.repository.markApplied(proposal.id, "failed", validationRecord(real, false), null, plan.label, error);
    return { state: "failed", validation: real, error, policyTopics: policyTopicsOf(real) };
  }

  const resourceNames = resourceNamesOf(real);
  await deps.repository.markApplied(proposal.id, "applied", validationRecord(real, false, { validatedRequestId: validation.requestId ?? null }), resourceNames, plan.label, null);

  const appliedAt = now.toISOString();
  const measureFrom = new Date(now.getTime() + MEASUREMENT_START_OFFSET_DAYS * 86_400_000);
  const measureTo = new Date(measureFrom.getTime() + (MEASUREMENT_WINDOW_DAYS - 1) * 86_400_000);
  const changeId = await deps.repository.recordChange({
    proposal_id: proposal.id,
    kind: proposal.kind,
    campaign_id: plan.campaignId,
    ad_group_id: plan.adGroupId,
    resource_names: resourceNames,
    before: plan.before,
    after: plan.after,
    label: plan.label,
    applied_at: appliedAt,
    measure_from: isoDay(measureFrom),
    measure_to: isoDay(measureTo),
  });

  let testId: string | null = null;
  if (plan.test) {
    const adResult = real.results[plan.test.adOperationIndex] as Record<string, { resourceName?: string }> | undefined;
    const adResource = adResult ? Object.values(adResult)[0]?.resourceName : undefined;
    const challengerId = adResource?.split("~").pop() ?? "";
    if (challengerId) {
      const { adOperationIndex: _index, ...test } = plan.test;
      void _index;
      testId = await deps.repository.openTest({ ...test, challenger_ad_id: challengerId, proposal_id: proposal.id, label: plan.label, started_at: appliedAt });
    }
  }

  try {
    await deps.repository.refreshSnapshot();
  } catch (error) {
    console.error("[ads-engine] snapshot refresh after apply failed", error);
  }

  return { state: "applied", validation: real, resourceNames, label: plan.label, changeId, testId };
}
