// Proof stack for the phase 1 daily sync (v25 field fix + campaign_shared_set).
// A disposable PostgreSQL 17 database carrying the REAL phase 1 migrations
// behind PostgREST and the storage shim, so the worktree dev server can run
// GET /api/cron/ads-sync against the live Google Ads account (reads only)
// without touching production.
//
//   node stack.mjs up   <worktree>
//   node stack.mjs down
//
// Same recipe as the phase 3 rehearsal stack
// (ops-web/docs/artifacts/ads-engine/p3/local-e2e-2026-09-08/stack/stack.mjs),
// with two deliberate differences: it applies the real warehouse migrations
// instead of that rehearsal's hand-written warehouse-fixture.sql, and it uses
// its own database name and ports so a sibling session running the phase 3
// stack is never disturbed.
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const socket = "/private/tmp/ops-editorial-pg/socket";
const pgPort = "55439";
const db = "ops_ads_p1_sync";
const restPort = 3033;
const shimPort = 3032;
const appPort = 3245;
const jwtSecret = "ops-ads-p1-local-secret-0123456789abcdef0123456789abcdef";
const authenticatorPassword = "ops-ads-p1-authenticator";
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

// The pre-existing objects the phase 1 migrations build on, in the shapes
// production actually has (columns pulled from the live database on
// 2026-09-09). The stubs mirror tests/sql/ads-warehouse-grain-runtime.mjs.
const baseline = `
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

create table public.companies(id uuid primary key, name text not null default 'co', subscription_plan text, trial_start_date timestamptz, created_at timestamptz default now(), deleted_at timestamptz);
create table public.projects(id uuid primary key default gen_random_uuid(), company_id uuid not null, title text not null default 'job', created_at timestamptz default now(), deleted_at timestamptz);
create table public.billing_events(id uuid primary key default gen_random_uuid(), stripe_event_id text not null, event_type text not null, stripe_customer_id text, company_id uuid, amount_cents bigint, currency text, occurred_at timestamptz not null, received_at timestamptz not null default now(), raw jsonb not null default '{}'::jsonb);
create table public.trial_attributions(id uuid primary key default gen_random_uuid(), company_id uuid not null unique, utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, gclid text, fbclid text, landing_url text, trial_started_at timestamptz not null, first_paid_at timestamptz, attributed_channel text not null default 'unknown', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), referrer text, first_touch_at timestamptz, self_reported_source text, attribution_basis text not null default 'unknown', attribution_confidence numeric, classification_reason text, capture_version smallint not null default 1);
create table public.touchpoints(id uuid primary key default gen_random_uuid(), company_id uuid, anonymous_id text, occurred_at timestamptz not null, canonical_channel text not null, sub_channel text, campaign text, landing_path text, referrer_domain text, click_ids jsonb not null default '{}'::jsonb, raw_source jsonb not null default '{}'::jsonb, attribution_basis text not null, attribution_confidence numeric not null, capture_version smallint not null, dedupe_key text not null, expires_at timestamptz, created_at timestamptz not null default now());
create table public.users(id uuid primary key default gen_random_uuid(), company_id uuid, email text, is_company_admin boolean, created_at timestamptz default now(), deleted_at timestamptz);
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid, company_id uuid, type text, title text, body text, is_read boolean not null default false, persistent boolean not null default false, action_url text, action_label text, created_at timestamptz not null default now());
create or replace function public.seed_trial_attribution_for_company() returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$ begin insert into public.trial_attributions (company_id, trial_started_at, attributed_channel) values (new.id, coalesce(new.trial_start_date, new.created_at, now()), 'unknown') on conflict (company_id) do nothing; return new; end $f$;
create trigger companies_seed_trial_attribution after insert on public.companies for each row execute function public.seed_trial_attribution_for_company();
create or replace function public.pmf_update_first_paid_at() returns trigger language plpgsql set search_path to 'public','pg_temp' as $f$ begin return new; end $f$;
create trigger billing_events_first_paid after insert on public.billing_events for each row execute function public.pmf_update_first_paid_at();

-- The ads_daily_* tables and the sync ledger exactly as production holds them.
create table public.ads_daily_account(date date primary key, spend numeric not null default 0, clicks integer not null default 0, impressions integer not null default 0, conversions numeric not null default 0, cpa numeric not null default 0, ctr numeric not null default 0, synced_at timestamptz not null default now());
create table public.ads_daily_campaign(date date not null, campaign_name text not null, campaign_status text not null default 'ENABLED', spend numeric not null default 0, clicks integer not null default 0, impressions integer not null default 0, conversions numeric not null default 0, cpa numeric not null default 0, ctr numeric not null default 0, synced_at timestamptz not null default now(), primary key (date, campaign_name));
create table public.ads_sync_status(id text primary key, status text not null default 'idle', last_synced_date date, backfill_progress jsonb, error text, updated_at timestamptz not null default now());
insert into public.ads_sync_status(id, status) values ('daily-sync','idle'), ('backfill','idle');
-- The keyword grain as production had it before the grain migration recreates it.
create table public.ads_daily_keyword(date date not null, keyword text not null, match_type text not null, spend numeric not null default 0, clicks integer not null default 0, impressions integer not null default 0, conversions numeric not null default 0, quality_score integer, synced_at timestamptz not null default now(), primary key (date, keyword));
alter table public.ads_daily_keyword enable row level security;
revoke all on public.ads_daily_keyword from anon, authenticated;
`;

// Applied in dependency order: the workload lease the cron route takes, the
// search-term grain, the conversion outbox (the funnel view reads its
// tables), the warehouse grain, then the campaign_shared_set follow-up.
const wanted = [
  "_cron_workload_controls.sql",
  "_ads_daily_search_terms.sql",
  "_ads_conversion_outbox.sql",
  "_ads_warehouse_grain.sql",
  "_ads_entities_campaign_shared_set.sql",
];

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
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists private;
    grant usage on schema private to service_role;
  `);
  psql(baseline);
  const files = readdirSync(migrationsDir);
  for (const suffix of wanted) {
    const file = files.find((f) => f.endsWith(suffix));
    if (!file) throw new Error(`migration missing: *${suffix}`);
    psqlFile(join(migrationsDir, file));
    console.log(`applied ${file}`);
  }
  psql(`grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;
    grant all on all functions in schema public to service_role;
    grant all on all tables in schema private to service_role; grant all on all sequences in schema private to service_role;
    grant all on all functions in schema private to service_role;`);
  console.log(
    psql(
      "select 'entities '||count(*) from public.ads_entities union all select 'sync status '||count(*) from public.ads_sync_status union all select 'daily account '||count(*) from public.ads_daily_account"
    )
  );

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
    "# ── phase 1 sync proof stack (local only; never committed, never production) ──",
    `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${shimPort}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${jwt("anon")}`,
    `SUPABASE_SERVICE_ROLE_KEY=${jwt("service_role")}`,
    `CRON_SECRET=p1-sync-proof-secret-0123456789abcdef0123456789`,
    `NEXT_PUBLIC_APP_URL=http://127.0.0.1:${appPort}`,
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
