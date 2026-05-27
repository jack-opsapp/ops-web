/*
 * Read-only Lead Lifecycle P4 stale/follow-up evaluator dry-run.
 *
 * No production mutations. The only write is the markdown artifact.
 *
 * Usage:
 *   npx tsx scripts/lead-lifecycle-p4-dry-run.ts
 *   npx tsx scripts/lead-lifecycle-p4-dry-run.ts --company-id <uuid>
 *   OPS_WEB_ENV_DIR=/path/to/ops-web npx tsx scripts/lead-lifecycle-p4-dry-run.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  classifyOpportunityCorrespondence,
  type OpportunityCorrespondenceDirection,
  type OpportunityCorrespondenceNoiseReason,
} from "../src/lib/email/opportunity-correspondence-classifier";
import {
  DEFAULT_LEAD_LIFECYCLE_SETTINGS,
  evaluateOpportunityLifecycle,
  type LeadLifecycleSettings,
  type OpportunityLifecycleDecision,
  type OpportunityLifecycleMeaningfulEvent,
  type OpportunityLifecycleStateInput,
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

const DEFAULT_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p4-dry-run-2026-05-27.md";

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
const maxActivitiesArgIdx = process.argv.indexOf("--max-activities");
const MAX_ACTIVITIES =
  maxActivitiesArgIdx >= 0
    ? Number.parseInt(process.argv[maxActivitiesArgIdx + 1], 10)
    : 20000;
const nowArgIdx = process.argv.indexOf("--now");
const NOW =
  nowArgIdx >= 0 ? new Date(process.argv[nowArgIdx + 1]) : new Date();

if (!OUTPUT_PATH) {
  console.error("--output must not be blank");
  process.exit(1);
}

for (const [name, value] of [
  ["--max-opportunities", MAX_OPPORTUNITIES],
  ["--max-activities", MAX_ACTIVITIES],
] as const) {
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} must be a positive integer`);
    process.exit(1);
  }
}

if (Number.isNaN(NOW.getTime())) {
  console.error("--now must be an ISO date/time");
  process.exit(1);
}

interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
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
  contact_email: string | null;
  contact_name: string | null;
}

interface ActivityRow {
  id: string;
  company_id: string;
  opportunity_id: string | null;
  email_thread_id: string | null;
  email_message_id: string | null;
  subject: string | null;
  content: string | null;
  body_text: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  direction: string | null;
  created_at: string | null;
}

interface EmailThreadRow {
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
  labels: string[] | null;
  primary_category: string | null;
}

interface EmailConnectionRow {
  id: string;
  company_id: string;
  email: string | null;
  sync_filters: Record<string, unknown> | null;
}

interface LifecycleStateRow {
  opportunity_id: string;
  last_meaningful_at: string | null;
  unanswered_follow_up_count: number | null;
  second_follow_up_sent_at: string | null;
  operator_follow_up_miss_at: string | null;
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

interface P4TableStatus {
  settings: "available" | "missing";
  lifecycleState: "available" | "missing";
}

function isMissingTableError(error: SupabaseErrorLike | null): boolean {
  if (!error) return false;
  const message = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
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

function truncate(value: unknown, max = 120): string {
  const text = value == null ? "" : String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function directionOf(value: string | null): OpportunityCorrespondenceDirection | null {
  if (value === "inbound" || value === "outbound") return value;
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
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
): OpportunityLifecycleStateInput | null {
  if (!row) return null;
  return {
    lastMeaningfulAt: row.last_meaningful_at,
    unansweredFollowUpCount: row.unanswered_follow_up_count,
    secondFollowUpSentAt: row.second_follow_up_sent_at,
    operatorFollowUpMissAt: row.operator_follow_up_miss_at,
  };
}

async function fetchOpportunities(): Promise<OpportunityRow[]> {
  let query = sb
    .from("opportunities")
    .select(
      "id, company_id, title, stage, archived_at, deleted_at, project_id, project_ref, created_at, stage_entered_at, contact_email, contact_name"
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

async function fetchActivities(opportunityIds: string[]): Promise<ActivityRow[]> {
  const rows: ActivityRow[] = [];
  const pageSize = 1000;
  for (const ids of chunk(opportunityIds, 250)) {
    for (let from = 0; rows.length < MAX_ACTIVITIES; from += pageSize) {
      const remaining = MAX_ACTIVITIES - rows.length;
      const to = from + Math.min(pageSize, remaining) - 1;
      const { data, error } = await sb
        .from("activities")
        .select(
          "id, company_id, opportunity_id, email_thread_id, email_message_id, subject, content, body_text, from_email, to_emails, cc_emails, direction, created_at"
        )
        .eq("type", "email")
        .in("opportunity_id", ids)
        .order("created_at", { ascending: true })
        .range(from, to);

      if (error) throw new Error(`activities query failed: ${error.message}`);
      const page = (data ?? []) as ActivityRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    if (rows.length >= MAX_ACTIVITIES) break;
  }
  return rows;
}

async function fetchThreads(threadIds: string[]): Promise<Map<string, EmailThreadRow>> {
  const rows: EmailThreadRow[] = [];
  for (const ids of chunk(threadIds, 500)) {
    const { data, error } = await sb
      .from("email_threads")
      .select("company_id, connection_id, provider_thread_id, labels, primary_category")
      .in("provider_thread_id", ids);

    if (error) throw new Error(`email_threads query failed: ${error.message}`);
    rows.push(...((data ?? []) as EmailThreadRow[]));
  }

  return new Map(
    rows.map((row) => [`${row.company_id}:${row.provider_thread_id}`, row])
  );
}

async function fetchConnections(
  connectionIds: string[]
): Promise<Map<string, EmailConnectionRow>> {
  const rows: EmailConnectionRow[] = [];
  for (const ids of chunk(connectionIds, 500)) {
    const { data, error } = await sb
      .from("email_connections")
      .select("id, company_id, email, sync_filters")
      .in("id", ids);

    if (error) throw new Error(`email_connections query failed: ${error.message}`);
    rows.push(...((data ?? []) as EmailConnectionRow[]));
  }
  return new Map(rows.map((row) => [row.id, row]));
}

async function fetchSettings(
  companyIds: string[],
  status: P4TableStatus
): Promise<Map<string, LeadLifecycleSettings>> {
  const settings = new Map<string, LeadLifecycleSettings>();
  const { data, error } = await sb
    .from("lead_lifecycle_settings")
    .select(
      "company_id, follow_up_after_days, second_follow_up_archive_after_days, no_correspondence_archive_days, inbound_unreplied_lost_days, follow_up_template_subject, follow_up_template_body, auto_archive_enabled, auto_lost_enabled"
    )
    .in("company_id", companyIds);

  if (error) {
    if (isMissingTableError(error)) {
      status.settings = "missing";
      return settings;
    }
    throw new Error(`lead_lifecycle_settings query failed: ${error.message}`);
  }

  status.settings = "available";
  for (const row of (data ?? []) as SettingsRow[]) {
    settings.set(row.company_id, settingsFromRow(row));
  }
  return settings;
}

async function fetchLifecycleStates(
  opportunityIds: string[],
  status: P4TableStatus
): Promise<Map<string, LifecycleStateRow>> {
  const rows: LifecycleStateRow[] = [];
  for (const ids of chunk(opportunityIds, 500)) {
    const { data, error } = await sb
      .from("opportunity_lifecycle_state")
      .select(
        "opportunity_id, last_meaningful_at, unanswered_follow_up_count, second_follow_up_sent_at, operator_follow_up_miss_at"
      )
      .in("opportunity_id", ids);

    if (error) {
      if (isMissingTableError(error)) {
        status.lifecycleState = "missing";
        return new Map();
      }
      throw new Error(`opportunity_lifecycle_state query failed: ${error.message}`);
    }
    rows.push(...((data ?? []) as LifecycleStateRow[]));
  }

  status.lifecycleState = "available";
  return new Map(rows.map((row) => [row.opportunity_id, row]));
}

function countByAction(decisions: OpportunityLifecycleDecision[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const decision of decisions) {
    counts.set(decision.action, (counts.get(decision.action) ?? 0) + 1);
  }
  return counts;
}

function countByNoise(noiseReasons: OpportunityCorrespondenceNoiseReason[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const reason of noiseReasons) {
    const key = reason ?? "meaningful_or_unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function renderCounts(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `| ${md(key)} | ${count} |`);
}

async function main() {
  const p4TableStatus: P4TableStatus = {
    settings: "available",
    lifecycleState: "available",
  };

  const opportunities = await fetchOpportunities();
  const opportunityIds = opportunities.map((row) => row.id);
  const companyIds = unique(opportunities.map((row) => row.company_id));
  const activities = await fetchActivities(opportunityIds);
  const threads = await fetchThreads(unique(activities.map((row) => row.email_thread_id)));
  const connectionIds = unique(
    [...threads.values()].map((row) => row.connection_id)
  );
  const connections = await fetchConnections(connectionIds);
  const settingsByCompany = await fetchSettings(companyIds, p4TableStatus);
  const lifecycleStates = await fetchLifecycleStates(opportunityIds, p4TableStatus);

  const activitiesByOpportunity = new Map<string, ActivityRow[]>();
  for (const activity of activities) {
    if (!activity.opportunity_id) continue;
    const rows = activitiesByOpportunity.get(activity.opportunity_id) ?? [];
    rows.push(activity);
    activitiesByOpportunity.set(activity.opportunity_id, rows);
  }

  const seenProviderMessageIds = new Set<string>();
  const meaningfulEventsByOpportunity = new Map<string, OpportunityLifecycleMeaningfulEvent[]>();
  const noiseReasons: OpportunityCorrespondenceNoiseReason[] = [];

  for (const activity of activities) {
    if (!activity.opportunity_id) continue;
    const direction = directionOf(activity.direction);
    if (!direction) continue;
    const providerThreadId = activity.email_thread_id;
    const thread = providerThreadId
      ? threads.get(`${activity.company_id}:${providerThreadId}`)
      : undefined;
    const connection = thread ? connections.get(thread.connection_id) : undefined;
    const filters = connection?.sync_filters ?? {};
    const duplicateKey =
      activity.email_message_id && thread
        ? `${activity.company_id}:${thread.connection_id}:${activity.email_message_id}`
        : null;

    const classification = classifyOpportunityCorrespondence({
      direction,
      providerThreadId,
      providerMessageId: activity.email_message_id,
      existingProviderMessageIds:
        duplicateKey && seenProviderMessageIds.has(duplicateKey)
          ? [activity.email_message_id ?? ""]
          : [],
      fromEmail: activity.from_email,
      toEmails: activity.to_emails,
      ccEmails: activity.cc_emails,
      subject: activity.subject,
      bodyText: activity.body_text ?? activity.content,
      labels: thread?.labels,
      threadCategory: thread?.primary_category,
      connectionEmail: connection?.email,
      companyDomains: stringList(filters.companyDomains),
      userEmailAddresses: stringList(filters.userEmailAddresses),
      contactEmail: opportunities.find((row) => row.id === activity.opportunity_id)
        ?.contact_email,
    });

    if (duplicateKey) seenProviderMessageIds.add(duplicateKey);
    noiseReasons.push(classification.noiseReason);

    if (!classification.isMeaningful || !activity.created_at) continue;
    const events = meaningfulEventsByOpportunity.get(activity.opportunity_id) ?? [];
    events.push({
      id: activity.id,
      direction,
      isMeaningful: true,
      occurredAt: activity.created_at,
      partyRole: classification.partyRole,
      linkedContactKind: classification.partyRole === "customer" ? "customer" : null,
    });
    meaningfulEventsByOpportunity.set(activity.opportunity_id, events);
  }

  const decisions = opportunities.map((opportunity) =>
    evaluateOpportunityLifecycle({
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
      lifecycleState: lifecycleStateFromRow(lifecycleStates.get(opportunity.id)),
      meaningfulEvents: meaningfulEventsByOpportunity.get(opportunity.id) ?? [],
      settings:
        settingsByCompany.get(opportunity.company_id) ??
        DEFAULT_LEAD_LIFECYCLE_SETTINGS,
      now: NOW,
    })
  );

  const actionable = decisions.filter(
    (decision) => decision.action !== "no_action" && !decision.ignored
  );
  const actionCounts = countByAction(decisions);
  const noiseCounts = countByNoise(noiseReasons);
  const opportunityById = new Map(opportunities.map((row) => [row.id, row]));
  const generatedAt = new Date().toISOString();

  const lines = [
    "# Lead Lifecycle P4 Dry Run",
    "",
    `Generated: ${generatedAt}`,
    `Evaluator clock: ${NOW.toISOString()}`,
    "",
    "Production writes: no.",
    "Archive/lost execution: no.",
    "Auto-send: no.",
    `Artifact write: ${OUTPUT_PATH}`,
    "",
    "## Scope",
    "",
    `- App env directory: \`${ENV_DIR}\``,
    `- Company filter: \`${COMPANY_ID ?? "all"}\``,
    `- Active opportunity cap: ${MAX_OPPORTUNITIES}`,
    `- Activity cap: ${MAX_ACTIVITIES}`,
    "- Monitored stages: `new_lead`, `qualifying`, `quoting`, `quoted`, `follow_up`, `negotiation`",
    "- Excluded by query: archived, deleted, converted/project-linked, won, lost, discarded.",
    "",
    "## P4 Table Availability",
    "",
    "| Table | Status |",
    "| --- | --- |",
    `| lead_lifecycle_settings | ${p4TableStatus.settings} |`,
    `| opportunity_lifecycle_state | ${p4TableStatus.lifecycleState} |`,
    "",
    p4TableStatus.settings === "missing"
      ? "Settings table is not live in this environment; dry-run used default P4 settings."
      : "Settings table was readable; companies without a settings row used default P4 settings.",
    p4TableStatus.lifecycleState === "missing"
      ? "Lifecycle state table is not live in this environment; dry-run did not infer P4 tracked follow-up counts from ordinary outbound mail."
      : "Lifecycle state table was readable; stored unanswered follow-up counters were used when present.",
    "",
    "## Summary",
    "",
    `- Opportunities scanned: ${opportunities.length}`,
    `- Email activities considered: ${activities.length}`,
    `- Meaningful events classified: ${[...meaningfulEventsByOpportunity.values()].reduce((sum, rows) => sum + rows.length, 0)}`,
    `- Candidate actions: ${actionable.length}`,
    "",
    "## Decisions By Action",
    "",
    "| Action | Count |",
    "| --- | ---: |",
    ...renderCounts(actionCounts),
    "",
    "## Classification Noise",
    "",
    "| Classification | Count |",
    "| --- | ---: |",
    ...renderCounts(noiseCounts),
    "",
    "## Candidate Actions",
    "",
    "| Action | Opportunity | Stage | Reason | Evidence |",
    "| --- | --- | --- | --- | --- |",
    ...actionable.slice(0, 100).map((decision) => {
      const opportunity = opportunityById.get(decision.opportunityId);
      return `| ${md(decision.action)} | ${md(opportunity?.title ?? decision.opportunityId)} (${md(decision.opportunityId)}) | ${md(opportunity?.stage)} | ${md(decision.reason)} | ${md(truncate(JSON.stringify(decision.evidence)))} |`;
    }),
    actionable.length > 100
      ? `\nOnly the first 100 of ${actionable.length} candidate actions are listed.`
      : "",
    "",
    "## Read-Only Boundary",
    "",
    "- This script uses Supabase reads for `opportunities`, `activities`, `email_threads`, `email_connections`, and optional P4 settings/state tables.",
    "- It does not insert, update, delete, archive, mark lost, create drafts, or send email.",
    "- The only filesystem write is this markdown artifact.",
  ];

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Candidate actions: ${actionable.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
