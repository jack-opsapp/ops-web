/*
 * Lead Lifecycle P6 — seed-drift reconciliation report (deferred P6 data step).
 *
 * The opportunities<->projects link has three competing columns:
 *   - opportunities.project_id   (uuid, NO FK)
 *   - opportunities.project_ref  (uuid, FK -> projects.id, the canonical column)
 *   - projects.opportunity_id    (text back-link)
 * The audit framed an "11 vs 8" drift: 11 opps carry a project_id, only 8 carry
 * the FK-backed project_ref. The 3-row gap is the drift this report inspects.
 *
 * Verified live 2026-05-30 against ijeekuhbatykdomumfjx:
 *   3 opportunities with project_id set AND project_ref NULL:
 *     d2000000-0000-4000-d200-000000000001  (project c0000000-…0001)
 *     d2000000-0000-4000-d200-000000000002  (project c0000000-…0004)
 *     d2000000-0000-4000-d200-000000000003  (project c0000000-…0005)
 *   All stage 'won', all in company MAVERICK PROJECTS LTD
 *   (ddee107c-33cd-483e-8278-0f8d8a180181), all projects batch-created at the
 *   same seed timestamp. Real-world drift among non-synthetic rows is 0.
 *
 * This is a REPORT. It is dry-run-only and has NO destructive apply path: it
 * recommends leave-or-delete per row with evidence, and NEVER auto-deletes /
 * auto-backfills. The decision is the operator's (release runbook §6.4).
 *
 * Apply-mode table allow-list: NONE. This script never writes any table. The
 * --apply flag is accepted only to fail loudly and explain that no write path
 * exists by design.
 *
 * Hard guarantees:
 * - Writes performed: never (read-only report).
 * - Rows deleted / backfilled: no.
 * - Emails sent / drafts created: no.
 *
 * Usage:
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web \
 *     npx tsx scripts/lead-lifecycle-p6-seed-drift.ts --dry-run
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
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p6-seed-drift-dry-run-2026-05-30.md";
const OUTPUT_PATH = outputArgIdx >= 0 ? process.argv[outputArgIdx + 1] : DRY_RUN_OUTPUT;

// Known synthetic seed-fixture UUID prefixes (sequential, batch-inserted fixtures).
const SEED_OPP_PREFIX = "d2000000-0000-4000-d200-";
const SEED_PROJECT_PREFIX = "c0000000-0000-4000-c000-";
const SEED_CLIENT_PREFIX = "b0000000-0000-4000-b000-";

function md(value: unknown): string {
  const text = value === null || value === undefined || value === "" ? "—" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

interface DriftRow {
  oppId: string;
  oppTitle: string | null;
  stage: string | null;
  companyId: string | null;
  companyName: string | null;
  clientId: string | null;
  clientName: string | null;
  clientEmail: string | null;
  projectId: string | null;
  projectTitle: string | null;
  projectCompany: string | null;
  projectCreatedAt: string | null;
  projectBacklinkText: string | null;
  oppDeleted: boolean;
  oppArchived: boolean;
}

interface DriftAssessment extends DriftRow {
  synthetic: boolean;
  evidence: string[];
  recommendation: "leave" | "delete" | "operator-decide";
}

/**
 * Manual two-step join. `opportunities.project_id` has NO FK, so PostgREST
 * cannot reliably embed `projects` through it; we resolve companies / clients /
 * projects explicitly by id instead.
 */
async function fetchDriftRows(): Promise<DriftRow[]> {
  const { data: opps, error } = await sb
    .from("opportunities")
    .select("id, title, stage, company_id, client_id, project_id, project_ref, deleted_at, archived_at")
    .not("project_id", "is", null)
    .is("project_ref", null)
    .order("id");
  if (error) throw new Error(error.message);
  const oppRows = (opps ?? []) as Array<{
    id: string;
    title: string | null;
    stage: string | null;
    company_id: string | null;
    client_id: string | null;
    project_id: string | null;
    project_ref: string | null;
    deleted_at: string | null;
    archived_at: string | null;
  }>;

  const companyIds = Array.from(new Set(oppRows.map((o) => o.company_id).filter(Boolean))) as string[];
  const clientIds = Array.from(new Set(oppRows.map((o) => o.client_id).filter(Boolean))) as string[];
  const projectIds = Array.from(new Set(oppRows.map((o) => o.project_id).filter(Boolean))) as string[];

  const [companies, clients, projects] = await Promise.all([
    companyIds.length
      ? sb.from("companies").select("id, name").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? sb.from("clients").select("id, name, email").in("id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? sb.from("projects").select("id, title, company_id, created_at, opportunity_id").in("id", projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (companies.error) throw new Error(companies.error.message);
  if (clients.error) throw new Error(clients.error.message);
  if (projects.error) throw new Error(projects.error.message);

  const companyById = new Map((companies.data as { id: string; name: string }[]).map((c) => [c.id, c]));
  const clientById = new Map(
    (clients.data as { id: string; name: string | null; email: string | null }[]).map((c) => [c.id, c])
  );
  const projectById = new Map(
    (projects.data as {
      id: string;
      title: string | null;
      company_id: string | null;
      created_at: string | null;
      opportunity_id: string | null;
    }[]).map((p) => [p.id, p])
  );

  return oppRows.map((o) => {
    const co = o.company_id ? companyById.get(o.company_id) : undefined;
    const cl = o.client_id ? clientById.get(o.client_id) : undefined;
    const pr = o.project_id ? projectById.get(o.project_id) : undefined;
    return {
      oppId: o.id,
      oppTitle: o.title,
      stage: o.stage,
      companyId: o.company_id,
      companyName: co?.name ?? null,
      clientId: o.client_id,
      clientName: cl?.name ?? null,
      clientEmail: cl?.email ?? null,
      projectId: o.project_id,
      projectTitle: pr?.title ?? null,
      projectCompany: pr?.company_id ?? null,
      projectCreatedAt: pr?.created_at ?? null,
      projectBacklinkText: pr?.opportunity_id ?? null,
      oppDeleted: o.deleted_at !== null,
      oppArchived: o.archived_at !== null,
    };
  });
}

function assess(row: DriftRow): DriftAssessment {
  const evidence: string[] = [];
  let syntheticSignals = 0;

  if (row.oppId.startsWith(SEED_OPP_PREFIX)) {
    evidence.push(`opportunity id matches the sequential seed-fixture prefix '${SEED_OPP_PREFIX}…'`);
    syntheticSignals += 1;
  }
  if (row.projectId && row.projectId.startsWith(SEED_PROJECT_PREFIX)) {
    evidence.push(`linked project id matches the seed-fixture prefix '${SEED_PROJECT_PREFIX}…'`);
    syntheticSignals += 1;
  }
  if (row.clientId && row.clientId.startsWith(SEED_CLIENT_PREFIX)) {
    evidence.push(`client id matches the seed-fixture prefix '${SEED_CLIENT_PREFIX}…'`);
    syntheticSignals += 1;
  }
  if (row.companyName && /maverick|fightertown|o'?club|top\s?gun/i.test(`${row.companyName} ${row.clientName ?? ""}`)) {
    evidence.push(`company/client names read as fictional seed data ('${row.companyName}' / '${row.clientName ?? "—"}')`);
    syntheticSignals += 1;
  }
  if (!row.clientEmail || row.clientEmail.endsWith("@email.com")) {
    evidence.push(`client email is blank or a placeholder ('${row.clientEmail ?? "—"}')`);
  }

  const synthetic = syntheticSignals >= 2;
  if (synthetic) {
    evidence.push(
      "MULTIPLE synthetic signals => this is seed/test data, NOT a real customer. Writing production-shaped FK links onto a test fixture would be wrong; safest is to leave it (it is harmless: project_id has no FK and the conversion RPC makes new drift impossible) or delete the seed rows if the operator is pruning fixtures."
    );
  } else {
    evidence.push(
      "Insufficient synthetic signals — treat as potentially real; operator must inspect before any action."
    );
  }

  return {
    ...row,
    synthetic,
    evidence,
    recommendation: synthetic ? "leave" : "operator-decide",
  };
}

function renderArtifact(rows: DriftAssessment[]): string {
  const synthetic = rows.filter((r) => r.synthetic);
  const nonSynthetic = rows.filter((r) => !r.synthetic);

  const lines: string[] = [];
  lines.push("# Lead Lifecycle P6 — Seed-Drift Reconciliation (Dry Run / Report)");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("Workstream: p6-seed-drift (deferred P6 data step — report only)");
  lines.push("Supabase project: ijeekuhbatykdomumfjx (production)");
  lines.push("Mode: dry-run (read-only) — NO write path exists in this script by design");
  lines.push("");

  lines.push("## Summary — verified-live counts");
  lines.push("");
  lines.push(`- Opportunities with project_id set AND project_ref NULL (the 11-vs-8 drift gap): **${rows.length}**`);
  lines.push(`- Confirmed synthetic seed/test rows (≥2 synthetic signals): **${synthetic.length}**`);
  lines.push(`- Rows needing operator inspection (not confidently synthetic): **${nonSynthetic.length}**`);
  lines.push("");
  lines.push(`Recommendation for the synthetic rows: **leave or delete the seed rows — do NOT backfill production-shaped links onto test data.** Leaving them is harmless (project_id carries no FK, and the P6 conversion RPC writes all four link columns atomically, so no NEW drift can arise). Deleting them is only appropriate if the operator is pruning seed fixtures wholesale.`);
  lines.push("");

  lines.push("## Apply-mode table allow-list");
  lines.push("");
  lines.push("**NONE.** This report never writes any table. There is no destructive apply path: leave-or-delete is an explicit operator decision, not an automated one.");
  lines.push("");

  lines.push("## Hard-Stop Proof");
  lines.push("");
  lines.push("- Mode: dry-run (READ-ONLY).");
  lines.push("- Writes performed: NO. Zero UPDATE/INSERT/DELETE issued.");
  lines.push("- Rows deleted: no. Rows backfilled (project_ref / opportunity_ref): no.");
  lines.push("- Emails sent: no. Provider drafts created: no.");
  lines.push("- Auto-decision made: no — every row carries a recommendation + evidence for the operator.");
  lines.push("- Business state: untouched.");
  lines.push("");

  lines.push("## Per-row assessment");
  lines.push("");
  lines.push("| opportunity_id | title | stage | company | client | project_id | project_title | project_created | backlink_text | opp_deleted | opp_archived | synthetic | recommendation |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    lines.push(
      `| ${md(r.oppId)} | ${md(r.oppTitle)} | ${md(r.stage)} | ${md(r.companyName)} | ${md(r.clientName)} | ${md(r.projectId)} | ${md(r.projectTitle)} | ${md(r.projectCreatedAt)} | ${md(r.projectBacklinkText)} | ${r.oppDeleted ? "yes" : "no"} | ${r.oppArchived ? "yes" : "no"} | ${r.synthetic ? "yes" : "no"} | ${md(r.recommendation)} |`
    );
  }
  lines.push("");

  lines.push("## Evidence per row");
  lines.push("");
  for (const r of rows) {
    lines.push(`### \`${md(r.oppId)}\` — recommendation: **${r.recommendation}**`);
    lines.push("");
    for (const e of r.evidence) lines.push(`- ${e}`);
    lines.push("");
  }

  lines.push("## If the operator instead chooses to backfill (NOT done here)");
  lines.push("");
  lines.push("Per release runbook §6.4, the backfill path would be, per row, one idempotent transaction:");
  lines.push("");
  lines.push("```sql");
  lines.push("-- per drift row (operator-run, not by this script)");
  lines.push("UPDATE opportunities SET project_ref = project_id WHERE id = '<opp>' AND project_ref IS NULL;");
  lines.push("UPDATE projects SET opportunity_id = '<opp>'::text WHERE id = '<project>';");
  lines.push("-- optional: write a converted_to_project disposition row");
  lines.push("```");
  lines.push("");
  lines.push("Then re-run the dry-run to assert convergence (11 = 11 = 11). Because these are synthetic fixtures, the recommended action remains **leave or delete**, not backfill.");
  lines.push("");

  return lines.join("\n");
}

async function writeArtifact(markdown: string) {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, markdown);
}

async function main() {
  if (APPLY) {
    console.error(
      "REFUSED: this is a report-only script. There is no write/apply path by design — leave-or-delete is an operator decision. Run without --apply."
    );
    process.exit(1);
  }

  const rows = await fetchDriftRows();
  const assessed = rows.map(assess);
  await writeArtifact(renderArtifact(assessed));

  console.log(`Artifact write: ${OUTPUT_PATH}`);
  console.log("Mode: dry-run (read-only, report-only)");
  console.log(
    `Drift rows: ${assessed.length} | synthetic: ${assessed.filter((r) => r.synthetic).length} | operator-decide: ${assessed.filter((r) => !r.synthetic).length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
