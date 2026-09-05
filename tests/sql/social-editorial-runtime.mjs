import { execFileSync, execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const args = ["-h", "/private/tmp/ops-editorial-pg/socket", "-p", "55439"];
const db = "social_editorial_test_" + process.pid;
const sql = (q) =>
  execFileSync(
    bin + "psql",
    [...args, "-d", db, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", q],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  ).trim();
execFileSync(bin + "createdb", [...args, db]);
try {
  sql(
    "DO $$ BEGIN IF NOT EXISTS(select from pg_roles where rolname='anon') THEN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; END IF; END $$; CREATE TABLE public.social_posts(id uuid primary key,idempotency_key text,status text,updated_by text,source_id text); CREATE TABLE public.blog_posts(id uuid primary key,is_live boolean); CREATE TABLE public.notifications(id uuid default gen_random_uuid(),user_id text,company_id text,type text,title text,body text,is_read boolean,persistent boolean,action_url text,action_label text,dedupe_key text);"
  );
  sql(
    readFileSync(
      "supabase/migrations/" +
        readdirSync("supabase/migrations").find((x) =>
          x.endsWith("_create_social_editorial.sql")
        ),
      "utf8"
    )
  );
  assert.equal(sql("select mode from social_editorial_settings"), "off");
  const token = "11111111-1111-4111-8111-111111111111";
  const date = "(now() at time zone 'Etc/GMT+7')::date";
  const claim = `select count(*) from claim_social_editorial(${date},'blog','${token}')`;
  assert.equal(sql(claim), "0");
  sql("update social_editorial_settings set mode='prepare'");
  assert.equal(sql(claim), "1");
  assert.equal(sql(claim), "0");
  assert.equal(sql("select reserved_usd from social_editorial_runs"), "0.75");
  assert.equal(
    sql(
      `select finish_social_editorial(${date},'22222222-2222-4222-8222-222222222222','prepared',null)`
    ),
    ""
  );
  sql("update social_editorial_runs set lease_until=now()-interval '1 second'");
  assert.equal(sql(claim), "1");
  assert.equal(sql("select attempts from social_editorial_runs"), "2");
  sql(
    "update social_editorial_runs set lease_until=now()-interval '1 second'; update social_editorial_settings set monthly_budget_usd=1"
  );
  assert.equal(sql(claim), "0");
  assert.equal(sql("select state from social_editorial_runs"), "failed");
  assert.equal(
    sql("select has_table_privilege('anon','social_editorial_runs','SELECT')"),
    "f"
  );
  assert.equal(
    sql(
      "select has_function_privilege('authenticated','claim_social_editorial(date,text,uuid)','EXECUTE')"
    ),
    "f"
  );
  assert.equal(
    sql("select prosecdef from pg_proc where proname='claim_social_editorial'"),
    "f"
  );
  sql(
    "insert into social_editorial_runs(slot_date,kind,mode,state) values(current_date-1,'blog','prepare','retry')"
  );
  assert.equal(sql("select recover_social_editorial()"), "1");
  assert.equal(
    sql("select notify_social_editorial('operator','company')"),
    "2"
  );
  assert.equal(
    sql("select notify_social_editorial('operator','company')"),
    "0"
  );
  assert.equal(sql("select count(*) from notifications"), "2");
  sql(
    "delete from social_editorial_runs; update social_editorial_settings set mode='publish',monthly_budget_usd=20"
  );
  const concurrent = await Promise.all(
    [token, "33333333-3333-4333-8333-333333333333"].map((t) =>
      promisify(execFile)(bin + "psql", [
        ...args,
        "-d",
        db,
        "-XAtq",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `select count(*) from claim_social_editorial(${date},'blog','${t}')`,
      ])
    )
  );
  assert.deepEqual(concurrent.map((r) => r.stdout.trim()).sort(), ["0", "1"]);
  const owner = sql("select claim_token from social_editorial_runs");
  const sourceId = "44444444-4444-4444-8444-444444444444";
  sql(`insert into blog_posts values('${sourceId}',true)`);
  assert.equal(
    sql(
      `select checkpoint_social_editorial(${date},'${owner}','{"id":"${sourceId}"}','{"submission":{}}')`
    ),
    "t"
  );
  assert.equal(
    sql(
      `select record_social_editorial_attempt(${date},'${owner}','{"review":{"reason":"stale"}}')`
    ),
    "t"
  );
  assert.equal(
    sql("select jsonb_array_length(attempt_log) from social_editorial_runs"),
    "1"
  );
  sql(
    `insert into social_posts values('${sourceId}','cloud-editorial-v1:'||${date}::text,'rendering','agent:social','${sourceId}')`
  );
  sql("update social_editorial_settings set mode='off'");
  assert.throws(
    () => sql("update social_posts set status='review'"),
    /handoff is disabled/
  );
  sql(
    "update social_editorial_settings set mode='publish'; update blog_posts set is_live=false"
  );
  assert.throws(
    () => sql("update social_posts set status='review'"),
    /handoff is disabled/
  );
  sql("update blog_posts set is_live=true");
  sql("update social_posts set status='review'");
  sql("update social_editorial_runs set attempts=3");
  assert.equal(
    sql(
      `select finish_social_editorial(${date},'${owner}','retry','EDITORIAL_ATTEMPT_FAILED')`
    ),
    "failed"
  );
  sql(
    "delete from social_posts; delete from social_editorial_runs; update social_editorial_settings set mode='prepare'"
  );
  assert.equal(sql(claim), "1");
  sql(
    `select checkpoint_social_editorial(${date},'${token}','{"id":"${sourceId}"}','{"submission":{}}')`
  );
  assert.equal(
    sql(`select finish_social_editorial(${date},'${token}','prepared',null)`),
    "prepared"
  );
  sql("update social_editorial_settings set mode='publish'");
  assert.equal(sql(claim), "0");
  console.log(
    "PASS: concurrent claims, checkpoints, off-during-render, source withdrawal, terminal outcomes, prepare isolation, budget, notifications, stale owner and grants"
  );
} finally {
  execFileSync(bin + "dropdb", [...args, db]);
}
