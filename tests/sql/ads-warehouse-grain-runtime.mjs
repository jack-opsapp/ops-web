// Runtime contract for the Google Ads warehouse extension
// (20260909123000_ads_warehouse_grain.sql) and the follow-up that admits
// campaign_shared_set rows (20260909180000_ads_entities_campaign_shared_set.sql).
// Applies the outbox migration first (the funnel view reads its tables), then
// the grain migration, on a disposable PostgreSQL 17 cluster with
// production-shaped stubs. The follow-up is applied mid-run, so the harness
// proves the constraint both before and after it.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const cluster = `/private/tmp/ops-ads-grain-pg-${process.pid}`;
const port = String(55600 + (process.pid % 97));
const env = { ...process.env, LC_ALL: "C" };
const args = ["-h", cluster, "-p", port];
const db = "ads_warehouse_grain_test";
const stderrMode = process.env.ADS_HARNESS_DEBUG ? "inherit" : "pipe";
const run = (cmd, a, opts = {}) =>
  execFileSync(bin + cmd, a, { encoding: "utf8", stdio: ["pipe", "pipe", stderrMode], env, ...opts });
const sql = (q) =>
  run("psql", [...args, "-d", db, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", q]).trim();
const migration = (suffix) =>
  readFileSync(
    "supabase/migrations/" + readdirSync("supabase/migrations").find((x) => x.endsWith(suffix)),
    "utf8"
  );

const companyA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const companyB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const companyC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

mkdirSync(cluster, { recursive: true });
run("initdb", ["-D", `${cluster}/data`, "-A", "trust", "--no-locale", "-E", "UTF8"]);
run("pg_ctl", ["-D", `${cluster}/data`, "-l", `${cluster}/server.log`, "-o", `-p ${port} -k ${cluster} -h ''`, "-w", "start"]);
try {
  run("createdb", [...args, db]);
  sql(
    "DO $$ BEGIN IF NOT EXISTS(select from pg_roles where rolname='anon') THEN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; END IF; END $$;" +
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;" +
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;" +
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;" +
      "CREATE TABLE public.companies(id uuid primary key, name text not null default 'co', subscription_plan text, trial_start_date timestamptz, created_at timestamptz default now(), deleted_at timestamptz);" +
      "CREATE TABLE public.projects(id uuid primary key default gen_random_uuid(), company_id uuid not null, title text not null default 'job', created_at timestamptz default now(), deleted_at timestamptz);" +
      "CREATE TABLE public.billing_events(id uuid primary key default gen_random_uuid(), stripe_event_id text not null, event_type text not null, stripe_customer_id text, company_id uuid, amount_cents bigint, currency text, occurred_at timestamptz not null, received_at timestamptz not null default now(), raw jsonb not null default '{}'::jsonb);" +
      "CREATE TABLE public.trial_attributions(id uuid primary key default gen_random_uuid(), company_id uuid not null unique, utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, gclid text, fbclid text, landing_url text, trial_started_at timestamptz not null, first_paid_at timestamptz, attributed_channel text not null default 'unknown', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), referrer text, first_touch_at timestamptz, self_reported_source text, attribution_basis text not null default 'unknown', attribution_confidence numeric, classification_reason text, capture_version smallint not null default 1);" +
      "CREATE TABLE public.touchpoints(id uuid primary key default gen_random_uuid(), company_id uuid, anonymous_id text, occurred_at timestamptz not null, canonical_channel text not null, sub_channel text, campaign text, landing_path text, referrer_domain text, click_ids jsonb not null default '{}'::jsonb, raw_source jsonb not null default '{}'::jsonb, attribution_basis text not null, attribution_confidence numeric not null, capture_version smallint not null, dedupe_key text not null, expires_at timestamptz, created_at timestamptz not null default now());" +
      "CREATE TABLE public.users(id uuid primary key default gen_random_uuid(), company_id uuid, email text, is_company_admin boolean, created_at timestamptz default now(), deleted_at timestamptz);" +
      "CREATE OR REPLACE FUNCTION public.seed_trial_attribution_for_company() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$ begin insert into public.trial_attributions (company_id, trial_started_at, attributed_channel) values (new.id, coalesce(new.trial_start_date, new.created_at, now()), 'unknown') on conflict (company_id) do nothing; return new; end $f$;" +
      "CREATE TRIGGER companies_seed_trial_attribution AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION public.seed_trial_attribution_for_company();" +
      "CREATE OR REPLACE FUNCTION public.pmf_update_first_paid_at() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $f$ begin return new; end $f$;" +
      "CREATE TRIGGER billing_events_first_paid AFTER INSERT ON public.billing_events FOR EACH ROW EXECUTE FUNCTION public.pmf_update_first_paid_at();" +
      // The keyword table exactly as production has it today (0 rows, key (date, keyword)).
      "CREATE TABLE public.ads_daily_keyword(date date not null, keyword text not null, match_type text not null, spend numeric not null default 0, clicks integer not null default 0, impressions integer not null default 0, conversions numeric not null default 0, quality_score integer, synced_at timestamptz not null default now(), primary key (date, keyword));" +
      "ALTER TABLE public.ads_daily_keyword ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.ads_daily_keyword FROM anon, authenticated;"
  );
  sql(migration("_ads_conversion_outbox.sql"));
  sql(migration("_ads_warehouse_grain.sql"));

  // --- tables, keys, RLS, grants ------------------------------------------
  const expectPk = (table, cols) =>
    assert.equal(
      sql(`select string_agg(a.attname, ',' order by k.ordinality) from pg_index i join pg_class c on c.oid = i.indrelid join unnest(i.indkey) with ordinality as k(attnum, ordinality) on true join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum where c.relname = '${table}' and i.indisprimary`),
      cols,
      `${table} primary key`
    );
  expectPk("ads_daily_ad_group", "date,ad_group_id");
  expectPk("ads_daily_ad", "date,ad_id");
  expectPk("ads_daily_asset", "date,ad_id,asset_id,field_type");
  expectPk("ads_daily_keyword", "date,ad_group_id,criterion_id");
  expectPk("ads_entities", "resource_name");
  expectPk("ads_click_map", "gclid");
  assert.equal(
    sql("select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='ads_daily_keyword'"),
    "date,campaign_id,campaign_name,ad_group_id,ad_group_name,criterion_id,keyword,match_type,status,quality_score,spend,clicks,impressions,conversions,average_cpc,synced_at",
    "ads_daily_keyword is recreated with the ad-group + criterion grain"
  );
  for (const table of ["ads_daily_ad_group", "ads_daily_ad", "ads_daily_asset", "ads_daily_keyword", "ads_entities", "ads_click_map"]) {
    assert.equal(sql(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`), "t", `${table} RLS`);
    for (const role of ["anon", "authenticated"]) {
      assert.equal(sql(`select has_table_privilege('${role}', 'public.${table}', 'SELECT')`), "f", `${role} must not read ${table}`);
    }
    assert.equal(sql(`select has_table_privilege('service_role', 'public.${table}', 'SELECT')`), "t");
  }
  for (const table of ["ads_daily_ad_group", "ads_daily_ad", "ads_daily_asset", "ads_daily_keyword"]) {
    assert.equal(
      sql(`select count(*) from pg_indexes where tablename='${table}' and indexdef ilike '%(date desc)%'`),
      "1",
      `${table} has a date desc index`
    );
  }
  assert.equal(sql("select count(*) from pg_indexes where tablename='ads_click_map' and indexdef ilike '%click_date%'"), "1");
  for (const role of ["anon", "authenticated"]) {
    assert.equal(sql(`select has_table_privilege('${role}', 'public.ads_funnel_by_keyword', 'SELECT')`), "f", `${role} must not read the funnel view`);
  }
  assert.equal(sql("select has_table_privilege('service_role', 'public.ads_funnel_by_keyword', 'SELECT')"), "t");
  assert.equal(
    sql("select coalesce((select option_value from pg_options_to_table((select reloptions from pg_class where relname='ads_funnel_by_keyword')) where option_name='security_invoker'), 'off')"),
    "off",
    "the funnel view runs as its owner (service-role only, never invoker)"
  );

  // --- funnel arithmetic ---------------------------------------------------
  sql(
    "insert into public.ads_daily_keyword(date, campaign_id, campaign_name, ad_group_id, ad_group_name, criterion_id, keyword, match_type, status, quality_score, spend, clicks, impressions, conversions, average_cpc) values " +
      "('2026-09-01','c1','Jobber alt','g1','jobber','k1','jobber alternative','PHRASE','ENABLED',7,10.00,1,40,0,10.00)," +
      "('2026-09-02','c1','Jobber alt','g1','jobber','k1','jobber alternative','PHRASE','ENABLED',7,15.00,1,60,0,15.00)," +
      "('2026-09-02','c1','Jobber alt','g1','jobber','k2','jobber pricing','EXACT','ENABLED',null,8.00,2,20,0,4.00)," +
      "('2026-09-02','c2','Scheduling','g2','sched','k3','crew scheduling app','PHRASE','ENABLED',6,5.00,1,30,0,5.00)"
  );
  sql(
    "insert into public.ads_click_map(gclid, click_date, campaign_id, ad_group_id, ad_id, criterion_id, keyword) values " +
      "('g-a','2026-09-01','c1','g1','ad1','k1','jobber alternative')," +
      "('g-b','2026-09-02','c1','g1','ad1','k1','jobber alternative')," +
      "('g-c','2026-09-02','c2','g2','ad2','k3','crew scheduling app')"
  );
  sql(`insert into public.companies(id) values ('${companyA}'),('${companyB}'),('${companyC}')`);
  sql(`update public.trial_attributions set gclid='g-a', first_paid_at=now() where company_id='${companyA}'`);
  sql(`update public.trial_attributions set gclid='g-b' where company_id='${companyB}'`);
  sql(`update public.trial_attributions set gclid='g-unmatched' where company_id='${companyC}'`);
  sql(`insert into public.ads_conversion_events(company_id, kind, occurred_at, transaction_id) values ('${companyA}','trial_activated',now(),'trial_activated:${companyA}')`);

  const row = (criterion) =>
    sql(
      `select clicks || '|' || spend || '|' || trials || '|' || activated || '|' || paid || '|' || coalesce(cost_per_trial::text,'null') || '|' || coalesce(cost_per_paid::text,'null') from public.ads_funnel_by_keyword where criterion_id='${criterion}'`
    );
  assert.equal(row("k1"), "2|25.00|2|1|1|12.50|25.00", "keyword k1: 2 clicks, $25, 2 trials, 1 activated, 1 paid");
  assert.equal(row("k2"), "2|8.00|0|0|0|null|null", "keyword k2: clicks and spend, no trials, no cost per trial");
  assert.equal(row("k3"), "1|5.00|0|0|0|null|null", "keyword k3: a click-map row whose company never attributed stays at zero");
  assert.equal(
    sql("select string_agg(criterion_id || ':' || campaign_name || ':' || ad_group_name || ':' || keyword || ':' || match_type, ',' order by criterion_id) from public.ads_funnel_by_keyword"),
    "k1:Jobber alt:jobber:jobber alternative:PHRASE,k2:Jobber alt:jobber:jobber pricing:EXACT,k3:Scheduling:sched:crew scheduling app:PHRASE"
  );

  // --- entity snapshot + click map upsert semantics ------------------------
  sql(
    "insert into public.ads_entities(resource_name, entity_type, parent_resource_name, name, status, payload, labels, snapshot_at) values ('customers/1/campaigns/1','campaign',null,'Jobber alt','PAUSED','{\"campaign\":{\"id\":\"1\"}}','{}',now())"
  );
  sql(
    "insert into public.ads_entities(resource_name, entity_type, parent_resource_name, name, status, payload, labels, snapshot_at) values ('customers/1/campaigns/1','campaign',null,'Jobber alt','ENABLED','{\"campaign\":{\"id\":\"1\"}}','{engine}',now()) on conflict (resource_name) do update set status=excluded.status, labels=excluded.labels, snapshot_at=excluded.snapshot_at"
  );
  assert.equal(sql("select status || '|' || array_to_string(labels, ',') from public.ads_entities"), "ENABLED|engine", "snapshot rows upsert by resource name");
  assert.equal(sql("select count(*) from public.ads_entities where entity_type not in ('campaign','campaign_budget','ad_group','ad','keyword','negative_keyword','shared_set','shared_criterion','campaign_shared_set','label')"), "0");
  assert.match(
    (() => { try { sql("insert into public.ads_entities(resource_name, entity_type, name, status, payload, labels, snapshot_at) values ('x','bogus','n','s','{}','{}',now())"); return ""; } catch (e) { return String(e.stderr ?? e.message); } })(),
    /check constraint/i,
    "entity_type is constrained"
  );

  // --- follow-up: campaign_shared_set joins a negative list to a campaign --
  // Rejected by the shipped nine-value check, accepted once the follow-up
  // migration widens it. Proving both sides keeps the follow-up load-bearing.
  const attachment =
    "insert into public.ads_entities(resource_name, entity_type, parent_resource_name, name, status, payload, labels, snapshot_at) values ('customers/1/campaignSharedSets/1~4','campaign_shared_set','customers/1/campaigns/1','customers/1/sharedSets/4','ENABLED','{\"campaignSharedSet\":{\"sharedSet\":\"customers/1/sharedSets/4\"}}','{}',now())";
  assert.match(
    (() => { try { sql(attachment); return ""; } catch (e) { return String(e.stderr ?? e.message); } })(),
    /check constraint/i,
    "campaign_shared_set is refused before the follow-up migration"
  );
  sql(migration("_ads_entities_campaign_shared_set.sql"));
  sql(attachment);
  assert.equal(
    sql("select entity_type || '|' || parent_resource_name from public.ads_entities where resource_name = 'customers/1/campaignSharedSets/1~4'"),
    "campaign_shared_set|customers/1/campaigns/1",
    "campaign_shared_set is stored after the follow-up migration"
  );
  assert.match(
    (() => { try { sql("insert into public.ads_entities(resource_name, entity_type, name, status, payload, labels, snapshot_at) values ('y','bogus','n','s','{}','{}',now())"); return ""; } catch (e) { return String(e.stderr ?? e.message); } })(),
    /check constraint/i,
    "the widened check still refuses an unknown entity_type"
  );
  // Re-running the follow-up is a no-op, not an error.
  sql(migration("_ads_entities_campaign_shared_set.sql"));

  console.log("PASS: grain tables + keys + RLS + indexes, keyword table recreated, funnel view arithmetic, entity snapshot upsert, campaign_shared_set admitted by the follow-up migration");
} finally {
  try { run("pg_ctl", ["-D", `${cluster}/data`, "-m", "fast", "-w", "stop"]); } catch {}
  rmSync(cluster, { recursive: true, force: true });
}
