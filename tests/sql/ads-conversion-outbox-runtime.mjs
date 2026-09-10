// Runtime contract for the Google Ads conversion outbox migration
// (20260909120000_ads_conversion_outbox.sql). Provisions a disposable
// PostgreSQL 17 cluster, stubs only the tables the migration references with
// their production shapes, applies the migration, and proves every trigger,
// function, grant, and the widened first-touch RPC. Never touches a remote
// database.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const cluster = `/private/tmp/ops-ads-outbox-pg-${process.pid}`;
const port = String(55497 + (process.pid % 97));
const env = { ...process.env, LC_ALL: "C" };
const args = ["-h", cluster, "-p", port];
const db = "ads_conversion_outbox_test";
// ADS_HARNESS_DEBUG=1 streams Postgres NOTICE/WARNING lines to the terminal.
const stderrMode = process.env.ADS_HARNESS_DEBUG ? "inherit" : "pipe";
const run = (cmd, a, opts = {}) =>
  execFileSync(bin + cmd, a, { encoding: "utf8", stdio: ["pipe", "pipe", stderrMode], env, ...opts });
const sql = (q, role = null) =>
  run("psql", [
    ...args,
    "-d",
    db,
    "-XAtq",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    role ? `set role ${role}; ${q}` : q,
  ]).trim();
const sqlFails = (q, role = null) => {
  try {
    sql(q, role);
    return null;
  } catch (err) {
    return String(err.stderr ?? err.message);
  }
};
const migration = (suffix) =>
  readFileSync(
    "supabase/migrations/" +
      readdirSync("supabase/migrations").find((x) => x.endsWith(suffix)),
    "utf8"
  );

const companyA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const companyB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const companyC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const companyD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const anon = "11111111-1111-4111-8111-111111111111";

mkdirSync(cluster, { recursive: true });
run("initdb", ["-D", `${cluster}/data`, "-A", "trust", "--no-locale", "-E", "UTF8"]);
run("pg_ctl", [
  "-D",
  `${cluster}/data`,
  "-l",
  `${cluster}/server.log`,
  "-o",
  `-p ${port} -k ${cluster} -h ''`,
  "-w",
  "start",
]);
try {
  run("createdb", [...args, db]);
  sql(
    "DO $$ BEGIN IF NOT EXISTS(select from pg_roles where rolname='anon') THEN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; END IF; END $$;" +
      // Supabase's default privileges for the migrating role (verified in
      // production 2026-09-09): every new table, sequence, and function is
      // granted to anon / authenticated / service_role unless the migration
      // revokes it — which is exactly what this migration must prove it does.
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;" +
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;" +
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;" +
      // Production shapes, trimmed to the columns the migration touches.
      "CREATE TABLE public.companies(id uuid primary key, name text not null default 'co', subscription_plan text, trial_start_date timestamptz, created_at timestamptz default now(), deleted_at timestamptz);" +
      "CREATE TABLE public.projects(id uuid primary key default gen_random_uuid(), company_id uuid not null, title text not null default 'job', created_at timestamptz default now(), deleted_at timestamptz);" +
      "CREATE TABLE public.billing_events(id uuid primary key default gen_random_uuid(), stripe_event_id text not null, event_type text not null, stripe_customer_id text, company_id uuid, amount_cents bigint, currency text, occurred_at timestamptz not null, received_at timestamptz not null default now(), raw jsonb not null default '{}'::jsonb);" +
      "CREATE TABLE public.trial_attributions(id uuid primary key default gen_random_uuid(), company_id uuid not null unique, utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, gclid text, fbclid text, landing_url text, trial_started_at timestamptz not null, first_paid_at timestamptz, attributed_channel text not null default 'unknown', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), referrer text, first_touch_at timestamptz, self_reported_source text, attribution_basis text not null default 'unknown', attribution_confidence numeric, classification_reason text, capture_version smallint not null default 1);" +
      "CREATE TABLE public.touchpoints(id uuid primary key default gen_random_uuid(), company_id uuid, anonymous_id text, occurred_at timestamptz not null, canonical_channel text not null, sub_channel text, campaign text, landing_path text, referrer_domain text, click_ids jsonb not null default '{}'::jsonb, raw_source jsonb not null default '{}'::jsonb, attribution_basis text not null, attribution_confidence numeric not null, capture_version smallint not null, dedupe_key text not null, expires_at timestamptz, created_at timestamptz not null default now());" +
      "CREATE TABLE public.users(id uuid primary key default gen_random_uuid(), company_id uuid, email text, is_company_admin boolean, created_at timestamptz default now(), deleted_at timestamptz);" +
      // Production trigger functions the migration replaces, in their live shape.
      "CREATE OR REPLACE FUNCTION public.seed_trial_attribution_for_company() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$ begin begin insert into public.trial_attributions (company_id, trial_started_at, attributed_channel) values (new.id, coalesce(new.trial_start_date, new.created_at, now()), 'unknown') on conflict (company_id) do nothing; exception when others then raise warning 'seed failed %', sqlerrm; end; return new; end $f$;" +
      "CREATE TRIGGER companies_seed_trial_attribution AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION public.seed_trial_attribution_for_company();" +
      "CREATE OR REPLACE FUNCTION public.pmf_update_first_paid_at() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $f$ begin if new.event_type = 'invoice.paid' and new.company_id is not null then update public.trial_attributions set first_paid_at = new.occurred_at, updated_at = now() where company_id = new.company_id and first_paid_at is null; end if; return new; end $f$;" +
      "CREATE TRIGGER billing_events_first_paid AFTER INSERT ON public.billing_events FOR EACH ROW EXECUTE FUNCTION public.pmf_update_first_paid_at();" +
      // App roles write projects; the webhook writes billing_events as service_role.
      "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;" +
      "GRANT SELECT, INSERT ON public.projects TO authenticated;" +
      "GRANT SELECT ON public.companies TO authenticated;" +
      "GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;"
  );

  sql(migration("_ads_conversion_outbox.sql"));

  // --- tables + grants ----------------------------------------------------
  for (const table of ["ads_conversion_actions", "ads_conversion_events"]) {
    assert.equal(
      sql(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`),
      "t",
      `${table} has RLS enabled`
    );
    for (const role of ["anon", "authenticated"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        assert.equal(
          sql(`select has_table_privilege('${role}', 'public.${table}', '${priv}')`),
          "f",
          `${role} must not ${priv} ${table}`
        );
      }
    }
    assert.equal(
      sql(`select has_table_privilege('service_role', 'public.${table}', 'SELECT')`),
      "t",
      `service_role reads ${table}`
    );
  }
  assert.equal(
    sql(
      "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='ads_conversion_events'"
    ),
    "id,company_id,kind,occurred_at,value,currency,transaction_id,state,attempts,next_attempt_at,last_error,sent_at,google_request_id,created_at"
  );
  assert.equal(
    sql(
      "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name='trial_attributions' and column_name in ('gbraid','wbraid')"
    ),
    "gbraid,wbraid",
    "trial_attributions gains gbraid + wbraid"
  );

  // --- function grants -----------------------------------------------------
  const enqueueSig = "public.ads_enqueue_conversion_event(uuid,text,timestamptz,numeric)";
  for (const role of ["anon", "authenticated"]) {
    assert.equal(
      sql(`select has_function_privilege('${role}', '${enqueueSig}', 'EXECUTE')`),
      "f",
      `${role} must not execute the enqueue function`
    );
  }
  assert.equal(
    sql(`select has_function_privilege('service_role', '${enqueueSig}', 'EXECUTE')`),
    "t",
    "service_role executes the enqueue function (paid trigger runs as the webhook's role)"
  );

  // --- plan value ----------------------------------------------------------
  assert.equal(sql("select public.ads_plan_annual_value('starter', null)"), "1080");
  assert.equal(sql("select public.ads_plan_annual_value('team', null)"), "1680");
  assert.equal(sql("select public.ads_plan_annual_value('business', null)"), "2280");
  assert.equal(sql("select public.ads_plan_annual_value(null, 9000)"), "1080.00");
  assert.equal(sql("select public.ads_plan_annual_value('unknown_plan', 14000)"), "1680.00");
  assert.equal(sql("select public.ads_plan_annual_value(null, null) is null"), "t");

  // --- trial_started on company insert ------------------------------------
  sql(
    `insert into public.companies(id, subscription_plan, created_at) values ('${companyA}', 'team', now() - interval '10 minutes')`
  );
  assert.equal(
    sql(`select count(*) from public.trial_attributions where company_id='${companyA}'`),
    "1",
    "the existing seed still runs"
  );
  assert.equal(
    sql(
      `select kind || '|' || transaction_id || '|' || state || '|' || attempts || '|' || coalesce(value::text,'null') || '|' || currency from public.ads_conversion_events where company_id='${companyA}'`
    ),
    `trial_started|trial_started:${companyA}|queued|0|null|CAD`,
    "company insert enqueues exactly one trial_started event"
  );
  assert.equal(
    sql(
      `select occurred_at = (select created_at from public.companies where id='${companyA}') from public.ads_conversion_events where company_id='${companyA}'`
    ),
    "t",
    "trial_started occurred_at follows the company timestamp"
  );
  sql(`select public.ads_enqueue_conversion_event('${companyA}', 'trial_started', now(), null)`);
  sql(`select public.ads_enqueue_conversion_event('${companyA}', 'trial_started', now(), null)`);
  assert.equal(
    sql(`select count(*) from public.ads_conversion_events where company_id='${companyA}' and kind='trial_started'`),
    "1",
    "re-enqueueing the same kind for the same company is a no-op (transaction_id)"
  );
  assert.equal(
    sqlFails(`select public.ads_enqueue_conversion_event('${companyA}', 'not_a_kind', now(), null)`),
    null,
    "an invalid kind is swallowed as a warning, never raised"
  );
  assert.equal(
    sql(`select count(*) from public.ads_conversion_events where kind='not_a_kind'`),
    "0"
  );

  // --- trial_activated on the first real project ---------------------------
  // Runs as `authenticated`, the role that inserts projects from the apps.
  sql(
    `insert into public.projects(company_id, created_at) values ('${companyA}', (select created_at from public.companies where id='${companyA}') + interval '60 seconds')`,
    "authenticated"
  );
  assert.equal(
    sql(`select count(*) from public.ads_conversion_events where company_id='${companyA}' and kind='trial_activated'`),
    "0",
    "a project inside the 2-minute import window is not an activation"
  );
  sql(
    `insert into public.projects(company_id, created_at) values ('${companyA}', (select created_at from public.companies where id='${companyA}') + interval '3 minutes')`,
    "authenticated"
  );
  assert.equal(
    sql(
      `select transaction_id || '|' || (occurred_at = (select created_at from public.companies where id='${companyA}') + interval '3 minutes')::text from public.ads_conversion_events where company_id='${companyA}' and kind='trial_activated'`
    ),
    `trial_activated:${companyA}|true`,
    "the first project after the window enqueues trial_activated once"
  );
  sql(
    `insert into public.projects(company_id, created_at) values ('${companyA}', (select created_at from public.companies where id='${companyA}') + interval '4 minutes')`,
    "authenticated"
  );
  assert.equal(
    sql(`select count(*) from public.ads_conversion_events where company_id='${companyA}' and kind='trial_activated'`),
    "1",
    "a second project enqueues nothing"
  );
  // A soft-deleted project never activates; a null created_at company still can.
  sql(`insert into public.companies(id, subscription_plan, created_at) values ('${companyB}', 'starter', null)`);
  sql(`insert into public.projects(company_id, deleted_at) values ('${companyB}', now())`, "authenticated");
  assert.equal(
    sql(`select count(*) from public.ads_conversion_events where company_id='${companyB}' and kind='trial_activated'`),
    "0",
    "a deleted project is not an activation"
  );
  sql(`insert into public.projects(company_id) values ('${companyB}')`, "authenticated");
  assert.equal(
    sql(`select count(*) from public.ads_conversion_events where company_id='${companyB}' and kind='trial_activated'`),
    "1",
    "a legacy company without created_at still activates on its first live project"
  );
  // A project for a company that does not exist neither activates nor aborts.
  sql(`insert into public.projects(company_id) values ('${companyD}')`, "authenticated");
  assert.equal(
    sql(`select count(*) from public.ads_conversion_events where company_id='${companyD}'`),
    "0"
  );

  // --- paid on the first invoice ------------------------------------------
  // Runs as `service_role`, the Stripe webhook's role.
  sql(
    `insert into public.billing_events(stripe_event_id, event_type, company_id, amount_cents, currency, occurred_at) values ('evt_1', 'invoice.paid', '${companyA}', 14000, 'cad', now() - interval '1 minute')`,
    "service_role"
  );
  assert.equal(
    sql(`select first_paid_at is not null from public.trial_attributions where company_id='${companyA}'`),
    "t",
    "first_paid_at is still stamped"
  );
  assert.equal(
    sql(
      `select transaction_id || '|' || value::text || '|' || currency || '|' || (occurred_at = (select occurred_at from public.billing_events where stripe_event_id='evt_1'))::text from public.ads_conversion_events where company_id='${companyA}' and kind='paid'`
    ),
    `paid:${companyA}|1680.00|CAD|true`,
    "the first invoice.paid enqueues paid with the plan's annual value"
  );
  sql(
    `insert into public.billing_events(stripe_event_id, event_type, company_id, amount_cents, currency, occurred_at) values ('evt_2', 'invoice.paid', '${companyA}', 14000, 'cad', now())`,
    "service_role"
  );
  assert.equal(
    sql(`select count(*) from public.ads_conversion_events where company_id='${companyA}' and kind='paid'`),
    "1",
    "a second invoice.paid enqueues nothing"
  );
  sql(
    `insert into public.billing_events(stripe_event_id, event_type, company_id, amount_cents, currency, occurred_at) values ('evt_3', 'invoice.payment_failed', '${companyB}', 9000, 'cad', now())`,
    "service_role"
  );
  assert.equal(
    sql(`select count(*) from public.ads_conversion_events where company_id='${companyB}' and kind='paid'`),
    "0",
    "other billing events never enqueue"
  );
  // Unknown plan falls back to the invoice amount annualised.
  sql(`insert into public.companies(id, subscription_plan) values ('${companyC}', null)`);
  sql(
    `insert into public.billing_events(stripe_event_id, event_type, company_id, amount_cents, currency, occurred_at) values ('evt_4', 'invoice.paid', '${companyC}', 19000, 'cad', now())`,
    "service_role"
  );
  assert.equal(
    sql(`select value::text from public.ads_conversion_events where company_id='${companyC}' and kind='paid'`),
    "2280.00"
  );

  // --- outbox ready index + state check ------------------------------------
  assert.equal(
    sql(`select count(*) from pg_indexes where tablename='ads_conversion_events' and indexname='ads_conversion_events_ready_idx'`),
    "1"
  );
  assert.match(
    sqlFails(`update public.ads_conversion_events set state='bogus' where company_id='${companyA}'`) ?? "",
    /check constraint/i,
    "state is constrained"
  );

  // --- first-touch RPC stores gbraid/wbraid ---------------------------------
  const touch = (over) =>
    JSON.stringify({
      anonymous_id: anon,
      captured_at: new Date(Date.now() - 60_000).toISOString(),
      landing_path: "/job-management",
      channel: "google_ads",
      basis: "verified_click_id",
      confidence: 1,
      reason: "google_click_id_present",
      version: 1,
      utm_source: "google",
      utm_medium: "cpc",
      ...over,
    });
  assert.equal(
    sql(
      `select public.record_first_touch_attribution('${companyB}', '${touch({ gbraid: "gb-1", wbraid: "wb-1" })}'::jsonb)->>'status'`
    ),
    "recorded"
  );
  assert.equal(
    sql(
      `select coalesce(gclid,'-') || '|' || gbraid || '|' || wbraid || '|' || attributed_channel from public.trial_attributions where company_id='${companyB}'`
    ),
    "-|gb-1|wb-1|google_ads",
    "gbraid and wbraid land on trial_attributions"
  );
  assert.equal(
    sql(`select click_ids::text from public.touchpoints where company_id='${companyB}'`),
    '{"gbraid": "gb-1", "wbraid": "wb-1"}',
    "the touchpoint keeps both ids"
  );
  const old = new Date(Date.now() - (30 * 24 + 12) * 3600 * 1000).toISOString();
  assert.equal(
    sql(
      `select public.record_first_touch_attribution('${companyC}', '${touch({ captured_at: old, gclid: "old-g", gbraid: "old-gb", wbraid: "old-wb" })}'::jsonb)->>'status'`
    ),
    "recorded"
  );
  assert.equal(
    sql(
      `select (gclid is null and gbraid is null and wbraid is null)::text || '|' || attributed_channel from public.trial_attributions where company_id='${companyC}'`
    ),
    "true|google_ads",
    "click ids older than 30 days are nulled exactly like gclid"
  );
  assert.match(
    sqlFails(
      `select public.record_first_touch_attribution('${companyC}', '${touch({ channel: "bogus" })}'::jsonb)`
    ) ?? "",
    /INVALID_FIRST_TOUCH_CHANNEL/,
    "validation rules are unchanged"
  );

  // --- expiry scrub covers the new columns ---------------------------------
  sql(
    `update public.trial_attributions set first_touch_at = now() - interval '40 days', gclid='g', gbraid='gb', wbraid='wb' where company_id='${companyB}'`
  );
  sql("select public.expire_attribution_click_ids()");
  assert.equal(
    sql(
      `select (gclid is null and gbraid is null and wbraid is null)::text from public.trial_attributions where company_id='${companyB}'`
    ),
    "true",
    "expire_attribution_click_ids scrubs gbraid and wbraid"
  );

  console.log(
    "PASS: outbox tables + grants, plan value, trial_started/activated/paid triggers under app + webhook roles, idempotence, gbraid/wbraid capture + expiry"
  );
} finally {
  try {
    run("pg_ctl", ["-D", `${cluster}/data`, "-m", "fast", "-w", "stop"]);
  } catch {
    // already stopped
  }
  rmSync(cluster, { recursive: true, force: true });
}
