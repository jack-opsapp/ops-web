/*
 * Lead Lifecycle P4 legacy correspondence backfill dry-run.
 *
 * Read-only against Supabase. It plans the correspondence/state rows that a
 * separately reviewed backfill apply path would insert or upsert. It does not
 * mutate opportunities, lifecycle tables, drafts, notifications, providers, or
 * email.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  planLegacyCorrespondenceBackfill,
  type LegacyBackfillActivityRow,
  type LegacyBackfillEmailConnectionRow,
  type LegacyBackfillEmailThreadRow,
  type LegacyBackfillExistingEventRow,
  type LegacyBackfillOpportunityRow,
  type LegacyBackfillOpportunityThreadLinkRow,
} from "../src/lib/email/opportunity-legacy-correspondence-backfill";

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
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p4-22-legacy-correspondence-backfill-dry-run-2026-05-28.md";

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

interface ProductionSnapshot {
  capturedAt: string;
  opportunitiesCount: number;
  archivedCount: number;
  lostCount: number;
  maxOpportunityUpdatedAt: string | null;
  correspondenceEventsCount: number;
  lifecycleStateCount: number;
  lifecycleSettingsCount: number;
  auditTableExists: boolean;
  guardedRpcExists: boolean;
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

function renderCounts(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `| ${md(key)} | ${count} |`);
}

async function fetchOpportunities(): Promise<LegacyBackfillOpportunityRow[]> {
  let query = sb
    .from("opportunities")
    .select(
      "id, company_id, title, stage, archived_at, deleted_at, project_id, project_ref, created_at, stage_entered_at, contact_email, contact_name, source"
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(MAX_OPPORTUNITIES);
  if (COMPANY_ID) query = query.eq("company_id", COMPANY_ID);
  const { data, error } = await query;
  if (error) throw new Error(`opportunities query failed: ${error.message}`);
  return (data ?? []) as LegacyBackfillOpportunityRow[];
}

async function fetchActivities(
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

      if (error) throw new Error(`activities query failed: ${error.message}`);
      const page = (data ?? []) as LegacyBackfillActivityRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    if (rows.length >= MAX_ACTIVITIES) break;
  }
  return rows;
}

async function fetchThreads(
  providerThreadIds: string[]
): Promise<LegacyBackfillEmailThreadRow[]> {
  const rows: LegacyBackfillEmailThreadRow[] = [];
  for (const ids of chunk(providerThreadIds, 500)) {
    const { data, error } = await sb
      .from("email_threads")
      .select(
        "company_id, opportunity_id, connection_id, provider_thread_id, labels, primary_category, subject, participants, first_message_at, last_message_at, message_count, latest_direction, latest_sender_email, latest_sender_name, latest_snippet"
      )
      .in("provider_thread_id", ids);
    if (error) throw new Error(`email_threads query failed: ${error.message}`);
    rows.push(...((data ?? []) as LegacyBackfillEmailThreadRow[]));
  }
  return rows;
}

async function fetchOpportunityThreadLinks(
  opportunityIds: string[]
): Promise<LegacyBackfillOpportunityThreadLinkRow[]> {
  const rows: LegacyBackfillOpportunityThreadLinkRow[] = [];
  for (const ids of chunk(opportunityIds, 500)) {
    const { data, error } = await sb
      .from("opportunity_email_threads")
      .select("opportunity_id, thread_id, connection_id")
      .in("opportunity_id", ids);
    if (error) throw new Error(`opportunity_email_threads query failed: ${error.message}`);
    rows.push(...((data ?? []) as LegacyBackfillOpportunityThreadLinkRow[]));
  }
  return rows;
}

async function fetchGuardedRpcExists(): Promise<boolean> {
  const pgProcProbe = await sb
    .schema("pg_catalog")
    .from("pg_proc")
    .select("proname")
    .eq("proname", "execute_opportunity_lifecycle_guarded_action")
    .limit(1);
  if (!pgProcProbe.error) return (pgProcProbe.data ?? []).length > 0;

  const routineProbe = await sb
    .schema("information_schema")
    .from("routines")
    .select("routine_name")
    .eq("routine_schema", "public")
    .eq("routine_name", "execute_opportunity_lifecycle_guarded_action")
    .limit(1);
  return !routineProbe.error && (routineProbe.data ?? []).length > 0;
}

async function fetchConnections(
  connectionIds: string[]
): Promise<LegacyBackfillEmailConnectionRow[]> {
  const rows: LegacyBackfillEmailConnectionRow[] = [];
  for (const ids of chunk(connectionIds, 500)) {
    const { data, error } = await sb
      .from("email_connections")
      .select("id, company_id, email, sync_filters")
      .in("id", ids);
    if (error) throw new Error(`email_connections query failed: ${error.message}`);
    rows.push(...((data ?? []) as LegacyBackfillEmailConnectionRow[]));
  }
  return rows;
}

async function fetchExistingEvents(
  opportunityIds: string[]
): Promise<LegacyBackfillExistingEventRow[]> {
  const rows: LegacyBackfillExistingEventRow[] = [];
  for (const ids of chunk(opportunityIds, 500)) {
    const { data, error } = await sb
      .from("opportunity_correspondence_events")
      .select(
        "id, company_id, opportunity_id, activity_id, connection_id, provider_thread_id, provider_message_id, direction, party_role, is_meaningful, noise_reason, occurred_at, linked_contact_kind, linked_contact_id, source, subject, from_email, to_emails, cc_emails"
      )
      .in("opportunity_id", ids);
    if (error) throw new Error(`opportunity_correspondence_events query failed: ${error.message}`);
    rows.push(...((data ?? []) as LegacyBackfillExistingEventRow[]));
  }
  return rows;
}

async function fetchProductionSnapshot(): Promise<ProductionSnapshot> {
  const [
    opportunities,
    archived,
    lost,
    maxUpdated,
    p4Events,
    p4State,
    settings,
  ] = await Promise.all([
    sb.from("opportunities").select("id", { count: "exact", head: true }),
    sb
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .not("archived_at", "is", null),
    sb
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("stage", "lost"),
    sb
      .from("opportunities")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("opportunity_correspondence_events")
      .select("id", { count: "exact", head: true }),
    sb
      .from("opportunity_lifecycle_state")
      .select("opportunity_id", { count: "exact", head: true }),
    sb
      .from("lead_lifecycle_settings")
      .select("company_id", { count: "exact", head: true }),
  ]);

  for (const [label, result] of [
    ["opportunities", opportunities],
    ["archived opportunities", archived],
    ["lost opportunities", lost],
    ["opportunities max updated_at", maxUpdated],
    ["opportunity_correspondence_events", p4Events],
    ["opportunity_lifecycle_state", p4State],
    ["lead_lifecycle_settings", settings],
  ] as const) {
    if (result.error) throw new Error(`${label} query failed: ${result.error.message}`);
  }

  const auditProbe = await sb
    .from("opportunity_lifecycle_action_audit")
    .select("id", { count: "exact", head: true });
  const rpcExists = await fetchGuardedRpcExists();

  return {
    capturedAt: new Date().toISOString(),
    opportunitiesCount: opportunities.count ?? 0,
    archivedCount: archived.count ?? 0,
    lostCount: lost.count ?? 0,
    maxOpportunityUpdatedAt:
      (maxUpdated.data as { updated_at?: string | null } | null)?.updated_at ?? null,
    correspondenceEventsCount: p4Events.count ?? 0,
    lifecycleStateCount: p4State.count ?? 0,
    lifecycleSettingsCount: settings.count ?? 0,
    auditTableExists: !auditProbe.error && typeof auditProbe.count === "number",
    guardedRpcExists: rpcExists,
  };
}

async function main() {
  const preRunSnapshot = await fetchProductionSnapshot();
  const opportunities = await fetchOpportunities();
  const opportunityIds = opportunities.map((row) => row.id);
  const activities = await fetchActivities(opportunityIds);
  const opportunityThreadLinks = await fetchOpportunityThreadLinks(opportunityIds);
  const providerThreadIds = unique([
    ...activities.map((row) => row.email_thread_id),
    ...opportunityThreadLinks.map((row) => row.thread_id),
  ]);
  const [threads, existingEvents] = await Promise.all([
    fetchThreads(providerThreadIds),
    fetchExistingEvents(opportunityIds),
  ]);
  const connections = await fetchConnections(
    unique(threads.map((row) => row.connection_id))
  );
  const plan = planLegacyCorrespondenceBackfill({
    opportunities,
    activities,
    threads,
    opportunityThreadLinks,
    connections,
    existingEvents,
    now: NOW,
  });
  const postRunSnapshot = await fetchProductionSnapshot();

  const eventsBySource = plan.plannedEvents.reduce((counts, row) => {
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const skipsByReason = plan.skippedEvidence.reduce((counts, row) => {
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const generatedAt = new Date().toISOString();

  const lines = [
    "# Lead Lifecycle P4-22 Legacy Correspondence Backfill Dry Run",
    "",
    `Generated: ${generatedAt}`,
    `Evaluator clock: ${NOW.toISOString()}`,
    "",
    "Production lifecycle data writes: no.",
    "Backfill apply run: no.",
    "Destructive apply mode run: no.",
    "Migration applied: no.",
    "Emails sent: no.",
    "Provider drafts created: no.",
    "Archive/lost/reactivation execution: not run.",
    "Approved-actions file created: no.",
    `Artifact write: ${OUTPUT_PATH}`,
    "",
    "## Scope",
    "",
    `- App env directory: \`${ENV_DIR}\``,
    `- Company filter: \`${COMPANY_ID ?? "all"}\``,
    `- Opportunity scan cap: ${MAX_OPPORTUNITIES}`,
    `- Activity scan cap: ${MAX_ACTIVITIES}`,
    "- Sources: `activities`, `email_threads`, `opportunity_email_threads`, `email_connections`, existing P4 proof rows, and deterministic opportunity source/title fallback.",
    "- Empty P4 proof tables are not treated as no meaningful legacy correspondence.",
    "- Provider-backed rows still require real provider thread ids; non-provider legacy evidence is activity/opportunity scoped with a synthetic legacy boundary in the projected row.",
    "- Linked `opportunity_email_threads` rows are first-class legacy evidence even when no activity rows exist.",
    "- P3 relationship boundaries are respected; thread evidence linked to a different opportunity is skipped.",
    "",
    "## Production Snapshot Proof",
    "",
    "| Metric | Pre-run | Post-run |",
    "| --- | ---: | ---: |",
    `| opportunities | ${preRunSnapshot.opportunitiesCount} | ${postRunSnapshot.opportunitiesCount} |`,
    `| archived opportunities | ${preRunSnapshot.archivedCount} | ${postRunSnapshot.archivedCount} |`,
    `| lost opportunities | ${preRunSnapshot.lostCount} | ${postRunSnapshot.lostCount} |`,
    `| max opportunity updated_at | ${md(preRunSnapshot.maxOpportunityUpdatedAt)} | ${md(postRunSnapshot.maxOpportunityUpdatedAt)} |`,
    `| opportunity_correspondence_events | ${preRunSnapshot.correspondenceEventsCount} | ${postRunSnapshot.correspondenceEventsCount} |`,
    `| opportunity_lifecycle_state | ${preRunSnapshot.lifecycleStateCount} | ${postRunSnapshot.lifecycleStateCount} |`,
    `| lead_lifecycle_settings | ${preRunSnapshot.lifecycleSettingsCount} | ${postRunSnapshot.lifecycleSettingsCount} |`,
    `| action audit table exists | ${preRunSnapshot.auditTableExists} | ${postRunSnapshot.auditTableExists} |`,
    `| guarded RPC exists | ${preRunSnapshot.guardedRpcExists} | ${postRunSnapshot.guardedRpcExists} |`,
    "",
    "## Summary",
    "",
    `- Opportunities scanned: ${opportunities.length}`,
    `- Legacy activities scanned: ${activities.length}`,
    `- Existing P4 correspondence events found: ${existingEvents.length}`,
    `- Planned opportunity_correspondence_events rows: ${plan.plannedEvents.length}`,
    `- Planned opportunity_lifecycle_state rows: ${plan.lifecycleStateRows.length}`,
    `- Skipped legacy evidence rows: ${plan.skippedEvidence.length}`,
    `- Opportunity rows to mutate: ${plan.opportunityMutationCount}`,
    "",
    "## Planned Events By Source",
    "",
    "| Source | Count |",
    "| --- | ---: |",
    ...renderCounts(eventsBySource),
    eventsBySource.size === 0 ? "| - | 0 |" : "",
    "",
    "## Skipped Evidence By Reason",
    "",
    "| Reason | Count |",
    "| --- | ---: |",
    ...renderCounts(skipsByReason),
    skipsByReason.size === 0 ? "| - | 0 |" : "",
    "",
    "## opportunity_correspondence_events Rows That Would Be Created",
    "",
    "| Source | Opportunity ID | Activity ID | Provider thread | Provider message | Direction | Party | Meaningful | Occurred at | Confidence | Boundary | Reason |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...plan.plannedEvents.slice(0, 200).map((row) => {
      return `| ${md(row.source)} | ${md(row.opportunity_id)} | ${md(row.activity_id)} | ${md(row.provider_thread_id)} | ${md(row.provider_message_id)} | ${md(row.direction)} | ${md(row.party_role)} | ${md(row.is_meaningful)} | ${md(row.occurred_at)} | ${md(row.confidence)} | ${md(row.source_boundary)} | ${md(row.reason)} |`;
    }),
    plan.plannedEvents.length > 200
      ? `\nOnly the first 200 of ${plan.plannedEvents.length} planned event rows are listed.`
      : "",
    plan.plannedEvents.length === 0
      ? "| - | - | - | - | - | - | - | - | - | - | - | - |"
      : "",
    "",
    "## Exact Event Row JSON",
    "",
    "```json",
    JSON.stringify(plan.plannedEvents, null, 2),
    "```",
    "",
    "## opportunity_lifecycle_state Rows That Would Be Upserted",
    "",
    "| Opportunity ID | Last meaningful event | Last meaningful at | Direction | Boundary | Reason |",
    "| --- | --- | --- | --- | --- | --- |",
    ...plan.lifecycleStateRows.slice(0, 200).map((row) => {
      return `| ${md(row.opportunity_id)} | ${md(row.last_meaningful_event_id)} | ${md(row.last_meaningful_at)} | ${md(row.last_meaningful_direction)} | ${md(row.source_boundary)} | ${md(row.reason)} |`;
    }),
    plan.lifecycleStateRows.length > 200
      ? `\nOnly the first 200 of ${plan.lifecycleStateRows.length} planned lifecycle rows are listed.`
      : "",
    plan.lifecycleStateRows.length === 0 ? "| - | - | - | - | - | - |" : "",
    "",
    "## Exact Lifecycle State Row JSON",
    "",
    "```json",
    JSON.stringify(plan.lifecycleStateRows, null, 2),
    "```",
    "",
    "## Boundary",
    "",
    "- This was a dry-run only.",
    "- No P4 rows were inserted or updated.",
    "- No opportunities were archived, marked lost, reactivated, or otherwise mutated.",
    "- No drafts, notifications, provider drafts, or emails were created.",
  ];

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Planned events: ${plan.plannedEvents.length}`);
  console.log(`Planned lifecycle rows: ${plan.lifecycleStateRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
