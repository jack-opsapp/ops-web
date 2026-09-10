-- Weekly journal ledger.
--
-- One row per weekly slot (Monday 06:00 Vancouver by default). A cloud routine
-- on the operator's subscription claims the slot, asks OPS to fetch every
-- source it wants to cite, and hands back a draft. Only OPS writes
-- public.blog_posts: the hourly worker promotes a validated draft into a
-- scheduled preview, and this file's publish function inserts the live row
-- exactly once. The routine never reaches the database.
--
-- Vancouver adopted permanent UTC-7 in March 2026, so every wall-clock
-- computation uses the fixed zone Etc/GMT+7 rather than a tzdata lookup.
--
-- Additive: three new tables and their functions. Nothing existing changes.

create table public.journal_editorial_settings (
 id boolean primary key default true check (id),
 mode text not null default 'off' check (mode in ('off','prepare','publish')),
 publish_weekday integer not null default 1 check (publish_weekday between 0 and 6),
 publish_hour integer not null default 6 check (publish_hour between 0 and 23),
 draft_open_hours integer not null default 72 check (draft_open_hours between 12 and 168),
 min_veto_minutes integer not null default 360 check (min_veto_minutes between 30 and 2880),
 slot_grace_hours integer not null default 72 check (slot_grace_hours between 6 and 144),
 authoring_lease_minutes integer not null default 60 check (authoring_lease_minutes between 15 and 180),
 max_sources integer not null default 24 check (max_sources between 4 and 60),
 byline text not null default 'OPS Team' check (byline = btrim(byline) and length(byline) between 1 and 80),
 authoring_heartbeat_at timestamptz,
 authoring_stall_notified_on date,
 updated_at timestamptz not null default now()
);
insert into public.journal_editorial_settings (id) values (true);

create table public.journal_editorial_assignments (
 id uuid primary key default gen_random_uuid(),
 identity text not null unique check (identity ~ '^weekly:[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 kind text not null default 'weekly' check (kind = 'weekly'),
 slot_date date not null,
 slot_at timestamptz not null,
 publish_at timestamptz,
 mode text check (mode in ('prepare','publish')),
 state text not null default 'queued' check (state in ('queued','authoring','drafted','scheduled','published','cancelled','blocked')),
 attempts integer not null default 0 check (attempts between 0 and 3),
 submissions integer not null default 0 check (submissions between 0 and 3),
 claim_token uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz,
 claimed_by text check (claimed_by is null or length(claimed_by) <= 120),
 brief_version text,
 slug text check (slug is null or (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80)),
 title text check (title is null or length(title) <= 200),
 package jsonb,
 preview jsonb,
 blog_id uuid references public.blog_posts(id) on delete set null,
 attempt_log jsonb not null default '[]'::jsonb,
 last_code text check (last_code is null or last_code ~ '^[A-Z_]{1,80}$'),
 notified_state text,
 newsletter_state text check (newsletter_state is null or newsletter_state in ('sending','sent','skipped')),
 newsletter_token uuid,
 newsletter_at timestamptz,
 drafted_at timestamptz,
 scheduled_at timestamptz,
 published_at timestamptz,
 cancelled_at timestamptz,
 cancelled_by text check (cancelled_by is null or length(cancelled_by) <= 200),
 blocked_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (identity = 'weekly:' || slot_date::text),
 check (state not in ('drafted','scheduled','published') or (package is not null and slug is not null)),
 check (state <> 'scheduled' or (preview is not null and publish_at is not null)),
 check (state <> 'published' or published_at is not null)
);
-- A slug is reserved from the moment a draft is accepted until it is stopped,
-- so two weeks can never race for the same address.
create unique index journal_editorial_assignments_slug_idx
 on public.journal_editorial_assignments (slug)
 where slug is not null and state in ('drafted','scheduled','published');
create index journal_editorial_assignments_queue_idx
 on public.journal_editorial_assignments (state, next_attempt_at, slot_at);

-- Every page the writer wants to cite is fetched and kept by OPS. Evidence
-- quotes are verified against these snapshots, never against the writer's copy.
create table public.journal_editorial_sources (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public.journal_editorial_assignments(id) on delete cascade,
 claim_token uuid not null,
 url text not null check (url ~ '^https://' and length(url) <= 2048),
 final_url text not null check (final_url ~ '^https://' and length(final_url) <= 2048),
 http_status integer not null check (http_status between 200 and 299),
 content_type text not null check (content_type in ('text/html','text/plain','application/pdf')),
 bytes integer not null check (bytes >= 0),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 title text check (title is null or length(title) <= 300),
 site_name text check (site_name is null or length(site_name) <= 120),
 published_hint timestamptz,
 modified_hint timestamptz,
 text text not null check (length(text) between 1 and 150000),
 truncated boolean not null default false,
 fetched_at timestamptz not null default now(),
 unique (assignment_id, url)
);
create index journal_editorial_sources_claim_idx
 on public.journal_editorial_sources (assignment_id, claim_token);

alter table public.journal_editorial_settings enable row level security;
alter table public.journal_editorial_assignments enable row level security;
alter table public.journal_editorial_sources enable row level security;
revoke all on public.journal_editorial_settings, public.journal_editorial_assignments, public.journal_editorial_sources from public, anon, authenticated;
grant select, insert, update, delete on public.journal_editorial_settings, public.journal_editorial_assignments, public.journal_editorial_sources to service_role;

-- The next slot is always strictly in the future, so a slot is never created
-- after its own publication time has passed. Off-mode accounts create nothing:
-- a switched-off pipeline must not raise a missed-slot alarm every week.
create function public.discover_journal_editorial_assignment(p_now timestamptz default now())
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 s public.journal_editorial_settings;
 v_local timestamp;
 v_date date;
 v_slot_local timestamp;
 v_slot timestamptz;
 v_created integer := 0;
 v_missed integer := 0;
begin
 select * into strict s from public.journal_editorial_settings where id for update;
 v_local := p_now at time zone 'Etc/GMT+7';
 v_date := v_local::date + ((s.publish_weekday - extract(dow from v_local)::integer + 7) % 7);
 v_slot_local := v_date + make_interval(hours => s.publish_hour);
 if v_slot_local <= v_local then
  v_date := v_date + 7;
  v_slot_local := v_slot_local + interval '7 days';
 end if;
 v_slot := v_slot_local at time zone 'Etc/GMT+7';
 if s.mode <> 'off' and p_now >= v_slot - make_interval(hours => s.draft_open_hours) then
  insert into public.journal_editorial_assignments (identity, slot_date, slot_at)
  values ('weekly:' || v_date::text, v_date, v_slot)
  on conflict (identity) do nothing;
  get diagnostics v_created = row_count;
 end if;
 -- A slot nobody drafted in time stops for a person; it never publishes days late.
 update public.journal_editorial_assignments set
  state = 'blocked', last_code = 'SLOT_MISSED', blocked_at = p_now,
  next_attempt_at = null, updated_at = p_now
 where state = 'queued' and slot_at + make_interval(hours => s.slot_grace_hours) <= p_now;
 get diagnostics v_missed = row_count;
 return jsonb_build_object('created', v_created, 'missed', v_missed, 'slot', v_date);
end $$;

-- An abandoned lease returns the work to the queue with its attempt spent, so
-- a routine that dies mid-draft can never loop forever.
create function public.recover_journal_editorial_assignments()
returns integer language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
 update public.journal_editorial_assignments set
  state = case when attempts >= 3 then 'blocked' else 'queued' end,
  last_code = case when attempts >= 3 then 'ATTEMPTS_EXHAUSTED' else 'LEASE_EXPIRED' end,
  blocked_at = case when attempts >= 3 then now() else blocked_at end,
  next_attempt_at = case when attempts >= 3 then null else now() end,
  claim_token = null, lease_until = null, claimed_by = null, updated_at = now()
 where state = 'authoring' and (lease_until is null or lease_until <= now());
 get diagnostics affected = row_count;
 return affected;
end $$;

-- The singleton settings row serializes competing routine runs: both queue on
-- the lock and exactly one wins the slot.
create function public.claim_journal_editorial_assignment(p_token uuid, p_worker text)
returns setof public.journal_editorial_assignments language plpgsql security invoker set search_path = '' as $$
declare s public.journal_editorial_settings; v_id uuid;
begin
 select * into strict s from public.journal_editorial_settings where id for update;
 update public.journal_editorial_settings set authoring_heartbeat_at = now() where id;
 perform public.recover_journal_editorial_assignments();
 if s.mode = 'off' or p_token is null or coalesce(btrim(p_worker), '') = '' then return; end if;
 select a.id into v_id from public.journal_editorial_assignments a
 where a.state = 'queued' and a.attempts < 3
  and (a.next_attempt_at is null or a.next_attempt_at <= now())
  and a.slot_at + make_interval(hours => s.slot_grace_hours) > now()
 order by a.slot_at, a.created_at, a.id
 for update skip locked limit 1;
 if v_id is null then return; end if;
 return query update public.journal_editorial_assignments set
  state = 'authoring', mode = s.mode, attempts = attempts + 1, submissions = 0,
  claim_token = p_token, claimed_by = left(btrim(p_worker), 120),
  lease_until = now() + make_interval(mins => s.authoring_lease_minutes),
  next_attempt_at = null, last_code = null, updated_at = now()
 where id = v_id returning *;
end $$;

create function public.record_journal_editorial_attempt(p_id uuid, p_token uuid, p_detail jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
 if octet_length(p_detail::text) > 20000 then raise exception 'Attempt too large'; end if;
 update public.journal_editorial_assignments set
  attempt_log = attempt_log || jsonb_build_array(p_detail),
  submissions = case when p_detail->>'event' = 'submission' then least(submissions + 1, 3) else submissions end,
  updated_at = now()
 where id = p_id and claim_token = p_token and state = 'authoring' and lease_until > now()
  and jsonb_array_length(attempt_log) < 40;
 return found;
end $$;

-- Stores one OPS-fetched snapshot under the live claim. The same URL is kept
-- once per assignment; the per-claim cap bounds what one run can make OPS fetch.
create function public.store_journal_editorial_source(p_id uuid, p_token uuid, p_source jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.journal_editorial_settings; a public.journal_editorial_assignments; v_id uuid; v_count integer;
begin
 select * into strict s from public.journal_editorial_settings where id;
 select * into a from public.journal_editorial_assignments where id = p_id for update;
 if not found or a.claim_token is distinct from p_token or a.state <> 'authoring' or a.lease_until <= now() then
  return jsonb_build_object('code', 'CLAIM_NOT_OWNED');
 end if;
 select id into v_id from public.journal_editorial_sources where assignment_id = p_id and url = p_source->>'url';
 if v_id is not null then return jsonb_build_object('id', v_id, 'existing', true); end if;
 select count(*) into v_count from public.journal_editorial_sources where assignment_id = p_id and claim_token = p_token;
 if v_count >= s.max_sources then return jsonb_build_object('code', 'SOURCE_LIMIT'); end if;
 insert into public.journal_editorial_sources (
  assignment_id, claim_token, url, final_url, http_status, content_type, bytes, sha256,
  title, site_name, published_hint, modified_hint, text, truncated
 ) values (
  p_id, p_token, p_source->>'url', p_source->>'final_url', (p_source->>'http_status')::integer,
  p_source->>'content_type', (p_source->>'bytes')::integer, p_source->>'sha256',
  nullif(p_source->>'title', ''), nullif(p_source->>'site_name', ''),
  (p_source->>'published_hint')::timestamptz, (p_source->>'modified_hint')::timestamptz,
  p_source->>'text', coalesce((p_source->>'truncated')::boolean, false)
 ) returning id into v_id;
 return jsonb_build_object('id', v_id, 'existing', false);
end $$;

-- A drafted row keeps its claim token so a retried HTTP call from the same run
-- reads back the accepted draft instead of authoring a second one. The null
-- lease is what ends ownership; the token is only an identity.
create function public.finish_journal_editorial_assignment(
 p_id uuid, p_token uuid, p_state text, p_code text, p_package jsonb, p_slug text, p_title text)
returns text language plpgsql security invoker set search_path = '' as $$
declare final_state text;
begin
 if p_state not in ('drafted','queued','blocked') then raise exception 'Invalid assignment outcome'; end if;
 if p_code is not null and p_code !~ '^[A-Z_]{1,80}$' then raise exception 'Invalid assignment code'; end if;
 if p_state = 'drafted' then
  if p_package is null or p_slug is null then raise exception 'Draft requires a package and a slug'; end if;
  select a.state into final_state from public.journal_editorial_assignments a
  where a.id = p_id and a.claim_token = p_token and a.state = 'drafted';
  if final_state is not null then return final_state; end if;
  if exists (select 1 from public.blog_posts b where b.slug = p_slug)
   or exists (select 1 from public.journal_editorial_assignments a
    where a.slug = p_slug and a.id <> p_id and a.state in ('drafted','scheduled','published')) then
   return 'SLUG_TAKEN';
  end if;
  update public.journal_editorial_assignments set
   state = 'drafted', package = p_package, slug = p_slug, title = left(p_title, 200),
   last_code = null, drafted_at = now(), lease_until = null, next_attempt_at = null, updated_at = now()
  where id = p_id and claim_token = p_token and state = 'authoring' and lease_until > now()
  returning state into final_state;
  return final_state;
 end if;
 update public.journal_editorial_assignments set
  state = case when p_state = 'blocked' or attempts >= 3 then 'blocked' else 'queued' end,
  last_code = case when p_state = 'queued' and attempts >= 3 then 'ATTEMPTS_EXHAUSTED' else p_code end,
  claim_token = null, claimed_by = null, lease_until = null,
  blocked_at = case when p_state = 'blocked' or attempts >= 3 then now() else blocked_at end,
  next_attempt_at = case when p_state = 'queued' and attempts < 3
   then now() + case when p_code in ('EDITOR_REJECTED','SUBMISSIONS_EXHAUSTED') then interval '6 hours' else interval '2 hours' end
   else null end,
  updated_at = now()
 where id = p_id and claim_token = p_token and state = 'authoring' and lease_until > now()
 returning state into final_state;
 return final_state;
end $$;

-- Worker-scoped: a drafted row holds no lease, so the hourly worker moves it by
-- row state. A scheduled row always carries its preview and launch time.
create function public.schedule_journal_editorial_assignment(p_id uuid, p_preview jsonb, p_publish_at timestamptz)
returns text language plpgsql security invoker set search_path = '' as $$
declare final_state text;
begin
 if p_preview is null or p_publish_at is null then raise exception 'Schedule requires a preview and a launch time'; end if;
 update public.journal_editorial_assignments set
  state = 'scheduled', preview = p_preview, publish_at = p_publish_at,
  scheduled_at = now(), updated_at = now()
 where id = p_id and state = 'drafted'
 returning state into final_state;
 return final_state;
end $$;

create function public.annotate_journal_editorial_assignment(p_id uuid, p_detail jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
 if octet_length(p_detail::text) > 20000 then raise exception 'Annotation too large'; end if;
 update public.journal_editorial_assignments set
  attempt_log = case when jsonb_array_length(attempt_log) < 40 then attempt_log || jsonb_build_array(p_detail) else attempt_log end,
  updated_at = now()
 where id = p_id and state in ('drafted','scheduled','published','blocked','cancelled');
 return found;
end $$;

create function public.block_journal_editorial_assignment(p_id uuid, p_code text)
returns text language plpgsql security invoker set search_path = '' as $$
declare final_state text;
begin
 if p_code is null or p_code !~ '^[A-Z_]{1,80}$' then raise exception 'Invalid assignment code'; end if;
 update public.journal_editorial_assignments set
  state = 'blocked', last_code = p_code, blocked_at = now(), claim_token = null,
  lease_until = null, claimed_by = null, next_attempt_at = null, updated_at = now()
 where id = p_id and state in ('drafted','scheduled')
 returning state into final_state;
 return final_state;
end $$;

-- The only writer of blog_posts in this pipeline. Row-locked on the settings
-- singleton, so two workers (or a worker and an operator) can never publish
-- twice. A manual publish skips the clock and the mode, and may override
-- "another weekly post is already live" because a person chose to; it never
-- skips the slug or freshness checks.
create function public.publish_journal_editorial_assignment(p_id uuid, p_manual boolean, p_actor text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 s public.journal_editorial_settings;
 a public.journal_editorial_assignments;
 v_article jsonb;
 v_blog uuid;
 v_override boolean;
begin
 select * into strict s from public.journal_editorial_settings where id for update;
 select * into a from public.journal_editorial_assignments where id = p_id for update;
 if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
 if a.state = 'published' then
  return jsonb_build_object('state', 'published', 'blog_id', a.blog_id, 'replay', true);
 end if;
 v_override := coalesce(p_manual, false) and a.state = 'blocked' and a.last_code = 'WEEKLY_ALREADY_LIVE';
 if a.state <> 'scheduled' and not v_override then
  return jsonb_build_object('code', 'NOT_SCHEDULED', 'state', a.state);
 end if;
 if not coalesce(p_manual, false) then
  if s.mode <> 'publish' or a.mode is distinct from 'publish' then return jsonb_build_object('code', 'HELD'); end if;
  if a.publish_at > now() then return jsonb_build_object('code', 'NOT_DUE'); end if;
 end if;
 if a.package is null or a.slug is null or a.preview is null then
  update public.journal_editorial_assignments set state = 'blocked', last_code = 'PACKAGE_MISSING', blocked_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('code', 'PACKAGE_MISSING');
 end if;
 if a.drafted_at < now() - interval '8 days' then
  update public.journal_editorial_assignments set state = 'blocked', last_code = 'STALE_DRAFT', blocked_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('code', 'STALE_DRAFT');
 end if;
 if exists (select 1 from public.blog_posts b where b.slug = a.slug) then
  update public.journal_editorial_assignments set state = 'blocked', last_code = 'SLUG_TAKEN', blocked_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('code', 'SLUG_TAKEN');
 end if;
 if not v_override and exists (
  select 1 from public.blog_posts b
  where b.source = 'weekly' and b.is_live and b.published_at > now() - interval '5 days'
 ) then
  update public.journal_editorial_assignments set state = 'blocked', last_code = 'WEEKLY_ALREADY_LIVE', blocked_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('code', 'WEEKLY_ALREADY_LIVE');
 end if;
 v_article := a.package->'article';
 insert into public.blog_posts (
  title, subtitle, slug, author, content, summary, teaser, meta_title, thumbnail_url,
  category_id, is_live, word_count, faqs, published_at, email_content, source
 ) values (
  v_article->>'title', v_article->>'subtitle', a.slug, s.byline, a.package->>'html',
  v_article->>'summary', v_article->>'teaser', v_article->>'meta_title', a.preview->>'url',
  (a.package->>'category_id')::uuid, true, (a.package->>'word_count')::integer,
  coalesce(v_article->'faqs', '[]'::jsonb), now(), v_article->>'email_content', 'weekly'
 ) returning id into v_blog;
 update public.journal_editorial_assignments set
  state = 'published', blog_id = v_blog, published_at = now(), last_code = null,
  attempt_log = case when jsonb_array_length(attempt_log) < 40 then attempt_log || jsonb_build_array(jsonb_build_object(
   'event', 'published', 'manual', coalesce(p_manual, false), 'actor', left(coalesce(p_actor, ''), 200), 'at', now()))
   else attempt_log end,
  updated_at = now()
 where id = p_id;
 return jsonb_build_object('state', 'published', 'blog_id', v_blog);
end $$;

create function public.cancel_journal_editorial_assignment(p_id uuid, p_actor text)
returns text language plpgsql security invoker set search_path = '' as $$
declare final_state text;
begin
 update public.journal_editorial_assignments set
  state = 'cancelled', cancelled_at = now(), cancelled_by = left(coalesce(p_actor, ''), 200),
  claim_token = null, lease_until = null, claimed_by = null, next_attempt_at = null, updated_at = now()
 where id = p_id and state in ('queued','authoring','drafted','scheduled','blocked')
 returning state into final_state;
 return final_state;
end $$;

-- "Write another": a stopped or blocked slot goes back to the writer with
-- fresh attempts, but only while its slot can still be met.
create function public.requeue_journal_editorial_assignment(p_id uuid, p_actor text)
returns text language plpgsql security invoker set search_path = '' as $$
declare s public.journal_editorial_settings; final_state text;
begin
 select * into strict s from public.journal_editorial_settings where id;
 update public.journal_editorial_assignments set
  state = 'queued', attempts = 0, submissions = 0, next_attempt_at = null, last_code = null,
  slug = null, title = null, package = null, preview = null, publish_at = null,
  claim_token = null, lease_until = null, claimed_by = null, notified_state = null,
  attempt_log = case when jsonb_array_length(attempt_log) < 40 then attempt_log || jsonb_build_array(jsonb_build_object(
   'event', 'requeued', 'actor', left(coalesce(p_actor, ''), 200), 'from', state, 'at', now()))
   else attempt_log end,
  updated_at = now()
 where id = p_id and state in ('cancelled','blocked')
  and slot_at + make_interval(hours => s.slot_grace_hours) > now()
 returning state into final_state;
 return final_state;
end $$;

-- One transaction per rail item: resolve what the new state supersedes, insert
-- the new item (a replay collides with the open dedupe index and is ignored),
-- and record that this state was delivered.
create function public.deliver_journal_editorial_notification(
 p_id uuid, p_state text, p_user_id text, p_company_id text, p_title text, p_body text,
 p_persistent boolean, p_action_url text, p_action_label text, p_dedupe_key text, p_resolve_prefix text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
 if coalesce(p_user_id, '') = '' or coalesce(p_company_id, '') = '' then return false; end if;
 perform 1 from public.journal_editorial_assignments where id = p_id and state = p_state for update;
 if not found then return false; end if;
 if p_resolve_prefix is not null then
  update public.notifications set is_read = true, resolved_at = now()
  where user_id = p_user_id and company_id = p_company_id and type = 'journal_editorial'
   and dedupe_key like p_resolve_prefix || '%' and is_read = false and resolved_at is null;
 end if;
 if p_title is not null then
  insert into public.notifications (user_id, company_id, type, title, body, is_read, persistent, action_url, action_label, dedupe_key)
  values (p_user_id, p_company_id, 'journal_editorial', p_title, p_body, false, coalesce(p_persistent, false), p_action_url, p_action_label, p_dedupe_key)
  on conflict do nothing;
 end if;
 update public.journal_editorial_assignments set notified_state = p_state where id = p_id;
 return true;
end $$;

-- One persistent alarm per Vancouver day when a slot is close and nothing has
-- been drafted. Silence looks exactly like success, so it gets its own alarm.
create function public.check_journal_editorial_authoring(
 p_user_id text, p_company_id text, p_title text, p_body text, p_action_url text, p_action_label text, p_hours integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare s public.journal_editorial_settings; v_today date;
begin
 if coalesce(p_user_id, '') = '' or coalesce(p_company_id, '') = '' or coalesce(p_hours, 0) < 1 then return false; end if;
 select * into strict s from public.journal_editorial_settings where id for update;
 v_today := (now() at time zone 'Etc/GMT+7')::date;
 if s.authoring_stall_notified_on is not distinct from v_today then return false; end if;
 if not exists (
  select 1 from public.journal_editorial_assignments
  where state in ('queued','authoring') and slot_at - make_interval(hours => p_hours) <= now()
   and slot_at + make_interval(hours => s.slot_grace_hours) > now()
 ) then return false; end if;
 insert into public.notifications (user_id, company_id, type, title, body, is_read, persistent, action_url, action_label, dedupe_key)
 values (p_user_id, p_company_id, 'journal_editorial', p_title, p_body, false, true, p_action_url, p_action_label,
  'journal:writer-stalled:' || v_today::text)
 on conflict do nothing;
 update public.journal_editorial_settings set authoring_stall_notified_on = v_today where id;
 return true;
end $$;

-- The clearing path for the alarm above: once no slot is at risk, every open
-- stall item resolves.
create function public.resolve_journal_editorial_stall(p_user_id text, p_company_id text, p_hours integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare s public.journal_editorial_settings; affected integer;
begin
 if coalesce(p_user_id, '') = '' or coalesce(p_company_id, '') = '' then return 0; end if;
 select * into strict s from public.journal_editorial_settings where id;
 if exists (
  select 1 from public.journal_editorial_assignments
  where state in ('queued','authoring') and slot_at - make_interval(hours => p_hours) <= now()
   and slot_at + make_interval(hours => s.slot_grace_hours) > now()
 ) then return 0; end if;
 update public.notifications set is_read = true, resolved_at = now()
 where user_id = p_user_id and company_id = p_company_id and type = 'journal_editorial'
  and dedupe_key like 'journal:writer-stalled:%' and is_read = false and resolved_at is null;
 get diagnostics affected = row_count;
 return affected;
end $$;

-- At most once: a newsletter claim is never retaken automatically. A send that
-- dies midway stays visible as 'sending' for a person instead of mailing twice.
create function public.claim_journal_editorial_newsletter(p_id uuid, p_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
 update public.journal_editorial_assignments set
  newsletter_state = 'sending', newsletter_token = p_token, newsletter_at = now(), updated_at = now()
 where id = p_id and state = 'published' and newsletter_state is null and p_token is not null;
 return found;
end $$;

create function public.finish_journal_editorial_newsletter(p_id uuid, p_token uuid, p_state text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
 if p_state not in ('sent','skipped') then raise exception 'Invalid newsletter outcome'; end if;
 update public.journal_editorial_assignments set
  newsletter_state = p_state, newsletter_at = now(), updated_at = now()
 where id = p_id and newsletter_state = 'sending' and newsletter_token = p_token;
 return found;
end $$;

revoke all on function
 public.discover_journal_editorial_assignment(timestamptz),
 public.recover_journal_editorial_assignments(),
 public.claim_journal_editorial_assignment(uuid, text),
 public.record_journal_editorial_attempt(uuid, uuid, jsonb),
 public.store_journal_editorial_source(uuid, uuid, jsonb),
 public.finish_journal_editorial_assignment(uuid, uuid, text, text, jsonb, text, text),
 public.schedule_journal_editorial_assignment(uuid, jsonb, timestamptz),
 public.annotate_journal_editorial_assignment(uuid, jsonb),
 public.block_journal_editorial_assignment(uuid, text),
 public.publish_journal_editorial_assignment(uuid, boolean, text),
 public.cancel_journal_editorial_assignment(uuid, text),
 public.requeue_journal_editorial_assignment(uuid, text),
 public.deliver_journal_editorial_notification(uuid, text, text, text, text, text, boolean, text, text, text, text),
 public.check_journal_editorial_authoring(text, text, text, text, text, text, integer),
 public.resolve_journal_editorial_stall(text, text, integer),
 public.claim_journal_editorial_newsletter(uuid, uuid),
 public.finish_journal_editorial_newsletter(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function
 public.discover_journal_editorial_assignment(timestamptz),
 public.recover_journal_editorial_assignments(),
 public.claim_journal_editorial_assignment(uuid, text),
 public.record_journal_editorial_attempt(uuid, uuid, jsonb),
 public.store_journal_editorial_source(uuid, uuid, jsonb),
 public.finish_journal_editorial_assignment(uuid, uuid, text, text, jsonb, text, text),
 public.schedule_journal_editorial_assignment(uuid, jsonb, timestamptz),
 public.annotate_journal_editorial_assignment(uuid, jsonb),
 public.block_journal_editorial_assignment(uuid, text),
 public.publish_journal_editorial_assignment(uuid, boolean, text),
 public.cancel_journal_editorial_assignment(uuid, text),
 public.requeue_journal_editorial_assignment(uuid, text),
 public.deliver_journal_editorial_notification(uuid, text, text, text, text, text, boolean, text, text, text, text),
 public.check_journal_editorial_authoring(text, text, text, text, text, text, integer),
 public.resolve_journal_editorial_stall(text, text, integer),
 public.claim_journal_editorial_newsletter(uuid, uuid),
 public.finish_journal_editorial_newsletter(uuid, uuid, text)
to service_role;
