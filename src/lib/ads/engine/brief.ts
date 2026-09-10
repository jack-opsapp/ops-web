/**
 * Google Ads engine — the brief a routine claims (design spec §5.1).
 *
 * Everything the routine needs and nothing it should not have: the duties due
 * today, the entity snapshot, 7- and 28-day metrics (trailing three days
 * excluded), the funnel, open tests with OPS-computed stats, the 90-day change
 * ledger with outcomes, pending and rejected proposals with Jackson's reasons,
 * the guardrail settings, the copy rules and brand-facts allowlist, the
 * negative-list taxonomy, and a weekly market digest. No credential, no
 * Google endpoint, nothing that could reach outside OPS.
 */
import type { BrandFacts } from "../copy-rules";
import { COPY_LIMITS } from "../copy-rules";
import { STRUCTURAL_KINDS, ladderTriggerMet } from "./guardrails";
import { metricWindows, type DateWindow } from "./metrics";
import {
  VALIDATION_CODES,
  type ChangeRecord,
  type EngineSettings,
  type EntitySnapshot,
  type FunnelSignals,
  type MetricsWindow,
  type ProposalKind,
  type ProposalState,
  type TestRecord,
} from "./types";

export const ADS_BRIEF_VERSION = "ads-brief-2026-09-10-v1";

export type DutyKey = "hygiene" | "creative" | "structure" | "bidding_ladder";

/** Control ads older than this, with no running test, are due a challenger. */
export const CREATIVE_CADENCE_DAYS = 28;
/** A market digest older than this is refreshed before the run. */
export const MARKET_DIGEST_MAX_AGE_DAYS = 7;

export interface ProposalSummary {
  id: string;
  kind: ProposalKind;
  target: string;
  state: ProposalState;
  payload: Record<string, unknown>;
  rationale: string;
  review_notes: string | null;
  error: string | null;
  google_validation: Record<string, unknown> | null;
  created_at: string;
  expires_at: string;
}

export interface FunnelRow {
  campaign_name: string | null;
  ad_group_name: string | null;
  keyword: string | null;
  clicks: number | null;
  trials: number | null;
  activated: number | null;
  paid: number | null;
  spend: number | null;
  cost_per_trial: number | null;
  cost_per_paid: number | null;
}

export interface RunSummary {
  duties: string[];
  state: string;
}

export interface MarketDigest {
  text: string;
  generatedAt: string;
}

export interface BriefRepository {
  readSettings(): Promise<EngineSettings>;
  readSnapshot(): Promise<EntitySnapshot>;
  readMetrics(window: DateWindow, snapshot: EntitySnapshot): Promise<MetricsWindow>;
  readTests(): Promise<TestRecord[]>;
  readLedger(sinceIso: string): Promise<ChangeRecord[]>;
  readProposals(): Promise<{
    pending: ProposalSummary[];
    rejected: ProposalSummary[];
    failed: ProposalSummary[];
  }>;
  readFunnel(now: Date): Promise<FunnelSignals>;
  readFunnelByKeyword(): Promise<FunnelRow[]>;
  /** Runs created since the given instant (the current Vancouver month). */
  readRuns(sinceIso: string): Promise<RunSummary[]>;
  readMarketDigest(): Promise<MarketDigest | null>;
  writeMarketDigest(text: string, generatedAt: string): Promise<void>;
}

export interface BriefDependencies {
  repository: BriefRepository;
  now: () => Date;
  /** The OPS copywriter brief the routine writes every ad in. */
  loadCopyBrief: () => { path: string; sha256: string; content: string };
  brandFacts: BrandFacts;
  /** Server-side Tavily research; absent in tests and when the key is unset. */
  marketResearch?: () => Promise<string>;
}

export const NEGATIVE_LIST_TAXONOMY: Array<{ prefix: string; classification: string; hint: string }> = [
  { prefix: "NEG · Job seekers", classification: "job_seeker", hint: "jobs, hiring, salary, apprenticeship, resume" },
  { prefix: "NEG · Homeowner intent", classification: "homeowner", hint: "near me, hire, cost to, how much does, repair, install, emergency, quotes for" },
  { prefix: "NEG · Training", classification: "student", hint: "course, certification, exam, red seal, tutorial, how to" },
  { prefix: "NEG · Generic waste", classification: "irrelevant", hint: "free, open source, template, excel, spreadsheet, pdf, reddit, crack" },
  { prefix: "NEG · Wrong segment", classification: "wrong_segment", hint: "enterprise, erp, fleet, franchise, salesforce, sap, servicetitan" },
];

export interface Brief {
  version: string;
  generated_at: string;
  duties: DutyKey[];
  duty_notes: Partial<Record<DutyKey, string>>;
  settings: EngineSettings;
  windows: { metrics7d: DateWindow; metrics28d: DateWindow };
  snapshot: EntitySnapshot;
  metrics7d: MetricsWindow;
  metrics28d: MetricsWindow;
  funnel: { signals: FunnelSignals; by_keyword: FunnelRow[] };
  tests: TestRecord[];
  ledger_90d: ChangeRecord[];
  proposals: { pending: ProposalSummary[]; rejected: ProposalSummary[]; failed: ProposalSummary[] };
  copy_rules: {
    brief: { path: string; sha256: string; content: string };
    brand_facts: BrandFacts;
    limits: typeof COPY_LIMITS;
    allowed_final_urls: string[];
  };
  negative_taxonomy: {
    lists: Array<{ name: string; resource_name: string; classification: string; hint: string; members: number }>;
    classifications: string[];
  };
  market_digest: { generated_at: string; text: string; stale?: boolean } | null;
  validation_codes: readonly string[];
  structural_kinds: ProposalKind[];
}

export class BriefUnavailableError extends Error {
  readonly reason: "WAREHOUSE_UNAVAILABLE" | "NO_ENGINE_CAMPAIGNS";
  constructor(reason: "WAREHOUSE_UNAVAILABLE" | "NO_ENGINE_CAMPAIGNS", detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "BriefUnavailableError";
    this.reason = reason;
  }
}

// Vancouver adopted permanent UTC-7 in March 2026 (see social worker).
const VANCOUVER_OFFSET_MS = 7 * 3600000;

/** The UTC instant at which the current Vancouver calendar month began. */
export function vancouverMonthStart(now: Date): Date {
  const local = new Date(now.getTime() - VANCOUVER_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + VANCOUVER_OFFSET_MS);
}

export function computeDuties(input: {
  now: Date;
  snapshot: EntitySnapshot;
  metrics28d: MetricsWindow;
  tests: TestRecord[];
  runsThisMonth: RunSummary[];
  funnel: FunnelSignals;
}): { duties: DutyKey[]; notes: Partial<Record<DutyKey, string>> } {
  const duties: DutyKey[] = ["hygiene"];
  const notes: Partial<Record<DutyKey, string>> = {
    hygiene: "Every run: negatives from the search-term report, keywords and ads that earned a pause.",
  };

  const engineCampaigns = new Set(
    input.snapshot.campaigns
      .filter((c) => c.status === "ENABLED" && c.labels.includes("engine") && c.kind !== "legacy")
      .map((c) => c.resourceName)
  );
  const runningGroups = new Set(input.tests.filter((t) => t.state === "running").map((t) => t.ad_group_id));
  const due: string[] = [];
  for (const adGroup of input.snapshot.adGroups) {
    if (adGroup.status !== "ENABLED" || !engineCampaigns.has(adGroup.campaignResourceName)) continue;
    if (runningGroups.has(adGroup.id)) continue;
    const control = input.snapshot.ads.find(
      (ad) => ad.adGroupResourceName === adGroup.resourceName && ad.status === "ENABLED" && ad.role === "control"
    );
    if (!control) continue;
    const metric = input.metrics28d.ads.find((ad) => ad.adId === control.id);
    if (!metric?.firstSeen) continue;
    const ageDays = (input.now.getTime() - Date.parse(metric.firstSeen)) / 86_400_000;
    if (ageDays >= CREATIVE_CADENCE_DAYS) due.push(`${adGroup.name} (control ${Math.floor(ageDays)} days old)`);
  }
  if (due.length > 0) {
    duties.push("creative");
    notes.creative = `Challengers are due in: ${due.join("; ")}.`;
  }

  const structureDone = input.runsThisMonth.some(
    (run) => run.state === "released" && run.duties.includes("structure")
  );
  if (!structureDone) {
    duties.push("structure");
    notes.structure =
      "First run of the month: review ad-group coverage; add at most one trade-specific ad group where OPS has a real customer.";
  }

  if (ladderTriggerMet("MAXIMIZE_CONVERSIONS", input.funnel) || ladderTriggerMet("TARGET_CPA", input.funnel)) {
    duties.push("bidding_ladder");
    notes.bidding_ladder = `Trial starts reached the ladder trigger (last 30 days ${input.funnel.trialStartsLast30}, previous 30 ${input.funnel.trialStartsPrev30}); consider the next rung.`;
  }

  return { duties, notes };
}

function isWarehouseMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|could not find the table|schema cache/i.test(message)
  );
}

async function refreshMarketDigest(d: BriefDependencies, now: Date): Promise<Brief["market_digest"]> {
  let cached: MarketDigest | null = null;
  try {
    cached = await d.repository.readMarketDigest();
  } catch {
    cached = null;
  }
  const fresh =
    cached && now.getTime() - Date.parse(cached.generatedAt) < MARKET_DIGEST_MAX_AGE_DAYS * 86_400_000;
  if (fresh && cached) return { generated_at: cached.generatedAt, text: cached.text };
  if (!d.marketResearch) return cached ? { generated_at: cached.generatedAt, text: cached.text, stale: true } : null;
  try {
    const text = (await d.marketResearch()).trim().slice(0, 40_000);
    if (!text) throw new Error("empty digest");
    const generatedAt = now.toISOString();
    await d.repository.writeMarketDigest(text, generatedAt);
    return { generated_at: generatedAt, text };
  } catch {
    // A research outage never blocks a run; the routine sees a stale digest.
    return cached ? { generated_at: cached.generatedAt, text: cached.text, stale: true } : null;
  }
}

export async function buildBrief(d: BriefDependencies): Promise<Brief> {
  const now = d.now();
  const windows = metricWindows(now);

  let settings: EngineSettings;
  let snapshot: EntitySnapshot;
  let metrics7d: MetricsWindow;
  let metrics28d: MetricsWindow;
  try {
    [settings, snapshot] = await Promise.all([d.repository.readSettings(), d.repository.readSnapshot()]);
    [metrics7d, metrics28d] = await Promise.all([
      d.repository.readMetrics(windows.metrics7d, snapshot),
      d.repository.readMetrics(windows.metrics28d, snapshot),
    ]);
  } catch (error) {
    if (isWarehouseMissing(error))
      throw new BriefUnavailableError("WAREHOUSE_UNAVAILABLE", error instanceof Error ? error.message : undefined);
    throw error;
  }
  if (!snapshot.campaigns.some((c) => c.labels.includes("engine") && c.kind !== "legacy"))
    throw new BriefUnavailableError("NO_ENGINE_CAMPAIGNS", "no campaign carries the engine label");

  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const [tests, ledger, proposals, funnel, byKeyword, runsThisMonth, marketDigest] = await Promise.all([
    d.repository.readTests(),
    d.repository.readLedger(ninetyDaysAgo),
    d.repository.readProposals(),
    d.repository.readFunnel(now),
    d.repository.readFunnelByKeyword().catch((error) => {
      if (isWarehouseMissing(error)) return [] as FunnelRow[];
      throw error;
    }),
    d.repository.readRuns(vancouverMonthStart(now).toISOString()),
    refreshMarketDigest(d, now),
  ]);

  const { duties, notes } = computeDuties({ now, snapshot, metrics28d, tests, runsThisMonth, funnel });
  const copyBrief = d.loadCopyBrief();

  return {
    version: ADS_BRIEF_VERSION,
    generated_at: now.toISOString(),
    duties,
    duty_notes: notes,
    settings,
    windows,
    snapshot,
    metrics7d,
    metrics28d,
    funnel: { signals: funnel, by_keyword: byKeyword },
    tests,
    ledger_90d: ledger,
    proposals,
    copy_rules: {
      brief: copyBrief,
      brand_facts: d.brandFacts,
      limits: COPY_LIMITS,
      allowed_final_urls: d.brandFacts.allowedFinalUrls,
    },
    negative_taxonomy: {
      lists: snapshot.sharedSets
        .filter((set) => set.type === "NEGATIVE_KEYWORDS")
        .map((set) => {
          const entry = NEGATIVE_LIST_TAXONOMY.find((t) => set.name.startsWith(t.prefix));
          return {
            name: set.name,
            resource_name: set.resourceName,
            classification: entry?.classification ?? "irrelevant",
            hint: entry?.hint ?? "",
            members: set.members.length,
          };
        }),
      classifications: ["job_seeker", "homeowner", "student", "wrong_segment", "irrelevant"],
    },
    market_digest: marketDigest,
    validation_codes: VALIDATION_CODES,
    structural_kinds: [...STRUCTURAL_KINDS],
  };
}
