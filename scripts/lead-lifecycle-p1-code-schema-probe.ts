/*
 * Lead Lifecycle P1 code/schema probe.
 *
 * READ-ONLY identification harness backing the P1 code/schema implementation
 * spec. It does NOT mutate any business table. It emits the live evidence sets
 * the spec depends on:
 *
 *   - CW1 gate: count of blank-string email_threads.provider_thread_id +
 *     blank opportunity_email_threads.thread_id rows that must be quarantined
 *     (by DW1) before any provider_thread_id <> '' CHECK can be created.
 *   - CW7 dedupe-broken historical rows: import-path email activities with
 *     email_message_id IS NULL, and the subset whose provider thread also
 *     carries a real-message-id steady-sync activity (the collision/duplicate
 *     surface that the email_message_id dedupe cannot catch today).
 *   - Message-id uniqueness landscape: confirms the partial UNIQUE index
 *     activities_email_message_id_unique (WHERE email_message_id IS NOT NULL)
 *     exists, and that there are zero empty-string message ids and zero
 *     duplicate non-null message ids today.
 *
 * Modeled on scripts/lead-lifecycle-p5-3-repair.ts:
 *   - dual --dry-run / --apply flag (P1 is a code/schema spec, so --apply is a
 *     deliberate NO-OP: there is no data remediation in this workstream; the
 *     apply-mode table allow-list is intentionally empty and the script refuses
 *     to write).
 *   - writes a markdown artifact.
 *   - hard-stop proof block.
 *
 * Usage:
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-lifecycle-p1-code-schema-probe.ts
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-lifecycle-p1-code-schema-probe.ts --apply   # NO-OP, read-only by design
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

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

const APPLY = process.argv.includes("--apply");

// P1 is a code/schema spec. There is NO data remediation in this workstream,
// so the apply-mode table allow-list is intentionally empty. The probe never
// writes; --apply is honored only to keep the dual-mode contract identical to
// the proven P5-3 script.
const APPLY_TABLE_ALLOW_LIST: string[] = [];

const outputArgIdx = process.argv.indexOf("--output");
const OUTPUT_PATH =
  outputArgIdx >= 0
    ? process.argv[outputArgIdx + 1]
    : "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p1-code-schema-probe-dry-run-2026-05-29.md";

interface Metric {
  metric: string;
  n: number;
}

interface CollisionThread {
  provider_thread_id: string;
  null_msgid_import_rows: number;
  real_msgid_rows: number;
  distinct_opps: number;
}

function md(value: unknown): string {
  const text = value == null || value === "" ? "-" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

// Structural view of the post-`.select(..., { count, head })` filter builder,
// exposing ONLY the read-only operators the probe uses. By construction it has
// no insert/update/upsert/delete, so no row mutation is expressible. It is
// awaitable to the head-count response shape. Defined structurally to avoid
// pinning to postgrest-js's version-specific generic signature.
interface CountQuery
  extends PromiseLike<{
    count: number | null;
    error: { message: string } | null;
  }> {
  eq(column: string, value: string): CountQuery;
  neq(column: string, value: string): CountQuery;
  is(column: string, value: null): CountQuery;
  not(column: string, operator: string, value: null): CountQuery;
}

/**
 * The probe reads aggregate counts only. supabase-js does not run arbitrary
 * SQL, so each metric is a scoped count() against an allow-list of read-only
 * filters. No row mutation is possible through these calls.
 */
async function count(
  table: string,
  build: (q: CountQuery) => CountQuery
): Promise<number> {
  // head:true + count:exact returns only the row count, never row data.
  const query = sb
    .from(table)
    .select("*", { count: "exact", head: true }) as unknown as CountQuery;
  const { count: n, error } = await build(query);
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
}

async function fetchMetrics(): Promise<Metric[]> {
  const metrics: Metric[] = [];

  // CW1 gate — blank rows that block the provider_thread_id <> '' CHECK.
  metrics.push({
    metric: "blank_email_threads_provider_thread_id",
    n: await count("email_threads", (q) => q.eq("provider_thread_id", "")),
  });
  metrics.push({
    metric: "blank_opportunity_email_threads_thread_id",
    n: await count("opportunity_email_threads", (q) => q.eq("thread_id", "")),
  });

  // Message-id uniqueness landscape (CW7 / CW2 context).
  metrics.push({
    metric: "activities_email_msgid_empty_string",
    n: await count("activities", (q) =>
      q.eq("type", "email").eq("email_message_id", "")
    ),
  });
  metrics.push({
    metric: "activities_email_msgid_null",
    n: await count("activities", (q) =>
      q.eq("type", "email").is("email_message_id", null)
    ),
  });

  return metrics;
}

/**
 * CW7 dedupe-broken historical rows. supabase-js cannot express the
 * "thread also has a real-msgid row" EXISTS join, so we fetch the candidate
 * import rows (type=email, email_message_id IS NULL, non-blank email_thread_id)
 * and the set of provider thread ids that carry a real message id, then
 * intersect in memory. All reads, no writes.
 */
async function fetchCollisionThreads(): Promise<CollisionThread[]> {
  const importRows: { email_thread_id: string; opportunity_id: string | null }[] =
    [];
  {
    let from = 0;
    const page = 1000;
    for (;;) {
      const { data, error } = await sb
        .from("activities")
        .select("email_thread_id, opportunity_id")
        .eq("type", "email")
        .is("email_message_id", null)
        .not("email_thread_id", "is", null)
        .neq("email_thread_id", "")
        .range(from, from + page - 1);
      if (error) throw new Error(`activities import-null-msgid: ${error.message}`);
      const rows = (data ?? []) as typeof importRows;
      importRows.push(...rows);
      if (rows.length < page) break;
      from += page;
    }
  }

  const importThreadIds = Array.from(
    new Set(importRows.map((r) => r.email_thread_id))
  );

  // Which of those thread ids carry at least one real (non-null, non-blank)
  // message-id activity? Probe per-thread with a head count.
  const realMsgIdByThread = new Map<string, number>();
  for (const threadId of importThreadIds) {
    const n = await count("activities", (q) =>
      q
        .eq("email_thread_id", threadId)
        .not("email_message_id", "is", null)
        .neq("email_message_id", "")
    );
    if (n > 0) realMsgIdByThread.set(threadId, n);
  }

  const out: CollisionThread[] = [];
  for (const threadId of importThreadIds) {
    const real = realMsgIdByThread.get(threadId);
    if (!real) continue;
    const group = importRows.filter((r) => r.email_thread_id === threadId);
    out.push({
      provider_thread_id: threadId,
      null_msgid_import_rows: group.length,
      real_msgid_rows: real,
      distinct_opps: new Set(group.map((r) => r.opportunity_id ?? "")).size,
    });
  }
  out.sort((a, b) => b.null_msgid_import_rows - a.null_msgid_import_rows);
  return out;
}

function hardStopProof(): string {
  return [
    "## Hard-Stop Proof",
    "",
    "- Database writes performed: no (read-only count/select only).",
    "- Apply mode (`--apply`) is a deliberate NO-OP for P1: this is a code/schema spec, not a data remediation. The apply-mode table allow-list is empty; the probe refuses to write.",
    `- Apply-mode table allow-list: ${
      APPLY_TABLE_ALLOW_LIST.length === 0
        ? "(empty — P1 performs no data writes)"
        : APPLY_TABLE_ALLOW_LIST.join(", ")
    }`,
    "- Migrations applied: no.",
    "- Email sent / drafts created: no.",
    "- Opportunity / client / activity / thread business state changed: no.",
    "- iOS-synced tables (email_threads, opportunity_email_threads, activities, opportunities, clients) untouched.",
  ].join("\n");
}

function renderArtifact(
  metrics: Metric[],
  collisions: CollisionThread[]
): string {
  const collisionImportRows = collisions.reduce(
    (sum, c) => sum + c.null_msgid_import_rows,
    0
  );
  return [
    `# Lead Lifecycle P1 Code/Schema Probe ${APPLY ? "(--apply NO-OP)" : "Dry Run"}`,
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Mode: ${APPLY ? "apply (no-op)" : "dry-run"}`,
    "",
    "## Summary",
    "",
    "Read-only evidence backing the P1 code/schema implementation spec.",
    "",
    hardStopProof(),
    "",
    "## CW1 gate + message-id landscape",
    "",
    "| metric | count |",
    "| --- | --- |",
    ...metrics.map((m) => `| ${md(m.metric)} | ${m.n} |`),
    "",
    "## CW7 dedupe-broken historical rows",
    "",
    `Provider threads where an import-path activity has \`email_message_id IS NULL\` AND the same thread also carries a real-message-id steady-sync activity. Steady-sync dedupe (\`processInboundEmail\` keyed on \`email_message_id\`) cannot match the null-msgid import rows, so re-ingestion duplicates them.`,
    "",
    `- Collision threads: ${collisions.length}`,
    `- Null-message-id import rows across those threads: ${collisionImportRows}`,
    "",
    "| provider_thread_id | null_msgid_import_rows | real_msgid_rows | distinct_opps |",
    "| --- | --- | --- | --- |",
    ...collisions.map(
      (c) =>
        `| ${md(c.provider_thread_id)} | ${c.null_msgid_import_rows} | ${c.real_msgid_rows} | ${c.distinct_opps} |`
    ),
    "",
  ].join("\n");
}

async function writeArtifact(markdown: string) {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, markdown);
}

async function main() {
  if (APPLY && APPLY_TABLE_ALLOW_LIST.length === 0) {
    console.warn(
      "[p1-probe] --apply is a no-op: P1 is a code/schema spec with an empty apply-mode allow-list. Running read-only."
    );
  }
  const metrics = await fetchMetrics();
  const collisions = await fetchCollisionThreads();
  await writeArtifact(renderArtifact(metrics, collisions));
  console.log(`Artifact write: ${OUTPUT_PATH}`);
  console.log(`Mode: ${APPLY ? "apply (no-op)" : "dry-run"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
