// Runtime contract for the durable per-blog editorial assignment ledger.
// Applies the legacy editorial migration and then the assignment migration on a
// disposable database, so the replaced functions are exercised exactly as they
// will exist in production once both files have run.
import { execFileSync, execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const args = ["-h", "/private/tmp/ops-editorial-pg/socket", "-p", "55439"];
const db = "social_editorial_assignments_test_" + process.pid;
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

const blogA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const blogB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const blogC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const blogD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const blogE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const blogF = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const t1 = "11111111-1111-4111-8111-111111111111";
const t2 = "22222222-2222-4222-8222-222222222222";
const t3 = "33333333-3333-4333-8333-333333333333";
const localExpression = "(now() at time zone 'Etc/GMT+7')::date";

function seedBlog(id, title, slug, publishedAt, live = true) {
  sql(
    `insert into blog_posts(id,title,slug,content,published_at,is_live,thumbnail_url) values('${id}','${title}','${slug}','<p>${title} body text that is long enough to matter.</p>',${publishedAt},${live},null)`
  );
}

function seedQueued(identity, kind, { blogId = null, slotDate = null } = {}) {
  sql(
    `insert into social_editorial_assignments(identity,kind,blog_id,slot_date) values('${identity}','${kind}',${blogId ? `'${blogId}'` : "null"},${slotDate ? `'${slotDate}'` : "null"})`
  );
  return sql(
    `select id from social_editorial_assignments where identity='${identity}'`
  );
}

execFileSync(bin + "createdb", [...args, db]);
try {
  sql(
    "DO $$ BEGIN IF NOT EXISTS(select from pg_roles where rolname='anon') THEN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; END IF; END $$;" +
      "CREATE TABLE public.social_posts(id uuid primary key default gen_random_uuid(),idempotency_key text,status text,updated_by text,source_id text,publish_after timestamptz,created_by text,instagram_permalink text,created_at timestamptz not null default now());" +
      "CREATE TABLE public.blog_posts(id uuid primary key default gen_random_uuid(),title text,slug text,content text,published_at timestamptz,is_live boolean,thumbnail_url text,updated_at timestamptz not null default now());" +
      "CREATE TABLE public.notifications(id uuid default gen_random_uuid(),user_id text,company_id text,type text,title text,body text,is_read boolean,persistent boolean,action_url text,action_label text,dedupe_key text,created_at timestamptz not null default now());"
  );
  sql(migration("_create_social_editorial.sql"));
  sql(migration("_create_social_editorial_assignments.sql"));
  const today = sql(`select ${localExpression}`);

  // --- settings extension -------------------------------------------------
  assert.equal(
    sql(
      "select discovery_since is not null and delivery_gap_minutes=1200 and authoring_lease_minutes=40 and authoring_heartbeat_at is null and authoring_stall_notified_on is null from social_editorial_settings"
    ),
    "t",
    "settings gain discovery, pacing, lease and monitoring columns with defaults"
  );

  // --- discovery ----------------------------------------------------------
  seedBlog(blogA, "Alpha", "alpha", "now()-interval '1 day'");
  seedBlog(blogB, "Bravo", "bravo", "now()-interval '2 hours'");
  seedBlog(blogC, "Charlie", "charlie", "now()-interval '40 days'");
  seedBlog(blogD, "Delta", "delta", "now()+interval '1 day'");
  seedBlog(blogE, "Echo", "echo", "now()-interval '3 hours'", false);
  seedBlog(blogF, "Foxtrot", "foxtrot", "now()-interval '10 days'");
  sql(
    "update social_editorial_settings set discovery_since=now()-interval '5 days'"
  );
  assert.equal(
    sql(`select discover_social_editorial_assignments(${localExpression},'Mon')`),
    '{"blogs": 2, "recurring": 0}',
    "only live blogs published after the boundary, inside the 30-day window and not in the future are assigned"
  );
  assert.equal(
    sql(
      "select string_agg(identity,',' order by identity) from social_editorial_assignments"
    ),
    `blog:${blogA},blog:${blogB}`,
    "each newly published blog gets exactly one durable identity"
  );
  assert.equal(
    sql(`select discover_social_editorial_assignments(${localExpression},'Mon')`),
    '{"blogs": 0, "recurring": 0}',
    "repeat discovery never duplicates a blog assignment"
  );
  assert.equal(
    sql(`select discover_social_editorial_assignments(${localExpression},'Tue')`),
    '{"blogs": 0, "recurring": 1}',
    "Tuesday opens a protocol assignment"
  );
  assert.equal(
    sql(`select discover_social_editorial_assignments(${localExpression},'Tue')`),
    '{"blogs": 0, "recurring": 0}',
    "the same Tuesday never opens a second protocol assignment"
  );
  assert.equal(
    sql(
      `select count(*) from social_editorial_assignments where identity='protocol:${today}' and kind='protocol' and slot_date='${today}'`
    ),
    "1"
  );
  assert.equal(
    sql(
      `select discover_social_editorial_assignments('${today}'::date+1,'Wed')`
    ),
    '{"blogs": 0, "recurring": 1}'
  );
  assert.equal(
    sql(
      `select discover_social_editorial_assignments('${today}'::date+3,'Fri')`
    ),
    '{"blogs": 0, "recurring": 1}'
  );
  assert.equal(
    sql(
      `select discover_social_editorial_assignments('${today}'::date+5,'Sun')`
    ),
    '{"blogs": 0, "recurring": 0}',
    "the weekend opens no recurring assignment"
  );
  assert.equal(
    sql(
      "select string_agg(kind,',' order by kind) from social_editorial_assignments where kind<>'blog'"
    ),
    "product,protocol,rotation"
  );

  // --- claiming -----------------------------------------------------------
  sql("delete from social_editorial_assignments");
  const assignmentA = seedQueued(`blog:${blogA}`, "blog", { blogId: blogA });
  sql("update social_editorial_settings set authoring_heartbeat_at=null");
  assert.equal(
    sql(`select count(*) from claim_social_editorial_assignment('${t1}','w1')`),
    "0",
    "authoring is off until the operator turns it on"
  );
  assert.equal(
    sql(
      "select authoring_heartbeat_at is not null from social_editorial_settings"
    ),
    "t",
    "an off-mode poll still proves the routine is alive"
  );
  sql("update social_editorial_settings set mode='prepare'");
  assert.equal(
    sql(`select count(*) from claim_social_editorial_assignment('${t1}','w1')`),
    "1"
  );
  assert.equal(
    sql(
      `select state||'/'||attempts||'/'||submissions||'/'||claimed_by||'/'||mode||'/'||(lease_until>now())::text from social_editorial_assignments where id='${assignmentA}'`
    ),
    "authoring/1/0/w1/prepare/true",
    "a claim stamps the worker, the mode, a fresh submission budget and a live lease"
  );
  assert.equal(
    sql(`select count(*) from claim_social_editorial_assignment('${t2}','w2')`),
    "0",
    "a live lease is never handed to a second worker"
  );
  sql(
    `update social_editorial_assignments set lease_until=now()-interval '1 minute' where id='${assignmentA}'`
  );
  assert.equal(
    sql(`select count(*) from claim_social_editorial_assignment('${t2}','w2')`),
    "1",
    "an expired lease returns the work to the queue"
  );
  assert.equal(
    sql(
      `select attempts from social_editorial_assignments where id='${assignmentA}'`
    ),
    "2",
    "an expired attempt stays consumed"
  );
  sql(
    `update social_editorial_assignments set lease_until=now()-interval '1 minute' where id='${assignmentA}'`
  );
  assert.equal(
    sql(`select count(*) from claim_social_editorial_assignment('${t3}','w3')`),
    "1"
  );
  sql(
    `update social_editorial_assignments set lease_until=now()-interval '1 minute' where id='${assignmentA}'`
  );
  assert.equal(
    sql(`select count(*) from claim_social_editorial_assignment('${t1}','w1')`),
    "0",
    "a third expiry stops the assignment instead of looping forever"
  );
  assert.equal(
    sql(
      `select state||'/'||last_code from social_editorial_assignments where id='${assignmentA}'`
    ),
    "blocked/ATTEMPTS_EXHAUSTED"
  );
  assert.equal(
    sql("select recover_social_editorial_assignments()"),
    "0",
    "recovery is idempotent"
  );

  // --- concurrency --------------------------------------------------------
  sql("delete from social_editorial_assignments");
  const contested = seedQueued(`blog:${blogB}`, "blog", { blogId: blogB });
  const concurrent = await Promise.all(
    [t1, t2].map((token) =>
      promisify(execFile)(bin + "psql", [
        ...args,
        "-d",
        db,
        "-XAtq",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `select count(*) from claim_social_editorial_assignment('${token}','worker')`,
      ])
    )
  );
  assert.deepEqual(
    concurrent.map((r) => r.stdout.trim()).sort(),
    ["0", "1"],
    "two routines racing for one assignment produce exactly one claim"
  );
  const owner = sql(
    `select claim_token from social_editorial_assignments where id='${contested}'`
  );

  // --- checkpoint, attempts and drafting ----------------------------------
  assert.equal(
    sql(
      `select checkpoint_social_editorial_assignment('${contested}','${t3}','{"id":"${blogB}"}','v3','abc')`
    ),
    "f",
    "a stale owner cannot write a snapshot"
  );
  assert.equal(
    sql(
      `select checkpoint_social_editorial_assignment('${contested}','${owner}','{"id":"${blogB}","title":"Bravo"}','ops-editorial-2026-09-07-v3','abc')`
    ),
    "t"
  );
  assert.equal(
    sql(
      `select source_id::text||'/'||brief_version||'/'||guide_sha256 from social_editorial_assignments where id='${contested}'`
    ),
    `${blogB}/ops-editorial-2026-09-07-v3/abc`
  );
  assert.equal(
    sql(
      `select record_social_editorial_assignment_attempt('${contested}','${t3}','{"event":"submission"}')`
    ),
    "f",
    "a stale owner cannot append to the attempt log"
  );
  assert.equal(
    sql(
      `select record_social_editorial_assignment_attempt('${contested}','${owner}','{"event":"submission"}')`
    ),
    "t"
  );
  assert.equal(
    sql(
      `select submissions||'/'||jsonb_array_length(attempt_log) from social_editorial_assignments where id='${contested}'`
    ),
    "1/1",
    "a submission event consumes one of the three submissions per claim"
  );
  assert.equal(
    sql(
      `select record_social_editorial_assignment_attempt('${contested}','${owner}','{"event":"note"}')`
    ),
    "t"
  );
  assert.equal(
    sql(
      `select submissions from social_editorial_assignments where id='${contested}'`
    ),
    "1",
    "a non-submission event does not consume the submission budget"
  );
  for (let i = 0; i < 9; i++)
    sql(
      `select record_social_editorial_assignment_attempt('${contested}','${owner}','{"event":"note"}')`
    );
  assert.equal(
    sql(
      `select jsonb_array_length(attempt_log) from social_editorial_assignments where id='${contested}'`
    ),
    "9",
    "the attempt log is bounded"
  );
  assert.throws(
    () =>
      sql(
        `select record_social_editorial_assignment_attempt('${contested}','${owner}',jsonb_build_object('event',repeat('x',120000)))`
      ),
    /Attempt too large/
  );
  assert.equal(
    sql(
      `select finish_social_editorial_assignment('${contested}','${owner}','drafted',null,null)`
    ),
    "",
    "a draft without a package is not a draft"
  );
  assert.equal(
    sql(
      `select finish_social_editorial_assignment('${contested}','${t3}','drafted',null,'{"submission":{}}')`
    ),
    "",
    "a stale owner cannot finish"
  );
  assert.equal(
    sql(
      `select finish_social_editorial_assignment('${contested}','${owner}','drafted',null,'{"submission":{"content":{"title":"Bravo"}}}')`
    ),
    "drafted"
  );
  assert.equal(
    sql(
      `select finish_social_editorial_assignment('${contested}','${owner}','drafted',null,'{"submission":{}}')`
    ),
    "drafted",
    "replaying the same successful handoff returns the same answer"
  );
  assert.equal(
    sql(
      `select state||'/'||(drafted_at is not null)::text||'/'||(lease_until is null)::text||'/'||(package->'submission'->'content'->>'title') from social_editorial_assignments where id='${contested}'`
    ),
    "drafted/true/true/Bravo",
    "a replay never overwrites the accepted package"
  );

  // --- retry timing -------------------------------------------------------
  sql("delete from social_editorial_assignments");
  const retried = seedQueued(`blog:${blogA}`, "blog", { blogId: blogA });
  sql(`select claim_social_editorial_assignment('${t1}','w1')`);
  assert.equal(
    sql(
      `select finish_social_editorial_assignment('${retried}','${t1}','queued','EDITOR_REJECTED',null)`
    ),
    "queued"
  );
  assert.equal(
    sql(
      `select abs(extract(epoch from (next_attempt_at-(now()+interval '6 hours'))))<60 from social_editorial_assignments where id='${retried}'`
    ),
    "t",
    "an editor rejection waits six hours"
  );
  assert.equal(
    sql(`select count(*) from claim_social_editorial_assignment('${t2}','w2')`),
    "0",
    "a backed-off assignment is not claimable yet"
  );
  sql(
    `update social_editorial_assignments set next_attempt_at=now() where id='${retried}'`
  );
  sql(`select claim_social_editorial_assignment('${t2}','w2')`);
  assert.equal(
    sql(
      `select finish_social_editorial_assignment('${retried}','${t2}','queued','DRAFT_FAILED',null)`
    ),
    "queued"
  );
  assert.equal(
    sql(
      `select abs(extract(epoch from (next_attempt_at-(now()+interval '2 hours'))))<60 from social_editorial_assignments where id='${retried}'`
    ),
    "t",
    "every other retry waits two hours"
  );
  sql(
    `update social_editorial_assignments set next_attempt_at=now() where id='${retried}'`
  );
  sql(`select claim_social_editorial_assignment('${t3}','w3')`);
  assert.equal(
    sql(
      `select finish_social_editorial_assignment('${retried}','${t3}','queued','EDITOR_REJECTED',null)`
    ),
    "blocked",
    "the third rejection stops the assignment"
  );
  assert.equal(
    sql(
      `select last_code||'/'||(blocked_at is not null)::text||'/'||(next_attempt_at is null)::text from social_editorial_assignments where id='${retried}'`
    ),
    "EDITOR_REJECTED/true/true"
  );

  // --- promotion ----------------------------------------------------------
  sql("delete from social_editorial_assignments");
  const promoted = seedQueued(`blog:${blogA}`, "blog", { blogId: blogA });
  sql(`select claim_social_editorial_assignment('${t1}','w1')`);
  sql(
    `select finish_social_editorial_assignment('${promoted}','${t1}','drafted',null,'{"submission":{}}')`
  );
  assert.equal(
    sql(
      `select promote_social_editorial_assignment('${promoted}','prepared',null,null,null,null)`
    ),
    "",
    "a prepared assignment must carry the preview the operator will look at"
  );
  assert.equal(
    sql(
      `select promote_social_editorial_assignment('${promoted}','submitted',null,null,null,null)`
    ),
    "",
    "a submitted assignment must name the queued post"
  );
  assert.equal(
    sql(
      `select promote_social_editorial_assignment('${promoted}','prepared',null,'[{"order":0}]',null,'{"id":"${blogB}"}')`
    ),
    "prepared"
  );
  assert.equal(
    sql(
      `select source_id::text||'/'||(prepared_at is not null)::text||'/'||jsonb_array_length(preview) from social_editorial_assignments where id='${promoted}'`
    ),
    `${blogB}/true/1`,
    "promotion can refresh the snapshot it rendered from"
  );
  assert.equal(
    sql(
      `select promote_social_editorial_assignment('${promoted}','submitted',null,null,'${t1}',null)`
    ),
    "",
    "an already promoted assignment cannot be promoted twice"
  );
  sql(
    `update social_editorial_assignments set state='drafted' where id='${promoted}'`
  );
  assert.equal(
    sql(
      `select annotate_social_editorial_assignment('${promoted}','{"event":"source_refreshed"}','{"id":"${blogA}","title":"Alpha"}','{"submission":{"content":{"title":"Refreshed"}}}')`
    ),
    "t",
    "the worker can record a refreshed source and package on a drafted row"
  );
  assert.equal(
    sql(
      `select source_id::text||'/'||(package->'submission'->'content'->>'title')||'/'||(attempt_log->-1->>'event') from social_editorial_assignments where id='${promoted}'`
    ),
    `${blogA}/Refreshed/source_refreshed`
  );
  assert.equal(
    sql(
      `select annotate_social_editorial_assignment('${promoted}','{"event":"promotion_failed"}',null,null)`
    ),
    "t"
  );
  assert.equal(
    sql(
      `select (source_id='${blogA}')::text||'/'||(package->'submission'->'content'->>'title') from social_editorial_assignments where id='${promoted}'`
    ),
    "true/Refreshed",
    "an annotation without a refresh leaves the snapshot and package alone"
  );
  sql(
    `update social_editorial_assignments set state='prepared' where id='${promoted}'`
  );
  assert.equal(
    sql(
      `select annotate_social_editorial_assignment('${promoted}','{"event":"late"}',null,null)`
    ),
    "f",
    "only a drafted row accepts a worker annotation"
  );
  sql(
    `update social_editorial_assignments set state='drafted' where id='${promoted}'`
  );
  sql(
    `update social_editorial_assignments set state='drafted' where id='${promoted}'`
  );
  const postId = "99999999-9999-4999-8999-999999999999";
  sql(
    `insert into social_posts(id,idempotency_key,status,updated_by,created_by) values('${postId}','manual','review','operator','operator')`
  );
  assert.equal(
    sql(
      `select promote_social_editorial_assignment('${promoted}','submitted',null,null,'${postId}',null)`
    ),
    "submitted"
  );
  assert.equal(
    sql(
      `select post_id::text||'/'||(submitted_at is not null)::text from social_editorial_assignments where id='${promoted}'`
    ),
    `${postId}/true`
  );
  sql(
    `update social_editorial_assignments set state='drafted' where id='${promoted}'`
  );
  assert.equal(
    sql(
      `select promote_social_editorial_assignment('${promoted}','queued','SOURCE_CHANGED',null,null,null)`
    ),
    "queued"
  );
  assert.equal(
    sql(
      `select (package is null)::text||'/'||attempts from social_editorial_assignments where id='${promoted}'`
    ),
    "true/1",
    "a changed source drops the stale package without spending an attempt"
  );

  // --- handoff guard ------------------------------------------------------
  sql("delete from social_editorial_assignments; delete from social_posts");
  const guarded = seedQueued(`blog:${blogA}`, "blog", { blogId: blogA });
  sql(
    `update social_editorial_assignments set state='drafted',mode='publish',package='{"submission":{}}' where id='${guarded}'`
  );
  sql("update social_editorial_settings set mode='publish'");
  assert.throws(
    () =>
      sql(
        `insert into social_posts(idempotency_key,status,updated_by,source_id,created_by) values('cloud-editorial-v1:${today}','rendering','agent:social','${blogA}','agent:social')`
      ),
    /handoff is disabled/,
    "the retired date-keyed path can never queue another post"
  );
  sql("update social_editorial_settings set mode='prepare'");
  assert.throws(
    () =>
      sql(
        `insert into social_posts(idempotency_key,status,updated_by,source_id,created_by) values('cloud-editorial-v2:blog:${blogA}','rendering','agent:social','${blogA}','agent:social')`
      ),
    /handoff is disabled/,
    "prepare mode never releases a post"
  );
  sql("update social_editorial_settings set mode='publish'");
  sql(`update blog_posts set is_live=false where id='${blogA}'`);
  assert.throws(
    () =>
      sql(
        `insert into social_posts(idempotency_key,status,updated_by,source_id,created_by) values('cloud-editorial-v2:blog:${blogA}','rendering','agent:social','${blogA}','agent:social')`
      ),
    /handoff is disabled/,
    "a withdrawn article never reaches Instagram"
  );
  sql(`update blog_posts set is_live=true where id='${blogA}'`);
  assert.throws(
    () =>
      sql(
        `insert into social_posts(idempotency_key,status,updated_by,source_id,created_by) values('cloud-editorial-v2:blog:${blogA}','rendering','agent:social','${blogC}','agent:social')`
      ),
    /handoff is disabled/,
    "the queued post must carry the article the assignment was written from"
  );
  assert.throws(
    () =>
      sql(
        `insert into social_posts(idempotency_key,status,updated_by,source_id,created_by) values('cloud-editorial-v2:blog:${blogB}','rendering','agent:social','${blogB}','agent:social')`
      ),
    /handoff is disabled/,
    "a key with no drafted assignment behind it is refused"
  );
  sql(
    `insert into social_posts(idempotency_key,status,updated_by,source_id,created_by) values('cloud-editorial-v2:blog:${blogA}','rendering','agent:social','${blogA}','agent:social')`
  );
  sql(
    "update social_posts set status='review' where updated_by='agent:social'"
  );
  assert.equal(
    sql("select count(*) from social_posts where status='review'"),
    "1",
    "a matching publish-mode assignment is allowed through"
  );

  // --- notifications ------------------------------------------------------
  sql("delete from social_posts; delete from notifications");
  sql(
    `update social_editorial_assignments set state='prepared',notified_at=null where id='${guarded}'`
  );
  const blockedAssignment = seedQueued(`protocol:${today}`, "protocol", {
    slotDate: today,
  });
  sql(
    `update social_editorial_assignments set state='blocked',last_code='NO_FRESH_SOURCE' where id='${blockedAssignment}'`
  );
  assert.equal(
    sql("select notify_social_editorial('operator','company')"),
    "2",
    "the operator hears about every prepared draft and every stop"
  );
  assert.equal(
    sql("select notify_social_editorial('operator','company')"),
    "0",
    "acknowledgement is durable"
  );
  assert.equal(
    sql(
      "select string_agg(title||'|'||persistent::text||'|'||dedupe_key,';' order by dedupe_key) from notifications"
    ),
    `INSTAGRAM DRAFT READY|false|editorial:blog:${blogA};INSTAGRAM POST BLOCKED|true|editorial:protocol:${today}`
  );
  assert.equal(
    sql(
      "select count(*) from notifications where action_url='/admin/social#cloud-production' and action_label='VIEW SOCIAL' and type='social_editorial' and is_read=false and body<>''"
    ),
    "2"
  );
  sql(
    "insert into social_editorial_runs(slot_date,kind,mode,state) values(current_date-1,'blog','prepare','failed')"
  );
  assert.equal(
    sql("select notify_social_editorial('operator','company')"),
    "1",
    "the replaced function still drains the legacy run outbox"
  );

  // --- authoring stall ----------------------------------------------------
  sql(
    "delete from notifications; delete from social_editorial_assignments; delete from social_editorial_runs"
  );
  sql(
    "update social_editorial_settings set authoring_heartbeat_at=null,authoring_stall_notified_on=null"
  );
  assert.equal(
    sql("select check_social_editorial_authoring('operator','company',26)"),
    "f",
    "no queued work means no stall"
  );
  const stalled = seedQueued(`blog:${blogB}`, "blog", { blogId: blogB });
  sql(
    `update social_editorial_assignments set created_at=now()-interval '30 hours' where id='${stalled}'`
  );
  sql("update social_editorial_settings set authoring_heartbeat_at=now()");
  assert.equal(
    sql("select check_social_editorial_authoring('operator','company',26)"),
    "f",
    "a live routine working through a backlog is not a stall"
  );
  sql("update social_editorial_settings set authoring_heartbeat_at=null");
  assert.equal(
    sql("select check_social_editorial_authoring('operator','company',26)"),
    "t"
  );
  assert.equal(
    sql("select check_social_editorial_authoring('operator','company',26)"),
    "f",
    "the operator is told once a day, not once a tick"
  );
  assert.equal(
    sql(
      "select title||'|'||persistent::text||'|'||dedupe_key from notifications"
    ),
    `INSTAGRAM AUTHORING STALLED|true|editorial:authoring-stalled:${today}`
  );

  // --- security boundary --------------------------------------------------
  assert.equal(
    sql(
      "select relrowsecurity from pg_class where relname='social_editorial_assignments'"
    ),
    "t"
  );
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
    for (const role of ["anon", "authenticated"])
      assert.equal(
        sql(
          `select has_table_privilege('${role}','social_editorial_assignments','${privilege}')`
        ),
        "f",
        `${role} must not hold ${privilege} on the ledger`
      );
  assert.equal(
    sql(
      "select has_table_privilege('service_role','social_editorial_assignments','SELECT')"
    ),
    "t"
  );
  const functions = [
    "discover_social_editorial_assignments(date,text)",
    "claim_social_editorial_assignment(uuid,text)",
    "checkpoint_social_editorial_assignment(uuid,uuid,jsonb,text,text)",
    "record_social_editorial_assignment_attempt(uuid,uuid,jsonb)",
    "finish_social_editorial_assignment(uuid,uuid,text,text,jsonb)",
    "recover_social_editorial_assignments()",
    "promote_social_editorial_assignment(uuid,text,text,jsonb,uuid,jsonb)",
    "annotate_social_editorial_assignment(uuid,jsonb,jsonb,jsonb)",
    "notify_social_editorial(text,text)",
    "check_social_editorial_authoring(text,text,integer)",
  ];
  for (const signature of functions) {
    for (const role of ["public", "anon", "authenticated"])
      assert.equal(
        sql(`select has_function_privilege('${role}','${signature}','EXECUTE')`),
        "f",
        `${role} must not execute ${signature}`
      );
    assert.equal(
      sql(
        `select has_function_privilege('service_role','${signature}','EXECUTE')`
      ),
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
    "PASS: discovery idempotence, claim leases and attempts, concurrency, snapshot ownership, bounded submissions, draft replay, retry timing, promotion guards, v1 retirement and v2 handoff guard, notification outbox, authoring stall and grants"
  );
} finally {
  execFileSync(bin + "dropdb", [...args, db]);
}
