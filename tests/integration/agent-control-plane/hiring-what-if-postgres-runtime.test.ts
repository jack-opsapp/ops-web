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
    "tests/sql/agent-hiring-what-if-setup.sql",
    "01a58265d642bf08655e29fb11c49ef5df51dcfa969c442110ee9fe1cb07b7d7",
  ],
  [
    "supabase/migrations/20260901045000_agent_hiring_what_if_read.sql",
    "13221b2d68d6d7a73dd426c8a3a6b8badaf2010af16e539ce8bc4a3a0b0be4b5",
  ],
  [
    "tests/sql/agent-hiring-what-if-runtime.sql",
    "fd365e293175b3c7dfe49a976444181865c851d18f893aba339fd587ba8e3c53",
  ],
] as const;
const RUN_POSTGRES = process.env.OPS_RUN_HIRING_POSTGRES_RUNTIME === "1";
const PSQL =
  process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const CREATEDB =
  process.env.OPS_CREATEDB_BIN ??
  join(
    dirname(PSQL),
    process.platform === "win32" ? "createdb.exe" : "createdb"
  );
const DROPDB =
  process.env.OPS_DROPDB_BIN ??
  join(dirname(PSQL), process.platform === "win32" ? "dropdb.exe" : "dropdb");
const PG_HOST = process.env.OPS_PGHOST ?? "/tmp";
const PG_PORT = process.env.OPS_PGPORT ?? "55441";
const PG_USER = process.env.OPS_PGUSER ?? process.env.USER ?? "postgres";
const FILE_TIMEOUT_MS = 120_000;
const LIFECYCLE_TIMEOUT_MS = 30_000;

function assertSafeLocalPostgresTarget(host: string, port: string): void {
  let canonicalHost: string;
  try {
    canonicalHost = realpathSync.native(host);
  } catch {
    throw new Error("hiring what-if runtime requires a local temporary socket");
  }
  const localSocket =
    isAbsolute(host) &&
    (canonicalHost === "/tmp" ||
      canonicalHost.startsWith("/tmp/") ||
      canonicalHost === "/private/tmp" ||
      canonicalHost.startsWith("/private/tmp/"));
  if (!localSocket) {
    throw new Error("hiring what-if runtime requires a local temporary socket");
  }
  const numericPort = Number(port);
  if (
    !/^[0-9]{1,5}$/.test(port) ||
    !Number.isSafeInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65_535 ||
    numericPort === 5_432
  ) {
    throw new Error("hiring what-if runtime requires a non-default test port");
  }
}

function databaseName(): string {
  return `hiring_what_if_${process.pid}_${randomBytes(6).toString("hex")}`;
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
    {
      cwd: ROOT,
      timeout: LIFECYCLE_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }
  );
}

async function dropDatabase(database: string): Promise<void> {
  if (!/^hiring_what_if_[0-9]+_[0-9a-f]{12}$/.test(database)) {
    throw new Error(`refusing to drop non-hiring database: ${database}`);
  }
  await execFileAsync(
    DROPDB,
    databaseArgs().concat("--if-exists", "--force", database),
    {
      cwd: ROOT,
      timeout: LIFECYCLE_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }
  );
}

type PrimaryOutcome =
  | { readonly failed: false }
  | { readonly failed: true; readonly error: unknown };

async function settleWithCleanup(
  primary: PrimaryOutcome,
  cleanup: (() => Promise<void>) | undefined
): Promise<void> {
  let cleanupOutcome: PrimaryOutcome = { failed: false };
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
      "hiring runtime and disposable database cleanup both failed"
    );
  }
  if (primary.failed) throw primary.error;
  if (cleanupOutcome.failed) throw cleanupOutcome.error;
}

describe("hiring what-if PostgreSQL 17 proof", () => {
  it("pins every executable SQL file and enforces safe lifecycle targets", async () => {
    expect(FILES).toHaveLength(3);
    for (const [path, expectedHash] of FILES) {
      const bytes = await readFile(join(ROOT, path));
      expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(
        expectedHash
      );
    }
    expect(() => assertSafeLocalPostgresTarget("/tmp", "55441")).not.toThrow();
    expect(() =>
      assertSafeLocalPostgresTarget("/private/tmp", "55441")
    ).not.toThrow();
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
      "compiles the candidate migration and proves golden, fail-closed, and index behavior",
      async () => {
        const database = databaseName();
        let cleanupEligible = false;
        let primary: PrimaryOutcome = { failed: false };
        try {
          assertSafeLocalPostgresTarget(PG_HOST, PG_PORT);
          expect(database).not.toBe("postgres");
          expect(database).not.toMatch(/^template[01]$/);

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
          for (const [path] of FILES) {
            await runFile(database, join(ROOT, path));
          }
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
      "rejects a same-named history index whose definition has drifted",
      async () => {
        const database = databaseName();
        let cleanupEligible = false;
        let primary: PrimaryOutcome = { failed: false };
        try {
          assertSafeLocalPostgresTarget(PG_HOST, PG_PORT);
          cleanupEligible = true;
          await createDatabase(database);
          await runFile(
            database,
            join(ROOT, "tests/sql/agent-hiring-what-if-setup.sql")
          );
          await runSql(
            database,
            "create index idx_site_visits_agent_hiring_history_v1 on public.site_visits (company_id)"
          );
          await expect(
            runFile(
              database,
              join(
                ROOT,
                "supabase/migrations/20260901045000_agent_hiring_what_if_read.sql"
              )
            )
          ).rejects.toThrow("agent_hiring_what_if_history_index_shape_invalid");
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
