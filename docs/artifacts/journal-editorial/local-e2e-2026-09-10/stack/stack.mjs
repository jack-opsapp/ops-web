// Rehearsal stack for the weekly journal release: a disposable PostgreSQL 17
// database with the real cron, social and journal migrations, PostgREST, and a
// storage shim, so the Next.js worktree runs the whole claim → OPS source fetch
// → draft → preview → publish → Instagram discovery flow locally without
// touching production. Adapted from the Instagram rehearsal stack (2026-09-07).
//
//   node stack.mjs up   <worktree> <fixtures.json>
//   node stack.mjs down
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const socket = "/private/tmp/ops-editorial-pg/socket";
const pgPort = "55439";
const db = "ops_journal_e2e";
const restPort = 3313;
const shimPort = 3312;
const appPort = 3130;
const jwtSecret = "ops-journal-e2e-local-secret-0123456789abcdef0123456789";
const authenticatorPassword = "ops-journal-e2e-authenticator";
const stateDir = join(here, ".state");
const storageDir = join(stateDir, "storage");
const pidFile = join(stateDir, "pids.json");
const operator = { company: "10000000-0000-4000-8000-000000000001", user: "20000000-0000-4000-8000-000000000001" };

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
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

function jwt(role) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ role, iss: "supabase-local", iat: 1700000000, exp: 4102444800 });
  const sig = createHmac("sha256", jwtSecret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function up(worktree, fixturesPath) {
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
  // Production shapes of the blog tables the journal and Instagram code read.
  psql(`
    create table public.blog_categories (id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, created_at timestamptz not null default now());
    create table public.blog_posts (
      id uuid primary key default gen_random_uuid(), title text not null, subtitle text, slug text not null unique, author text,
      content text not null default '', summary text, teaser text, meta_title text, thumbnail_url text,
      category_id uuid references public.blog_categories(id), category2_id uuid references public.blog_categories(id),
      is_live boolean not null default false, display_views integer not null default 0, word_count integer not null default 0,
      faqs jsonb default '[]'::jsonb, published_at timestamptz, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), email_content text, linkedin_article text, image_prompt text,
      source text not null default 'breaking' check (source in ('weekly','breaking'))
    );
    create table public.blog_topics (id uuid primary key default gen_random_uuid(), topic text not null, author text not null default 'The Ops Team', image_url text, used boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.app_settings (key text primary key, value jsonb, updated_at timestamptz not null default now());
    create table public.newsletter_subscribers (id uuid primary key default gen_random_uuid(), email text not null unique, first_name text, source text, is_active boolean not null default true, subscribed_at timestamptz not null default now(), unsubscribed_at timestamptz);
    create table public.email_log (id uuid primary key default gen_random_uuid(), user_id uuid, email_type text, recipient_email text, subject text, sent_at timestamptz not null default now(), status text, error_message text, metadata jsonb);
    create table public.admins (email text primary key);
    grant usage on schema public to anon, authenticated, service_role;
  `);
  // The shared cron workload lease lives in the private schema and registers
  // pg_cron jobs; a minimal pg_cron stand-in lets the real migration apply.
  psql(`
    create schema if not exists private;
    grant usage on schema private to service_role;
    create schema if not exists cron;
    create table cron.job (jobid bigserial primary key, schedule text, command text, nodename text, nodeport integer, database text, username text, active boolean not null default true, jobname text unique);
    create table cron.job_run_details (jobid bigint, runid bigserial primary key, job_pid integer, database text, username text, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
    create function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$ declare v bigint; begin
      insert into cron.job(jobname,schedule,command) values(job_name,schedule,command)
      on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid into v; return v; end $$;
    create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null) returns void
      language plpgsql as $$ begin update cron.job j set active=coalesce(alter_job.active,j.active), schedule=coalesce(alter_job.schedule,j.schedule), command=coalesce(alter_job.command,j.command) where j.jobid=job_id; end $$;
    create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$ begin delete from cron.job where jobid=job_id; return found; end $$;
  `);
  const wanted = [
    "_cron_workload_controls.sql",
    "_create_social_publishing.sql",
    "_create_instagram_connection.sql",
    "_create_social_editorial.sql",
    "_create_social_editorial_assignments.sql",
    "_create_journal_editorial.sql",
  ];
  const migrationsDir = join(worktree, "supabase/migrations");
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

  // Operator recipient, real public journal metadata, backlog, switches.
  psql(`
    insert into public.companies (id, name) values ('${operator.company}', 'OPS Rehearsal');
    insert into public.users (id, company_id, first_name, last_name, is_active) values ('${operator.user}', '${operator.company}', 'Jackson', 'Rehearsal', true);
    insert into public.app_settings (key, value) values ('blog_newsletter_enabled', 'false'::jsonb);
    insert into public.newsletter_subscribers (email, first_name) values ('rehearsal-subscriber@example.com', 'Rehearsal');
  `);
  const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8"));
  for (const c of fixtures.categories) psql(`insert into public.blog_categories (id,name,slug) values (${lit(c.id)},${lit(c.name)},${lit(c.slug)})`);
  for (const t of fixtures.topics) psql(`insert into public.blog_topics (id,topic,author,used) values (${lit(t.id)},${lit(t.topic)},${lit(t.author)},false)`);
  for (const p of fixtures.posts)
    psql(
      `insert into public.blog_posts (id,title,subtitle,slug,author,content,summary,teaser,meta_title,thumbnail_url,category_id,is_live,word_count,published_at,source) values (${lit(p.id)},${lit(p.title)},${lit(p.subtitle)},${lit(p.slug)},${lit(p.author)},${lit(p.content ?? "")},${lit(p.summary)},${lit(p.teaser)},${lit(p.meta_title)},${lit(p.thumbnail_url)},${lit(p.category_id)},true,${Number(p.word_count) || 0},${lit(p.published_at)},${lit(p.source)})`
    );
  // Instagram adapts only what goes live from now on; the journal writer opens
  // Monday's slot now instead of Friday, so the rehearsal can claim it today.
  psql(`update public.social_editorial_settings set mode='prepare', discovery_since=now()`);
  psql(`update public.journal_editorial_settings set mode='prepare', draft_open_hours=120`);
  console.log(`seeded ${fixtures.posts.length} live posts, ${fixtures.categories.length} categories, ${fixtures.topics.length} backlog topics`);

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
  const shim = spawn(process.execPath, [join(here, "shim.mjs"), String(shimPort), String(restPort), storageDir], {
    detached: true,
    stdio: ["ignore", openLog("shim.log"), openLog("shim.log")],
  });
  rest.unref();
  shim.unref();
  writeFileSync(pidFile, JSON.stringify({ postgrest: rest.pid, shim: shim.pid }));
  const env = [
    "# Rehearsal environment for the disposable journal stack. Never production.",
    `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${shimPort}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${jwt("anon")}`,
    `SUPABASE_SERVICE_ROLE_KEY=${jwt("service_role")}`,
    `STORAGE_BACKEND=supabase`,
    `CRON_SECRET=rehearsal-cron-secret-0123456789abcdef0123456789`,
    `JOURNAL_AUTHORING_TOKEN=rehearsal-journal-token-0123456789abcdef0123456789`,
    `SOCIAL_AUTHORING_TOKEN=rehearsal-social-token-0123456789abcdef0123456789`,
    `PMF_OPERATOR_USER_ID=${operator.user}`,
    `PMF_OPERATOR_COMPANY_ID=${operator.company}`,
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

const [, , command, worktree, fixturesPath] = process.argv;
if (command === "up") up(worktree, fixturesPath);
else if (command === "down") down();
else throw new Error("usage: stack.mjs up <worktree> <fixtures.json> | down");
