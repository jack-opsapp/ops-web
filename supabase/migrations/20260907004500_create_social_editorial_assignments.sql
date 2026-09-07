-- Durable per-article editorial ledger.
--
-- The date-keyed social_editorial_runs slot model could only ever hold one
-- adaptation per calendar day, so a burst of published articles silently lost
-- coverage and a retry looked identical to a skip. This replaces the slot with
-- an assignment: one row per published blog, plus one row per recurring day,
-- each carrying its own state, attempts, package and block reason forever.
--
-- Additive. The only existing objects touched are the two functions replaced
-- at the bottom of the file, both supersets of their previous behaviour.
alter table public.social_editorial_settings
 add column discovery_since timestamptz not null default now(),
 add column delivery_gap_minutes integer not null default 1200 check(delivery_gap_minutes between 60 and 10080),
 add column authoring_lease_minutes integer not null default 40 check(authoring_lease_minutes between 10 and 120),
 add column authoring_heartbeat_at timestamptz,
 add column authoring_stall_notified_on date;

create table public.social_editorial_assignments (
 id uuid primary key default gen_random_uuid(),
 identity text not null unique check(identity ~ '^(blog:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(protocol|product|rotation):[0-9]{4}-[0-9]{2}-[0-9]{2})$'),
 kind text not null check(kind in ('blog','protocol','product','rotation')),
 blog_id uuid,
 slot_date date,
 mode text check(mode in ('prepare','publish')),
 state text not null default 'queued' check(state in ('queued','authoring','drafted','prepared','submitted','blocked')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 submissions integer not null default 0 check(submissions between 0 and 3),
 claim_token uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz,
 claimed_by text,
 source_id uuid,
 source_snapshot jsonb,
 brief_version text,
 guide_sha256 text,
 package jsonb,
 preview jsonb,
 attempt_log jsonb not null default '[]'::jsonb,
 post_id uuid references public.social_posts(id),
 last_code text check(last_code ~ '^[A-Z_]{1,80}$'),
 drafted_at timestamptz,
 prepared_at timestamptz,
 submitted_at timestamptz,
 blocked_at timestamptz,
 notified_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((kind='blog') = (blog_id is not null)),
 check((kind<>'blog') = (slot_date is not null))
);
create index social_editorial_assignments_queue_idx on public.social_editorial_assignments (state, next_attempt_at, created_at);
create index social_editorial_assignments_blog_idx on public.social_editorial_assignments (blog_id) where blog_id is not null;

alter table public.social_editorial_assignments enable row level security;
revoke all on public.social_editorial_assignments from public, anon, authenticated;
grant select,insert,update,delete on public.social_editorial_assignments to service_role;

-- Discovery is durable tracking, not authoring: an off-mode account still
-- records that an article was published so nothing is lost when it turns on.
create function public.discover_social_editorial_assignments(p_local_date date,p_weekday text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.social_editorial_settings; v_blogs integer:=0; v_recurring integer:=0; v_kind text;
begin
 select * into strict s from public.social_editorial_settings where id for update;
 with fresh as (
  select b.id from public.blog_posts b
  where b.is_live and b.published_at is not null
   and b.published_at > s.discovery_since
   and b.published_at <= now()
   and b.published_at >= now()-interval '30 days'
   and not exists(select 1 from public.social_editorial_assignments a where a.blog_id=b.id)
  order by b.published_at limit 50
 ), inserted as (
  insert into public.social_editorial_assignments(identity,kind,blog_id)
  select 'blog:'||f.id::text,'blog',f.id from fresh f
  on conflict (identity) do nothing returning 1
 ) select count(*) into v_blogs from inserted;
 v_kind := case p_weekday when 'Tue' then 'protocol' when 'Wed' then 'product' when 'Fri' then 'rotation' else null end;
 if v_kind is not null then
  insert into public.social_editorial_assignments(identity,kind,slot_date)
  values(v_kind||':'||p_local_date::text,v_kind,p_local_date) on conflict (identity) do nothing;
  get diagnostics v_recurring = row_count;
 end if;
 return jsonb_build_object('blogs',v_blogs,'recurring',v_recurring);
end $$;

-- An abandoned lease returns the work to the queue with its attempt already
-- spent, so a routine that dies mid-draft can never loop forever.
create function public.recover_social_editorial_assignments()
returns integer language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 update public.social_editorial_assignments set
  state=case when attempts>=3 then 'blocked' else 'queued' end,
  last_code=case when attempts>=3 then 'ATTEMPTS_EXHAUSTED' else 'LEASE_EXPIRED' end,
  blocked_at=case when attempts>=3 then now() else blocked_at end,
  next_attempt_at=case when attempts>=3 then null else now() end,
  claim_token=null,lease_until=null,claimed_by=null,updated_at=now()
 where state='authoring' and (lease_until is null or lease_until<=now());
 get diagnostics affected=row_count;
 return affected;
end $$;

-- The singleton settings row serializes competing routines: two workers racing
-- for the same assignment queue behind this lock and exactly one wins the row.
create function public.claim_social_editorial_assignment(p_token uuid,p_worker text)
returns setof public.social_editorial_assignments language plpgsql security invoker set search_path='' as $$
declare s public.social_editorial_settings; v_id uuid;
begin
 select * into strict s from public.social_editorial_settings where id for update;
 update public.social_editorial_settings set authoring_heartbeat_at=now() where id;
 perform public.recover_social_editorial_assignments();
 if s.mode='off' or p_token is null or coalesce(p_worker,'')='' then return; end if;
 select a.id into v_id from public.social_editorial_assignments a
 where a.state='queued' and a.attempts<3 and (a.next_attempt_at is null or a.next_attempt_at<=now())
 order by a.created_at,a.id for update skip locked limit 1;
 if v_id is null then return; end if;
 return query update public.social_editorial_assignments set
  state='authoring',mode=s.mode,attempts=attempts+1,submissions=0,
  claim_token=p_token,claimed_by=p_worker,
  lease_until=now()+make_interval(mins=>s.authoring_lease_minutes),
  next_attempt_at=null,last_code=null,updated_at=now()
 where id=v_id returning *;
end $$;

create function public.checkpoint_social_editorial_assignment(p_id uuid,p_token uuid,p_source jsonb,p_brief_version text,p_guide_sha256 text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.social_editorial_assignments set
  source_snapshot=p_source,source_id=(p_source->>'id')::uuid,
  brief_version=p_brief_version,guide_sha256=p_guide_sha256,updated_at=now()
 where id=p_id and claim_token=p_token and state='authoring' and lease_until>now();
 return found;
end $$;

create function public.record_social_editorial_assignment_attempt(p_id uuid,p_token uuid,p_detail jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if octet_length(p_detail::text)>100000 then raise exception 'Attempt too large'; end if;
 update public.social_editorial_assignments set
  attempt_log=attempt_log||jsonb_build_array(p_detail),
  submissions=case when p_detail->>'event'='submission' then least(submissions+1,3) else submissions end,
  updated_at=now()
 where id=p_id and claim_token=p_token and state='authoring' and lease_until>now()
  and jsonb_array_length(attempt_log)<9;
 return found;
end $$;

-- A drafted row keeps its claim token so a retried HTTP call from the same
-- routine reads back the accepted draft instead of authoring a second one.
-- The null lease is what ends ownership; the token is only an identity.
create function public.finish_social_editorial_assignment(p_id uuid,p_token uuid,p_state text,p_code text,p_package jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare final_state text;
begin
 if p_state not in ('drafted','queued','blocked') then raise exception 'Invalid assignment outcome'; end if;
 if p_code is not null and p_code !~ '^[A-Z_]{1,80}$' then raise exception 'Invalid assignment code'; end if;
 if p_state='drafted' then
  update public.social_editorial_assignments set
   state='drafted',package=p_package,last_code=p_code,drafted_at=now(),
   lease_until=null,next_attempt_at=null,updated_at=now()
  where id=p_id and claim_token=p_token and state='authoring' and lease_until>now() and p_package is not null
  returning state into final_state;
  if final_state is null then
   select a.state into final_state from public.social_editorial_assignments a
   where a.id=p_id and a.claim_token=p_token and a.state='drafted';
  end if;
  return final_state;
 end if;
 update public.social_editorial_assignments set
  state=case when p_state='blocked' or attempts>=3 then 'blocked' else 'queued' end,
  last_code=p_code,claim_token=null,claimed_by=null,lease_until=null,
  blocked_at=case when p_state='blocked' or attempts>=3 then now() else blocked_at end,
  next_attempt_at=case when p_state='queued' and attempts<3
   then now()+case when p_code in ('EDITOR_REJECTED','SUBMISSIONS_EXHAUSTED') then interval '6 hours' else interval '2 hours' end
   else null end,
  updated_at=now()
 where id=p_id and claim_token=p_token and state='authoring' and lease_until>now()
 returning state into final_state;
 return final_state;
end $$;

-- Promotion belongs to the cron worker, never to the authoring routine, so it
-- is scoped by state rather than by a claim token.
create function public.promote_social_editorial_assignment(p_id uuid,p_state text,p_code text,p_preview jsonb,p_post_id uuid,p_source jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare final_state text;
begin
 if p_state not in ('prepared','submitted','queued','blocked') then raise exception 'Invalid assignment promotion'; end if;
 if p_code is not null and p_code !~ '^[A-Z_]{1,80}$' then raise exception 'Invalid assignment code'; end if;
 update public.social_editorial_assignments set
  state=p_state,last_code=p_code,
  preview=case when p_state='prepared' then p_preview else preview end,
  package=case when p_state='queued' then null else package end,
  post_id=coalesce(p_post_id,post_id),
  source_snapshot=coalesce(p_source,source_snapshot),
  source_id=coalesce((p_source->>'id')::uuid,source_id),
  prepared_at=case when p_state='prepared' then now() else prepared_at end,
  submitted_at=case when p_state='submitted' then now() else submitted_at end,
  blocked_at=case when p_state='blocked' then now() else blocked_at end,
  next_attempt_at=case when p_state='queued' then now() else null end,
  notified_at=case when p_state in ('prepared','blocked') then null else notified_at end,
  updated_at=now()
 where id=p_id and state='drafted'
  and (p_state<>'prepared' or p_preview is not null)
  and (p_state<>'submitted' or p_post_id is not null)
 returning state into final_state;
 return final_state;
end $$;

-- One persistent notification per Vancouver day when work is queued and the
-- authoring routine has gone quiet. Silence is the failure mode that looks
-- exactly like success, so it gets its own alarm.
create function public.check_social_editorial_authoring(p_user_id text,p_company_id text,p_stale_hours integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare s public.social_editorial_settings; v_today date;
begin
 if coalesce(p_user_id,'')='' or coalesce(p_company_id,'')='' or coalesce(p_stale_hours,0)<1 then return false; end if;
 select * into strict s from public.social_editorial_settings where id for update;
 v_today := (now() at time zone 'Etc/GMT+7')::date;
 if s.authoring_stall_notified_on is not distinct from v_today then return false; end if;
 if s.authoring_heartbeat_at is not null and s.authoring_heartbeat_at > now()-make_interval(hours=>p_stale_hours) then return false; end if;
 if not exists(select 1 from public.social_editorial_assignments
  where state='queued' and created_at <= now()-make_interval(hours=>p_stale_hours)) then return false; end if;
 insert into public.notifications(user_id,company_id,type,title,body,is_read,persistent,action_url,action_label,dedupe_key)
 values(p_user_id,p_company_id,'social_editorial','INSTAGRAM AUTHORING STALLED',
 'Posts are queued and the writer has not checked in for a day.',
 false,true,'/admin/social#cloud-production','VIEW SOCIAL','editorial:authoring-stalled:'||v_today::text);
 update public.social_editorial_settings set authoring_stall_notified_on=v_today where id;
 return true;
end $$;

revoke all on function public.discover_social_editorial_assignments(date,text),
 public.recover_social_editorial_assignments(),
 public.claim_social_editorial_assignment(uuid,text),
 public.checkpoint_social_editorial_assignment(uuid,uuid,jsonb,text,text),
 public.record_social_editorial_assignment_attempt(uuid,uuid,jsonb),
 public.finish_social_editorial_assignment(uuid,uuid,text,text,jsonb),
 public.promote_social_editorial_assignment(uuid,text,text,jsonb,uuid,jsonb),
 public.check_social_editorial_authoring(text,text,integer) from public,anon,authenticated;
grant execute on function public.discover_social_editorial_assignments(date,text),
 public.recover_social_editorial_assignments(),
 public.claim_social_editorial_assignment(uuid,text),
 public.checkpoint_social_editorial_assignment(uuid,uuid,jsonb,text,text),
 public.record_social_editorial_assignment_attempt(uuid,uuid,jsonb),
 public.finish_social_editorial_assignment(uuid,uuid,text,text,jsonb),
 public.promote_social_editorial_assignment(uuid,text,text,jsonb,uuid,jsonb),
 public.check_social_editorial_authoring(text,text,integer) to service_role;

-- Superset of the previous outbox: legacy runs still drain, then assignments.
create or replace function public.notify_social_editorial(p_user_id text,p_company_id text)
returns integer language plpgsql security invoker set search_path='' as $$
declare r public.social_editorial_runs; a public.social_editorial_assignments; delivered integer:=0;
begin
 if coalesce(p_user_id,'')='' or coalesce(p_company_id,'')='' then return 0; end if;
 for r in select * from public.social_editorial_runs where state in ('prepared','failed') and notified_at is null order by slot_date limit 10 for update skip locked loop
  insert into public.notifications(user_id,company_id,type,title,body,is_read,persistent,action_url,action_label,dedupe_key)
  values(p_user_id,p_company_id,'social_editorial',case when r.state='prepared' then 'INSTAGRAM DRAFT READY' else 'INSTAGRAM PREPARATION STOPPED' end,
  case when r.state='prepared' then 'A draft is ready to inspect. It will not publish automatically.' else 'A scheduled post could not be prepared. Open Social to inspect the run.' end,
  false,r.state='failed','/admin/social#cloud-production','VIEW SOCIAL','editorial:'||r.slot_date::text);
  update public.social_editorial_runs set notified_at=now() where slot_date=r.slot_date;
  delivered:=delivered+1;
 end loop;
 for a in select * from public.social_editorial_assignments where state in ('prepared','blocked') and notified_at is null order by created_at,id limit 10 for update skip locked loop
  insert into public.notifications(user_id,company_id,type,title,body,is_read,persistent,action_url,action_label,dedupe_key)
  values(p_user_id,p_company_id,'social_editorial',case when a.state='prepared' then 'INSTAGRAM DRAFT READY' else 'INSTAGRAM POST BLOCKED' end,
  case when a.state='prepared' then 'A carousel is ready to inspect. Nothing publishes until you release it.' else 'A post stopped before it was queued. Open Social for the reason.' end,
  false,a.state='blocked','/admin/social#cloud-production','VIEW SOCIAL','editorial:'||a.identity);
  update public.social_editorial_assignments set notified_at=now() where id=a.id;
  delivered:=delivered+1;
 end loop;
 return delivered;
end $$;

-- The v1 date-keyed handoff is retired: it can no longer queue a post under any
-- setting, so an unmigrated caller fails loudly instead of publishing quietly.
-- v2 keys carry the assignment identity and are checked against it directly.
create or replace function public.guard_cloud_editorial_handoff()
returns trigger language plpgsql security invoker set search_path='' as $$
declare m text; a public.social_editorial_assignments;
begin
 if new.updated_by<>'agent:social' or new.status not in ('rendering','review') then return new; end if;
 if new.idempotency_key like 'cloud-editorial-v1:%' then
  raise exception 'Cloud editorial handoff is disabled' using errcode='42501';
 end if;
 if new.idempotency_key not like 'cloud-editorial-v2:%' then return new; end if;
 select mode into m from public.social_editorial_settings where id for update;
 select * into a from public.social_editorial_assignments
 where identity=substring(new.idempotency_key from 20) for update;
 if m is distinct from 'publish' or a.mode is distinct from 'publish' or a.state is distinct from 'drafted' or a.package is null
 or (a.kind='blog' and not exists(select 1 from public.blog_posts where id=a.blog_id and id::text=new.source_id and is_live)) then
  raise exception 'Cloud editorial handoff is disabled' using errcode='42501';
 end if;
 return new;
end $$;

revoke all on function public.notify_social_editorial(text,text), public.guard_cloud_editorial_handoff() from public,anon,authenticated;
grant execute on function public.notify_social_editorial(text,text), public.guard_cloud_editorial_handoff() to service_role;
