/**
 * Google Ads engine — shared types.
 *
 * Types only. The entity snapshot and the metric windows are OPS's normalised
 * view of the warehouse (phase 1 tables), so the validators, the brief, the
 * apply layer and the console never depend on Google's raw resource shapes.
 */

export const PROPOSAL_KINDS = [
  "add_negatives",
  "pause_keyword",
  "add_keywords",
  "create_rsa_challenger",
  "promote_challenger",
  "pause_ad",
  "adjust_budget",
  "adjust_cpc_cap",
  "set_bidding_strategy",
  "add_ad_group",
  "observation",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export type ProposalMode = "propose" | "auto" | "off";
export type ProposalState =
  | "proposed"
  | "approved"
  | "rejected"
  | "applied"
  | "failed"
  | "expired";

export interface EngineSettings {
  modes: Record<ProposalKind, ProposalMode>;
  monthly_cap: number;
  daily_cap: number;
  max_budget_change_pct: number;
  budget_cooldown_days: number;
  max_structural_per_run: number;
  lease_minutes: number;
  stall_hours: number;
  target_cost_per_trial: number;
  heartbeat_at: string | null;
}

// ─── Entity snapshot (from ads_entities) ────────────────────────────────────

export type CampaignKind = "brand" | "core" | "competitor" | "legacy" | "other";
export type EntityStatus = "ENABLED" | "PAUSED" | "REMOVED" | "UNKNOWN";
export type MatchType = "EXACT" | "PHRASE" | "BROAD";
export type BiddingStrategy =
  | "MANUAL_CPC"
  | "MAXIMIZE_CLICKS"
  | "MAXIMIZE_CONVERSIONS"
  | "TARGET_CPA"
  | "OTHER";

export interface SnapshotCampaign {
  resourceName: string;
  id: string;
  name: string;
  status: EntityStatus;
  labels: string[];
  kind: CampaignKind;
  budgetResourceName: string | null;
  /** Daily budget in account currency (CAD). */
  dailyBudget: number | null;
  biddingStrategy: BiddingStrategy;
  /** CPC ceiling in account currency, when the strategy carries one. */
  cpcCeiling: number | null;
  targetCpa: number | null;
}

export interface SnapshotAdGroup {
  resourceName: string;
  id: string;
  name: string;
  campaignResourceName: string;
  status: EntityStatus;
  labels: string[];
  /** The landing page its ads point at (first final URL seen). */
  finalUrl: string | null;
}

export type PinnedField =
  | "HEADLINE_1"
  | "HEADLINE_2"
  | "HEADLINE_3"
  | "DESCRIPTION_1"
  | "DESCRIPTION_2";

export interface RsaAsset {
  text: string;
  pinnedField?: PinnedField;
}

export interface SnapshotAd {
  resourceName: string;
  id: string;
  adGroupResourceName: string;
  status: EntityStatus;
  labels: string[];
  role: "control" | "challenger" | null;
  approvalStatus: string | null;
  reviewStatus: string | null;
  finalUrls: string[];
  headlines: RsaAsset[];
  descriptions: RsaAsset[];
  path1: string | null;
  path2: string | null;
}

export interface SnapshotKeyword {
  resourceName: string;
  criterionId: string;
  adGroupResourceName: string;
  text: string;
  matchType: MatchType;
  status: EntityStatus;
  negative: boolean;
}

export interface SnapshotSharedSet {
  resourceName: string;
  id: string;
  name: string;
  type: string;
  members: Array<{ resourceName: string; text: string; matchType: MatchType }>;
  /** Campaigns the set is attached to. */
  campaignResourceNames: string[];
}

export interface SnapshotCampaignNegative {
  resourceName: string;
  campaignResourceName: string;
  text: string;
  matchType: MatchType;
}

export interface SnapshotLabel {
  resourceName: string;
  name: string;
}

export interface EntitySnapshot {
  snapshotAt: string | null;
  campaigns: SnapshotCampaign[];
  adGroups: SnapshotAdGroup[];
  ads: SnapshotAd[];
  keywords: SnapshotKeyword[];
  sharedSets: SnapshotSharedSet[];
  campaignNegatives: SnapshotCampaignNegative[];
  labels: SnapshotLabel[];
}

// ─── Metrics (trailing 3 days always excluded) ──────────────────────────────

export interface CampaignMetric {
  campaignId: string;
  campaignName: string;
  clicks: number;
  impressions: number;
  spend: number;
  conversions: number;
  /** Days in the window on which the campaign was capped by budget. */
  budgetLostDays: number;
  days: number;
}

export interface AdGroupMetric {
  adGroupId: string;
  campaignId: string;
  clicks: number;
  impressions: number;
  spend: number;
  conversions: number;
}

export interface AdMetric {
  adId: string;
  adGroupId: string;
  clicks: number;
  impressions: number;
  spend: number;
  conversions: number;
  ctr: number;
  approvalStatus: string | null;
  adStrength: string | null;
  days: number;
}

export interface KeywordMetric {
  criterionId: string;
  adGroupId: string;
  text: string;
  matchType: MatchType;
  clicks: number;
  impressions: number;
  spend: number;
  conversions: number;
  qualityScore: number | null;
  /** First warehouse day with a row for this keyword (any window). */
  firstSeen: string | null;
  days: number;
}

export interface SearchTermMetric {
  term: string;
  campaignName: string;
  adGroupName: string;
  clicks: number;
  impressions: number;
  spend: number;
  /** Google's conversions on the term = trial starts once phase 1 uploads them. */
  conversions: number;
}

export interface AssetMetric {
  adId: string;
  assetId: string;
  fieldType: string;
  text: string | null;
  performanceLabel: string | null;
  pinnedField: string | null;
  impressions: number;
  clicks: number;
}

export interface MetricsWindow {
  from: string;
  to: string;
  campaigns: CampaignMetric[];
  adGroups: AdGroupMetric[];
  ads: AdMetric[];
  keywords: KeywordMetric[];
  searchTerms: SearchTermMetric[];
  assets: AssetMetric[];
}

// ─── Ledger rows ─────────────────────────────────────────────────────────────

export type TestState =
  | "running"
  | "control_won"
  | "challenger_won"
  | "no_verdict"
  | "cancelled";

export interface TestRecord {
  id: string;
  campaign_id: string | null;
  ad_group_id: string;
  ad_group_name: string | null;
  control_ad_id: string;
  challenger_ad_id: string;
  started_at: string;
  min_days: number;
  min_impressions: number;
  max_days: number;
  state: TestState;
  stats: Record<string, unknown> | null;
  verdict_at: string | null;
}

export type ChangeVerdict = "pending" | "better" | "worse" | "flat" | "no_verdict";

export interface ChangeRecord {
  id: string;
  proposal_id: string;
  kind: ProposalKind;
  campaign_id: string | null;
  ad_group_id: string | null;
  resource_names: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  applied_at: string;
  measure_from: string;
  measure_to: string;
  pre_metrics: Record<string, unknown> | null;
  post_metrics: Record<string, unknown> | null;
  verdict: ChangeVerdict;
  verdict_at: string | null;
}

export interface OpenProposalRef {
  id: string;
  kind: ProposalKind;
  target: string;
  state: "proposed" | "approved";
  /** The stored payload, so term-level overlap can be filtered. */
  payload?: Record<string, unknown> | null;
}

export interface FunnelSignals {
  /** Trial starts Google could see (sent conversion events) in the last 30 days. */
  trialStartsLast30: number;
  /** The 30 days before that. */
  trialStartsPrev30: number;
  /** Account spend since the first of the current month (CAD). */
  monthToDateSpend: number;
  /** Calendar days left in the current month, today included. */
  daysLeftInMonth: number;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export const VALIDATION_CODES = [
  "SCHEMA_INVALID",
  "UNKNOWN_ENTITY",
  "LEGACY_ENTITY",
  "INSUFFICIENT_DATA",
  "TERM_PRODUCED_TRIAL",
  "TERM_NOT_IN_REPORT",
  "BROAD_MATCH_REJECTED",
  "THEME_MISMATCH",
  "BUDGET_CAP",
  "DAILY_CAP",
  "COOLDOWN",
  "CHANGE_TOO_LARGE",
  "LADDER_NOT_MET",
  "TEST_NOT_CONCLUDED",
  "VERDICT_MISMATCH",
  "NO_CONTROL_AD",
  "URL_NOT_ALLOWED",
  "STRUCTURAL_LIMIT",
  "DUPLICATE_PROPOSAL",
  "ALREADY_APPLIED",
  "COPY_REJECTED",
] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

export interface ValidationIssue {
  code: string;
  field: string;
  message: string;
}

export interface NormalizedProposal {
  kind: ProposalKind;
  /** Normalised key of the entity acted on; two open proposals never share one. */
  target: string;
  payload: Record<string, unknown>;
  evidence: unknown[];
  rationale: string;
  structural: boolean;
}

export type ValidationResult =
  | { ok: true; normalized: NormalizedProposal }
  | { ok: false; code: ValidationCode; issues: ValidationIssue[] };

export interface ValidationContext {
  settings: EngineSettings;
  snapshot: EntitySnapshot;
  metrics28d: MetricsWindow;
  tests: TestRecord[];
  /** Applied changes in the last 90 days. */
  ledger: ChangeRecord[];
  openProposals: OpenProposalRef[];
  funnel: FunnelSignals;
  allowedFinalUrls: string[];
  /** Structural proposals already accepted in the current run. */
  structuralAcceptedThisRun: number;
  now: Date;
}
