/**
 * CALIBRATION — Data Service
 *
 * Single service powering /calibration. All deck, drill-in, and realtime
 * queries flow through here. Uses service-role client for cross-table reads
 * that don't fit neatly in the app user's RLS policies.
 *
 * Schema reality checks (2026-04-23):
 *   - agent_writing_profiles has NO `confidence` column — it stores
 *     emails_analyzed and we derive confidence via WritingProfileService.
 *   - agent_actions uses action_type (not type) as the discriminator.
 *   - email_filter_rules table does not exist; filter rules live in
 *     email_connections.sync_filters.rules (JSONB array).
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { WritingProfileService } from "./writing-profile-service";
import type {
  DeckState,
  FirstRunState,
  InputState,
  LadderPosition,
  RecentEvent,
  ActivityFilters,
  DomainStatus,
} from "@/lib/types/calibration";

export const CalibrationService = {
  /**
   * Fetch the complete deck state for a company. Single entry point;
   * TanStack Query hook caches this with a 20-30s staleness window.
   */
  async getDeckState(companyId: string): Promise<DeckState> {
    const [
      inputsState,
      corpusState,
      configState,
      activityState,
      milestonesState,
    ] = await Promise.all([
      this.getInputsState(companyId),
      this.getCorpusState(companyId),
      this.getConfigState(companyId),
      this.getActivityState(companyId),
      this.getMilestonesState(companyId),
    ]);

    return {
      inputs: inputsState,
      corpus: corpusState,
      config: configState,
      activity: activityState,
      milestones: milestonesState,
    };
  },

  /**
   * First-run detection. Composite query across 3 tables + user preferences.
   */
  async getFirstRunState(
    companyId: string,
    userId: string
  ): Promise<FirstRunState> {
    const supabase = getServiceRoleClient();

    const [interviewResult, miningResult, scanResult, userResult] =
      await Promise.all([
        supabase
          .from("agent_memories")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("source", "intake_interview")
          .limit(1),
        supabase
          .from("agent_memories")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("source", "database")
          .limit(1),
        supabase
          .from("gmail_scan_jobs")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("status", "complete")
          .limit(1),
        supabase
          .from("users")
          .select("preferences")
          .eq("id", userId)
          .maybeSingle(),
      ]);

    const interviewDone = (interviewResult.count ?? 0) > 0;
    const miningDone = (miningResult.count ?? 0) > 0;
    const scanDone = (scanResult.count ?? 0) > 0;
    const prefs = (userResult.data?.preferences ?? {}) as Record<
      string,
      unknown
    >;
    const dismissed = prefs.calibrationFirstRunDismissed === true;

    return {
      dismissed,
      interviewDone,
      scanDone,
      miningDone,
      shouldShowWizard:
        !dismissed && !(interviewDone && scanDone && miningDone),
    };
  },

  /**
   * Mark the first-run wizard as dismissed for this user. Called when the
   * user completes or explicitly skips all 3 stations, or hits the
   * explicit dismiss action.
   */
  async dismissFirstRun(userId: string): Promise<void> {
    const supabase = getServiceRoleClient();

    const { data: user } = await supabase
      .from("users")
      .select("preferences")
      .eq("id", userId)
      .maybeSingle();

    const prefs = (user?.preferences ?? {}) as Record<string, unknown>;
    prefs.calibrationFirstRunDismissed = true;

    await supabase.from("users").update({ preferences: prefs }).eq("id", userId);
  },

  /**
   * Fetch last N recent events for the deck's RECENT rail.
   * Merges from 3 source tables, sorts by created_at desc.
   */
  async getRecentEvents(
    companyId: string,
    limit = 5
  ): Promise<RecentEvent[]> {
    const supabase = getServiceRoleClient();

    const [memoriesResult, scanJobsResult, actionsResult] = await Promise.all([
      supabase
        .from("agent_memories")
        .select("id, source, category, content, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("gmail_scan_jobs")
        .select("id, status, created_at, updated_at")
        .eq("company_id", companyId)
        .in("status", ["complete", "error", "running"])
        .order("updated_at", { ascending: false })
        .limit(limit),
      supabase
        .from("agent_actions")
        .select("id, action_type, status, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    const events: RecentEvent[] = [];

    for (const m of memoriesResult.data ?? []) {
      const source = m.source as string | null;
      const isLearning = source === "learning";
      events.push({
        id: m.id as string,
        type: isLearning ? "learning" : "extraction",
        title: isLearning ? "LEARNING" : "EXTRACTION",
        detail: truncate((m.content as string | null) ?? "", 40),
        createdAt: m.created_at as string,
        sourceTable: "agent_memories",
        sourceId: m.id as string,
      });
    }

    for (const j of scanJobsResult.data ?? []) {
      const status = j.status as string;
      events.push({
        id: j.id as string,
        type: status === "complete" ? "scan_complete" : "scan",
        title: status === "complete" ? "SCAN COMPLETE" : "SCAN",
        detail: null,
        createdAt: (j.updated_at as string | null) ?? (j.created_at as string),
        sourceTable: "gmail_scan_jobs",
        sourceId: j.id as string,
      });
    }

    for (const a of actionsResult.data ?? []) {
      const actionType = a.action_type as string;
      events.push({
        id: a.id as string,
        type: actionType === "send_email" ? "draft" : "suggestion",
        title: actionType === "send_email" ? "DRAFT" : "SUGGESTION",
        detail: null,
        createdAt: a.created_at as string,
        sourceTable: "agent_actions",
        sourceId: a.id as string,
      });
    }

    events.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return events.slice(0, limit);
  },

  /**
   * Fetch the full activity log for the ACTIVITY drill-in.
   * Paginated, filtered, limited to the last N events by time range.
   * Full implementation expanded in Task I1 — stubbed here for A2.
   */
  async getActivityLog(
    _companyId: string,
    _filters: ActivityFilters,
    _cursor?: string,
    _limit = 50
  ): Promise<{ events: RecentEvent[]; nextCursor: string | null }> {
    return { events: [], nextCursor: null };
  },

  // ─── Per-tile queries ─────────────────────────────────────────────────────

  async getInputsState(companyId: string): Promise<DeckState["inputs"]> {
    const supabase = getServiceRoleClient();

    const [interviewCount, miningCount, scanJob, lastMemoryAt] =
      await Promise.all([
        supabase
          .from("agent_memories")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("source", "intake_interview"),
        supabase
          .from("agent_memories")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("source", "database"),
        supabase
          .from("gmail_scan_jobs")
          .select("id, status, created_at, updated_at, result")
          .eq("company_id", companyId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("agent_memories")
          .select("created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    const interview: InputState = {
      source: "interview",
      status: (interviewCount.count ?? 0) > 0 ? "complete" : "not_run",
      percent: (interviewCount.count ?? 0) > 0 ? 100 : 0,
      lastRunAt: null,
      currentJobId: null,
    };

    const mining: InputState = {
      source: "mining",
      status: (miningCount.count ?? 0) > 0 ? "complete" : "not_run",
      percent: (miningCount.count ?? 0) > 0 ? 100 : 0,
      lastRunAt: null,
      currentJobId: null,
    };

    const scan: InputState = mapScanJobToInputState(scanJob.data);

    return {
      interview,
      scan,
      mining,
      lastAnyRunAt: (lastMemoryAt.data?.created_at as string | null) ?? null,
    };
  },

  async getCorpusState(companyId: string): Promise<DeckState["corpus"]> {
    const supabase = getServiceRoleClient();

    const [
      memoriesCount,
      entitiesCount,
      todayCount,
      writingProfiles,
      sparkline,
    ] = await Promise.all([
      supabase
        .from("agent_memories")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabase
        .from("graph_entities")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabase
        .from("agent_memories")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .gte("created_at", startOfToday().toISOString()),
      supabase
        .from("agent_writing_profiles")
        .select("emails_analyzed")
        .eq("company_id", companyId),
      getFactSparkline(companyId),
    ]);

    const maxEmailsAnalyzed = (writingProfiles.data ?? []).reduce(
      (max, p) => Math.max(max, (p.emails_analyzed as number | null) ?? 0),
      0
    );
    const writingConfidence =
      WritingProfileService.getConfidence(maxEmailsAnalyzed);

    return {
      factCount: memoriesCount.count ?? 0,
      entityCount: entitiesCount.count ?? 0,
      todayFactCount: todayCount.count ?? 0,
      writingConfidence,
      last7DaysFactCounts: sparkline,
    };
  },

  async getConfigState(companyId: string): Promise<DeckState["config"]> {
    const supabase = getServiceRoleClient();

    const { data: emailConn } = await supabase
      .from("email_connections")
      .select("auto_send_settings, sync_filters")
      .eq("company_id", companyId)
      .eq("type", "company")
      .maybeSingle();

    const settings = (emailConn?.auto_send_settings ?? {}) as Record<
      string,
      unknown
    >;
    const categoryAutonomy = (settings.categoryAutonomy ?? {}) as Record<
      string,
      string
    >;

    const counts = { off: 0, draft: 0, auto_draft: 0, auto_send: 0 };
    for (const level of Object.values(categoryAutonomy)) {
      if (level in counts) counts[level as keyof typeof counts]++;
    }

    // Filter rules live inside email_connections.sync_filters.rules (JSONB array)
    const syncFilters = (emailConn?.sync_filters ?? {}) as Record<
      string,
      unknown
    >;
    const rulesArray = Array.isArray(syncFilters.rules)
      ? (syncFilters.rules as unknown[])
      : [];

    return {
      emailTypeCounts: counts,
      rulesCount: rulesArray.length,
      // 13 email thread categories — fixed enum in the codebase
      categoriesCount: 13,
    };
  },

  async getActivityState(companyId: string): Promise<DeckState["activity"]> {
    const supabase = getServiceRoleClient();

    const [runningJob, queuedActions, completedTodayActions] =
      await Promise.all([
        supabase
          .from("gmail_scan_jobs")
          .select("id, status, created_at, result")
          .eq("company_id", companyId)
          .eq("status", "running")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("agent_actions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("status", "proposed"),
        supabase
          .from("agent_actions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("status", "executed")
          .gte("updated_at", startOfToday().toISOString()),
      ]);

    const currentJob = runningJob.data
      ? {
          type: "SCAN",
          elapsedMs:
            Date.now() -
            new Date(runningJob.data.created_at as string).getTime(),
          progress: undefined as
            | { processed: number; total: number }
            | undefined,
        }
      : null;

    return {
      status: (runningJob.data ? "running" : "idle") as
        | "idle"
        | "running"
        | "error",
      currentJob,
      queuedCount: queuedActions.count ?? 0,
      completedTodayCount: completedTodayActions.count ?? 0,
    };
  },

  async getMilestonesState(
    companyId: string
  ): Promise<DeckState["milestones"]> {
    const supabase = getServiceRoleClient();

    const [
      phaseCOverride,
      scanJob,
      connection,
      writingProfiles,
      apptConfirms,
      autoSendEnabled,
    ] = await Promise.all([
      supabase
        .from("admin_feature_overrides")
        .select("enabled")
        .eq("company_id", companyId)
        .eq("feature_key", "phase_c")
        .maybeSingle(),
      supabase
        .from("gmail_scan_jobs")
        .select("id")
        .eq("company_id", companyId)
        .eq("status", "complete")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("email_connections")
        .select("auto_send_settings")
        .eq("company_id", companyId)
        .eq("type", "company")
        .maybeSingle(),
      supabase
        .from("agent_writing_profiles")
        .select("emails_analyzed")
        .eq("company_id", companyId),
      supabase
        .from("agent_actions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("action_type", "send_appointment_confirmation")
        .eq("status", "executed"),
      supabase
        .from("admin_feature_overrides")
        .select("enabled")
        .eq("company_id", companyId)
        .eq("feature_key", "ai_auto_send")
        .maybeSingle(),
    ]);

    const settings = (connection.data?.auto_send_settings ?? {}) as Record<
      string,
      unknown
    >;
    const milestones = (settings.milestones ?? {}) as Record<string, boolean>;
    const maxEmailsAnalyzed = (writingProfiles.data ?? []).reduce(
      (max, p) => Math.max(max, (p.emails_analyzed as number | null) ?? 0),
      0
    );
    const confidence =
      WritingProfileService.getConfidence(maxEmailsAnalyzed);
    const apptCount = apptConfirms.count ?? 0;
    const categoryAutonomy = (settings.categoryAutonomy ?? {}) as Record<
      string,
      unknown
    >;

    const ladder: LadderPosition[] = [
      {
        position: 1,
        status: phaseCOverride.data?.enabled ? "complete" : "gated",
        persistent: false,
      },
      {
        position: 2,
        status: scanJob.data ? "complete" : "gated",
        persistent: false,
      },
      {
        position: 3,
        status: milestones.draft_available_shown
          ? "complete"
          : confidence >= 0.2
            ? "in_training"
            : "gated",
        persistent: true,
      },
      {
        position: 4,
        status: milestones.auto_draft_suggested
          ? "complete"
          : confidence >= 0.5
            ? "in_training"
            : "gated",
        persistent: true,
      },
      {
        position: 5,
        status:
          Object.keys(categoryAutonomy).length > 0 ? "complete" : "gated",
        persistent: false,
      },
      {
        position: 6,
        status:
          apptCount >= 50
            ? "complete"
            : apptCount > 0
              ? "in_training"
              : "gated",
        persistent: false,
      },
      {
        position: 7,
        status:
          confidence >= 0.85
            ? "complete"
            : confidence >= 0.5
              ? "in_training"
              : "gated",
        persistent: false,
      },
      {
        position: 8,
        status: milestones.auto_send_suggested
          ? "complete"
          : confidence >= 0.75 && apptCount >= 50
            ? "in_training"
            : "gated",
        persistent: true,
      },
      {
        position: 9,
        status: autoSendEnabled.data?.enabled ? "complete" : "gated",
        persistent: false,
      },
    ];

    const reachedCount = ladder.filter((l) => l.status === "complete").length;
    const next = ladder.find((l) => l.status !== "complete");

    const domains = {
      email: deriveDomainStatus(confidence),
      projects: await deriveProjectsStatus(companyId),
      invoice: await deriveInvoiceStatus(companyId),
      schedule: await deriveScheduleStatus(companyId),
      comms: deriveCommsStatus(categoryAutonomy),
    };

    return {
      domains,
      ladder,
      reachedCount,
      nextLadderName: next ? `ladder.${next.position}` : null,
    };
  },
};

// ─── Utilities ──────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function mapScanJobToInputState(
  row: Record<string, unknown> | null
): InputState {
  if (!row) {
    return {
      source: "scan",
      status: "not_run",
      percent: 0,
      lastRunAt: null,
      currentJobId: null,
    };
  }
  const result = (row.result ?? {}) as Record<string, unknown>;
  const progress = result.progress as
    | { processed: number; total: number; factsExtracted: number }
    | undefined;
  const status = row.status as string;
  const percent =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : status === "complete"
        ? 100
        : 0;

  return {
    source: "scan",
    status: status as InputState["status"],
    percent,
    lastRunAt: (row.updated_at as string) ?? null,
    currentJobId: row.id as string,
    progress: progress
      ? {
          processed: progress.processed,
          total: progress.total,
          factsExtracted: progress.factsExtracted,
        }
      : undefined,
  };
}

async function getFactSparkline(companyId: string): Promise<number[]> {
  const supabase = getServiceRoleClient();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("agent_memories")
    .select("created_at")
    .eq("company_id", companyId)
    .gte("created_at", sevenDaysAgo.toISOString());

  const buckets = Array(7).fill(0);
  const today = startOfToday();
  for (const row of data ?? []) {
    const rowDate = new Date(row.created_at as string);
    const daysAgo = Math.floor(
      (today.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysAgo >= 0 && daysAgo < 7) buckets[6 - daysAgo]++;
  }
  return buckets;
}

function deriveDomainStatus(confidence: number): DomainStatus {
  if (confidence >= 0.85)
    return { status: "nominal", confidence, metric: confidence.toFixed(2) };
  if (confidence >= 0.3)
    return { status: "learning", confidence, metric: confidence.toFixed(2) };
  if (confidence > 0)
    return { status: "gated", confidence, metric: confidence.toFixed(2) };
  return { status: "unavailable", confidence: null, metric: null };
}

async function deriveProjectsStatus(companyId: string): Promise<DomainStatus> {
  const supabase = getServiceRoleClient();
  const { count } = await supabase
    .from("agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("action_type", "create_task");

  if ((count ?? 0) > 5)
    return { status: "nominal", confidence: null, metric: `${count}` };
  if ((count ?? 0) > 0)
    return { status: "learning", confidence: null, metric: `${count}` };
  return { status: "gated", confidence: null, metric: null };
}

async function deriveInvoiceStatus(companyId: string): Promise<DomainStatus> {
  const supabase = getServiceRoleClient();
  const { count } = await supabase
    .from("agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("action_type", [
      "create_invoice",
      "send_invoice_email",
      "send_payment_reminder",
    ]);

  if ((count ?? 0) > 5)
    return { status: "nominal", confidence: null, metric: `${count}` };
  if ((count ?? 0) > 0)
    return { status: "learning", confidence: null, metric: `${count}` };
  return { status: "gated", confidence: null, metric: null };
}

async function deriveScheduleStatus(companyId: string): Promise<DomainStatus> {
  const supabase = getServiceRoleClient();
  const { count } = await supabase
    .from("agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("action_type", ["send_appointment_confirmation", "optimize_schedule"]);

  if ((count ?? 0) > 10)
    return { status: "nominal", confidence: null, metric: `${count}` };
  if ((count ?? 0) > 0)
    return { status: "learning", confidence: null, metric: `${count}` };
  return { status: "gated", confidence: null, metric: null };
}

function deriveCommsStatus(
  categoryAutonomy: Record<string, unknown>
): DomainStatus {
  const count = Object.keys(categoryAutonomy).length;
  if (count >= 7)
    return { status: "nominal", confidence: null, metric: `${count}` };
  if (count > 0)
    return { status: "learning", confidence: null, metric: `${count}` };
  return { status: "gated", confidence: null, metric: null };
}
