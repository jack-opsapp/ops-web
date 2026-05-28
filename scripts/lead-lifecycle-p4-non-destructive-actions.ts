/*
 * Lead Lifecycle P4-8 non-destructive action executor.
 *
 * Default mode is dry-run. Apply mode is limited to local template draft rows,
 * persistent operator notifications, and lifecycle state markers. It never
 * sends email, creates provider drafts, archives, marks lost, or reactivates.
 *
 * Usage:
 *   npx tsx scripts/lead-lifecycle-p4-non-destructive-actions.ts
 *   npx tsx scripts/lead-lifecycle-p4-non-destructive-actions.ts --company-id <uuid>
 *   npx tsx scripts/lead-lifecycle-p4-non-destructive-actions.ts --apply-non-destructive-p4-actions
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  executeOpportunityLifecycleAction,
  resetStaleLifecycleAfterMeaningfulInbound,
  type OpportunityLifecycleActionState,
  type OpportunityLifecycleExecutionMode,
} from "../src/lib/api/services/opportunity-lifecycle-action-service";
import {
  DEFAULT_LEAD_LIFECYCLE_SETTINGS,
  evaluateOpportunityLifecycle,
  type LeadLifecycleSettings,
  type OpportunityLifecycleDecision,
  type OpportunityLifecycleMeaningfulEvent,
} from "../src/lib/email/opportunity-lifecycle-evaluator";

const ENV_DIR = process.env.OPS_WEB_ENV_DIR || process.cwd();
loadEnvConfig(ENV_DIR);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const today = new Date().toISOString().slice(0, 10);
const DEFAULT_OUTPUT =
  `/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p4-8-non-destructive-dry-run-${today}.md`;

const ACTIVE_STAGES = [
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
];

const companyIdArgIdx = process.argv.indexOf("--company-id");
const COMPANY_ID =
  companyIdArgIdx >= 0 ? process.argv[companyIdArgIdx + 1] : null;
const outputArgIdx = process.argv.indexOf("--output");
const OUTPUT_PATH =
  outputArgIdx >= 0 ? process.argv[outputArgIdx + 1] : DEFAULT_OUTPUT;
const maxOpportunitiesArgIdx = process.argv.indexOf("--max-opportunities");
const MAX_OPPORTUNITIES =
  maxOpportunitiesArgIdx >= 0
    ? Number.parseInt(process.argv[maxOpportunitiesArgIdx + 1], 10)
    : 2000;
const nowArgIdx = process.argv.indexOf("--now");
const NOW =
  nowArgIdx >= 0 ? new Date(process.argv[nowArgIdx + 1]) : new Date();
const APPLY = process.argv.includes("--apply-non-destructive-p4-actions");
const MODE: OpportunityLifecycleExecutionMode = APPLY ? "apply" : "dry-run";

if (!OUTPUT_PATH) {
  console.error("--output must not be blank");
  process.exit(1);
}

if (!Number.isFinite(MAX_OPPORTUNITIES) || MAX_OPPORTUNITIES <= 0) {
  console.error("--max-opportunities must be a positive integer");
  process.exit(1);
}

if (Number.isNaN(NOW.getTime())) {
  console.error("--now must be an ISO date/time");
  process.exit(1);
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
}

interface CorrespondenceEventRow {
  id: string;
  company_id: string;
  opportunity_id: string;
  connection_id: string | null;
  provider_thread_id: string | null;
  direction: "inbound" | "outbound";
  is_meaningful: boolean;
  occurred_at: string;
  party_role: string | null;
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

interface CompanyRow {
  id: string;
  admin_ids: string[] | null;
}

interface UserRow {
  id: string;
  company_id: string | null;
  is_company_admin: boolean | null;
  is_active: boolean | null;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function md(value: unknown): string {
  const text = value == null || value === "" ? "-" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
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

function eventForEvaluator(row: CorrespondenceEventRow): OpportunityLifecycleMeaningfulEvent {
  return {
    id: row.id,
    direction: row.direction,
    isMeaningful: row.is_meaningful,
    occurredAt: row.occurred_at,
    partyRole: row.party_role,
    linkedContactKind: row.linked_contact_kind,
  };
}

function latestMeaningfulEvent(
  rows: CorrespondenceEventRow[]
): CorrespondenceEventRow | null {
  return [...rows]
    .filter((row) => row.is_meaningful)
    .sort(
      (a, b) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    )[0] ?? null;
}

async function fetchOpportunities(): Promise<OpportunityRow[]> {
  let query = sb
    .from("opportunities")
    .select(
      "id, company_id, title, stage, archived_at, deleted_at, project_id, project_ref, created_at, stage_entered_at, contact_name"
    )
    .in("stage", ACTIVE_STAGES)
    .is("archived_at", null)
    .is("deleted_at", null)
    .is("project_id", null)
    .is("project_ref", null)
    .order("updated_at", { ascending: false })
    .limit(MAX_OPPORTUNITIES);

  if (COMPANY_ID) query = query.eq("company_id", COMPANY_ID);

  const { data, error } = await query;
  if (error) throw new Error(`opportunities query failed: ${error.message}`);
  return (data ?? []) as OpportunityRow[];
}

async function fetchEvents(
  opportunityIds: string[]
): Promise<Map<string, CorrespondenceEventRow[]>> {
  const rows: CorrespondenceEventRow[] = [];
  for (const ids of chunk(opportunityIds, 500)) {
    const { data, error } = await sb
      .from("opportunity_correspondence_events")
      .select(
        "id, company_id, opportunity_id, connection_id, provider_thread_id, direction, is_meaningful, occurred_at, party_role, linked_contact_kind"
      )
      .in("opportunity_id", ids)
      .order("occurred_at", { ascending: true });
    if (error) throw new Error(`correspondence events query failed: ${error.message}`);
    rows.push(...((data ?? []) as CorrespondenceEventRow[]));
  }

  const byOpportunity = new Map<string, CorrespondenceEventRow[]>();
  for (const row of rows) {
    const list = byOpportunity.get(row.opportunity_id) ?? [];
    list.push(row);
    byOpportunity.set(row.opportunity_id, list);
  }
  return byOpportunity;
}

async function fetchLifecycleStates(
  opportunityIds: string[]
): Promise<Map<string, LifecycleStateRow>> {
  const rows: LifecycleStateRow[] = [];
  for (const ids of chunk(opportunityIds, 500)) {
    const { data, error } = await sb
      .from("opportunity_lifecycle_state")
      .select(
        "opportunity_id, company_id, last_meaningful_event_id, last_meaningful_at, last_meaningful_direction, unanswered_follow_up_count, second_follow_up_sent_at, operator_follow_up_miss_at, stale_status, stale_status_at"
      )
      .in("opportunity_id", ids);
    if (error) throw new Error(`opportunity_lifecycle_state query failed: ${error.message}`);
    rows.push(...((data ?? []) as LifecycleStateRow[]));
  }
  return new Map(rows.map((row) => [row.opportunity_id, row]));
}

async function fetchSettings(
  companyIds: string[]
): Promise<Map<string, LeadLifecycleSettings>> {
  if (companyIds.length === 0) return new Map();
  const { data, error } = await sb
    .from("lead_lifecycle_settings")
    .select(
      "company_id, follow_up_after_days, second_follow_up_archive_after_days, no_correspondence_archive_days, inbound_unreplied_lost_days, follow_up_template_subject, follow_up_template_body, auto_archive_enabled, auto_lost_enabled"
    )
    .in("company_id", companyIds);

  if (error) throw new Error(`lead_lifecycle_settings query failed: ${error.message}`);
  return new Map(
    ((data ?? []) as SettingsRow[]).map((row) => [row.company_id, settingsFromRow(row)])
  );
}

async function fetchOperators(companyIds: string[]): Promise<Map<string, string | null>> {
  if (companyIds.length === 0) return new Map();
  const { data: companies, error: companyError } = await sb
    .from("companies")
    .select("id, admin_ids")
    .in("id", companyIds);
  if (companyError) throw new Error(`companies query failed: ${companyError.message}`);

  const operatorByCompany = new Map<string, string | null>();
  for (const company of (companies ?? []) as CompanyRow[]) {
    operatorByCompany.set(company.id, company.admin_ids?.[0] ?? null);
  }

  const companiesMissingOperator = companyIds.filter(
    (companyId) => !operatorByCompany.get(companyId)
  );
  if (companiesMissingOperator.length === 0) return operatorByCompany;

  const { data: users, error: userError } = await sb
    .from("users")
    .select("id, company_id, is_company_admin, is_active")
    .in("company_id", companiesMissingOperator)
    .eq("is_company_admin", true)
    .is("deleted_at", null);
  if (userError) throw new Error(`users query failed: ${userError.message}`);

  for (const user of (users ?? []) as UserRow[]) {
    if (!user.company_id) continue;
    if (user.is_active === false) continue;
    if (!operatorByCompany.get(user.company_id)) {
      operatorByCompany.set(user.company_id, user.id);
    }
  }

  return operatorByCompany;
}

function countByAction(decisions: OpportunityLifecycleDecision[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const decision of decisions) {
    counts.set(decision.action, (counts.get(decision.action) ?? 0) + 1);
  }
  return counts;
}

function renderCounts(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `| ${md(key)} | ${count} |`);
}

async function main() {
  const opportunities = await fetchOpportunities();
  const opportunityIds = opportunities.map((row) => row.id);
  const companyIds = unique(opportunities.map((row) => row.company_id));
  const [eventsByOpportunity, lifecycleStates, settingsByCompany, operators] =
    await Promise.all([
      fetchEvents(opportunityIds),
      fetchLifecycleStates(opportunityIds),
      fetchSettings(companyIds),
      fetchOperators(companyIds),
    ]);

  const decisions: OpportunityLifecycleDecision[] = [];
  const executionRows: Array<{
    opportunity: OpportunityRow;
    decision: OpportunityLifecycleDecision;
    draft: string;
    notification: string;
    lifecycleState: string;
    skippedReason: string | null;
  }> = [];

  let candidates = 0;
  let draftsToCreate = 0;
  let notificationsToCreate = 0;
  let lifecycleStatesToUpdate = 0;
  let draftsToSupersede = 0;
  let skippedAlreadyExists = 0;
  let skippedDestructive = 0;

  for (const opportunity of opportunities) {
    const eventRows = eventsByOpportunity.get(opportunity.id) ?? [];
    const meaningfulEvents = eventRows
      .filter((row) => row.is_meaningful)
      .map(eventForEvaluator);
    const lifecycleState = lifecycleStateFromRow(lifecycleStates.get(opportunity.id));
    const decision = evaluateOpportunityLifecycle({
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
      settings:
        settingsByCompany.get(opportunity.company_id) ??
        DEFAULT_LEAD_LIFECYCLE_SETTINGS,
      now: NOW,
    });
    decisions.push(decision);

    if (decision.action === "no_action" || decision.ignored) continue;
    candidates += 1;

    const latestEvent = latestMeaningfulEvent(eventRows);
    const execution = await executeOpportunityLifecycleAction({
      supabase: sb,
      mode: MODE,
      companyId: opportunity.company_id,
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      decision,
      lifecycleState,
      settings:
        settingsByCompany.get(opportunity.company_id) ??
        DEFAULT_LEAD_LIFECYCLE_SETTINGS,
      latestMeaningfulEvent: latestEvent
        ? {
            id: latestEvent.id,
            direction: latestEvent.direction,
            isMeaningful: latestEvent.is_meaningful,
            occurredAt: latestEvent.occurred_at,
            connectionId: latestEvent.connection_id,
            providerThreadId: latestEvent.provider_thread_id,
          }
        : null,
      operatorUserId: operators.get(opportunity.company_id) ?? null,
      contactName: opportunity.contact_name,
      now: NOW,
    });

    if (
      execution.operations.draft === "would_create" ||
      execution.operations.draft === "created"
    ) {
      draftsToCreate += 1;
    }
    if (
      execution.operations.notification === "would_create" ||
      execution.operations.notification === "created"
    ) {
      notificationsToCreate += 1;
    }
    if (
      execution.operations.lifecycleState === "would_update" ||
      execution.operations.lifecycleState === "updated"
    ) {
      lifecycleStatesToUpdate += 1;
    }
    if (
      execution.operations.draft === "skipped_existing_open_template" ||
      execution.operations.notification === "skipped_existing_unread"
    ) {
      skippedAlreadyExists += 1;
    }
    if (execution.skippedReason === "destructive_action_not_allowed") {
      skippedDestructive += 1;
    }

    executionRows.push({
      opportunity,
      decision,
      draft: execution.operations.draft,
      notification: execution.operations.notification,
      lifecycleState: execution.operations.lifecycleState,
      skippedReason: execution.skippedReason ?? null,
    });
  }

  for (const opportunity of opportunities) {
    const latestEvent = latestMeaningfulEvent(eventsByOpportunity.get(opportunity.id) ?? []);
    if (!latestEvent || latestEvent.direction !== "inbound") continue;
    const reset = await resetStaleLifecycleAfterMeaningfulInbound({
      supabase: sb,
      mode: "dry-run",
      companyId: opportunity.company_id,
      opportunityId: opportunity.id,
      eventId: latestEvent.id,
      occurredAt: latestEvent.occurred_at,
      now: NOW,
    });
    draftsToSupersede += reset.operations.supersededDrafts;
  }

  const generatedAt = new Date().toISOString();
  const actionCounts = countByAction(decisions);
  const p4CorrespondenceEventsConsidered = [...eventsByOpportunity.values()].reduce(
    (sum, rows) => sum + rows.length,
    0
  );
  const meaningfulEventCount = [...eventsByOpportunity.values()].reduce(
    (sum, rows) => sum + rows.filter((row) => row.is_meaningful).length,
    0
  );
  const opportunitiesWithP4Events = eventsByOpportunity.size;
  const opportunitiesWithoutP4Events = opportunities.length - opportunitiesWithP4Events;
  const candidateRowsWithoutP4Events = executionRows.filter(
    (row) => !eventsByOpportunity.has(row.opportunity.id)
  ).length;

  const lines = [
    "# Lead Lifecycle P4-8 Non-Destructive Action Dry Run",
    "",
    `Generated: ${generatedAt}`,
    `Evaluator clock: ${NOW.toISOString()}`,
    `Mode: ${MODE}`,
    "",
    `Production data writes: ${MODE === "apply" ? "non-destructive P4 rows only" : "no"}.`,
    `Apply mode: ${MODE === "apply" ? "yes" : "no"}.`,
    "Provider drafts created: no.",
    "Emails sent: no.",
    "Archive/lost execution: not started.",
    "Reactivation/unarchive execution: not started.",
    `Artifact write: ${OUTPUT_PATH}`,
    "",
    "## Scope",
    "",
    `- App env directory: \`${ENV_DIR}\``,
    `- Company filter: \`${COMPANY_ID ?? "all"}\``,
    `- Active opportunity cap: ${MAX_OPPORTUNITIES}`,
    "- Candidate source: active opportunities scanned first; P4 correspondence rows augment the evaluator when present.",
    `- P4 correspondence events considered: ${p4CorrespondenceEventsConsidered}`,
    `- Active opportunities with P4 correspondence rows: ${opportunitiesWithP4Events}`,
    `- Active opportunities without P4 correspondence rows: ${opportunitiesWithoutP4Events}`,
    `- Candidate execution rows from active opportunities without P4 rows: ${candidateRowsWithoutP4Events}`,
    p4CorrespondenceEventsConsidered === 0
      ? "- No P4 correspondence rows were used because the table returned zero rows."
      : "- P4 correspondence rows were used only for opportunities that had matching P4 rows.",
    "- Apply flag: `--apply-non-destructive-p4-actions`.",
    "",
    "## Summary",
    "",
    `- Opportunities scanned: ${opportunities.length}`,
    `- P4 correspondence events considered: ${p4CorrespondenceEventsConsidered}`,
    `- Meaningful P4 events considered: ${meaningfulEventCount}`,
    `- Candidates: ${candidates}`,
    `- Drafts to create: ${draftsToCreate}`,
    `- Notifications to create: ${notificationsToCreate}`,
    `- Lifecycle states to update: ${lifecycleStatesToUpdate}`,
    `- Drafts to supersede: ${draftsToSupersede}`,
    `- Skipped because already exists: ${skippedAlreadyExists}`,
    `- Skipped because destructive action not allowed: ${skippedDestructive}`,
    "",
    "## Decisions By Action",
    "",
    "| Action | Count |",
    "| --- | ---: |",
    ...renderCounts(actionCounts),
    "",
    "## Candidate Execution Plan",
    "",
    "| Action | Opportunity | Stage | Draft | Notification | State | Skip reason |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...executionRows.slice(0, 100).map((row) => {
      return `| ${md(row.decision.action)} | ${md(row.opportunity.title ?? row.opportunity.id)} (${md(row.opportunity.id)}) | ${md(row.opportunity.stage)} | ${md(row.draft)} | ${md(row.notification)} | ${md(row.lifecycleState)} | ${md(row.skippedReason)} |`;
    }),
    executionRows.length > 100
      ? `\nOnly the first 100 of ${executionRows.length} candidate execution rows are listed.`
      : "",
    "",
    "## Execution Boundary",
    "",
    "- The executor can insert `opportunity_follow_up_drafts` rows with `origin = 'template_follow_up'`.",
    "- The executor can insert persistent `notifications` rows using the existing `leads_waiting` type because a dedicated lead-lifecycle notification type is not present.",
    "- The executor can upsert stale markers in `opportunity_lifecycle_state`.",
    "- The executor can supersede stale open template follow-up drafts when meaningful inbound handling runs.",
    "- The executor skips archive, lost, and reactivation decisions in P4-8.",
    "- The executor does not call provider draft APIs, provider send APIs, archive routes, lost routes, or unarchive/reactivation routes.",
  ];

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Mode: ${MODE}`);
  console.log(`Candidates: ${candidates}`);
  console.log(`Drafts to create: ${draftsToCreate}`);
  console.log(`Notifications to create: ${notificationsToCreate}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
