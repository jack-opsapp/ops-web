import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";

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
    "tests/sql/agent-weather-reschedule-schema-setup.sql",
    "73e99907bc9018d6310983b9c7e7614989642c7c97e2e68597ffc06d4d094345",
  ],
  [
    "supabase/migrations/20260903123200_agent_weather_reschedule_preview.sql",
    "6809661f9c7a22665786e975773ce38455dffafc59410c8099efa6ce95311e45",
  ],
  [
    "tests/sql/agent-weather-reschedule-runtime.sql",
    "7c6e1c4414e0eacb2e02a55420290c9bfdf636e1897c925b405d979b0dfc3373",
  ],
] as const;
const RUN_POSTGRES =
  process.env.OPS_RUN_WEATHER_RESCHEDULE_POSTGRES_RUNTIME === "1";
const PSQL =
  process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const CREATEDB =
  process.env.OPS_CREATEDB_BIN ?? join(dirname(PSQL), "createdb");
const DROPDB = process.env.OPS_DROPDB_BIN ?? join(dirname(PSQL), "dropdb");
const PG_HOST = process.env.OPS_PGHOST ?? "/tmp";
const PG_PORT = process.env.OPS_PGPORT ?? "55442";
const PG_USER = process.env.OPS_PGUSER ?? process.env.USER ?? "postgres";

function assertSafeTarget(host: string, port: string): void {
  const loopback = host === "127.0.0.1" || host === "::1";
  let canonicalHost: string;
  try {
    canonicalHost = loopback ? host : realpathSync.native(host);
  } catch {
    throw new Error("weather reschedule runtime requires a local socket");
  }
  const localSocket =
    isAbsolute(host) &&
    (canonicalHost === "/tmp" ||
      canonicalHost.startsWith("/tmp/") ||
      canonicalHost === "/private/tmp" ||
      canonicalHost.startsWith("/private/tmp/"));
  const numericPort = Number(port);
  if (
    (!localSocket && !loopback) ||
    !/^[0-9]{1,5}$/.test(port) ||
    !Number.isSafeInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65_535 ||
    numericPort === 5_432
  ) {
    throw new Error(
      "weather reschedule runtime requires an isolated local target"
    );
  }
}

function assertDisposableCluster(
  host: string,
  requestedPort: string,
  dataDirectory: string,
  serverPort: string
): void {
  assertSafeTarget(host, requestedPort);
  if (serverPort !== requestedPort) throw new Error("server port mismatch");
  if (
    !isAbsolute(dataDirectory) ||
    (!dataDirectory.startsWith("/tmp/") &&
      !dataDirectory.startsWith("/private/tmp/")) ||
    !dataDirectory.split("/").some((part) => part.startsWith("ops-mcp-"))
  ) {
    throw new Error("runtime requires an identified disposable cluster");
  }
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
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }
  );
}

async function dropDatabase(database: string): Promise<void> {
  if (!/^weather_reschedule_[0-9]+_[0-9a-f]{12}$/.test(database)) {
    throw new Error(`refusing to drop unsafe database: ${database}`);
  }
  await execFileAsync(
    DROPDB,
    databaseArgs().concat("--if-exists", "--force", database),
    { cwd: ROOT, timeout: 30_000 }
  );
}

describe("weather reschedule PostgreSQL 17 proof", () => {
  it("pins every SQL input and rejects unsafe lifecycle targets", async () => {
    expect(FILES).toHaveLength(7);
    for (const [path, hash] of FILES) {
      expect(
        createHash("sha256")
          .update(await readFile(join(ROOT, path)))
          .digest("hex"),
        path
      ).toBe(hash);
    }
    const weatherSetup = await readFile(join(ROOT, FILES[4][0]), "utf8");
    const registrySection = weatherSetup.match(
      /truncate private\.test_authority_permissions;([\s\S]+?)create or replace function private\.resolve_agent_actor_authority/
    )?.[1];
    expect(
      [
        ...(registrySection ?? "").matchAll(
          /\('([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)'\)/g
        ),
      ].map((match) => match[1])
    ).toEqual(REGISTERED_ACTOR_PERMISSION_KEYS);
    expect(() => assertSafeTarget("/tmp", "55442")).not.toThrow();
    expect(() => assertSafeTarget("db.ops.test", "55442")).toThrow();
    expect(() => assertSafeTarget("/tmp", "5432")).toThrow();
    expect(() =>
      assertDisposableCluster(
        "/private/tmp",
        "55442",
        "/private/tmp/ops-mcp-weather/data",
        "55442"
      )
    ).not.toThrow();
    await expect(dropDatabase("postgres")).rejects.toThrow(
      "refusing to drop unsafe database"
    );
    await expect(readFile(RUNNER_FILE, "utf8")).resolves.not.toContain(
      ["process", "cwd()"].join(".")
    );
  });

  describe.runIf(RUN_POSTGRES)("live isolated database", () => {
    it(
      "proves compile, exact replay, fail-closed cases, and zero mutation",
      async () => {
        assertSafeTarget(PG_HOST, PG_PORT);
        const { stdout } = await execFileAsync(
          PSQL,
          databaseArgs("postgres").concat(
            "-X",
            "-Atqc",
            "select current_setting('server_version_num'), current_setting('data_directory'), current_setting('port')"
          ),
          { cwd: ROOT, timeout: 30_000 }
        );
        const [version, dataDirectory, serverPort, ...unexpected] = stdout
          .trim()
          .split("|");
        expect(unexpected).toEqual([]);
        expect(Number(version)).toBeGreaterThanOrEqual(170000);
        expect(Number(version)).toBeLessThan(180000);
        assertDisposableCluster(
          PG_HOST,
          PG_PORT,
          realpathSync.native(dataDirectory ?? ""),
          serverPort ?? ""
        );

        const database = `weather_reschedule_${process.pid}_${randomBytes(6).toString("hex")}`;
        let created = false;
        try {
          await execFileAsync(CREATEDB, databaseArgs().concat(database), {
            cwd: ROOT,
            timeout: 30_000,
          });
          created = true;
          for (const [path] of FILES.slice(0, 6)) {
            await runFile(database, join(ROOT, path));
          }
          await runFile(database, join(ROOT, FILES[6][0]));
          await runFile(database, join(ROOT, FILES[6][0]));
        } finally {
          if (created) await dropDatabase(database);
        }
      },
      5 * 60 * 1000
    );
  });
});
