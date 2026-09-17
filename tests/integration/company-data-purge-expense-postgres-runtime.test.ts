/**
 * Account closure with expense accounting data, on a disposable PostgreSQL 17
 * cluster built by scripts/test-company-data-purge-expense-postgres.sh.
 *
 * The template database carries every closure-path function, trigger, foreign
 * key and service_role privilege byte-identical to production (proved by
 * tests/sql/company-data-purge-expense-fidelity.sql) and two seeded companies.
 * Closure runs exactly as the delete-account route runs it: login
 * authenticator, role service_role, service claims, one call to
 * public.purge_company_data with the manifest's own plan, then COMMIT so the
 * deferred captures fire. The plan is the real transactionalPurgePlan(),
 * reduced to the tables this database models and kept in manifest order.
 */

import { execFile } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  transactionalPurgePlan,
  type TransactionalPurgePlan,
} from "@/lib/data/company-data-manifest";

const execFileAsync = promisify(execFile);
const ROOT = resolve(__dirname, "../..");
const RUN_POSTGRES = process.env.OPS_RUN_COMPANY_PURGE_POSTGRES === "1";
const PSQL = process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const PG_HOST = process.env.OPS_PGHOST ?? "/tmp";
const PG_PORT = process.env.OPS_PGPORT ?? "55495";
const TEMPLATE = process.env.OPS_PURGE_TEMPLATE_DB ?? "closure_seeded";
const TIMEOUT_MS = 120_000;
// Never inherit PGOPTIONS, PGSERVICE, passwords or application credentials.
const ENV: NodeJS.ProcessEnv = {
  NODE_ENV: process.env.NODE_ENV,
  PATH: process.env.PATH,
  LANG: "C",
  LC_ALL: "C",
};

const CLOSED = "72000000-0000-4000-8000-000000010001";
const BYSTANDER = "72000000-0000-4000-8000-000000020001";

const MIGRATION_AUTHORITY =
  "supabase/migrations/20260917050651_expense_authority_account_closure.sql";
const MIGRATION_LEDGERS =
  "supabase/migrations/20260917050826_expense_accounting_company_data_lifecycle.sql";

/** Every plan table this database models with production fidelity. */
const HARNESS_TABLES = new Set([
  "expense_project_allocations",
  "tryops_health_notifications",
  "expense_accounting_category_mappings",
  "expense_accounting_payee_mappings",
  "expense_accounting_postings",
  "expense_accounting_project_mappings",
  "expense_accounting_settings",
  "expense_accounting_tax_mappings",
  "accounting_connections",
  "accounting_sync_events",
  "accounting_sync_queue",
  "expense_settings",
  "expenses",
  "expense_accounting_events",
  "notifications",
  "projects",
  "users",
  "companies",
]);

/** Classified by this change; the manifest production serves today lacks them. */
const NEWLY_CLASSIFIED = new Set([
  "expense_accounting_category_mappings",
  "expense_accounting_events",
  "expense_accounting_payee_mappings",
  "expense_accounting_postings",
  "expense_accounting_project_mappings",
  "expense_accounting_settings",
  "expense_accounting_tax_mappings",
  "tryops_health_notifications",
]);

/** Retained on closure; the plan must never name them. */
const RETAINED = ["expense_batches", "expense_categories", "expense_recurring_reimbursements"];

function assertSafeTarget(): void {
  const localSocket =
    isAbsolute(PG_HOST) &&
    (PG_HOST === "/tmp" ||
      PG_HOST.startsWith("/tmp/") ||
      PG_HOST === "/private/tmp" ||
      PG_HOST.startsWith("/private/tmp/"));
  const port = Number(PG_PORT);
  if (!localSocket || !Number.isInteger(port) || port < 1 || port > 65_535 || port === 5_432) {
    throw new Error("Closure runtime requires a local socket and a non-default port");
  }
}

function connection(database: string, user = "postgres"): string[] {
  return ["-h", PG_HOST, "-p", PG_PORT, "-U", user, "-d", database, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
}

async function query(database: string, sql: string): Promise<string> {
  const { stdout } = await execFileAsync(PSQL, connection(database).concat("-c", sql), {
    env: ENV,
    timeout: TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function applyFile(database: string, file: string): Promise<void> {
  await execFileAsync(PSQL, connection(database).concat("-f", join(ROOT, file)), {
    env: ENV,
    timeout: TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** A fresh copy of the seeded template with the given migrations applied. */
async function database(name: string, migrations: string[]): Promise<string> {
  await query("template1", `drop database if exists ${name}`);
  await query("template1", `create database ${name} template ${TEMPLATE}`);
  for (const migration of migrations) await applyFile(name, migration);
  return name;
}

type PlanVariant = "manifest" | "production-today" | "ledger-before-expenses";

/** The manifest's plan, reduced to the tables this database models. */
type HarnessPlan = Omit<TransactionalPurgePlan, "cycle_breakers"> & {
  readonly cycle_breakers: readonly TransactionalPurgePlan["cycle_breakers"][number][];
};

function plan(variant: PlanVariant): HarnessPlan {
  const full = transactionalPurgePlan();
  let steps = full.steps.filter((step) => HARNESS_TABLES.has(step.table));
  if (variant === "production-today") {
    steps = steps.filter((step) => !NEWLY_CLASSIFIED.has(step.table));
  }
  if (variant === "ledger-before-expenses") {
    const ledger = steps.find((step) => step.table === "expense_accounting_events")!;
    steps = steps.filter((step) => step !== ledger);
    steps.splice(steps.findIndex((step) => step.table === "expenses"), 0, ledger);
  }
  // purge_company_data rejects a breaker whose table is not a step.
  const cycleBreakers = full.cycle_breakers.filter((breaker) => HARNESS_TABLES.has(breaker.table));
  return { ...full, steps, cycle_breakers: cycleBreakers };
}

interface ClosureOutcome {
  ok: boolean;
  receipt?: {
    manifest_version: string;
    completed_steps: number;
    total_steps: number;
    deleted_counts: Record<string, number>;
  };
  error?: string;
}

/** Closure exactly as the route runs it, then COMMIT (deferred triggers fire). */
async function closeAccount(name: string, closurePlan: HarnessPlan): Promise<ClosureOutcome> {
  const planJson = JSON.stringify(closurePlan);
  expect(planJson).not.toContain("$plan$");
  try {
    const { stdout } = await execFileAsync(
      PSQL,
      connection(name, "authenticator").concat(
        "-c", "begin",
        "-c", "set local role service_role",
        "-c", `select null from pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true)`,
        "-c", `select 'receipt=' || public.purge_company_data('${CLOSED}'::uuid, $plan$${planJson}$plan$::jsonb)::text`,
        "-c", "commit"
      ),
      { env: ENV, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    );
    const line = stdout.split("\n").find((entry) => entry.startsWith("receipt="));
    expect(line, "closure returned no receipt").toBeDefined();
    return { ok: true, receipt: JSON.parse(line!.slice("receipt=".length)) };
  } catch (failure) {
    const stderr = (failure as { stderr?: string }).stderr ?? String(failure);
    return { ok: false, error: stderr };
  }
}

/** Rows the closed company still owns, per table, after COMMIT. */
async function remaining(name: string, company: string, seedKey: number): Promise<Record<string, number>> {
  const json = await query(
    name,
    `select json_build_object(
      'expense_accounting_settings', (select count(*) from public.expense_accounting_settings where company_id = '${company}'),
      'expense_accounting_payee_mappings', (select count(*) from public.expense_accounting_payee_mappings where company_id = '${company}'),
      'expense_accounting_category_mappings', (select count(*) from public.expense_accounting_category_mappings where company_id = '${company}'),
      'expense_accounting_project_mappings', (select count(*) from public.expense_accounting_project_mappings where company_id = '${company}'),
      'expense_accounting_tax_mappings', (select count(*) from public.expense_accounting_tax_mappings where company_id = '${company}'),
      'expense_accounting_postings', (select count(*) from public.expense_accounting_postings where company_id = '${company}'),
      'expense_accounting_events', (select count(*) from public.expense_accounting_events where company_id = '${company}'),
      'private_expense_accounting_state', (select count(*) from private.expense_accounting_state where company_id = '${company}'),
      'accounting_sync_queue', (select count(*) from public.accounting_sync_queue where company_id = '${company}'),
      'accounting_sync_events', (select count(*) from public.accounting_sync_events where company_id = '${company}'),
      'accounting_connections', (select count(*) from public.accounting_connections where company_id = '${company}'),
      'expense_settings', (select count(*) from public.expense_settings where company_id = '${company}'),
      'expense_project_allocations', (select count(*) from public.expense_project_allocations a join public.expenses e on e.id = a.expense_id where e.company_id = '${company}'),
      'notifications', (select count(*) from public.notifications where company_id = '${company}'),
      'tryops_health_notifications', (select count(*) from public.tryops_health_notifications where dedupe_key = 'closure-health-${seedKey}'),
      'expenses_live', (select count(*) from public.expenses where company_id = '${company}' and deleted_at is null),
      'expenses_total', (select count(*) from public.expenses where company_id = '${company}'),
      'users_live', (select count(*) from public.users where company_id = '${company}' and deleted_at is null),
      'projects_live', (select count(*) from public.projects where company_id = '${company}' and deleted_at is null),
      'company_live', (select count(*) from public.companies where id = '${company}' and deleted_at is null),
      'expense_batches', (select count(*) from public.expense_batches where company_id = '${company}'),
      'expense_categories', (select count(*) from public.expense_categories where company_id = '${company}'),
      'expense_recurring_reimbursements_live', (select count(*) from public.expense_recurring_reimbursements where company_id = '${company}' and deleted_at is null)
    )::text`
  );
  return JSON.parse(json);
}

/** Every row the bystander owns across the closure path, as one digest. */
async function fingerprint(name: string, company: string): Promise<string> {
  return query(
    name,
    `select md5(string_agg(entry, '|' order by entry)) from (
      select 'companies:' || row_to_json(x)::text as entry from public.companies x where x.id = '${company}'
      union all select 'users:' || row_to_json(x)::text from public.users x where x.company_id = '${company}'
      union all select 'projects:' || row_to_json(x)::text from public.projects x where x.company_id = '${company}'
      union all select 'expenses:' || row_to_json(x)::text from public.expenses x where x.company_id = '${company}'
      union all select 'allocations:' || row_to_json(a)::text from public.expense_project_allocations a join public.expenses e on e.id = a.expense_id where e.company_id = '${company}'
      union all select 'batches:' || row_to_json(x)::text from public.expense_batches x where x.company_id = '${company}'
      union all select 'categories:' || row_to_json(x)::text from public.expense_categories x where x.company_id = '${company}'
      union all select 'settings:' || row_to_json(x)::text from public.expense_settings x where x.company_id = '${company}'
      union all select 'recurring:' || row_to_json(x)::text from public.expense_recurring_reimbursements x where x.company_id = '${company}'
      union all select 'connections:' || row_to_json(x)::text from public.accounting_connections x where x.company_id = '${company}'
      union all select 'queue:' || row_to_json(x)::text from public.accounting_sync_queue x where x.company_id = '${company}'
      union all select 'sync_events:' || row_to_json(x)::text from public.accounting_sync_events x where x.company_id = '${company}'
      union all select 'notifications:' || row_to_json(x)::text from public.notifications x where x.company_id = '${company}'
      union all select 'health:' || row_to_json(h)::text from public.tryops_health_notifications h join public.notifications n on n.id = h.notification_id where n.company_id = '${company}'
      union all select 'ea_settings:' || row_to_json(x)::text from public.expense_accounting_settings x where x.company_id = '${company}'
      union all select 'ea_payees:' || row_to_json(x)::text from public.expense_accounting_payee_mappings x where x.company_id = '${company}'
      union all select 'ea_categories:' || row_to_json(x)::text from public.expense_accounting_category_mappings x where x.company_id = '${company}'
      union all select 'ea_projects:' || row_to_json(x)::text from public.expense_accounting_project_mappings x where x.company_id = '${company}'
      union all select 'ea_taxes:' || row_to_json(x)::text from public.expense_accounting_tax_mappings x where x.company_id = '${company}'
      union all select 'ea_events:' || row_to_json(x)::text from public.expense_accounting_events x where x.company_id = '${company}'
      union all select 'ea_postings:' || row_to_json(x)::text from public.expense_accounting_postings x where x.company_id = '${company}'
      union all select 'ea_state:' || row_to_json(x)::text from private.expense_accounting_state x where x.company_id = '${company}'
    ) digest`
  );
}

describe.skipIf(!RUN_POSTGRES)("account closure with expense accounting data (disposable PostgreSQL 17)", () => {
  it("builds every plan from the real manifest, in manifest order", () => {
    const steps = transactionalPurgePlan().steps.map((step) => step.table);
    for (const table of HARNESS_TABLES) expect(steps, table).toContain(table);
    for (const table of RETAINED) expect(steps, table).not.toContain(table);
    const reduced = plan("manifest").steps.map((step) => step.table);
    expect(reduced).toEqual(steps.filter((table) => HARNESS_TABLES.has(table)));
    expect(reduced[reduced.length - 1]).toBe("companies");
  });

  it("reproduces today's production failure: the authority triggers refuse closure", async () => {
    assertSafeTarget();
    const name = await database("closure_today", []);
    const before = await remaining(name, CLOSED, 1);

    const outcome = await closeAccount(name, plan("production-today"));

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("(purge expense_project_allocations) failed: Expense access denied");
    expect(await remaining(name, CLOSED, 1), "the failed closure rolled back").toEqual(before);
  }, TIMEOUT_MS);

  it("with the authority repair alone, today's manifest still cannot close the account", async () => {
    assertSafeTarget();
    const name = await database("closure_authority_only", [MIGRATION_AUTHORITY]);
    const today = plan("production-today");

    // Frozen provider postings block the connection purge.
    const blocked = await closeAccount(name, today);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("(purge accounting_connections) failed");
    expect(blocked.error).toContain("expense_accounting_postings");

    // Without postings, the Try OPS receipt blocks the notification purge.
    await query(name, `delete from public.expense_accounting_postings where company_id = '${CLOSED}'`);
    const receiptBlocked = await closeAccount(name, today);
    expect(receiptBlocked.ok).toBe(false);
    expect(receiptBlocked.error).toContain("(purge notifications) failed");
    expect(receiptBlocked.error).toContain("tryops_health_notifications");

    // Without either, closure "succeeds" and silently keeps the financial history.
    await query(name, `delete from public.tryops_health_notifications where dedupe_key = 'closure-health-1'`);
    const silent = await closeAccount(name, today);
    expect(silent.ok, silent.error).toBe(true);
    const left = await remaining(name, CLOSED, 1);
    expect(left.company_live).toBe(0);
    expect(left.expense_accounting_events).toBeGreaterThan(0);
    expect(left.private_expense_accounting_state).toBeGreaterThan(0);
  }, TIMEOUT_MS);

  it("purging the event ledger before expenses are tombstoned leaves history behind", async () => {
    assertSafeTarget();
    const name = await database("closure_ledger_first", [MIGRATION_AUTHORITY, MIGRATION_LEDGERS]);

    const outcome = await closeAccount(name, plan("ledger-before-expenses"));

    expect(outcome.ok, outcome.error).toBe(true);
    const left = await remaining(name, CLOSED, 1);
    // Tombstoning re-captures every expense whose state was already erased.
    expect(left.expense_accounting_events).toBeGreaterThan(0);
    expect(left.private_expense_accounting_state).toBeGreaterThan(0);
  }, TIMEOUT_MS);

  it("without the capture flush, COMMIT re-creates private accounting state", async () => {
    assertSafeTarget();
    const name = await database("closure_no_flush", [MIGRATION_AUTHORITY, MIGRATION_LEDGERS]);
    // The trigger keeps firing at COMMIT; only the helper's flush lookup misses.
    await query(
      name,
      "alter table public.expense_project_allocations rename constraint zz_capture_expense_accounting_allocation to zz_capture_expense_accounting_allocation_control"
    );

    const outcome = await closeAccount(name, plan("manifest"));

    expect(outcome.ok, outcome.error).toBe(true);
    const left = await remaining(name, CLOSED, 1);
    expect(left.private_expense_accounting_state).toBeGreaterThan(0);
  }, TIMEOUT_MS);

  it("keeps refusing API clients after the authority repair", async () => {
    assertSafeTarget();
    const name = await database("closure_clients", [MIGRATION_AUTHORITY, MIGRATION_LEDGERS]);
    const crew = JSON.stringify({ sub: "closure-crew-2", role: "authenticated" });
    const asCrew = async (statement: string): Promise<string> => {
      try {
        await execFileAsync(
          PSQL,
          connection(name, "authenticator").concat(
            "-c", "begin",
            "-c", "set local role authenticated",
            "-c", `select null from pg_catalog.set_config('request.jwt.claims', '${crew}', true)`,
            "-c", statement,
            "-c", "commit"
          ),
          { env: ENV, timeout: TIMEOUT_MS }
        );
        return "accepted";
      } catch (failure) {
        return (failure as { stderr?: string }).stderr ?? String(failure);
      }
    };
    const expense = (item: number) => `72000000-0000-4000-8000-${String(20000 + item).padStart(12, "0")}`;

    expect(
      await asCrew(`update public.expenses set status = 'approved' where id = '${expense(203)}'`)
    ).toContain("Expense approval is required");
    expect(
      await asCrew(`update public.expense_project_allocations set amount = 1 where id = '${expense(300)}'`)
    ).toContain("An approver must correct approved expense accounting");
    expect(
      await asCrew(`update public.expenses set receipt_missing_note = 'edited' where id = '${expense(206)}'`)
    ).toContain("Recurring reimbursements change from their setup");
  }, TIMEOUT_MS);

  it("closes the account completely with both repairs and the manifest's order", async () => {
    assertSafeTarget();
    const name = await database("closure_repaired", [MIGRATION_AUTHORITY, MIGRATION_LEDGERS]);
    const before = await remaining(name, CLOSED, 1);
    const bystanderBefore = await fingerprint(name, BYSTANDER);
    const closurePlan = plan("manifest");

    const outcome = await closeAccount(name, closurePlan);

    expect(outcome.ok, outcome.error).toBe(true);
    const receipt = outcome.receipt!;
    expect(receipt.manifest_version).toBe(closurePlan.manifest_version);
    expect(receipt.completed_steps).toBe(closurePlan.steps.length);
    expect(receipt.total_steps).toBe(closurePlan.steps.length);
    expect(Object.keys(receipt.deleted_counts).sort()).toEqual(
      closurePlan.steps.map((step) => step.table).sort()
    );
    for (const table of [
      "expense_accounting_settings",
      "expense_accounting_payee_mappings",
      "expense_accounting_category_mappings",
      "expense_accounting_project_mappings",
      "expense_accounting_tax_mappings",
      "expense_accounting_postings",
    ]) {
      expect(receipt.deleted_counts[table], table).toBe(before[table]);
    }
    // Tombstoning appends reversal and review events before the ledger step.
    expect(receipt.deleted_counts.expense_accounting_events).toBeGreaterThan(
      before.expense_accounting_events
    );

    const after = await remaining(name, CLOSED, 1);
    for (const erased of [
      "expense_accounting_settings",
      "expense_accounting_payee_mappings",
      "expense_accounting_category_mappings",
      "expense_accounting_project_mappings",
      "expense_accounting_tax_mappings",
      "expense_accounting_postings",
      "expense_accounting_events",
      "private_expense_accounting_state",
      "accounting_sync_queue",
      "accounting_sync_events",
      "accounting_connections",
      "expense_settings",
      "expense_project_allocations",
      "notifications",
      "tryops_health_notifications",
      "expenses_live",
      "users_live",
      "projects_live",
      "company_live",
    ]) {
      expect(after[erased], `${erased} after closure`).toBe(0);
    }
    expect(after.expenses_total, "expenses are tombstoned, not erased").toBe(before.expenses_total);
    expect(after.expense_batches).toBe(before.expense_batches);
    expect(after.expense_categories).toBe(before.expense_categories);
    expect(after.expense_recurring_reimbursements_live).toBe(
      before.expense_recurring_reimbursements_live
    );

    expect(await fingerprint(name, BYSTANDER), "the bystander company is untouched").toBe(
      bystanderBefore
    );
  }, TIMEOUT_MS);
});
