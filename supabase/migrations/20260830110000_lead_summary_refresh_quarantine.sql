begin;

-- Lead summaries are DERIVED data. Before this migration a lead whose summary
-- could not converge stayed in the mailbox continuation envelope forever, and
-- because a non-empty envelope means "sync incomplete", one such lead froze the
-- whole mailbox cursor — `last_synced_at` stopped advancing and every Phase C
-- lane on the connection went quiet for seven days (bug 0700468d).
--
-- The envelope now carries a bounded attempt count per pending opportunity.
-- When a lead exhausts it for a MODEL reason (never a provider outage) the sync
-- engine drops it from the envelope and records it here instead, so the mailbox
-- completes and the non-convergence becomes explicit, owned, and reviewable.

create table if not exists public.lead_summary_refresh_quarantine (
  opportunity_id uuid primary key
    references public.opportunities(id) on delete cascade,
  company_id uuid not null,
  reason text not null,
  last_error text,
  deferral_count integer not null,
  quarantined_at timestamptz not null default now()
);

comment on table public.lead_summary_refresh_quarantine is
  'Opportunities whose AI lead summary exhausted its bounded refresh budget for a model-contract or model-refusal reason. Presence here removes the lead from the mailbox continuation envelope; a newer source event releases the row for one more bounded round.';

-- Newest-first per company: the nightly health audit and the refresh cron both
-- read this ordering.
create index if not exists lead_summary_refresh_quarantine_company_idx
  on public.lead_summary_refresh_quarantine (company_id, quarantined_at desc);

alter table public.lead_summary_refresh_quarantine enable row level security;
revoke all on table public.lead_summary_refresh_quarantine
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.lead_summary_refresh_quarantine to service_role;

-- One open rail alert per quarantined opportunity. The dedupe key embeds the
-- opportunity id, so a recurring condition yields exactly one open alert.
create unique index if not exists notifications_lead_summary_quarantine_unique
  on public.notifications (type, dedupe_key)
  where type = 'system'
    and dedupe_key like 'lead-summary-quarantine:%';

create or replace function public.upsert_lead_summary_refresh_quarantine(
  p_opportunity_id uuid,
  p_company_id uuid,
  p_reason text,
  p_last_error text,
  p_deferral_count integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_opportunity public.opportunities%rowtype;
  v_recipient_id uuid;
  v_dedupe_key text;
  v_notification_id uuid;
  v_title text;
  v_body text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_opportunity_id is null
     or p_company_id is null
     or nullif(pg_catalog.btrim(p_reason), '') is null
     or p_deferral_count is null
     or p_deferral_count < 1 then
    raise exception 'lead summary quarantine identity and budget are required'
      using errcode = '22023';
  end if;

  select *
  into v_opportunity
  from public.opportunities as opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null;
  if not found then
    raise exception 'lead summary quarantine source is unavailable'
      using errcode = '23503';
  end if;

  insert into public.lead_summary_refresh_quarantine as quarantine (
    opportunity_id,
    company_id,
    reason,
    last_error,
    deferral_count,
    quarantined_at
  ) values (
    p_opportunity_id,
    p_company_id,
    pg_catalog.btrim(p_reason),
    nullif(pg_catalog.btrim(p_last_error), ''),
    p_deferral_count,
    now()
  )
  on conflict (opportunity_id) do update
     set reason = excluded.reason,
         last_error = excluded.last_error,
         deferral_count = excluded.deferral_count,
         -- Re-arm the release comparison: only evidence NEWER than this
         -- moment may free the lead for another bounded round.
         quarantined_at = now();

  -- Recipient is derived server-side, never supplied by the caller: the lead's
  -- current assignee when they are active, otherwise a full-pipeline owner.
  if v_opportunity.assigned_to is not null then
    select active_user.id
    into v_recipient_id
    from public.users as active_user
    where active_user.id = v_opportunity.assigned_to
      and active_user.company_id = p_company_id
      and active_user.deleted_at is null
      and coalesce(active_user.is_active, false);
  end if;

  if v_recipient_id is null then
    select active_user.id
    into v_recipient_id
    from public.users_with_permission(
           p_company_id,
           'pipeline.view',
           'all'
         ) permitted(user_id)
    join public.users as active_user
      on active_user.id = permitted.user_id
    where active_user.company_id = p_company_id
      and active_user.deleted_at is null
      and coalesce(active_user.is_active, false)
    order by active_user.created_at asc
    limit 1;
  end if;

  -- No reachable owner is not a failure: the durable quarantine row and the
  -- refresh cron's result payload still surface the non-convergence.
  if v_recipient_id is null then
    return null;
  end if;

  v_dedupe_key := 'lead-summary-quarantine:' || p_opportunity_id::text;
  v_title := 'Lead summary needs review';
  v_body := 'The AI summary for '
    || coalesce(nullif(pg_catalog.btrim(v_opportunity.title), ''), 'this lead')
    || ' could not be generated after '
    || p_deferral_count::text
    || ' attempts. The lead is unchanged; only its summary is stale.';

  insert into public.notifications as notification (
    user_id,
    company_id,
    type,
    title,
    body,
    is_read,
    persistent,
    action_url,
    action_label,
    dedupe_key
  ) values (
    v_recipient_id::text,
    p_company_id::text,
    'system',
    v_title,
    v_body,
    false,
    true,
    '/pipeline?opportunityId=' || p_opportunity_id::text,
    'Review lead summary',
    v_dedupe_key
  )
  on conflict do nothing
  returning notification.id into v_notification_id;

  if v_notification_id is not null then
    return v_notification_id;
  end if;

  select notification.id
  into v_notification_id
  from public.notifications as notification
  where notification.type = 'system'
    and notification.dedupe_key = v_dedupe_key
  limit 1;

  return v_notification_id;
end
$function$;

revoke all on function public.upsert_lead_summary_refresh_quarantine(
  uuid, uuid, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_lead_summary_refresh_quarantine(
  uuid, uuid, text, text, integer
) to service_role;

create or replace function public.release_lead_summary_refresh_quarantine(
  p_opportunity_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_released boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_opportunity_id is null then
    raise exception 'lead summary quarantine identity is required'
      using errcode = '22023';
  end if;

  delete from public.lead_summary_refresh_quarantine as quarantine
  where quarantine.opportunity_id = p_opportunity_id;
  v_released := found;

  -- The alert describes a condition that no longer holds; resolve it so the
  -- rail does not accumulate stale persistent notifications.
  update public.notifications as notification
     set is_read = true,
         resolved_at = now(),
         resolution_reason = 'lead_summary_quarantine_released'
   where notification.type = 'system'
     and notification.dedupe_key =
           'lead-summary-quarantine:' || p_opportunity_id::text
     and notification.resolved_at is null;

  return v_released;
end
$function$;

revoke all on function public.release_lead_summary_refresh_quarantine(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.release_lead_summary_refresh_quarantine(uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
