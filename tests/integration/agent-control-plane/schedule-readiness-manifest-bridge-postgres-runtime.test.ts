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
const SQL_ROOT = join(ROOT, "tests/sql");
const FIXTURES = [
  [
    "agent-schedule-readiness-manifest-bridge-runtime.sql",
    "f477c650850109a59f70006016741ea751d56c0fafeabbef00e43bdda75ab245",
  ],
  [
    "agent-schedule-readiness-manifest-bridge-replay-runtime.sql",
    "d4a1354a73d23c0c79b8c3ef5873059cea4cdefbdf6c0e459fbea19d1b4df33b",
  ],
] as const;
const RUN_POSTGRES = process.env.OPS_RUN_P2_POSTGRES_RUNTIME === "1";
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
const PG_PORT = process.env.OPS_PGPORT ?? "55414";
const PG_USER = process.env.OPS_PGUSER ?? process.env.USER ?? "postgres";
const FILE_TIMEOUT_MS = 120_000;
const LIFECYCLE_TIMEOUT_MS = 30_000;

function assertSafeLocalPostgresTarget(host: string, port: string): void {
  let canonicalHost: string;
  try {
    canonicalHost = realpathSync.native(host);
  } catch {
    throw new Error(
      "schedule/readiness bridge runtime requires a local temporary socket"
    );
  }
  const localSocket =
    isAbsolute(host) &&
    (canonicalHost === "/tmp" ||
      canonicalHost.startsWith("/tmp/") ||
      canonicalHost === "/private/tmp" ||
      canonicalHost.startsWith("/private/tmp/"));
  if (!localSocket) {
    throw new Error(
      "schedule/readiness bridge runtime requires a local temporary socket"
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
      "schedule/readiness bridge runtime requires a non-default test port"
    );
  }
}

function databaseName(): string {
  return `schedule_readiness_bridge_${process.pid}_${randomBytes(6).toString("hex")}`;
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
  if (!/^schedule_readiness_bridge_[0-9]+_[0-9a-f]{12}$/.test(database)) {
    throw new Error(
      `refusing to drop non-schedule/readiness database: ${database}`
    );
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
      "schedule/readiness runtime and disposable database cleanup both failed"
    );
  }
  if (primary.failed) throw primary.error;
  if (cleanupOutcome.failed) throw cleanupOutcome.error;
}

describe("schedule/readiness manifest bridge PostgreSQL 17 proof", () => {
  it("pins the standalone runtime and replay fixtures and enforces safe lifecycle targets", async () => {
    expect(FIXTURES).toHaveLength(2);
    for (const [name, expectedHash] of FIXTURES) {
      const bytes = await readFile(join(SQL_ROOT, name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        expectedHash
      );
    }
    expect(() => assertSafeLocalPostgresTarget("/tmp", "55414")).not.toThrow();
    expect(() =>
      assertSafeLocalPostgresTarget("/private/tmp", "55414")
    ).not.toThrow();
    expect(() => assertSafeLocalPostgresTarget("db.ops.test", "55414")).toThrow(
      "local temporary socket"
    );
    expect(() => assertSafeLocalPostgresTarget("/tmp", "5432")).toThrow(
      "non-default test port"
    );
    await expect(dropDatabase("postgres")).rejects.toThrow("refusing to drop");

    const primaryFailure = new Error("primary failure");
    const cleanupFailure = new Error("cleanup failure");
    const aggregate = await settleWithCleanup(
      { failed: true, error: primaryFailure },
      async () => {
        throw cleanupFailure;
      }
    ).catch((error: unknown) => error);
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect((aggregate as AggregateError).errors).toEqual([
      primaryFailure,
      cleanupFailure,
    ]);
    await expect(
      settleWithCleanup({ failed: false }, async () => {
        throw cleanupFailure;
      })
    ).rejects.toBe(cleanupFailure);
    await expect(readFile(RUNNER_FILE, "utf8")).resolves.not.toContain(
      ["process", "cwd()"].join(".")
    );
  });

  describe.runIf(RUN_POSTGRES)("live isolated database", () => {
    it(
      "runs the sealed preimage repair and replay in one fresh non-default database",
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

          // Cleanup becomes eligible before CREATEDB so a server-side success
          // followed by a client timeout cannot strand the disposable database.
          cleanupEligible = true;
          await createDatabase(database);
          await runFile(database, join(SQL_ROOT, FIXTURES[0][0]));
          await runFile(database, join(SQL_ROOT, FIXTURES[1][0]));
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
