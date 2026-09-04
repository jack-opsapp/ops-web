import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = resolve(__dirname, "../..");
const RUN_POSTGRES = process.env.OPS_RUN_QBO_POSTGRES_RUNTIME === "1";
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
      "QuickBooks PostgreSQL runtime requires a local socket and non-default port"
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

async function withDatabase(label: string, runtimeFile: string): Promise<void> {
  assertSafeTarget();
  const database = `qbo_sync_${label}_${process.pid}_${randomBytes(4).toString("hex")}`;
  let created = false;
  try {
    const version = await query("postgres", "show server_version_num");
    expect(Number(version)).toBeGreaterThanOrEqual(170000);
    expect(Number(version)).toBeLessThan(180000);

    created = true;
    await execFileAsync(
      CREATEDB,
      databaseArgs().concat("-T", "template0", "-E", "UTF8", database),
      {
        cwd: ROOT,
        timeout: TIMEOUT_MS,
      }
    );
    await runFile(
      database,
      join(
        ROOT,
        "tests/sql/qbo-bidirectional-sync-hardening-postgres17-baseline.sql"
      )
    );
    await runFile(
      database,
      join(
        ROOT,
        "supabase/migrations/20260904025000_qbo_bidirectional_sync_hardening.sql"
      )
    );
    await runFile(database, join(ROOT, runtimeFile));
  } finally {
    if (created) {
      if (!/^qbo_sync_[a-z]+_[0-9]+_[0-9a-f]{8}$/.test(database)) {
        throw new Error("Refusing to drop an unexpected PostgreSQL database");
      }
      await execFileAsync(
        DROPDB,
        databaseArgs().concat("--if-exists", "--force", database),
        {
          cwd: ROOT,
          timeout: TIMEOUT_MS,
        }
      );
    }
  }
}

describe.runIf(RUN_POSTGRES)(
  "QuickBooks bidirectional sync PostgreSQL 17 runtime",
  () => {
    it("recalculates both invoices for payment moves and ignores identity-only writes", async () => {
      await withDatabase(
        "payment",
        "tests/sql/qbo-bidirectional-sync-hardening-payment-runtime.sql"
      );
    });

    it("holds dependent updates until their create succeeds", async () => {
      await withDatabase(
        "queue",
        "tests/sql/qbo-bidirectional-sync-hardening-queue-runtime.sql"
      );
    });

    it("interleaves active reconcile candidates and advances unseen records", async () => {
      await withDatabase(
        "reconcile",
        "tests/sql/qbo-bidirectional-sync-hardening-reconcile-runtime.sql"
      );
    });
  }
);
