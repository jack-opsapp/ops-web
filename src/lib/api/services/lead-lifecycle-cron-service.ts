/**
 * Lead Lifecycle automation cron service.
 *
 * This is the scheduled, non-interactive counterpart to the manual operator
 * script `scripts/lead-lifecycle-p4-non-destructive-actions.ts`. It REUSES the
 * same audited engine — `evaluateOpportunityLifecycle` for decisions and
 * `opportunity-lifecycle-action-service` for execution — so the cron and the
 * manual script can never drift in behaviour.
 *
 * Execution boundary (enforced, not advisory):
 *
 *   - NON-DESTRUCTIVE decisions (`create_follow_up_draft`,
 *     `operator_follow_up_miss`) are AUTO-EXECUTED by calling
 *     `executeOpportunityLifecycleAction({ mode: "apply", ... })`. Idempotency
 *     is delegated entirely to the action-service, which honours the
 *     `opportunity_follow_up_drafts_open_template_uidx` partial unique index
 *     (one open `template_follow_up` draft per opportunity) and the
 *     `notifications.dedupe_key` (`lead_lifecycle:operator_follow_up_miss:<id>`)
 *     unread/unresolved guard. A second cron run therefore creates zero
 *     duplicate drafts and zero duplicate notifications.
 *
 *   - DESTRUCTIVE decisions (`archive_after_two_unanswered_followups`,
 *     `archive_no_meaningful_correspondence`, `move_to_lost_operator_no_response`,
 *     `reactivate_on_related_inbound`) are NEVER executed. The cron does not
 *     call `executeOpportunityLifecycleAction` for these at all, so the guarded
 *     RPC `execute_opportunity_lifecycle_guarded_action` can never be invoked
 *     from the schedule. They are surfaced as DRY-RUN candidates only, for
 *     operator review.
 *
 *   - Meaningful inbound supersede (`resetStaleLifecycleAfterMeaningfulInbound`)
 *     is non-destructive (it supersedes local drafts + resolves local
 *     notifications + resets lifecycle state) and is applied.
 *
 * Defensive fragmentation skip: an opportunity whose correspondence is
 * fragmented / quarantined (its activities or correspondence events carry
 * synthetic `legacy%` thread ids from the DW1 de-aggregation — `legacy:%` on
 * `activities.email_thread_id`, `legacy-activity:%` / `legacy-opportunity:%` on
 * `opportunity_correspondence_events.provider_thread_id`) must NOT have
 * destructive evaluation acted on. Such opportunities still receive
 * non-destructive treatment, but any destructive candidate they produce is
 * flagged `skipped-fragmented` instead of being emitted as actionable.
 *
 * No emails, no provider drafts, no provider sends are ever performed.
 */

import {
  executeOpportunityLifecycleAction,
  resetStaleLifecycleAfterMeaningfulInbound,
  type OpportunityLifecycleActionState,
} from "./opportunity-lifecycle-action-service";
import {
  DEFAULT_LEAD_LIFECYCLE_SETTINGS,
  evaluateOpportunityLifecycle,
  type LeadLifecycleSettings,
  type OpportunityLifecycleDecision,
  type OpportunityLifecycleDecisionAction,
} from "@/lib/email/opportunity-lifecycle-evaluator";

interface CronSupabaseLike {
  // The P4/P5 lifecycle tables are not present in the generated Supabase types
  // until the schema is regenerated, so the cron targets them via `any` chains
  // exactly as the action-service and manual script do.
  from: (table: string) => any;
  rpc?: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
}

export interface LeadLifecycleCronInput {
  supabase: CronSupabaseLike;
  now?: Date;
  /** Hard cap on opportunities scanned per run. Mirrors the manual script. */
  maxOpportunities?: number;
}

const NON_DESTRUCTIVE_ACTIONS = new Set<OpportunityLifecycleDecisionAction>([
  "create_follow_up_draft",
  "operator_follow_up_miss",
]);

const DESTRUCTIVE_ACTIONS = new Set<OpportunityLifecycleDecisionAction>([
  "archive_after_two_unanswered_followups",
  "archive_no_meaningful_correspondence",
  "move_to_lost_operator_no_response",
  "reactivate_on_related_inbound",
]);

const DEFAULT_MAX_OPPORTUNITIES = 2000;
const CHUNK = 100;

/**
 * Prefix family for synthetic / quarantined thread ids produced by the DW1
 * de-aggregation. Two distinct generators exist in the codebase:
 *   - P1 blank-thread remediation:  `legacy:<uuid>` on activities.email_thread_id
 *   - legacy correspondence backfill: `legacy-activity:<id>` /
 *     `legacy-opportunity:<id>` on opportunity_correspondence_events.provider_thread_id
 * Both share the `legacy` prefix, so a single `legacy%` LIKE family covers the
 * full quarantine surface. The colon (`legacy:`) and dash (`legacy-`) variants
 * are both matched.
 */
const LEGACY_THREAD_PREFIX = "legacy%";

export interface DestructiveCandidate {
  opportunityId: string;
  companyId: string;
  action: OpportunityLifecycleDecisionAction;
  reason: string;
  /** "dry-run" = actionable for operator review; "skipped-fragmented" = quarantined. */
  status: "dry-run" | "skipped-fragmented";
  evidence: Record<string, unknown>;
}

export interface LeadLifecycleCronResult {
  scanned: number;
  eligibleCompanies: number;
  fragmentedOpportunities: number;
  draftsCreated: number;
  draftsSkippedExisting: number;
  notificationsCreated: number;
  notificationsSkippedExisting: number;
  lifecycleStatesUpdated: number;
  draftsSuperseded: number;
  destructiveDryRun: number;
  destructiveSkippedFragmented: number;
  nonDestructiveSkipped: number;
  errors: number;
  /** Capped sample of destructive candidates for the structured log. */
  destructiveCandidates: DestructiveCandidate[];
}

interface OpportunityRow {
  id: string;
  company_id: string;
  title: string | null;
  stage: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  project_id: string | null;
  project_ref: string | null;
  created_at: string | null;
  stage_entered_at: string | null;
  contact_name: string | null;
  updated_at: string | null;
}

interface CorrespondenceEventRow {
  id: string;
  opportunity_id: string;
  connection_id: string | null;
  provider_thread_id: string | null;
  direction: "inbound" | "outbound";
  party_role: string | null;
  is_meaningful: boolean;
  occurred_at: string;
  linked_contact_kind: string | null;
}

interface LifecycleStateRow {
  opportunity_id: string;
  company_id: string;
  last_meaningful_event_id: string | null;
  last_meaningful_at: string | null;
  last_meaningful_direction: string | null;
  unanswered_follow_up_count: number | null;
  second_follow_up_sent_at: string | null;
  operator_follow_up_miss_at: string | null;
  stale_status: string | null;
  stale_status_at: string | null;
}

interface SettingsRow {
  company_id: string;
  follow_up_after_days: number;
  second_follow_up_archive_after_days: number;
  no_correspondence_archive_days: number;
  inbound_unreplied_lost_days: number;
  follow_up_template_subject: string;
  follow_up_template_body: string;
  auto_archive_enabled: boolean;
  auto_lost_enabled: boolean;
}

const DESTRUCTIVE_CANDIDATE_LOG_CAP = 200;

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value)))
  );
}

function settingsFromRow(row: SettingsRow): LeadLifecycleSettings {
  return {
    followUpAfterDays: row.follow_up_after_days,
    secondFollowUpArchiveAfterDays: row.second_follow_up_archive_after_days,
    noCorrespondenceArchiveDays: row.no_correspondence_archive_days,
    inboundUnrepliedLostDays: row.inbound_unreplied_lost_days,
    followUpTemplateSubject: row.follow_up_template_subject,
    followUpTemplateBody: row.follow_up_template_body,
    autoArchiveEnabled: row.auto_archive_enabled,
    autoLostEnabled: row.auto_lost_enabled,
  };
}

function lifecycleStateFromRow(
  row: LifecycleStateRow | undefined
): OpportunityLifecycleActionState | null {
  if (!row) return null;
  return {
    lastMeaningfulEventId: row.last_meaningful_event_id,
    lastMeaningfulAt: row.last_meaningful_at,
    lastMeaningfulDirection: row.last_meaningful_direction,
    unansweredFollowUpCount: row.unanswered_follow_up_count,
    secondFollowUpSentAt: row.second_follow_up_sent_at,
    operatorFollowUpMissAt: row.operator_follow_up_miss_at,
    staleStatus: row.stale_status,
    staleStatusAt: row.stale_status_at,
  };
}

function latestMeaningfulEvent(
  rows: CorrespondenceEventRow[]
): CorrespondenceEventRow | null {
  return (
    [...rows]
      .filter((row) => row.is_meaningful)
      .sort(
        (a, b) =>
          new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      )[0] ?? null
  );
}

/**
 * Eligible companies = those with a lead_lifecycle_settings row OR an active
 * email_connection. Mirrors the task's "companies with lifecycle settings /
 * live connections" gate. Companies with neither are not swept.
 */
async function fetchEligibleCompanyIds(
  supabase: CronSupabaseLike
): Promise<Set<string>> {
  const eligible = new Set<string>();

  const settings = await supabase
    .from("lead_lifecycle_settings")
    .select("company_id");
  for (const row of (settings.data ?? []) as Array<{ company_id: string }>) {
    if (row.company_id) eligible.add(row.company_id);
  }

  const connections = await supabase
    .from("email_connections")
    .select("company_id")
    .eq("status", "active");
  for (const row of (connections.data ?? []) as Array<{ company_id: string }>) {
    if (row.company_id) eligible.add(row.company_id);
  }

  return eligible;
}

async function fetchOpportunities(
  supabase: CronSupabaseLike,
  eligibleCompanyIds: Set<string>,
  maxOpportunities: number
): Promise<OpportunityRow[]> {
  // Chunk the eligible-company filter the same way every other fetch in this
  // file does (CHUNK=100). A single unbounded `.in("company_id", [...])` would
  // exceed PostgREST's URL/statement limits as the eligible-company set grows;
  // chunking keeps each request bounded. We over-fetch up to `maxOpportunities`
  // per chunk, merge, re-sort by updated_at desc, then apply the global cap so
  // the run-wide ceiling still holds regardless of company count.
  const merged: OpportunityRow[] = [];
  for (const ids of chunk(Array.from(eligibleCompanyIds), CHUNK)) {
    if (ids.length === 0) continue;
    const { data } = await supabase
      .from("opportunities")
      .select(
        "id, company_id, title, stage, archived_at, deleted_at, project_id, project_ref, created_at, stage_entered_at, contact_name, updated_at"
      )
      .is("deleted_at", null)
      .in("company_id", ids)
      .order("updated_at", { ascending: false })
      .limit(maxOpportunities);
    for (const row of (data ?? []) as OpportunityRow[]) {
      if (eligibleCompanyIds.has(row.company_id)) merged.push(row);
    }
  }

  merged.sort((a, b) => {
    const at = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bt = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return bt - at;
  });

  return merged.slice(0, maxOpportunities);
}

async function fetchEvents(
  supabase: CronSupabaseLike,
  opportunityIds: string[]
): Promise<Map<string, CorrespondenceEventRow[]>> {
  const byOpportunity = new Map<string, CorrespondenceEventRow[]>();
  for (const ids of chunk(opportunityIds, CHUNK)) {
    const { data } = await supabase
      .from("opportunity_correspondence_events")
      .select(
        "id, opportunity_id, connection_id, provider_thread_id, direction, party_role, is_meaningful, occurred_at, linked_contact_kind"
      )
      .in("opportunity_id", ids)
      .order("occurred_at", { ascending: true });
    for (const row of (data ?? []) as CorrespondenceEventRow[]) {
      const list = byOpportunity.get(row.opportunity_id) ?? [];
      list.push(row);
      byOpportunity.set(row.opportunity_id, list);
    }
  }
  return byOpportunity;
}

async function fetchLifecycleStates(
  supabase: CronSupabaseLike,
  opportunityIds: string[]
): Promise<Map<string, LifecycleStateRow>> {
  const map = new Map<string, LifecycleStateRow>();
  for (const ids of chunk(opportunityIds, CHUNK)) {
    const { data } = await supabase
      .from("opportunity_lifecycle_state")
      .select(
        "opportunity_id, company_id, last_meaningful_event_id, last_meaningful_at, last_meaningful_direction, unanswered_follow_up_count, second_follow_up_sent_at, operator_follow_up_miss_at, stale_status, stale_status_at"
      )
      .in("opportunity_id", ids);
    for (const row of (data ?? []) as LifecycleStateRow[]) {
      map.set(row.opportunity_id, row);
    }
  }
  return map;
}

async function fetchSettings(
  supabase: CronSupabaseLike,
  companyIds: string[]
): Promise<Map<string, LeadLifecycleSettings>> {
  if (companyIds.length === 0) return new Map();
  const map = new Map<string, LeadLifecycleSettings>();
  for (const ids of chunk(companyIds, CHUNK)) {
    const { data } = await supabase
      .from("lead_lifecycle_settings")
      .select(
        "company_id, follow_up_after_days, second_follow_up_archive_after_days, no_correspondence_archive_days, inbound_unreplied_lost_days, follow_up_template_subject, follow_up_template_body, auto_archive_enabled, auto_lost_enabled"
      )
      .in("company_id", ids);
    for (const row of (data ?? []) as SettingsRow[]) {
      map.set(row.company_id, settingsFromRow(row));
    }
  }
  return map;
}

/**
 * Resolve the operator (notification recipient) per company. Mirrors the manual
 * script: prefer companies.admin_ids[0], fall back to the first active company
 * admin user. Companies with no resolvable operator simply get
 * `skipped_missing_operator` from the action-service for the notification path.
 */
async function fetchOperators(
  supabase: CronSupabaseLike,
  companyIds: string[]
): Promise<Map<string, string | null>> {
  const operatorByCompany = new Map<string, string | null>();
  if (companyIds.length === 0) return operatorByCompany;

  for (const ids of chunk(companyIds, CHUNK)) {
    const { data } = await supabase
      .from("companies")
      .select("id, admin_ids")
      .in("id", ids);
    for (const company of (data ?? []) as Array<{
      id: string;
      admin_ids: string[] | null;
    }>) {
      operatorByCompany.set(company.id, company.admin_ids?.[0] ?? null);
    }
  }

  const missing = companyIds.filter((id) => !operatorByCompany.get(id));
  for (const ids of chunk(missing, CHUNK)) {
    if (ids.length === 0) continue;
    const { data } = await supabase
      .from("users")
      .select("id, company_id, is_company_admin, is_active")
      .in("company_id", ids)
      .eq("is_company_admin", true)
      .is("deleted_at", null);
    for (const user of (data ?? []) as Array<{
      id: string;
      company_id: string | null;
      is_active: boolean | null;
    }>) {
      if (!user.company_id) continue;
      if (user.is_active === false) continue;
      if (!operatorByCompany.get(user.company_id)) {
        operatorByCompany.set(user.company_id, user.id);
      }
    }
  }

  return operatorByCompany;
}

/**
 * Set of opportunity ids whose correspondence is fragmented / quarantined.
 * Two independent probes, unioned: any opportunity that has a `legacy%`
 * activity thread id OR a `legacy%` correspondence-event provider thread id is
 * fragmented. These are head-count probes scoped to the scanned opportunity
 * set so the predicate is exact and cheap.
 */
async function fetchFragmentedOpportunityIds(
  supabase: CronSupabaseLike,
  opportunityIds: string[]
): Promise<Set<string>> {
  const fragmented = new Set<string>();
  for (const ids of chunk(opportunityIds, CHUNK)) {
    const activityProbe = await supabase
      .from("activities")
      .select("opportunity_id")
      .in("opportunity_id", ids)
      .like("email_thread_id", LEGACY_THREAD_PREFIX);
    for (const row of (activityProbe.data ?? []) as Array<{
      opportunity_id: string | null;
    }>) {
      if (row.opportunity_id) fragmented.add(row.opportunity_id);
    }

    const eventProbe = await supabase
      .from("opportunity_correspondence_events")
      .select("opportunity_id")
      .in("opportunity_id", ids)
      .like("provider_thread_id", LEGACY_THREAD_PREFIX);
    for (const row of (eventProbe.data ?? []) as Array<{
      opportunity_id: string | null;
    }>) {
      if (row.opportunity_id) fragmented.add(row.opportunity_id);
    }
  }
  return fragmented;
}

export async function runLeadLifecycleCron(
  input: LeadLifecycleCronInput
): Promise<LeadLifecycleCronResult> {
  const supabase = input.supabase;
  const now = input.now ?? new Date();
  const maxOpportunities = input.maxOpportunities ?? DEFAULT_MAX_OPPORTUNITIES;

  const result: LeadLifecycleCronResult = {
    scanned: 0,
    eligibleCompanies: 0,
    fragmentedOpportunities: 0,
    draftsCreated: 0,
    draftsSkippedExisting: 0,
    notificationsCreated: 0,
    notificationsSkippedExisting: 0,
    lifecycleStatesUpdated: 0,
    draftsSuperseded: 0,
    destructiveDryRun: 0,
    destructiveSkippedFragmented: 0,
    nonDestructiveSkipped: 0,
    errors: 0,
    destructiveCandidates: [],
  };

  const eligibleCompanyIds = await fetchEligibleCompanyIds(supabase);
  result.eligibleCompanies = eligibleCompanyIds.size;
  if (eligibleCompanyIds.size === 0) return result;

  const opportunities = await fetchOpportunities(
    supabase,
    eligibleCompanyIds,
    maxOpportunities
  );
  result.scanned = opportunities.length;
  if (opportunities.length === 0) return result;

  const opportunityIds = opportunities.map((row) => row.id);
  const companyIds = unique(opportunities.map((row) => row.company_id));

  const [eventsByOpportunity, lifecycleStates, settingsByCompany, operators, fragmentedIds] =
    await Promise.all([
      fetchEvents(supabase, opportunityIds),
      fetchLifecycleStates(supabase, opportunityIds),
      fetchSettings(supabase, companyIds),
      fetchOperators(supabase, companyIds),
      fetchFragmentedOpportunityIds(supabase, opportunityIds),
    ]);

  result.fragmentedOpportunities = fragmentedIds.size;

  for (const opportunity of opportunities) {
    const eventRows = eventsByOpportunity.get(opportunity.id) ?? [];
    const meaningfulEvents = eventRows
      .filter((row) => row.is_meaningful)
      .map((row) => ({
        id: row.id,
        direction: row.direction,
        isMeaningful: row.is_meaningful,
        occurredAt: row.occurred_at,
        partyRole: row.party_role,
        linkedContactKind: row.linked_contact_kind,
      }));
    const lifecycleState = lifecycleStateFromRow(lifecycleStates.get(opportunity.id));
    const settings =
      settingsByCompany.get(opportunity.company_id) ?? DEFAULT_LEAD_LIFECYCLE_SETTINGS;

    const decision: OpportunityLifecycleDecision = evaluateOpportunityLifecycle({
      opportunity: {
        id: opportunity.id,
        stage: opportunity.stage,
        archivedAt: opportunity.archived_at,
        deletedAt: opportunity.deleted_at,
        projectId: opportunity.project_id,
        projectRef: opportunity.project_ref,
        createdAt: opportunity.created_at,
        stageEnteredAt: opportunity.stage_entered_at,
      },
      lifecycleState,
      meaningfulEvents,
      settings,
      now,
    });

    if (decision.action === "no_action" || decision.ignored) {
      // Non-destructive supersede pass still applies below.
    } else if (NON_DESTRUCTIVE_ACTIONS.has(decision.action)) {
      const latestEvent = latestMeaningfulEvent(eventRows);
      try {
        const execution = await executeOpportunityLifecycleAction({
          supabase,
          mode: "apply",
          companyId: opportunity.company_id,
          opportunityId: opportunity.id,
          opportunityTitle: opportunity.title,
          decision,
          lifecycleState,
          settings,
          latestMeaningfulEvent: latestEvent
            ? {
                id: latestEvent.id,
                direction: latestEvent.direction,
                isMeaningful: latestEvent.is_meaningful,
                occurredAt: latestEvent.occurred_at,
                connectionId: latestEvent.connection_id,
                providerThreadId: latestEvent.provider_thread_id,
                linkedContactKind: latestEvent.linked_contact_kind,
              }
            : null,
          operatorUserId: operators.get(opportunity.company_id) ?? null,
          contactName: opportunity.contact_name,
          runId: `cron:${now.toISOString()}`,
          now,
        });

        const ops = execution.operations;
        if (ops.draft === "created") result.draftsCreated += 1;
        if (ops.draft === "skipped_existing_open_template") {
          result.draftsSkippedExisting += 1;
        }
        if (ops.notification === "created") result.notificationsCreated += 1;
        if (ops.notification === "skipped_existing_unread") {
          result.notificationsSkippedExisting += 1;
        }
        if (ops.lifecycleState === "updated") result.lifecycleStatesUpdated += 1;
        if (
          ops.draft === "skipped_insert_failed" ||
          ops.notification === "skipped_insert_failed" ||
          ops.draft === "skipped_lifecycle_state_failed" ||
          ops.lifecycleState === "skipped_update_failed"
        ) {
          result.errors += 1;
        }
        if (
          ops.draft === "skipped_missing_source_event" ||
          ops.notification === "skipped_missing_operator"
        ) {
          result.nonDestructiveSkipped += 1;
        }
      } catch {
        result.errors += 1;
      }
    } else if (DESTRUCTIVE_ACTIONS.has(decision.action)) {
      // DRY-RUN candidates only. The cron NEVER calls
      // executeOpportunityLifecycleAction for destructive actions, so the
      // guarded RPC can never fire from the schedule.
      const fragmented = fragmentedIds.has(opportunity.id);
      const status: DestructiveCandidate["status"] = fragmented
        ? "skipped-fragmented"
        : "dry-run";
      if (fragmented) {
        result.destructiveSkippedFragmented += 1;
      } else {
        result.destructiveDryRun += 1;
      }
      if (result.destructiveCandidates.length < DESTRUCTIVE_CANDIDATE_LOG_CAP) {
        result.destructiveCandidates.push({
          opportunityId: opportunity.id,
          companyId: opportunity.company_id,
          action: decision.action,
          reason: decision.reason,
          status,
          evidence: decision.evidence,
        });
      }
    }

    // Non-destructive supersede: when a meaningful inbound is the latest event
    // and there is a stale open template-follow-up draft outstanding, supersede
    // it and reset lifecycle state. Mirrors the manual script — gated on a
    // projected `supersededDrafts > 0` so it only fires when there is an actual
    // open draft to close.
    //
    // CRITICAL idempotency guard: this pass must NOT run when the current
    // decision is one where the OPERATOR still owes the reply
    // (`operator_follow_up_miss` / `move_to_lost_operator_no_response`). Those
    // decisions fire on exactly the same `latestEvent.direction === "inbound"`
    // condition the supersede keys on, but they mean the opposite thing — the
    // customer reached out and OPS has not yet replied, so the operator must be
    // alerted (a persistent `leads_waiting` notification), NOT have the inbound
    // treated as the customer re-engaging after an OPS follow-up. If we let the
    // supersede run on this pass it would call
    // `resetStaleLifecycleAfterMeaningfulInbound(apply)`, which resolves
    // (is_read=true, resolved_at=now) every unread/unresolved operator-miss
    // notification for the opp — INCLUDING the one this same loop iteration just
    // created — so the operator never sees it and the dedupe guard (which only
    // matches unread+unresolved rows) lets the next run insert a fresh duplicate
    // forever. The two paths are mutually exclusive by construction, so we skip
    // the supersede whenever the decision is operator-owes-reply. The supersede
    // is intended only for the case where the inbound represents the customer
    // re-engaging on a thread OPS had already followed up on (i.e. there is an
    // open template draft AND the decision is not an operator-miss/lost).
    const latestEvent = latestMeaningfulEvent(eventRows);
    const operatorOwesReply =
      decision.action === "operator_follow_up_miss" ||
      decision.action === "move_to_lost_operator_no_response";
    if (latestEvent && latestEvent.direction === "inbound" && !operatorOwesReply) {
      try {
        const projected = await resetStaleLifecycleAfterMeaningfulInbound({
          supabase,
          mode: "dry-run",
          companyId: opportunity.company_id,
          opportunityId: opportunity.id,
          eventId: latestEvent.id,
          occurredAt: latestEvent.occurred_at,
          now,
        });
        if (projected.operations.supersededDrafts > 0) {
          const reset = await resetStaleLifecycleAfterMeaningfulInbound({
            supabase,
            mode: "apply",
            companyId: opportunity.company_id,
            opportunityId: opportunity.id,
            eventId: latestEvent.id,
            occurredAt: latestEvent.occurred_at,
            now,
          });
          result.draftsSuperseded += reset.operations.supersededDrafts;
          if (reset.operations.lifecycleState === "updated") {
            result.lifecycleStatesUpdated += 1;
          } else if (reset.operations.lifecycleState === "skipped_update_failed") {
            result.errors += 1;
          }
        }
      } catch {
        result.errors += 1;
      }
    }
  }

  return result;
}
