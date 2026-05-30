/*
 * Lead Lifecycle P1 — Blank-thread bucket remediation (DW1).
 *
 * Workstream: DW1-blank-thread-bucket-quarantine.
 *
 * Quarantines the empty-provider-thread aggregate bucket so it stops being read
 * as real correspondence and cannot drive stale/archive/lifecycle logic, WITHOUT
 * destroying truth and WITHOUT auto-merging noise into a real customer.
 *
 * Apply-mode table allow-list (the ONLY tables apply may ever write):
 *   - email_threads
 *   - opportunity_email_threads
 *   - activities
 *   - opportunities
 *
 * Hard guarantees:
 * - Emails sent: no.
 * - Provider drafts created: no.
 * - Real provider ids invented: no (synthetic ids are deterministic 'legacy:'||uuid).
 * - Buckets auto-merged into a real customer: no.
 * - Activities split / re-pointed / deleted: no (quarantine-isolate only).
 * - Any table outside the 4-table allow-list touched: no.
 *
 * Usage:
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-p1-blank-thread-remediation.ts --dry-run
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-p1-blank-thread-remediation.ts --apply \
 *       --approve-aggregate a760f45f-d772-4cbf-9e34-03a113aabef2=discarded
 *
 * NOTE: --apply is gated on per-opportunity operator approval flags
 * (--approve-aggregate <oppId>=<targetStage>) and is INTENTIONALLY NOT RUN by
 * the build agent. Only --dry-run is ever executed here.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

// --------------------------------------------------------------------------
// Constants — verified-live target rows (see artifact for the verification SQL).
// --------------------------------------------------------------------------

const COMPANY_CANPRO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const CONNECTION = "5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3";

// The "New Lead — Email Inquiry" shell: blank client name+email, owns 1746 blank
// activities + the blank email_threads row. Safe candidate to reclassify out of
// active stages ONLY with operator approval.
const OPP_NEW_LEAD_SHELL = "a760f45f-d772-4cbf-9e34-03a113aabef2";
// The Marcia Farquhar negotiation: a REAL lead whose true correspondence lives
// elsewhere. MUST NOT be discarded — only de-linked from the blank thread.
const OPP_MARCIA = "aeb65f87-2384-4e42-a274-239871a22eac";

// Apply-mode is restricted to exactly these tables.
const TABLE_ALLOW_LIST = [
  "email_threads",
  "opportunity_email_threads",
  "activities",
  "opportunities",
] as const;

// Stages considered "active pipeline" (inflate counts / feed the lifecycle
// evaluator). Terminal/parked stages are discarded / lost / won.
const ACTIVE_STAGES = new Set([
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "negotiation",
  "follow_up",
]);
const APPROVED_TARGET_STAGES = new Set(["discarded", "lost"]);
const LEGACY_AGGREGATE_TAG = "legacy-aggregate";

// Synthetic test-seed opportunity prefix — EXCLUDE from production noise.
const SYNTHETIC_TEST_PREFIX = "d2000000-0000-4000-d200-";

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
const DRY_RUN = process.argv.includes("--dry-run") || !APPLY;

const OUTPUT_DRY_RUN =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p1-blank-thread-remediation-dry-run-2026-05-29.md";
const OUTPUT_APPLY =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p1-blank-thread-remediation-apply-2026-05-29.md";
const outputArgIdx = process.argv.indexOf("--output");
const OUTPUT_PATH =
  outputArgIdx >= 0
    ? process.argv[outputArgIdx + 1]
    : APPLY
      ? OUTPUT_APPLY
      : OUTPUT_DRY_RUN;

// Parse --approve-aggregate <oppId>=<targetStage> (repeatable). Apply-only gate.
function parseAggregateApprovals(): Map<string, string> {
  const approvals = new Map<string, string>();
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--approve-aggregate") {
      const raw = process.argv[i + 1] ?? "";
      const [oppId, stage] = raw.split("=");
      if (oppId && stage) approvals.set(oppId, stage);
    }
  }
  return approvals;
}
const AGGREGATE_APPROVALS = parseAggregateApprovals();

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface BlankThreadRow {
  id: string;
  company_id: string;
  connection_id: string | null;
  provider_thread_id: string;
  subject: string | null;
  latest_sender_email: string | null;
  message_count: number | null;
  opportunity_id: string | null;
}

interface BlankJoinRow {
  id: string;
  thread_id: string;
  connection_id: string | null;
  opportunity_id: string | null;
}

interface AggregateOppRow {
  id: string;
  title: string;
  stage: string;
  deleted_at: string | null;
  archived_at: string | null;
  client_id: string | null;
  correspondence_count: number | null;
  tags: string[] | null;
}

interface ActivityBucket {
  opportunity_id: string | null;
  count: number;
}

interface UnownedMsgActivity {
  id: string;
  email_message_id: string | null;
  subject: string | null;
  created_at: string;
}

interface PlanRow {
  table: (typeof TABLE_ALLOW_LIST)[number];
  rowKey: string;
  field: string;
  current: string;
  proposed: string;
  classification: "confident-fix" | "quarantine" | "flag-only";
  note: string;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function md(value: unknown): string {
  const text = value == null || value === "" ? "—" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function syntheticThreadId(uuid: string): string {
  return `legacy:${uuid}`;
}

function syntheticActivityThreadId(opportunityId: string | null): string {
  // Per-opportunity synthetic id so the empty-string bucket no longer aggregates
  // across opportunities. Unowned rows get a stable unowned marker.
  return opportunityId
    ? `legacy:${opportunityId}`
    : "legacy:unowned-no-opportunity";
}

function assertAllowListed(table: string): void {
  if (!(TABLE_ALLOW_LIST as readonly string[]).includes(table)) {
    throw new Error(
      `REFUSED: table '${table}' is not in the apply allow-list ${JSON.stringify(
        TABLE_ALLOW_LIST
      )}`
    );
  }
}

// --------------------------------------------------------------------------
// Fetch (read-only)
// --------------------------------------------------------------------------

async function fetchBlankThreads(): Promise<BlankThreadRow[]> {
  const { data, error } = await sb
    .from("email_threads")
    .select(
      "id, company_id, connection_id, provider_thread_id, subject, latest_sender_email, message_count, opportunity_id"
    )
    .eq("provider_thread_id", "");
  if (error) throw new Error(error.message);
  return (data ?? []) as BlankThreadRow[];
}

async function fetchBlankJoins(): Promise<BlankJoinRow[]> {
  const { data, error } = await sb
    .from("opportunity_email_threads")
    .select("id, thread_id, connection_id, opportunity_id")
    .eq("thread_id", "");
  if (error) throw new Error(error.message);
  return (data ?? []) as BlankJoinRow[];
}

async function fetchAggregateOpps(ids: string[]): Promise<AggregateOppRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await sb
    .from("opportunities")
    .select(
      "id, title, stage, deleted_at, archived_at, client_id, correspondence_count, tags"
    )
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as AggregateOppRow[];
}

// Blank-bucket activities, grouped by owning opp, excluding synthetic test rows.
async function fetchActivityBuckets(): Promise<{
  buckets: ActivityBucket[];
  totals: {
    emptyString: number;
    nullThread: number;
    syntheticTest: number;
    productionTotal: number;
  };
}> {
  // Pull only the columns needed; page through to be safe on large sets.
  const rows: { opportunity_id: string | null; email_thread_id: string | null }[] =
    [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("activities")
      .select("opportunity_id, email_thread_id")
      .eq("type", "email")
      .or("email_thread_id.eq.,email_thread_id.is.null")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as {
      opportunity_id: string | null;
      email_thread_id: string | null;
    }[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  let emptyString = 0;
  let nullThread = 0;
  let syntheticTest = 0;
  const byOpp = new Map<string | null, number>();

  for (const r of rows) {
    if (r.email_thread_id === "") emptyString += 1;
    else if (r.email_thread_id === null) nullThread += 1;
    const oppId = r.opportunity_id;
    if (oppId && oppId.startsWith(SYNTHETIC_TEST_PREFIX)) {
      syntheticTest += 1;
      continue; // exclude test fixtures
    }
    byOpp.set(oppId, (byOpp.get(oppId) ?? 0) + 1);
  }

  const buckets: ActivityBucket[] = Array.from(byOpp.entries())
    .map(([opportunity_id, count]) => ({ opportunity_id, count }))
    .sort((a, b) => b.count - a.count);

  const productionTotal = buckets.reduce((acc, b) => acc + b.count, 0);

  return {
    buckets,
    totals: { emptyString, nullThread, syntheticTest, productionTotal },
  };
}

async function fetchUnownedMsgActivities(): Promise<UnownedMsgActivity[]> {
  const { data, error } = await sb
    .from("activities")
    .select("id, email_message_id, subject, created_at")
    .eq("type", "email")
    .is("opportunity_id", null)
    .or("email_thread_id.eq.,email_thread_id.is.null")
    .not("email_message_id", "is", null);
  if (error) throw new Error(error.message);
  return ((data ?? []) as UnownedMsgActivity[]).filter(
    (r) => (r.email_message_id ?? "") !== ""
  );
}

// --------------------------------------------------------------------------
// Plan construction
// --------------------------------------------------------------------------

function buildPlan(input: {
  blankThreads: BlankThreadRow[];
  blankJoins: BlankJoinRow[];
  aggregateOpps: AggregateOppRow[];
  buckets: ActivityBucket[];
  unownedMsg: UnownedMsgActivity[];
}): PlanRow[] {
  const plan: PlanRow[] = [];

  // (i) Quarantine the blank email_threads row(s): provider_thread_id -> legacy:<id>.
  for (const t of input.blankThreads) {
    plan.push({
      table: "email_threads",
      rowKey: t.id,
      field: "provider_thread_id",
      current: t.provider_thread_id === "" ? "'' (empty)" : t.provider_thread_id,
      proposed: syntheticThreadId(t.id),
      classification: "confident-fix",
      note: `Quarantine blank provider thread (msg_count=${
        t.message_count ?? 0
      }, opp=${t.opportunity_id ?? "—"}). Deterministic synthetic id; no real id invented. Stops the '' bucket from cross-joining with the blank join row on the same connection.`,
    });
    // Stamp a quarantine marker into the subject so it reads as quarantined, not real.
    plan.push({
      table: "email_threads",
      rowKey: t.id,
      field: "subject",
      current: t.subject ?? "'' (empty)",
      proposed: "[QUARANTINED legacy-aggregate]",
      classification: "confident-fix",
      note: "Quarantine marker so the thread is not read as real correspondence.",
    });
  }

  // (ii) Rewrite the blank opportunity_email_threads join row to a DISTINCT
  // synthetic id (its own id), so it no longer matches the blank thread's '' on
  // the shared connection. It points at a real opp (Marcia) — we keep the link
  // but break the empty-string match. NOT a delete: the link's opp is real.
  for (const j of input.blankJoins) {
    plan.push({
      table: "opportunity_email_threads",
      rowKey: j.id,
      field: "thread_id",
      current: j.thread_id === "" ? "'' (empty)" : j.thread_id,
      proposed: syntheticThreadId(j.id),
      classification: "confident-fix",
      note: `Blank thread_id is itself the corruption (would empty-string-match the blank email_threads row on connection ${
        j.connection_id ?? "—"
      }). Rewrite to a distinct synthetic id keyed on the join's own id so it no longer aggregates. Opp ${
        j.opportunity_id ?? "—"
      } (Marcia) is real and stays linked.`,
    });
  }

  // (iii) Aggregate-opportunity disposition — operator-gated, per-opportunity.
  for (const o of input.aggregateOpps) {
    const isActive = ACTIVE_STAGES.has(o.stage);
    if (o.id === OPP_MARCIA) {
      // MUST NOT be discarded. Flag only — de-link handled by (ii) above.
      plan.push({
        table: "opportunities",
        rowKey: o.id,
        field: "stage",
        current: o.stage,
        proposed: o.stage,
        classification: "flag-only",
        note: `'${o.title}' is a REAL lead (client + email present). DO NOT discard. De-linking from the blank thread is done via the join rewrite (ii). No stage change proposed.`,
      });
      continue;
    }
    if (o.id === OPP_NEW_LEAD_SHELL) {
      const approvedStage = AGGREGATE_APPROVALS.get(o.id);
      const willReclassify =
        isActive &&
        approvedStage !== undefined &&
        APPROVED_TARGET_STAGES.has(approvedStage);
      plan.push({
        table: "opportunities",
        rowKey: o.id,
        field: "stage",
        current: o.stage,
        proposed: willReclassify ? (approvedStage as string) : `${o.stage} (UNCHANGED — needs operator approval)`,
        classification: "quarantine",
        note: `'${o.title}' is a blank-everything shell (blank client name+email, ${
          o.correspondence_count ?? 0
        } correspondence count inflated by 1746 blank activities). Reclassify OUT of active stages so it stops feeding the lifecycle evaluator — ONLY with --approve-aggregate ${o.id}=<discarded|lost>. Not auto-applied.`,
      });
      // Tag it legacy-aggregate (additive) when reclassifying.
      plan.push({
        table: "opportunities",
        rowKey: o.id,
        field: "tags(+)",
        current: "(unchanged)",
        proposed: `append '${LEGACY_AGGREGATE_TAG}'`,
        classification: "quarantine",
        note: "Tag so the shell is identifiable post-reclassification. Applied only alongside the operator-approved stage move.",
      });
      continue;
    }
    // Any unexpected aggregate opp — flag, never auto-touch.
    plan.push({
      table: "opportunities",
      rowKey: o.id,
      field: "stage",
      current: o.stage,
      proposed: o.stage,
      classification: "flag-only",
      note: "Unexpected aggregate opportunity not in the verified set. Flag for operator; no change proposed.",
    });
  }

  // (iv) Quarantine the blank-bucket activities: isolate per opp with a synthetic
  // email_thread_id. Do NOT split, re-point opp, or delete. Reported per bucket.
  for (const b of input.buckets) {
    if (b.opportunity_id === null) continue; // unowned handled as its own sub-bucket
    plan.push({
      table: "activities",
      rowKey: `bucket:opp=${b.opportunity_id} (${b.count} rows)`,
      field: "email_thread_id",
      current: "'' / NULL (aggregating bucket)",
      proposed: syntheticActivityThreadId(b.opportunity_id),
      classification: "quarantine",
      note: `${b.count} blank email activities owned by opp ${b.opportunity_id}. Stamp per-opp synthetic email_thread_id so the empty-string bucket no longer aggregates across opportunities. NOT split, NOT re-pointed, NOT deleted — left attached to their current opp.`,
    });
  }

  // (v) Unowned-with-message_id activities — SEPARATE quarantine sub-bucket.
  // They carry real provider message_ids => re-ingestion could recover them.
  // Flag only; do not destroy, do not re-point, do not stamp synthetic id.
  for (const a of input.unownedMsg) {
    plan.push({
      table: "activities",
      rowKey: a.id,
      field: "(no change)",
      current: `msg_id=${a.email_message_id ?? "—"}, opp=NULL`,
      proposed: "(preserve as-is — flag for operator)",
      classification: "flag-only",
      note: `Unowned blank activity carrying a REAL provider message_id (${
        a.email_message_id ?? "—"
      }). Re-ingestion could later recover it. Do NOT destroy / re-point / synthetic-stamp. Flag for operator.`,
    });
  }

  return plan;
}

// --------------------------------------------------------------------------
// Apply (gated; never run by the build agent)
// --------------------------------------------------------------------------

async function applyPlan(input: {
  blankThreads: BlankThreadRow[];
  blankJoins: BlankJoinRow[];
  aggregateOpps: AggregateOppRow[];
  buckets: ActivityBucket[];
}): Promise<void> {
  if (!APPLY) return;

  // (i) email_threads quarantine
  assertAllowListed("email_threads");
  for (const t of input.blankThreads) {
    const { error } = await sb
      .from("email_threads")
      .update({
        provider_thread_id: syntheticThreadId(t.id),
        subject: "[QUARANTINED legacy-aggregate]",
      })
      .eq("id", t.id)
      .eq("provider_thread_id", ""); // idempotency guard: only rewrite still-blank rows
    if (error) throw new Error(`email_threads ${t.id}: ${error.message}`);
  }

  // (ii) opportunity_email_threads join rewrite
  assertAllowListed("opportunity_email_threads");
  for (const j of input.blankJoins) {
    const { error } = await sb
      .from("opportunity_email_threads")
      .update({ thread_id: syntheticThreadId(j.id) })
      .eq("id", j.id)
      .eq("thread_id", ""); // idempotency guard
    if (error)
      throw new Error(`opportunity_email_threads ${j.id}: ${error.message}`);
  }

  // (iii) aggregate-opportunity reclassification — ONLY for explicitly approved
  // opps with an approved target stage. Marcia is never touched.
  assertAllowListed("opportunities");
  for (const o of input.aggregateOpps) {
    if (o.id === OPP_MARCIA) continue;
    const approvedStage = AGGREGATE_APPROVALS.get(o.id);
    if (
      !approvedStage ||
      !APPROVED_TARGET_STAGES.has(approvedStage) ||
      !ACTIVE_STAGES.has(o.stage)
    ) {
      continue; // not approved => no change
    }
    const { error } = await sb
      .from("opportunities")
      .update({ stage: approvedStage, stage_manually_set: true })
      .eq("id", o.id)
      .eq("stage", o.stage); // idempotency guard
    if (error) throw new Error(`opportunities ${o.id}: ${error.message}`);
    // additive tag append — merge the row's EXISTING tags (fetched in the
    // SELECT) with the legacy marker, deduped, so prior tags are preserved.
    const nextTags = Array.from(
      new Set([...(o.tags ?? []), LEGACY_AGGREGATE_TAG])
    );
    const { error: tagErr } = await sb
      .from("opportunities")
      .update({ tags: nextTags })
      .eq("id", o.id);
    if (tagErr) throw new Error(`opportunities tags ${o.id}: ${tagErr.message}`);
  }

  // (iv) activities quarantine — per-opp synthetic email_thread_id. Owned blank
  // rows only; never touch the unowned-with-message_id sub-bucket.
  assertAllowListed("activities");
  for (const b of input.buckets) {
    if (b.opportunity_id === null) continue;
    const synthetic = syntheticActivityThreadId(b.opportunity_id);
    const { error } = await sb
      .from("activities")
      .update({ email_thread_id: synthetic })
      .eq("type", "email")
      .eq("opportunity_id", b.opportunity_id)
      .or("email_thread_id.eq.,email_thread_id.is.null");
    if (error)
      throw new Error(`activities bucket ${b.opportunity_id}: ${error.message}`);
  }
}

// --------------------------------------------------------------------------
// Artifact
// --------------------------------------------------------------------------

function hardStopProof(apply: boolean): string {
  return [
    "## Hard-Stop Proof",
    "",
    `- Mode: ${apply ? "apply" : "dry-run (READ-ONLY)"}.`,
    apply ? "- Writes performed: yes (allow-list only)." : "- Writes performed: NO. Zero UPDATE/INSERT/DELETE issued in dry-run.",
    "- Emails sent: no.",
    "- Provider drafts created: no.",
    "- Real provider ids invented: no — synthetic ids are deterministic 'legacy:'||id.",
    "- Buckets auto-merged into a real customer: no.",
    "- Marcia Farquhar opp reclassified/discarded: no (de-linked only via the join rewrite).",
    "- Blank-bucket activities split / opp-re-pointed / deleted: no (quarantine-isolate only).",
    "- Unowned-with-message_id activities touched: no (flag-only — real provider ids preserved for re-ingestion).",
    `- Tables apply could ever write (allow-list): ${TABLE_ALLOW_LIST.join(", ")}.`,
    "- Any table outside that allow-list touched: no.",
    "- Business state in dry-run: untouched.",
  ].join("\n");
}

function renderArtifact(input: {
  blankThreads: BlankThreadRow[];
  blankJoins: BlankJoinRow[];
  aggregateOpps: AggregateOppRow[];
  buckets: ActivityBucket[];
  unownedMsg: UnownedMsgActivity[];
  totals: {
    emptyString: number;
    nullThread: number;
    syntheticTest: number;
    productionTotal: number;
  };
  plan: PlanRow[];
  apply: boolean;
}): string {
  const counts = {
    confident: input.plan.filter((p) => p.classification === "confident-fix")
      .length,
    quarantine: input.plan.filter((p) => p.classification === "quarantine")
      .length,
    flag: input.plan.filter((p) => p.classification === "flag-only").length,
  };

  const lines: string[] = [];
  lines.push(
    `# Lead Lifecycle P1 — Blank-thread Bucket Remediation ${
      input.apply ? "Apply" : "Dry Run"
    }`
  );
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push(`Workstream: DW1-blank-thread-bucket-quarantine`);
  lines.push(`Company: Canpro (${COMPANY_CANPRO}), connection ${CONNECTION}`);
  lines.push(`Mode: ${input.apply ? "apply" : "dry-run (read-only)"}`);
  lines.push("");

  lines.push("## Summary — exact affected-row counts");
  lines.push("");
  lines.push(`- Blank email_threads rows (provider_thread_id=''): ${input.blankThreads.length}`);
  lines.push(`- Blank opportunity_email_threads join rows (thread_id=''): ${input.blankJoins.length}`);
  lines.push(
    `- Blank-bucket email activities: empty-string=${input.totals.emptyString}, NULL=${input.totals.nullThread}, synthetic-test(excluded)=${input.totals.syntheticTest}, production-total=${input.totals.productionTotal}`
  );
  lines.push(`- Aggregate opportunities in scope: ${input.aggregateOpps.length}`);
  lines.push(`- Unowned-with-message_id activities (flag-only sub-bucket): ${input.unownedMsg.length}`);
  lines.push("");
  lines.push(`- Plan rows: confident-fix=${counts.confident}, quarantine=${counts.quarantine}, flag-only=${counts.flag}`);
  lines.push("");

  lines.push("## Apply-mode table allow-list");
  lines.push("");
  lines.push(
    "Apply may ONLY write these tables; every UPDATE is guarded by `assertAllowListed`:"
  );
  lines.push("");
  for (const t of TABLE_ALLOW_LIST) lines.push(`- \`${t}\``);
  lines.push("");

  lines.push(hardStopProof(input.apply));
  lines.push("");

  lines.push("## Verified-live target rows");
  lines.push("");
  lines.push("### Blank email_threads");
  lines.push("");
  lines.push("| id | provider_thread_id | subject | latest_sender | message_count | opportunity_id |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const t of input.blankThreads) {
    lines.push(
      `| ${md(t.id)} | ${md(t.provider_thread_id === "" ? "'' (empty)" : t.provider_thread_id)} | ${md(
        t.subject === "" ? "'' (empty)" : t.subject
      )} | ${md(t.latest_sender_email === "" ? "'' (empty)" : t.latest_sender_email)} | ${md(t.message_count)} | ${md(t.opportunity_id)} |`
    );
  }
  lines.push("");
  lines.push("### Blank opportunity_email_threads joins");
  lines.push("");
  lines.push("| id | thread_id | connection_id | opportunity_id |");
  lines.push("| --- | --- | --- | --- |");
  for (const j of input.blankJoins) {
    lines.push(
      `| ${md(j.id)} | ${md(j.thread_id === "" ? "'' (empty)" : j.thread_id)} | ${md(
        j.connection_id
      )} | ${md(j.opportunity_id)} |`
    );
  }
  lines.push("");
  lines.push("### Aggregate opportunities");
  lines.push("");
  lines.push("| id | title | stage | client_id | correspondence_count | disposition |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const o of input.aggregateOpps) {
    const disposition =
      o.id === OPP_MARCIA
        ? "REAL lead — de-link only, never discard"
        : o.id === OPP_NEW_LEAD_SHELL
          ? "blank shell — reclassify out of active stages ONLY with operator approval"
          : "unexpected — flag only";
    lines.push(
      `| ${md(o.id)} | ${md(o.title)} | ${md(o.stage)} | ${md(o.client_id)} | ${md(
        o.correspondence_count
      )} | ${md(disposition)} |`
    );
  }
  lines.push("");
  lines.push("### Activity buckets (blank-bucket, by owning opp, test fixtures excluded)");
  lines.push("");
  lines.push("| opportunity_id | activity_count |");
  lines.push("| --- | --- |");
  for (const b of input.buckets) {
    lines.push(`| ${md(b.opportunity_id)} | ${md(b.count)} |`);
  }
  lines.push("");
  lines.push("### Unowned-with-message_id activities (flag-only)");
  lines.push("");
  lines.push("| id | email_message_id | subject | created_at |");
  lines.push("| --- | --- | --- | --- |");
  for (const a of input.unownedMsg) {
    lines.push(
      `| ${md(a.id)} | ${md(a.email_message_id)} | ${md(a.subject)} | ${md(a.created_at)} |`
    );
  }
  lines.push("");

  lines.push("## Proposed-change plan (current → proposed + classification)");
  lines.push("");
  lines.push("| table | row | field | current | proposed | class | note |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const p of input.plan) {
    lines.push(
      `| ${md(p.table)} | ${md(p.rowKey)} | ${md(p.field)} | ${md(p.current)} | ${md(
        p.proposed
      )} | ${md(p.classification)} | ${md(p.note)} |`
    );
  }
  lines.push("");

  lines.push("## Apply gate");
  lines.push("");
  lines.push(
    "- `--apply` rewrites blank email_threads + blank join + activity buckets unconditionally (idempotent: guarded to still-blank rows)."
  );
  lines.push(
    "- Aggregate-opportunity stage reclassification fires ONLY when `--approve-aggregate <oppId>=<discarded|lost>` is passed for that opp. Marcia Farquhar is never reclassified."
  );
  lines.push(
    `- This run's parsed approvals: ${
      AGGREGATE_APPROVALS.size === 0
        ? "(none)"
        : Array.from(AGGREGATE_APPROVALS.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
    }`
  );
  lines.push("");

  return lines.join("\n");
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  if (APPLY && DRY_RUN === false) {
    // Apply path retained for the operator; the build agent only ever runs --dry-run.
  }

  const blankThreads = await fetchBlankThreads();
  const blankJoins = await fetchBlankJoins();

  const aggregateOppIds = Array.from(
    new Set(
      [
        ...blankThreads.map((t) => t.opportunity_id),
        ...blankJoins.map((j) => j.opportunity_id),
        OPP_NEW_LEAD_SHELL,
        OPP_MARCIA,
      ].filter((x): x is string => Boolean(x))
    )
  );
  const aggregateOpps = await fetchAggregateOpps(aggregateOppIds);

  const { buckets, totals } = await fetchActivityBuckets();
  const unownedMsg = await fetchUnownedMsgActivities();

  const plan = buildPlan({
    blankThreads,
    blankJoins,
    aggregateOpps,
    buckets,
    unownedMsg,
  });

  if (APPLY) {
    await applyPlan({ blankThreads, blankJoins, aggregateOpps, buckets });
  }

  const markdown = renderArtifact({
    blankThreads,
    blankJoins,
    aggregateOpps,
    buckets,
    unownedMsg,
    totals,
    plan,
    apply: APPLY,
  });

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, markdown);

  console.log(`Artifact write: ${OUTPUT_PATH}`);
  console.log(`Mode: ${APPLY ? "apply" : "dry-run"}`);
  console.log(
    `Counts: blankThreads=${blankThreads.length} blankJoins=${blankJoins.length} buckets=${buckets.length} unownedMsg=${unownedMsg.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
