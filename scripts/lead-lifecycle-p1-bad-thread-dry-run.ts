/*
 * Read-only Lead Lifecycle P1 data-quality report.
 *
 * Finds existing rows that can corrupt the email lifecycle graph:
 * - blank provider thread ids in email_threads or opportunity_email_threads
 * - activities with blank email_thread_id
 * - provider-backed activities with null/blank email_message_id
 * - activity/email_threads/opportunity_email_threads opportunity mismatches
 *
 * No writes. No cleanup. Output defaults to the P1 artifact requested in docs.
 *
 * Usage:
 *   npx tsx scripts/lead-lifecycle-p1-bad-thread-dry-run.ts
 *   npx tsx scripts/lead-lifecycle-p1-bad-thread-dry-run.ts --company-id <uuid>
 *   OPS_WEB_ENV_DIR=/path/to/ops-web npx tsx scripts/lead-lifecycle-p1-bad-thread-dry-run.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

interface CompanyScopedQuery<TSelf> {
  eq(column: string, value: string): TSelf;
}

interface CountQueryResult {
  count: number | null;
  error: { message: string } | null;
}

interface CountQuery extends PromiseLike<CountQueryResult> {
  eq(column: string, value: unknown): CountQuery;
  neq(column: string, value: unknown): CountQuery;
  not(column: string, operator: string, value: unknown): CountQuery;
  or(filters: string): CountQuery;
}

const ENV_DIR = process.env.OPS_WEB_ENV_DIR || process.cwd();
loadEnvConfig(ENV_DIR);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const DEFAULT_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p1-bad-thread-dry-run-2026-05-26.md";

const companyIdArgIdx = process.argv.indexOf("--company-id");
const COMPANY_ID =
  companyIdArgIdx >= 0 ? process.argv[companyIdArgIdx + 1] : null;
const outputArgIdx = process.argv.indexOf("--output");
const OUTPUT_PATH =
  outputArgIdx >= 0 ? process.argv[outputArgIdx + 1] : DEFAULT_OUTPUT;
const maxActivitiesArgIdx = process.argv.indexOf("--max-activities");
const MAX_ACTIVITIES =
  maxActivitiesArgIdx >= 0
    ? Number.parseInt(process.argv[maxActivitiesArgIdx + 1], 10)
    : 20000;
const maxLinksArgIdx = process.argv.indexOf("--max-links");
const MAX_LINKS =
  maxLinksArgIdx >= 0
    ? Number.parseInt(process.argv[maxLinksArgIdx + 1], 10)
    : 20000;

if (!OUTPUT_PATH) {
  console.error("--output must not be blank");
  process.exit(1);
}

if (!Number.isFinite(MAX_ACTIVITIES) || MAX_ACTIVITIES <= 0) {
  console.error("--max-activities must be a positive integer");
  process.exit(1);
}

if (!Number.isFinite(MAX_LINKS) || MAX_LINKS <= 0) {
  console.error("--max-links must be a positive integer");
  process.exit(1);
}

interface EmailThreadRow {
  id: string;
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
  opportunity_id: string | null;
  client_id: string | null;
  subject: string | null;
  message_count: number | null;
  latest_sender_email: string | null;
  latest_sender_name: string | null;
  updated_at: string | null;
}

interface ThreadLinkRow {
  id: string;
  opportunity_id: string;
  thread_id: string;
  connection_id: string | null;
  created_at: string | null;
}

interface ActivityRow {
  id: string;
  company_id: string;
  opportunity_id: string | null;
  client_id: string | null;
  email_thread_id: string | null;
  email_message_id: string | null;
  subject: string | null;
  content: string | null;
  body_text: string | null;
  from_email: string | null;
  direction: string | null;
  created_at: string | null;
}

interface OpportunityRow {
  id: string;
  title: string | null;
  stage: string | null;
}

interface ActivityThreadMismatch {
  activity: ActivityRow;
  thread: EmailThreadRow;
}

interface LinkThreadMismatch {
  link: ThreadLinkRow;
  thread: EmailThreadRow;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function md(value: unknown): string {
  const text = value == null || value === "" ? "-" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function truncate(value: unknown, max = 90): string {
  const text = value == null ? "" : String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function isSyntheticImportActivity(row: ActivityRow): boolean {
  const subject = (row.subject ?? "").toLowerCase();
  const content = (row.content ?? "").toLowerCase();
  return (
    subject.includes("imported from email pipeline") ||
    content.startsWith("pipeline import:")
  );
}

function companyScoped<T extends CompanyScopedQuery<T>>(query: T): T {
  return COMPANY_ID ? query.eq("company_id", COMPANY_ID) : query;
}

async function fetchExactCount(
  table: string,
  build: (query: CountQuery) => CountQuery
): Promise<number> {
  const query = build(
    sb.from(table).select("id", { count: "exact", head: true }) as unknown as CountQuery
  );
  const { count, error } = await query;
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

async function fetchBlankEmailThreads(): Promise<EmailThreadRow[]> {
  let query = sb
    .from("email_threads")
    .select(
      "id, company_id, connection_id, provider_thread_id, opportunity_id, client_id, subject, message_count, latest_sender_email, latest_sender_name, updated_at"
    )
    .eq("provider_thread_id", "")
    .order("updated_at", { ascending: false })
    .limit(100);
  query = companyScoped(query);
  const { data, error } = await query;
  if (error) throw new Error(`blank email_threads query failed: ${error.message}`);
  return (data ?? []) as EmailThreadRow[];
}

async function fetchBlankThreadLinks(): Promise<ThreadLinkRow[]> {
  let query = sb
    .from("opportunity_email_threads")
    .select("id, opportunity_id, thread_id, connection_id, created_at")
    .eq("thread_id", "")
    .order("created_at", { ascending: false })
    .limit(100);
  const { data, error } = await query;
  if (error) throw new Error(`blank opportunity_email_threads query failed: ${error.message}`);
  return (data ?? []) as ThreadLinkRow[];
}

async function fetchBlankActivityThreadIds(): Promise<ActivityRow[]> {
  let query = sb
    .from("activities")
    .select(
      "id, company_id, opportunity_id, client_id, email_thread_id, email_message_id, subject, content, body_text, from_email, direction, created_at"
    )
    .eq("type", "email")
    .or("email_thread_id.is.null,email_thread_id.eq.")
    .order("created_at", { ascending: false })
    .limit(100);
  query = companyScoped(query);
  const { data, error } = await query;
  if (error) throw new Error(`blank activity thread id query failed: ${error.message}`);
  return (data ?? []) as ActivityRow[];
}

async function fetchMissingMessageIdActivities(): Promise<ActivityRow[]> {
  let query = sb
    .from("activities")
    .select(
      "id, company_id, opportunity_id, client_id, email_thread_id, email_message_id, subject, content, body_text, from_email, direction, created_at"
    )
    .eq("type", "email")
    .not("email_thread_id", "is", null)
    .neq("email_thread_id", "")
    .or("email_message_id.is.null,email_message_id.eq.")
    .order("created_at", { ascending: false })
    .limit(500);
  query = companyScoped(query);
  const { data, error } = await query;
  if (error) throw new Error(`missing message id query failed: ${error.message}`);
  return (data ?? []) as ActivityRow[];
}

async function fetchActivityMismatchCandidates(): Promise<ActivityRow[]> {
  const rows: ActivityRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < MAX_ACTIVITIES; from += pageSize) {
    const to = Math.min(from + pageSize - 1, MAX_ACTIVITIES - 1);
    let query = sb
      .from("activities")
      .select(
        "id, company_id, opportunity_id, client_id, email_thread_id, email_message_id, subject, content, body_text, from_email, direction, created_at"
      )
      .eq("type", "email")
      .not("email_thread_id", "is", null)
      .not("opportunity_id", "is", null)
      .order("created_at", { ascending: false })
      .range(from, to);
    query = companyScoped(query);
    const { data, error } = await query;
    if (error) throw new Error(`activity mismatch candidate query failed: ${error.message}`);
    const page = (data ?? []) as ActivityRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function fetchThreadLinkCandidates(): Promise<ThreadLinkRow[]> {
  const rows: ThreadLinkRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < MAX_LINKS; from += pageSize) {
    const to = Math.min(from + pageSize - 1, MAX_LINKS - 1);
    const { data, error } = await sb
      .from("opportunity_email_threads")
      .select("id, opportunity_id, thread_id, connection_id, created_at")
      .not("thread_id", "is", null)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(`thread link candidate query failed: ${error.message}`);
    const page = (data ?? []) as ThreadLinkRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function fetchThreadsByCompanyAndProviderIds(
  keys: Array<{ companyId: string; providerThreadId: string }>
): Promise<Map<string, EmailThreadRow>> {
  const byCompany = new Map<string, string[]>();
  for (const key of keys) {
    if (isBlank(key.providerThreadId)) continue;
    const list = byCompany.get(key.companyId) ?? [];
    list.push(key.providerThreadId);
    byCompany.set(key.companyId, list);
  }

  const threads = new Map<string, EmailThreadRow>();
  for (const [companyId, ids] of byCompany) {
    for (const idChunk of chunk(unique(ids), 100)) {
      const { data, error } = await sb
        .from("email_threads")
        .select(
          "id, company_id, connection_id, provider_thread_id, opportunity_id, client_id, subject, message_count, latest_sender_email, latest_sender_name, updated_at"
        )
        .eq("company_id", companyId)
        .in("provider_thread_id", idChunk);
      if (error) throw new Error(`thread lookup failed: ${error.message}`);
      for (const row of (data ?? []) as EmailThreadRow[]) {
        threads.set(`${row.company_id}::${row.provider_thread_id}`, row);
      }
    }
  }
  return threads;
}

async function fetchThreadsByConnectionAndProviderIds(
  links: ThreadLinkRow[]
): Promise<Map<string, EmailThreadRow>> {
  const byConnection = new Map<string, string[]>();
  for (const link of links) {
    if (!link.connection_id || isBlank(link.thread_id)) continue;
    const list = byConnection.get(link.connection_id) ?? [];
    list.push(link.thread_id);
    byConnection.set(link.connection_id, list);
  }

  const threads = new Map<string, EmailThreadRow>();
  for (const [connectionId, ids] of byConnection) {
    for (const idChunk of chunk(unique(ids), 100)) {
      let query = sb
        .from("email_threads")
        .select(
          "id, company_id, connection_id, provider_thread_id, opportunity_id, client_id, subject, message_count, latest_sender_email, latest_sender_name, updated_at"
        )
        .eq("connection_id", connectionId)
        .in("provider_thread_id", idChunk);
      query = companyScoped(query);
      const { data, error } = await query;
      if (error) throw new Error(`connection thread lookup failed: ${error.message}`);
      for (const row of (data ?? []) as EmailThreadRow[]) {
        threads.set(`${row.connection_id}::${row.provider_thread_id}`, row);
      }
    }
  }
  return threads;
}

async function fetchOpportunityTitles(
  ids: string[]
): Promise<Map<string, OpportunityRow>> {
  const rows = new Map<string, OpportunityRow>();
  for (const idChunk of chunk(unique(ids), 100)) {
    const { data, error } = await sb
      .from("opportunities")
      .select("id, title, stage")
      .in("id", idChunk);
    if (error) throw new Error(`opportunity lookup failed: ${error.message}`);
    for (const row of (data ?? []) as OpportunityRow[]) {
      rows.set(row.id, row);
    }
  }
  return rows;
}

function countActivityMismatches(
  activities: ActivityRow[],
  threads: Map<string, EmailThreadRow>
): ActivityThreadMismatch[] {
  const mismatches: ActivityThreadMismatch[] = [];
  for (const activity of activities) {
    if (!activity.company_id || isBlank(activity.email_thread_id)) continue;
    const thread = threads.get(`${activity.company_id}::${activity.email_thread_id}`);
    if (!thread?.opportunity_id || !activity.opportunity_id) continue;
    if (thread.opportunity_id !== activity.opportunity_id) {
      mismatches.push({ activity, thread });
    }
  }
  return mismatches;
}

function countLinkMismatches(
  links: ThreadLinkRow[],
  threads: Map<string, EmailThreadRow>
): LinkThreadMismatch[] {
  const mismatches: LinkThreadMismatch[] = [];
  for (const link of links) {
    if (!link.connection_id || isBlank(link.thread_id)) continue;
    const thread = threads.get(`${link.connection_id}::${link.thread_id}`);
    if (!thread?.opportunity_id || !link.opportunity_id) continue;
    if (thread.opportunity_id !== link.opportunity_id) {
      mismatches.push({ link, thread });
    }
  }
  return mismatches;
}

function sectionTable(
  headers: string[],
  rows: Array<Array<unknown>>,
  emptyMessage: string
): string {
  if (rows.length === 0) return `${emptyMessage}\n`;
  const head = `| ${headers.map(md).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(md).join(" | ")} |`);
  return [head, divider, ...body].join("\n") + "\n";
}

function opportunityLabel(
  id: string | null | undefined,
  opportunities: Map<string, OpportunityRow>
): string {
  if (!id) return "-";
  const row = opportunities.get(id);
  return row ? `${id} (${truncate(row.title, 40)} / ${row.stage})` : id;
}

async function buildReport(): Promise<string> {
  const [
    blankThreadCount,
    blankLinkCount,
    blankActivityThreadCount,
    missingMessageCount,
    blankThreads,
    blankLinks,
    blankActivityThreads,
    missingMessageActivities,
    activityCandidates,
    linkCandidates,
  ] = await Promise.all([
    fetchExactCount("email_threads", (q) =>
      companyScoped(q.eq("provider_thread_id", ""))
    ),
    fetchExactCount("opportunity_email_threads", (q) =>
      q.eq("thread_id", "")
    ),
    fetchExactCount("activities", (q) =>
      companyScoped(q.eq("type", "email").or("email_thread_id.is.null,email_thread_id.eq."))
    ),
    fetchExactCount("activities", (q) =>
      companyScoped(
        q
          .eq("type", "email")
          .not("email_thread_id", "is", null)
          .neq("email_thread_id", "")
          .or("email_message_id.is.null,email_message_id.eq.")
      )
    ),
    fetchBlankEmailThreads(),
    fetchBlankThreadLinks(),
    fetchBlankActivityThreadIds(),
    fetchMissingMessageIdActivities(),
    fetchActivityMismatchCandidates(),
    fetchThreadLinkCandidates(),
  ]);

  const activityThreads = await fetchThreadsByCompanyAndProviderIds(
    activityCandidates.map((activity) => ({
      companyId: activity.company_id,
      providerThreadId: activity.email_thread_id ?? "",
    }))
  );
  const linkThreads = await fetchThreadsByConnectionAndProviderIds(linkCandidates);
  const activityMismatches = countActivityMismatches(
    activityCandidates,
    activityThreads
  );
  const linkMismatches = countLinkMismatches(linkCandidates, linkThreads);
  const likelySynthetic = missingMessageActivities.filter(isSyntheticImportActivity);
  const likelyProviderBackedMissingMessage = missingMessageActivities.filter(
    (activity) => !isSyntheticImportActivity(activity)
  );

  const opportunityIds = unique([
    ...blankThreads.map((row) => row.opportunity_id ?? ""),
    ...blankLinks.map((row) => row.opportunity_id),
    ...blankActivityThreads.map((row) => row.opportunity_id ?? ""),
    ...missingMessageActivities.map((row) => row.opportunity_id ?? ""),
    ...activityMismatches.flatMap((item) => [
      item.activity.opportunity_id ?? "",
      item.thread.opportunity_id ?? "",
    ]),
    ...linkMismatches.flatMap((item) => [
      item.link.opportunity_id,
      item.thread.opportunity_id ?? "",
    ]),
  ]);
  const opportunities = await fetchOpportunityTitles(opportunityIds);

  const generatedAt = new Date().toISOString();
  const lines: string[] = [];
  lines.push("# Lead Lifecycle P1 Bad Thread Dry Run");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Company filter: ${COMPANY_ID ?? "all companies"}`);
  lines.push("Write posture: read-only. No production writes. No schema changes.");
  lines.push(`Activity mismatch scan cap: ${MAX_ACTIVITIES}`);
  lines.push(`Thread-link mismatch scan cap: ${MAX_LINKS}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(
    sectionTable(
      ["Check", "Count"],
      [
        ["email_threads.provider_thread_id blank", blankThreadCount],
        ["opportunity_email_threads.thread_id blank", blankLinkCount],
        ["activities.email_thread_id null/blank", blankActivityThreadCount],
        ["activities.email_message_id null/blank with nonblank thread id", missingMessageCount],
        [
          "likely provider-backed missing message ids in sample",
          likelyProviderBackedMissingMessage.length,
        ],
        ["explicit synthetic import exceptions in sample", likelySynthetic.length],
        ["activity vs email_threads opportunity mismatch", activityMismatches.length],
        [
          "opportunity_email_threads vs email_threads opportunity mismatch",
          linkMismatches.length,
        ],
      ],
      "No summary rows."
    )
  );

  lines.push("## Blank Email Threads");
  lines.push("");
  lines.push(
    sectionTable(
      ["thread_row", "company", "connection", "opportunity", "messages", "subject"],
      blankThreads.slice(0, 25).map((row) => [
        row.id,
        row.company_id,
        row.connection_id,
        opportunityLabel(row.opportunity_id, opportunities),
        row.message_count ?? 0,
        truncate(row.subject),
      ]),
      "No blank email_threads.provider_thread_id rows found."
    )
  );

  lines.push("## Blank Opportunity Thread Links");
  lines.push("");
  lines.push(
    sectionTable(
      ["link_row", "connection", "opportunity", "created_at"],
      blankLinks.slice(0, 25).map((row) => [
        row.id,
        row.connection_id,
        opportunityLabel(row.opportunity_id, opportunities),
        row.created_at,
      ]),
      "No blank opportunity_email_threads.thread_id rows found."
    )
  );

  lines.push("## Blank Activity Thread IDs");
  lines.push("");
  lines.push(
    sectionTable(
      ["activity", "company", "opportunity", "message", "from", "created_at", "subject"],
      blankActivityThreads.slice(0, 25).map((row) => [
        row.id,
        row.company_id,
        opportunityLabel(row.opportunity_id, opportunities),
        row.email_message_id,
        row.from_email,
        row.created_at,
        truncate(row.subject),
      ]),
      "No email activities with blank/null email_thread_id found."
    )
  );

  lines.push("## Missing Provider Message IDs");
  lines.push("");
  lines.push(
    sectionTable(
      [
        "activity",
        "classification",
        "company",
        "thread",
        "opportunity",
        "from",
        "created_at",
        "subject",
      ],
      missingMessageActivities.slice(0, 50).map((row) => [
        row.id,
        isSyntheticImportActivity(row)
          ? "synthetic_import_activity"
          : "review_provider_backed",
        row.company_id,
        row.email_thread_id,
        opportunityLabel(row.opportunity_id, opportunities),
        row.from_email,
        row.created_at,
        truncate(row.subject),
      ]),
      "No email activities with blank/null email_message_id and a thread id found."
    )
  );

  lines.push("## Activity / Thread Opportunity Mismatches");
  lines.push("");
  lines.push(
    sectionTable(
      [
        "activity",
        "thread",
        "activity_opportunity",
        "thread_opportunity",
        "from",
        "created_at",
        "subject",
      ],
      activityMismatches.slice(0, 50).map(({ activity, thread }) => [
        activity.id,
        activity.email_thread_id,
        opportunityLabel(activity.opportunity_id, opportunities),
        opportunityLabel(thread.opportunity_id, opportunities),
        activity.from_email,
        activity.created_at,
        truncate(activity.subject),
      ]),
      "No activity/email_threads opportunity mismatches found inside the scan cap."
    )
  );

  lines.push("## Link / Thread Opportunity Mismatches");
  lines.push("");
  lines.push(
    sectionTable(
      ["link", "thread", "link_opportunity", "thread_opportunity", "connection", "created_at"],
      linkMismatches.slice(0, 50).map(({ link, thread }) => [
        link.id,
        link.thread_id,
        opportunityLabel(link.opportunity_id, opportunities),
        opportunityLabel(thread.opportunity_id, opportunities),
        link.connection_id,
        link.created_at,
      ]),
      "No opportunity_email_threads/email_threads opportunity mismatches found inside the scan cap."
    )
  );

  lines.push("## Cleanup Posture");
  lines.push("");
  lines.push("- This report performed reads only.");
  lines.push("- Rows above are candidates for operator-reviewed cleanup, not automatic repair.");
  lines.push("- Synthetic import activities are listed separately because they are allowed to have no provider message id.");
  lines.push("- P2/P3/P4/P5/P6 lifecycle work was not run by this script.");
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const report = await buildReport();
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, report, "utf8");
  console.log(`Wrote dry-run report to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(
    "[lead-lifecycle-p1-dry-run]",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});
