import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = resolve(__dirname, "../..");
const RUN_POSTGRES = process.env.OPS_RUN_EXPENSE_AUTHORITY_POSTGRES === "1";
const PSQL = process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const PG_HOST = process.env.OPS_PGHOST ?? "/tmp";
const PG_PORT = process.env.OPS_PGPORT ?? "55433";
const PG_USER = process.env.OPS_PGUSER ?? process.env.USER ?? "postgres";
const TIMEOUT_MS = 30_000;
// Do not inherit PGOPTIONS, PGSERVICE, passwords, or application credentials.
const ENV = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" };

function assertSafeTarget(): void {
  const localSocket = isAbsolute(PG_HOST) &&
    (PG_HOST === "/tmp" || PG_HOST.startsWith("/tmp/") ||
     PG_HOST === "/private/tmp" || PG_HOST.startsWith("/private/tmp/"));
  const port = Number(PG_PORT);
  if (!localSocket || !Number.isInteger(port) || port < 1 || port > 65_535 || port === 5_432) {
    throw new Error("Expense authority runtime requires a local socket and non-default port");
  }
}
function databaseArgs(database?: string): string[] {
  return ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER].concat(database ? ["-d", database] : []);
}
async function runFile(database: string, file: string, repaired = false): Promise<void> {
  const { stdout } = await execFileAsync(PSQL, databaseArgs(database).concat(
    "-X", "-v", "ON_ERROR_STOP=1", "-v", `expense_repaired=${repaired}`, "-f", join(ROOT, file)
  ), { cwd: ROOT, env: ENV, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
  const report = stdout.match(/\d+ expense decision authority cases passed/);
  if (report) console.info(`${repaired ? "Repaired" : "Baseline"}: ${report[0]}`);
}
async function query(database: string, sql: string, applicationName?: string): Promise<string> {
  const { stdout } = await execFileAsync(PSQL, databaseArgs(database).concat(
    "-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c", sql
  ), { env: { ...ENV, PGAPPNAME: applicationName }, timeout: TIMEOUT_MS });
  return stdout.trim();
}
const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));

async function checkConcurrentSaveLockOrder(
  database: string,
  mode: "canonical_save" | "direct_same_child" | "direct_refile",
  exhaustRetry = false
): Promise<void> {
  // Reproduce the exact existing save lock order with real rows and the real
  // recalculation function. This is not full save_expense_atomic RPC coverage.
  const company = randomUUID();
  const actor = randomUUID();
  const batch = randomUUID();
  const expense = randomUUID();
  const sourceBatch = randomUUID();
  const sourceExpense = randomUUID();
  const subject = `expense-lock-${actor}`;
  const jwt = JSON.stringify({ sub: subject, role: "authenticated" });
  await query(database, `
    insert into public.companies(id) values ('${company}');
    insert into public.users(id,company_id,firebase_uid,is_active,is_company_admin)
      values ('${actor}','${company}','${subject}',true,true);
    insert into public.expense_batches(id,company_id,submitted_by,status,total_amount,amendment_number,period_start,period_end)
      values ('${batch}','${company}','${actor}','open',10,0,
        date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month - 1 day')::date);
    insert into public.expenses(id,company_id,submitted_by,batch_id,status,amount,expense_date)
      values ('${expense}','${company}','${actor}','${batch}','submitted',10,current_date);
  `);
  if (mode === "direct_refile") {
    await query(database, `
      insert into public.expense_batches(id,company_id,submitted_by,status,total_amount,amendment_number,period_start,period_end)
        values ('${sourceBatch}','${company}','${actor}','open',10,0,current_date-60,current_date-30);
      insert into public.expenses(id,company_id,submitted_by,batch_id,status,amount,expense_date)
        values ('${sourceExpense}','${company}','${actor}','${sourceBatch}','submitted',10,current_date);
    `);
  }
  const snapshot = () => query(database, `select jsonb_build_array(
    (select jsonb_agg(to_jsonb(e) order by id) from public.expenses e where company_id='${company}'),
    (select jsonb_agg(to_jsonb(b) order by id) from public.expense_batches b where company_id='${company}'),
    (select jsonb_agg(to_jsonb(n) order by id) from public.notifications n where company_id='${company}'),
    (select jsonb_agg(to_jsonb(r) order by domain) from private.agent_read_domain_revisions r where company_id='${company}')
  )::text`);
  const writer = spawn(PSQL, databaseArgs(database).concat(
    "-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"
  ), { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
  let writerOutput = "";
  let writerError = "";
  writer.stdout.on("data", (chunk: Buffer) => { writerOutput += chunk.toString(); });
  writer.stderr.on("data", (chunk: Buffer) => { writerError += chunk.toString(); });
  const writerDone = new Promise<number | null>((resolveExit) => {
    writer.once("exit", resolveExit);
    writer.once("error", (error) => { writerError += error.message; resolveExit(-1); });
  });
  const appName = `expense_approval_${randomBytes(5).toString("hex")}`;
  const approve = () => query(database, `
    begin;
    select set_config('request.jwt.claims','${jwt}',true);
    set local role authenticated;
    select public.approve_expense_batch('${batch}');
    commit;
  `, appName);
  let approval: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  try {
    writer.stdin.write(`begin;
      select set_config('request.jwt.claims','${jwt}',true);
      ${mode === "canonical_save" ? `select pg_advisory_xact_lock(hashtextextended('save_expense_atomic:${company}',0));` : ""}
      ${mode === "direct_refile"
        ? `update public.expenses set amount=20 where id='${sourceExpense}';`
        : `select id from public.expenses where id='${expense}' for update;`}
      select 'expense_writer_child_locked';
    `);
    const writerDeadline = Date.now() + 5_000;
    while (!writerOutput.includes("expense_writer_child_locked") && Date.now() < writerDeadline) {
      await delay(10);
    }
    expect(writerOutput, writerError).toContain("expense_writer_child_locked");
    const beforeDecision = await snapshot();
    approval = approve().then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
    const observerDeadline = Date.now() + 5_000;
    let waiting = "";
    while (!waiting && Date.now() < observerDeadline) {
      waiting = await query(database, `select coalesce(wait_event,'') from pg_stat_activity
        where application_name='${appName}' and (wait_event='PgSleep' or wait_event_type='Lock')`);
      if (!waiting) await delay(10);
    }
    // Either a bounded lock wait or the delay after a fully rolled-back attempt.
    // A direct refiler holds revision locks before it requests the destination.
    expect(waiting).not.toBe("");
    expect(await query(database, `select e.status||':'||e.amount||':'||b.status||':'||b.total_amount
      from public.expenses e join public.expense_batches b on b.id=e.batch_id where e.id='${expense}'`))
      .toBe("submitted:10:open:10");

    if (exhaustRetry) {
      const outcome = await approval;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(String(outcome.error)).toContain("40001");
      expect(await snapshot()).toBe(beforeDecision);
    }
    writer.stdin.end(mode === "direct_refile" ? `
      update public.expenses set status='submitted',batch_id=null where id='${sourceExpense}';
      select public.recalculate_expense_batch_total('${sourceBatch}');
      commit;
    ` : `
      update public.expenses set amount=20 where id='${expense}';
      select public.recalculate_expense_batch_total('${batch}');
      commit;
    `);
    expect(await writerDone, writerError).toBe(0);
    expect(writerError).not.toContain("40P01");
    if (exhaustRetry) {
      await approve();
    } else {
      const outcome = await approval;
      expect(outcome.ok, outcome.ok ? "" : String(outcome.error)).toBe(true);
    }
    expect(await query(database, `select e.status||':'||e.amount||':'||b.status||':'||b.total_amount
      from public.expenses e join public.expense_batches b on b.id=e.batch_id where e.id='${expense}'`))
      .toBe(mode === "direct_refile" ? "approved:10:approved:30" : "approved:20:approved:20");
    if (mode === "direct_refile") {
      expect(await query(database, `select status||':'||amount||':'||(batch_id='${batch}')::text
        from public.expenses where id='${sourceExpense}'`)).toBe("approved:20:true");
    }
    console.info(exhaustRetry
      ? "PASS: bounded 40001 rolls back decision and revision effects; retry succeeds after direct refiling"
      : `PASS: concurrent ${mode} and approval both commit without deadlock`);
  } finally {
    if (writer.exitCode === null) writer.kill("SIGTERM");
    await writerDone;
    // Always observe any in-flight rejection before the disposable DB closes.
    if (approval) await approval;
  }
}

describe.runIf(RUN_POSTGRES)("Expense decision company authority PostgreSQL 17 runtime", () => {
  it("reproduces current foreign writes, then rejects them while preserving authorized effects", async () => {
    assertSafeTarget();
    const database = `expense_auth_runtime_${process.pid}_${randomBytes(4).toString("hex")}`;
    let created = false;
    try {
      const { stdout } = await execFileAsync(PSQL, databaseArgs("postgres").concat(
        "-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", "show server_version_num"
      ), { env: ENV, timeout: TIMEOUT_MS });
      expect(Number(stdout.trim())).toBeGreaterThanOrEqual(170000);
      expect(Number(stdout.trim())).toBeLessThan(180000);
      await execFileAsync(join(dirname(PSQL), "createdb"), databaseArgs().concat(
        "-T", "template0", "-E", "UTF8", database
      ), { env: ENV, timeout: TIMEOUT_MS });
      created = true;
      await runFile(database, "tests/sql/expense-decision-authority-baseline.sql");
      const runtime = "tests/sql/expense-decision-authority-runtime.sql";
      await runFile(database, runtime);
      // Prove the repaired expectation actually fails against the old functions.
      await expect(runFile(database, runtime, true)).rejects.toThrow(/foreign payout result: allowed/);
      const migration = "supabase/migrations/20260912012607_expense_decision_company_authority.sql";
      await runFile(database, migration);
      await runFile(database, migration);
      await runFile(database, runtime, true);
      await checkConcurrentSaveLockOrder(database, "canonical_save");
      await checkConcurrentSaveLockOrder(database, "direct_same_child");
      await checkConcurrentSaveLockOrder(database, "direct_refile");
      await checkConcurrentSaveLockOrder(database, "direct_refile", true);
    } finally {
      if (created) {
        if (!/^expense_auth_runtime_[0-9]+_[0-9a-f]{8}$/.test(database)) {
          throw new Error("Refusing to drop an unexpected PostgreSQL database");
        }
        await execFileAsync(join(dirname(PSQL), "dropdb"), databaseArgs().concat(
          "--if-exists", "--force", database
        ), { env: ENV, timeout: TIMEOUT_MS });
      }
    }
  }, 60_000);
});
