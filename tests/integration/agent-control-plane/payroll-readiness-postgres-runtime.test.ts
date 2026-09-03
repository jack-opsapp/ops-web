import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const RUNNER_FILE = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(RUNNER_FILE), "../../..");
const FILES = [
  [
    "tests/sql/agent-payroll-readiness-setup.sql",
    "a1832f4746a1a035f189181ff36a56316efd5874d29e8067b276a8608758c03b",
  ],
  [
    "supabase/migrations/20260901190000_agent_payroll_readiness.sql",
    "77a355c27dd5f4ddeadd2e5cd82009be90a7d3a470c268c573f294307b83d7b7",
  ],
  [
    "tests/sql/agent-payroll-readiness-runtime.sql",
    "f2a71c6f9b041bdae5000b6d2279a52e808f7e4a753924fb52910c8a5210bf7e",
  ],
] as const;
const RUN_POSTGRES =
  process.env.OPS_RUN_PAYROLL_READINESS_POSTGRES_RUNTIME === "1";
const PSQL =
  process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const CREATEDB =
  process.env.OPS_CREATEDB_BIN ?? join(dirname(PSQL), "createdb");
const DROPDB = process.env.OPS_DROPDB_BIN ?? join(dirname(PSQL), "dropdb");
const PG_HOST = process.env.OPS_PGHOST ?? "/tmp";
const PG_PORT = process.env.OPS_PGPORT ?? "55442";
const PG_USER = process.env.OPS_PGUSER ?? process.env.USER ?? "postgres";
const FILE_TIMEOUT_MS = 120_000;
const LIFECYCLE_TIMEOUT_MS = 30_000;

function assertSafeLocalPostgresTarget(host: string, port: string): void {
  let canonicalHost: string;
  const loopback = host === "127.0.0.1" || host === "::1";
  try {
    canonicalHost = loopback ? host : realpathSync.native(host);
  } catch {
    throw new Error(
      "payroll-readiness runtime requires a local temporary socket"
    );
  }
  const localSocket =
    isAbsolute(host) &&
    (canonicalHost === "/tmp" ||
      canonicalHost.startsWith("/tmp/") ||
      canonicalHost === "/private/tmp" ||
      canonicalHost.startsWith("/private/tmp/"));
  if (!localSocket && !loopback) {
    throw new Error(
      "payroll-readiness runtime requires a local temporary socket"
    );
  }
  const numericPort = Number(port);
  if (
    !/^[0-9]{1,5}$/.test(port) ||
    !Number.isSafeInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65_535 ||
    numericPort === 5_432
  ) {
    throw new Error(
      "payroll-readiness runtime requires a non-default test port"
    );
  }
}

function databaseName(): string {
  return `payroll_readiness_${process.pid}_${randomBytes(6).toString("hex")}`;
}

function databaseArgs(database?: string): string[] {
  return ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER].concat(
    database ? ["-d", database] : []
  );
}

async function runFile(database: string, path: string): Promise<void> {
  await execFileAsync(
    PSQL,
    databaseArgs(database).concat("-X", "-v", "ON_ERROR_STOP=1", "-f", path),
    {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      timeout: FILE_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }
  );
}

async function runSql(database: string, sql: string): Promise<void> {
  await execFileAsync(
    PSQL,
    databaseArgs(database).concat("-X", "-v", "ON_ERROR_STOP=1", "-c", sql),
    {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      timeout: FILE_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }
  );
}

async function createDatabase(database: string): Promise<void> {
  await execFileAsync(
    CREATEDB,
    databaseArgs().concat("-T", "template0", "-E", "UTF8", database),
    { cwd: ROOT, timeout: LIFECYCLE_TIMEOUT_MS, killSignal: "SIGTERM" }
  );
}

async function dropDatabase(database: string): Promise<void> {
  if (!/^payroll_readiness_[0-9]+_[0-9a-f]{12}$/.test(database)) {
    throw new Error(
      `refusing to drop non-payroll-readiness database: ${database}`
    );
  }
  await execFileAsync(
    DROPDB,
    databaseArgs().concat("--if-exists", "--force", database),
    { cwd: ROOT, timeout: LIFECYCLE_TIMEOUT_MS, killSignal: "SIGTERM" }
  );
}

type Outcome =
  | { readonly failed: false }
  | { readonly failed: true; readonly error: unknown };

async function settleWithCleanup(
  primary: Outcome,
  cleanup: (() => Promise<void>) | undefined
): Promise<void> {
  let cleanupOutcome: Outcome = { failed: false };
  if (cleanup) {
    try {
      await cleanup();
    } catch (error) {
      cleanupOutcome = { failed: true, error };
    }
  }
  if (primary.failed && cleanupOutcome.failed) {
    throw new AggregateError(
      [primary.error, cleanupOutcome.error],
      "payroll-readiness runtime and disposable cleanup both failed"
    );
  }
  if (primary.failed) throw primary.error;
  if (cleanupOutcome.failed) throw cleanupOutcome.error;
}

describe("payroll-readiness PostgreSQL 17 proof", () => {
  it("pins every executable SQL file and enforces safe lifecycle targets", async () => {
    expect(FILES).toHaveLength(3);
    for (const [path, expectedHash] of FILES) {
      const bytes = await readFile(join(ROOT, path));
      expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(
        expectedHash
      );
    }
    expect(() => assertSafeLocalPostgresTarget("/tmp", "55442")).not.toThrow();
    expect(() => assertSafeLocalPostgresTarget("db.ops.test", "55442")).toThrow(
      "local temporary socket"
    );
    expect(() => assertSafeLocalPostgresTarget("/tmp", "5432")).toThrow(
      "non-default test port"
    );
    await expect(dropDatabase("postgres")).rejects.toThrow("refusing to drop");
    await expect(readFile(RUNNER_FILE, "utf8")).resolves.not.toContain(
      ["process", "cwd()"].join(".")
    );
  });

  describe.runIf(RUN_POSTGRES)("live isolated database", () => {
    it(
      "proves compile, replay, authority, tenant isolation, metrics, triggers, bounds, and indexes",
      async () => {
        const database = databaseName();
        let cleanupEligible = false;
        let primary: Outcome = { failed: false };
        try {
          assertSafeLocalPostgresTarget(PG_HOST, PG_PORT);
          const { stdout: version } = await execFileAsync(
            PSQL,
            databaseArgs("postgres").concat(
              "-X",
              "-Atqc",
              "show server_version_num"
            ),
            {
              cwd: ROOT,
              timeout: LIFECYCLE_TIMEOUT_MS,
              killSignal: "SIGTERM",
            }
          );
          expect(Number(version.trim())).toBeGreaterThanOrEqual(170000);
          expect(Number(version.trim())).toBeLessThan(180000);

          cleanupEligible = true;
          await createDatabase(database);
          await runFile(database, join(ROOT, FILES[0][0]));
          await runFile(database, join(ROOT, FILES[1][0]));
          await runFile(database, join(ROOT, FILES[1][0]));
          await runFile(database, join(ROOT, FILES[2][0]));
        } catch (error) {
          primary = { failed: true, error };
        }
        await settleWithCleanup(
          primary,
          cleanupEligible ? () => dropDatabase(database) : undefined
        );
      },
      5 * 60 * 1000
    );

    it(
      "rejects a same-named recurring-obligation index whose definition drifted",
      async () => {
        const database = databaseName();
        let cleanupEligible = false;
        let primary: Outcome = { failed: false };
        try {
          assertSafeLocalPostgresTarget(PG_HOST, PG_PORT);
          cleanupEligible = true;
          await createDatabase(database);
          await runFile(database, join(ROOT, FILES[0][0]));
          await runSql(
            database,
            "create index recurring_expenses_agent_payroll_due_v1_idx on public.recurring_expenses (company_id) where deleted_at is null"
          );
          await expect(
            runFile(database, join(ROOT, FILES[1][0]))
          ).rejects.toThrow("agent_payroll_readiness_index_shape_invalid");
        } catch (error) {
          primary = { failed: true, error };
        }
        await settleWithCleanup(
          primary,
          cleanupEligible ? () => dropDatabase(database) : undefined
        );
      },
      5 * 60 * 1000
    );

    it(
      "rejects a same-named payroll metadata column whose type drifted",
      async () => {
        const database = databaseName();
        let cleanupEligible = false;
        let primary: Outcome = { failed: false };
        try {
          assertSafeLocalPostgresTarget(PG_HOST, PG_PORT);
          cleanupEligible = true;
          await createDatabase(database);
          await runFile(database, join(ROOT, FILES[0][0]));
          await runSql(
            database,
            "alter table public.recurring_expenses add column obligation_kind integer"
          );
          await expect(
            runFile(database, join(ROOT, FILES[1][0]))
          ).rejects.toThrow("agent_payroll_readiness_metadata_shape_invalid");
        } catch (error) {
          primary = { failed: true, error };
        }
        await settleWithCleanup(
          primary,
          cleanupEligible ? () => dropDatabase(database) : undefined
        );
      },
      5 * 60 * 1000
    );

    it.each([
      [
        "default",
        "alter table public.recurring_expenses add column obligation_kind text default 'other'",
      ],
      [
        "generated expression",
        "alter table public.recurring_expenses add column due_time_local time without time zone generated always as ('09:00:00'::time) stored",
      ],
      [
        "precision",
        "alter table public.recurring_expenses add column due_time_local time(0) without time zone",
      ],
    ])(
      "rejects payroll metadata drift in its %s",
      async (_shape, precreateSql) => {
        const database = databaseName();
        let cleanupEligible = false;
        let primary: Outcome = { failed: false };
        try {
          assertSafeLocalPostgresTarget(PG_HOST, PG_PORT);
          cleanupEligible = true;
          await createDatabase(database);
          await runFile(database, join(ROOT, FILES[0][0]));
          await runSql(database, precreateSql);
          await expect(
            runFile(database, join(ROOT, FILES[1][0]))
          ).rejects.toThrow("agent_payroll_readiness_metadata_shape_invalid");
        } catch (error) {
          primary = { failed: true, error };
        }
        await settleWithCleanup(
          primary,
          cleanupEligible ? () => dropDatabase(database) : undefined
        );
      },
      5 * 60 * 1000
    );

    it(
      "rejects a same-named payroll metadata constraint whose definition drifted",
      async () => {
        const database = databaseName();
        let cleanupEligible = false;
        let primary: Outcome = { failed: false };
        try {
          assertSafeLocalPostgresTarget(PG_HOST, PG_PORT);
          cleanupEligible = true;
          await createDatabase(database);
          await runFile(database, join(ROOT, FILES[0][0]));
          await runSql(
            database,
            "alter table public.recurring_expenses add column obligation_kind text, add constraint recurring_expenses_obligation_kind_check check (obligation_kind is null)"
          );
          await expect(
            runFile(database, join(ROOT, FILES[1][0]))
          ).rejects.toThrow("agent_payroll_readiness_constraint_shape_invalid");
        } catch (error) {
          primary = { failed: true, error };
        }
        await settleWithCleanup(
          primary,
          cleanupEligible ? () => dropDatabase(database) : undefined
        );
      },
      5 * 60 * 1000
    );
  });
});
