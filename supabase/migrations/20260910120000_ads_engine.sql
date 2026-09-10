-- Google Ads engine, phase 3: the proposal ledger.
--
-- A Claude Cloud Routine claims one run at a time over a lease, files typed
-- proposals, and releases. OPS validates every proposal deterministically,
-- Jackson approves on the admin ads page, and OPS applies to Google with
-- validateOnly first. Proposals never enter agent_actions (company-scoped).
--
-- Every table is service-role only: RLS enabled, client grants revoked, no
-- policy. Every function is security invoker with an empty search_path and is
-- executable by service_role alone. The file is additive and self-contained:
-- it references only public.notifications, so it applies before or after the
-- phase 1 warehouse migrations without ordering.

-- ─── Settings (singleton) ───────────────────────────────────────────────────

create function public.ads_engine_modes_valid(p_modes jsonb)
returns boolean language sql immutable set search_path='' as $$
  select p_modes is not null
    and jsonb_typeof(p_modes)='object'
    and (select count(*) from jsonb_object_keys(p_modes))=11
    and not exists (
      select 1 from jsonb_each_text(p_modes)
      where key not in ('add_negatives','pause_keyword','add_keywords','create_rsa_challenger','promote_challenger','pause_ad','adjust_budget','adjust_cpc_cap','set_bidding_strategy','add_ad_group','observation')
         or value not in ('propose','auto','off')
    );
$$;

create table public.ads_engine_settings (
 id boolean primary key default true check(id),
 modes jsonb not null default '{"add_negatives":"propose","pause_keyword":"propose","add_keywords":"propose","create_rsa_challenger":"propose","promote_challenger":"propose","pause_ad":"propose","adjust_budget":"propose","adjust_cpc_cap":"propose","set_bidding_strategy":"propose","add_ad_group":"propose","observation":"propose"}'::jsonb,
 monthly_cap numeric(12,2) not null default 1500 check(monthly_cap>0),
 daily_cap numeric(12,2) not null default 60 check(daily_cap>0),
 max_budget_change_pct integer not null default 15 check(max_budget_change_pct between 1 and 50),
 budget_cooldown_days integer not null default 14 check(budget_cooldown_days between 1 and 90),
 max_structural_per_run integer not null default 3 check(max_structural_per_run between 0 and 20),
 lease_minutes integer not null default 40 check(lease_minutes between 10 and 120),
 stall_hours integer not null default 50 check(stall_hours between 6 and 240),
 -- $1,500 a month buys roughly ten trial starts; a keyword that spends three
 -- times this with none is the pause rule's second trigger (spec §5.2).
 target_cost_per_trial numeric(12,2) not null default 150 check(target_cost_per_trial>0),
 heartbeat_at timestamptz,
 stall_notified_on date,
 updated_at timestamptz not null default now(),
 constraint ads_engine_settings_modes_check check(public.ads_engine_modes_valid(modes))
);
insert into public.ads_engine_settings(id) values(true);

-- ─── Runs ───────────────────────────────────────────────────────────────────

create table public.ads_engine_runs (
 id uuid primary key default gen_random_uuid(),
 state text not null default 'claimed' check(state in ('claimed','released','expired')),
 worker text not null,
 claim_token uuid not null,
 lease_until timestamptz not null,
 duties text[] not null default '{}',
 brief_version text,
 summary text,
 outcome text check(outcome in ('done','error','nothing_to_do','brief_unavailable','lease_expired')),
 proposals_accepted integer not null default 0,
 proposals_rejected integer not null default 0,
 submission_counts jsonb not null default '{}'::jsonb,
 submission_log jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(),
 released_at timestamptz,
 updated_at timestamptz not null default now()
);
create index ads_engine_runs_state_idx on public.ads_engine_runs (state, created_at desc);

-- ─── Proposals ──────────────────────────────────────────────────────────────

create table public.ads_proposals (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.ads_engine_runs(id),
 kind text not null check(kind in ('add_negatives','pause_keyword','add_keywords','create_rsa_challenger','promote_challenger','pause_ad','adjust_budget','adjust_cpc_cap','set_bidding_strategy','add_ad_group','observation')),
 -- A normalised key for the entity the proposal acts on, so a second run can
 -- never file the same change twice while the first is still waiting.
 target text not null check(length(target) between 1 and 400),
 submission_index integer not null default 0 check(submission_index>=0),
 payload jsonb not null,
 evidence jsonb not null default '[]'::jsonb,
 rationale text not null default '',
 state text not null default 'proposed' check(state in ('proposed','approved','rejected','applied','failed','expired')),
 mode_at_submit text not null check(mode_at_submit in ('propose','auto')),
 google_validation jsonb,
 reviewed_by text,
 review_notes text,
 reviewed_at timestamptz,
 applied_at timestamptz,
 applied_by text check(applied_by in ('operator','auto')),
 applied_resource_names text[],
 label text,
 error text,
 notified_at timestamptz,
 expires_at timestamptz not null default now()+interval '14 days',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index ads_proposals_state_idx on public.ads_proposals (state, created_at desc);
create index ads_proposals_run_idx on public.ads_proposals (run_id);
create index ads_proposals_target_open_idx on public.ads_proposals (target) where state in ('proposed','approved');

-- ─── Changes (applied proposals with a measured outcome) ────────────────────

create table public.ads_changes (
 id uuid primary key default gen_random_uuid(),
 proposal_id uuid not null references public.ads_proposals(id),
 kind text not null,
 campaign_id text,
 ad_group_id text,
 resource_names text[] not null default '{}',
 before jsonb,
 after jsonb,
 label text,
 applied_at timestamptz not null default now(),
 measure_from date not null,
 measure_to date not null,
 pre_metrics jsonb,
 post_metrics jsonb,
 verdict text not null default 'pending' check(verdict in ('pending','better','worse','flat','no_verdict')),
 verdict_at timestamptz,
 check(measure_to>=measure_from)
);
create index ads_changes_pending_idx on public.ads_changes (measure_to) where verdict='pending';
create index ads_changes_campaign_idx on public.ads_changes (campaign_id, applied_at desc);

-- ─── Tests (control vs challenger ad pairs) ─────────────────────────────────

create table public.ads_tests (
 id uuid primary key default gen_random_uuid(),
 campaign_id text,
 ad_group_id text not null,
 ad_group_name text,
 control_ad_id text not null,
 challenger_ad_id text not null,
 proposal_id uuid references public.ads_proposals(id),
 concluded_proposal_id uuid references public.ads_proposals(id),
 label text,
 started_at timestamptz not null default now(),
 min_days integer not null default 14 check(min_days between 1 and 90),
 min_impressions integer not null default 2000 check(min_impressions>=100),
 max_days integer not null default 56 check(max_days>=min_days),
 state text not null default 'running' check(state in ('running','control_won','challenger_won','no_verdict','cancelled')),
 stats jsonb,
 verdict_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(control_ad_id<>challenger_ad_id)
);
create unique index ads_tests_one_running_per_ad_group on public.ads_tests (ad_group_id) where state='running';

-- ─── Alerts (a durable outbox for the operator rail) ────────────────────────

create table public.ads_engine_alerts (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('ad_disapproved','budget_pacing','apply_failed')),
 dedupe_key text not null unique check(length(dedupe_key) between 12 and 320 and dedupe_key ~ '^ads-engine:[A-Za-z0-9 _:./~·-]+$'),
 title text not null,
 body text not null,
 persistent boolean not null default false,
 action_url text not null default '/admin/google-ads#engine',
 created_at timestamptz not null default now(),
 notified_at timestamptz
);
create index ads_engine_alerts_pending_idx on public.ads_engine_alerts (created_at) where notified_at is null;

-- ─── Grants ─────────────────────────────────────────────────────────────────

alter table public.ads_engine_settings enable row level security;
alter table public.ads_engine_runs enable row level security;
alter table public.ads_proposals enable row level security;
alter table public.ads_changes enable row level security;
alter table public.ads_tests enable row level security;
alter table public.ads_engine_alerts enable row level security;
revoke all on public.ads_engine_settings, public.ads_engine_runs, public.ads_proposals, public.ads_changes, public.ads_tests, public.ads_engine_alerts from public, anon, authenticated;
grant select,insert,update,delete on public.ads_engine_settings, public.ads_engine_runs, public.ads_proposals, public.ads_changes, public.ads_tests, public.ads_engine_alerts to service_role;

-- ─── Claim lease ────────────────────────────────────────────────────────────

-- The singleton settings row serialises competing routines: two workers race
-- behind this lock and exactly one leaves with a live run. An overdue lease is
-- expired first so a routine that died mid-run can never block tomorrow's.
create function public.claim_ads_engine_run(p_token uuid,p_worker text)
returns setof public.ads_engine_runs language plpgsql security invoker set search_path='' as $$
declare s public.ads_engine_settings;
begin
 select * into strict s from public.ads_engine_settings where id for update;
 update public.ads_engine_settings set heartbeat_at=now(),updated_at=now() where id;
 update public.ads_engine_runs set state='expired',outcome='lease_expired',released_at=now(),updated_at=now()
  where state='claimed' and lease_until<=now();
 if p_token is null or coalesce(p_worker,'')='' then return; end if;
 if not exists(select 1 from jsonb_each_text(s.modes) where value<>'off') then return; end if;
 if exists(select 1 from public.ads_engine_runs where state='claimed' and lease_until>now()) then return; end if;
 return query insert into public.ads_engine_runs(worker,claim_token,lease_until)
  values(p_worker,p_token,now()+make_interval(mins=>s.lease_minutes)) returning *;
end $$;

create function public.checkpoint_ads_engine_run(p_id uuid,p_token uuid,p_duties text[],p_brief_version text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.ads_engine_runs set duties=coalesce(p_duties,'{}'),brief_version=p_brief_version,updated_at=now()
 where id=p_id and claim_token=p_token and state='claimed' and lease_until>now();
 return found;
end $$;

-- One budget of submissions per proposal index, so the routine can fix a 422
-- three times and never loop forever; the log keeps the last sixty attempts.
create function public.record_ads_engine_submission(p_id uuid,p_token uuid,p_index integer,p_detail jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 if p_detail is not null and octet_length(p_detail::text)>100000 then raise exception 'Submission detail too large'; end if;
 if p_index is null or p_index<0 then return null; end if;
 update public.ads_engine_runs set
  submission_counts=jsonb_set(submission_counts,array[p_index::text],to_jsonb(coalesce((submission_counts->>p_index::text)::integer,0)+1),true),
  submission_log=case when p_detail is null then submission_log
   else (select coalesce(jsonb_agg(e),'[]'::jsonb) from (select e from jsonb_array_elements(submission_log||jsonb_build_array(p_detail)) with ordinality as t(e,n) order by n desc limit 60) as tail(e)) end,
  updated_at=now()
 where id=p_id and claim_token=p_token and state='claimed' and lease_until>now()
 returning (submission_counts->>p_index::text)::integer into v_count;
 return v_count;
end $$;

create function public.accept_ads_proposal(p_run_id uuid,p_token uuid,p_kind text,p_target text,p_index integer,p_payload jsonb,p_evidence jsonb,p_rationale text,p_mode text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 if not exists(select 1 from public.ads_engine_runs where id=p_run_id and claim_token=p_token and state='claimed' and lease_until>now()) then return null; end if;
 insert into public.ads_proposals(run_id,kind,target,submission_index,payload,evidence,rationale,mode_at_submit)
 values(p_run_id,p_kind,p_target,coalesce(p_index,0),p_payload,coalesce(p_evidence,'[]'::jsonb),coalesce(p_rationale,''),p_mode)
 returning id into v_id;
 update public.ads_engine_runs set proposals_accepted=proposals_accepted+1,updated_at=now() where id=p_run_id;
 return v_id;
end $$;

create function public.release_ads_engine_run(p_id uuid,p_token uuid,p_summary text,p_outcome text)
returns text language plpgsql security invoker set search_path='' as $$
declare final_state text;
begin
 if p_outcome not in ('done','error','nothing_to_do','brief_unavailable') then raise exception 'Invalid run outcome'; end if;
 update public.ads_engine_runs set state='released',outcome=p_outcome,summary=left(coalesce(p_summary,''),20000),released_at=now(),updated_at=now()
 where id=p_id and claim_token=p_token and state='claimed' and lease_until>now()
 returning state into final_state;
 return final_state;
end $$;

-- ─── Proposal lifecycle ─────────────────────────────────────────────────────

create function public.expire_ads_proposals()
returns integer language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 update public.ads_proposals set state='expired',updated_at=now()
 where state='proposed' and expires_at<=now();
 get diagnostics affected=row_count;
 return affected;
end $$;

create function public.review_ads_proposal(p_id uuid,p_decision text,p_reviewer text,p_notes text)
returns text language plpgsql security invoker set search_path='' as $$
declare final_state text;
begin
 if p_decision not in ('approve','reject') then raise exception 'Invalid review decision'; end if;
 update public.ads_proposals set
  state=case when p_decision='approve' then 'approved' else 'rejected' end,
  reviewed_by=p_reviewer,review_notes=left(p_notes,2000),reviewed_at=now(),updated_at=now()
 where id=p_id and state='proposed' and expires_at>now()
 returning state into final_state;
 return final_state;
end $$;

create function public.mark_ads_proposal_applied(p_id uuid,p_state text,p_google_validation jsonb,p_resource_names text[],p_label text,p_error text)
returns text language plpgsql security invoker set search_path='' as $$
declare final_state text;
begin
 if p_state not in ('applied','failed') then raise exception 'Invalid application state'; end if;
 update public.ads_proposals set
  state=p_state,google_validation=coalesce(p_google_validation,google_validation),
  applied_resource_names=case when p_state='applied' then coalesce(p_resource_names,'{}') else applied_resource_names end,
  label=coalesce(p_label,label),error=case when p_state='failed' then left(p_error,4000) else null end,
  applied_at=case when p_state='applied' then now() else applied_at end,
  applied_by=case when p_state='applied' then coalesce(applied_by,case when mode_at_submit='auto' and reviewed_by is null then 'auto' else 'operator' end) else applied_by end,
  updated_at=now()
 where id=p_id and (state='approved' or (state='proposed' and mode_at_submit='auto'))
 returning state into final_state;
 return final_state;
end $$;

-- ─── Operator rail ──────────────────────────────────────────────────────────

-- One READY notification per run while proposals from it still wait, then the
-- alert outbox. Inserts ride the production dedupe indexes with `on conflict
-- do nothing`, so a re-raised alert whose first rail row is still unread is
-- acknowledged rather than crashing the tick.
create function public.notify_ads_engine(p_user_id text,p_company_id text)
returns integer language plpgsql security invoker set search_path='' as $$
declare r record; a public.ads_engine_alerts; delivered integer:=0;
begin
 if coalesce(p_user_id,'')='' or coalesce(p_company_id,'')='' then return 0; end if;
 for r in
  select p.run_id, count(*) filter (where p.state='proposed') as waiting
  from public.ads_proposals p
  where p.state='proposed' and p.notified_at is null
  group by p.run_id order by min(p.created_at) limit 10
 loop
  insert into public.notifications(user_id,company_id,type,title,body,is_read,persistent,action_url,action_label,dedupe_key)
  values(p_user_id,p_company_id,'ads_engine','ADS PROPOSALS READY · '||r.waiting,
   case when r.waiting=1 then 'One proposal is waiting for review. Nothing changes on Google until you approve it.'
        else r.waiting||' proposals are waiting for review. Nothing changes on Google until you approve them.' end,
   false,false,'/admin/google-ads#proposals','VIEW ADS','ads-engine:proposals:'||r.run_id::text)
  on conflict do nothing;
  update public.ads_proposals set notified_at=now() where run_id=r.run_id and notified_at is null;
  delivered:=delivered+1;
 end loop;
 for a in select * from public.ads_engine_alerts where notified_at is null order by created_at,id limit 10 for update skip locked loop
  insert into public.notifications(user_id,company_id,type,title,body,is_read,persistent,action_url,action_label,dedupe_key)
  values(p_user_id,p_company_id,'ads_engine',a.title,a.body,false,a.persistent,a.action_url,'VIEW ADS',a.dedupe_key)
  on conflict do nothing;
  update public.ads_engine_alerts set notified_at=now() where id=a.id;
  delivered:=delivered+1;
 end loop;
 return delivered;
end $$;

-- One persistent alarm per Vancouver day when ads are live and the routine has
-- gone quiet. Whether campaigns are live is the worker's call (it reads the
-- warehouse snapshot); this function only owns the silence rule and the dedupe.
create function public.check_ads_engine_stall(p_user_id text,p_company_id text,p_stale_hours integer,p_campaigns_live boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare s public.ads_engine_settings; v_today date;
begin
 if coalesce(p_user_id,'')='' or coalesce(p_company_id,'')='' or coalesce(p_stale_hours,0)<1 or not coalesce(p_campaigns_live,false) then return false; end if;
 select * into strict s from public.ads_engine_settings where id for update;
 v_today := (now() at time zone 'Etc/GMT+7')::date;
 if s.stall_notified_on is not distinct from v_today then return false; end if;
 if s.heartbeat_at is not null and s.heartbeat_at > now()-make_interval(hours=>p_stale_hours) then return false; end if;
 insert into public.notifications(user_id,company_id,type,title,body,is_read,persistent,action_url,action_label,dedupe_key)
 values(p_user_id,p_company_id,'ads_engine','ADS ENGINE STALLED',
 'Ads are live and the engine has not checked in for two days.',
 false,true,'/admin/google-ads#engine','VIEW ADS','ads-engine:stalled:'||v_today::text)
 on conflict do nothing;
 update public.ads_engine_settings set stall_notified_on=v_today,updated_at=now() where id;
 return true;
end $$;

revoke all on function public.ads_engine_modes_valid(jsonb),
 public.claim_ads_engine_run(uuid,text),
 public.checkpoint_ads_engine_run(uuid,uuid,text[],text),
 public.record_ads_engine_submission(uuid,uuid,integer,jsonb),
 public.accept_ads_proposal(uuid,uuid,text,text,integer,jsonb,jsonb,text,text),
 public.release_ads_engine_run(uuid,uuid,text,text),
 public.expire_ads_proposals(),
 public.review_ads_proposal(uuid,text,text,text),
 public.mark_ads_proposal_applied(uuid,text,jsonb,text[],text,text),
 public.notify_ads_engine(text,text),
 public.check_ads_engine_stall(text,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.ads_engine_modes_valid(jsonb),
 public.claim_ads_engine_run(uuid,text),
 public.checkpoint_ads_engine_run(uuid,uuid,text[],text),
 public.record_ads_engine_submission(uuid,uuid,integer,jsonb),
 public.accept_ads_proposal(uuid,uuid,text,text,integer,jsonb,jsonb,text,text),
 public.release_ads_engine_run(uuid,uuid,text,text),
 public.expire_ads_proposals(),
 public.review_ads_proposal(uuid,text,text,text),
 public.mark_ads_proposal_applied(uuid,text,jsonb,text[],text,text),
 public.notify_ads_engine(text,text),
 public.check_ads_engine_stall(text,text,integer,boolean) to service_role;
