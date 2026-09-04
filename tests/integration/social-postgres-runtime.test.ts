import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = resolve(__dirname, "../..");
const RUN_POSTGRES = process.env.OPS_RUN_SOCIAL_POSTGRES_RUNTIME === "1";
const PSQL =
  process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const CREATEDB =
  process.env.OPS_CREATEDB_BIN ?? join(dirname(PSQL), "createdb");
const DROPDB = process.env.OPS_DROPDB_BIN ?? join(dirname(PSQL), "dropdb");
const PG_HOST = process.env.OPS_PGHOST ?? "/tmp";
const PG_PORT = process.env.OPS_PGPORT ?? "55432";
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
      "Social PostgreSQL runtime requires a local socket and non-default port"
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

describe.runIf(RUN_POSTGRES)("social publishing PostgreSQL 17 runtime", () => {
  it("applies the exact migration and proves concurrent claims, recovery branches, grants, and replay", async () => {
    assertSafeTarget();
    const database = `social_publish_${process.pid}_${randomBytes(6).toString("hex")}`;
    let created = false;
    try {
      const version = await query("postgres", "show server_version_num");
      expect(Number(version)).toBeGreaterThanOrEqual(170000);
      expect(Number(version)).toBeLessThan(180000);

      created = true;
      await execFileAsync(
        CREATEDB,
        databaseArgs().concat("-T", "template0", "-E", "UTF8", database),
        { cwd: ROOT, timeout: TIMEOUT_MS }
      );
      await runFile(
        database,
        join(ROOT, "tests/sql/social-publishing-postgres17-baseline.sql")
      );
      await runFile(
        database,
        join(
          ROOT,
          "supabase/migrations/20260901235149_create_social_publishing.sql"
        )
      );
      await runFile(
        database,
        join(
          ROOT,
          "supabase/migrations/20260902195639_create_instagram_connection.sql"
        )
      );

      await query(
        database,
        `insert into public.social_posts (
           idempotency_key, contract_version, source_type, story_type, visual_treatment,
           post_format, content, caption, alt_text, rendered_assets, status, publish_after,
           render_version, selector_version, voice_reference_version, created_by, updated_by
         )
         select
           'concurrent-' || value::text, 'test', 'custom', 'operator_protocol',
           'operator_brief', 'single', '{}'::jsonb, 'caption', 'alt', '[{}]'::jsonb,
           'review', now() - interval '1 minute', 'render-test', 'selector-test',
           'voice-test', 'test', 'test'
         from generate_series(1, 2) as value`
      );

      const [left, right] = await Promise.all([
        query(
          database,
          "select id::text from public.claim_due_social_posts('70000000-0000-4000-8000-000000000001', 1, 180)"
        ),
        query(
          database,
          "select id::text from public.claim_due_social_posts('70000000-0000-4000-8000-000000000002', 1, 180)"
        ),
      ]);
      expect(left).toMatch(/^[0-9a-f-]{36}$/);
      expect(right).toMatch(/^[0-9a-f-]{36}$/);
      expect(left).not.toBe(right);
      await expect(
        query(
          database,
          "select count(*) from public.claim_due_social_posts('70000000-0000-4000-8000-000000000003', 2, 180)"
        )
      ).resolves.toBe("0");

      await runFile(
        database,
        join(ROOT, "tests/sql/social-publishing-postgres17-runtime.sql")
      );
      await runFile(
        database,
        join(ROOT, "tests/sql/instagram-connection-postgres17-runtime.sql")
      );
    } finally {
      if (created) {
        if (!/^social_publish_[0-9]+_[0-9a-f]{12}$/.test(database)) {
          throw new Error("Refusing to drop an unexpected PostgreSQL database");
        }
        await execFileAsync(
          DROPDB,
          databaseArgs().concat("--if-exists", "--force", database),
          { cwd: ROOT, timeout: TIMEOUT_MS }
        );
      }
    }
  });
});
