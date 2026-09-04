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
    "tests/sql/agent-sales-truth-setup.sql",
    "f27e8c38597095cc3facd2554aa8982674e070aa69d324d15df110e28a400411",
  ],
  [
    "supabase/migrations/20260901153000_agent_sales_truth_read.sql",
    "88eb84718a015b7c5428fffafa087692b8890e8dc8fabd022d0069f6b09badab",
  ],
  [
    "tests/sql/agent-sales-truth-runtime.sql",
    "a6728fb481969e488e4f53b6d1ed77958949c0e28db73b279dd3e79c1cfb5b5f",
  ],
] as const;
const RUN_POSTGRES = process.env.OPS_RUN_SALES_TRUTH_POSTGRES_RUNTIME === "1";
const PSQL =
  process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const CREATEDB =
  process.env.OPS_CREATEDB_BIN ?? join(dirname(PSQL), "createdb");
const DROPDB = process.env.OPS_DROPDB_BIN ?? join(dirname(PSQL), "dropdb");
const PG_HOST = process.env.OPS_PGHOST ?? "/tmp";
const PG_PORT = process.env.OPS_PGPORT ?? "55441";
const PG_USER = process.env.OPS_PGUSER ?? process.env.USER ?? "postgres";
const FILE_TIMEOUT_MS = 120_000;
const LIFECYCLE_TIMEOUT_MS = 30_000;

function assertSafeLocalPostgresTarget(host: string, port: string): void {
  let canonicalHost: string;
  const loopback = host === "127.0.0.1" || host === "::1";
  try {
    canonicalHost = loopback ? host : realpathSync.native(host);
  } catch {
    throw new Error("sales-truth runtime requires a local temporary socket");
  }
  const localSocket =
    isAbsolute(host) &&
    (canonicalHost === "/tmp" ||
      canonicalHost.startsWith("/tmp/") ||
      canonicalHost === "/private/tmp" ||
      canonicalHost.startsWith("/private/tmp/"));
  if (!localSocket && !loopback) {
    throw new Error("sales-truth runtime requires a local temporary socket");
  }
  const numericPort = Number(port);
  if (
    !/^[0-9]{1,5}$/.test(port) ||
    !Number.isSafeInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65_535 ||
    numericPort === 5_432
  ) {
    throw new Error("sales-truth runtime requires a non-default test port");
  }
}

function databaseName(): string {
  return `sales_truth_${process.pid}_${randomBytes(6).toString("hex")}`;
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
  if (!/^sales_truth_[0-9]+_[0-9a-f]{12}$/.test(database)) {
    throw new Error(`refusing to drop non-sales-truth database: ${database}`);
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
      "sales-truth runtime and disposable cleanup both failed"
    );
  }
  if (primary.failed) throw primary.error;
  if (cleanupOutcome.failed) throw cleanupOutcome.error;
}

describe("sales-truth PostgreSQL 17 proof", () => {
  it("pins every executable SQL file and enforces safe lifecycle targets", async () => {
    expect(FILES).toHaveLength(3);
    for (const [path, expectedHash] of FILES) {
      const bytes = await readFile(join(ROOT, path));
      expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(
        expectedHash
      );
    }
    expect(() => assertSafeLocalPostgresTarget("/tmp", "55441")).not.toThrow();
    expect(() => assertSafeLocalPostgresTarget("db.ops.test", "55441")).toThrow(
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
      "proves compile, replay, authority, tenant, metrics, triggers, bounds, and indexes",
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
      "rejects a same-named cohort index whose definition has drifted",
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
            "create index opportunities_agent_sales_truth_cohort_v1_idx on public.opportunities (company_id)"
          );
          await expect(
            runFile(database, join(ROOT, FILES[1][0]))
          ).rejects.toThrow("agent_sales_truth_cohort_index_shape_invalid");
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
