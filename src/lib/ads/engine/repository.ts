import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { ApplyProposalRecord, ApplyRepository, NewChange, NewTest } from "./apply";
import type { BriefRepository, FunnelRow, MarketDigest, ProposalSummary, RunSummary } from "./brief";
import { vancouverMonthStart } from "./brief";
import { STRUCTURAL_KINDS } from "./guardrails";
import type { EngineHandoffRepository, EngineRunRecord, EngineValidationInputs } from "./handoff";
import { aggregateMetrics, historyStart, metricWindows, type DailyRows, type DateWindow } from "./metrics";
import { mapEntitySnapshot, type EntityRow } from "./snapshot";
import { refreshEntitySnapshot } from "./snapshot-refresh";
import type { ArmStats } from "./stats";
import { changeScope, type EngineAlert, type EngineOperator, type WorkerProposalInput, type WorkerRepository } from "./worker";
import type {
  ChangeRecord,
  ChangeVerdict,
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

export type EngineRepository = EngineHandoffRepository & BriefRepository & WorkerRepository & ApplyRepository;

const TEST_FIELDS = "id,campaign_id,ad_group_id,ad_group_name,control_ad_id,challenger_ad_id,started_at,min_days,min_impressions,max_days,state,stats,verdict_at";
const CHANGE_FIELDS = "id,proposal_id,kind,campaign_id,ad_group_id,resource_names,before,after,applied_at,measure_from,measure_to,pre_metrics,post_metrics,verdict,verdict_at";

function sumArms(rows: Array<{ impressions?: unknown; clicks?: unknown; conversions?: unknown }>): ArmStats {
  const total = { impressions: 0, clicks: 0, conversions: 0 };
  for (const row of rows) {
    total.impressions += Number(row.impressions ?? 0);
    total.clicks += Number(row.clicks ?? 0);
    total.conversions += Number(row.conversions ?? 0);
  }
  return total;
}

export function createEngineRepository(client?: SupabaseClient): EngineRepository {
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
      .select(TEST_FIELDS)
      .or(`state.eq.running,created_at.gte.${since}`)
      .order("started_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as TestRecord[];
  }

  async function readLedger(sinceIso: string): Promise<ChangeRecord[]> {
    const { data, error } = await db
      .from("ads_changes")
      .select(CHANGE_FIELDS)
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

    // ─── Worker ──────────────────────────────────────────────────────────────

    async expireProposals() {
      const { data, error } = await db.rpc("expire_ads_proposals");
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },
    async listApplicableProposals() {
      const { data, error } = await db
        .from("ads_proposals")
        .select("id,run_id,kind,target,state,mode_at_submit,payload")
        .or("state.eq.approved,and(state.eq.proposed,mode_at_submit.eq.auto)")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: String(r.id),
          run_id: String(r.run_id),
          kind: r.kind as ProposalKind,
          target: String(r.target),
          state: r.state as ApplyProposalRecord["state"],
          mode_at_submit: r.mode_at_submit as "propose" | "auto",
          payload: (r.payload as Record<string, unknown>) ?? {},
        };
      });
    },
    async listRunningTests() {
      const { data, error } = await db.from("ads_tests").select(TEST_FIELDS).eq("state", "running").order("started_at", { ascending: true }).limit(100);
      if (error) throw error;
      return (data ?? []) as TestRecord[];
    },
    async adArmMetrics(adIds, window) {
      if (adIds.length === 0) return {};
      const rows = await readAll<{ ad_id: string; impressions: unknown; clicks: unknown; conversions: unknown }>((from, to) =>
        db.from("ads_daily_ad").select("ad_id,impressions,clicks,conversions").in("ad_id", adIds).gte("date", window.from).lte("date", window.to).range(from, to)
      );
      const byAd = new Map<string, typeof rows>();
      for (const row of rows) byAd.set(row.ad_id, [...(byAd.get(row.ad_id) ?? []), row]);
      return Object.fromEntries(adIds.map((id) => [id, sumArms(byAd.get(id) ?? [])]));
    },
    async recordTestStats(id, state, stats, verdictAt) {
      const { error } = await db
        .from("ads_tests")
        .update({ state, stats, verdict_at: verdictAt, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    async openWorkerProposal(input: WorkerProposalInput) {
      const { data: open, error: openError } = await db.from("ads_proposals").select("id").eq("target", input.target).in("state", ["proposed", "approved"]).limit(1);
      if (openError) throw openError;
      if ((open ?? []).length > 0) return null;
      const nowIso = new Date().toISOString();
      const dayStart = `${nowIso.slice(0, 10)}T00:00:00.000Z`;
      const { data: runs, error: runError } = await db.from("ads_engine_runs").select("id").eq("worker", "ops-worker").gte("created_at", dayStart).limit(1);
      if (runError) throw runError;
      let runId = (runs ?? [])[0]?.id as string | undefined;
      if (!runId) {
        const { data: created, error: createError } = await db
          .from("ads_engine_runs")
          .insert({ worker: "ops-worker", claim_token: randomUUID(), lease_until: nowIso, state: "released", outcome: "done", duties: ["worker"], summary: "Worker follow-ups from concluded tests.", released_at: nowIso })
          .select("id")
          .single();
        if (createError) throw createError;
        runId = String(created.id);
      }
      const { data: proposal, error } = await db
        .from("ads_proposals")
        .insert({ run_id: runId, kind: input.kind, target: input.target, submission_index: 0, payload: input.payload, evidence: input.evidence, rationale: input.rationale, mode_at_submit: input.mode })
        .select("id")
        .single();
      if (error) throw error;
      return String(proposal.id);
    },
    async linkTestProposal(testId, proposalId) {
      const { error } = await db.from("ads_tests").update({ concluded_proposal_id: proposalId, updated_at: new Date().toISOString() }).eq("id", testId);
      if (error) throw error;
    },
    async listPendingChanges(measureToOnOrBefore) {
      const { data, error } = await db.from("ads_changes").select(CHANGE_FIELDS).eq("verdict", "pending").lte("measure_to", measureToOnOrBefore).order("measure_to", { ascending: true }).limit(200);
      if (error) throw error;
      return (data ?? []) as ChangeRecord[];
    },
    async entityMetrics(change, window) {
      const scope = changeScope(change);
      if (scope.level === "account") {
        const rows = await readAll<{ impressions: unknown; clicks: unknown; conversions: unknown }>((from, to) =>
          db.from("ads_daily_account").select("impressions,clicks,conversions").gte("date", window.from).lte("date", window.to).range(from, to)
        );
        return sumArms(rows);
      }
      if (!scope.id) return { impressions: 0, clicks: 0, conversions: 0 };
      const column = scope.level === "campaign" ? "campaign_id" : "ad_group_id";
      const rows = await readAll<{ impressions: unknown; clicks: unknown; conversions: unknown }>((from, to) =>
        db.from("ads_daily_ad_group").select("impressions,clicks,conversions").eq(column, scope.id).gte("date", window.from).lte("date", window.to).range(from, to)
      );
      return sumArms(rows);
    },
    async setChangeVerdict(id, verdict: ChangeVerdict, pre, post, verdictAt) {
      const { error } = await db.from("ads_changes").update({ verdict, pre_metrics: pre, post_metrics: post, verdict_at: verdictAt }).eq("id", id);
      if (error) throw error;
    },
    async raiseAlert(alert: EngineAlert) {
      const { data, error } = await db
        .from("ads_engine_alerts")
        .upsert(
          { kind: alert.kind, dedupe_key: alert.dedupeKey, title: alert.title, body: alert.body, persistent: alert.persistent, action_url: alert.actionUrl ?? "/admin/google-ads#engine" },
          { onConflict: "dedupe_key", ignoreDuplicates: true }
        )
        .select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async notify(operator: EngineOperator) {
      const { data, error } = await db.rpc("notify_ads_engine", { p_user_id: operator.userId, p_company_id: operator.companyId });
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },
    async checkStall(operator: EngineOperator, staleHours, campaignsLive) {
      const { data, error } = await db.rpc("check_ads_engine_stall", { p_user_id: operator.userId, p_company_id: operator.companyId, p_stale_hours: staleHours, p_campaigns_live: campaignsLive });
      if (error) throw error;
      return data === true;
    },
    async clearStall(operator: EngineOperator) {
      const { data, error } = await db
        .from("notifications")
        .update({ is_read: true, resolved_at: new Date().toISOString() })
        .eq("user_id", operator.userId)
        .eq("company_id", operator.companyId)
        .eq("type", "ads_engine")
        .like("dedupe_key", "ads-engine:stalled:%")
        .eq("is_read", false)
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },

    // ─── Apply ───────────────────────────────────────────────────────────────

    async recordValidation(id, validation) {
      const { error } = await db.from("ads_proposals").update({ google_validation: validation, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    async markApplied(id, state, validation, resourceNames, label, errorText) {
      const { data, error } = await db.rpc("mark_ads_proposal_applied", {
        p_id: id,
        p_state: state,
        p_google_validation: validation,
        p_resource_names: resourceNames,
        p_label: label,
        p_error: errorText,
      });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
    async recordChange(change: NewChange) {
      const { data, error } = await db.from("ads_changes").insert(change).select("id").single();
      if (error) throw error;
      return String(data.id);
    },
    async openTest(test: NewTest) {
      const { data, error } = await db.from("ads_tests").insert(test).select("id").single();
      if (error) throw error;
      return String(data.id);
    },
    async refreshSnapshot() {
      await refreshEntitySnapshot();
    },
  };
}
