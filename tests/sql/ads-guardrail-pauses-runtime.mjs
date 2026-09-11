// Runtime contract for the disapproved-ad guardrail's ledger (GOOGLE ADS ENGINE - P2-1-1).
// Applies the engine migration, seeds the 2026-09-10 incident's alert shape,
// then applies the guardrail migration on a disposable PostgreSQL 17 database
// and proves the backfill, the episode rules, alert resolution, the rail's
// refusal to deliver a resolved alert, and the grants.
//
// Start the harness once per machine:
//   LC_ALL=C /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/ops-editorial-pg/data \
//     -o "-p 55439 -k /private/tmp/ops-editorial-pg/socket -c listen_addresses=''" start
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const args = ["-h", "/private/tmp/ops-editorial-pg/socket", "-p", "55439"];
const db = "ads_guardrail_test_" + process.pid;
const sql = (q) =>
  execFileSync(bin + "psql", [...args, "-d", db, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", q], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const migration = (suffix) => {
  const file = readdirSync("supabase/migrations").find((x) => x.endsWith(suffix));
  assert.ok(file, `migration *${suffix} exists`);
  return readFileSync("supabase/migrations/" + file, "utf8");
};

const C = "customers/4454506598";
const approvedAd = `${C}/adGroupAds/200351113415~824125294528`;
const retiredAd = `${C}/adGroupAds/200351113415~824125294531`;
const stillDisapprovedAd = `${C}/adGroupAds/200351114295~824125294708`;
const missingAd = `${C}/adGroupAds/200351114295~824125294711`;
const key = (resource) => `ads-engine:disapproved:${resource}`;

execFileSync(bin + "createdb", [...args, db]);
try {
  sql(
    "DO $$ BEGIN IF NOT EXISTS(select from pg_roles where rolname='anon') THEN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; END IF; END $$;" +
      "CREATE TABLE public.notifications(id uuid default gen_random_uuid(),user_id text,company_id text,type text,title text,body text,is_read boolean,persistent boolean,action_url text,action_label text,dedupe_key text,resolved_at timestamptz,created_at timestamptz not null default now());" +
      "CREATE UNIQUE INDEX idx_notifications_unread_dedup ON public.notifications (user_id, company_id, type, coalesce(dedupe_key, title)) WHERE is_read = false AND resolved_at IS NULL;" +
      "CREATE UNIQUE INDEX notifications_open_dedupe_key ON public.notifications (user_id, company_id, type, dedupe_key) WHERE is_read = false AND resolved_at IS NULL AND dedupe_key IS NOT NULL;" +
      // The phase 1 entity snapshot, reduced to the columns the backfill reads.
      "CREATE TABLE public.ads_entities(resource_name text primary key, entity_type text, parent_resource_name text, name text, status text, payload jsonb, labels text[], snapshot_at timestamptz);"
  );
  sql(migration("_ads_engine.sql"));

  // --- the 2026-09-10 incident, as production holds it ---------------------
  const entity = (resource, status, approval) =>
    `insert into ads_entities(resource_name,entity_type,status,payload) values('${resource}','ad','${status}','{"adGroupAd":{"resourceName":"${resource}","status":"${status}","policySummary":{"approvalStatus":"${approval}","reviewStatus":"REVIEWED"}}}'::jsonb)`;
  sql(entity(approvedAd, "ENABLED", "APPROVED"));
  sql(entity(retiredAd, "PAUSED", "APPROVED"));
  sql(entity(stillDisapprovedAd, "PAUSED", "DISAPPROVED"));
  for (const resource of [approvedAd, retiredAd, stillDisapprovedAd, missingAd])
    sql(
      `insert into ads_engine_alerts(kind,dedupe_key,title,body,persistent) values('ad_disapproved','${key(resource)}','AD DISAPPROVED','Google disapproved an ad in Jobber pricing. OPS paused it; the next run writes a replacement.',true)`
    );
  sql("insert into ads_engine_alerts(kind,dedupe_key,title,body,persistent) values('budget_pacing','ads-engine:pacing:23:2026-09-10','ADS BUDGET PACING','capped',false)");
  // Delivered to the rail, except the approved-and-retired pair's second
  // alert, which never left the outbox (the 12 with notified_at null).
  assert.equal(sql("select notify_ads_engine('operator','company')"), "5");
  sql(`update ads_engine_alerts set notified_at=null where dedupe_key='${key(retiredAd)}'`);
  sql(`delete from notifications where dedupe_key='${key(retiredAd)}'`);

  sql(migration("_ads_guardrail_pauses.sql"));

  // --- backfill: only alerts whose ad Google has approved since -----------
  assert.equal(
    sql("select string_agg(dedupe_key,',' order by dedupe_key) from ads_engine_alerts where resolved_at is not null"),
    [key(approvedAd), key(retiredAd)].sort().join(","),
    "the backfill resolves the alerts whose ad is approved now, and nothing else"
  );
  assert.equal(
    sql(`select is_read::text||'|'||(resolved_at is not null)::text from notifications where dedupe_key='${key(approvedAd)}'`),
    "true|true",
    "the operator's rail row is resolved with its alert"
  );
  assert.equal(
    sql(`select is_read::text||'|'||(resolved_at is not null)::text from notifications where dedupe_key='${key(stillDisapprovedAd)}'`),
    "false|false",
    "an alert whose ad is still disapproved stays on the rail"
  );
  assert.equal(sql(`select count(*) from notifications where dedupe_key='${key(missingAd)}' and resolved_at is null`), "1", "an alert whose ad the snapshot cannot vouch for is left alone");
  assert.equal(sql("select count(*) from ads_engine_alerts where kind='budget_pacing' and resolved_at is null"), "1");
  assert.equal(
    sql("select notify_ads_engine('operator','company')"),
    "0",
    "a resolved alert that never reached the rail never will"
  );

  // --- alert resolution ----------------------------------------------------
  sql("insert into ads_engine_alerts(kind,dedupe_key,title,body,persistent) values('ad_disapproved','ads-engine:disapproved:5d2c7a1e-3b4f-4c6d-8e9f-0a1b2c3d4e5f','AD DISAPPROVED','x',true)");
  assert.equal(sql("select notify_ads_engine('operator','company')"), "1");
  assert.equal(
    sql("select resolve_ads_engine_alerts(array['ads-engine:disapproved:5d2c7a1e-3b4f-4c6d-8e9f-0a1b2c3d4e5f','ads-engine:pause-failed:5d2c7a1e-3b4f-4c6d-8e9f-0a1b2c3d4e5f'])"),
    "1",
    "resolving counts the open alerts it closed; keys never raised are ignored"
  );
  assert.equal(
    sql("select count(*) from notifications where dedupe_key='ads-engine:disapproved:5d2c7a1e-3b4f-4c6d-8e9f-0a1b2c3d4e5f' and is_read and resolved_at is not null"),
    "1"
  );
  assert.equal(sql("select resolve_ads_engine_alerts(array['ads-engine:disapproved:5d2c7a1e-3b4f-4c6d-8e9f-0a1b2c3d4e5f'])"), "0", "resolution is idempotent");
  assert.equal(sql("select resolve_ads_engine_alerts(null)"), "0");
  assert.equal(sql("select resolve_ads_engine_alerts('{}'::text[])"), "0");

  // --- alert kinds ---------------------------------------------------------
  sql("insert into ads_engine_alerts(kind,dedupe_key,title,body,persistent) values('ad_restored','ads-engine:restored:a1b2c3d4','AD BACK ON','Google approved the ad OPS paused in Pricing. OPS switched it back on.',false)");
  assert.throws(
    () => sql("insert into ads_engine_alerts(kind,dedupe_key,title,body) values('ad_whatever','ads-engine:x:yyyyyyyy','T','B')"),
    /ads_engine_alerts_kind_check/,
    "an unknown alert kind is refused"
  );

  // --- episodes ------------------------------------------------------------
  const open = (resource, extra = "") =>
    sql(
      `insert into ads_guardrail_pauses(ad_resource_name,ad_id,ad_group_resource_name,ad_group_name,campaign_resource_name,policy_topics,policy_entries${extra ? "," + extra.split("|")[0] : ""}) values('${resource}','${resource.split("~").pop()}','${C}/adGroups/200351113415','Jobber pricing','${C}/campaigns/1',array['DESTINATION_NOT_WORKING'],'[{"topic":"DESTINATION_NOT_WORKING","type":"PROHIBITED"}]'::jsonb${extra ? "," + extra.split("|")[1] : ""}) returning id`
    );
  const first = open(approvedAd);
  assert.equal(
    sql(`select state||'|'||array_to_string(policy_topics,',')||'|'||(observed_at is not null)::text||'|'||(closed_at is null)::text from ads_guardrail_pauses where id='${first}'`),
    "holding|DESTINATION_NOT_WORKING|true|true",
    "an episode opens holding, with Google's reason on it"
  );
  assert.throws(() => open(approvedAd), /ads_guardrail_pauses_one_open_per_ad/, "one open episode per ad");
  assert.throws(
    () => sql(`update ads_guardrail_pauses set state='paused' where id='${first}'`),
    /ads_guardrail_pauses_paused_window/,
    "a pause records the window Google committed it in"
  );
  assert.throws(
    () => sql(`update ads_guardrail_pauses set state='paused',pause_requested_at=now(),paused_at=now()-interval '1 second' where id='${first}'`),
    /ads_guardrail_pauses_paused_window/
  );
  sql(`update ads_guardrail_pauses set state='paused',pause_requested_at=now()-interval '1 second',paused_at=now(),pause_request_id='real-req' where id='${first}'`);
  assert.throws(
    () => sql(`update ads_guardrail_pauses set state='restored' where id='${first}'`),
    /ads_guardrail_pauses_open_closed/,
    "a closed episode carries its reason and time"
  );
  assert.throws(
    () => sql(`update ads_guardrail_pauses set state='released',close_reason='restored',closed_at=now() where id='${first}'`),
    /ads_guardrail_pauses_restored_reason/,
    "only a restore closes with the reason restored"
  );
  assert.throws(
    () => sql(`update ads_guardrail_pauses set state='restored',close_reason='unverifiable',closed_at=now() where id='${first}'`),
    /ads_guardrail_pauses_restored_reason/
  );
  assert.throws(
    () => sql(`update ads_guardrail_pauses set state='released',close_reason='because',closed_at=now() where id='${first}'`),
    /close_reason_check/,
    "an unknown reason is refused"
  );
  sql(`update ads_guardrail_pauses set state='restored',close_reason='restored',closed_at=now(),restore_request_id='restore-req' where id='${first}'`);
  const second = open(approvedAd);
  assert.notEqual(second, first, "a closed episode frees the ad for the next one");
  sql(`update ads_guardrail_pauses set state='released',close_reason='cleared_before_pause',closed_at=now() where id='${second}'`);
  assert.throws(
    () =>
      sql(
        `insert into ads_guardrail_pauses(ad_resource_name,ad_id,ad_group_resource_name,campaign_resource_name) values('${C}/campaigns/1','1','${C}/adGroups/1','${C}/campaigns/1')`
      ),
    /ad_resource_name_check/,
    "only an ad resource name is an episode's subject"
  );
  assert.throws(
    () =>
      sql(
        `insert into ads_guardrail_pauses(ad_resource_name,ad_id,ad_group_resource_name,campaign_resource_name) values('${C}/adGroupAds/1~2','2; drop','${C}/adGroups/1','${C}/campaigns/1')`
      ),
    /ad_id_check/,
    "an ad id is Google's numeric id"
  );
  assert.throws(
    () => sql(`update ads_guardrail_pauses set closed_at=null where id='${second}'`),
    /ads_guardrail_pauses_open_closed/
  );

  // --- security boundary ---------------------------------------------------
  assert.equal(sql("select relrowsecurity from pg_class where relname='ads_guardrail_pauses'"), "t");
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
    for (const role of ["anon", "authenticated"])
      assert.equal(sql(`select has_table_privilege('${role}','ads_guardrail_pauses','${privilege}')`), "f", `${role} must not hold ${privilege}`);
  assert.equal(sql("select has_table_privilege('service_role','ads_guardrail_pauses','UPDATE')"), "t");
  for (const fn of ["resolve_ads_engine_alerts(text[])", "notify_ads_engine(text,text)"]) {
    for (const role of ["anon", "authenticated"])
      assert.equal(sql(`select has_function_privilege('${role}','${fn}','EXECUTE')`), "f", `${role} must not execute ${fn}`);
    assert.equal(sql(`select has_function_privilege('service_role','${fn}','EXECUTE')`), "t");
    assert.equal(
      sql(`select (not prosecdef)::text||'|'||array_to_string(proconfig,',') from pg_proc where oid='public.${fn}'::regprocedure`),
      "true|search_path=\"\"",
      `${fn} is security invoker with an empty search_path`
    );
  }

  console.log("PASS ads guardrail pauses runtime contract");
} finally {
  execFileSync(bin + "dropdb", [...args, "--if-exists", db]);
}
