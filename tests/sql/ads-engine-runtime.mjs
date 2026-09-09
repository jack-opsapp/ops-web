// Runtime contract for the Google Ads engine ledger (phase 3).
// Applies the engine migration on a disposable PostgreSQL 17 database with the
// production notification dedupe indexes stubbed in, then proves the claim
// lease, the proposal lifecycle, the outbox, the stall alarm and the grants
// exactly as they will exist in production.
//
// Start the harness once per machine:
//   LC_ALL=C /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/ops-editorial-pg/data \
//     -o "-p 55439 -k /private/tmp/ops-editorial-pg/socket -c listen_addresses=''" start
import { execFileSync, execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const args = ["-h", "/private/tmp/ops-editorial-pg/socket", "-p", "55439"];
const db = "ads_engine_test_" + process.pid;
const sql = (q) =>
  execFileSync(
    bin + "psql",
    [...args, "-d", db, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", q],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  ).trim();
const migration = (suffix) =>
  readFileSync(
    "supabase/migrations/" +
      readdirSync("supabase/migrations").find((x) => x.endsWith(suffix)),
    "utf8"
  );

const t1 = "11111111-1111-4111-8111-111111111111";
const t2 = "22222222-2222-4222-8222-222222222222";
const t3 = "33333333-3333-4333-8333-333333333333";
const localExpression = "(now() at time zone 'Etc/GMT+7')::date";

execFileSync(bin + "createdb", [...args, db]);
try {
  sql(
    "DO $$ BEGIN IF NOT EXISTS(select from pg_roles where rolname='anon') THEN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; END IF; END $$;" +
      "CREATE TABLE public.notifications(id uuid default gen_random_uuid(),user_id text,company_id text,type text,title text,body text,is_read boolean,persistent boolean,action_url text,action_label text,dedupe_key text,resolved_at timestamptz,created_at timestamptz not null default now());" +
      "CREATE UNIQUE INDEX idx_notifications_unread_dedup ON public.notifications (user_id, company_id, type, coalesce(dedupe_key, title)) WHERE is_read = false AND resolved_at IS NULL;" +
      "CREATE UNIQUE INDEX notifications_open_dedupe_key ON public.notifications (user_id, company_id, type, dedupe_key) WHERE is_read = false AND resolved_at IS NULL AND dedupe_key IS NOT NULL;"
  );
  sql(migration("_ads_engine.sql"));
  const today = sql(`select ${localExpression}`);

  // --- settings ------------------------------------------------------------
  assert.equal(
    sql(
      "select monthly_cap||'/'||daily_cap||'/'||max_budget_change_pct||'/'||budget_cooldown_days||'/'||max_structural_per_run||'/'||lease_minutes||'/'||stall_hours||'/'||target_cost_per_trial from ads_engine_settings"
    ),
    "1500.00/60.00/15/14/3/40/50/150.00",
    "the guardrail defaults are the spec's defaults"
  );
  assert.equal(
    sql(
      "select count(*) from jsonb_each_text((select modes from ads_engine_settings)) where value='propose'"
    ),
    "11",
    "every proposal kind starts in propose mode"
  );
  assert.throws(
    () =>
      sql(
        `update ads_engine_settings set modes=modes||'{"adjust_budget":"yolo"}'::jsonb`
      ),
    /ads_engine_settings_modes_check/,
    "an unknown mode is refused"
  );
  assert.throws(
    () =>
      sql(`update ads_engine_settings set modes='{"add_negatives":"auto"}'::jsonb`),
    /ads_engine_settings_modes_check/,
    "a modes map missing a kind is refused"
  );
  assert.throws(
    () => sql("insert into ads_engine_settings(id) values(false)"),
    /check/i,
    "the settings row is a singleton"
  );

  // --- claim lease ---------------------------------------------------------
  sql("update ads_engine_settings set heartbeat_at=null");
  sql(
    `update ads_engine_settings set modes=(select jsonb_object_agg(key,'off') from jsonb_each_text(modes))`
  );
  assert.equal(
    sql(`select count(*) from claim_ads_engine_run('${t1}','w1')`),
    "0",
    "an engine whose every kind is off hands out no run"
  );
  assert.equal(
    sql("select heartbeat_at is not null from ads_engine_settings"),
    "t",
    "an off-mode poll still proves the routine is alive"
  );
  sql(
    `update ads_engine_settings set modes=(select jsonb_object_agg(key,'propose') from jsonb_each_text(modes))`
  );
  assert.equal(
    sql(`select count(*) from claim_ads_engine_run('${t1}','w1')`),
    "1",
    "a live engine hands out a run"
  );
  const runA = sql("select id from ads_engine_runs");
  assert.equal(
    sql(
      `select state||'/'||worker||'/'||(claim_token='${t1}')::text||'/'||(lease_until>now()+interval '39 minutes')::text||'/'||(lease_until<=now()+interval '41 minutes')::text from ads_engine_runs where id='${runA}'`
    ),
    "claimed/w1/true/true/true",
    "a claim stamps the worker, the token and a lease of lease_minutes"
  );
  assert.equal(
    sql(`select count(*) from claim_ads_engine_run('${t2}','w2')`),
    "0",
    "a second routine cannot claim while a run is live"
  );
  assert.equal(
    sql(`select count(*) from ads_engine_runs`),
    "1",
    "a refused claim inserts nothing"
  );
  assert.equal(
    sql(`select checkpoint_ads_engine_run('${runA}','${t2}','{hygiene}','v1')`),
    "f",
    "a stale owner cannot checkpoint duties"
  );
  assert.equal(
    sql(
      `select checkpoint_ads_engine_run('${runA}','${t1}','{hygiene,creative}','ads-brief-2026-09-10-v1')`
    ),
    "t"
  );
  assert.equal(
    sql(
      `select array_to_string(duties,',')||'/'||brief_version from ads_engine_runs where id='${runA}'`
    ),
    "hygiene,creative/ads-brief-2026-09-10-v1"
  );

  // --- submissions and proposals -------------------------------------------
  assert.equal(
    sql(
      `select record_ads_engine_submission('${runA}','${t2}',0,'{"event":"submission"}')`
    ),
    "",
    "a stale owner cannot spend a submission"
  );
  assert.equal(
    sql(
      `select record_ads_engine_submission('${runA}','${t1}',0,'{"event":"submission"}')`
    ),
    "1"
  );
  assert.equal(
    sql(
      `select record_ads_engine_submission('${runA}','${t1}',0,'{"event":"submission"}')`
    ),
    "2"
  );
  assert.equal(
    sql(
      `select record_ads_engine_submission('${runA}','${t1}',7,'{"event":"submission"}')`
    ),
    "1",
    "submission budgets are per proposal index"
  );
  assert.equal(
    sql(
      `select (submission_counts->>'0')||'/'||(submission_counts->>'7')||'/'||jsonb_array_length(submission_log) from ads_engine_runs where id='${runA}'`
    ),
    "2/1/3"
  );
  for (let i = 0; i < 80; i++)
    sql(
      `select record_ads_engine_submission('${runA}','${t1}',9,'{"event":"submission","code":"SCHEMA_INVALID"}')`
    );
  assert.equal(
    sql(`select jsonb_array_length(submission_log) from ads_engine_runs where id='${runA}'`),
    "60",
    "the submission log is bounded"
  );
  assert.throws(
    () =>
      sql(
        `select record_ads_engine_submission('${runA}','${t1}',1,jsonb_build_object('event',repeat('x',120000)))`
      ),
    /Submission detail too large/
  );

  assert.equal(
    sql(
      `select accept_ads_proposal('${runA}','${t2}','add_negatives','negatives:NEG · Job seekers',0,'{"terms":["jobs"]}','[]','Job seekers','propose')`
    ),
    "",
    "a stale owner cannot file a proposal"
  );
  const proposalA = sql(
    `select accept_ads_proposal('${runA}','${t1}','add_negatives','negatives:NEG · Job seekers',0,'{"terms":["jobs"]}','[{"term":"jobs","clicks":4}]','Job seekers','propose')`
  );
  assert.match(proposalA, /^[0-9a-f-]{36}$/);
  assert.equal(
    sql(
      `select state||'/'||mode_at_submit||'/'||kind||'/'||target||'/'||submission_index||'/'||(expires_at>now()+interval '13 days')::text||'/'||(expires_at<=now()+interval '14 days')::text from ads_proposals where id='${proposalA}'`
    ),
    "proposed/propose/add_negatives/negatives:NEG · Job seekers/0/true/true",
    "an accepted proposal is held as proposed with the mode it was filed under and a 14-day expiry"
  );
  assert.throws(
    () =>
      sql(
        `select accept_ads_proposal('${runA}','${t1}','create_campaign','campaign:x',1,'{}','[]','r','propose')`
      ),
    /ads_proposals_kind_check/,
    "an unknown proposal kind is refused by the ledger itself"
  );
  const proposalB = sql(
    `select accept_ads_proposal('${runA}','${t1}','pause_keyword','keyword:customers/1/adGroupCriteria/2~3',1,'{"criterion":"customers/1/adGroupCriteria/2~3"}','[]','No trials','auto')`
  );
  assert.equal(
    sql(`select proposals_accepted from ads_engine_runs where id='${runA}'`),
    "2"
  );

  // --- release -------------------------------------------------------------
  assert.equal(
    sql(`select release_ads_engine_run('${runA}','${t2}','summary','done')`),
    "",
    "a stale owner cannot release"
  );
  assert.throws(
    () => sql(`select release_ads_engine_run('${runA}','${t1}','summary','published')`),
    /Invalid run outcome/
  );
  assert.equal(
    sql(`select release_ads_engine_run('${runA}','${t1}','2 proposals filed','done')`),
    "released"
  );
  assert.equal(
    sql(
      `select state||'/'||outcome||'/'||summary||'/'||(released_at is not null)::text from ads_engine_runs where id='${runA}'`
    ),
    "released/done/2 proposals filed/true"
  );
  assert.equal(
    sql(`select release_ads_engine_run('${runA}','${t1}','again','done')`),
    "",
    "a released run cannot be released twice"
  );
  assert.equal(
    sql(`select count(*) from claim_ads_engine_run('${t2}','w2')`),
    "1",
    "after a release the next routine can claim"
  );
  const runB = sql("select id from ads_engine_runs where state='claimed'");

  // --- lease expiry --------------------------------------------------------
  sql(`update ads_engine_runs set lease_until=now()-interval '1 minute' where id='${runB}'`);
  assert.equal(
    sql(`select count(*) from claim_ads_engine_run('${t3}','w3')`),
    "1",
    "an expired lease no longer blocks the next claim"
  );
  assert.equal(
    sql(`select state||'/'||outcome from ads_engine_runs where id='${runB}'`),
    "expired/lease_expired",
    "the abandoned run is recorded as expired"
  );
  const runC = sql("select id from ads_engine_runs where state='claimed'");
  assert.equal(
    sql(`select release_ads_engine_run('${runB}','${t2}','late','done')`),
    "",
    "an expired run cannot be released by its old owner"
  );

  // --- concurrency ---------------------------------------------------------
  sql(`select release_ads_engine_run('${runC}','${t3}','','nothing_to_do')`);
  const concurrent = await Promise.all(
    ["44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"].map(
      (token) =>
        promisify(execFile)(bin + "psql", [
          ...args,
          "-d",
          db,
          "-XAtq",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `select count(*) from claim_ads_engine_run('${token}','worker')`,
        ])
    )
  );
  assert.deepEqual(
    concurrent.map((r) => r.stdout.trim()).sort(),
    ["0", "1"],
    "two routines racing for the engine produce exactly one live run"
  );
  const live = sql("select id||'/'||claim_token from ads_engine_runs where state='claimed'");
  const [runD, tokenD] = live.split("/");
  sql(`select release_ads_engine_run('${runD}','${tokenD}','','nothing_to_do')`);

  // --- review and application ----------------------------------------------
  assert.throws(
    () => sql(`select review_ads_proposal('${proposalA}','maybe','jackson',null)`),
    /Invalid review decision/
  );
  assert.equal(
    sql(`select review_ads_proposal('${proposalA}','approve','jackson',null)`),
    "approved"
  );
  assert.equal(
    sql(
      `select state||'/'||reviewed_by||'/'||(reviewed_at is not null)::text from ads_proposals where id='${proposalA}'`
    ),
    "approved/jackson/true"
  );
  assert.equal(
    sql(`select review_ads_proposal('${proposalA}','reject','jackson','changed my mind')`),
    "",
    "a proposal can only be reviewed once"
  );
  assert.equal(
    sql(`select review_ads_proposal('${proposalB}','reject','jackson','Keep it running a week longer.')`),
    "rejected"
  );
  assert.equal(
    sql(`select review_notes from ads_proposals where id='${proposalB}'`),
    "Keep it running a week longer."
  );
  assert.equal(
    sql(
      `select mark_ads_proposal_applied('${proposalB}','applied','{"ok":true}','{customers/1/x}','gen-abc',null)`
    ),
    "",
    "a rejected proposal can never be marked applied"
  );
  assert.throws(
    () =>
      sql(
        `select mark_ads_proposal_applied('${proposalA}','done','{"ok":true}','{customers/1/x}','gen-abc',null)`
      ),
    /Invalid application state/
  );
  assert.equal(
    sql(
      `select mark_ads_proposal_applied('${proposalA}','applied','{"validateOnly":true,"failures":[]}','{customers/1/sharedCriteria/9~1}','gen-abc',null)`
    ),
    "applied"
  );
  assert.equal(
    sql(
      `select state||'/'||label||'/'||array_to_string(applied_resource_names,',')||'/'||(applied_at is not null)::text||'/'||(google_validation->>'validateOnly') from ads_proposals where id='${proposalA}'`
    ),
    "applied/gen-abc/customers/1/sharedCriteria/9~1/true/true"
  );
  assert.equal(
    sql(
      `select mark_ads_proposal_applied('${proposalA}','failed',null,null,null,'late')`
    ),
    "",
    "an applied proposal cannot be re-marked"
  );

  // --- expiry --------------------------------------------------------------
  sql(`select claim_ads_engine_run('${t1}','w1')`);
  const runE = sql("select id from ads_engine_runs where state='claimed'");
  const stale = sql(
    `select accept_ads_proposal('${runE}','${t1}','observation','observation:1',0,'{"text":"x"}','[]','r','propose')`
  );
  const fresh = sql(
    `select accept_ads_proposal('${runE}','${t1}','observation','observation:2',1,'{"text":"y"}','[]','r','propose')`
  );
  sql(`update ads_proposals set expires_at=now()-interval '1 hour' where id='${stale}'`);
  assert.equal(sql("select expire_ads_proposals()"), "1", "only overdue proposals expire");
  assert.equal(
    sql(`select state from ads_proposals where id='${stale}'`),
    "expired"
  );
  assert.equal(
    sql(`select state from ads_proposals where id='${fresh}'`),
    "proposed"
  );
  assert.equal(sql("select expire_ads_proposals()"), "0", "expiry is idempotent");
  assert.equal(
    sql(`select review_ads_proposal('${stale}','approve','jackson',null)`),
    "",
    "an expired proposal cannot be approved"
  );
  sql(`select release_ads_engine_run('${runE}','${t1}','','done')`);

  // --- notification outbox -------------------------------------------------
  sql("delete from notifications");
  assert.equal(
    sql("select notify_ads_engine('','company')"),
    "0",
    "a missing operator delivers nothing"
  );
  assert.equal(
    sql("select notify_ads_engine('operator','company')"),
    "1",
    "one READY notification per run with proposals waiting"
  );
  assert.equal(
    sql(
      "select title||'|'||persistent::text||'|'||dedupe_key||'|'||action_url||'|'||action_label from notifications"
    ),
    `ADS PROPOSALS READY · 1|false|ads-engine:proposals:${runE}|/admin/google-ads#proposals|VIEW ADS`,
    "the READY title carries the count of proposals still waiting"
  );
  assert.equal(
    sql("select notify_ads_engine('operator','company')"),
    "0",
    "acknowledgement is durable"
  );
  assert.equal(
    sql(`select count(*) from ads_proposals where run_id='${runE}' and notified_at is null and state='proposed'`),
    "0"
  );
  sql(
    "insert into ads_engine_alerts(kind,dedupe_key,title,body,persistent,action_url) values('ad_disapproved','ads-engine:disapproved:customers/1/adGroupAds/2~3','AD DISAPPROVED','Google disapproved an ad. OPS paused it.',true,'/admin/google-ads#engine') on conflict (dedupe_key) do nothing"
  );
  sql(
    "insert into ads_engine_alerts(kind,dedupe_key,title,body,persistent,action_url) values('ad_disapproved','ads-engine:disapproved:customers/1/adGroupAds/2~3','AD DISAPPROVED','dup',true,'/admin/google-ads#engine') on conflict (dedupe_key) do nothing"
  );
  sql(
    "insert into ads_engine_alerts(kind,dedupe_key,title,body,persistent,action_url) values('budget_pacing','ads-engine:pacing:CORE · CA:"+today+"','ADS BUDGET PACING','CORE · CA has been capped by budget three days running.',false,'/admin/google-ads#engine')"
  );
  assert.equal(
    sql("select notify_ads_engine('operator','company')"),
    "2",
    "every undelivered alert reaches the rail once"
  );
  assert.equal(
    sql(
      "select string_agg(title||'|'||persistent::text,';' order by title) from notifications where type='ads_engine' and title<>'ADS PROPOSALS READY · 1'"
    ),
    "AD DISAPPROVED|true;ADS BUDGET PACING|false"
  );
  assert.equal(
    sql("select notify_ads_engine('operator','company')"),
    "0"
  );
  assert.equal(
    sql("select count(*) from ads_engine_alerts where notified_at is null"),
    "0"
  );
  // A re-raised alert while its first rail row is still unread is
  // acknowledged without a duplicate, never a crash on the dedupe index.
  sql("update ads_engine_alerts set notified_at=null where kind='ad_disapproved'");
  assert.equal(sql("select notify_ads_engine('operator','company')"), "1");
  assert.equal(
    sql("select count(*) from notifications where title='AD DISAPPROVED'"),
    "1",
    "no duplicate alert is inserted"
  );

  // --- stall alarm ---------------------------------------------------------
  sql("delete from notifications");
  sql("update ads_engine_settings set heartbeat_at=null, stall_notified_on=null");
  assert.equal(
    sql("select check_ads_engine_stall('operator','company',50,false)"),
    "f",
    "a dark account is never a stall"
  );
  sql("update ads_engine_settings set heartbeat_at=now()-interval '10 hours'");
  assert.equal(
    sql("select check_ads_engine_stall('operator','company',50,true)"),
    "f",
    "a routine that checked in recently is not stalled"
  );
  sql("update ads_engine_settings set heartbeat_at=now()-interval '51 hours'");
  assert.equal(
    sql("select check_ads_engine_stall('operator','company',50,true)"),
    "t"
  );
  assert.equal(
    sql("select check_ads_engine_stall('operator','company',50,true)"),
    "f",
    "the operator is told once a day, not once a tick"
  );
  assert.equal(
    sql("select title||'|'||persistent::text||'|'||dedupe_key from notifications"),
    `ADS ENGINE STALLED|true|ads-engine:stalled:${today}`
  );
  sql("update ads_engine_settings set heartbeat_at=null, stall_notified_on=null");
  sql("delete from notifications");
  assert.equal(
    sql("select check_ads_engine_stall('operator','company',50,true)"),
    "t",
    "a routine that has never checked in while ads are live is a stall"
  );

  // --- security boundary ---------------------------------------------------
  const tables = [
    "ads_engine_settings",
    "ads_engine_runs",
    "ads_proposals",
    "ads_changes",
    "ads_tests",
    "ads_engine_alerts",
  ];
  for (const table of tables) {
    assert.equal(
      sql(`select relrowsecurity from pg_class where relname='${table}'`),
      "t",
      `${table} must have RLS enabled`
    );
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
      for (const role of ["anon", "authenticated"])
        assert.equal(
          sql(`select has_table_privilege('${role}','${table}','${privilege}')`),
          "f",
          `${role} must not hold ${privilege} on ${table}`
        );
    assert.equal(
      sql(`select has_table_privilege('service_role','${table}','SELECT')`),
      "t"
    );
  }
  const functions = [
    "claim_ads_engine_run(uuid,text)",
    "checkpoint_ads_engine_run(uuid,uuid,text[],text)",
    "record_ads_engine_submission(uuid,uuid,integer,jsonb)",
    "accept_ads_proposal(uuid,uuid,text,text,integer,jsonb,jsonb,text,text)",
    "release_ads_engine_run(uuid,uuid,text,text)",
    "expire_ads_proposals()",
    "review_ads_proposal(uuid,text,text,text)",
    "mark_ads_proposal_applied(uuid,text,jsonb,text[],text,text)",
    "notify_ads_engine(text,text)",
    "check_ads_engine_stall(text,text,integer,boolean)",
  ];
  for (const signature of functions) {
    for (const role of ["public", "anon", "authenticated"])
      assert.equal(
        sql(`select has_function_privilege('${role}','${signature}','EXECUTE')`),
        "f",
        `${role} must not execute ${signature}`
      );
    assert.equal(
      sql(`select has_function_privilege('service_role','${signature}','EXECUTE')`),
      "t",
      `service_role must execute ${signature}`
    );
    assert.equal(
      sql(`select prosecdef from pg_proc where oid='${signature}'::regprocedure`),
      "f",
      `${signature} must run as the invoker`
    );
    assert.equal(
      sql(
        `select coalesce(array_to_string(proconfig,','),'') from pg_proc where oid='${signature}'::regprocedure`
      ),
      'search_path=""',
      `${signature} must pin an empty search_path`
    );
  }

  console.log(
    "PASS: settings guardrails, single live run, lease expiry, concurrency, ownership on checkpoint/submission/proposal/release, review and application states, proposal expiry, READY outbox, alert outbox dedupe, stall alarm once per day, RLS and grants"
  );
} finally {
  execFileSync(bin + "dropdb", [...args, db]);
}
