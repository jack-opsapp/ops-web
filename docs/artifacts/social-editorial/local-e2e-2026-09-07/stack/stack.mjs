// Rehearsal stack for the OPS Instagram authoring release: a disposable
// PostgreSQL database with the real social migrations, PostgREST, and a
// storage shim, so the Next.js worktree can run the whole authoring →
// handoff → promotion → render flow locally without touching production.
//
//   node stack.mjs up   <worktree> <migrationsDir>
//   node stack.mjs down
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const socket = "/private/tmp/ops-editorial-pg/socket";
const pgPort = "55439";
const db = "ops_social_e2e";
const restPort = 3011;
const shimPort = 3010;
const jwtSecret = "ops-social-e2e-local-secret-0123456789abcdef0123456789";
const authenticatorPassword = "ops-social-e2e-authenticator";
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

function up(worktree, migrationsDir) {
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
    create table public.blog_posts (
      id uuid primary key default gen_random_uuid(),
      title text not null,
      subtitle text,
      slug text not null unique,
      content text not null default '',
      thumbnail_url text,
      is_live boolean not null default false,
      published_at timestamptz,
      source text not null default 'breaking',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
  `);
  // The shared cron workload lease lives in the private schema and registers
  // pg_cron jobs; a minimal pg_cron stand-in lets the real migration apply.
  psql(`
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
  const wanted = [
    "_cron_workload_controls.sql",
    "_create_social_publishing.sql",
    "_create_instagram_connection.sql",
    "_create_social_editorial.sql",
    "_create_social_editorial_assignments.sql",
  ];
  const files = readdirSync(migrationsDir);
  for (const suffix of wanted) {
    const file = files.find((f) => f.endsWith(suffix));
    if (!file) throw new Error(`migration missing: *${suffix}`);
    psqlFile(join(migrationsDir, file));
    console.log(`applied ${file}`);
  }
  psql(`grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;
    grant all on all tables in schema private to service_role; grant all on all sequences in schema private to service_role;
    grant all on all functions in schema private to service_role;`);
  // Operator recipient + fixtures.
  psql(`
    insert into public.companies (id, name) values ('10000000-0000-4000-8000-000000000001', 'OPS Rehearsal');
    insert into public.users (id, company_id, first_name, last_name, is_active)
      values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Jackson', 'Rehearsal', true);
  `);
  const fixtures = JSON.parse(readFileSync(join(here, "blog-fixtures.json"), "utf8"));
  for (const b of fixtures) {
    const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
    psql(
      `insert into public.blog_posts (id,title,subtitle,slug,content,thumbnail_url,is_live,published_at,source,updated_at) values (${lit(b.id)},${lit(b.title)},${lit(b.subtitle)},${lit(b.slug)},${lit(b.content)},${lit(b.thumbnail_url)},${b.is_live},${lit(b.published_at)},${lit(b.source)},${lit(b.updated_at)})`
    );
  }
  psql(`update public.social_editorial_settings set mode='prepare', discovery_since='2026-08-01T00:00:00Z'`);
  console.log(`seeded ${fixtures.length} articles; settings mode=prepare discovery_since=2026-08-01`);

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
    `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${shimPort}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${jwt("anon")}`,
    `SUPABASE_SERVICE_ROLE_KEY=${jwt("service_role")}`,
    `STORAGE_BACKEND=supabase`,
    `CRON_SECRET=rehearsal-cron-secret-0123456789abcdef0123456789`,
    `SOCIAL_AUTHORING_TOKEN=rehearsal-authoring-token-0123456789abcdef0123456789`,
    `PMF_OPERATOR_USER_ID=20000000-0000-4000-8000-000000000001`,
    `PMF_OPERATOR_COMPANY_ID=10000000-0000-4000-8000-000000000001`,
    `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3120`,
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

const [, , command, worktree, migrationsDir] = process.argv;
if (command === "up") up(worktree, migrationsDir);
else if (command === "down") down();
else throw new Error("usage: stack.mjs up <worktree> <migrationsDir> | down");
