begin;

alter table public.notifications
  add column if not exists incident_version bigint not null default 0;

alter table public.notifications
  drop constraint if exists notifications_incident_version_nonnegative;

alter table public.notifications
  add constraint notifications_incident_version_nonnegative
  check (incident_version >= 0);

-- Read state is presentation only for persistent quota incidents. Keep one
-- unresolved ledger row even when an installed client marks it read.
create unique index if not exists notifications_openai_quota_open_unique
  on public.notifications (
    user_id,
    company_id,
    type,
    dedupe_key
  )
  where type = 'ai_provider_quota'
    and resolved_at is null;

-- Both quota observations and recovery use this exact transaction lock key.
-- The lock closes the window between reading an open generation and changing
-- it, while remaining scoped to one recipient/company/key-source incident.
create or replace function private.openai_quota_notification_lock_key(
  p_user_id uuid,
  p_company_id uuid,
  p_dedupe_key text
)
returns bigint
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
  select pg_catalog.hashtextextended(
    'openai-quota-notification|' || p_user_id::text || '|' ||
    p_company_id::text || '|' || btrim(p_dedupe_key),
    0
  )
$function$;

revoke all on function private.openai_quota_notification_lock_key(uuid, uuid, text) from public, anon, authenticated, service_role;

-- Trusted notification producers need the durable row identity so push
-- delivery can use the notification UUID as its provider idempotency key.
-- Keep the older boolean-returning RPC intact for existing callers.
create or replace function public.create_notification_if_new_with_identity(
  p_user_id uuid,
  p_company_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_persistent boolean default false,
  p_action_url text default null,
  p_action_label text default null,
  p_project_id text default null,
  p_deep_link_type text default null,
  p_dedupe_key text default null
)
returns table (
  notification_id uuid,
  created boolean,
  incident_version bigint
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_notification_id uuid;
  v_incident_version bigint;
  v_dedupe_key text := nullif(btrim(p_dedupe_key), '');
  v_type text := nullif(btrim(p_type), '');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required'
      using errcode = '42501';
  end if;

  if p_user_id is null
     or p_company_id is null
     or v_type is null
     or nullif(btrim(p_title), '') is null
     or nullif(btrim(p_body), '') is null then
    raise exception 'notification identity and content are required'
      using errcode = '22023';
  end if;

  if v_dedupe_key is null then
    raise exception 'notification dedupe key is required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.users as u
      join public.companies as c
        on c.id = u.company_id
     where u.id = p_user_id
       and u.company_id = p_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
       and c.deleted_at is null
  ) then
    raise exception 'notification recipient is unavailable'
      using errcode = '42501';
  end if;

  if v_type = 'ai_provider_quota' then
    perform pg_catalog.pg_advisory_xact_lock(
      private.openai_quota_notification_lock_key(
        p_user_id,
        p_company_id,
        v_dedupe_key
      )
    );

    update public.notifications as notification
       set incident_version = notification.incident_version + 1,
           is_read = false
     where notification.user_id = p_user_id::text
       and notification.company_id = p_company_id::text
       and notification.type = 'ai_provider_quota'
       and notification.dedupe_key = v_dedupe_key
       and notification.resolved_at is null
    returning notification.id, notification.incident_version
         into v_notification_id, v_incident_version;

    if v_notification_id is not null then
      return query select v_notification_id, false, v_incident_version;
      return;
    end if;
  end if;

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
    project_id,
    deep_link_type,
    dedupe_key,
    incident_version
  )
  values (
    p_user_id::text,
    p_company_id::text,
    v_type,
    btrim(p_title),
    btrim(p_body),
    false,
    p_persistent,
    nullif(btrim(p_action_url), ''),
    nullif(btrim(p_action_label), ''),
    nullif(btrim(p_project_id), ''),
    nullif(btrim(p_deep_link_type), ''),
    v_dedupe_key,
    case when v_type = 'ai_provider_quota' then 1 else 0 end
  )
  on conflict do nothing
  returning notification.id, notification.incident_version
       into v_notification_id, v_incident_version;

  if v_notification_id is not null then
    return query select v_notification_id, true, v_incident_version;
    return;
  end if;

  -- A non-cooperating writer could race the advisory-lock protocol. Re-touch
  -- the exact row after ON CONFLICT so this observation is never lost.
  if v_type = 'ai_provider_quota' then
    update public.notifications as notification
       set incident_version = notification.incident_version + 1,
           is_read = false
     where notification.user_id = p_user_id::text
       and notification.company_id = p_company_id::text
       and notification.type = 'ai_provider_quota'
       and notification.dedupe_key = v_dedupe_key
       and notification.resolved_at is null
    returning notification.id, notification.incident_version
         into v_notification_id, v_incident_version;

    if v_notification_id is not null then
      return query select v_notification_id, false, v_incident_version;
      return;
    end if;
  end if;

  -- ON CONFLICT waits for the competing insert. Re-read the exact open row so
  -- callers receive its stable identity without treating it as newly created.
  select notification.id, notification.incident_version
    into v_notification_id, v_incident_version
    from public.notifications as notification
   where notification.user_id = p_user_id::text
     and notification.company_id = p_company_id::text
     and notification.type = v_type
     and notification.dedupe_key is not distinct from v_dedupe_key
     and notification.is_read = false
     and notification.resolved_at is null
   order by notification.created_at desc, notification.id desc
   limit 1;

  if v_notification_id is null then
    raise exception 'notification insert could not be reconciled'
      using errcode = '55000';
  end if;

  return query select v_notification_id, false, v_incident_version;
end;
$$;

revoke all on function public.create_notification_if_new_with_identity(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.create_notification_if_new_with_identity(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text
) to service_role;

-- Recovery is deliberately identity-complete: only the captured open incident
-- may be resolved, and system recovery never impersonates a human resolver.
create or replace function public.resolve_openai_quota_notification_as_system(
  p_notification_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_dedupe_key text,
  p_expected_incident_version bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_updated integer := 0;
  v_dedupe_key text := nullif(btrim(p_dedupe_key), '');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required'
      using errcode = '42501';
  end if;

  if p_notification_id is null
     or p_user_id is null
     or p_company_id is null
     or v_dedupe_key is null
     or p_expected_incident_version is null
     or p_expected_incident_version < 1 then
    raise exception 'quota notification identity is required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.users as u
      join public.companies as c
        on c.id = u.company_id
     where u.id = p_user_id
       and u.company_id = p_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
       and c.deleted_at is null
  ) then
    raise exception 'notification recipient is unavailable'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    private.openai_quota_notification_lock_key(
      p_user_id,
      p_company_id,
      v_dedupe_key
    )
  );

  update public.notifications as notification
     set is_read = true,
         resolved_at = clock_timestamp(),
         resolved_by = null,
         resolution_reason = 'provider_quota_recovered'
   where notification.id = p_notification_id
     and notification.user_id = p_user_id::text
     and notification.company_id = p_company_id::text
     and notification.type = 'ai_provider_quota'
     and notification.dedupe_key = v_dedupe_key
     and notification.incident_version = p_expected_incident_version
     and notification.resolved_at is null;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.resolve_openai_quota_notification_as_system(uuid, uuid, uuid, text, bigint) from public, anon, authenticated, service_role;

grant execute on function public.resolve_openai_quota_notification_as_system(uuid, uuid, uuid, text, bigint) to service_role;

commit;
