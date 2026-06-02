/*
 * Lead Lifecycle — historical client-orphan reconciliation (deferred P5 data step).
 *
 * The old non-transactional merge (DuplicateDetectionService) reassigned only a
 * subset of child-FK tables, soft-deleting the loser client while leaving child
 * rows pointing at it. Result: child rows stranded on soft-deleted clients.
 *
 * Verified live 2026-05-30 against ijeekuhbatykdomumfjx:
 *   - 26 activities    (activities.client_id    -> soft-deleted client)
 *   -  1 email_thread  (email_threads.client_id -> soft-deleted client)
 *   -  2 opportunities (opportunities.client_id -> soft-deleted client)
 *
 * For each orphan, determine a CONFIDENT surviving client:
 *   1. the soft-deleted client's merged_into_client_id, if set AND the pointed-to
 *      client exists and is itself NOT soft-deleted (the explicit merge winner);
 *   2. else, an EXACT normalized-email match: exactly ONE surviving (deleted_at
 *      IS NULL) client in the same company whose lower(btrim(email)) equals the
 *      soft-deleted client's lower(btrim(email)) — and the email is non-blank.
 * If neither yields a single unambiguous winner => QUARANTINE / flag for operator.
 * Conservative by construction: NEVER re-point to a guessed client; >1 candidate,
 * 0 candidates, blank/garbage email, or self-target all fall through to flag.
 *
 * Apply-mode table allow-list (client-linkage columns ONLY):
 *   - activities.client_id
 *   - email_threads.client_id
 *   - opportunities.client_id
 *
 * Hard guarantees:
 * - Emails sent: no.  Provider drafts created: no.
 * - Clients merged / soft-deleted / created / relabeled: no (clients is read-only here).
 * - Any column other than the three client_id linkage columns written: no.
 * - Re-point to a guessed/ambiguous client: no — confident single winner only.
 * - --apply is INTENTIONALLY NOT RUN by the build agent; only --dry-run is executed.
 *
 * Usage:
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-client-orphan-reconciliation.ts --dry-run
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-client-orphan-reconciliation.ts --apply
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
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-client-orphan-reconciliation-dry-run-2026-05-30.md";
const APPLY_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-client-orphan-reconciliation-apply-2026-05-30.md";
const OUTPUT_PATH =
  outputArgIdx >= 0 ? process.argv[outputArgIdx + 1] : APPLY ? APPLY_OUTPUT : DRY_RUN_OUTPUT;

// Apply mode is restricted to these tables; only the client_id linkage column is written.
const TABLE_ALLOW_LIST = ["activities", "email_threads", "opportunities"] as const;
type OrphanTable = (typeof TABLE_ALLOW_LIST)[number];

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

function normEmail(email: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

interface ClientRow {
  id: string;
  company_id: string;
  name: string | null;
  email: string | null;
  deleted_at: string | null;
  merged_into_client_id: string | null;
}

type Classification = "confident-fix" | "quarantine";

interface OrphanPlan {
  table: OrphanTable;
  rowId: string;
  delClientId: string;
  delClientName: string | null;
  delClientEmail: string | null;
  resolution: "merged_into_pointer" | "exact_email_single" | "none";
  survivorId: string | null;
  survivorName: string | null;
  classification: Classification;
  reason: string;
}

/** All soft-deleted clients (the potential orphan owners), keyed by id. */
async function fetchDeletedClients(): Promise<Map<string, ClientRow>> {
  const map = new Map<string, ClientRow>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("clients")
      .select("id, company_id, name, email, deleted_at, merged_into_client_id")
      .not("deleted_at", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as ClientRow[];
    for (const c of batch) map.set(c.id, c);
    if (batch.length < pageSize) break;
  }
  return map;
}

/** All surviving (non-deleted) clients, for merged_into-target + exact-email resolution. */
async function fetchSurvivingClients(): Promise<ClientRow[]> {
  const rows: ClientRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("clients")
      .select("id, company_id, name, email, deleted_at, merged_into_client_id")
      .is("deleted_at", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as ClientRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

interface OrphanRow {
  table: OrphanTable;
  rowId: string;
  clientId: string;
}

async function fetchOrphans(deleted: Map<string, ClientRow>): Promise<OrphanRow[]> {
  const deletedIds = Array.from(deleted.keys());
  const orphans: OrphanRow[] = [];
  if (deletedIds.length === 0) return orphans;

  const tables: OrphanTable[] = ["activities", "email_threads", "opportunities"];
  for (const table of tables) {
    const chunkSize = 200;
    for (let i = 0; i < deletedIds.length; i += chunkSize) {
      const chunk = deletedIds.slice(i, i + chunkSize);
      const { data, error } = await sb
        .from(table)
        .select("id, client_id")
        .in("client_id", chunk);
      if (error) throw new Error(`${table}: ${error.message}`);
      for (const r of (data ?? []) as { id: string; client_id: string }[]) {
        orphans.push({ table, rowId: r.id, clientId: r.client_id });
      }
    }
  }
  return orphans;
}

/** Resolve a single confident surviving client for a soft-deleted client. */
function resolveSurvivor(
  del: ClientRow,
  survivingById: Map<string, ClientRow>,
  survivingByEmail: Map<string, ClientRow[]>
): { survivor: ClientRow | null; resolution: OrphanPlan["resolution"]; reason: string } {
  // (1) explicit merge pointer — only if the target survives and is not the deleted client itself.
  if (del.merged_into_client_id) {
    const target = survivingById.get(del.merged_into_client_id);
    if (target && target.id !== del.id) {
      return {
        survivor: target,
        resolution: "merged_into_pointer",
        reason: `merged_into_client_id points at surviving client ${target.id} ('${target.name ?? "—"}')`,
      };
    }
    return {
      survivor: null,
      resolution: "none",
      reason: `merged_into_client_id set (${del.merged_into_client_id}) but target is missing or soft-deleted — not a safe winner`,
    };
  }

  // (2) exact normalized-email single survivor.
  const key = normEmail(del.email);
  if (key === "") {
    return {
      survivor: null,
      resolution: "none",
      reason: "soft-deleted client has blank/garbage email — no exact-email match possible",
    };
  }
  const candidates = (survivingByEmail.get(`${del.company_id}|${key}`) ?? []).filter(
    (c) => c.id !== del.id
  );
  if (candidates.length === 1) {
    return {
      survivor: candidates[0],
      resolution: "exact_email_single",
      reason: `exactly one surviving client in the company with normalized email '${key}' (${candidates[0].id} '${candidates[0].name ?? "—"}')`,
    };
  }
  if (candidates.length === 0) {
    return {
      survivor: null,
      resolution: "none",
      reason: `no surviving client with normalized email '${key}' — operator must classify (re-point target unknown)`,
    };
  }
  return {
    survivor: null,
    resolution: "none",
    reason: `${candidates.length} surviving clients share normalized email '${key}' — ambiguous, never guess`,
  };
}

function buildPlan(
  orphans: OrphanRow[],
  deleted: Map<string, ClientRow>,
  surviving: ClientRow[]
): OrphanPlan[] {
  const survivingById = new Map(surviving.map((c) => [c.id, c]));
  const survivingByEmail = new Map<string, ClientRow[]>();
  for (const c of surviving) {
    const key = normEmail(c.email);
    if (key === "") continue;
    const k = `${c.company_id}|${key}`;
    const arr = survivingByEmail.get(k) ?? [];
    arr.push(c);
    survivingByEmail.set(k, arr);
  }

  const plans: OrphanPlan[] = [];
  for (const o of orphans) {
    const del = deleted.get(o.clientId);
    if (!del) continue; // owner is not soft-deleted — not an orphan
    const { survivor, resolution, reason } = resolveSurvivor(del, survivingById, survivingByEmail);
    plans.push({
      table: o.table,
      rowId: o.rowId,
      delClientId: del.id,
      delClientName: del.name,
      delClientEmail: del.email,
      resolution,
      survivorId: survivor?.id ?? null,
      survivorName: survivor?.name ?? null,
      classification: survivor ? "confident-fix" : "quarantine",
      reason,
    });
  }
  // confident-fix first, then group by table + deleted client for readability
  plans.sort((a, b) => {
    if (a.classification !== b.classification) return a.classification === "confident-fix" ? -1 : 1;
    if (a.table !== b.table) return a.table < b.table ? -1 : 1;
    if (a.delClientId !== b.delClientId) return a.delClientId < b.delClientId ? -1 : 1;
    return a.rowId < b.rowId ? -1 : 1;
  });
  return plans;
}

async function applyPlan(plans: OrphanPlan[]): Promise<void> {
  if (!APPLY) return;
  for (const p of plans) {
    if (p.classification !== "confident-fix" || !p.survivorId) continue;
    assertAllowListed(p.table);
    const { error } = await sb
      .from(p.table)
      .update({ client_id: p.survivorId })
      .eq("id", p.rowId)
      .eq("client_id", p.delClientId); // idempotency guard: only re-point still-orphaned rows
    if (error) throw new Error(`${p.table} ${p.rowId}: ${error.message}`);
  }
}

function hardStopProof(apply: boolean): string {
  return [
    "## Hard-Stop Proof",
    "",
    `- Mode: ${apply ? "apply" : "dry-run (READ-ONLY)"}.`,
    apply
      ? "- Writes performed: yes (client_id linkage columns only, allow-list enforced)."
      : "- Writes performed: NO. Zero UPDATE/INSERT/DELETE issued in dry-run.",
    "- Emails sent: no.",
    "- Provider drafts created: no.",
    "- Clients merged / soft-deleted / created / relabeled: no (clients table is read-only here).",
    "- Re-point to a guessed/ambiguous client: no — only a single unambiguous surviving winner is ever written.",
    `- Tables apply could ever write (allow-list): ${TABLE_ALLOW_LIST.join(", ")} (client_id column only).`,
    "- Quarantined orphans re-pointed: no — left on the soft-deleted client for operator adjudication.",
    "- Business state in dry-run: untouched.",
  ].join("\n");
}

function renderArtifact(input: {
  plans: OrphanPlan[];
  byTable: Record<OrphanTable, number>;
  apply: boolean;
}): string {
  const confident = input.plans.filter((p) => p.classification === "confident-fix");
  const quarantine = input.plans.filter((p) => p.classification === "quarantine");

  const lines: string[] = [];
  lines.push(`# Lead Lifecycle — Client-Orphan Reconciliation ${input.apply ? "Apply" : "Dry Run"}`);
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("Workstream: client-orphan-reconciliation (deferred P5 data step)");
  lines.push("Supabase project: ijeekuhbatykdomumfjx (production)");
  lines.push(`Mode: ${input.apply ? "apply" : "dry-run (read-only)"}`);
  lines.push("");

  lines.push("## Summary — verified-live counts");
  lines.push("");
  lines.push(`- Orphan rows on soft-deleted clients: **${input.plans.length}** (activities=${input.byTable.activities}, email_threads=${input.byTable.email_threads}, opportunities=${input.byTable.opportunities})`);
  lines.push(`- Confident re-point (single unambiguous surviving winner): **${confident.length}**`);
  lines.push(`- Quarantine / flag for operator (no confident winner): **${quarantine.length}**`);
  lines.push("");
  lines.push("Resolution precedence: (1) `merged_into_client_id` pointing at a surviving client; (2) exactly one surviving client in the same company with the same normalized `lower(btrim(email))`. Anything else (0, >1, blank email, missing/soft-deleted target) is quarantined — never guessed.");
  lines.push("");

  lines.push("## Apply-mode table allow-list");
  lines.push("");
  lines.push("Apply may ONLY write the `client_id` column on these tables; every UPDATE is guarded by `assertAllowListed` + a still-orphaned idempotency guard. `clients` is read-only.");
  lines.push("");
  for (const t of TABLE_ALLOW_LIST) lines.push(`- \`${t}\` (column \`client_id\` only)`);
  lines.push("");

  lines.push(hardStopProof(input.apply));
  lines.push("");

  lines.push("## Confident re-points (single surviving winner)");
  lines.push("");
  if (confident.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| table | row_id | current_client_id (soft-deleted) | del_name | del_email | resolution | proposed_client_id | survivor_name |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const p of confident) {
      lines.push(
        `| ${md(p.table)} | ${md(p.rowId)} | ${md(p.delClientId)} | ${md(p.delClientName)} | ${md(p.delClientEmail)} | ${md(p.resolution)} | ${md(p.survivorId)} | ${md(p.survivorName)} |`
      );
    }
  }
  lines.push("");

  lines.push("## Quarantine / flag for operator (no confident winner)");
  lines.push("");
  if (quarantine.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| table | row_id | current_client_id (soft-deleted) | del_name | del_email | reason |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const p of quarantine) {
      lines.push(
        `| ${md(p.table)} | ${md(p.rowId)} | ${md(p.delClientId)} | ${md(p.delClientName)} | ${md(p.delClientEmail)} | ${md(p.reason)} |`
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}

async function writeArtifact(markdown: string) {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, markdown);
}

async function main() {
  const deleted = await fetchDeletedClients();
  const surviving = await fetchSurvivingClients();
  const orphans = await fetchOrphans(deleted);
  const plans = buildPlan(orphans, deleted, surviving);

  const byTable: Record<OrphanTable, number> = {
    activities: plans.filter((p) => p.table === "activities").length,
    email_threads: plans.filter((p) => p.table === "email_threads").length,
    opportunities: plans.filter((p) => p.table === "opportunities").length,
  };

  if (APPLY) {
    await applyPlan(plans);
  }

  await writeArtifact(renderArtifact({ plans, byTable, apply: APPLY }));

  console.log(`Artifact write: ${OUTPUT_PATH}`);
  console.log(`Mode: ${APPLY ? "apply" : "dry-run"}`);
  console.log(
    `Orphans: ${plans.length} (activities=${byTable.activities}, email_threads=${byTable.email_threads}, opportunities=${byTable.opportunities})`
  );
  console.log(
    `Confident-fix: ${plans.filter((p) => p.classification === "confident-fix").length} | Quarantine: ${plans.filter((p) => p.classification === "quarantine").length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
