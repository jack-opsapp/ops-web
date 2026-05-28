/*
 * Lead Lifecycle P4 guarded action executor.
 *
 * Default mode is dry-run. Apply mode requires an exact reviewed
 * opportunity/action approval list. It never sends email or creates provider
 * drafts.
 *
 * Usage:
 *   npx tsx scripts/lead-lifecycle-p4-non-destructive-actions.ts
 *   npx tsx scripts/lead-lifecycle-p4-non-destructive-actions.ts --company-id <uuid>
 *   npx tsx scripts/lead-lifecycle-p4-non-destructive-actions.ts --apply-guarded-p4-actions --approved-actions-file <json>
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  executeOpportunityLifecycleAction,
  projectOpportunityLifecycleActionAuditRow,
  resetStaleLifecycleAfterMeaningfulInbound,
  type OpportunityLifecycleActionState,
  type OpportunityLifecycleExecutionMode,
  type ProjectedOpportunityLifecycleActionAuditRow,
} from "../src/lib/api/services/opportunity-lifecycle-action-service";
import {
  planLegacyCorrespondenceBackfill,
  type LegacyBackfillActivityRow,
  type LegacyBackfillEmailConnectionRow,
  type LegacyBackfillEmailThreadRow,
  type LegacyBackfillExistingEventRow,
  type LegacyBackfillOpportunityRow,
  type LegacyBackfillOpportunityThreadLinkRow,
  type LegacyBackfillPlannedEventRow,
} from "../src/lib/email/opportunity-legacy-correspondence-backfill";
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

function vancouverDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

const today = vancouverDateKey(new Date());
const DEFAULT_OUTPUT =
  `/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p4-22-guarded-actions-after-backfill-dry-run-${today}.md`;

const GUARDED_ACTIONS = new Set<OpportunityLifecycleDecision["action"]>([
  "archive_after_two_unanswered_followups",
  "archive_no_meaningful_correspondence",
  "move_to_lost_operator_no_response",
  "reactivate_on_related_inbound",
]);

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
const maxActivitiesArgIdx = process.argv.indexOf("--max-activities");
const MAX_ACTIVITIES =
  maxActivitiesArgIdx >= 0
    ? Number.parseInt(process.argv[maxActivitiesArgIdx + 1], 10)
    : 30000;
const nowArgIdx = process.argv.indexOf("--now");
const NOW =
  nowArgIdx >= 0 ? new Date(process.argv[nowArgIdx + 1]) : new Date();
const approvedActionsFileArgIdx = process.argv.indexOf("--approved-actions-file");
const APPROVED_ACTIONS_FILE =
  approvedActionsFileArgIdx >= 0 ? process.argv[approvedActionsFileArgIdx + 1] : null;
const APPLY = process.argv.includes("--apply-guarded-p4-actions");
const MODE: OpportunityLifecycleExecutionMode = APPLY ? "apply" : "dry-run";

if (!OUTPUT_PATH) {
  console.error("--output must not be blank");
  process.exit(1);
}

if (!Number.isFinite(MAX_OPPORTUNITIES) || MAX_OPPORTUNITIES <= 0) {
  console.error("--max-opportunities must be a positive integer");
  process.exit(1);
}

if (!Number.isFinite(MAX_ACTIVITIES) || MAX_ACTIVITIES <= 0) {
  console.error("--max-activities must be a positive integer");
  process.exit(1);
}

if (Number.isNaN(NOW.getTime())) {
  console.error("--now must be an ISO date/time");
  process.exit(1);
}

if (process.argv.includes("--apply-non-destructive-p4-actions")) {
  console.error(
    "Use --apply-guarded-p4-actions with --approved-actions-file for P4 guarded execution."
  );
  process.exit(1);
}

if (APPLY && !APPROVED_ACTIONS_FILE) {
  console.error("--apply-guarded-p4-actions requires --approved-actions-file <json>");
  process.exit(1);
}

interface OpportunityRow extends LegacyBackfillOpportunityRow {
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
  contact_email: string | null;
  contact_name: string | null;
  source: string | null;
  lost_reason: string | null;
  lost_notes: string | null;
  actual_close_date: string | null;
  updated_at: string | null;
}

interface CorrespondenceEventRow extends LegacyBackfillExistingEventRow {
  id: string;
  company_id: string;
  opportunity_id: string;
  activity_id: string | null;
  connection_id: string | null;
  provider_thread_id: string | null;
  provider_message_id: string | null;
  direction: "inbound" | "outbound";
  party_role: string | null;
  is_meaningful: boolean;
  noise_reason: string | null;
  occurred_at: string;
  linked_contact_kind: string | null;
  linked_contact_id: string | null;
  source: string;
  subject: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
}

type EvaluatorEventRow = CorrespondenceEventRow | LegacyBackfillPlannedEventRow;

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

interface ProductionSnapshot {
  totalOpportunities: number;
  archivedCount: number;
  lostCount: number;
  operatorNoResponseLostCount: number;
  maxUpdatedAt: string | null;
  correspondenceEventsCount: number;
  lifecycleStateCount: number;
  lifecycleSettingsCount: number;
  auditTableExists: boolean;
  guardedRpcExists: boolean;
  scannedNonDeletedOpportunities: number;
  capturedAt: string;
}

interface ApprovedActionRow {
  opportunityId: string;
  action: OpportunityLifecycleDecision["action"];
  approvedActionKey?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
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

function jsonCell(value: unknown): string {
  return md(JSON.stringify(value ?? null));
}

function approvalMapKey(opportunityId: string, action: string): string {
  return `${opportunityId}::${action}`;
}

function defaultApprovedActionKey(opportunityId: string, action: string): string {
  return `${opportunityId}:${action}:${today}`;
}

function validateApprovedAction(row: unknown, index: number): ApprovedActionRow {
  const value = row as Partial<ApprovedActionRow>;
  if (!value || typeof value !== "object") {
    throw new Error(`approved action ${index} must be an object`);
  }
  if (!value.opportunityId || typeof value.opportunityId !== "string") {
    throw new Error(`approved action ${index} is missing opportunityId`);
  }
  if (!value.action || typeof value.action !== "string") {
    throw new Error(`approved action ${index} is missing action`);
  }
  if (value.action === "no_action") {
    throw new Error(`approved action ${index} cannot be no_action`);
  }
  return {
    opportunityId: value.opportunityId,
    action: value.action,
    approvedActionKey:
      typeof value.approvedActionKey === "string" ? value.approvedActionKey : null,
    approvedBy: typeof value.approvedBy === "string" ? value.approvedBy : null,
    approvedAt: typeof value.approvedAt === "string" ? value.approvedAt : null,
  };
}

async function loadApprovedActions(): Promise<Map<string, ApprovedActionRow>> {
  if (!APPROVED_ACTIONS_FILE) return new Map();
  const raw = await readFile(APPROVED_ACTIONS_FILE, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("--approved-actions-file must contain a JSON array");
  }

  const approved = new Map<string, ApprovedActionRow>();
  parsed.forEach((row, index) => {
    const action = validateApprovedAction(row, index);
    const key = approvalMapKey(action.opportunityId, action.action);
    if (approved.has(key)) {
      throw new Error(`duplicate approved action ${key}`);
    }
    approved.set(key, action);
  });
  return approved;
}

async function assertApplySchemaReady() {
  if (!APPLY) return;
  const { error } = await sb
    .from("opportunity_lifecycle_action_audit")
    .select("id")
    .limit(1);
  if (error) {
    throw new Error(
      `opportunity_lifecycle_action_audit is required before apply mode: ${error.message}`
    );
  }
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

function eventForEvaluator(row: EvaluatorEventRow): OpportunityLifecycleMeaningfulEvent {
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
  rows: EvaluatorEventRow[]
): EvaluatorEventRow | null {
  return [...rows]
    .filter((row) => row.is_meaningful)
    .sort(
      (a, b) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    )[0] ?? null;
}

async function fetchOpportunities(
  approvedActions: Map<string, ApprovedActionRow>
): Promise<OpportunityRow[]> {
  let query = sb
    .from("opportunities")
    .select(
      "id, company_id, title, stage, archived_at, deleted_at, project_id, project_ref, created_at, stage_entered_at, contact_email, contact_name, source, lost_reason, lost_notes, actual_close_date, updated_at"
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(MAX_OPPORTUNITIES);

  if (COMPANY_ID) query = query.eq("company_id", COMPANY_ID);

  const { data, error } = await query;
  if (error) throw new Error(`opportunities query failed: ${error.message}`);
  const rowsById = new Map(((data ?? []) as OpportunityRow[]).map((row) => [row.id, row]));

  const approvedOpportunityIds = unique(
    [...approvedActions.values()].map((row) => row.opportunityId)
  ).filter((id) => !rowsById.has(id));
  for (const ids of chunk(approvedOpportunityIds, 500)) {
    let approvedQuery = sb
      .from("opportunities")
      .select(
        "id, company_id, title, stage, archived_at, deleted_at, project_id, project_ref, created_at, stage_entered_at, contact_email, contact_name, source, lost_reason, lost_notes, actual_close_date, updated_at"
      )
      .in("id", ids);
    if (COMPANY_ID) approvedQuery = approvedQuery.eq("company_id", COMPANY_ID);
    const { data: approvedData, error: approvedError } = await approvedQuery;
    if (approvedError) {
      throw new Error(`approved opportunities query failed: ${approvedError.message}`);
    }
    for (const row of (approvedData ?? []) as OpportunityRow[]) {
      rowsById.set(row.id, row);
    }
  }

  return [...rowsById.values()];
}

async function fetchEvents(
  opportunityIds: string[]
): Promise<Map<string, CorrespondenceEventRow[]>> {
  const rows: CorrespondenceEventRow[] = [];
  for (const ids of chunk(opportunityIds, 500)) {
    const { data, error } = await sb
      .from("opportunity_correspondence_events")
      .select(
        "id, company_id, opportunity_id, activity_id, connection_id, provider_thread_id, provider_message_id, direction, party_role, is_meaningful, noise_reason, occurred_at, linked_contact_kind, linked_contact_id, source, subject, from_email, to_emails, cc_emails"
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

async function fetchLegacyActivities(
  opportunityIds: string[]
): Promise<LegacyBackfillActivityRow[]> {
  const rows: LegacyBackfillActivityRow[] = [];
  const pageSize = 1000;
  for (const ids of chunk(opportunityIds, 250)) {
    for (let from = 0; rows.length < MAX_ACTIVITIES; from += pageSize) {
      const remaining = MAX_ACTIVITIES - rows.length;
      const to = from + Math.min(pageSize, remaining) - 1;
      const { data, error } = await sb
        .from("activities")
        .select(
          "id, company_id, opportunity_id, type, email_thread_id, email_message_id, subject, content, body_text, from_email, to_emails, cc_emails, direction, created_at, outcome"
        )
        .in("opportunity_id", ids)
        .order("created_at", { ascending: true })
        .range(from, to);

      if (error) throw new Error(`legacy activities query failed: ${error.message}`);
      const page = (data ?? []) as LegacyBackfillActivityRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    if (rows.length >= MAX_ACTIVITIES) break;
  }
  return rows;
}

async function fetchLegacyThreads(
  providerThreadIds: string[]
): Promise<LegacyBackfillEmailThreadRow[]> {
  const rows: LegacyBackfillEmailThreadRow[] = [];
  for (const ids of chunk(providerThreadIds, 500)) {
    const { data, error } = await sb
      .from("email_threads")
      .select(
        "company_id, opportunity_id, connection_id, provider_thread_id, labels, primary_category"
      )
      .in("provider_thread_id", ids);
    if (error) throw new Error(`legacy email_threads query failed: ${error.message}`);
    rows.push(...((data ?? []) as LegacyBackfillEmailThreadRow[]));
  }
  return rows;
}

async function fetchLegacyOpportunityThreadLinks(
  providerThreadIds: string[]
): Promise<LegacyBackfillOpportunityThreadLinkRow[]> {
  const rows: LegacyBackfillOpportunityThreadLinkRow[] = [];
  for (const ids of chunk(providerThreadIds, 500)) {
    const { data, error } = await sb
      .from("opportunity_email_threads")
      .select("opportunity_id, thread_id, connection_id")
      .in("thread_id", ids);
    if (error) {
      throw new Error(`legacy opportunity_email_threads query failed: ${error.message}`);
    }
    rows.push(...((data ?? []) as LegacyBackfillOpportunityThreadLinkRow[]));
  }
  return rows;
}

async function fetchLegacyConnections(
  connectionIds: string[]
): Promise<LegacyBackfillEmailConnectionRow[]> {
  const rows: LegacyBackfillEmailConnectionRow[] = [];
  for (const ids of chunk(connectionIds, 500)) {
    const { data, error } = await sb
      .from("email_connections")
      .select("id, company_id, email, sync_filters")
      .in("id", ids);
    if (error) throw new Error(`legacy email_connections query failed: ${error.message}`);
    rows.push(...((data ?? []) as LegacyBackfillEmailConnectionRow[]));
  }
  return rows;
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

type OpportunityCountFilter =
  | "all"
  | "archived"
  | "lost"
  | "operator_no_response_lost";

async function countOpportunities(filter: OpportunityCountFilter): Promise<number> {
  let query = sb.from("opportunities").select("id", {
    count: "exact",
    head: true,
  });

  if (filter === "archived") {
    query = query.not("archived_at", "is", null);
  } else if (filter === "lost") {
    query = query.eq("stage", "lost");
  } else if (filter === "operator_no_response_lost") {
    query = query.eq("stage", "lost").eq("lost_reason", "operator_no_response");
  }

  const { count, error } = await query;
  if (error) throw new Error(`opportunities ${filter} count failed: ${error.message}`);
  return count ?? 0;
}

async function fetchMaxOpportunityUpdatedAt(): Promise<string | null> {
  const { data, error } = await sb
    .from("opportunities")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`opportunities max updated_at query failed: ${error.message}`);
  }
  return (data as { updated_at?: string | null } | null)?.updated_at ?? null;
}

async function fetchProductionSnapshot(
  scannedNonDeletedOpportunities: number
): Promise<ProductionSnapshot> {
  const [
    totalOpportunities,
    archivedCount,
    lostCount,
    operatorNoResponseLostCount,
    maxUpdatedAt,
    correspondenceEvents,
    lifecycleState,
    lifecycleSettings,
    auditProbe,
  ] = await Promise.all([
    countOpportunities("all"),
    countOpportunities("archived"),
    countOpportunities("lost"),
    countOpportunities("operator_no_response_lost"),
    fetchMaxOpportunityUpdatedAt(),
    sb
      .from("opportunity_correspondence_events")
      .select("id", { count: "exact", head: true }),
    sb
      .from("opportunity_lifecycle_state")
      .select("opportunity_id", { count: "exact", head: true }),
    sb
      .from("lead_lifecycle_settings")
      .select("company_id", { count: "exact", head: true }),
    sb
      .from("opportunity_lifecycle_action_audit")
      .select("id", { count: "exact", head: true }),
  ]);

  for (const [label, result] of [
    ["opportunity_correspondence_events", correspondenceEvents],
    ["opportunity_lifecycle_state", lifecycleState],
    ["lead_lifecycle_settings", lifecycleSettings],
  ] as const) {
    if (result.error) throw new Error(`${label} count failed: ${result.error.message}`);
  }

  return {
    totalOpportunities,
    archivedCount,
    lostCount,
    operatorNoResponseLostCount,
    maxUpdatedAt,
    correspondenceEventsCount: correspondenceEvents.count ?? 0,
    lifecycleStateCount: lifecycleState.count ?? 0,
    lifecycleSettingsCount: lifecycleSettings.count ?? 0,
    auditTableExists: !auditProbe.error && typeof auditProbe.count === "number",
    guardedRpcExists: false,
    scannedNonDeletedOpportunities,
    capturedAt: new Date().toISOString(),
  };
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
  await assertApplySchemaReady();
  const approvedActions = await loadApprovedActions();
  const opportunities = await fetchOpportunities(approvedActions);
  const preRunSnapshot = await fetchProductionSnapshot(opportunities.length);
  const opportunityIds = opportunities.map((row) => row.id);
  const companyIds = unique(opportunities.map((row) => row.company_id));
  const [eventsByOpportunity, lifecycleStates, settingsByCompany, operators] =
    await Promise.all([
      fetchEvents(opportunityIds),
      fetchLifecycleStates(opportunityIds),
      fetchSettings(companyIds),
      fetchOperators(companyIds),
    ]);
  const existingEvents = [...eventsByOpportunity.values()].flat();
  const legacyActivities = await fetchLegacyActivities(opportunityIds);
  const legacyProviderThreadIds = unique(
    legacyActivities.map((row) => row.email_thread_id)
  );
  const [legacyThreads, legacyThreadLinks] = await Promise.all([
    fetchLegacyThreads(legacyProviderThreadIds),
    fetchLegacyOpportunityThreadLinks(legacyProviderThreadIds),
  ]);
  const legacyConnections = await fetchLegacyConnections(
    unique(legacyThreads.map((row) => row.connection_id))
  );
  const legacyBackfillPlan = planLegacyCorrespondenceBackfill({
    opportunities,
    activities: legacyActivities,
    threads: legacyThreads,
    opportunityThreadLinks: legacyThreadLinks,
    connections: legacyConnections,
    existingEvents,
    now: NOW,
  });
  const plannedEventsByOpportunity = new Map<string, LegacyBackfillPlannedEventRow[]>();
  for (const event of legacyBackfillPlan.plannedEvents) {
    const rows = plannedEventsByOpportunity.get(event.opportunity_id) ?? [];
    rows.push(event);
    plannedEventsByOpportunity.set(event.opportunity_id, rows);
  }
  const mergedEventsByOpportunity = new Map<string, EvaluatorEventRow[]>();
  for (const opportunity of opportunities) {
    mergedEventsByOpportunity.set(opportunity.id, [
      ...(eventsByOpportunity.get(opportunity.id) ?? []),
      ...(plannedEventsByOpportunity.get(opportunity.id) ?? []),
    ]);
  }

  const decisions: OpportunityLifecycleDecision[] = [];
  const executionRows: Array<{
    opportunity: OpportunityRow;
    decision: OpportunityLifecycleDecision;
    approvedAction: ApprovedActionRow | null;
    draft: string;
    notification: string;
    lifecycleState: string;
    opportunityOperation: string;
    audit: string;
    skippedReason: string | null;
    beforeValues: Record<string, unknown> | null;
    afterValues: Record<string, unknown> | null;
    auditRow: ProjectedOpportunityLifecycleActionAuditRow | null;
    legacyEvidenceCount: number;
    latestEventSource: string | null;
  }> = [];
  const missingApprovedRows: ApprovedActionRow[] = [];
  const mismatchApprovedRows: Array<{
    opportunity: OpportunityRow;
    approvedAction: ApprovedActionRow;
    currentDecision: OpportunityLifecycleDecision;
  }> = [];

  let candidates = 0;
  let draftsToCreate = 0;
  let notificationsToCreate = 0;
  let lifecycleStatesToUpdate = 0;
  let draftsToSupersede = 0;
  let skippedAlreadyExists = 0;
  let skippedGuarded = 0;
  let opportunityMutations = 0;
  let auditRowsToRecord = 0;

  for (const opportunity of opportunities) {
    const eventRows = mergedEventsByOpportunity.get(opportunity.id) ?? [];
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

    const approvedForOpportunity = [...approvedActions.values()].filter(
      (row) => row.opportunityId === opportunity.id
    );
    const executionPlan =
      MODE === "apply"
        ? approvedForOpportunity.map((approvedAction) => ({
            decision,
            approvedAction,
          }))
        : decision.action === "no_action" || decision.ignored
          ? []
          : [{ decision, approvedAction: null }];

    for (const item of executionPlan) {
      const plannedAction = item.approvedAction?.action ?? item.decision.action;
      if (!GUARDED_ACTIONS.has(plannedAction)) continue;

      if (
        MODE === "apply" &&
        item.approvedAction &&
        item.decision.action !== item.approvedAction.action
      ) {
        mismatchApprovedRows.push({
          opportunity,
          approvedAction: item.approvedAction,
          currentDecision: item.decision,
        });
        continue;
      }

      candidates += 1;
      const executionDecision: OpportunityLifecycleDecision = item.approvedAction
        ? {
            ...item.decision,
            action: item.approvedAction.action,
            ignored: false,
            reason: `Approved guarded P4 action from reviewed dry-run artifact. Current evaluator action: ${item.decision.action}.`,
            evidence: {
              ...item.decision.evidence,
              currentEvaluatorAction: item.decision.action,
              currentEvaluatorReason: item.decision.reason,
            },
          }
        : item.decision;

      const latestEvent = latestMeaningfulEvent(eventRows);
      const execution = await executeOpportunityLifecycleAction({
        supabase: sb,
        mode: MODE,
        companyId: opportunity.company_id,
        opportunityId: opportunity.id,
        opportunityTitle: opportunity.title,
        decision: executionDecision,
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
              linkedContactKind: latestEvent.linked_contact_kind,
            }
          : null,
        operatorUserId: operators.get(opportunity.company_id) ?? null,
        contactName: opportunity.contact_name,
        opportunity: {
          id: opportunity.id,
          companyId: opportunity.company_id,
          stage: opportunity.stage,
          archivedAt: opportunity.archived_at,
          deletedAt: opportunity.deleted_at,
          projectId: opportunity.project_id,
          projectRef: opportunity.project_ref,
          lostReason: opportunity.lost_reason,
          lostNotes: opportunity.lost_notes,
          actualCloseDate: opportunity.actual_close_date,
        },
        approvedActionKey: item.approvedAction
          ? (item.approvedAction.approvedActionKey ??
            defaultApprovedActionKey(opportunity.id, item.approvedAction.action))
          : null,
        approvedBy: item.approvedAction?.approvedBy ?? null,
        approvedAt: item.approvedAction?.approvedAt ?? null,
        runId: `${today}:${MODE}`,
        now: NOW,
      });
      const auditRow =
        execution.operations.audit === "would_record" ||
        execution.operations.audit === "recorded"
          ? projectOpportunityLifecycleActionAuditRow({
              companyId: opportunity.company_id,
              opportunityId: opportunity.id,
              action: executionDecision.action,
              approvedActionKey:
                item.approvedAction?.approvedActionKey ??
                defaultApprovedActionKey(opportunity.id, executionDecision.action),
              executionMode: MODE,
              status:
                MODE === "dry-run"
                  ? "skipped"
                  : execution.applied
                    ? "applied"
                    : "skipped",
              guardReason:
                MODE === "dry-run" && !execution.skippedReason
                  ? "dry_run_projected_apply_not_approved"
                  : (execution.guardReason ?? execution.skippedReason ?? null),
              beforeValues: execution.beforeValues ?? {},
              afterValues: execution.afterValues ?? {},
              decisionReason: executionDecision.reason,
              decisionEvidence: executionDecision.evidence,
              approvedBy: item.approvedAction?.approvedBy ?? null,
              approvedAt: item.approvedAction?.approvedAt ?? null,
              runId: `${today}:${MODE}`,
              errorCode: execution.errorCode ?? null,
              errorMessage: execution.errorMessage ?? null,
            })
          : null;

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
        execution.operations.opportunity.startsWith("would_") ||
        ["archived", "moved_to_lost", "reactivated"].includes(
          execution.operations.opportunity
        )
      ) {
        opportunityMutations += 1;
      }
      if (
        execution.operations.audit === "would_record" ||
        execution.operations.audit === "recorded"
      ) {
        auditRowsToRecord += 1;
      }
      if (
        execution.operations.draft === "skipped_existing_open_template" ||
        execution.operations.notification === "skipped_existing_unread" ||
        execution.operations.opportunity === "skipped_duplicate_applied_action"
      ) {
        skippedAlreadyExists += 1;
      }
      if (
        execution.operations.opportunity.startsWith("skipped_") ||
        execution.skippedReason
      ) {
        skippedGuarded += 1;
      }

      executionRows.push({
        opportunity,
        decision: executionDecision,
        approvedAction: item.approvedAction,
        draft: execution.operations.draft,
        notification: execution.operations.notification,
        lifecycleState: execution.operations.lifecycleState,
        opportunityOperation: execution.operations.opportunity,
        audit: execution.operations.audit,
        skippedReason: execution.skippedReason ?? null,
        beforeValues: execution.beforeValues ?? null,
        afterValues: execution.afterValues ?? null,
        auditRow,
        legacyEvidenceCount: plannedEventsByOpportunity.get(opportunity.id)?.length ?? 0,
        latestEventSource: latestEvent?.source ?? null,
      });
    }
  }

  const foundOpportunityIds = new Set(opportunities.map((row) => row.id));
  for (const approvedAction of approvedActions.values()) {
    if (!foundOpportunityIds.has(approvedAction.opportunityId)) {
      missingApprovedRows.push(approvedAction);
    }
  }

  for (const opportunity of opportunities) {
    const latestEvent = latestMeaningfulEvent(
      mergedEventsByOpportunity.get(opportunity.id) ?? []
    );
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
  const plannedLegacyMeaningfulEventCount = legacyBackfillPlan.plannedEvents.filter(
    (row) => row.is_meaningful
  ).length;
  const totalMeaningfulEventCount = [...mergedEventsByOpportunity.values()].reduce(
    (sum, rows) => sum + rows.filter((row) => row.is_meaningful).length,
    0
  );
  const opportunitiesWithP4Events = eventsByOpportunity.size;
  const opportunitiesWithoutP4Events = opportunities.length - opportunitiesWithP4Events;
  const opportunitiesWithPlannedLegacyEvents = plannedEventsByOpportunity.size;
  const candidateRowsWithoutP4Events = executionRows.filter(
    (row) => !eventsByOpportunity.has(row.opportunity.id)
  ).length;
  const candidateRowsWithLegacyEvidence = executionRows.filter(
    (row) => row.legacyEvidenceCount > 0
  ).length;
  const mutationRows = executionRows.filter(
    (row) =>
      row.opportunityOperation.startsWith("would_") ||
      ["archived", "moved_to_lost", "reactivated"].includes(row.opportunityOperation)
  );
  const skippedRows = executionRows.filter(
    (row) => row.skippedReason || row.opportunityOperation.startsWith("skipped_")
  );
  const requiredApprovalRows = mutationRows.map((row) => ({
    opportunityId: row.opportunity.id,
    action: row.decision.action,
    approvedActionKey: defaultApprovedActionKey(row.opportunity.id, row.decision.action),
  }));
  const projectedAuditRows = executionRows
    .map((row) => row.auditRow)
    .filter((row): row is ProjectedOpportunityLifecycleActionAuditRow => Boolean(row));
  const postRunSnapshot = await fetchProductionSnapshot(opportunities.length);

  const lines = [
    "# Lead Lifecycle P4-22 Guarded Actions After Backfill Dry Run",
    "",
    `Generated: ${generatedAt}`,
    `Evaluator clock: ${NOW.toISOString()}`,
    `Mode: ${MODE}`,
    "",
    MODE === "apply"
      ? "Production data writes: approved guarded P4 rows only."
      : "Production data writes: no.",
    MODE === "apply" ? "Apply mode: yes." : "Apply mode: no.",
    "Migration applied: no.",
    "Provider drafts created: no.",
    "Emails sent: no.",
    `Archive/lost/reactivation execution: ${MODE === "apply" ? "approved rows only" : "not run; dry-run plan only"}.`,
    `Artifact write: ${OUTPUT_PATH}`,
    "",
    "## Scope",
    "",
    `- App env directory: \`${ENV_DIR}\``,
    `- Company filter: \`${COMPANY_ID ?? "all"}\``,
    `- Opportunity scan cap: ${MAX_OPPORTUNITIES}`,
    `- Activity scan cap: ${MAX_ACTIVITIES}`,
    `- Approved actions file: \`${APPROVED_ACTIONS_FILE ?? "none"}\``,
    "- Candidate source: non-deleted opportunities scanned first; exact approved opportunity ids are included even when outside the scan cap.",
    "- Total opportunities means every row in `public.opportunities`; scanned non-deleted opportunities means the evaluator input set after `deleted_at IS NULL`, scan cap, and exact approved-id inclusion.",
    `- P4 correspondence events considered: ${p4CorrespondenceEventsConsidered}`,
    `- Planned legacy correspondence events considered: ${legacyBackfillPlan.plannedEvents.length}`,
    `- Opportunities with P4 correspondence rows: ${opportunitiesWithP4Events}`,
    `- Opportunities with planned legacy correspondence rows: ${opportunitiesWithPlannedLegacyEvents}`,
    `- Opportunities without P4 correspondence rows: ${opportunitiesWithoutP4Events}`,
    `- Candidate execution rows without P4 rows: ${candidateRowsWithoutP4Events}`,
    `- Candidate execution rows with planned legacy evidence: ${candidateRowsWithLegacyEvidence}`,
    "- Empty P4 proof tables are not treated as no meaningful legacy correspondence.",
    p4CorrespondenceEventsConsidered === 0
      ? "- No P4 correspondence rows were used because the table returned zero rows."
      : "- P4 correspondence rows were used only for opportunities that had matching P4 rows.",
    "- Legacy evidence is activity/opportunity scoped and does not rewrite thread or opportunity relationships.",
    "- Apply flag: `--apply-guarded-p4-actions`.",
    "- Apply approval gate: `--approved-actions-file <json>` is required and each approved row must match the current evaluator action before execution.",
    "",
    "## Summary",
    "",
    `- Opportunities scanned: ${opportunities.length}`,
    `- Approved actions loaded: ${approvedActions.size}`,
    `- Approved actions missing live row: ${missingApprovedRows.length}`,
    `- Approved actions skipped because current evaluator changed: ${mismatchApprovedRows.length}`,
    `- P4 correspondence events considered: ${p4CorrespondenceEventsConsidered}`,
    `- Meaningful P4 events considered: ${meaningfulEventCount}`,
    `- Planned legacy meaningful events considered: ${plannedLegacyMeaningfulEventCount}`,
    `- Total meaningful events considered after legacy evidence: ${totalMeaningfulEventCount}`,
    `- Candidates: ${candidates}`,
    `- Drafts to create: ${draftsToCreate}`,
    `- Notifications to create: ${notificationsToCreate}`,
    `- Lifecycle states to update: ${lifecycleStatesToUpdate}`,
    `- Opportunity rows to mutate: ${opportunityMutations}`,
    `- Audit rows to record: ${auditRowsToRecord}`,
    `- Dry-run projected audit rows rendered: ${projectedAuditRows.length}`,
    `- Drafts to supersede: ${draftsToSupersede}`,
    `- Skipped because already exists: ${skippedAlreadyExists}`,
    `- Skipped by guard: ${skippedGuarded}`,
    "",
    "## Production Snapshot Proof",
    "",
    `- Pre-run captured: ${preRunSnapshot.capturedAt}`,
    `- Post-run captured: ${postRunSnapshot.capturedAt}`,
    `- Pre-run total opportunities: ${preRunSnapshot.totalOpportunities}`,
    `- Post-run total opportunities: ${postRunSnapshot.totalOpportunities}`,
    `- Scanned non-deleted opportunities: ${preRunSnapshot.scannedNonDeletedOpportunities}`,
    "",
    "| Metric | Pre-run | Post-run |",
    "| --- | ---: | ---: |",
    `| total opportunities | ${preRunSnapshot.totalOpportunities} | ${postRunSnapshot.totalOpportunities} |`,
    `| archived count | ${preRunSnapshot.archivedCount} | ${postRunSnapshot.archivedCount} |`,
    `| lost count | ${preRunSnapshot.lostCount} | ${postRunSnapshot.lostCount} |`,
    `| operator_no_response lost count | ${preRunSnapshot.operatorNoResponseLostCount} | ${postRunSnapshot.operatorNoResponseLostCount} |`,
    `| max updated_at | ${md(preRunSnapshot.maxUpdatedAt)} | ${md(postRunSnapshot.maxUpdatedAt)} |`,
    `| opportunity_correspondence_events | ${preRunSnapshot.correspondenceEventsCount} | ${postRunSnapshot.correspondenceEventsCount} |`,
    `| opportunity_lifecycle_state | ${preRunSnapshot.lifecycleStateCount} | ${postRunSnapshot.lifecycleStateCount} |`,
    `| lead_lifecycle_settings | ${preRunSnapshot.lifecycleSettingsCount} | ${postRunSnapshot.lifecycleSettingsCount} |`,
    `| action audit table exists | ${preRunSnapshot.auditTableExists} | ${postRunSnapshot.auditTableExists} |`,
    `| guarded RPC exists | ${preRunSnapshot.guardedRpcExists} | ${postRunSnapshot.guardedRpcExists} |`,
    `| scanned non-deleted opportunities | ${preRunSnapshot.scannedNonDeletedOpportunities} | ${postRunSnapshot.scannedNonDeletedOpportunities} |`,
    "",
    "## Decisions By Action",
    "",
    "| Action | Count |",
    "| --- | ---: |",
    ...renderCounts(actionCounts),
    "",
    "## Legacy Backfill Evidence Considered",
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| legacy activities scanned | ${legacyActivities.length} |`,
    `| legacy email threads scanned | ${legacyThreads.length} |`,
    `| legacy opportunity thread links scanned | ${legacyThreadLinks.length} |`,
    `| legacy connections scanned | ${legacyConnections.length} |`,
    `| planned opportunity_correspondence_events rows | ${legacyBackfillPlan.plannedEvents.length} |`,
    `| planned opportunity_lifecycle_state rows | ${legacyBackfillPlan.lifecycleStateRows.length} |`,
    `| skipped legacy evidence rows | ${legacyBackfillPlan.skippedEvidence.length} |`,
    "",
    "| Source | Count |",
    "| --- | ---: |",
    ...renderCounts(
      legacyBackfillPlan.plannedEvents.reduce((counts, row) => {
        counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())
    ),
    "",
    "## Planned Legacy Correspondence Rows",
    "",
    "| Source | Opportunity ID | Activity ID | Direction | Party | Occurred at | Confidence | Boundary | Reason |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...legacyBackfillPlan.plannedEvents.slice(0, 150).map((row) => {
      return `| ${md(row.source)} | ${md(row.opportunity_id)} | ${md(row.activity_id)} | ${md(row.direction)} | ${md(row.party_role)} | ${md(row.occurred_at)} | ${md(row.confidence)} | ${md(row.source_boundary)} | ${md(row.reason)} |`;
    }),
    legacyBackfillPlan.plannedEvents.length > 150
      ? `\nOnly the first 150 of ${legacyBackfillPlan.plannedEvents.length} planned legacy correspondence rows are listed.`
      : "",
    legacyBackfillPlan.plannedEvents.length === 0
      ? "| - | - | - | - | - | - | - | - | - |"
      : "",
    "",
    "## Candidate Actions",
    "",
    "| Action | Opportunity | Stage | Archived | Project | Latest event source | Legacy evidence | Draft | Notification | State | Opportunity | Audit | Skip reason |",
    "| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |",
    ...executionRows.slice(0, 100).map((row) => {
      return `| ${md(row.decision.action)} | ${md(row.opportunity.title ?? row.opportunity.id)} (${md(row.opportunity.id)}) | ${md(row.opportunity.stage)} | ${md(row.opportunity.archived_at)} | ${md(row.opportunity.project_id ?? row.opportunity.project_ref)} | ${md(row.latestEventSource)} | ${row.legacyEvidenceCount} | ${md(row.draft)} | ${md(row.notification)} | ${md(row.lifecycleState)} | ${md(row.opportunityOperation)} | ${md(row.audit)} | ${md(row.skippedReason)} |`;
    }),
    executionRows.length > 100
      ? `\nOnly the first 100 of ${executionRows.length} candidate execution rows are listed.`
      : "",
    "",
    "## Exact Rows That Would Be Mutated",
    "",
    "| Action | Opportunity ID | Old values | Proposed new values |",
    "| --- | --- | --- | --- |",
    ...mutationRows.map((row) => {
      return `| ${md(row.decision.action)} | ${md(row.opportunity.id)} | ${jsonCell(row.beforeValues)} | ${jsonCell(row.afterValues)} |`;
    }),
    mutationRows.length === 0 ? "| - | - | - | - |" : "",
    "",
    "## Dry-Run Projected Audit Rows",
    "",
    "These rows are projected audit payloads only. They are not approvals, were not inserted, and use `approval_status: dry_run_projection_not_approved`.",
    "",
    "```json",
    JSON.stringify(projectedAuditRows, null, 2),
    "```",
    "",
    "## Skipped Guarded Actions",
    "",
    "| Action | Opportunity ID | Operation | Guard reason | Old values | Proposed values |",
    "| --- | --- | --- | --- | --- | --- |",
    ...skippedRows.map((row) => {
      return `| ${md(row.decision.action)} | ${md(row.opportunity.id)} | ${md(row.opportunityOperation)} | ${md(row.skippedReason)} | ${jsonCell(row.beforeValues)} | ${jsonCell(row.afterValues)} |`;
    }),
    ...mismatchApprovedRows.map((row) => {
      return `| ${md(row.approvedAction.action)} | ${md(row.opportunity.id)} | skipped_current_decision_mismatch | current_decision_mismatch:${md(row.currentDecision.action)} | ${jsonCell({ stage: row.opportunity.stage, archived_at: row.opportunity.archived_at, deleted_at: row.opportunity.deleted_at, project_id: row.opportunity.project_id, project_ref: row.opportunity.project_ref })} | - |`;
    }),
    ...missingApprovedRows.map((row) => {
      return `| ${md(row.action)} | ${md(row.opportunityId)} | skipped_missing_live_row | missing_live_row | - | - |`;
    }),
    skippedRows.length === 0 &&
    mismatchApprovedRows.length === 0 &&
    missingApprovedRows.length === 0
      ? "| - | - | - | - | - | - |"
      : "",
    "",
    "## Required Approval Section",
    "",
    "Production apply is blocked until this dry-run artifact is reviewed and the exact approved opportunity/action list is supplied as JSON via `--approved-actions-file`.",
    "",
    "```json",
    JSON.stringify(requiredApprovalRows, null, 2),
    "```",
    "",
    "## Execution Boundary",
    "",
    "- P4-12 guarded apply can execute only archive, lost, and related-inbound reactivation decisions.",
    "- P4-8 non-destructive actions remain outside this apply whitelist.",
    "- Archive actions set only `opportunities.archived_at`.",
    "- Lost actions set only `stage`, `lost_reason`, `lost_notes`, and `actual_close_date` on beyond-qualified stages.",
    "- Reactivation clears only `opportunities.archived_at` when the approved action still has a related meaningful inbound.",
    "- Apply mode calls `execute_opportunity_lifecycle_guarded_action` so audit and opportunity mutation share one database transaction after the additive migration is live.",
    "- The executor does not call provider draft APIs, provider send APIs, archive routes, lost routes, or unarchive/reactivation routes.",
    "- P5/P6 are out of scope.",
  ];

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Mode: ${MODE}`);
  console.log(`Candidates: ${candidates}`);
  console.log(`Drafts to create: ${draftsToCreate}`);
  console.log(`Notifications to create: ${notificationsToCreate}`);
  console.log(`Opportunity rows to mutate: ${opportunityMutations}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
