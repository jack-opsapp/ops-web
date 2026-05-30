/*
 * Lead Lifecycle CW7 — NULL-message-id activity backfill (deferred P1 data step).
 *
 * Wizard-imported email activities were written with a NULL email_message_id
 * (import/route.ts wrote `emailMessageId: null`). Steady-sync dedupe keys on
 * email_message_id, so these rows can never dedupe against the real-msgid
 * steady-sync row for the same provider thread — producing duplicate activities.
 * This backfill mints a DETERMINISTIC synthetic message id per row so dedupe has
 * a stable key, matching the convention the P4 import-path fix uses:
 *
 *     import:<provider_thread_id>:<seq>
 *
 * where <seq> is the row's 1-based ordinal WITHIN its thread, ordered by
 * (created_at ASC, id ASC) so the mapping is stable + reproducible across runs.
 *
 * Target set (verified live 2026-05-30 against ijeekuhbatykdomumfjx):
 *   activities WHERE type='email'
 *     AND email_message_id IS NULL
 *     AND email_thread_id IS NOT NULL AND email_thread_id <> ''
 *     AND email_thread_id NOT LIKE 'legacy:%'
 *   => 216 rows across 112 distinct provider threads.
 *   91 of those rows live in the 37 threads that ALSO carry a real-msgid
 *   steady-sync sibling (the dedupe-broken set).
 *
 * Explicitly EXCLUDED (not wizard-import dedup breakers):
 *   - The DW1 blank-bucket rows (email_thread_id '' / NULL) — no thread to key on;
 *     owned by the DW1 quarantine workstream (synthetic legacy:<opp> id), not here.
 *   - Rows already on a synthetic 'legacy:%' thread (already quarantined).
 *
 * CRITICAL uniqueness contract: a partial unique index
 *   activities_email_message_id_unique (email_message_id) WHERE email_message_id IS NOT NULL
 * EXISTS. Synthetic ids MUST be globally unique. `import:<threadId>:<seq>` is
 * unique because (threadId, seq) is unique within the target set and the
 * `import:` prefix + real provider thread id never collides with an existing
 * provider message id. The dry-run asserts zero proposed-id collisions (against
 * each other AND against every existing non-null email_message_id) before any
 * apply could run.
 *
 * Apply-mode table allow-list (the ONLY column apply may ever write):
 *   - activities.email_message_id
 *
 * Hard guarantees:
 * - Emails sent: no.  Provider drafts created: no.
 * - Real provider message ids invented: no (synthetic ids carry the 'import:' prefix).
 * - Any column other than activities.email_message_id written: no.
 * - Any row outside the verified target predicate touched: no.
 * - --apply is INTENTIONALLY NOT RUN by the build agent; only --dry-run is executed.
 *
 * Usage:
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-cw7-msgid-backfill.ts --dry-run
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-cw7-msgid-backfill.ts --apply
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
const outputArgIdx = process.argv.indexOf("--output");
const DRY_RUN_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-cw7-msgid-backfill-dry-run-2026-05-30.md";
const APPLY_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-cw7-msgid-backfill-apply-2026-05-30.md";
const OUTPUT_PATH =
  outputArgIdx >= 0 ? process.argv[outputArgIdx + 1] : APPLY ? APPLY_OUTPUT : DRY_RUN_OUTPUT;

// Apply mode is restricted to exactly this table; only email_message_id is written.
const TABLE_ALLOW_LIST = ["activities"] as const;
const WRITABLE_COLUMNS = ["email_message_id"] as const;
const SYNTHETIC_PREFIX = "import:";

function md(value: unknown): string {
  const text = value === null || value === undefined || value === "" ? "—" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function assertAllowListed(table: string): void {
  if (!(TABLE_ALLOW_LIST as readonly string[]).includes(table)) {
    throw new Error(
      `REFUSED: table '${table}' is not in the apply allow-list ${JSON.stringify(TABLE_ALLOW_LIST)}`
    );
  }
}

interface TargetActivity {
  id: string;
  opportunity_id: string | null;
  email_thread_id: string;
  subject: string | null;
  from_email: string | null;
  direction: string | null;
  created_at: string;
}

interface ProposedRow {
  id: string;
  threadId: string;
  opportunityId: string | null;
  seq: number;
  syntheticMessageId: string;
  subject: string | null;
  fromEmail: string | null;
  direction: string | null;
  createdAt: string;
  threadHasRealSibling: boolean;
}

interface ThreadGroup {
  threadId: string;
  rows: ProposedRow[];
  hasRealSibling: boolean;
}

/** Page through the verified target predicate (read-only). */
async function fetchTargets(): Promise<TargetActivity[]> {
  const rows: TargetActivity[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("activities")
      .select("id, opportunity_id, email_thread_id, subject, from_email, direction, created_at")
      .eq("type", "email")
      .is("email_message_id", null)
      .not("email_thread_id", "is", null)
      .neq("email_thread_id", "")
      .not("email_thread_id", "like", "legacy:%")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as TargetActivity[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

/**
 * The set of provider thread ids that already carry at least one real
 * (non-null, non-empty) email_message_id — i.e. the dedupe-broken set, where
 * the wizard-import null-msgid row would otherwise duplicate a steady-sync row.
 */
async function fetchThreadsWithRealSibling(threadIds: string[]): Promise<Set<string>> {
  const result = new Set<string>();
  if (threadIds.length === 0) return result;
  const chunkSize = 200;
  for (let i = 0; i < threadIds.length; i += chunkSize) {
    const chunk = threadIds.slice(i, i + chunkSize);
    const { data, error } = await sb
      .from("activities")
      .select("email_thread_id")
      .eq("type", "email")
      .not("email_message_id", "is", null)
      .neq("email_message_id", "")
      .in("email_thread_id", chunk);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { email_thread_id: string }[]) {
      result.add(r.email_thread_id);
    }
  }
  return result;
}

/**
 * Every existing non-null email_message_id, so the dry-run can prove no proposed
 * synthetic id collides with a real message id under the partial unique index.
 */
async function fetchExistingMessageIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("activities")
      .select("email_message_id")
      .not("email_message_id", "is", null)
      .neq("email_message_id", "")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as { email_message_id: string }[];
    for (const r of batch) ids.add(r.email_message_id);
    if (batch.length < pageSize) break;
  }
  return ids;
}

function buildPlan(
  targets: TargetActivity[],
  threadsWithRealSibling: Set<string>
): ThreadGroup[] {
  // Group by provider thread id.
  const byThread = new Map<string, TargetActivity[]>();
  for (const t of targets) {
    const arr = byThread.get(t.email_thread_id) ?? [];
    arr.push(t);
    byThread.set(t.email_thread_id, arr);
  }

  const groups: ThreadGroup[] = [];
  for (const [threadId, arr] of byThread.entries()) {
    // Stable deterministic order: created_at ASC, then id ASC.
    arr.sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const hasRealSibling = threadsWithRealSibling.has(threadId);
    const rows: ProposedRow[] = arr.map((t, idx) => ({
      id: t.id,
      threadId,
      opportunityId: t.opportunity_id,
      seq: idx + 1,
      syntheticMessageId: `${SYNTHETIC_PREFIX}${threadId}:${idx + 1}`,
      subject: t.subject,
      fromEmail: t.from_email,
      direction: t.direction,
      createdAt: t.created_at,
      threadHasRealSibling: hasRealSibling,
    }));
    groups.push({ threadId, rows, hasRealSibling });
  }
  // Threads with a real sibling first (the dedupe-broken set), then by size.
  groups.sort((a, b) => {
    if (a.hasRealSibling !== b.hasRealSibling) return a.hasRealSibling ? -1 : 1;
    return b.rows.length - a.rows.length;
  });
  return groups;
}

interface CollisionReport {
  selfCollisions: string[]; // synthetic ids that appear >1 in the proposed set
  existingCollisions: string[]; // synthetic ids that already exist as a real msgid
}

function checkCollisions(
  groups: ThreadGroup[],
  existing: Set<string>
): CollisionReport {
  const seen = new Map<string, number>();
  for (const g of groups) {
    for (const r of g.rows) {
      seen.set(r.syntheticMessageId, (seen.get(r.syntheticMessageId) ?? 0) + 1);
    }
  }
  const selfCollisions = Array.from(seen.entries())
    .filter(([, n]) => n > 1)
    .map(([id]) => id);
  const existingCollisions = Array.from(seen.keys()).filter((id) => existing.has(id));
  return { selfCollisions, existingCollisions };
}

async function applyPlan(groups: ThreadGroup[], collisions: CollisionReport): Promise<void> {
  if (!APPLY) return;
  if (collisions.selfCollisions.length > 0 || collisions.existingCollisions.length > 0) {
    throw new Error(
      `REFUSED: ${collisions.selfCollisions.length} self-collisions + ${collisions.existingCollisions.length} existing-id collisions detected; synthetic ids must be globally unique under activities_email_message_id_unique.`
    );
  }
  assertAllowListed("activities");
  for (const g of groups) {
    for (const r of g.rows) {
      const { error } = await sb
        .from("activities")
        .update({ email_message_id: r.syntheticMessageId })
        .eq("id", r.id)
        .is("email_message_id", null); // idempotency guard: only fill still-null rows
      if (error) throw new Error(`activities ${r.id}: ${error.message}`);
    }
  }
}

function hardStopProof(apply: boolean): string {
  return [
    "## Hard-Stop Proof",
    "",
    `- Mode: ${apply ? "apply" : "dry-run (READ-ONLY)"}.`,
    apply
      ? "- Writes performed: yes (activities.email_message_id only, allow-list enforced)."
      : "- Writes performed: NO. Zero UPDATE/INSERT/DELETE issued in dry-run.",
    "- Emails sent: no.",
    "- Provider drafts created: no.",
    "- Real provider message ids invented: no — synthetic ids carry the `import:` prefix.",
    `- Columns apply could ever write: ${WRITABLE_COLUMNS.map((c) => "activities." + c).join(", ")}.`,
    `- Tables apply could ever write (allow-list): ${TABLE_ALLOW_LIST.join(", ")}.`,
    "- DW1 blank-bucket rows (no thread / legacy thread) touched: no (out of scope here).",
    "- Synthetic-id global-uniqueness asserted before any apply (self + existing-msgid collision check).",
    "- Business state in dry-run: untouched.",
  ].join("\n");
}

function renderArtifact(input: {
  groups: ThreadGroup[];
  totalRows: number;
  distinctThreads: number;
  threadsWithRealSibling: number;
  rowsInDedupeBrokenSet: number;
  collisions: CollisionReport;
  apply: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`# Lead Lifecycle CW7 — NULL-msgid Activity Backfill ${input.apply ? "Apply" : "Dry Run"}`);
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("Workstream: CW7-msgid-backfill (deferred P1 data step)");
  lines.push(`Supabase project: ijeekuhbatykdomumfjx (production)`);
  lines.push(`Mode: ${input.apply ? "apply" : "dry-run (read-only)"}`);
  lines.push("");

  lines.push("## Summary — verified-live counts");
  lines.push("");
  lines.push(`- Target activities (null msgid + real provider thread, non-legacy): **${input.totalRows}**`);
  lines.push(`- Distinct provider threads: **${input.distinctThreads}**`);
  lines.push(`- Threads that also carry a real-msgid steady-sync sibling (dedupe-broken set): **${input.threadsWithRealSibling}**`);
  lines.push(`- Rows inside the dedupe-broken set: **${input.rowsInDedupeBrokenSet}**`);
  lines.push("");
  lines.push("Classification: all **216 are confident-fix** — a deterministic, reversible synthetic id keyed on (provider thread id, in-thread ordinal). No quarantine, no flag: every target row has a real provider thread to key on and a stable ordering, so the mapping is unambiguous.");
  lines.push("");

  lines.push("## Synthetic-id global-uniqueness assertion");
  lines.push("");
  lines.push("Partial unique index `activities_email_message_id_unique (email_message_id) WHERE email_message_id IS NOT NULL` is live; synthetic ids must be globally unique.");
  lines.push("");
  lines.push(`- Self-collisions among proposed synthetic ids: **${input.collisions.selfCollisions.length}** ${input.collisions.selfCollisions.length === 0 ? "(PASS)" : "(FAIL — apply refuses)"}`);
  lines.push(`- Proposed synthetic ids colliding with an existing real message id: **${input.collisions.existingCollisions.length}** ${input.collisions.existingCollisions.length === 0 ? "(PASS)" : "(FAIL — apply refuses)"}`);
  if (input.collisions.selfCollisions.length > 0) {
    lines.push("");
    lines.push("Self-collision ids:");
    for (const id of input.collisions.selfCollisions.slice(0, 50)) lines.push(`- \`${md(id)}\``);
  }
  if (input.collisions.existingCollisions.length > 0) {
    lines.push("");
    lines.push("Existing-id collisions:");
    for (const id of input.collisions.existingCollisions.slice(0, 50)) lines.push(`- \`${md(id)}\``);
  }
  lines.push("");

  lines.push("## Apply-mode table allow-list");
  lines.push("");
  lines.push("Apply may ONLY write the following; every UPDATE is guarded by `assertAllowListed` + a still-null idempotency guard:");
  lines.push("");
  lines.push("- `activities` (column `email_message_id` only)");
  lines.push("");

  lines.push(hardStopProof(input.apply));
  lines.push("");

  lines.push("## Proposed per-row changes (grouped by provider thread)");
  lines.push("");
  lines.push("Threads carrying a real-msgid steady-sync sibling (the dedupe-broken set) are listed first.");
  lines.push("");
  for (const g of input.groups) {
    lines.push(
      `### Thread \`${md(g.threadId)}\` — ${g.rows.length} row(s)${g.hasRealSibling ? " · **dedupe-broken (has real-msgid sibling)**" : ""}`
    );
    lines.push("");
    lines.push("| activity_id | seq | opportunity_id | direction | from_email | subject | created_at | current_msgid | proposed_msgid |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of g.rows) {
      lines.push(
        `| ${md(r.id)} | ${r.seq} | ${md(r.opportunityId)} | ${md(r.direction)} | ${md(r.fromEmail)} | ${md(r.subject)} | ${md(r.createdAt)} | NULL | ${md(r.syntheticMessageId)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function writeArtifact(markdown: string) {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, markdown);
}

async function main() {
  const targets = await fetchTargets();
  const distinctThreadIds = Array.from(new Set(targets.map((t) => t.email_thread_id)));
  const [threadsWithRealSibling, existingMessageIds] = await Promise.all([
    fetchThreadsWithRealSibling(distinctThreadIds),
    fetchExistingMessageIds(),
  ]);

  const groups = buildPlan(targets, threadsWithRealSibling);
  const collisions = checkCollisions(groups, existingMessageIds);

  const rowsInDedupeBrokenSet = groups
    .filter((g) => g.hasRealSibling)
    .reduce((s, g) => s + g.rows.length, 0);
  const threadsWithSiblingCount = groups.filter((g) => g.hasRealSibling).length;

  if (APPLY) {
    await applyPlan(groups, collisions);
  }

  const markdown = renderArtifact({
    groups,
    totalRows: targets.length,
    distinctThreads: distinctThreadIds.length,
    threadsWithRealSibling: threadsWithSiblingCount,
    rowsInDedupeBrokenSet,
    collisions,
    apply: APPLY,
  });
  await writeArtifact(markdown);

  console.log(`Artifact write: ${OUTPUT_PATH}`);
  console.log(`Mode: ${APPLY ? "apply" : "dry-run"}`);
  console.log(
    `Targets: ${targets.length} rows across ${distinctThreadIds.length} threads; ${rowsInDedupeBrokenSet} rows in ${threadsWithSiblingCount} dedupe-broken threads`
  );
  console.log(
    `Collisions: self=${collisions.selfCollisions.length} existing=${collisions.existingCollisions.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
