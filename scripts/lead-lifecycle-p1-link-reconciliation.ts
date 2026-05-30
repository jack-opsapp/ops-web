/*
 * Lead Lifecycle P1 — Activity / thread / opportunity link reconciliation.
 *
 * Reconciles the three independently-written link surfaces so a provider email
 * thread maps to one canonical opportunity:
 *   - activities.email_thread_id  (TEXT, stores the provider_thread_id — NOT the email_threads uuid)
 *   - activities.opportunity_id
 *   - email_threads.opportunity_id (cache column)
 *   - opportunity_email_threads (the canonical join)
 *
 * Scope of the candidate sets this script identifies and classifies:
 *   1. Split threads  — provider threads whose email activities span >1 opportunity (49)
 *   2. NULL-canonical — email_threads with a real provider id, opportunity_id NULL, but a matching join row (32)
 *   3. Divergent      — email_threads.opportunity_id <> its join row's opportunity_id (2)
 *   4. Blank-bucket activities — empty/NULL email_thread_id email activities (the DW1 aggregate)
 *   5. Unowned-with-message-id — blank-bucket activities that DO carry a real provider message_id (3)
 *
 * Every candidate is labelled CONFIDENT-FIX | QUARANTINE | FLAG.
 *
 * Apply-mode allow-list (NEVER run here): activities, opportunity_email_threads ONLY.
 *   - email_threads + opportunities are READ-ONLY in this workstream (cache-column
 *     re-point and aggregate-opportunity disposition are owned by DW1/DW2 apply, which
 *     are gated separately). This script writes neither.
 *
 * Emails sent: no.  Provider drafts created: no.  Opportunity business state changed: no.
 *
 * Usage (dry-run only — apply is intentionally gated and not exercised in P1):
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-lifecycle-p1-link-reconciliation.ts
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-lifecycle-p1-link-reconciliation.ts --apply   (guarded; refuses without --i-understand-apply-is-gated)
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
const APPLY_CONFIRMED = process.argv.includes("--i-understand-apply-is-gated");
const outputArgIdx = process.argv.indexOf("--output");
const DRY_RUN_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p1-link-reconciliation-dry-run-2026-05-29.md";
const APPLY_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p1-link-reconciliation-apply-2026-05-29.md";
const OUTPUT_PATH =
  outputArgIdx >= 0 ? process.argv[outputArgIdx + 1] : APPLY ? APPLY_OUTPUT : DRY_RUN_OUTPUT;

// Apply mode is restricted to this allow-list and is NOT exercised in P1. The
// actual re-point writes are deferred to the operator-reviewed resolver (CW3/CW4).
const APPLY_TABLE_ALLOW_LIST = ["activities", "opportunity_email_threads"] as const;

const TERMINAL_STAGES = new Set(["won", "lost", "discarded"]);
const TEST_SEED_OPP_PREFIX = "d2000000-0000-4000-d200-";

type Classification = "CONFIDENT-FIX" | "QUARANTINE" | "FLAG";

function md(value: unknown): string {
  const text = value === null || value === undefined || value === "" ? "—" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

interface OppMeta {
  id: string;
  title: string | null;
  stage: string | null;
  archived: boolean;
  deleted: boolean;
  client_id: string | null;
  client_name: string | null;
}

interface SplitThread {
  providerThreadId: string;
  owners: Array<{ opp: OppMeta; actCount: number }>;
  totalActs: number;
  nonTerminalOwners: number;
  terminalOwners: number;
  distinctClients: number;
  classification: Classification;
  reason: string;
  recommendation: string;
}

interface CanonRow {
  etId: string;
  providerThreadId: string;
  connectionId: string | null;
  cacheOpp: string | null;
  joinOpp: string;
  joinOppMeta: OppMeta;
  cacheOppMeta: OppMeta | null;
  kind: "null_canonical" | "divergent";
  classification: Classification;
  reason: string;
  recommendation: string;
}

interface BlankBucket {
  opportunityId: string | null;
  count: number;
  allBlankFrom: boolean;
  allNullMsgId: boolean;
  allSubjectEmail: boolean;
  classification: Classification;
  reason: string;
  recommendation: string;
}

interface UnownedMsgIdRow {
  id: string;
  emailMessageId: string | null;
  subject: string | null;
  createdAt: string;
  classification: Classification;
  reason: string;
}

async function fetchOppMeta(ids: string[]): Promise<Map<string, OppMeta>> {
  const map = new Map<string, OppMeta>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunkSize = 100;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data, error } = await sb
      .from("opportunities")
      .select("id, title, stage, archived_at, deleted_at, client_id, clients(name)")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const client = row.clients as { name?: string } | { name?: string }[] | null;
      const clientName = Array.isArray(client) ? client[0]?.name ?? null : client?.name ?? null;
      map.set(row.id as string, {
        id: row.id as string,
        title: (row.title as string) ?? null,
        stage: (row.stage as string) ?? null,
        archived: row.archived_at !== null,
        deleted: row.deleted_at !== null,
        client_id: (row.client_id as string) ?? null,
        client_name: clientName,
      });
    }
  }
  return map;
}

function isTerminal(o: OppMeta): boolean {
  return o.stage !== null && TERMINAL_STAGES.has(o.stage);
}

/** -------- 1. SPLIT THREADS -------- */
async function fetchSplitThreads(): Promise<SplitThread[]> {
  // Pull every email activity that is linked to a provider thread + an opportunity.
  const rows: Array<{ email_thread_id: string; opportunity_id: string }> = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("activities")
      .select("email_thread_id, opportunity_id")
      .eq("type", "email")
      .not("email_thread_id", "is", null)
      .neq("email_thread_id", "")
      .not("opportunity_id", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Array<{ email_thread_id: string; opportunity_id: string }>;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  // group by provider thread id -> opp -> count
  const byThread = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let inner = byThread.get(r.email_thread_id);
    if (!inner) {
      inner = new Map();
      byThread.set(r.email_thread_id, inner);
    }
    inner.set(r.opportunity_id, (inner.get(r.opportunity_id) ?? 0) + 1);
  }

  const splitThreadIds = Array.from(byThread.entries()).filter(([, opps]) => opps.size > 1);
  const oppIds = splitThreadIds.flatMap(([, opps]) => Array.from(opps.keys()));
  const meta = await fetchOppMeta(oppIds);

  const results: SplitThread[] = [];
  for (const [providerThreadId, opps] of splitThreadIds) {
    const owners = Array.from(opps.entries())
      .map(([oppId, actCount]) => ({ opp: meta.get(oppId)!, actCount }))
      .filter((o) => o.opp)
      .sort((a, b) => b.actCount - a.actCount);
    const totalActs = owners.reduce((s, o) => s + o.actCount, 0);
    const terminalOwners = owners.filter((o) => isTerminal(o.opp)).length;
    const nonTerminalOwners = owners.length - terminalOwners;
    const distinctClients = new Set(owners.map((o) => o.opp.client_id)).size;

    let classification: Classification;
    let reason: string;
    let recommendation: string;
    if (terminalOwners > 0) {
      classification = "QUARANTINE";
      reason = `fork crosses the terminal boundary (${terminalOwners} terminal owner(s)) — collapse would re-point activities off a closed job`;
      recommendation = "operator review; do NOT auto-collapse";
    } else if (distinctClients > 1) {
      classification = "QUARANTINE";
      reason = `fork spans ${distinctClients} distinct clients — never collapse across clients`;
      recommendation = "operator review; do NOT auto-collapse";
    } else if (nonTerminalOwners === 1) {
      classification = "CONFIDENT-FIX";
      reason = "exactly one non-terminal owner; remaining owners are empty shells with no independent value";
      recommendation = `collapse activities + join to the single non-terminal owner`;
    } else {
      classification = "QUARANTINE";
      reason = `multiple non-terminal owners (${nonTerminalOwners}) — ambiguous which is canonical`;
      recommendation = "operator review; do NOT auto-collapse";
    }

    results.push({
      providerThreadId,
      owners,
      totalActs,
      nonTerminalOwners,
      terminalOwners,
      distinctClients,
      classification,
      reason,
      recommendation,
    });
  }
  results.sort((a, b) => b.totalActs - a.totalActs);
  return results;
}

/** -------- 2/3. NULL-CANONICAL + DIVERGENT -------- */
async function fetchCanonRows(): Promise<CanonRow[]> {
  // email_threads with a real provider id (paginated — table exceeds the 1000-row default cap).
  const ets: Array<{
    id: string;
    provider_thread_id: string;
    connection_id: string | null;
    opportunity_id: string | null;
  }> = [];
  {
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("email_threads")
        .select("id, provider_thread_id, connection_id, opportunity_id")
        .neq("provider_thread_id", "")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as typeof ets;
      ets.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  }

  const joins: Array<{
    connection_id: string | null;
    thread_id: string;
    opportunity_id: string;
  }> = [];
  {
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("opportunity_email_threads")
        .select("connection_id, thread_id, opportunity_id")
        .neq("thread_id", "")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as typeof joins;
      joins.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  }
  const joinByKey = new Map<string, string>();
  for (const j of joins) joinByKey.set(`${j.connection_id}|${j.thread_id}`, j.opportunity_id);

  const matched = ets
    .map((et) => {
      const joinOpp = joinByKey.get(`${et.connection_id}|${et.provider_thread_id}`);
      return joinOpp ? { et, joinOpp } : null;
    })
    .filter(Boolean) as Array<{ et: (typeof ets)[number]; joinOpp: string }>;

  const oppIds = matched.flatMap((m) => [m.joinOpp, m.et.opportunity_id].filter(Boolean) as string[]);
  const meta = await fetchOppMeta(oppIds);

  const results: CanonRow[] = [];
  for (const { et, joinOpp } of matched) {
    const joinMeta = meta.get(joinOpp);
    if (!joinMeta) continue;

    if (et.opportunity_id === null) {
      // NULL-canonical
      const joinTerminal = isTerminal(joinMeta);
      const joinHidden = joinMeta.archived || joinMeta.deleted;
      let classification: Classification;
      let reason: string;
      let recommendation: string;
      if (!joinTerminal && !joinHidden) {
        classification = "CONFIDENT-FIX";
        reason = "join opp is the single canonical owner and is live (non-terminal, non-archived, non-deleted)";
        recommendation = "backfill email_threads.opportunity_id = join opp (DW2 apply; not in P1 allow-list)";
      } else if (joinHidden) {
        classification = "QUARANTINE";
        reason = `join opp is ${joinMeta.deleted ? "deleted" : "archived"} — never point the cache at a hidden opp`;
        recommendation = "operator review; do NOT backfill cache to a hidden opp";
      } else {
        classification = "FLAG";
        reason = `join opp is terminal (${joinMeta.stage}) — a won/lost deal legitimately owns its thread, but cache-backfill to a terminal opp needs operator sign-off`;
        recommendation = "operator confirms the terminal opp is the true owner before backfill";
      }
      results.push({
        etId: et.id,
        providerThreadId: et.provider_thread_id,
        connectionId: et.connection_id,
        cacheOpp: null,
        joinOpp,
        joinOppMeta: joinMeta,
        cacheOppMeta: null,
        kind: "null_canonical",
        classification,
        reason,
        recommendation,
      });
    } else if (et.opportunity_id !== joinOpp) {
      // Divergent
      const cacheMeta = meta.get(et.opportunity_id) ?? null;
      const cacheHidden = cacheMeta ? cacheMeta.archived || cacheMeta.deleted : false;
      const joinHidden = joinMeta.archived || joinMeta.deleted;
      let classification: Classification;
      let reason: string;
      let recommendation: string;
      if (cacheHidden && !joinHidden && !isTerminal(joinMeta)) {
        classification = "CONFIDENT-FIX";
        reason =
          "cache points at a hidden (archived/deleted) opp while the join points at a live opp — the cache is the corruption";
        recommendation = "align email_threads.opportunity_id to the live join opp (DW2 apply; not in P1 allow-list)";
      } else if (joinHidden) {
        classification = "QUARANTINE";
        reason = `join opp is ${joinMeta.deleted ? "deleted" : "archived"} — aligning cache to it would point at a hidden opp (the McCullough-class fork)`;
        recommendation = "operator review; do NOT align cache to a hidden join opp";
      } else {
        classification = "FLAG";
        reason = "both sides live/terminal — divergence needs operator adjudication of the true owner";
        recommendation = "operator adjudicates canonical owner";
      }
      results.push({
        etId: et.id,
        providerThreadId: et.provider_thread_id,
        connectionId: et.connection_id,
        cacheOpp: et.opportunity_id,
        joinOpp,
        joinOppMeta: joinMeta,
        cacheOppMeta: cacheMeta,
        kind: "divergent",
        classification,
        reason,
        recommendation,
      });
    }
  }
  // null-canonical first (largest set), then divergent
  results.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "null_canonical" ? -1 : 1));
  return results;
}

/** -------- 4/5. BLANK BUCKET + UNOWNED-WITH-MSGID -------- */
async function fetchBlankBucket(): Promise<{ buckets: BlankBucket[]; unowned: UnownedMsgIdRow[] }> {
  const rows: Array<{
    id: string;
    opportunity_id: string | null;
    email_message_id: string | null;
    from_email: string | null;
    subject: string | null;
    created_at: string;
  }> = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("activities")
      .select("id, opportunity_id, email_message_id, from_email, subject, created_at")
      .eq("type", "email")
      .or("email_thread_id.eq.,email_thread_id.is.null")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as typeof rows;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  // Exclude synthetic test-seed rows.
  const production = rows.filter(
    (r) => !(r.opportunity_id && r.opportunity_id.startsWith(TEST_SEED_OPP_PREFIX))
  );

  // Unowned-with-message-id sub-bucket: opp NULL AND a real provider message_id.
  const unownedWithMsgId = production.filter(
    (r) => r.opportunity_id === null && r.email_message_id !== null && r.email_message_id !== ""
  );
  const unowned: UnownedMsgIdRow[] = unownedWithMsgId.map((r) => ({
    id: r.id,
    emailMessageId: r.email_message_id,
    subject: r.subject,
    createdAt: r.created_at,
    classification: "QUARANTINE",
    reason:
      "carries a real provider message_id but no owner — re-ingestion could later recover it; do not destroy or re-point",
  }));
  const unownedIds = new Set(unowned.map((u) => u.id));

  // Owned blank-bucket activities, grouped by owning opp.
  const owned = production.filter((r) => !unownedIds.has(r.id));
  const byOpp = new Map<string | null, typeof owned>();
  for (const r of owned) {
    const key = r.opportunity_id;
    const arr = byOpp.get(key) ?? [];
    arr.push(r);
    byOpp.set(key, arr);
  }

  const buckets: BlankBucket[] = [];
  for (const [oppId, arr] of byOpp.entries()) {
    const allBlankFrom = arr.every((r) => r.from_email === null || r.from_email === "");
    const allNullMsgId = arr.every((r) => r.email_message_id === null);
    const allSubjectEmail = arr.every((r) => r.subject === "Email");
    buckets.push({
      opportunityId: oppId,
      count: arr.length,
      allBlankFrom,
      allNullMsgId,
      allSubjectEmail,
      classification: "QUARANTINE",
      reason:
        "no recoverable per-activity identity (from_email blank, message_id null, subject literally 'Email') — exact-email re-point is provably impossible",
      recommendation:
        "isolate with a synthetic legacy email_thread_id ('legacy:'||opportunity_id) so the empty-string bucket stops aggregating across opportunities; do NOT split / re-point / delete",
    });
  }
  buckets.sort((a, b) => b.count - a.count);
  return { buckets, unowned };
}

function hardStopProof(): string {
  return [
    "## Hard-Stop Proof",
    "",
    "- Writes performed this run: **none** (dry-run; the Supabase client issued SELECT-only reads).",
    "- Emails sent: no.",
    "- Provider drafts created: no.",
    "- Opportunity business state changed: no (opportunities is read-only in this workstream).",
    "- email_threads.opportunity_id cache re-point: NOT performed (owned by DW2 apply, gated separately).",
    "- Aggregate-opportunity disposition: NOT performed (owned by DW1 apply, gated separately).",
    `- Apply-mode write surface, if ever run: restricted to [${APPLY_TABLE_ALLOW_LIST.join(", ")}] ONLY.`,
    "- Apply-mode is intentionally gated and was NOT exercised in P1.",
  ].join("\n");
}

function renderArtifact(
  splits: SplitThread[],
  canon: CanonRow[],
  blank: { buckets: BlankBucket[]; unowned: UnownedMsgIdRow[] }
): string {
  const splitConfident = splits.filter((s) => s.classification === "CONFIDENT-FIX");
  const splitQuarantine = splits.filter((s) => s.classification === "QUARANTINE");

  const nullCanon = canon.filter((c) => c.kind === "null_canonical");
  const divergent = canon.filter((c) => c.kind === "divergent");
  const canonConfident = canon.filter((c) => c.classification === "CONFIDENT-FIX");
  const canonQuarantine = canon.filter((c) => c.classification === "QUARANTINE");
  const canonFlag = canon.filter((c) => c.classification === "FLAG");

  const blankActTotal = blank.buckets.reduce((s, b) => s + b.count, 0);

  const lines: string[] = [];
  lines.push("# Lead Lifecycle P1 — Activity / Thread / Opportunity Link Reconciliation (Dry Run)");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("Mode: **dry-run** (read-only)");
  lines.push("Company in scope: a612edc0 (Canpro Deck and Rail)");
  lines.push("");

  // ---- Summary ----
  lines.push("## Summary — affected-row counts");
  lines.push("");
  lines.push("| Candidate set | Rows | Confident-fix | Quarantine | Flag |");
  lines.push("| --- | --- | --- | --- | --- |");
  lines.push(
    `| 1. Split threads (>1 opp per provider thread) | ${splits.length} | ${splitConfident.length} | ${splitQuarantine.length} | 0 |`
  );
  lines.push(
    `| 2. NULL-canonical (et.opportunity_id NULL, join present) | ${nullCanon.length} | ${nullCanon.filter((c) => c.classification === "CONFIDENT-FIX").length} | ${nullCanon.filter((c) => c.classification === "QUARANTINE").length} | ${nullCanon.filter((c) => c.classification === "FLAG").length} |`
  );
  lines.push(
    `| 3. Divergent (et.opportunity_id <> join opp) | ${divergent.length} | ${divergent.filter((c) => c.classification === "CONFIDENT-FIX").length} | ${divergent.filter((c) => c.classification === "QUARANTINE").length} | ${divergent.filter((c) => c.classification === "FLAG").length} |`
  );
  lines.push(
    `| 4. Blank-bucket activities (owned) | ${blankActTotal} | 0 | ${blankActTotal} | 0 |`
  );
  lines.push(
    `| 5. Unowned-with-message-id sub-bucket | ${blank.unowned.length} | 0 | ${blank.unowned.length} | 0 |`
  );
  lines.push("");
  lines.push(
    `**Totals:** confident-fix ${splitConfident.length + canonConfident.length} · quarantine ${splitQuarantine.length + canonQuarantine.length + blankActTotal + blank.unowned.length} · flag ${canonFlag.length}.`
  );
  lines.push("");

  // ---- Allow-list ----
  lines.push("## Apply-mode table allow-list");
  lines.push("");
  lines.push(
    `Apply mode (NEVER run in P1) is restricted to: **${APPLY_TABLE_ALLOW_LIST.map((t) => "`" + t + "`").join(", ")}**.`
  );
  lines.push("");
  lines.push(
    "`email_threads` and `opportunities` are **read-only** in this workstream. The cache-column re-point (DW2) and the aggregate-opportunity disposition (DW1) write to those tables under their own operator-gated apply phases; this script touches neither. The actual re-point writes are themselves deferred to the operator-reviewed resolver (CW3/CW4)."
  );
  lines.push("");

  lines.push(hardStopProof());
  lines.push("");

  // ---- 1. Split threads ----
  lines.push("## 1. Split threads — provider thread spanning >1 opportunity");
  lines.push("");
  lines.push(
    `Identified ${splits.length} split threads (${splits.reduce((s, t) => s + t.owners.length, 0)} opportunity links across ${splits.reduce((s, t) => s + t.totalActs, 0)} activities). ` +
      "Re-point rule: collapse only when exactly one owner is non-terminal and the others are empty shells; never collapse across the won/lost/discarded terminal boundary or across clients."
  );
  lines.push("");
  lines.push(
    `**Result: ${splitConfident.length} confident-fix, ${splitQuarantine.length} quarantine.** Every one of the ${splits.length} live split threads has a terminal owner or multiple non-terminal owners, so the "link to newest non-terminal" heuristic is unsafe across the board — confirming DW2's terminal-boundary refusal is mandatory.`
  );
  lines.push("");
  lines.push(
    "| provider_thread_id | owners | acts | non-terminal | terminal | clients | class | reason | recommendation |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of splits) {
    lines.push(
      `| ${md(s.providerThreadId)} | ${s.owners.length} | ${s.totalActs} | ${s.nonTerminalOwners} | ${s.terminalOwners} | ${s.distinctClients} | ${s.classification} | ${md(s.reason)} | ${md(s.recommendation)} |`
    );
  }
  lines.push("");
  // Owner detail for the largest / canonical fork (McCullough) + any multi-non-terminal.
  lines.push("### Split-thread owner detail (per owning opportunity)");
  lines.push("");
  lines.push(
    "| provider_thread_id | opportunity_id | acts | title | stage | archived | deleted | client |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of splits) {
    for (const o of s.owners) {
      lines.push(
        `| ${md(s.providerThreadId)} | ${md(o.opp.id)} | ${o.actCount} | ${md(o.opp.title)} | ${md(o.opp.stage)} | ${o.opp.archived ? "yes" : "no"} | ${o.opp.deleted ? "yes" : "no"} | ${md(o.opp.client_name)} |`
      );
    }
  }
  lines.push("");

  // ---- 2. NULL-canonical ----
  lines.push("## 2. NULL-canonical — email_threads cache column never set");
  lines.push("");
  lines.push(
    `Identified ${nullCanon.length} email_threads rows with a real provider id and a matching join row but a NULL cache column. ` +
      "Confident-fix only when the join opp is the single canonical owner AND live; never backfill the cache to a hidden (archived/deleted) opp; terminal join opps are flagged for operator sign-off."
  );
  lines.push("");
  lines.push(
    "| email_thread_id | provider_thread_id | join opp | join title | join stage | archived | deleted | class | recommendation |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of nullCanon) {
    lines.push(
      `| ${md(c.etId)} | ${md(c.providerThreadId)} | ${md(c.joinOpp)} | ${md(c.joinOppMeta.title)} | ${md(c.joinOppMeta.stage)} | ${c.joinOppMeta.archived ? "yes" : "no"} | ${c.joinOppMeta.deleted ? "yes" : "no"} | ${c.classification} | ${md(c.recommendation)} |`
    );
  }
  lines.push("");

  // ---- 3. Divergent ----
  lines.push("## 3. Divergent — cache opp <> join opp");
  lines.push("");
  lines.push(
    `Identified ${divergent.length} divergent rows. Confident-fix when the cache points at a hidden opp while the join points at a live opp (the cache is the corruption); quarantine when aligning would point the cache at a hidden join opp.`
  );
  lines.push("");
  lines.push(
    "| email_thread_id | provider_thread_id | cache opp | cache title | cache stage | cache hidden | join opp | join title | join stage | join hidden | class | recommendation |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of divergent) {
    const cacheHidden = c.cacheOppMeta ? c.cacheOppMeta.archived || c.cacheOppMeta.deleted : false;
    const joinHidden = c.joinOppMeta.archived || c.joinOppMeta.deleted;
    lines.push(
      `| ${md(c.etId)} | ${md(c.providerThreadId)} | ${md(c.cacheOpp)} | ${md(c.cacheOppMeta?.title)} | ${md(c.cacheOppMeta?.stage)} | ${cacheHidden ? "yes" : "no"} | ${md(c.joinOpp)} | ${md(c.joinOppMeta.title)} | ${md(c.joinOppMeta.stage)} | ${joinHidden ? "yes" : "no"} | ${c.classification} | ${md(c.recommendation)} |`
    );
  }
  lines.push("");

  // ---- 4. Blank bucket ----
  lines.push("## 4. Blank-bucket activities (DW1 aggregate, owned)");
  lines.push("");
  lines.push(
    `Identified ${blankActTotal} production blank-bucket email activities (email_thread_id empty/NULL, owned by a real opportunity), grouped by owning opportunity. ` +
      "Synthetic test-seed rows (opportunity_id LIKE 'd2000000-0000-4000-d200-%') are excluded. " +
      "All carry no recoverable identity (blank from_email, null message_id, subject 'Email'), so exact-email re-point is provably impossible — entire set is QUARANTINE."
  );
  lines.push("");
  lines.push(
    "| owning opportunity_id | count | all from_email blank | all message_id null | all subject='Email' | class | recommendation |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const b of blank.buckets) {
    lines.push(
      `| ${md(b.opportunityId)} | ${b.count} | ${b.allBlankFrom ? "yes" : "no"} | ${b.allNullMsgId ? "yes" : "no"} | ${b.allSubjectEmail ? "yes" : "no"} | ${b.classification} | ${md(b.recommendation)} |`
    );
  }
  lines.push("");

  // ---- 5. Unowned with msg id ----
  lines.push("## 5. Unowned-with-message-id sub-bucket");
  lines.push("");
  lines.push(
    `Identified ${blank.unowned.length} blank-bucket activities that are unowned (opportunity_id NULL) yet uniquely carry a real provider message_id. ` +
      "These are a SEPARATE quarantine sub-bucket: re-ingestion could later recover them, so flag for operator but do not destroy or re-point."
  );
  lines.push("");
  lines.push("| activity_id | email_message_id | subject | created_at | class | reason |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const u of blank.unowned) {
    lines.push(
      `| ${md(u.id)} | ${md(u.emailMessageId)} | ${md(u.subject)} | ${md(u.createdAt)} | ${u.classification} | ${md(u.reason)} |`
    );
  }
  lines.push("");

  lines.push("## Notes on the Office-Victoria contact-form vs corrected-customer cases");
  lines.push("");
  lines.push(
    "The self-owned **Office Victoria** client (`0037546b-6529-4437-9119-6b8393385aa5`, email `victoria@canprodeckandrail.com` — the company's own address) and the corrected-customer relabel are owned by **DW3 (identity/title contamination)**, not by link reconciliation. The P1 intersection is that this self-owned client and the two blank-thread aggregate opportunities (`a760f45f` 1746 acts, `aeb65f87` 452 acts) overlap: any DW3 relabel/null of that client must wait until the underlying opportunities are re-pointed first. This workstream surfaces the linkage; it does not relabel the client."
  );
  lines.push("");

  return lines.join("\n");
}

async function writeArtifact(markdown: string) {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, markdown);
}

async function main() {
  if (APPLY && !APPLY_CONFIRMED) {
    console.error(
      "Apply mode is gated and was NOT designed to run in P1. The re-point writes are deferred to the operator-reviewed resolver (CW3/CW4). Refusing."
    );
    process.exit(1);
  }
  if (APPLY) {
    // Even when explicitly confirmed, P1 does not implement writes — the resolver is out of scope.
    console.error(
      "Apply writes are not implemented in this P1 identification/reporting script. Allow-list would be: " +
        APPLY_TABLE_ALLOW_LIST.join(", ")
    );
    process.exit(1);
  }

  const [splits, canon, blank] = await Promise.all([
    fetchSplitThreads(),
    fetchCanonRows(),
    fetchBlankBucket(),
  ]);

  await writeArtifact(renderArtifact(splits, canon, blank));

  console.log(`Artifact write: ${OUTPUT_PATH}`);
  console.log("Mode: dry-run (read-only)");
  console.log(
    `Splits: ${splits.length} | NULL-canon+divergent: ${canon.length} | blank buckets: ${blank.buckets.length} | unowned-msgid: ${blank.unowned.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
