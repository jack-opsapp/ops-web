// Runtime contract for the weekly journal ledger. Applies the exact migration
// to a disposable PostgreSQL 17 database (start the harness cluster with
// LC_ALL=C, see docs/journal/cloud-editorial-operations.md) and proves slot
// timing, claims, leases, source custody, drafting, exactly-once publication,
// every publication guard, the notification outbox, the stall alarm and the
// grants, the generated-photograph lifecycle, the trend radar and the pitch.
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
const migrationFile = (suffix) =>
  readFileSync("supabase/migrations/" + readdirSync("supabase/migrations").find((x) => x.endsWith(suffix)), "utf8");
const migration = migrationFile("_create_journal_editorial.sql");
const imagesMigration = migrationFile("_journal_generated_images.sql");
const funnelMigration = migrationFile("_journal_topic_funnel.sql");

const t1 = "11111111-1111-4111-8111-111111111111";
const t2 = "22222222-2222-4222-8222-222222222222";
const t3 = "33333333-3333-4333-8333-333333333333";
const sha = "a".repeat(64);
const user = "user-1";
const company = "0f6f0a8e-2d3b-4c4d-9e5f-6a7b8c9d0e1f";

const topicId = "44444444-4444-4444-8444-444444444444";
const pkg = (slug) =>
  `jsonb_build_object('article', jsonb_build_object('title','THE WEEKLY TITLE GOES HERE NOW','subtitle','Sub','summary','Sum','teaser','Tease','meta_title','Meta','topic', jsonb_build_object('backlog_topic_id','${topicId}','angle','A'),'faqs', jsonb_build_array(jsonb_build_object('question','Q?','answer','A.')),'email_content','Email body','image_prompt','A deck builder checks a tape measure against a bid sheet at dawn.'),'html','<p>Body</p>','word_count',1100,'category_id','${"c".repeat(8)}-cccc-4ccc-8ccc-cccccccccccc','slug','${slug}')`;

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
  sql(imagesMigration);
  sql(funnelMigration);

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
  assert.equal(row(w1, "image_generations||'|'||image_failures"), "1|0", "promotion counts the first photograph");

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
  assert.equal(
    sql("select image_prompt from blog_posts where slug='fresh-slug'"),
    "A deck builder checks a tape measure against a bid sheet at dawn.",
    "the live row keeps the art direction behind its photograph"
  );
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

  // --- generated photographs -------------------------------------------------
  const request = (id) => sql(`select request_journal_editorial_image('${id}','admin:jackson')`);
  const replace = (id, url) =>
    sql(`select coalesce(replace_journal_editorial_image('${id}', jsonb_build_object('url','${url}','sha256','${"b".repeat(64)}')),'none')`);
  const failImage = (id) =>
    sql(`select coalesce(fail_journal_editorial_image('${id}','IMAGE_FAILED','${user}','${company}','JOURNAL IMAGE FAILED','Body'),'none')`);
  const newPhoto = "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/weekly/2026-09-14-bbbbbbbbbbbbbbbb.jpg";
  assert.equal(replace(id1, newPhoto), "none", "nothing replaces a photograph nobody asked for");
  assert.equal(request(id1), "requested", "a post live for under eight days can ask for a new photograph");
  assert.equal(request(id1), "requested", "asking twice keeps one open request");
  assert.equal(
    row(w1, "(select count(*) from jsonb_array_elements(attempt_log) e where e->>'event'='image_requested')"),
    "1",
    "and logs it once"
  );
  assert.equal(replace(id1, newPhoto), "published");
  assert.equal(sql("select thumbnail_url from blog_posts where slug='fresh-slug'"), newPhoto, "the live post changes photograph in the same transaction");
  assert.equal(row(w1, "image_generations||'|'||(image_requested_at is null)||'|'||(preview->>'url')"), `2|true|${newPhoto}`);
  fails(`select replace_journal_editorial_image('${id1}','{"url":"http://insecure/x.jpg"}'::jsonb)`, /public image/, "only a public https image can replace one");

  assert.equal(request(id1), "requested");
  assert.equal(failImage(id1), "retry", "a failed generation keeps the request");
  assert.equal(failImage(id1), "retry");
  assert.equal(failImage(id1), "dropped", "the third failure closes it");
  assert.equal(failImage(id1), "none", "a closed request records nothing more");
  assert.equal(row(w1, "(image_requested_at is null)||'|'||image_failures"), "true|3");
  assert.equal(
    sql(`select count(*)||'|'||bool_and(persistent = false) from notifications where dedupe_key like 'journal:${w1}:image-failed:%'`),
    "1|true",
    "the operator hears about it once, and the current photograph stays"
  );
  assert.equal(sql("select thumbnail_url from blog_posts where slug='fresh-slug'"), newPhoto);

  assert.equal(request(idOf(w4)), "NOT_ELIGIBLE", "a stopped slot cannot ask for a photograph");
  setRow(w1, "image_generations = 8");
  assert.equal(request(id1), "IMAGE_LIMIT", "eight photographs per slot is the ceiling");
  setRow(w1, "image_generations = 2, published_at = now() - interval '9 days'");
  assert.equal(request(id1), "NOT_ELIGIBLE", "a post live for more than eight days keeps its photograph");
  setRow(w1, "published_at = now()");
  const w7 = "weekly:2026-10-19";
  sql(`insert into journal_editorial_assignments(identity,slot_date,slot_at,state,mode,slug,package,preview,publish_at,drafted_at) values('${w7}','2026-10-19',now()+interval '3 days','scheduled','prepare','seventh-slug',${pkg("seventh-slug")} #- '{article,image_prompt}','{"url":"https://h/x.jpg"}',now()+interval '3 days',now())`);
  assert.equal(request(idOf(w7)), "NO_IMAGE_PROMPT", "no art direction, no new photograph");
  setRow(w7, `package = ${pkg("seventh-slug")}`);
  assert.equal(request(idOf(w7)), "requested", "a preview can ask for a new photograph");
  assert.equal(replace(idOf(w7), newPhoto), "scheduled", "a preview changes photograph without touching any live row");

  // --- trend radar ------------------------------------------------------------
  const radarSignal = (itemKey, fields = {}) => ({
    source_key: "tommy-mello",
    sphere: "trades",
    kind: "video",
    item_key: itemKey,
    url: `https://www.youtube.com/watch?v=${itemKey}`,
    title: `Video ${itemKey}`,
    summary: "",
    published_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    views: 900,
    baseline_views: 300,
    momentum: 3,
    comments: null,
    ...fields,
  });
  const feedStatus = (key, ok) => ({ key, name: key, sphere: "trades", ok, items: ok ? 1 : 0, code: ok ? null : "FEED_BLOCKED" });
  const record = (signals, sources) =>
    sql(`select record_journal_radar_scan('${JSON.stringify(signals).replace(/'/g, "''")}'::jsonb, '${JSON.stringify(sources)}'::jsonb)`);
  // The worker passes the latest 04:00 Vancouver; the contract only needs a moment that has passed.
  const beginScan = (dueAfter = "now() - interval '2 hours'") => sql(`select begin_journal_radar_scan(${dueAfter})`);

  sql("update journal_editorial_settings set mode='off', radar_scanned_at=null, radar_scan_started_at=null");
  assert.equal(beginScan(), "f", "a switched-off pipeline never scans");
  sql("update journal_editorial_settings set mode='publish'");
  fails("select begin_journal_radar_scan(now() + interval '1 hour')", /has passed/, "a scan is never due in the future");
  fails("select begin_journal_radar_scan(null)", /has passed/, "a scan needs its due moment");
  assert.equal(beginScan(), "t", "a radar never scanned is due");
  assert.equal(beginScan(), "f", "a scan in flight holds off a second one");
  assert.equal(
    record(
      [radarSignal("a1"), radarSignal("a1", { title: "Repeated in the same feed" }), radarSignal("b2", { views: null, baseline_views: null, momentum: null }), radarSignal("old", { published_at: new Date(Date.now() - 50 * 86400000).toISOString() })],
      [feedStatus("tommy-mello", true), feedStatus("mike-rowe", true), feedStatus("hbr", false)]
    ),
    '{"ok": 2, "total": 3, "pruned": 1, "stored": 3}',
    "one copy per item, and nothing older than 45 days is kept"
  );
  assert.equal(sql("select title from journal_trend_signals where item_key='a1'"), "Video a1", "a feed that repeats an item keeps its first copy");
  assert.equal(sql("select count(*) from journal_trend_signals"), "2");
  assert.equal(sql("select summary is null from journal_trend_signals where item_key='a1'"), "t", "an empty summary is stored as none");
  assert.equal(
    sql("select (radar_scanned_at > now() - interval '1 minute')::text||'|'||jsonb_array_length(radar_sources)||'|'||(radar_sources->2->>'code') from journal_editorial_settings"),
    "true|3|FEED_BLOCKED",
    "each feed's outcome is kept for the Blog hub and the writer"
  );
  assert.equal(beginScan(), "f", "a radar read since the day's due moment is current");
  const firstSeen = sql("select first_seen_at from journal_trend_signals where item_key='a1'");
  sql("select pg_sleep(0.01)");
  record([radarSignal("a1", { views: 4500, momentum: 15 })], [feedStatus("tommy-mello", true)]);
  assert.equal(
    sql(`select views||'|'||momentum||'|'||(first_seen_at = '${firstSeen}')::text||'|'||(last_seen_at > first_seen_at)::text from journal_trend_signals where item_key='a1'`),
    "4500|15.00|true|true",
    "a signal seen again refreshes its numbers and keeps when it was first seen"
  );
  sql("update journal_editorial_settings set radar_scanned_at = now() - interval '25 hours', radar_scan_started_at = now() - interval '25 hours'");
  assert.equal(beginScan(), "t", "yesterday's read leaves today's due");
  sql("update journal_editorial_settings set radar_scanned_at = now() - interval '25 hours', radar_scan_started_at = now() - interval '11 minutes'");
  assert.equal(beginScan(), "t", "a scan that died ten minutes ago no longer holds the radar");
  fails(`select record_journal_radar_scan('${JSON.stringify([radarSignal("insecure", { url: "http://www.youtube.com/watch?v=x" })])}'::jsonb, '[]'::jsonb)`, /check|violates/, "only https signals");
  fails(`select record_journal_radar_scan('{}'::jsonb, '[]'::jsonb)`, /array/, "signals arrive as an array");

  const notifyRadar = (degraded, userId = user) =>
    sql(`select notify_journal_radar('${userId}','${company}',${degraded},'JOURNAL RADAR DEGRADED','Fewer than half the trend feeds answered.','/admin/blog','OPEN BLOG')`);
  assert.equal(notifyRadar(true), "raised");
  assert.equal(notifyRadar(true), "open", "a degraded radar is one rail item, not one per scan");
  assert.equal(sql("select count(*) from notifications where dedupe_key='journal:radar-degraded' and resolved_at is null"), "1");
  assert.equal(notifyRadar(false), "resolved", "a healthy scan clears it");
  assert.equal(notifyRadar(false), "clear");
  assert.equal(notifyRadar(true, ""), "skipped", "no recipient, no item");

  // --- the pitch -----------------------------------------------------------------
  const w8 = "weekly:2026-10-26";
  sql(`insert into journal_editorial_assignments(identity,slot_date,slot_at,state,mode,attempts,claim_token,lease_until) values('${w8}','2026-10-26',now()+interval '2 days','authoring','publish',1,'${t1}',now()+interval '10 minutes')`);
  const id8 = idOf(w8);
  const pitchJson = (topic) => JSON.stringify({ topic, headline: "YOUR NEW GUY QUIT BEFORE LUNCH" }).replace(/'/g, "''");
  const pitch = (token, topic = "Why new hires quit") => sql(`select pitch_journal_editorial_assignment('${id8}','${token}','${pitchJson(topic)}'::jsonb)`);
  assert.equal(pitch(t2), '{"code": "CLAIM_NOT_OWNED"}', "only the claim holder pitches");
  const lease0 = row(w8, "lease_until");
  assert.match(pitch(t1), /"state": "pitched"/);
  assert.equal(
    row(w8, `pitches||'|'||pitch_claim_token||'|'||(pitch->>'topic')||'|'||(lease_until > '${lease0}'::timestamptz + interval '45 minutes')::text||'|'||(pitched_at is not null)::text`),
    `1|${t1}|Why new hires quit|true|true`,
    "the first pitch of a claim renews the lease, because the writing starts now"
  );
  const lease1 = row(w8, "lease_until");
  pitch(t1, "A sharper topic");
  assert.equal(row(w8, `pitches||'|'||(pitch->>'topic')||'|'||(lease_until = '${lease1}'::timestamptz)::text`), "2|A sharper topic|true", "a revised pitch replaces the last and does not renew the lease again");
  pitch(t1, "The third try");
  assert.equal(pitch(t1, "A fourth try"), '{"code": "PITCH_LIMIT"}', "three pitches per claim");
  assert.equal(row(w8, "pitch->>'topic'"), "The third try");
  assert.equal(
    row(w8, "(select count(*) from jsonb_array_elements(attempt_log) e where e->>'event'='pitched')"),
    "3",
    "every accepted pitch is in the attempt log"
  );
  setRow(w8, `claim_token='${t3}', attempts=2, lease_until=now()+interval '5 minutes'`);
  assert.match(pitch(t3, "A new claim's topic"), /"state": "pitched"/, "a new claim starts its own pitch count");
  assert.equal(row(w8, `pitches||'|'||pitch_claim_token||'|'||(lease_until > now() + interval '55 minutes')::text`), `1|${t3}|true`);
  setRow(w8, "lease_until=now()-interval '1 minute'");
  assert.equal(pitch(t3), '{"code": "CLAIM_NOT_OWNED"}', "an expired lease cannot pitch");
  setRow(w8, "lease_until=now()+interval '5 minutes'");
  fails(`select pitch_journal_editorial_assignment('${id8}','${t3}','[]'::jsonb)`, /object/, "a pitch is an object");
  fails(`select pitch_journal_editorial_assignment('${id8}','${t3}',jsonb_build_object('topic', repeat('x', 70000)))`, /too large/, "a pitch has a size ceiling");
  setRow(w8, "state='queued', claim_token=null, lease_until=null");
  assert.equal(pitch(t3), '{"code": "CLAIM_NOT_OWNED"}', "a queued slot has no pitch holder");

  // --- grants -----------------------------------------------------------------
  for (const role of ["anon", "authenticated"]) {
    fails(`set role ${role}; select count(*) from journal_editorial_assignments`, /permission denied/, `${role} cannot read the ledger`);
    fails(`set role ${role}; select count(*) from journal_editorial_sources`, /permission denied/, `${role} cannot read sources`);
    fails(`set role ${role}; select publish_journal_editorial_assignment('${id1}',true,'x')`, /permission denied/, `${role} cannot publish`);
    fails(`set role ${role}; select claim_journal_editorial_assignment('${t1}','x')`, /permission denied/, `${role} cannot claim`);
    fails(`set role ${role}; select request_journal_editorial_image('${id1}','x')`, /permission denied/, `${role} cannot ask for a photograph`);
    fails(`set role ${role}; select replace_journal_editorial_image('${id1}','{"url":"https://h/x.jpg"}'::jsonb)`, /permission denied/, `${role} cannot replace a photograph`);
    fails(`set role ${role}; select count(*) from journal_trend_signals`, /permission denied/, `${role} cannot read the radar`);
    fails(`set role ${role}; select begin_journal_radar_scan(now())`, /permission denied/, `${role} cannot start a scan`);
    fails(`set role ${role}; select record_journal_radar_scan('[]'::jsonb,'[]'::jsonb)`, /permission denied/, `${role} cannot write the radar`);
    fails(`set role ${role}; select notify_journal_radar('u','c',true,'t','b','/','x')`, /permission denied/, `${role} cannot raise the radar item`);
    fails(`set role ${role}; select pitch_journal_editorial_assignment('${id1}','${t1}','{}'::jsonb)`, /permission denied/, `${role} cannot pitch`);
  }
  assert.equal(sqlAs("service_role", "select count(*) from journal_trend_signals"), "2", "service role reads the radar");
  assert.equal(sqlAs("service_role", "select count(*) from journal_editorial_assignments") !== "", true, "service role reads the ledger");
  assert.equal(
    sql("select bool_and(relrowsecurity) from pg_class where relname in ('journal_editorial_settings','journal_editorial_assignments','journal_editorial_sources','journal_trend_signals')"),
    "t",
    "row level security is on for all four tables"
  );
  assert.equal(
    sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%journal_editorial%' or p.proname like '%journal_radar%') and p.prosecdef"),
    "0",
    "every function runs as its caller"
  );

  console.log("PASS journal-editorial-runtime");
} finally {
  execFileSync(bin + "dropdb", [...args, "--if-exists", db]);
}
