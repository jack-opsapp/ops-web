// Rehearsal stack for the Google Ads engine (phase 3): a disposable
// PostgreSQL 17 database with the real engine migration behind PostgREST and
// the storage shim, plus a seeded live-account warehouse in the shape phase 1
// writes, so the worktree dev server can run claim → proposals → review →
// validateOnly-apply locally without touching production.
//
//   node stack.mjs up   <worktree>
//   node stack.mjs down
//
// Adapted from ../../social-editorial/local-e2e-2026-09-07/stack/stack.mjs.
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const socket = "/private/tmp/ops-editorial-pg/socket";
const pgPort = "55439";
const db = "ops_ads_e2e";
const restPort = 3013;
const shimPort = 3012;
const appPort = 3225;
const jwtSecret = "ops-ads-e2e-local-secret-0123456789abcdef0123456789abcdef";
const authenticatorPassword = "ops-ads-e2e-authenticator";
const stateDir = join(here, ".state");
const storageDir = join(stateDir, "storage");
const pidFile = join(stateDir, "pids.json");

const psql = (sql, database = db) =>
  execFileSync(bin + "psql", ["-h", socket, "-p", pgPort, "-d", database, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const psqlFile = (file) =>
  execFileSync(bin + "psql", ["-h", socket, "-p", pgPort, "-d", db, "-XAtq", "-v", "ON_ERROR_STOP=1", "-f", file], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

function jwt(role) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ role, iss: "supabase-local", iat: 1700000000, exp: 4102444800 });
  const sig = createHmac("sha256", jwtSecret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function up(worktree) {
  const migrationsDir = join(worktree, "supabase/migrations");
  mkdirSync(storageDir, { recursive: true });
  try {
    execFileSync(bin + "dropdb", ["-h", socket, "-p", pgPort, "--if-exists", db]);
  } catch {}
  execFileSync(bin + "createdb", ["-h", socket, "-p", pgPort, db]);
  psql(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login password '${authenticatorPassword}'; end if;
    end $$;
    grant anon, authenticated, service_role to authenticator;
  `);
  psqlFile(join(worktree, "tests/sql/social-publishing-postgres17-baseline.sql"));
  psql(`
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    create schema if not exists private;
    grant usage on schema private to service_role;
    create schema if not exists cron;
    create table cron.job (
      jobid bigserial primary key, schedule text, command text, nodename text, nodeport integer,
      database text, username text, active boolean not null default true, jobname text unique
    );
    create table cron.job_run_details (
      jobid bigint, runid bigserial primary key, job_pid integer, database text, username text,
      command text, status text, return_message text, start_time timestamptz, end_time timestamptz
    );
    create function cron.schedule(job_name text, schedule text, command text) returns bigint
      language plpgsql as $$ declare v bigint; begin
        insert into cron.job(jobname,schedule,command) values(job_name,schedule,command)
        on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command
        returning jobid into v; return v; end $$;
    create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
      database text default null, username text default null, active boolean default null) returns void
      language plpgsql as $$ begin
        update cron.job j set active=coalesce(alter_job.active,j.active), schedule=coalesce(alter_job.schedule,j.schedule),
          command=coalesce(alter_job.command,j.command) where j.jobid=job_id; end $$;
    create function cron.unschedule(job_id bigint) returns boolean
      language plpgsql as $$ begin delete from cron.job where jobid=job_id; return found; end $$;
  `);
  const wanted = ["_cron_workload_controls.sql", "_ads_daily_search_terms.sql", "_ads_engine.sql"];
  const files = readdirSync(migrationsDir);
  for (const suffix of wanted) {
    const file = files.find((f) => f.endsWith(suffix));
    if (!file) throw new Error(`migration missing: *${suffix}`);
    psqlFile(join(migrationsDir, file));
    console.log(`applied ${file}`);
  }
  // Phase 1's warehouse contract (tables the engine reads) and a seeded live
  // account. Replaced by the real phase 1 migration once feat/ads-engine-p1
  // lands; see warehouse-fixture.sql for the contract it mirrors.
  psqlFile(join(here, "warehouse-fixture.sql"));
  console.log("applied warehouse-fixture.sql");
  psql(`grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;
    grant all on all tables in schema private to service_role; grant all on all sequences in schema private to service_role;
    grant all on all functions in schema private to service_role;`);
  console.log(psql("select 'entities '||count(*) from public.ads_entities union all select 'search terms '||count(*) from public.ads_daily_search_term union all select 'keywords '||count(*) from public.ads_daily_keyword union all select 'ads '||count(*) from public.ads_daily_ad"));

  const conf = join(stateDir, "postgrest.conf");
  writeFileSync(
    conf,
    [
      `db-uri = "postgres://authenticator:${authenticatorPassword}@/${db}?host=${socket}&port=${pgPort}"`,
      `db-schemas = "public"`,
      `db-anon-role = "anon"`,
      `jwt-secret = "${jwtSecret}"`,
      `server-host = "127.0.0.1"`,
      `server-port = ${restPort}`,
      `log-level = "info"`,
      "",
    ].join("\n")
  );
  const rest = spawn("/opt/homebrew/bin/postgrest", [conf], { detached: true, stdio: ["ignore", openLog("postgrest.log"), openLog("postgrest.log")] });
  const shim = spawn(process.execPath, [join(here, "shim.mjs"), String(shimPort), String(restPort), storageDir], { detached: true, stdio: ["ignore", openLog("shim.log"), openLog("shim.log")] });
  rest.unref();
  shim.unref();
  writeFileSync(pidFile, JSON.stringify({ postgrest: rest.pid, shim: shim.pid }));
  const env = [
    "# ── rehearsal stack (local only; never committed, never production) ──",
    `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${shimPort}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${jwt("anon")}`,
    `SUPABASE_SERVICE_ROLE_KEY=${jwt("service_role")}`,
    `CRON_SECRET=rehearsal-cron-secret-0123456789abcdef0123456789`,
    `ADS_ENGINE_TOKEN=rehearsal-engine-token-0123456789abcdef0123456789`,
    `ADS_ENGINE_REHEARSAL=1`,
    `PMF_OPERATOR_USER_ID=20000000-0000-4000-8000-000000000001`,
    `PMF_OPERATOR_COMPANY_ID=10000000-0000-4000-8000-000000000001`,
    `NEXT_PUBLIC_APP_URL=http://127.0.0.1:${appPort}`,
    `DEV_BYPASS_AUTH=true`,
    `NEXT_PUBLIC_DEV_BYPASS_AUTH=true`,
    "",
  ].join("\n");
  writeFileSync(join(stateDir, "env.local"), env);
  console.log(`postgrest pid=${rest.pid} port=${restPort}; shim pid=${shim.pid} port=${shimPort}; env -> ${join(stateDir, "env.local")}`);
}

function openLog(name) {
  return openSync(join(stateDir, name), "a");
}

function down() {
  if (existsSync(pidFile)) {
    const pids = JSON.parse(readFileSync(pidFile, "utf8"));
    for (const pid of Object.values(pids)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
    rmSync(pidFile);
  }
  try {
    execFileSync(bin + "dropdb", ["-h", socket, "-p", pgPort, "--if-exists", db]);
  } catch (error) {
    console.error(String(error.message ?? error));
  }
  console.log("stack down");
}

const [, , command, worktree] = process.argv;
if (command === "up") up(worktree);
else if (command === "down") down();
else throw new Error("usage: stack.mjs up <worktree> | down");
