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
    "tests/sql/agent-recurring-service-price-change-setup.sql",
    "3fedd3348ef2bd23f7cdc1689fd712d441387606ef1de193d66793a1d910e504",
  ],
  [
    "supabase/migrations/20260902010000_agent_recurring_service_price_change.sql",
    "e93302dbb1fae57ce61e8a0f63cb2c2e9f72b76f5bd6b5e8ae1b9f925af69f24",
  ],
  [
    "tests/sql/agent-recurring-service-price-change-runtime.sql",
    "e41728fba2af05d0deb4d7cecb14b0be3d1a13a263c7a650591d8a1f4493ec5a",
  ],
] as const;
const RUN_POSTGRES =
  process.env.OPS_RUN_RECURRING_SERVICE_PRICE_CHANGE_POSTGRES_RUNTIME === "1";
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
    throw new Error("price-change runtime requires a local temporary socket");
  }
  const localSocket =
    isAbsolute(host) &&
    (canonicalHost === "/tmp" ||
      canonicalHost.startsWith("/tmp/") ||
      canonicalHost === "/private/tmp" ||
      canonicalHost.startsWith("/private/tmp/"));
  if (!localSocket && !loopback) {
    throw new Error("price-change runtime requires a local temporary socket");
  }
  const numericPort = Number(port);
  if (
    !/^[0-9]{1,5}$/.test(port) ||
    !Number.isSafeInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65_535 ||
    numericPort === 5_432
  ) {
    throw new Error("price-change runtime requires a non-default test port");
  }
}

function assertDisposableClusterIdentity(
  host: string,
  requestedPort: string,
  dataDirectory: string,
  serverPort: string
): void {
  assertSafeLocalPostgresTarget(host, requestedPort);
  if (serverPort !== requestedPort) {
    throw new Error("price-change runtime server port does not match target");
  }
  const temporaryDirectory =
    isAbsolute(dataDirectory) &&
    (dataDirectory.startsWith("/tmp/") ||
      dataDirectory.startsWith("/private/tmp/"));
  const disposableMarker = dataDirectory
    .split("/")
    .some((component) => component.startsWith("ops-mcp-"));
  if (!temporaryDirectory || !disposableMarker) {
    throw new Error(
      "price-change runtime requires an identified disposable cluster"
    );
  }
}

function databaseName(): string {
  return `price_change_${process.pid}_${randomBytes(6).toString("hex")}`;
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
    { cwd: ROOT, timeout: LIFECYCLE_TIMEOUT_MS, killSignal: "SIGTERM" }
  );
}

async function dropDatabase(database: string): Promise<void> {
  if (!/^price_change_[0-9]+_[0-9a-f]{12}$/.test(database)) {
    throw new Error(`refusing to drop non-price-change database: ${database}`);
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
      "price-change runtime and disposable cleanup both failed"
    );
  }
  if (primary.failed) throw primary.error;
  if (cleanupOutcome.failed) throw cleanupOutcome.error;
}

describe("recurring-service price-change PostgreSQL 17 proof", () => {
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
    expect(() =>
      assertDisposableClusterIdentity(
        "/private/tmp",
        "55442",
        "/private/tmp/ops-mcp-proof/data",
        "55442"
      )
    ).not.toThrow();
    expect(() =>
      assertDisposableClusterIdentity(
        "/private/tmp",
        "55442",
        "/var/lib/postgresql/data",
        "55442"
      )
    ).toThrow("identified disposable cluster");
    expect(() =>
      assertDisposableClusterIdentity(
        "/private/tmp",
        "55442",
        "/private/tmp/ops-mcp-proof/data",
        "55443"
      )
    ).toThrow("server port does not match target");
    await expect(dropDatabase("postgres")).rejects.toThrow("refusing to drop");
    await expect(readFile(RUNNER_FILE, "utf8")).resolves.not.toContain(
      ["process", "cwd()"].join(".")
    );
  });

  describe.runIf(RUN_POSTGRES)("live isolated database", () => {
    it(
      "proves compile, authority, exact evidence, tenant isolation, deterministic replay, and zero mutation",
      async () => {
        const database = databaseName();
        let cleanupEligible = false;
        let primary: Outcome = { failed: false };
        try {
          assertSafeLocalPostgresTarget(PG_HOST, PG_PORT);
          const { stdout: clusterIdentity } = await execFileAsync(
            PSQL,
            databaseArgs("postgres").concat(
              "-X",
              "-Atqc",
              "select current_setting('server_version_num'), current_setting('data_directory'), current_setting('port')"
            ),
            {
              cwd: ROOT,
              timeout: LIFECYCLE_TIMEOUT_MS,
              killSignal: "SIGTERM",
            }
          );
          const [version, dataDirectory, serverPort, ...unexpected] =
            clusterIdentity.trim().split("|");
          expect(unexpected).toEqual([]);
          expect(Number(version)).toBeGreaterThanOrEqual(170000);
          expect(Number(version)).toBeLessThan(180000);
          assertDisposableClusterIdentity(
            PG_HOST,
            PG_PORT,
            realpathSync.native(dataDirectory ?? ""),
            serverPort ?? ""
          );

          await createDatabase(database);
          cleanupEligible = true;
          await runFile(database, join(ROOT, FILES[0][0]));
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
  });
});
