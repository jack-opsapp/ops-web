begin;

-- A notification belongs to one immutable anomaly event. Read/resolution state
-- is presentation state and must never permit a second row for the same event.
create unique index if not exists notifications_email_anomaly_event_unique
  on public.notifications (type, dedupe_key)
  where type = 'email_anomaly'
    and dedupe_key is not null;

create or replace function public.create_email_anomaly_notification_if_new(
  p_anomaly_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_title text,
  p_body text,
  p_persistent boolean default false,
  p_action_url text default null,
  p_action_label text default null
)
returns table (notification_id uuid, created boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_notification_id uuid;
  v_dedupe_key text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_anomaly_id is null
     or p_user_id is null
     or p_company_id is null
     or nullif(pg_catalog.btrim(p_title), '') is null
     or nullif(pg_catalog.btrim(p_body), '') is null then
    raise exception 'anomaly notification identity and content are required'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.email_anomaly_log as anomaly
    where anomaly.id = p_anomaly_id
  ) then
    raise exception 'anomaly notification source is unavailable'
      using errcode = '23503';
  end if;
  if not exists (
    select 1
    from public.users as recipient
    join public.companies as company
      on company.id = recipient.company_id
     and company.deleted_at is null
    where recipient.id = p_user_id
      and recipient.company_id = p_company_id
      and recipient.deleted_at is null
      and coalesce(recipient.is_active, false)
  ) then
    raise exception 'anomaly notification recipient is unavailable'
      using errcode = '42501';
  end if;

  v_dedupe_key := 'email-anomaly:' || p_anomaly_id::text;
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
    p_user_id::text,
    p_company_id::text,
    'email_anomaly',
    pg_catalog.btrim(p_title),
    pg_catalog.btrim(p_body),
    false,
    p_persistent,
    nullif(pg_catalog.btrim(p_action_url), ''),
    nullif(pg_catalog.btrim(p_action_label), ''),
    v_dedupe_key
  )
  on conflict do nothing
  returning notification.id into v_notification_id;

  if v_notification_id is not null then
    return query select v_notification_id, true;
    return;
  end if;

  select notification.id
  into v_notification_id
  from public.notifications as notification
  where notification.type = 'email_anomaly'
    and notification.dedupe_key = v_dedupe_key
  limit 1;

  if v_notification_id is null then
    raise exception 'anomaly notification insert could not be reconciled'
      using errcode = '55000';
  end if;

  return query select v_notification_id, false;
end
$function$;

revoke all on function public.create_email_anomaly_notification_if_new(
  uuid, uuid, uuid, text, text, boolean, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_email_anomaly_notification_if_new(
  uuid, uuid, uuid, text, text, boolean, text, text
) to service_role;

-- Pause notifications are a second durable projection of the same anomaly.
-- The immutable event key survives read/resolution state and operator rotation.
create unique index if not exists notifications_email_pause_anomaly_unique
  on public.notifications (user_id, company_id, type, dedupe_key)
  where type = 'email_pause'
    and dedupe_key like 'email-pause-anomaly:%';

create or replace function public.reconcile_email_pause_notification_fanout(
  p_anomaly_id uuid,
  p_pause_audit_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_audit public.email_pause_audit_log%rowtype;
  v_dedupe_key text;
  v_created integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select audit.*
  into v_audit
  from public.email_pause_audit_log as audit
  where audit.id = p_pause_audit_id
    and audit.anomaly_log_id = p_anomaly_id
    and audit.action = 'pause';
  if not found then
    raise exception 'pause audit identity is unavailable'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.email_pause_state as pause_state
    where pause_state.scope = v_audit.scope
      and pause_state.is_paused
  ) then
    return 0;
  end if;

  v_dedupe_key := 'email-pause-anomaly:' || p_anomaly_id::text;
  insert into public.notifications (
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
  )
  select distinct
    recipient.id::text,
    recipient.company_id::text,
    'email_pause',
    'Email paused: ' || v_audit.scope,
    'Reason: ' || coalesce(v_audit.reason, 'Automatic safety pause') ||
      '. Paused by ' || coalesce(v_audit.actor_email, 'OPS automation') || '.',
    false,
    true,
    '/admin/email?tab=killswitches',
    'MANAGE',
    v_dedupe_key
  from public.admins as admin
  join public.users as recipient
    on pg_catalog.lower(pg_catalog.btrim(recipient.email)) =
       pg_catalog.lower(pg_catalog.btrim(admin.email))
  join public.companies as company
    on company.id = recipient.company_id
   and company.deleted_at is null
  where recipient.deleted_at is null
    and coalesce(recipient.is_active, false)
    and recipient.company_id is not null
  on conflict do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end
$function$;

revoke all on function public.reconcile_email_pause_notification_fanout(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_email_pause_notification_fanout(
  uuid, uuid
) to service_role;

commit;
