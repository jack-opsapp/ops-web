import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { BriefRepository, FunnelRow, MarketDigest, ProposalSummary, RunSummary } from "./brief";
import { vancouverMonthStart } from "./brief";
import { STRUCTURAL_KINDS } from "./guardrails";
import type { EngineHandoffRepository, EngineRunRecord, EngineValidationInputs } from "./handoff";
import { aggregateMetrics, historyStart, metricWindows, type DailyRows, type DateWindow } from "./metrics";
import { mapEntitySnapshot, type EntityRow } from "./snapshot";
import type {
  ChangeRecord,
  EngineSettings,
  EntitySnapshot,
  FunnelSignals,
  MetricsWindow,
  OpenProposalRef,
  ProposalKind,
  TestRecord,
} from "./types";

const PAGE = 1000;
const MARKET_DIGEST_ROW = "market-digest";

// Vancouver adopted permanent UTC-7 in March 2026.
const VANCOUVER_OFFSET_MS = 7 * 3600000;

/** Read every row of a query in pages; PostgREST caps a single response. */
async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

function settingsOf(row: Record<string, unknown>): EngineSettings {
  return {
    modes: row.modes as EngineSettings["modes"],
    monthly_cap: Number(row.monthly_cap),
    daily_cap: Number(row.daily_cap),
    max_budget_change_pct: Number(row.max_budget_change_pct),
    budget_cooldown_days: Number(row.budget_cooldown_days),
    max_structural_per_run: Number(row.max_structural_per_run),
    lease_minutes: Number(row.lease_minutes),
    stall_hours: Number(row.stall_hours),
    target_cost_per_trial: Number(row.target_cost_per_trial),
    heartbeat_at: typeof row.heartbeat_at === "string" ? row.heartbeat_at : null,
  };
}

function runOf(row: Record<string, unknown>): EngineRunRecord {
  return {
    id: String(row.id),
    state: row.state as EngineRunRecord["state"],
    worker: String(row.worker ?? ""),
    claim_token: String(row.claim_token),
    lease_until: String(row.lease_until),
    duties: Array.isArray(row.duties) ? (row.duties as string[]) : [],
    brief_version: typeof row.brief_version === "string" ? row.brief_version : null,
    submission_counts: (row.submission_counts as Record<string, number>) ?? {},
    proposals_accepted: Number(row.proposals_accepted ?? 0),
    proposals_rejected: Number(row.proposals_rejected ?? 0),
  };
}

function summaryOf(row: Record<string, unknown>): ProposalSummary {
  return {
    id: String(row.id),
    kind: row.kind as ProposalKind,
    target: String(row.target),
    state: row.state as ProposalSummary["state"],
    payload: (row.payload as Record<string, unknown>) ?? {},
    rationale: String(row.rationale ?? ""),
    review_notes: typeof row.review_notes === "string" ? row.review_notes : null,
    error: typeof row.error === "string" ? row.error : null,
    google_validation: (row.google_validation as Record<string, unknown>) ?? null,
    created_at: String(row.created_at),
    expires_at: String(row.expires_at),
  };
}

const RUN_FIELDS = "id,state,worker,claim_token,lease_until,duties,brief_version,submission_counts,proposals_accepted,proposals_rejected";
const PROPOSAL_FIELDS = "id,run_id,kind,target,state,payload,rationale,review_notes,error,google_validation,created_at,expires_at";

export function createEngineRepository(client?: SupabaseClient): EngineHandoffRepository & BriefRepository {
  const db = client ?? getServiceRoleClient();

  async function readSettings(): Promise<EngineSettings> {
    const { data, error } = await db.from("ads_engine_settings").select("*").eq("id", true).single();
    if (error) throw error;
    return settingsOf(data as Record<string, unknown>);
  }

  async function readSnapshot(): Promise<EntitySnapshot> {
    const rows = await readAll<EntityRow>((from, to) =>
      db
        .from("ads_entities")
        .select("resource_name,entity_type,parent_resource_name,name,status,payload,labels,snapshot_at")
        .order("resource_name")
        .range(from, to)
    );
    return mapEntitySnapshot(rows);
  }

  async function readMetrics(window: DateWindow, snapshot: EntitySnapshot): Promise<MetricsWindow> {
    const now = new Date();
    const history = historyStart(now, 90);
    const [campaigns, adGroups, ads, keywords, searchTerms, assets] = await Promise.all([
      readAll<DailyRows["campaigns"][number]>((from, to) =>
        db.from("ads_daily_campaign").select("date,campaign_name,campaign_status,spend,clicks,impressions,conversions").gte("date", window.from).lte("date", window.to).range(from, to)
      ),
      readAll<DailyRows["adGroups"][number]>((from, to) =>
        db.from("ads_daily_ad_group").select("date,campaign_id,ad_group_id,spend,clicks,impressions,conversions").gte("date", window.from).lte("date", window.to).range(from, to)
      ),
      readAll<DailyRows["ads"][number]>((from, to) =>
        db.from("ads_daily_ad").select("date,ad_group_id,ad_id,status,approval_status,ad_strength,spend,clicks,impressions,conversions").gte("date", history).lte("date", window.to).range(from, to)
      ),
      readAll<DailyRows["keywords"][number]>((from, to) =>
        db.from("ads_daily_keyword").select("date,ad_group_id,criterion_id,keyword,match_type,quality_score,spend,clicks,impressions,conversions").gte("date", history).lte("date", window.to).range(from, to)
      ),
      readAll<DailyRows["searchTerms"][number]>((from, to) =>
        db.from("ads_daily_search_term").select("date,search_term,campaign_name,ad_group_name,spend,clicks,impressions,conversions").gte("date", window.from).lte("date", window.to).range(from, to)
      ),
      readAll<DailyRows["assets"][number]>((from, to) =>
        db.from("ads_daily_asset").select("date,ad_id,asset_id,field_type,performance_label,pinned_field,text,impressions,clicks,conversions").gte("date", window.from).lte("date", window.to).range(from, to)
      ),
    ]);
    return aggregateMetrics(
      { campaigns, adGroups, ads, keywords, searchTerms, assets },
      window,
      { campaignIdsByName: new Map(snapshot.campaigns.map((c) => [c.name, c.id])) }
    );
  }

  async function readTests(): Promise<TestRecord[]> {
    const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const { data, error } = await db
      .from("ads_tests")
      .select("id,campaign_id,ad_group_id,ad_group_name,control_ad_id,challenger_ad_id,started_at,min_days,min_impressions,max_days,state,stats,verdict_at")
      .or(`state.eq.running,created_at.gte.${since}`)
      .order("started_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as TestRecord[];
  }

  async function readLedger(sinceIso: string): Promise<ChangeRecord[]> {
    const { data, error } = await db
      .from("ads_changes")
      .select("id,proposal_id,kind,campaign_id,ad_group_id,resource_names,before,after,applied_at,measure_from,measure_to,pre_metrics,post_metrics,verdict,verdict_at")
      .gte("applied_at", sinceIso)
      .order("applied_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data ?? []) as ChangeRecord[];
  }

  async function readProposals() {
    const thirtyDays = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [pending, rejected, failed] = await Promise.all([
      db.from("ads_proposals").select(PROPOSAL_FIELDS).in("state", ["proposed", "approved"]).order("created_at", { ascending: false }).limit(200),
      db.from("ads_proposals").select(PROPOSAL_FIELDS).eq("state", "rejected").gte("reviewed_at", thirtyDays).order("reviewed_at", { ascending: false }).limit(100),
      db.from("ads_proposals").select(PROPOSAL_FIELDS).eq("state", "failed").gte("updated_at", thirtyDays).order("updated_at", { ascending: false }).limit(100),
    ]);
    for (const result of [pending, rejected, failed]) if (result.error) throw result.error;
    const map = (rows: unknown[] | null) => (rows ?? []).map((row) => summaryOf(row as Record<string, unknown>));
    return { pending: map(pending.data), rejected: map(rejected.data), failed: map(failed.data) };
  }

  async function readFunnel(now: Date): Promise<FunnelSignals> {
    const last30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const prev30 = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    const monthStart = vancouverMonthStart(now);
    const monthStartDay = new Date(monthStart.getTime() - VANCOUVER_OFFSET_MS).toISOString().slice(0, 10);
    const local = new Date(now.getTime() - VANCOUVER_OFFSET_MS);
    const daysInMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
    const daysLeftInMonth = daysInMonth - local.getUTCDate() + 1;

    const count = async (from: string, to: string | null) => {
      let query = db.from("ads_conversion_events").select("id", { count: "exact", head: true }).eq("kind", "trial_started").eq("state", "sent").gte("occurred_at", from);
      if (to) query = query.lt("occurred_at", to);
      const { count: n, error } = await query;
      if (error) {
        // Before phase 1 lands the outbox table does not exist; the ladder
        // trigger simply cannot be met yet.
        if (/does not exist|schema cache|could not find/i.test(error.message)) return 0;
        throw error;
      }
      return n ?? 0;
    };
    const [trialStartsLast30, trialStartsPrev30, spendRows] = await Promise.all([
      count(last30, null),
      count(prev30, last30),
      db.from("ads_daily_account").select("spend").gte("date", monthStartDay),
    ]);
    if (spendRows.error) throw spendRows.error;
    const monthToDateSpend = (spendRows.data ?? []).reduce((sum, row) => sum + Number((row as { spend: unknown }).spend ?? 0), 0);
    return { trialStartsLast30, trialStartsPrev30, monthToDateSpend: Math.round(monthToDateSpend * 100) / 100, daysLeftInMonth };
  }

  async function readFunnelByKeyword(): Promise<FunnelRow[]> {
    const { data, error } = await db.from("ads_funnel_by_keyword").select("*").limit(500);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const num = (v: unknown) => (v == null ? null : Number(v));
      return {
        campaign_name: typeof r.campaign_name === "string" ? r.campaign_name : null,
        ad_group_name: typeof r.ad_group_name === "string" ? r.ad_group_name : null,
        keyword: typeof r.keyword === "string" ? r.keyword : null,
        clicks: num(r.clicks),
        trials: num(r.trials),
        activated: num(r.activated),
        paid: num(r.paid),
        spend: num(r.spend),
        cost_per_trial: num(r.cost_per_trial),
        cost_per_paid: num(r.cost_per_paid),
      };
    });
  }

  async function readRuns(sinceIso: string): Promise<RunSummary[]> {
    const { data, error } = await db.from("ads_engine_runs").select("duties,state").gte("created_at", sinceIso).limit(200);
    if (error) throw error;
    return (data ?? []).map((row) => ({ duties: (row as { duties: string[] }).duties ?? [], state: String((row as { state: unknown }).state) }));
  }

  async function readMarketDigest(): Promise<MarketDigest | null> {
    const { data, error } = await db.from("ads_sync_status").select("backfill_progress").eq("id", MARKET_DIGEST_ROW).maybeSingle();
    if (error) throw error;
    const stored = (data?.backfill_progress ?? null) as { text?: unknown; generated_at?: unknown } | null;
    if (!stored || typeof stored.text !== "string" || typeof stored.generated_at !== "string") return null;
    return { text: stored.text, generatedAt: stored.generated_at };
  }

  async function writeMarketDigest(text: string, generatedAt: string): Promise<void> {
    const { error } = await db.from("ads_sync_status").upsert(
      { id: MARKET_DIGEST_ROW, status: "complete", last_synced_date: generatedAt.slice(0, 10), backfill_progress: { text, generated_at: generatedAt }, error: null, updated_at: generatedAt },
      { onConflict: "id" }
    );
    if (error) throw error;
  }

  async function openProposals(): Promise<OpenProposalRef[]> {
    const { data, error } = await db.from("ads_proposals").select("id,run_id,kind,target,state,payload").in("state", ["proposed", "approved"]).limit(500);
    if (error) throw error;
    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return { id: String(r.id), runId: typeof r.run_id === "string" ? r.run_id : null, kind: r.kind as ProposalKind, target: String(r.target), state: r.state as OpenProposalRef["state"], payload: (r.payload as Record<string, unknown>) ?? null };
    });
  }

  return {
    readSettings,
    readSnapshot,
    readMetrics,
    readTests,
    readLedger,
    readProposals,
    readFunnel,
    readFunnelByKeyword,
    readRuns,
    readMarketDigest,
    writeMarketDigest,

    async claimRun(token, worker) {
      const { data, error } = await db.rpc("claim_ads_engine_run", { p_token: token, p_worker: worker });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      return row ? runOf(row as Record<string, unknown>) : null;
    },
    async hasLiveRun() {
      const { data, error } = await db.from("ads_engine_runs").select("id").eq("state", "claimed").gt("lease_until", new Date().toISOString()).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async findRun(id) {
      const { data, error } = await db.from("ads_engine_runs").select(RUN_FIELDS).eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? runOf(data as Record<string, unknown>) : null;
    },
    async checkpointRun(id, token, duties, briefVersion) {
      const { data, error } = await db.rpc("checkpoint_ads_engine_run", { p_id: id, p_token: token, p_duties: duties, p_brief_version: briefVersion });
      if (error) throw error;
      return data === true;
    },
    async recordSubmission(id, token, index, detail) {
      const { data, error } = await db.rpc("record_ads_engine_submission", { p_id: id, p_token: token, p_index: index, p_detail: detail });
      if (error) throw error;
      return typeof data === "number" ? data : null;
    },
    async acceptProposal(runId, token, normalized, index, mode) {
      const { data, error } = await db.rpc("accept_ads_proposal", {
        p_run_id: runId,
        p_token: token,
        p_kind: normalized.kind,
        p_target: normalized.target,
        p_index: index,
        p_payload: normalized.payload,
        p_evidence: normalized.evidence,
        p_rationale: normalized.rationale,
        p_mode: mode,
      });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
    async releaseRun(id, token, summary, outcome) {
      const { data, error } = await db.rpc("release_ads_engine_run", { p_id: id, p_token: token, p_summary: summary, p_outcome: outcome });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
    async validationContext(): Promise<EngineValidationInputs> {
      const now = new Date();
      const [settings, snapshot] = await Promise.all([readSettings(), readSnapshot()]);
      const [metrics28d, tests, ledger, open, funnel] = await Promise.all([
        readMetrics(metricWindows(now).metrics28d, snapshot),
        readTests(),
        readLedger(new Date(now.getTime() - 90 * 86_400_000).toISOString()),
        openProposals(),
        readFunnel(now),
      ]);
      return { settings, snapshot, metrics28d, tests, ledger, openProposals: open, funnel };
    },
    async structuralAcceptedInRun(runId) {
      const { data, error } = await db.from("ads_proposals").select("kind").eq("run_id", runId);
      if (error) throw error;
      return (data ?? []).filter((row) => STRUCTURAL_KINDS.has((row as { kind: ProposalKind }).kind)).length;
    },
  };
}
