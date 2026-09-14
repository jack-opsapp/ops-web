// Runtime contract for the weekly journal ledger. Applies the exact migration
// to a disposable PostgreSQL 17 database (start the harness cluster with
// LC_ALL=C, see docs/journal/cloud-editorial-operations.md) and proves slot
// timing, claims, leases, source custody, drafting, exactly-once publication,
// every publication guard, the notification outbox, the stall alarm and the
// grants.
import { execFileSync, execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const args = ["-h", "/private/tmp/ops-editorial-pg/socket", "-p", "55439"];
const db = "journal_editorial_test_" + process.pid;
const sql = (q) =>
  execFileSync(bin + "psql", [...args, "-d", db, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", q], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const sqlAs = (role, q) => sql(`set role ${role}; ${q}`);
const fails = (q, pattern, message) =>
  assert.throws(() => sql(q), (error) => pattern.test(String(error.stderr ?? error.message)), message);
const run = promisify(execFile);
const migration = readFileSync(
  "supabase/migrations/" + readdirSync("supabase/migrations").find((x) => x.endsWith("_create_journal_editorial.sql")),
  "utf8"
);

const t1 = "11111111-1111-4111-8111-111111111111";
const t2 = "22222222-2222-4222-8222-222222222222";
const t3 = "33333333-3333-4333-8333-333333333333";
const sha = "a".repeat(64);
const user = "user-1";
const company = "0f6f0a8e-2d3b-4c4d-9e5f-6a7b8c9d0e1f";

const topicId = "44444444-4444-4444-8444-444444444444";
const pkg = (slug) =>
  `jsonb_build_object('article', jsonb_build_object('title','THE WEEKLY TITLE GOES HERE NOW','subtitle','Sub','summary','Sum','teaser','Tease','meta_title','Meta','topic', jsonb_build_object('backlog_topic_id','${topicId}','angle','A'),'faqs', jsonb_build_array(jsonb_build_object('question','Q?','answer','A.')),'email_content','Email body'),'html','<p>Body</p>','word_count',1100,'category_id','${"c".repeat(8)}-cccc-4ccc-8ccc-cccccccccccc','slug','${slug}')`;

function source(url) {
  return `jsonb_build_object('url','${url}','final_url','${url}','http_status',200,'content_type','text/html','bytes',1200,'sha256','${sha}','title','Title','site_name','Site','published_hint','2026-08-01T00:00:00Z','modified_hint',null,'text','Source text with 91% of numbers.','truncated',false)`;
}

// Pacific slot helper: Monday 2026-09-14 06:00 at UTC-7 is 13:00 UTC.
const discoverAt = (iso) => sql(`select discover_journal_editorial_assignment('${iso}'::timestamptz)`);
const row = (identity, cols) => sql(`select ${cols} from journal_editorial_assignments where identity='${identity}'`);
const setRow = (identity, assignments) => sql(`update journal_editorial_assignments set ${assignments} where identity='${identity}'`);
const idOf = (identity) => row(identity, "id");
const claim = (token, worker = "cse_test") =>
  sql(`select coalesce((select identity from claim_journal_editorial_assignment('${token}','${worker}')), 'none')`);

execFileSync(bin + "createdb", [...args, db]);
try {
  sql(
    "DO $$ BEGIN IF NOT EXISTS(select from pg_roles where rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(select from pg_roles where rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(select from pg_roles where rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$;" +
      // Production's blog_posts shape, including its source check and unique slug.
      "CREATE TABLE public.blog_posts(id uuid primary key default gen_random_uuid(),title text not null,subtitle text,slug text not null unique,author text,content text not null default '',summary text,teaser text,meta_title text,thumbnail_url text,category_id uuid,category2_id uuid,is_live boolean not null default false,display_views integer not null default 0,word_count integer not null default 0,faqs jsonb default '[]'::jsonb,published_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),email_content text,linkedin_article text,image_prompt text,source text not null default 'breaking' check (source in ('weekly','breaking')));" +
      "CREATE TABLE public.blog_topics(id uuid primary key default gen_random_uuid(),topic text not null,author text not null default 'The Ops Team',image_url text,used boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());" +
      "CREATE TABLE public.notifications(id uuid default gen_random_uuid(),user_id text,company_id text,type text,title text,body text,is_read boolean,persistent boolean,action_url text,action_label text,dedupe_key text,resolved_at timestamptz,created_at timestamptz not null default now());" +
      // Production's open-notification dedupe indexes, so the outbox is proved
      // against the same uniqueness rules the live table enforces.
      "CREATE UNIQUE INDEX idx_notifications_unread_dedup ON public.notifications (user_id, company_id, type, coalesce(dedupe_key, title)) WHERE is_read = false AND resolved_at IS NULL;" +
      "CREATE UNIQUE INDEX notifications_open_dedupe_key ON public.notifications (user_id, company_id, type, dedupe_key) WHERE is_read = false AND resolved_at IS NULL AND dedupe_key IS NOT NULL;" +
      "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"
  );
  sql(migration);

  // --- settings --------------------------------------------------------------
  assert.equal(
    sql("select mode||'|'||publish_weekday||'|'||publish_hour||'|'||draft_open_hours||'|'||min_veto_minutes||'|'||byline from journal_editorial_settings"),
    "off|1|6|72|360|OPS Team",
    "singleton defaults: off, Monday 06:00, opens 72 h ahead, 6 h minimum veto, OPS Team byline"
  );
  fails("insert into journal_editorial_settings(id) values (false)", /check|violates/, "the settings row is a singleton");

  // --- discovery -------------------------------------------------------------
  assert.equal(
    discoverAt("2026-09-11T14:00:00Z"),
    '{"slot": "2026-09-14", "missed": 0, "created": 0}',
    "an off pipeline creates nothing"
  );
  sql("update journal_editorial_settings set mode='prepare'");
  assert.equal(
    discoverAt("2026-09-11T12:59:00Z"),
    '{"slot": "2026-09-14", "missed": 0, "created": 0}',
    "Friday 05:59 Vancouver is before the 72-hour opening"
  );
  assert.equal(
    discoverAt("2026-09-11T13:00:00Z"),
    '{"slot": "2026-09-14", "missed": 0, "created": 1}',
    "Friday 06:00 Vancouver opens Monday's slot"
  );
  assert.equal(
    row("weekly:2026-09-14", "slot_at at time zone 'UTC'"),
    "2026-09-14 13:00:00",
    "the slot is Monday 06:00 at UTC-7"
  );
  assert.equal(
    discoverAt("2026-09-12T20:00:00Z"),
    '{"slot": "2026-09-14", "missed": 0, "created": 0}',
    "repeat discovery never duplicates a slot"
  );
  assert.equal(
    JSON.parse(discoverAt("2026-09-14T13:30:00Z")).slot,
    "2026-09-21",
    "after Monday 06:00 the next slot is the following Monday"
  );
  assert.equal(sql("select count(*) from journal_editorial_assignments"), "1", "a slot is never created after its own launch time");

  // --- claims and leases ----------------------------------------------------
  const w1 = "weekly:2026-09-14";
  sql("update journal_editorial_settings set mode='off'");
  assert.equal(claim(t1), "none", "off mode never hands out work");
  assert.ok(sql("select authoring_heartbeat_at is not null from journal_editorial_settings") === "t", "every claim call is a heartbeat, even when off");
  sql("update journal_editorial_settings set mode='prepare'");
  assert.equal(sql(`select count(*) from claim_journal_editorial_assignment('${t1}','   ')`), "0", "a blank worker cannot claim");
  // The slot must still be claimable in real time: move it into the future.
  setRow(w1, "slot_at = now() + interval '40 hours'");

  const [first, second] = await Promise.all(
    [t1, t2].map((token) =>
      run(bin + "psql", [...args, "-d", db, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", `select coalesce((select identity from claim_journal_editorial_assignment('${token}','race')),'none')`], {
        encoding: "utf8",
      }).then((result) => result.stdout.trim())
    )
  );
  assert.deepEqual([first, second].sort(), ["none", w1], "two concurrent runs never both win the slot");
  const winner = first === w1 ? t1 : t2;
  assert.equal(row(w1, "state||'|'||attempts||'|'||mode"), "authoring|1|prepare", "the claim stamps the account mode and spends an attempt");

  // Lease expiry returns the slot with the attempt spent.
  setRow(w1, "lease_until = now() - interval '1 second'");
  assert.equal(sql("select recover_journal_editorial_assignments()"), "1");
  assert.equal(row(w1, "state||'|'||attempts||'|'||last_code"), "queued|1|LEASE_EXPIRED");
  assert.equal(claim(t1), w1);
  setRow(w1, "lease_until = now() - interval '1 second'");
  assert.equal(claim(t2), w1, "recovery inside claim hands the slot straight back");
  assert.equal(row(w1, "attempts"), "3", "the race winner, then two recoveries: three attempts spent");
  setRow(w1, "lease_until = now() - interval '1 second'");
  assert.equal(claim(t3), "none", "a fourth attempt is never made");
  assert.equal(row(w1, "state||'|'||last_code"), "blocked|ATTEMPTS_EXHAUSTED", "the third lost lease blocks the slot");

  // Fresh slot for the rest of the contract.
  setRow(w1, "state='queued', attempts=0, last_code=null, blocked_at=null, next_attempt_at=null");
  const id1 = idOf(w1);
  assert.equal(claim(t1), w1);

  // --- source custody -------------------------------------------------------
  const stored = JSON.parse(sql(`select store_journal_editorial_source('${id1}','${t1}',${source("https://example.gov/a")})`));
  assert.equal(stored.existing, false);
  assert.equal(
    JSON.parse(sql(`select store_journal_editorial_source('${id1}','${t1}',${source("https://example.gov/a")})`)).id,
    stored.id,
    "the same URL is kept once per assignment"
  );
  assert.equal(
    JSON.parse(sql(`select store_journal_editorial_source('${id1}','${t2}',${source("https://example.gov/b")})`)).code,
    "CLAIM_NOT_OWNED",
    "only the live claim can make OPS keep a source"
  );
  sql("update journal_editorial_settings set max_sources=4");
  for (const suffix of ["b", "c", "d"]) sql(`select store_journal_editorial_source('${id1}','${t1}',${source("https://example.gov/" + suffix)})`);
  assert.equal(
    JSON.parse(sql(`select store_journal_editorial_source('${id1}','${t1}',${source("https://example.gov/e")})`)).code,
    "SOURCE_LIMIT",
    "one claim cannot make OPS fetch without limit"
  );
  sql("update journal_editorial_settings set max_sources=24");
  fails(
    `insert into journal_editorial_sources(assignment_id,claim_token,url,final_url,http_status,content_type,bytes,sha256,text) values('${id1}','${t1}','http://plain.example','https://x','200','text/html',1,'${sha}','x')`,
    /check/,
    "only HTTPS sources are stored"
  );

  // --- attempts log ----------------------------------------------------------
  assert.equal(sql(`select record_journal_editorial_attempt('${id1}','${t1}','{"event":"submission"}')`), "t");
  assert.equal(row(w1, "submissions"), "1");
  assert.equal(sql(`select record_journal_editorial_attempt('${id1}','${t2}','{"event":"submission"}')`), "f", "a foreign token writes nothing");

  // --- drafting --------------------------------------------------------------
  sql("insert into blog_posts(title,slug,source,is_live,published_at) values('Old','taken-slug','breaking',true,now()-interval '30 days')");
  assert.equal(
    sql(`select finish_journal_editorial_assignment('${id1}','${t1}','drafted',null,${pkg("taken-slug")},'taken-slug','T')`),
    "SLUG_TAKEN",
    "a slug already in blog_posts is refused"
  );
  assert.equal(
    sql(`select finish_journal_editorial_assignment('${id1}','${t2}','drafted',null,${pkg("fresh-slug")},'fresh-slug','T')`),
    "",
    "only the claim owner can hand back a draft"
  );
  assert.equal(
    sql(`select finish_journal_editorial_assignment('${id1}','${t1}','drafted',null,${pkg("fresh-slug")},'fresh-slug','THE TITLE')`),
    "drafted"
  );
  assert.equal(
    sql(`select finish_journal_editorial_assignment('${id1}','${t1}','drafted',null,${pkg("fresh-slug")},'fresh-slug','THE TITLE')`),
    "drafted",
    "a retried call from the same run reads back the accepted draft"
  );
  assert.equal(row(w1, "state||'|'||slug||'|'||(lease_until is null)"), "drafted|fresh-slug|true");
  fails(
    `insert into journal_editorial_assignments(identity,slot_date,slot_at,state,slug,package) values('weekly:2026-09-28','2026-09-28',now(),'drafted','fresh-slug','{}'::jsonb)`,
    /unique|duplicate/,
    "a reserved slug cannot be taken by another week"
  );

  // --- scheduling ------------------------------------------------------------
  fails(`select schedule_journal_editorial_assignment('${id1}',null,now())`, /requires/, "a schedule without a preview is refused");
  assert.equal(
    sql(`select schedule_journal_editorial_assignment('${id1}','{"url":"https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/journal/x.jpg"}'::jsonb, now()+interval '1 hour')`),
    "scheduled"
  );
  assert.equal(sql(`select coalesce(schedule_journal_editorial_assignment('${id1}','{}'::jsonb, now()),'none')`), "none", "only a drafted row can be scheduled");

  // --- publication guards ----------------------------------------------------
  const publish = (id, manual = false) => JSON.parse(sql(`select publish_journal_editorial_assignment('${id}',${manual},'op')`));
  assert.equal(publish(id1).code, "HELD", "prepare mode never publishes on its own");
  sql("update journal_editorial_settings set mode='publish'");
  assert.equal(publish(id1).code, "HELD", "a draft written under prepare stays held after the account flips to publish");
  setRow(w1, "mode='publish'");
  assert.equal(publish(id1).code, "NOT_DUE", "nothing publishes before its launch time");
  setRow(w1, "publish_at = now() - interval '1 minute'");

  // Another weekly post went live this week (a still-running Cowork task).
  sql("insert into blog_posts(title,slug,source,is_live,published_at) values('Cowork','cowork-weekly','weekly',true,now()-interval '2 days')");
  assert.equal(publish(id1).code, "WEEKLY_ALREADY_LIVE", "the week is never doubled automatically");
  assert.equal(row(w1, "state||'|'||last_code"), "blocked|WEEKLY_ALREADY_LIVE");
  assert.equal(sql("select count(*) from blog_posts where slug='fresh-slug'"), "0");

  sql(`insert into blog_topics(id,topic) values('${topicId}','Response time')`);
  assert.equal(sql(`select used from blog_topics where id='${topicId}'`), "f", "a held or blocked draft leaves its backlog topic unused");

  // A person may override that one guard; the result is exactly one row.
  const manualResults = await Promise.all(
    [0, 1, 2].map(() =>
      run(bin + "psql", [...args, "-d", db, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", `select publish_journal_editorial_assignment('${id1}',true,'op')`], {
        encoding: "utf8",
      }).then((result) => JSON.parse(result.stdout.trim()))
    )
  );
  assert.equal(manualResults.filter((r) => r.state === "published" && !r.replay).length, 1, "concurrent publishers produce exactly one publication");
  assert.equal(manualResults.filter((r) => r.replay).length, 2, "the others read back the same publication");
  assert.equal(
    sql("select title||'|'||author||'|'||source||'|'||is_live||'|'||(published_at is not null)||'|'||word_count||'|'||thumbnail_url||'|'||jsonb_array_length(faqs)||'|'||email_content from blog_posts where slug='fresh-slug'"),
    "THE WEEKLY TITLE GOES HERE NOW|OPS Team|weekly|true|true|1100|https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/journal/x.jpg|1|Email body",
    "the live row carries the package, the hero, the byline and the weekly source"
  );
  assert.equal(row(w1, "state||'|'||(blog_id is not null)"), "published|true");
  assert.equal(sql(`select used from blog_topics where id='${topicId}'`), "t", "publication spends the backlog topic");
  assert.equal(sql(`select coalesce(cancel_journal_editorial_assignment('${id1}','op'),'none')`), "none", "a published post cannot be stopped");

  // Slug and freshness guards cannot be overridden.
  const w2 = "weekly:2026-09-21";
  sql(`insert into journal_editorial_assignments(identity,slot_date,slot_at,state,mode,slug,package,preview,publish_at,drafted_at) values('${w2}','2026-09-21',now()+interval '1 day','scheduled','publish','second-slug',${pkg("second-slug")},'{"url":"https://h/x.jpg"}',now()-interval '1 minute',now()-interval '9 days')`);
  assert.equal(publish(idOf(w2), true).code, "STALE_DRAFT", "an 8-day-old draft never publishes, even by hand");
  const w3 = "weekly:2026-09-28";
  sql(`insert into journal_editorial_assignments(identity,slot_date,slot_at,state,mode,slug,package,preview,publish_at,drafted_at) values('${w3}','2026-09-28',now()+interval '1 day','scheduled','publish','taken-slug-2',${pkg("taken-slug-2")},'{"url":"https://h/x.jpg"}',now()-interval '1 minute',now())`);
  sql("insert into blog_posts(title,slug) values('Radar','taken-slug-2')");
  assert.equal(publish(idOf(w3), true).code, "SLUG_TAKEN", "a slug taken after drafting blocks publication");

  // --- stop and write another -----------------------------------------------
  const w4 = "weekly:2026-10-05";
  sql(`insert into journal_editorial_assignments(identity,slot_date,slot_at,state,mode,slug,package,preview,publish_at,drafted_at) values('${w4}','2026-10-05',now()+interval '2 days','scheduled','publish','fourth-slug',${pkg("fourth-slug")},'{"url":"https://h/x.jpg"}',now()+interval '1 day',now())`);
  assert.equal(sql(`select cancel_journal_editorial_assignment('${idOf(w4)}','jackson')`), "cancelled");
  assert.equal(publish(idOf(w4), true).code, "NOT_SCHEDULED", "a stopped post never publishes");
  assert.equal(sql(`select requeue_journal_editorial_assignment('${idOf(w4)}','jackson')`), "queued");
  assert.equal(row(w4, "attempts||'|'||(slug is null)||'|'||(package is null)"), "0|true|true", "write another starts clean");

  // --- notification outbox ---------------------------------------------------
  const deliver = (id, state, title, dedupe, resolve = null, persistent = true) =>
    sql(`select deliver_journal_editorial_notification('${id}','${state}','${user}','${company}',${title ? `'${title}'` : "null"},'Body',${persistent},'/admin/blog?journal=${id}','PREVIEW','${dedupe}',${resolve ? `'${resolve}'` : "null"})`);
  const id5 = idOf(w3); // blocked SLUG_TAKEN
  assert.equal(deliver(id1, "scheduled", "JOURNAL POST READY", `journal:${w1}:ready`), "f", "an item for a state the row has left is never delivered");
  assert.equal(deliver(id1, "published", "JOURNAL POST LIVE", `journal:${w1}:live`, `journal:${w1}:ready`, false), "t");
  assert.equal(deliver(id1, "published", "JOURNAL POST LIVE", `journal:${w1}:live`, `journal:${w1}:ready`, false), "t", "a replay succeeds");
  assert.equal(sql(`select count(*) from notifications where dedupe_key='journal:${w1}:live'`), "1", "and inserts nothing twice");
  assert.equal(row(w1, "notified_state"), "published");
  sql(`insert into notifications(user_id,company_id,type,title,is_read,persistent,dedupe_key) values('${user}','${company}','journal_editorial','JOURNAL POST READY',false,true,'journal:${w3}:ready')`);
  assert.equal(deliver(id5, "blocked", "JOURNAL POST BLOCKED", `journal:${w3}:blocked`, `journal:${w3}:ready`), "t");
  assert.equal(
    sql(`select string_agg(title||':'||(resolved_at is not null), ',' order by title) from notifications where dedupe_key like 'journal:${w3}:%'`),
    "JOURNAL POST BLOCKED:false,JOURNAL POST READY:true",
    "a blocked post resolves its ready item and raises its own"
  );
  assert.equal(
    sql(`select deliver_journal_editorial_notification('${id5}','blocked','','${company}','X','B',true,'/x','Y','k',null)`),
    "f",
    "no recipient, no delivery"
  );

  // --- stall alarm -----------------------------------------------------------
  const check = () =>
    sql(`select check_journal_editorial_authoring('${user}','${company}','JOURNAL WRITER STALLED','Body','/admin/blog','OPEN',12)`);
  // w4 is queued with a slot two days out: not at risk yet.
  assert.equal(check(), "f");
  setRow(w4, "slot_at = now() + interval '6 hours'");
  assert.equal(check(), "t", "a queued slot inside 12 hours raises the alarm");
  assert.equal(check(), "f", "once per Vancouver day");
  assert.equal(sql("select count(*) from notifications where dedupe_key like 'journal:writer-stalled:%' and resolved_at is null"), "1");
  assert.equal(sql(`select resolve_journal_editorial_stall('${user}','${company}',12)`), "0", "the alarm stays while the slot is at risk");
  setRow(w4, "state='cancelled'");
  assert.equal(sql(`select resolve_journal_editorial_stall('${user}','${company}',12)`), "1", "and clears once nothing is at risk");

  // --- missed slots ----------------------------------------------------------
  const w6 = "weekly:2026-10-12";
  sql(`insert into journal_editorial_assignments(identity,slot_date,slot_at) values('${w6}','2026-10-12','2026-10-12T13:00:00Z')`);
  assert.equal(JSON.parse(discoverAt("2026-10-15T13:00:00Z")).missed, 1, "an undrafted slot 72 hours past its launch stops");
  assert.equal(row(w6, "state||'|'||last_code"), "blocked|SLOT_MISSED");

  // --- newsletter: at most once ---------------------------------------------
  assert.equal(sql(`select claim_journal_editorial_newsletter('${id1}','${t1}')`), "t");
  assert.equal(sql(`select claim_journal_editorial_newsletter('${id1}','${t2}')`), "f", "a second claim never mails again");
  assert.equal(sql(`select finish_journal_editorial_newsletter('${id1}','${t2}','sent')`), "f");
  assert.equal(sql(`select finish_journal_editorial_newsletter('${id1}','${t1}','sent')`), "t");
  assert.equal(sql(`select claim_journal_editorial_newsletter('${id5}','${t1}')`), "f", "only a published post can be mailed");

  // --- grants -----------------------------------------------------------------
  for (const role of ["anon", "authenticated"]) {
    fails(`set role ${role}; select count(*) from journal_editorial_assignments`, /permission denied/, `${role} cannot read the ledger`);
    fails(`set role ${role}; select count(*) from journal_editorial_sources`, /permission denied/, `${role} cannot read sources`);
    fails(`set role ${role}; select publish_journal_editorial_assignment('${id1}',true,'x')`, /permission denied/, `${role} cannot publish`);
    fails(`set role ${role}; select claim_journal_editorial_assignment('${t1}','x')`, /permission denied/, `${role} cannot claim`);
  }
  assert.equal(sqlAs("service_role", "select count(*) from journal_editorial_assignments") !== "", true, "service role reads the ledger");
  assert.equal(
    sql("select bool_and(relrowsecurity) from pg_class where relname in ('journal_editorial_settings','journal_editorial_assignments','journal_editorial_sources')"),
    "t",
    "row level security is on for all three tables"
  );
  assert.equal(
    sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%journal_editorial%' and p.prosecdef"),
    "0",
    "every function runs as its caller"
  );

  console.log("PASS journal-editorial-runtime");
} finally {
  execFileSync(bin + "dropdb", [...args, "--if-exists", db]);
}
