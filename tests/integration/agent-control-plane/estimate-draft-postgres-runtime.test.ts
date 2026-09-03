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
    "tests/sql/agent-estimate-draft-schema-setup.sql",
    "bb0b3af2437886c6e764b16c8d4204f5494a76011cd7680694cdda7bd0a1083f",
  ],
  [
    "supabase/migrations/20260902010000_agent_recurring_service_price_change.sql",
    "e93302dbb1fae57ce61e8a0f63cb2c2e9f72b76f5bd6b5e8ae1b9f925af69f24",
  ],
  [
    "supabase/migrations/20260902231632_agent_estimate_draft_preview.sql",
    "a24282619e24c5f0d14135940e7f88a226b93b237c71842d97e779f44c8ce9f7",
  ],
  [
    "tests/sql/agent-estimate-draft-runtime.sql",
    "622c7e0f1b56de0e9a21d7d91426fe47b433f553a96b5f6d247aa063f502d6dd",
  ],
  [
    "tests/sql/agent-estimate-draft-replay-runtime.sql",
    "4a69886230b052190cc3532fa836698bf38ba0d92f99527b83c5326d67ebc79d",
  ],
] as const;
const RUN_POSTGRES = process.env.OPS_RUN_ESTIMATE_DRAFT_POSTGRES_RUNTIME === "1";
const PSQL =
  process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const CREATEDB = process.env.OPS_CREATEDB_BIN ?? join(dirname(PSQL), "createdb");
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
    throw new Error("estimate draft runtime requires a local temporary socket");
  }
  const localSocket =
    isAbsolute(host) &&
    (canonicalHost === "/tmp" ||
      canonicalHost.startsWith("/tmp/") ||
      canonicalHost === "/private/tmp" ||
      canonicalHost.startsWith("/private/tmp/"));
  if (!localSocket && !loopback) {
    throw new Error("estimate draft runtime requires a local temporary socket");
  }
  const numericPort = Number(port);
  if (
    !/^[0-9]{1,5}$/.test(port) ||
    !Number.isSafeInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65_535 ||
    numericPort === 5_432
  ) {
    throw new Error("estimate draft runtime requires a non-default test port");
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
    throw new Error("estimate draft runtime server port does not match target");
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
      "estimate draft runtime requires an identified disposable cluster"
    );
  }
}

function databaseName(): string {
  return `estimate_draft_${process.pid}_${randomBytes(6).toString("hex")}`;
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
  if (!/^estimate_draft_[0-9]+_[0-9a-f]{12}$/.test(database)) {
    throw new Error(`refusing to drop non-estimate-draft database: ${database}`);
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
      "estimate draft runtime and disposable cleanup both failed"
    );
  }
  if (primary.failed) throw primary.error;
  if (cleanupOutcome.failed) throw cleanupOutcome.error;
}

describe("estimate draft PostgreSQL 17 proof", () => {
  it("pins every executable SQL file and enforces safe lifecycle targets", async () => {
    expect(FILES).toHaveLength(6);
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
      "proves compile, authority, exact evidence, closed-world failures, replay, and zero mutation",
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
          for (const [path] of FILES.slice(0, 4)) {
            await runFile(database, join(ROOT, path));
          }
          await runFile(database, join(ROOT, FILES[5][0]));
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
