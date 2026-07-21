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
import {
  buildEmailThreadListAuthorizationFilter,
  type AllowedEmailInboxListAccess,
} from "@/lib/email/email-opportunity-access";
import { WritingProfileService } from "./writing-profile-service";
import { getActorAutonomyMilestones } from "./autonomy-milestone-service";
import {
  aggregateCalibrationConnectionConfig,
  deriveCalibrationAutoSendLadder,
  mergeCalibrationMilestones,
  selectActorCalibrationConnections,
  type CalibrationConnectionRow,
} from "@/lib/email/calibration-mailbox-scope";
import { PhaseCCategoryAutonomy } from "./phase-c-category-autonomy-service";
import { EMAIL_THREAD_CATEGORIES } from "@/lib/types/email-thread";
import type {
  DeckState,
  FirstRunState,
  InputState,
  LadderPosition,
  RecentEvent,
  ActivityFilters,
  DomainStatus,
} from "@/lib/types/calibration";

async function projectActorCategoryAutonomy(
  connections: CalibrationConnectionRow[],
  actorUserId: string
): Promise<CalibrationConnectionRow[]> {
  return Promise.all(
    connections.map(async (connection) => {
      const levels = await PhaseCCategoryAutonomy.get(
        connection.id,
        actorUserId
      );
      const settings =
        connection.auto_send_settings &&
        typeof connection.auto_send_settings === "object" &&
        !Array.isArray(connection.auto_send_settings)
          ? (connection.auto_send_settings as Record<string, unknown>)
          : {};
      const configured =
        settings.category_autonomy &&
        typeof settings.category_autonomy === "object" &&
        !Array.isArray(settings.category_autonomy)
          ? (settings.category_autonomy as Record<string, unknown>)
          : {};
      return {
        ...connection,
        auto_send_settings: {
          ...settings,
          category_autonomy: {
            ...configured,
            ...Object.fromEntries(
              EMAIL_THREAD_CATEGORIES.map((category) => [
                `primary:${category}`,
                levels[category],
              ])
            ),
          },
        },
      };
    })
  );
}

export const CalibrationService = {
  /**
   * Fetch the complete deck state for a company. Single entry point;
   * TanStack Query hook caches this with a 20-30s staleness window.
   */
  async getDeckState(
    companyId: string,
    userId: string,
    access: AllowedEmailInboxListAccess
  ): Promise<DeckState> {
    const visibleCompanyConnectionIds =
      await resolveCalibrationCompanyConnectionScope(companyId, access);
    const [
      inputsState,
      corpusState,
      configState,
      activityState,
      milestonesState,
    ] = await Promise.all([
      this.getInputsState(companyId, userId),
      this.getCorpusState(companyId, userId),
      this.getConfigState(companyId, userId, visibleCompanyConnectionIds),
      this.getActivityState(companyId, userId),
      this.getMilestonesState(companyId, userId, visibleCompanyConnectionIds),
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
          .eq("user_id", userId)
          .eq("source", "intake_interview")
          .limit(1),
        supabase
          .from("agent_memories")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("user_id", userId)
          .eq("source", "database")
          .limit(1),
        supabase
          .from("gmail_scan_jobs")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("requested_by_user_id", userId)
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

    await supabase
      .from("users")
      .update({ preferences: prefs })
      .eq("id", userId);
  },

  /**
   * Fetch last N recent events for the deck's RECENT rail.
   * Merges from 3 source tables, sorts by created_at desc.
   */
  async getRecentEvents(
    companyId: string,
    userId: string,
    limit = 5
  ): Promise<RecentEvent[]> {
    const supabase = getServiceRoleClient();

    const [memoriesResult, scanJobsResult, actionsResult] = await Promise.all([
      supabase
        .from("agent_memories")
        .select("id, source, category, content, created_at")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("gmail_scan_jobs")
        .select("id, status, created_at, updated_at")
        .eq("company_id", companyId)
        .eq("requested_by_user_id", userId)
        .in("status", ["complete", "error", "running"])
        .order("updated_at", { ascending: false })
        .limit(limit),
      supabase
        .from("agent_actions")
        .select("id, action_type, status, created_at")
        .eq("company_id", companyId)
        .eq("user_id", userId)
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
   *
   * Paginated via a timestamp cursor (created_at of the last event in the
   * previous page). Each source table returns up to `limit` rows; we merge
   * into a single list sorted by createdAt desc and slice to `limit`.
   *
   * When `filters.types` is "all" we query every source. Otherwise we skip
   * sources whose event types aren't in the set.
   */
  async getActivityLog(
    companyId: string,
    userId: string,
    filters: ActivityFilters,
    cursor?: string,
    limit = 50
  ): Promise<{ events: RecentEvent[]; nextCursor: string | null }> {
    const supabase = getServiceRoleClient();

    const since = resolveTimeRangeCutoff(filters.timeRange);
    const cursorIso = cursor ? new Date(cursor).toISOString() : undefined;

    const wantsAll = filters.types === "all";
    const typeSet = Array.isArray(filters.types)
      ? new Set(filters.types)
      : null;

    const wantsMemories =
      wantsAll || typeSet?.has("extraction") || typeSet?.has("learning");
    const wantsScans =
      wantsAll || typeSet?.has("scan") || typeSet?.has("scan_complete");
    const wantsActions =
      wantsAll || typeSet?.has("draft") || typeSet?.has("suggestion");

    const memoriesQuery = supabase
      .from("agent_memories")
      .select("id, source, content, created_at")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (cursorIso) memoriesQuery.lt("created_at", cursorIso);

    const scansQuery = supabase
      .from("gmail_scan_jobs")
      .select("id, status, created_at, updated_at")
      .eq("company_id", companyId)
      .eq("requested_by_user_id", userId)
      .in("status", ["complete", "error", "running"])
      .gte("updated_at", since.toISOString())
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (cursorIso) scansQuery.lt("updated_at", cursorIso);

    const actionsQuery = supabase
      .from("agent_actions")
      .select("id, action_type, status, created_at")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (cursorIso) actionsQuery.lt("created_at", cursorIso);

    const [memoriesResult, scansResult, actionsResult] = await Promise.all([
      wantsMemories
        ? memoriesQuery
        : Promise.resolve({ data: [], error: null } as const),
      wantsScans
        ? scansQuery
        : Promise.resolve({ data: [], error: null } as const),
      wantsActions
        ? actionsQuery
        : Promise.resolve({ data: [], error: null } as const),
    ]);

    const events: RecentEvent[] = [];

    for (const m of memoriesResult.data ?? []) {
      const source = (m as Record<string, unknown>).source as string | null;
      const isLearning = source === "learning";
      events.push({
        id: String((m as Record<string, unknown>).id),
        type: isLearning ? "learning" : "extraction",
        title: isLearning ? "LEARNING" : "EXTRACTION",
        detail: truncate(
          String((m as Record<string, unknown>).content ?? ""),
          40
        ),
        createdAt: String((m as Record<string, unknown>).created_at),
        sourceTable: "agent_memories",
        sourceId: String((m as Record<string, unknown>).id),
      });
    }

    for (const j of scansResult.data ?? []) {
      const status = (j as Record<string, unknown>).status as string;
      events.push({
        id: String((j as Record<string, unknown>).id),
        type: status === "complete" ? "scan_complete" : "scan",
        title: status === "complete" ? "SCAN COMPLETE" : "SCAN",
        detail: null,
        createdAt: String(
          (j as Record<string, unknown>).updated_at ??
            (j as Record<string, unknown>).created_at
        ),
        sourceTable: "gmail_scan_jobs",
        sourceId: String((j as Record<string, unknown>).id),
      });
    }

    for (const a of actionsResult.data ?? []) {
      const actionType = (a as Record<string, unknown>).action_type as string;
      events.push({
        id: String((a as Record<string, unknown>).id),
        type: actionType === "send_email" ? "draft" : "suggestion",
        title: actionType === "send_email" ? "DRAFT" : "SUGGESTION",
        detail: null,
        createdAt: String((a as Record<string, unknown>).created_at),
        sourceTable: "agent_actions",
        sourceId: String((a as Record<string, unknown>).id),
      });
    }

    events.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const sliced = events.slice(0, limit);
    const nextCursor =
      sliced.length === limit ? sliced[sliced.length - 1].createdAt : null;

    return { events: sliced, nextCursor };
  },

  // ─── Per-tile queries ─────────────────────────────────────────────────────

  async getInputsState(
    companyId: string,
    userId: string
  ): Promise<DeckState["inputs"]> {
    const supabase = getServiceRoleClient();

    const [interviewCount, miningCount, scanJob, lastMemoryAt] =
      await Promise.all([
        supabase
          .from("agent_memories")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("user_id", userId)
          .eq("source", "intake_interview"),
        supabase
          .from("agent_memories")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("user_id", userId)
          .eq("source", "database"),
        supabase
          .from("gmail_scan_jobs")
          .select("id, status, created_at, updated_at, result")
          .eq("company_id", companyId)
          .eq("requested_by_user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("agent_memories")
          .select("created_at")
          .eq("company_id", companyId)
          .eq("user_id", userId)
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

  async getCorpusState(
    companyId: string,
    userId: string
  ): Promise<DeckState["corpus"]> {
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
        .eq("company_id", companyId)
        .eq("user_id", userId),
      supabase
        .from("agent_memories")
        .select("entity_id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .not("entity_id", "is", null),
      supabase
        .from("agent_memories")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .gte("created_at", startOfToday().toISOString()),
      supabase
        .from("agent_writing_profiles")
        .select("emails_analyzed")
        .eq("company_id", companyId)
        .eq("user_id", userId),
      getFactSparkline(companyId, userId),
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

  async getConfigState(
    companyId: string,
    userId: string,
    visibleCompanyConnectionIds: "all" | ReadonlySet<string>
  ): Promise<DeckState["config"]> {
    const supabase = getServiceRoleClient();

    const { data: emailConnections, error } = await supabase
      .from("email_connections")
      .select("id, type, user_id, status, auto_send_settings, sync_filters")
      .eq("company_id", companyId)
      .in("type", ["company", "individual"]);
    if (error) throw new Error(error.message);

    const visibleConnections = selectActorCalibrationConnections(
      (emailConnections ?? []) as CalibrationConnectionRow[],
      userId,
      visibleCompanyConnectionIds
    );
    const connections = await projectActorCategoryAutonomy(
      visibleConnections,
      userId
    );
    const config = aggregateCalibrationConnectionConfig(connections);

    const counts = { off: 0, draft: 0, auto_draft: 0, auto_send: 0 };
    for (const level of config.categoryLevels) {
      if (level in counts) counts[level as keyof typeof counts]++;
    }

    return {
      emailTypeCounts: counts,
      rulesCount: config.rulesCount,
      // Twelve primary email thread categories — fixed enum in the codebase.
      categoriesCount: EMAIL_THREAD_CATEGORIES.length,
    };
  },

  async getActivityState(
    companyId: string,
    userId: string
  ): Promise<DeckState["activity"]> {
    const supabase = getServiceRoleClient();

    const [runningJob, queuedActions, completedTodayActions] =
      await Promise.all([
        supabase
          .from("gmail_scan_jobs")
          .select("id, status, created_at, result")
          .eq("company_id", companyId)
          .eq("requested_by_user_id", userId)
          .eq("status", "running")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("agent_actions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("user_id", userId)
          .eq("status", "proposed"),
        supabase
          .from("agent_actions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("user_id", userId)
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
    companyId: string,
    userId: string,
    visibleCompanyConnectionIds: "all" | ReadonlySet<string>
  ): Promise<DeckState["milestones"]> {
    const supabase = getServiceRoleClient();

    const [
      phaseCOverride,
      scanJob,
      connections,
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
        .eq("requested_by_user_id", userId)
        .eq("status", "complete")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("email_connections")
        .select("id, type, user_id, status, auto_send_settings")
        .eq("company_id", companyId)
        .in("type", ["company", "individual"]),
      supabase
        .from("agent_writing_profiles")
        .select("emails_analyzed")
        .eq("company_id", companyId)
        .eq("user_id", userId),
      supabase
        .from("agent_actions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .eq("action_type", "send_appointment_confirmation")
        .eq("status", "executed"),
      supabase
        .from("admin_feature_overrides")
        .select("enabled")
        .eq("company_id", companyId)
        .eq("feature_key", "ai_auto_send")
        .maybeSingle(),
    ]);

    if (connections.error) {
      throw new Error(connections.error.message);
    }

    const visibleActorConnections = selectActorCalibrationConnections(
      (connections.data ?? []) as CalibrationConnectionRow[],
      userId,
      visibleCompanyConnectionIds
    );
    const actorConnections = await projectActorCategoryAutonomy(
      visibleActorConnections,
      userId
    );
    const milestones = mergeCalibrationMilestones(
      await Promise.all(
        actorConnections.map((connection) =>
          getActorAutonomyMilestones({
            companyId,
            connectionId: connection.id,
            userId,
            supabase,
          })
        )
      )
    );
    const categoryReadiness = (
      await Promise.all(
        actorConnections.flatMap((connection) =>
          EMAIL_THREAD_CATEGORIES.filter(
            (category) =>
              PhaseCCategoryAutonomy.profileTypesFor(category).length > 0
          ).map(async (category) => {
            const status = await PhaseCCategoryAutonomy.isGraduated(
              companyId,
              connection.id,
              userId,
              category
            );
            return {
              connectionId: connection.id,
              category,
              ready: status.ready,
              sampleSize: status.sampleSize,
            };
          })
        )
      )
    ).flat();
    const autoSendLadder = deriveCalibrationAutoSendLadder({
      connections: actorConnections,
      readiness: categoryReadiness,
      featureEnabled: autoSendEnabled.data?.enabled === true,
    });
    const { categoryAutonomy } =
      aggregateCalibrationConnectionConfig(actorConnections);
    const maxEmailsAnalyzed = (writingProfiles.data ?? []).reduce(
      (max, p) => Math.max(max, (p.emails_analyzed as number | null) ?? 0),
      0
    );
    const confidence = WritingProfileService.getConfidence(maxEmailsAnalyzed);
    const apptCount = apptConfirms.count ?? 0;
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
        status: Object.keys(categoryAutonomy).length > 0 ? "complete" : "gated",
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
        status: autoSendLadder.readinessStatus,
        persistent: true,
      },
      {
        position: 9,
        status: autoSendLadder.activeStatus,
        persistent: false,
      },
    ];

    const reachedCount = ladder.filter((l) => l.status === "complete").length;
    const next = ladder.find((l) => l.status !== "complete");

    const domains = {
      email: deriveDomainStatus(confidence),
      projects: await deriveProjectsStatus(companyId, userId),
      invoice: await deriveInvoiceStatus(companyId, userId),
      schedule: await deriveScheduleStatus(companyId, userId),
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

async function getFactSparkline(
  companyId: string,
  userId: string
): Promise<number[]> {
  const supabase = getServiceRoleClient();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("agent_memories")
    .select("created_at")
    .eq("company_id", companyId)
    .eq("user_id", userId)
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

async function deriveProjectsStatus(
  companyId: string,
  userId: string
): Promise<DomainStatus> {
  const supabase = getServiceRoleClient();
  const { count } = await supabase
    .from("agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("action_type", "create_task");

  if ((count ?? 0) > 5)
    return { status: "nominal", confidence: null, metric: `${count}` };
  if ((count ?? 0) > 0)
    return { status: "learning", confidence: null, metric: `${count}` };
  return { status: "gated", confidence: null, metric: null };
}

async function deriveInvoiceStatus(
  companyId: string,
  userId: string
): Promise<DomainStatus> {
  const supabase = getServiceRoleClient();
  const { count } = await supabase
    .from("agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("user_id", userId)
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

async function deriveScheduleStatus(
  companyId: string,
  userId: string
): Promise<DomainStatus> {
  const supabase = getServiceRoleClient();
  const { count } = await supabase
    .from("agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .in("action_type", ["send_appointment_confirmation", "optimize_schedule"]);

  if ((count ?? 0) > 10)
    return { status: "nominal", confidence: null, metric: `${count}` };
  if ((count ?? 0) > 0)
    return { status: "learning", confidence: null, metric: `${count}` };
  return { status: "gated", confidence: null, metric: null };
}

function resolveTimeRangeCutoff(range: ActivityFilters["timeRange"]): Date {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  switch (range) {
    case "hour":
      return new Date(now - hour);
    case "day":
      return new Date(now - 24 * hour);
    case "week":
      return new Date(now - 7 * 24 * hour);
    case "month":
      return new Date(now - 30 * 24 * hour);
    case "all":
      return new Date(0);
  }
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

async function resolveCalibrationCompanyConnectionScope(
  companyId: string,
  access: AllowedEmailInboxListAccess
): Promise<"all" | ReadonlySet<string>> {
  if (access.inboxScope === "all") return "all";

  const authorizationFilter = buildEmailThreadListAuthorizationFilter(access);
  if (authorizationFilter.empty) return new Set<string>();

  const supabase = getServiceRoleClient();
  let query = supabase
    .from("email_threads")
    .select("connection_id")
    .eq("company_id", companyId);
  if (authorizationFilter.connectionIds) {
    query = query.in("connection_id", authorizationFilter.connectionIds);
  }
  if (authorizationFilter.unlinkedOnly) {
    query = query.is("opportunity_id", null);
  }
  if (authorizationFilter.or) {
    query = query.or(authorizationFilter.or);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return new Set(
    (data ?? []).map((row) => String(row.connection_id)).filter(Boolean)
  );
}
