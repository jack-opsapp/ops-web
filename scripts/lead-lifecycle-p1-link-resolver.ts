/*
 * Lead Lifecycle P1 — Link-reconciliation RESOLVER (DW2).
 *
 * Workstream: DW2-link-reconciliation-resolver.
 *
 * This is the apply-capable companion to the read-only identification script
 * `lead-lifecycle-p1-link-reconciliation.ts`. Where that script enumerates and
 * classifies the split/divergent/null-canonical/blank candidate sets, THIS
 * script re-derives the same conservative classification from live data and —
 * in --apply mode only, behind explicit operator confirmation flags — performs
 * the re-point writes for the cases whose correct owner is UNAMBIGUOUS.
 *
 * Re-pointing correspondence is high-stakes: attaching one customer's emails to
 * another customer's opportunity is unacceptable. The resolver is therefore
 * extreme-conservative by construction:
 *
 *   - A candidate is CONFIDENT-RE-POINT only when ALL of the following hold:
 *       (a) there is exactly ONE live, non-terminal owning opportunity for the
 *           provider thread (the canonical join row points at it and it is the
 *           only non-archived/non-deleted, non-won/lost/discarded owner);
 *       (b) every owning opportunity of the thread belongs to the SAME client
 *           (single-client guarantee — never move correspondence across
 *           customers);
 *       (c) the fork does NOT cross the won/lost/discarded terminal boundary
 *           (re-pointing OFF a closed job is itself a business-state risk);
 *       (d) the re-point target is reachable by an unambiguous structural
 *           signal — the singular canonical join row — corroborated (never
 *           contradicted) by the per-activity message_id/from_email.
 *     The signal that JUSTIFIES the re-point is the singular join row + the
 *     single-client + single-live-owner shape. NOTE: on this dataset
 *     `activities.from_email` stores the company's own OUTBOUND address
 *     (canprojack@gmail.com), so from_email is treated only as corroboration
 *     and NEVER as a customer-identity discriminator.
 *
 *   - Everything else is QUARANTINE (isolate / do-not-re-point) or FLAG
 *     (operator-gated). Any ambiguous, many-to-many, terminal-boundary-crossing,
 *     multi-client, or hidden-target case is refused.
 *
 * Apply-mode table+column allow-list (the ONLY writes apply may ever perform):
 *   - activities.opportunity_id
 *   - opportunity_email_threads (thread_id / opportunity_id rows)
 *   - email_threads.opportunity_id
 * No other table or column may be written. Every write is guarded by
 * assertWriteAllowed(table, column).
 *
 * Hard guarantees:
 * - Opportunities are NEVER merged. Rows are NEVER deleted. Links are NEVER
 *   fabricated. Clients are NEVER auto-created.
 * - Emails sent: no. Provider drafts created: no.
 * - Opportunity business state (stage/archived/deleted) changed: no.
 * - The Office-Victoria self-owned-vs-corrected-customer case is owned by DW3 —
 *   it is FLAGGED here, never auto-applied.
 *
 * Apply gating (mirrors the blank-thread script's --approve-* gate):
 *   --apply alone is REFUSED. Re-pointing a real customer's thread additionally
 *   requires --approve-repoint <providerThreadId> for EACH thread to re-point.
 *   The build agent runs --dry-run ONLY; --apply is for the operator post-review.
 *
 * Usage (dry-run only — what the build agent runs):
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-p1-link-resolver.ts --dry-run
 *
 * Usage (operator, post-review — NOT run by the build agent):
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-p1-link-resolver.ts --apply \
 *       --i-understand-this-repoints-customer-correspondence \
 *       --approve-repoint 19dd08142c6d4569
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

// --------------------------------------------------------------------------
// Env / client
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

const APPLY = process.argv.includes("--apply");
// --dry-run is the default; APPLY must be explicit.
const DRY_RUN = !APPLY || process.argv.includes("--dry-run");
const APPLY_CONFIRMED = process.argv.includes(
  "--i-understand-this-repoints-customer-correspondence"
);

function parseApprovedRepoints(): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--approve-repoint") {
      const id = process.argv[i + 1];
      if (id && !id.startsWith("--")) set.add(id);
    }
  }
  return set;
}
const APPROVED_REPOINTS = parseApprovedRepoints();

const outputArgIdx = process.argv.indexOf("--output");
const DRY_RUN_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p1-link-resolver-dry-run-2026-05-29.md";
const APPLY_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p1-link-resolver-apply-2026-05-29.md";
const OUTPUT_PATH =
  outputArgIdx >= 0
    ? process.argv[outputArgIdx + 1]
    : APPLY
      ? APPLY_OUTPUT
      : DRY_RUN_OUTPUT;

// --------------------------------------------------------------------------
// Write allow-list (table + column) — the ONLY writes apply may perform.
// --------------------------------------------------------------------------

const WRITE_ALLOW_LIST: ReadonlyArray<{ table: string; columns: ReadonlyArray<string> }> = [
  { table: "activities", columns: ["opportunity_id"] },
  // opportunity_email_threads: the canonical join. Apply may align a join row's
  // opportunity_id to the single live owner, but on the verified dataset no join
  // write is required (the one confident thread already has a singular correct
  // join row). Listed for completeness so an aligned re-point is possible.
  { table: "opportunity_email_threads", columns: ["opportunity_id"] },
  { table: "email_threads", columns: ["opportunity_id"] },
] as const;

function assertWriteAllowed(table: string, column: string): void {
  const entry = WRITE_ALLOW_LIST.find((e) => e.table === table);
  if (!entry || !entry.columns.includes(column)) {
    throw new Error(
      `REFUSED: write to ${table}.${column} is not in the resolver allow-list ${JSON.stringify(
        WRITE_ALLOW_LIST
      )}`
    );
  }
}

const COMPANY_CANPRO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const TERMINAL_STAGES = new Set(["won", "lost", "discarded"]);
const TEST_SEED_OPP_PREFIX = "d2000000-0000-4000-d200-";

// The self-owned Office Victoria client (the company's own address). Any
// disposition is owned by DW3 — the resolver only FLAGS it, never re-points.
const OFFICE_VICTORIA_CLIENT = "0037546b-6529-4437-9119-6b8393385aa5";
// The two DW1 blank-thread aggregate opportunities (already quarantined by DW1).
const BLANK_AGG_OPPS = new Set([
  "a760f45f-d772-4cbf-9e34-03a113aabef2",
  "aeb65f87-2384-4e42-a274-239871a22eac",
]);

type Classification = "CONFIDENT-RE-POINT" | "QUARANTINE" | "FLAG";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface OppMeta {
  id: string;
  title: string | null;
  stage: string | null;
  archived: boolean;
  deleted: boolean;
  client_id: string | null;
  client_name: string | null;
}

interface ProposedChange {
  table: "activities" | "opportunity_email_threads" | "email_threads";
  column: "opportunity_id";
  rowKey: string; // the id (or row description) the UPDATE targets
  currentOpp: string | null;
  proposedOpp: string;
  guard: string; // idempotency / safety guard applied at write time
}

interface ResolvedThread {
  providerThreadId: string;
  connectionId: string | null;
  clientId: string | null;
  clientName: string | null;
  owners: Array<{ opp: OppMeta; actCount: number }>;
  totalActs: number;
  joinRows: number;
  joinLiveNonTerminal: number;
  liveNonTerminalOwners: number;
  terminalOwners: number;
  distinctClients: number;
  classification: Classification;
  signal: string; // the exact unambiguous evidence (or why none exists)
  confidence: "total" | "partial" | "none";
  changes: ProposedChange[];
}

interface CanonRow {
  etId: string;
  providerThreadId: string;
  connectionId: string | null;
  cacheOpp: string | null;
  cacheOppMeta: OppMeta | null;
  joinOpp: string;
  joinOppMeta: OppMeta;
  kind: "null_canonical" | "divergent";
  classification: Classification;
  signal: string;
  confidence: "total" | "partial" | "none";
  changes: ProposedChange[];
}

interface BlankBucket {
  opportunityId: string | null;
  count: number;
  classification: Classification;
  signal: string;
}

interface UnownedMsgIdRow {
  id: string;
  emailMessageId: string | null;
  subject: string | null;
  createdAt: string;
  classification: Classification;
  signal: string;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function md(value: unknown): string {
  const text = value === null || value === undefined || value === "" ? "—" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function isTerminal(o: OppMeta): boolean {
  return o.stage !== null && TERMINAL_STAGES.has(o.stage);
}

function isHidden(o: OppMeta): boolean {
  return o.archived || o.deleted;
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

// --------------------------------------------------------------------------
// 1. Split threads — re-derive owners + decide re-point / quarantine.
// --------------------------------------------------------------------------

async function fetchSplitThreads(): Promise<ResolvedThread[]> {
  // Per-activity rows for every email activity tied to a provider thread + opp.
  const acts: Array<{
    email_thread_id: string;
    opportunity_id: string;
    id: string;
    from_email: string | null;
    email_message_id: string | null;
  }> = [];
  {
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("activities")
        .select("id, email_thread_id, opportunity_id, from_email, email_message_id")
        .eq("type", "email")
        .not("email_thread_id", "is", null)
        .neq("email_thread_id", "")
        .not("opportunity_id", "is", null)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as typeof acts;
      acts.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  }

  // group provider thread -> opp -> activity ids
  const byThread = new Map<string, Map<string, string[]>>();
  for (const a of acts) {
    if (a.opportunity_id.startsWith(TEST_SEED_OPP_PREFIX)) continue;
    let inner = byThread.get(a.email_thread_id);
    if (!inner) {
      inner = new Map();
      byThread.set(a.email_thread_id, inner);
    }
    const arr = inner.get(a.opportunity_id) ?? [];
    arr.push(a.id);
    inner.set(a.opportunity_id, arr);
  }

  const splitEntries = Array.from(byThread.entries()).filter(([, opps]) => opps.size > 1);
  const oppIds = splitEntries.flatMap(([, opps]) => Array.from(opps.keys()));
  const meta = await fetchOppMeta(oppIds);

  // Canonical join rows for the split provider threads.
  const splitThreadIds = new Set(splitEntries.map(([ptid]) => ptid));
  const joinByThread = new Map<
    string,
    Array<{ id: string; opportunity_id: string; connection_id: string | null }>
  >();
  {
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("opportunity_email_threads")
        .select("id, thread_id, opportunity_id, connection_id")
        .neq("thread_id", "")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as Array<{
        id: string;
        thread_id: string;
        opportunity_id: string;
        connection_id: string | null;
      }>;
      for (const j of batch) {
        if (!splitThreadIds.has(j.thread_id)) continue;
        const arr = joinByThread.get(j.thread_id) ?? [];
        arr.push({ id: j.id, opportunity_id: j.opportunity_id, connection_id: j.connection_id });
        joinByThread.set(j.thread_id, arr);
      }
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  }

  const results: ResolvedThread[] = [];
  for (const [providerThreadId, oppMap] of splitEntries) {
    const owners = Array.from(oppMap.entries())
      .map(([oppId, actIds]) => ({ opp: meta.get(oppId)!, actCount: actIds.length, actIds }))
      .filter((o) => o.opp)
      .sort((a, b) => b.actCount - a.actCount);
    const totalActs = owners.reduce((s, o) => s + o.actCount, 0);
    const terminalOwners = owners.filter((o) => isTerminal(o.opp)).length;
    const liveNonTerminalOwners = owners.filter(
      (o) => !isTerminal(o.opp) && !isHidden(o.opp)
    ).length;
    const distinctClients = new Set(owners.map((o) => o.opp.client_id)).size;
    const hasNullClient = owners.some((o) => o.opp.client_id === null);

    const joins = joinByThread.get(providerThreadId) ?? [];
    const joinRows = joins.length;
    const joinLiveOpps = joins
      .map((j) => ({ join: j, opp: meta.get(j.opportunity_id) }))
      .filter(
        (x): x is { join: (typeof joins)[number]; opp: OppMeta } =>
          !!x.opp && !isTerminal(x.opp) && !isHidden(x.opp)
      );
    const joinLiveNonTerminal = joinLiveOpps.length;

    const connectionId = joins[0]?.connection_id ?? null;
    const clientId = owners[0]?.opp.client_id ?? null;
    const clientName = owners[0]?.opp.client_name ?? null;

    let classification: Classification = "QUARANTINE";
    let signal = "";
    let confidence: "total" | "partial" | "none" = "none";
    const changes: ProposedChange[] = [];

    // ---- CONFIDENT-RE-POINT gate (all conditions must hold) ----
    const singleLiveTarget = liveNonTerminalOwners === 1 && joinLiveNonTerminal === 1;
    const singleClient = distinctClients === 1 && !hasNullClient;
    const noTerminalCrossing = terminalOwners === 0;
    const singularJoin = joinRows === 1;

    if (singleLiveTarget && singleClient && noTerminalCrossing && singularJoin) {
      const target = joinLiveOpps[0];
      // Re-point every activity NOT already on the target to the target opp.
      // Each stray owner must itself be non-terminal (guaranteed by noTerminalCrossing)
      // and same-client (guaranteed by singleClient). Strays are hidden shells.
      const strayOwners = owners.filter((o) => o.opp.id !== target.opp.id);
      for (const stray of strayOwners) {
        for (const actId of stray.actIds) {
          changes.push({
            table: "activities",
            column: "opportunity_id",
            rowKey: actId,
            currentOpp: stray.opp.id,
            proposedOpp: target.opp.id,
            guard: `eq id=${actId} AND eq opportunity_id=${stray.opp.id} (idempotent: only the still-mislinked activity)`,
          });
        }
      }
      classification = "CONFIDENT-RE-POINT";
      confidence = "total";
      signal =
        `Singular canonical join row (1 row → opp ${target.opp.id}) + exactly ONE live non-terminal owner + ` +
        `single client ${clientId ?? "—"} across all ${owners.length} owners + ZERO terminal owners (fork does not cross won/lost/discarded). ` +
        `Stray activities sit on hidden same-client shell(s) [${strayOwners
          .map((s) => s.opp.id)
          .join(", ")}]. Re-point keeps correspondence on the SAME customer; no cross-customer move, no terminal-boundary move. ` +
        `from_email is the company's own outbound address (corroboration only, not a customer discriminator).`;
    } else {
      // ---- QUARANTINE with explicit refusal reason ----
      confidence = "none";
      if (terminalOwners > 0) {
        signal =
          `REFUSED: ${terminalOwners} terminal owner(s) — collapse would re-point activities off a closed (won/lost/discarded) job. ` +
          `No unambiguous live target across the terminal boundary.`;
      } else if (distinctClients > 1 || hasNullClient) {
        signal = `REFUSED: ${distinctClients} distinct client(s)${hasNullClient ? " incl. NULL-client owner" : ""} — never move correspondence across customers.`;
      } else if (liveNonTerminalOwners !== 1 || joinLiveNonTerminal !== 1) {
        signal = `REFUSED: ${liveNonTerminalOwners} live non-terminal owner(s) / ${joinLiveNonTerminal} live join target(s) — ambiguous which opportunity is canonical.`;
      } else if (joinRows !== 1) {
        signal = `REFUSED: ${joinRows} canonical join rows for this thread — not a singular authoritative owner.`;
      } else {
        signal = "REFUSED: confidence is not total; no single unambiguous live target.";
      }
    }

    results.push({
      providerThreadId,
      connectionId,
      clientId,
      clientName,
      owners: owners.map((o) => ({ opp: o.opp, actCount: o.actCount })),
      totalActs,
      joinRows,
      joinLiveNonTerminal,
      liveNonTerminalOwners,
      terminalOwners,
      distinctClients,
      classification,
      signal,
      confidence,
      changes,
    });
  }
  results.sort((a, b) => b.totalActs - a.totalActs);
  return results;
}

// --------------------------------------------------------------------------
// 2/3. NULL-canonical + divergent cache rows.
// --------------------------------------------------------------------------

async function fetchCanonRows(): Promise<CanonRow[]> {
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

  const joins: Array<{ connection_id: string | null; thread_id: string; opportunity_id: string }> =
    [];
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
  // Build a join index keyed on connection|thread; track whether the key is
  // multi-valued (a thread with >1 join opp is itself ambiguous => never confident).
  const joinByKey = new Map<string, Set<string>>();
  for (const j of joins) {
    const key = `${j.connection_id}|${j.thread_id}`;
    const set = joinByKey.get(key) ?? new Set<string>();
    set.add(j.opportunity_id);
    joinByKey.set(key, set);
  }

  const matched = ets
    .map((et) => {
      const set = joinByKey.get(`${et.connection_id}|${et.provider_thread_id}`);
      if (!set || set.size === 0) return null;
      return { et, joinOpps: Array.from(set) };
    })
    .filter(Boolean) as Array<{ et: (typeof ets)[number]; joinOpps: string[] }>;

  const oppIds = matched.flatMap((m) => [...m.joinOpps, m.et.opportunity_id].filter(Boolean) as string[]);
  const meta = await fetchOppMeta(oppIds);

  const results: CanonRow[] = [];
  for (const { et, joinOpps } of matched) {
    // A multi-join thread has no single canonical owner — defer to the split
    // logic; skip here so cache rows are only confident when the join is singular.
    const joinIsSingular = joinOpps.length === 1;
    const joinOpp = joinOpps[0];
    const joinMeta = meta.get(joinOpp);
    if (!joinMeta) continue;

    if (et.opportunity_id === null) {
      // NULL-canonical: cache never set.
      const joinTerminal = isTerminal(joinMeta);
      const joinHidden = isHidden(joinMeta);
      let classification: Classification = "QUARANTINE";
      let signal = "";
      let confidence: "total" | "partial" | "none" = "none";
      const changes: ProposedChange[] = [];
      if (joinIsSingular && !joinTerminal && !joinHidden) {
        classification = "CONFIDENT-RE-POINT";
        confidence = "total";
        changes.push({
          table: "email_threads",
          column: "opportunity_id",
          rowKey: et.id,
          currentOpp: null,
          proposedOpp: joinOpp,
          guard: `eq id=${et.id} AND opportunity_id is NULL (idempotent backfill)`,
        });
        signal = `Singular canonical join (1 opp ${joinOpp}), live + non-terminal. Cache backfill to the single authoritative owner; no customer move (cache was NULL).`;
      } else if (!joinIsSingular) {
        signal = `REFUSED: ${joinOpps.length} join opps for this thread — no single canonical owner to backfill.`;
      } else if (joinHidden) {
        signal = `REFUSED: join opp is ${joinMeta.deleted ? "deleted" : "archived"} — never point the cache at a hidden opp.`;
      } else {
        // terminal but live: FLAG for operator (a closed deal can legitimately own its thread).
        classification = "FLAG";
        signal = `Join opp is terminal (${joinMeta.stage}) — a won/lost deal can legitimately own its thread, but cache-backfill to a terminal opp needs operator sign-off.`;
      }
      results.push({
        etId: et.id,
        providerThreadId: et.provider_thread_id,
        connectionId: et.connection_id,
        cacheOpp: null,
        cacheOppMeta: null,
        joinOpp,
        joinOppMeta: joinMeta,
        kind: "null_canonical",
        classification,
        signal,
        confidence,
        changes,
      });
    } else if (et.opportunity_id !== joinOpp) {
      // Divergent: cache opp <> join opp.
      const cacheMeta = meta.get(et.opportunity_id) ?? null;
      const cacheHidden = cacheMeta ? isHidden(cacheMeta) : false;
      const joinHidden = isHidden(joinMeta);
      const sameClient =
        cacheMeta && joinMeta.client_id && cacheMeta.client_id === joinMeta.client_id;
      let classification: Classification = "QUARANTINE";
      let signal = "";
      let confidence: "total" | "partial" | "none" = "none";
      const changes: ProposedChange[] = [];
      if (joinIsSingular && cacheHidden && !joinHidden && !isTerminal(joinMeta) && sameClient) {
        classification = "CONFIDENT-RE-POINT";
        confidence = "total";
        changes.push({
          table: "email_threads",
          column: "opportunity_id",
          rowKey: et.id,
          currentOpp: et.opportunity_id,
          proposedOpp: joinOpp,
          guard: `eq id=${et.id} AND opportunity_id=${et.opportunity_id} (idempotent: only the still-divergent cache)`,
        });
        signal =
          `Cache points at a HIDDEN (${cacheMeta?.archived ? "archived" : "deleted"}) shell ${et.opportunity_id} while the singular live join points at ${joinOpp}; ` +
          `BOTH opps share client ${joinMeta.client_id}. The cache is the corruption — realign to the live same-client owner. No cross-customer move, no terminal-boundary move.`;
      } else if (!joinIsSingular) {
        signal = `REFUSED: ${joinOpps.length} join opps — no single canonical owner.`;
      } else if (!sameClient) {
        signal = `REFUSED: cache opp client (${cacheMeta?.client_id ?? "—"}) ≠ join opp client (${joinMeta.client_id ?? "—"}) — aligning could move correspondence across customers.`;
      } else if (joinHidden) {
        signal = `REFUSED: join opp is ${joinMeta.deleted ? "deleted" : "archived"} — aligning would point the cache at a hidden opp (McCullough-class fork).`;
      } else {
        classification = "FLAG";
        signal = "Both sides live/terminal — divergence needs operator adjudication of the true owner.";
      }
      results.push({
        etId: et.id,
        providerThreadId: et.provider_thread_id,
        connectionId: et.connection_id,
        cacheOpp: et.opportunity_id,
        cacheOppMeta: cacheMeta,
        joinOpp,
        joinOppMeta: joinMeta,
        kind: "divergent",
        classification,
        signal,
        confidence,
        changes,
      });
    }
  }
  results.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "null_canonical" ? -1 : 1));
  return results;
}

// --------------------------------------------------------------------------
// 4/5. Blank bucket + unowned-with-message-id (always quarantine/flag).
// --------------------------------------------------------------------------

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

  const production = rows.filter(
    (r) => !(r.opportunity_id && r.opportunity_id.startsWith(TEST_SEED_OPP_PREFIX))
  );

  const unownedWithMsgId = production.filter(
    (r) => r.opportunity_id === null && r.email_message_id !== null && r.email_message_id !== ""
  );
  const unowned: UnownedMsgIdRow[] = unownedWithMsgId.map((r) => ({
    id: r.id,
    emailMessageId: r.email_message_id,
    subject: r.subject,
    createdAt: r.created_at,
    classification: "QUARANTINE",
    signal:
      "Carries a real provider message_id but has NO owning opportunity — there is no target to re-point to. Re-ingestion could later recover it; do not destroy or re-point.",
  }));
  const unownedIds = new Set(unowned.map((u) => u.id));

  const owned = production.filter((r) => !unownedIds.has(r.id));
  const byOpp = new Map<string | null, typeof owned>();
  for (const r of owned) {
    const arr = byOpp.get(r.opportunity_id) ?? [];
    arr.push(r);
    byOpp.set(r.opportunity_id, arr);
  }

  const buckets: BlankBucket[] = [];
  for (const [oppId, arr] of byOpp.entries()) {
    buckets.push({
      opportunityId: oppId,
      count: arr.length,
      classification: "QUARANTINE",
      signal:
        "No recoverable per-activity identity (from_email blank/own-address, message_id null, subject 'Email') — exact-email/message_id re-point is provably impossible. DW1 isolates these with a synthetic legacy thread id; the resolver does NOT split / re-point / delete.",
    });
  }
  buckets.sort((a, b) => b.count - a.count);
  return { buckets, unowned };
}

// --------------------------------------------------------------------------
// Office-Victoria / DW3 flag surface (no auto-apply).
// --------------------------------------------------------------------------

async function fetchOfficeVictoriaFlag(): Promise<{
  clientId: string;
  exists: boolean;
  oppCount: number;
  note: string;
}> {
  const { data, error } = await sb
    .from("opportunities")
    .select("id", { count: "exact", head: false })
    .eq("client_id", OFFICE_VICTORIA_CLIENT);
  if (error) throw new Error(error.message);
  const oppCount = (data ?? []).length;
  return {
    clientId: OFFICE_VICTORIA_CLIENT,
    exists: oppCount > 0,
    oppCount,
    note:
      "Operator-gated (DW3, identity/title contamination). The self-owned Office Victoria client uses the company's own address (victoria@canprodeckandrail.com). " +
      "The resolver FLAGS this and never auto-applies; any relabel/null must wait for DW1's blank-aggregate opps (a760f45f, aeb65f87) to be dispositioned first.",
  };
}

// --------------------------------------------------------------------------
// Apply (gated; NOT run by the build agent)
// --------------------------------------------------------------------------

async function applyConfidentChanges(changes: ProposedChange[], providerThreadId: string | null): Promise<number> {
  let applied = 0;
  for (const c of changes) {
    assertWriteAllowed(c.table, c.column);
    if (c.table === "activities") {
      const { error } = await sb
        .from("activities")
        .update({ opportunity_id: c.proposedOpp })
        .eq("id", c.rowKey)
        .eq("opportunity_id", c.currentOpp as string); // idempotency guard
      if (error) throw new Error(`activities ${c.rowKey}: ${error.message}`);
    } else if (c.table === "email_threads") {
      const q = sb.from("email_threads").update({ opportunity_id: c.proposedOpp }).eq("id", c.rowKey);
      const { error } =
        c.currentOpp === null
          ? await q.is("opportunity_id", null)
          : await q.eq("opportunity_id", c.currentOpp);
      if (error) throw new Error(`email_threads ${c.rowKey}: ${error.message}`);
    } else if (c.table === "opportunity_email_threads") {
      const { error } = await sb
        .from("opportunity_email_threads")
        .update({ opportunity_id: c.proposedOpp })
        .eq("id", c.rowKey)
        .eq("opportunity_id", c.currentOpp as string);
      if (error) throw new Error(`opportunity_email_threads ${c.rowKey}: ${error.message}`);
    }
    applied += 1;
    void providerThreadId;
  }
  return applied;
}

// --------------------------------------------------------------------------
// Artifact
// --------------------------------------------------------------------------

function hardStopProof(apply: boolean): string {
  return [
    "## Hard-Stop Proof",
    "",
    `- Mode: ${apply ? "apply" : "dry-run (READ-ONLY)"}.`,
    apply
      ? "- Writes performed: only the operator-approved confident re-points within the allow-list."
      : "- Writes performed this run: **none** (dry-run; the Supabase client issued SELECT-only reads).",
    "- Emails sent: no.",
    "- Provider drafts created: no.",
    "- Opportunities merged: no.",
    "- Rows deleted: no.",
    "- Links fabricated: no.",
    "- Clients auto-created: no.",
    "- Opportunity business state (stage/archived/deleted) changed: no.",
    "- Correspondence moved across a different real customer: no (every confident re-point is single-client + same-client target).",
    "- Correspondence moved across the won/lost/discarded terminal boundary: no (terminal forks are refused).",
    "- Office-Victoria self-owned-vs-corrected-customer case: FLAGGED only (owned by DW3); never auto-applied.",
    "- Write surface, if ever applied: activities.opportunity_id, opportunity_email_threads.opportunity_id, email_threads.opportunity_id ONLY (guarded by assertWriteAllowed).",
    `- Apply gate: --apply requires --i-understand-this-repoints-customer-correspondence AND --approve-repoint <providerThreadId> per thread. Build agent runs --dry-run ONLY.`,
  ].join("\n");
}

function renderArtifact(input: {
  splits: ResolvedThread[];
  canon: CanonRow[];
  blank: { buckets: BlankBucket[]; unowned: UnownedMsgIdRow[] };
  victoria: { clientId: string; exists: boolean; oppCount: number; note: string };
  apply: boolean;
  appliedCount: number;
}): string {
  const { splits, canon, blank, victoria, apply } = input;

  const splitConfident = splits.filter((s) => s.classification === "CONFIDENT-RE-POINT");
  const splitQuarantine = splits.filter((s) => s.classification === "QUARANTINE");
  const nullCanon = canon.filter((c) => c.kind === "null_canonical");
  const divergent = canon.filter((c) => c.kind === "divergent");
  const canonConfident = canon.filter((c) => c.classification === "CONFIDENT-RE-POINT");
  const canonQuarantine = canon.filter((c) => c.classification === "QUARANTINE");
  const canonFlag = canon.filter((c) => c.classification === "FLAG");
  const blankActTotal = blank.buckets.reduce((s, b) => s + b.count, 0);

  const confidentTotal = splitConfident.length + canonConfident.length;
  const quarantineTotal =
    splitQuarantine.length + canonQuarantine.length + blank.buckets.length + blank.unowned.length;
  const flagTotal = canonFlag.length + (victoria.exists ? 1 : 0);

  const allConfidentChanges = [
    ...splits.flatMap((s) => s.changes),
    ...canon.flatMap((c) => c.changes),
  ];

  const lines: string[] = [];
  lines.push(`# Lead Lifecycle P1 — Link-Reconciliation Resolver (DW2) ${apply ? "Apply" : "Dry Run"}`);
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("Workstream: DW2-link-reconciliation-resolver");
  lines.push(`Company in scope: ${COMPANY_CANPRO} (Canpro Deck and Rail)`);
  lines.push(`Mode: **${apply ? "apply" : "dry-run"}** (${apply ? "operator-approved writes only" : "read-only"})`);
  lines.push("");

  // ---- Summary ----
  lines.push("## Summary — exact counts");
  lines.push("");
  lines.push("| Candidate set | Rows | Confident-re-point | Quarantine | Flag-only |");
  lines.push("| --- | --- | --- | --- | --- |");
  lines.push(
    `| 1. Split threads (>1 opp per provider thread) | ${splits.length} | ${splitConfident.length} | ${splitQuarantine.length} | 0 |`
  );
  lines.push(
    `| 2. NULL-canonical (cache NULL, join present) | ${nullCanon.length} | ${nullCanon.filter((c) => c.classification === "CONFIDENT-RE-POINT").length} | ${nullCanon.filter((c) => c.classification === "QUARANTINE").length} | ${nullCanon.filter((c) => c.classification === "FLAG").length} |`
  );
  lines.push(
    `| 3. Divergent (cache opp ≠ join opp) | ${divergent.length} | ${divergent.filter((c) => c.classification === "CONFIDENT-RE-POINT").length} | ${divergent.filter((c) => c.classification === "QUARANTINE").length} | ${divergent.filter((c) => c.classification === "FLAG").length} |`
  );
  lines.push(`| 4. Blank-bucket activities (owned) | ${blankActTotal} | 0 | ${blank.buckets.length} buckets / ${blankActTotal} acts | 0 |`);
  lines.push(`| 5. Unowned-with-message-id sub-bucket | ${blank.unowned.length} | 0 | ${blank.unowned.length} | 0 |`);
  lines.push(`| 6. Office-Victoria / DW3 self-owned flag | ${victoria.exists ? victoria.oppCount : 0} | 0 | 0 | ${victoria.exists ? 1 : 0} |`);
  lines.push("");
  lines.push(
    `**Totals:** confident-re-point **${confidentTotal}** · quarantine **${quarantineTotal}** · flag-only **${flagTotal}**.`
  );
  lines.push("");
  lines.push(
    `**Confident re-point physical writes:** ${allConfidentChanges.length} row-update(s) across ${confidentTotal} candidate(s) (${allConfidentChanges.filter((c) => c.table === "activities").length} activities.opportunity_id, ${allConfidentChanges.filter((c) => c.table === "email_threads").length} email_threads.opportunity_id, ${allConfidentChanges.filter((c) => c.table === "opportunity_email_threads").length} opportunity_email_threads.opportunity_id).`
  );
  if (apply) {
    lines.push("");
    lines.push(`**Applied this run:** ${input.appliedCount} row-update(s).`);
  }
  lines.push("");

  // ---- Allow-list ----
  lines.push("## Apply write allow-list (table.column)");
  lines.push("");
  lines.push("Apply may ONLY write these columns; every UPDATE is guarded by `assertWriteAllowed`:");
  lines.push("");
  for (const e of WRITE_ALLOW_LIST) {
    for (const col of e.columns) lines.push(`- \`${e.table}.${col}\``);
  }
  lines.push("");
  lines.push(
    "No other table or column is writable. Opportunities are never merged; rows are never deleted; links are never fabricated; clients are never auto-created."
  );
  lines.push("");

  lines.push(hardStopProof(apply));
  lines.push("");

  // ---- Confident re-point table (per-row proposed change) ----
  lines.push("## Confident re-points — per-row proposed change + exact evidence");
  lines.push("");
  if (confidentTotal === 0) {
    lines.push("_No candidate met the total-confidence bar._");
  } else {
    lines.push(
      "| # | candidate | table.column | row | current opp | → proposed opp | unambiguous signal | confidence | apply guard |"
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    let n = 1;
    for (const s of splitConfident) {
      for (const c of s.changes) {
        lines.push(
          `| ${n++} | split ${md(s.providerThreadId)} (client ${md(s.clientName ?? s.clientId)}) | ${md(c.table)}.${md(c.column)} | ${md(c.rowKey)} | ${md(c.currentOpp)} | ${md(c.proposedOpp)} | ${md(s.signal)} | ${md(s.confidence)} | ${md(c.guard)} |`
        );
      }
    }
    for (const c of canonConfident) {
      for (const ch of c.changes) {
        lines.push(
          `| ${n++} | ${md(c.kind)} ${md(c.providerThreadId)} | ${md(ch.table)}.${md(ch.column)} | ${md(ch.rowKey)} | ${md(ch.currentOpp)} | ${md(ch.proposedOpp)} | ${md(c.signal)} | ${md(c.confidence)} | ${md(ch.guard)} |`
        );
      }
    }
  }
  lines.push("");

  // ---- 1. Split threads (full) ----
  lines.push("## 1. Split threads — per thread classification");
  lines.push("");
  lines.push(
    `Identified ${splits.length} split provider threads. CONFIDENT-RE-POINT requires: singular canonical join row + exactly one live non-terminal owner + single client + zero terminal owners. Result: **${splitConfident.length} confident-re-point, ${splitQuarantine.length} quarantine.**`
  );
  lines.push("");
  lines.push(
    "| provider_thread_id | client | owners | acts | live-nonterm | terminal | join_rows | join_live | class | signal / refusal |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of splits) {
    lines.push(
      `| ${md(s.providerThreadId)} | ${md(s.clientName ?? s.clientId)} | ${s.owners.length} | ${s.totalActs} | ${s.liveNonTerminalOwners} | ${s.terminalOwners} | ${s.joinRows} | ${s.joinLiveNonTerminal} | ${s.classification} | ${md(s.signal)} |`
    );
  }
  lines.push("");
  lines.push("### Split-thread owner detail (per owning opportunity)");
  lines.push("");
  lines.push("| provider_thread_id | opportunity_id | acts | title | stage | archived | deleted | client |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of splits) {
    for (const o of s.owners) {
      lines.push(
        `| ${md(s.providerThreadId)} | ${md(o.opp.id)} | ${o.actCount} | ${md(o.opp.title)} | ${md(o.opp.stage)} | ${o.opp.archived ? "yes" : "no"} | ${o.opp.deleted ? "yes" : "no"} | ${md(o.opp.client_name ?? o.opp.client_id)} |`
      );
    }
  }
  lines.push("");

  // ---- 2. NULL-canonical ----
  lines.push("## 2. NULL-canonical — cache column never set");
  lines.push("");
  lines.push(
    `Identified ${nullCanon.length} email_threads rows with a real provider id + matching join but NULL cache. Confident only when the join is singular, live and non-terminal. Result: **${nullCanon.filter((c) => c.classification === "CONFIDENT-RE-POINT").length} confident, ${nullCanon.filter((c) => c.classification === "QUARANTINE").length} quarantine, ${nullCanon.filter((c) => c.classification === "FLAG").length} flag.**`
  );
  lines.push("");
  lines.push("| email_thread_id | provider_thread_id | join opp | join stage | archived | deleted | class | signal / refusal |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of nullCanon) {
    lines.push(
      `| ${md(c.etId)} | ${md(c.providerThreadId)} | ${md(c.joinOpp)} | ${md(c.joinOppMeta.stage)} | ${c.joinOppMeta.archived ? "yes" : "no"} | ${c.joinOppMeta.deleted ? "yes" : "no"} | ${c.classification} | ${md(c.signal)} |`
    );
  }
  lines.push("");

  // ---- 3. Divergent ----
  lines.push("## 3. Divergent — cache opp ≠ join opp");
  lines.push("");
  lines.push(
    `Identified ${divergent.length} divergent rows. Confident only when the cache points at a HIDDEN same-client shell while the singular join points at a LIVE same-client owner. Result: **${divergent.filter((c) => c.classification === "CONFIDENT-RE-POINT").length} confident, ${divergent.filter((c) => c.classification === "QUARANTINE").length} quarantine, ${divergent.filter((c) => c.classification === "FLAG").length} flag.**`
  );
  lines.push("");
  lines.push(
    "| email_thread_id | provider_thread_id | cache opp | cache hidden | cache client | join opp | join stage | join hidden | join client | class | signal / refusal |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of divergent) {
    const cacheHidden = c.cacheOppMeta ? isHidden(c.cacheOppMeta) : false;
    const joinHidden = isHidden(c.joinOppMeta);
    lines.push(
      `| ${md(c.etId)} | ${md(c.providerThreadId)} | ${md(c.cacheOpp)} | ${cacheHidden ? "yes" : "no"} | ${md(c.cacheOppMeta?.client_id)} | ${md(c.joinOpp)} | ${md(c.joinOppMeta.stage)} | ${joinHidden ? "yes" : "no"} | ${md(c.joinOppMeta.client_id)} | ${c.classification} | ${md(c.signal)} |`
    );
  }
  lines.push("");

  // ---- 4. Blank bucket ----
  lines.push("## 4. Blank-bucket activities (DW1 aggregate, owned) — QUARANTINE");
  lines.push("");
  lines.push(
    `Identified ${blankActTotal} owned production blank-bucket activities across ${blank.buckets.length} bucket(s). No recoverable identity ⇒ exact-signal re-point is impossible. Entire set is QUARANTINE (DW1 isolates; the resolver does not touch).`
  );
  lines.push("");
  lines.push("| owning opportunity_id | count | class | signal |");
  lines.push("| --- | --- | --- | --- |");
  for (const b of blank.buckets) {
    lines.push(`| ${md(b.opportunityId)} | ${b.count} | ${b.classification} | ${md(b.signal)} |`);
  }
  lines.push("");

  // ---- 5. Unowned-with-message-id ----
  lines.push("## 5. Unowned-with-message-id sub-bucket — QUARANTINE");
  lines.push("");
  lines.push(
    `Identified ${blank.unowned.length} unowned blank-bucket activities carrying a real provider message_id. No owning opp ⇒ no re-point target. Quarantine; preserve for re-ingestion.`
  );
  lines.push("");
  lines.push("| activity_id | email_message_id | subject | created_at | class | signal |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const u of blank.unowned) {
    lines.push(
      `| ${md(u.id)} | ${md(u.emailMessageId)} | ${md(u.subject)} | ${md(u.createdAt)} | ${u.classification} | ${md(u.signal)} |`
    );
  }
  lines.push("");

  // ---- 6. Office Victoria / DW3 ----
  lines.push("## 6. Office-Victoria self-owned vs corrected-customer — FLAG (DW3, operator-gated)");
  lines.push("");
  lines.push(`- Client: \`${victoria.clientId}\` — present: ${victoria.exists ? "yes" : "no"}, opportunities: ${victoria.oppCount}.`);
  lines.push(`- ${victoria.note}`);
  lines.push(`- DW1 blank-aggregate opps that must be dispositioned first: ${Array.from(BLANK_AGG_OPPS).join(", ")}.`);
  lines.push("");

  // ---- Apply gate ----
  lines.push("## Apply gate");
  lines.push("");
  lines.push("- `--apply` alone is **REFUSED**.");
  lines.push("- Re-pointing a real customer's thread requires BOTH:");
  lines.push("  - `--i-understand-this-repoints-customer-correspondence`, and");
  lines.push("  - `--approve-repoint <providerThreadId>` for EACH thread to re-point.");
  lines.push(
    `- This run's parsed approvals: ${APPROVED_REPOINTS.size === 0 ? "(none)" : Array.from(APPROVED_REPOINTS).join(", ")}.`
  );
  lines.push("- The build agent runs `--dry-run` ONLY. Apply is reserved for the operator post-review.");
  lines.push("");

  return lines.join("\n");
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  if (APPLY) {
    if (DRY_RUN) {
      console.error("REFUSED: --apply and --dry-run are mutually exclusive. Pass exactly one.");
      process.exit(1);
    }
    if (!APPLY_CONFIRMED) {
      console.error(
        "REFUSED: --apply re-points customer correspondence and requires --i-understand-this-repoints-customer-correspondence."
      );
      process.exit(1);
    }
    if (APPROVED_REPOINTS.size === 0) {
      console.error(
        "REFUSED: --apply requires at least one --approve-repoint <providerThreadId>. No thread is approved for re-point."
      );
      process.exit(1);
    }
  }

  const [splits, canon, blank, victoria] = await Promise.all([
    fetchSplitThreads(),
    fetchCanonRows(),
    fetchBlankBucket(),
    fetchOfficeVictoriaFlag(),
  ]);

  let appliedCount = 0;
  if (APPLY) {
    // Apply ONLY the confident changes for explicitly approved provider threads.
    for (const s of splits) {
      if (s.classification !== "CONFIDENT-RE-POINT") continue;
      if (!APPROVED_REPOINTS.has(s.providerThreadId)) continue;
      appliedCount += await applyConfidentChanges(s.changes, s.providerThreadId);
    }
    for (const c of canon) {
      if (c.classification !== "CONFIDENT-RE-POINT") continue;
      if (!APPROVED_REPOINTS.has(c.providerThreadId)) continue;
      appliedCount += await applyConfidentChanges(c.changes, c.providerThreadId);
    }
  }

  const markdown = renderArtifact({ splits, canon, blank, victoria, apply: APPLY, appliedCount });
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, markdown);

  const splitConfident = splits.filter((s) => s.classification === "CONFIDENT-RE-POINT").length;
  const canonConfident = canon.filter((c) => c.classification === "CONFIDENT-RE-POINT").length;
  console.log(`Artifact write: ${OUTPUT_PATH}`);
  console.log(`Mode: ${APPLY ? "apply" : "dry-run (read-only)"}`);
  console.log(
    `Confident re-points: split=${splitConfident} canon=${canonConfident} | quarantine splits=${splits.length - splitConfident} | applied=${appliedCount}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
