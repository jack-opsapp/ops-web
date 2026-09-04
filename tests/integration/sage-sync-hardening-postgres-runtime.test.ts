import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = resolve(__dirname, "../..");
const RUN_POSTGRES = process.env.OPS_RUN_SAGE_POSTGRES_RUNTIME === "1";
const PSQL =
  process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const CREATEDB =
  process.env.OPS_CREATEDB_BIN ?? join(dirname(PSQL), "createdb");
const DROPDB = process.env.OPS_DROPDB_BIN ?? join(dirname(PSQL), "dropdb");
const PG_HOST = process.env.OPS_PGHOST ?? "/tmp";
const PG_PORT = process.env.OPS_PGPORT ?? "55433";
const PG_USER = process.env.OPS_PGUSER ?? process.env.USER ?? "postgres";
const TIMEOUT_MS = 30_000;

function assertSafeTarget(): void {
  const localSocket =
    isAbsolute(PG_HOST) &&
    (PG_HOST === "/tmp" ||
      PG_HOST.startsWith("/tmp/") ||
      PG_HOST === "/private/tmp" ||
      PG_HOST.startsWith("/private/tmp/"));
  const port = Number(PG_PORT);
  if (
    !localSocket ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    port === 5_432
  ) {
    throw new Error(
      "Sage PostgreSQL runtime requires a local socket and non-default port"
    );
  }
}

function databaseArgs(database?: string): string[] {
  return ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER].concat(
    database ? ["-d", database] : []
  );
}

async function runFile(database: string, file: string): Promise<void> {
  await execFileAsync(
    PSQL,
    databaseArgs(database).concat("-X", "-v", "ON_ERROR_STOP=1", "-f", file),
    { cwd: ROOT, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
  );
}

async function query(database: string, sql: string): Promise<string> {
  const { stdout } = await execFileAsync(
    PSQL,
    databaseArgs(database).concat(
      "-X",
      "-Atq",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql
    ),
    { cwd: ROOT, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
  );
  return stdout.trim();
}

async function withDatabase(runtimeFile: string): Promise<void> {
  assertSafeTarget();
  const database = `sage_sync_runtime_${process.pid}_${randomBytes(4).toString("hex")}`;
  let created = false;
  try {
    const version = await query("postgres", "show server_version_num");
    expect(Number(version)).toBeGreaterThanOrEqual(170000);
    expect(Number(version)).toBeLessThan(180000);

    await execFileAsync(
      CREATEDB,
      databaseArgs().concat("-T", "template0", "-E", "UTF8", database),
      { cwd: ROOT, timeout: TIMEOUT_MS }
    );
    created = true;
    await runFile(
      database,
      join(ROOT, "tests/sql/sage-sync-hardening-postgres17-baseline.sql")
    );
    await runFile(
      database,
      join(
        ROOT,
        "supabase/migrations/20260904040000_sage_connection_identity_and_oauth.sql"
      )
    );
    await runFile(
      database,
      join(ROOT, "supabase/migrations/20260904050000_sage_queue_hardening.sql")
    );
    await runFile(
      database,
      join(ROOT, "supabase/migrations/20260904060000_sage_reconciliation.sql")
    );
    await runFile(database, join(ROOT, runtimeFile));
  } finally {
    if (created) {
      if (!/^sage_sync_runtime_[0-9]+_[0-9a-f]{8}$/.test(database)) {
        throw new Error("Refusing to drop an unexpected PostgreSQL database");
      }
      await execFileAsync(
        DROPDB,
        databaseArgs().concat("--if-exists", "--force", database),
        { cwd: ROOT, timeout: TIMEOUT_MS }
      );
    }
  }
}

describe.runIf(RUN_POSTGRES)("Sage OAuth PostgreSQL 17 runtime", () => {
  it("consumes secrets once and isolates Sage businesses and environments", async () => {
    await withDatabase("tests/sql/sage-sync-hardening-oauth-runtime.sql");
  });

  it("routes, orders, and safely recovers Sage queue work", async () => {
    await withDatabase("tests/sql/sage-sync-hardening-queue-runtime.sql");
  });

  it("reconciles full documents atomically without echoes or starvation", async () => {
    await withDatabase("tests/sql/sage-sync-hardening-reconcile-runtime.sql");
  });
});
