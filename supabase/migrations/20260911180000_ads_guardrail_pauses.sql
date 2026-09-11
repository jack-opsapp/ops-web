-- Google Ads engine: the disapproved-ad guardrail owns its pauses.
--
-- The worker pauses an engine ad Google disapproves (design spec §5.6). Until
-- now it kept no record of why, so it could not tell its own pause from a
-- blueprint retirement, an engine decision or a person's, and it never
-- switched an ad back on once Google approved it: on 2026-09-10 it paused 22
-- ads on a stale DESTINATION_NOT_WORKING verdict and left them paused after
-- Google cleared it. This file:
--   1. records every guardrail episode, with Google's policy topics and the
--      window its pause was committed in (`ads_guardrail_pauses`);
--   2. lets an engine alert be resolved, and keeps a resolved alert off the
--      operator's rail (`resolved_at`, `resolve_ads_engine_alerts`,
--      `notify_ads_engine`);
--   3. admits the restore alerts (kind `ad_restored`);
--   4. resolves every AD DISAPPROVED alert whose ad the entity snapshot now
--      shows approved (the 22 from 2026-09-10), in the outbox and on the rail.
--
-- Service-role only, like the rest of the engine ledger: RLS on, client
-- grants revoked, no policy; functions security invoker with an empty
-- search_path. Requires the phase 1 `ads_entities` table (20260909123000) and
-- the engine ledger (20260910120000).

-- ─── Guardrail episodes ─────────────────────────────────────────────────────

create table public.ads_guardrail_pauses (
 id uuid primary key default gen_random_uuid(),
 ad_resource_name text not null check(ad_resource_name ~ '^customers/[0-9]+/adGroupAds/[0-9]+~[0-9]+$'),
 ad_id text not null check(ad_id ~ '^[0-9]+$'),
 ad_group_resource_name text not null,
 ad_group_name text not null default '',
 campaign_resource_name text not null,
 -- holding: Google disapproved it and the pause waits (a landing-page verdict
 -- waits one daily check); paused: OPS paused it; restored: OPS switched it
 -- back on after Google approved it; released: OPS let go without acting.
 state text not null default 'holding' check(state in ('holding','paused','restored','released')),
 -- Google's policy_topic_entries[].topic at the last sighting, and the entries whole.
 policy_topics text[] not null default '{}',
 policy_entries jsonb not null default '[]'::jsonb check(jsonb_typeof(policy_entries)='array'),
 observed_at timestamptz not null default now(),
 -- The window around the real mutate; Google's commit of the pause falls
 -- inside it, which is how the guardrail finds its own change later.
 pause_requested_at timestamptz,
 paused_at timestamptz,
 pause_request_id text,
 pause_error text check(pause_error is null or length(pause_error)<=4000),
 restore_request_id text,
 close_reason text check(close_reason in ('restored','cleared_before_pause','ad_gone','changed_elsewhere','engine_decision','retired_by_blueprint','unverifiable')),
 closed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint ads_guardrail_pauses_open_closed check(
  (state in ('holding','paused') and closed_at is null and close_reason is null)
  or (state in ('restored','released') and closed_at is not null and close_reason is not null)
 ),
 constraint ads_guardrail_pauses_paused_window check(state not in ('paused','restored') or (pause_requested_at is not null and paused_at is not null and paused_at>=pause_requested_at)),
 constraint ads_guardrail_pauses_restored_reason check((state='restored') = (close_reason is not distinct from 'restored'))
);
create unique index ads_guardrail_pauses_one_open_per_ad on public.ads_guardrail_pauses (ad_resource_name) where state in ('holding','paused');

alter table public.ads_guardrail_pauses enable row level security;
revoke all on public.ads_guardrail_pauses from public, anon, authenticated;
grant select,insert,update,delete on public.ads_guardrail_pauses to service_role;

-- ─── Alerts: resolvable, and the restore kind ───────────────────────────────

alter table public.ads_engine_alerts add column resolved_at timestamptz;
alter table public.ads_engine_alerts drop constraint ads_engine_alerts_kind_check;
alter table public.ads_engine_alerts add constraint ads_engine_alerts_kind_check
 check(kind in ('ad_disapproved','ad_restored','budget_pacing','apply_failed'));
drop index public.ads_engine_alerts_pending_idx;
create index ads_engine_alerts_pending_idx on public.ads_engine_alerts (created_at) where notified_at is null and resolved_at is null;

-- Closes engine alerts and their rail rows together. Keys never raised are
-- ignored, so a caller may resolve everything an episode could have raised.
create function public.resolve_ads_engine_alerts(p_dedupe_keys text[])
returns integer language plpgsql security invoker set search_path='' as $$
declare resolved integer;
begin
 if p_dedupe_keys is null or cardinality(p_dedupe_keys)=0 then return 0; end if;
 update public.ads_engine_alerts set resolved_at=now()
  where dedupe_key=any(p_dedupe_keys) and resolved_at is null;
 get diagnostics resolved=row_count;
 update public.notifications set is_read=true,resolved_at=now()
  where type='ads_engine' and dedupe_key=any(p_dedupe_keys) and resolved_at is null;
 return resolved;
end $$;

-- As in 20260910120000, except a resolved alert is never delivered.
create or replace function public.notify_ads_engine(p_user_id text,p_company_id text)
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
 for a in select * from public.ads_engine_alerts where notified_at is null and resolved_at is null order by created_at,id limit 10 for update skip locked loop
  insert into public.notifications(user_id,company_id,type,title,body,is_read,persistent,action_url,action_label,dedupe_key)
  values(p_user_id,p_company_id,'ads_engine',a.title,a.body,false,a.persistent,a.action_url,'VIEW ADS',a.dedupe_key)
  on conflict do nothing;
  update public.ads_engine_alerts set notified_at=now() where id=a.id;
  delivered:=delivered+1;
 end loop;
 return delivered;
end $$;

revoke all on function public.resolve_ads_engine_alerts(text[]), public.notify_ads_engine(text,text) from public, anon, authenticated;
grant execute on function public.resolve_ads_engine_alerts(text[]), public.notify_ads_engine(text,text) to service_role;

-- ─── Backfill: the alerts Google has since made untrue ──────────────────────

-- Before this file an AD DISAPPROVED alert was keyed by the ad's resource name
-- (ads-engine:disapproved:<resource>). Resolve each one whose ad the entity
-- snapshot shows under a serving verdict now; an alert whose ad is still
-- disapproved, or which the snapshot cannot vouch for, stays.
with stale as (
 select a.id, a.dedupe_key
 from public.ads_engine_alerts a
 join public.ads_entities e
  on e.resource_name = substring(a.dedupe_key from '^ads-engine:disapproved:(customers/[0-9]+/adGroupAds/[0-9]+~[0-9]+)$')
 where a.kind='ad_disapproved' and a.resolved_at is null
  and coalesce(e.payload->'adGroupAd'->'policySummary'->>'approvalStatus', e.payload->'policySummary'->>'approvalStatus')
      in ('APPROVED','APPROVED_LIMITED','AREA_OF_INTEREST_ONLY')
), closed as (
 update public.ads_engine_alerts a set resolved_at=now() from stale where a.id=stale.id returning a.dedupe_key
)
update public.notifications n set is_read=true,resolved_at=now()
from closed where n.type='ads_engine' and n.dedupe_key=closed.dedupe_key and n.resolved_at is null;
