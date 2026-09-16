-- Weekly journal: the topic funnel.
--
-- A weekly post starts from what the trades and the voices around them are
-- talking about, not from a static backlog. OPS reads a fixed watchlist of
-- public feeds (YouTube channels, trade news, leadership writing, an owners'
-- forum) once a day and keeps what it saw, with the engagement numbers each
-- feed publishes. Once a day, not once a week: a trade news feed only lists
-- about a day of stories, so the week is built up read by read.
--
-- The writing routine receives those signals with its claim, picks the week's
-- topic, the angle, the headline and the first sentence, and hands that pitch
-- back to OPS before it writes a word. OPS checks the pitch against the
-- signals it actually observed, keeps it, and gives the run a fresh lease for
-- the writing that follows. The accepted draft carries the pitch, so the
-- operator always sees why this topic and this headline.
--
-- Additive: one table, three settings columns, four assignment columns, four
-- functions. Nothing existing changes.

create table public.journal_trend_signals (
 id uuid primary key default gen_random_uuid(),
 source_key text not null check (source_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(source_key) <= 60),
 sphere text not null check (sphere in ('leadership','business','trades','industry','forum')),
 kind text not null check (kind in ('video','article','thread')),
 item_key text not null check (length(item_key) between 1 and 300),
 url text not null check (url ~ '^https://' and length(url) <= 2048),
 title text not null check (length(title) between 1 and 300),
 summary text check (summary is null or length(summary) <= 600),
 published_at timestamptz not null,
 views bigint check (views is null or views >= 0),
 baseline_views bigint check (baseline_views is null or baseline_views >= 0),
 momentum numeric(10,2) check (momentum is null or momentum >= 0),
 comments integer check (comments is null or comments >= 0),
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 unique (source_key, item_key)
);
create index journal_trend_signals_published_idx on public.journal_trend_signals (published_at desc);

alter table public.journal_trend_signals enable row level security;
revoke all on public.journal_trend_signals from public, anon, authenticated;
grant select, insert, update, delete on public.journal_trend_signals to service_role;

alter table public.journal_editorial_settings
 add column radar_scan_started_at timestamptz,
 add column radar_scanned_at timestamptz,
 add column radar_sources jsonb not null default '[]'::jsonb check (jsonb_typeof(radar_sources) = 'array');

alter table public.journal_editorial_assignments
 add column pitch jsonb check (pitch is null or jsonb_typeof(pitch) = 'object'),
 add column pitch_claim_token uuid,
 add column pitches integer not null default 0 check (pitches between 0 and 3),
 add column pitched_at timestamptz;

-- One scan a day: the caller names the moment the day's read became due
-- (04:00 Vancouver), and a scan already recorded since then answers false.
-- Never while the pipeline is off. A scan that dies leaves its start mark; the
-- next tick may begin again ten minutes later.
create function public.begin_journal_radar_scan(p_due_after timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare s public.journal_editorial_settings;
begin
 if p_due_after is null or p_due_after > now() + interval '1 minute' then
  raise exception 'Radar due time must be a moment that has passed';
 end if;
 select * into strict s from public.journal_editorial_settings where id for update;
 if s.mode = 'off' then return false; end if;
 if s.radar_scanned_at is not null and s.radar_scanned_at >= p_due_after then
  return false;
 end if;
 if s.radar_scan_started_at is not null and s.radar_scan_started_at > now() - interval '10 minutes'
  and (s.radar_scanned_at is null or s.radar_scan_started_at > s.radar_scanned_at) then
  return false;
 end if;
 update public.journal_editorial_settings set radar_scan_started_at = now() where id;
 return true;
end $$;

-- Keeps what one scan saw. A signal seen again refreshes its numbers; nothing
-- older than 45 days is kept. The per-feed outcome replaces the last one, so
-- the Blog hub and the writer always know which feeds answered.
create function public.record_journal_radar_scan(p_signals jsonb, p_sources jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_stored integer := 0; v_pruned integer := 0; v_ok integer; v_total integer;
begin
 if p_signals is null or jsonb_typeof(p_signals) <> 'array' or jsonb_array_length(p_signals) > 1500 then
  raise exception 'Radar signals must be an array of at most 1500 items';
 end if;
 if p_sources is null or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) > 80 then
  raise exception 'Radar sources must be an array of at most 80 items';
 end if;
 insert into public.journal_trend_signals as t (
  source_key, sphere, kind, item_key, url, title, summary, published_at, views, baseline_views, momentum, comments
 )
 -- A feed that repeats an item in one scan keeps its first copy: an upsert may
 -- touch a row only once per statement.
 select distinct on (x.source_key, x.item_key)
  x.source_key, x.sphere, x.kind, x.item_key, x.url, x.title, nullif(x.summary, ''), x.published_at,
  x.views, x.baseline_views, x.momentum, x.comments
 from rows from (jsonb_to_recordset(p_signals) as (
  source_key text, sphere text, kind text, item_key text, url text, title text, summary text,
  published_at timestamptz, views bigint, baseline_views bigint, momentum numeric, comments integer))
  with ordinality as x(source_key, sphere, kind, item_key, url, title, summary, published_at,
  views, baseline_views, momentum, comments, ord)
 order by x.source_key, x.item_key, x.ord
 on conflict (source_key, item_key) do update set
  sphere = excluded.sphere, kind = excluded.kind, url = excluded.url, title = excluded.title,
  summary = excluded.summary, published_at = excluded.published_at, views = excluded.views,
  baseline_views = excluded.baseline_views, momentum = excluded.momentum, comments = excluded.comments,
  last_seen_at = now();
 get diagnostics v_stored = row_count;
 delete from public.journal_trend_signals where published_at < now() - interval '45 days';
 get diagnostics v_pruned = row_count;
 select count(*) filter (where (entry->>'ok')::boolean), count(*) into v_ok, v_total
 from jsonb_array_elements(p_sources) as entry;
 update public.journal_editorial_settings set radar_scanned_at = now(), radar_sources = p_sources where id;
 return jsonb_build_object('stored', v_stored, 'pruned', v_pruned, 'ok', v_ok, 'total', v_total);
end $$;

-- One rail item while fewer than half the feeds answer; a healthy scan clears
-- it. The open-notification dedupe index keeps it to one item.
create function public.notify_journal_radar(
 p_user_id text, p_company_id text, p_degraded boolean, p_title text, p_body text, p_action_url text, p_action_label text)
returns text language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
 if coalesce(p_user_id, '') = '' or coalesce(p_company_id, '') = '' or p_degraded is null then return 'skipped'; end if;
 if p_degraded then
  insert into public.notifications (user_id, company_id, type, title, body, is_read, persistent, action_url, action_label, dedupe_key)
  values (p_user_id, p_company_id, 'journal_editorial', p_title, p_body, false, false, p_action_url, p_action_label, 'journal:radar-degraded')
  on conflict do nothing;
  get diagnostics affected = row_count;
  return case when affected > 0 then 'raised' else 'open' end;
 end if;
 update public.notifications set is_read = true, resolved_at = now()
 where user_id = p_user_id and company_id = p_company_id and type = 'journal_editorial'
  and dedupe_key = 'journal:radar-degraded' and is_read = false and resolved_at is null;
 get diagnostics affected = row_count;
 return case when affected > 0 then 'resolved' else 'clear' end;
end $$;

-- The pitch belongs to the claim that made it. The first pitch of a claim
-- renews the lease, because the writing starts now; a claim may revise its
-- pitch twice more. A new claim's draft never inherits an old claim's pitch.
create function public.pitch_journal_editorial_assignment(p_id uuid, p_token uuid, p_pitch jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.journal_editorial_settings; a public.journal_editorial_assignments; v_lease timestamptz;
begin
 if p_pitch is null or jsonb_typeof(p_pitch) <> 'object' then raise exception 'Pitch must be an object'; end if;
 if octet_length(p_pitch::text) > 60000 then raise exception 'Pitch too large'; end if;
 select * into strict s from public.journal_editorial_settings where id;
 select * into a from public.journal_editorial_assignments where id = p_id for update;
 if not found or a.claim_token is distinct from p_token or a.state <> 'authoring' or a.lease_until <= now() then
  return jsonb_build_object('code', 'CLAIM_NOT_OWNED');
 end if;
 if a.pitch_claim_token is not distinct from p_token and a.pitches >= 3 then
  return jsonb_build_object('code', 'PITCH_LIMIT');
 end if;
 update public.journal_editorial_assignments set
  pitch = p_pitch, pitched_at = now(),
  pitches = case when pitch_claim_token is not distinct from p_token then pitches + 1 else 1 end,
  lease_until = case when pitch_claim_token is distinct from p_token
   then greatest(lease_until, now() + make_interval(mins => s.authoring_lease_minutes)) else lease_until end,
  pitch_claim_token = p_token,
  attempt_log = case when jsonb_array_length(attempt_log) < 40 then attempt_log || jsonb_build_array(jsonb_build_object(
   'event', 'pitched', 'topic', left(coalesce(p_pitch->>'topic', ''), 200), 'at', now()))
   else attempt_log end,
  updated_at = now()
 where id = p_id
 returning lease_until into v_lease;
 return jsonb_build_object('state', 'pitched', 'lease_until', v_lease);
end $$;

revoke all on function
 public.begin_journal_radar_scan(timestamptz),
 public.record_journal_radar_scan(jsonb, jsonb),
 public.notify_journal_radar(text, text, boolean, text, text, text, text),
 public.pitch_journal_editorial_assignment(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function
 public.begin_journal_radar_scan(timestamptz),
 public.record_journal_radar_scan(jsonb, jsonb),
 public.notify_journal_radar(text, text, boolean, text, text, text, text),
 public.pitch_journal_editorial_assignment(uuid, uuid, jsonb)
to service_role;
