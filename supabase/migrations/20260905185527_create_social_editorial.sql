-- Cloud editorial control is deliberately off until explicitly activated.
create table public.social_editorial_settings (
 id boolean primary key default true check(id),
 mode text not null default 'off' check(mode in ('off','prepare','publish')),
 monthly_budget_usd numeric(8,2) not null default 20 check(monthly_budget_usd between 0 and 20)
);
insert into public.social_editorial_settings(id) values(true);
create table public.social_editorial_runs (
 slot_date date primary key,
 kind text not null check(kind in ('blog','protocol','product','rotation')),
 mode text not null check(mode in ('prepare','publish')),
 state text not null default 'working' check(state in ('working','retry','prepared','submitted','skipped','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 reserved_usd numeric(8,2) not null default 0 check(reserved_usd between 0 and 1.50),
 claim_token uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz,
 source_id uuid,
 source_snapshot jsonb,
 attempt_log jsonb not null default '[]'::jsonb,
 package jsonb,
 post_id uuid references public.social_posts(id),
 last_code text check(last_code ~ '^[A-Z_]{1,80}$'),
 notified_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.social_editorial_settings enable row level security;
alter table public.social_editorial_runs enable row level security;
revoke all on public.social_editorial_settings, public.social_editorial_runs from public, anon, authenticated;
grant select,insert,update,delete on public.social_editorial_settings, public.social_editorial_runs to service_role;

-- The singleton row serializes budget reservation and overlapping cron deliveries.
create function public.claim_social_editorial(p_date date,p_kind text,p_token uuid)
returns setof public.social_editorial_runs language plpgsql security invoker set search_path='' as $$
declare s public.social_editorial_settings; r public.social_editorial_runs; spent numeric;
begin
 select * into strict s from public.social_editorial_settings where id for update;
 update public.social_editorial_runs set state='failed',last_code='SLOT_EXPIRED',claim_token=null,lease_until=null,updated_at=now()
 where slot_date < (now() at time zone 'Etc/GMT+7')::date and state in ('working','retry');
 if s.mode='off' or p_date is distinct from (now() at time zone 'Etc/GMT+7')::date or p_token is null then return; end if;
 insert into public.social_editorial_runs(slot_date,kind,mode) values(p_date,p_kind,s.mode) on conflict do nothing;
 select * into strict r from public.social_editorial_runs where slot_date=p_date for update;
 if r.state in ('prepared','submitted','skipped','failed') or r.lease_until>now() or r.next_attempt_at>now() then return; end if;
 if r.mode<>s.mode then
  update public.social_editorial_runs set state='skipped',last_code='MODE_CHANGED',claim_token=null,lease_until=null,updated_at=now() where slot_date=p_date;
  return;
 end if;
 select coalesce(sum(reserved_usd),0) into spent from public.social_editorial_runs where slot_date>=date_trunc('month',p_date)::date and slot_date<(date_trunc('month',p_date)+interval '1 month')::date;
 if r.attempts>=3 or spent+0.50>s.monthly_budget_usd then
  update public.social_editorial_runs set state='failed',last_code=case when r.attempts>=3 then 'ATTEMPTS_EXHAUSTED' else 'BUDGET_EXHAUSTED' end,claim_token=null,lease_until=null,updated_at=now() where slot_date=p_date;
  return;
 end if;
 return query update public.social_editorial_runs set state='working',attempts=attempts+1,reserved_usd=reserved_usd+0.50,claim_token=p_token,lease_until=now()+interval '6 minutes',next_attempt_at=null,updated_at=now() where slot_date=p_date returning *;
end $$;

create function public.checkpoint_social_editorial(p_date date,p_token uuid,p_source jsonb,p_package jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.social_editorial_runs set source_id=(p_source->>'id')::uuid,source_snapshot=p_source,package=p_package,updated_at=now()
 where slot_date=p_date and claim_token=p_token and state='working' and lease_until>now();
 return found;
end $$;

create function public.finish_social_editorial(p_date date,p_token uuid,p_state text,p_code text,p_post_id uuid default null)
returns text language plpgsql security invoker set search_path='' as $$
declare final_state text;
begin
 if p_state not in ('retry','prepared','submitted','skipped','failed') then raise exception 'Invalid editorial state'; end if;
 update public.social_editorial_runs set
 state=case when p_state='retry' and attempts>=3 then 'failed' else p_state end,
 last_code=p_code,post_id=p_post_id,claim_token=null,lease_until=null,
 next_attempt_at=case when p_state='retry' then now()+interval '15 minutes' else null end,updated_at=now()
 where slot_date=p_date and claim_token=p_token and state='working' and lease_until>now()
 and (p_state<>'prepared' or package is not null)
 and (p_state<>'submitted' or (package is not null and mode='publish' and p_post_id is not null)) returning state into final_state;
 return final_state;
end $$;

revoke all on function public.claim_social_editorial(date,text,uuid) from public,anon,authenticated;
revoke all on function public.checkpoint_social_editorial(date,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.finish_social_editorial(date,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_social_editorial(date,text,uuid) to service_role;
grant execute on function public.checkpoint_social_editorial(date,uuid,jsonb,jsonb) to service_role;
grant execute on function public.finish_social_editorial(date,uuid,text,text,uuid) to service_role;

create function public.recover_social_editorial()
returns integer language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 update public.social_editorial_runs set state='failed',last_code='SLOT_EXPIRED',claim_token=null,lease_until=null,updated_at=now()
 where state in ('working','retry') and (lease_until is null or lease_until<=now()) and
 (slot_date<(now() at time zone 'Etc/GMT+7')::date or (slot_date=(now() at time zone 'Etc/GMT+7')::date and extract(hour from now() at time zone 'Etc/GMT+7')>=20) or attempts>=3);
 get diagnostics affected=row_count;
 return affected;
end $$;

-- Durable notification outbox: row locks make insertion and acknowledgement atomic.
create function public.notify_social_editorial(p_user_id text,p_company_id text)
returns integer language plpgsql security invoker set search_path='' as $$
declare r public.social_editorial_runs; delivered integer:=0;
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
 return delivered;
end $$;

-- Serialize the final automatic queue transition with the off/prepare/publish control.
-- Already queued posts remain under the existing ten-minute veto and STOP action.
create function public.guard_cloud_editorial_handoff()
returns trigger language plpgsql security invoker set search_path='' as $$
declare m text; r public.social_editorial_runs;
begin
 if new.idempotency_key not like 'cloud-editorial-v1:%' or new.updated_by<>'agent:social' or new.status not in ('rendering','review') then return new; end if;
 select mode into m from public.social_editorial_settings where id for update;
 select * into r from public.social_editorial_runs where 'cloud-editorial-v1:'||slot_date::text=new.idempotency_key for update;
 if m is distinct from 'publish' or r.mode is distinct from 'publish' or r.state is distinct from 'working' or r.lease_until is null or r.lease_until<=now() or r.package is null
 or r.slot_date<>(now() at time zone 'Etc/GMT+7')::date or extract(hour from now() at time zone 'Etc/GMT+7')>=20
 or not exists(select 1 from public.blog_posts where id::text=new.source_id and id=r.source_id and is_live) then
  raise exception 'Cloud editorial handoff is disabled' using errcode='42501';
 end if;
 return new;
end $$;
create trigger guard_cloud_editorial_handoff before insert or update of status on public.social_posts for each row execute function public.guard_cloud_editorial_handoff();
revoke all on function public.recover_social_editorial(), public.notify_social_editorial(text,text), public.guard_cloud_editorial_handoff() from public,anon,authenticated;
grant execute on function public.recover_social_editorial(), public.notify_social_editorial(text,text), public.guard_cloud_editorial_handoff() to service_role;

create function public.record_social_editorial_attempt(p_date date,p_token uuid,p_detail jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if octet_length(p_detail::text)>100000 then raise exception 'Attempt too large'; end if;
 update public.social_editorial_runs set attempt_log=attempt_log||jsonb_build_array(p_detail),updated_at=now()
 where slot_date=p_date and claim_token=p_token and state='working' and lease_until>now() and jsonb_array_length(attempt_log)<3;
 return found;
end $$;
revoke all on function public.record_social_editorial_attempt(date,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_social_editorial_attempt(date,uuid,jsonb) to service_role;
