begin;

-- Resolve an attachment notification audience from canonical OPS identity.
-- Lead-linked mail is delivered only to the current assignee when that user
-- can still view both the lead and the inbox thread. An unlinked personal
-- mailbox may use its exact active owner; a company connector never does.
create or replace function private.resolve_email_attachment_notification_recipient(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_activity_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_type text;
  v_connection_user_id text;
  v_thread_opportunity_id uuid;
  v_link_opportunity_ids uuid[];
  v_link_opportunity_id uuid;
  v_activity_opportunity_id uuid;
  v_canonical_opportunity_id uuid;
  v_recipient uuid;
begin
  if p_company_id is null
     or p_connection_id is null
     or nullif(btrim(p_provider_thread_id), '') is null then
    return null;
  end if;

  select connection.type::text, connection.user_id
    into v_connection_type, v_connection_user_id
    from public.email_connections connection
   where connection.id = p_connection_id
     and connection.company_id = p_company_id::text;
  if not found then
    return null;
  end if;

  select thread.opportunity_id
    into v_thread_opportunity_id
    from public.email_threads thread
   where thread.company_id = p_company_id
     and thread.connection_id = p_connection_id
     and thread.provider_thread_id = btrim(p_provider_thread_id)
   order by thread.updated_at desc nulls last, thread.id asc
   limit 1;

  select array_agg(distinct link.opportunity_id)
    into v_link_opportunity_ids
    from public.opportunity_email_threads link
   where link.connection_id = p_connection_id
     and link.thread_id = btrim(p_provider_thread_id);
  if cardinality(v_link_opportunity_ids) > 1 then
    return null;
  end if;
  v_link_opportunity_id := v_link_opportunity_ids[1];

  if v_thread_opportunity_id is not null
     and v_link_opportunity_id is not null
     and v_thread_opportunity_id is distinct from v_link_opportunity_id then
    return null;
  end if;

  if p_activity_id is not null then
    select activity.opportunity_id
      into v_activity_opportunity_id
      from public.activities activity
     where activity.id = p_activity_id
       and activity.company_id = p_company_id
       and activity.email_connection_id = p_connection_id
       and activity.email_thread_id = btrim(p_provider_thread_id)
       and activity.type = 'email';
    if not found then
      return null;
    end if;
  end if;

  v_canonical_opportunity_id := coalesce(
    v_thread_opportunity_id,
    v_link_opportunity_id,
    v_activity_opportunity_id
  );
  if v_activity_opportunity_id is not null
     and v_activity_opportunity_id is distinct from v_canonical_opportunity_id then
    return null;
  end if;

  if v_canonical_opportunity_id is not null then
    select opportunity.assigned_to
      into v_recipient
      from public.opportunities opportunity
     where opportunity.id = v_canonical_opportunity_id
       and opportunity.company_id = p_company_id
       and opportunity.deleted_at is null
       and opportunity.assigned_to is not null;
    if not found then
      return null;
    end if;

    if not exists (
      select 1
        from public.users user_row
       where user_row.id = v_recipient
         and user_row.company_id = p_company_id
         and user_row.deleted_at is null
         and coalesce(user_row.is_active, false)
    ) then
      return null;
    end if;
    if not private.user_can_view_opportunity_inbox(
      v_recipient,
      v_canonical_opportunity_id,
      p_connection_id
    ) then
      return null;
    end if;
    return v_recipient;
  end if;

  if v_connection_type <> 'individual'
     or nullif(btrim(v_connection_user_id), '') is null then
    return null;
  end if;

  select user_row.id
    into v_recipient
    from public.users user_row
   where user_row.id::text = v_connection_user_id
     and user_row.company_id = p_company_id
     and user_row.deleted_at is null
     and coalesce(user_row.is_active, false);
  if not found then
    return null;
  end if;
  if not private.user_can_view_inbox_connection(
    v_recipient,
    p_company_id,
    p_connection_id,
    null
  ) then
    return null;
  end if;
  return v_recipient;
end;
$$;

revoke all on function private.resolve_email_attachment_notification_recipient(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;

-- The earlier seven-argument function accepted a company, recipient and copy
-- from a service caller. Remove that generic bridge; all new callers use the
-- scan-only operation below and the database derives every identity and word.
revoke execute on function public.notify_email_attachment_scan_exception(
  uuid, uuid, text, text, text, text, text
) from service_role;

create or replace function public.notify_email_attachment_scan_exception_as_system(
  p_scan_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan public.email_attachment_scans%rowtype;
  v_recipient uuid;
  v_thread_id uuid;
  v_exception_count integer := 0;
  v_inserted_count integer := 0;
  v_body text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_scan_id is null then
    raise exception 'invalid_email_attachment_scan_notification'
      using errcode = '22023';
  end if;

  select scan.*
    into v_scan
    from public.email_attachment_scans scan
   where scan.id = p_scan_id
   for update;
  if not found or v_scan.exception_notified_at is not null then
    return false;
  end if;

  v_recipient := private.resolve_email_attachment_notification_recipient(
    v_scan.company_id,
    v_scan.connection_id,
    v_scan.provider_thread_id,
    v_scan.activity_id
  );
  if v_recipient is null then
    return false;
  end if;

  select thread.id
    into v_thread_id
    from public.email_threads thread
   where thread.company_id = v_scan.company_id
     and thread.connection_id = v_scan.connection_id
     and thread.provider_thread_id = v_scan.provider_thread_id
   order by thread.updated_at desc nulls last, thread.id asc
   limit 1;

  select count(*)::integer
    into v_exception_count
    from public.email_attachments attachment
   where attachment.company_id = v_scan.company_id
     and attachment.connection_id = v_scan.connection_id
     and attachment.activity_id = v_scan.activity_id
     and attachment.ingest_status in (
       'external', 'oversized', 'unavailable', 'failed'
     );
  v_exception_count := greatest(v_exception_count, 1);
  v_body := case
    when v_exception_count = 1 then
      'OPS couldn''t copy 1 file from this email. Open the thread to review it.'
    else
      format(
        'OPS couldn''t copy %s files from this email. Open the thread to review them.',
        v_exception_count
      )
  end;

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
    deep_link_type,
    dedupe_key
  ) values (
    v_recipient::text,
    v_scan.company_id::text,
    'system',
    'Email files need review',
    v_body,
    false,
    false,
    case
      when v_thread_id is null then '/inbox'
      else '/inbox?thread=' || v_thread_id::text
    end,
    'Review thread',
    'inbox',
    'email-attachment-scan:' || p_scan_id::text
  )
  on conflict do nothing;
  get diagnostics v_inserted_count = row_count;

  if v_inserted_count = 1 or exists (
    select 1
      from public.notifications notification
     where notification.user_id = v_recipient::text
       and notification.company_id = v_scan.company_id::text
       and notification.dedupe_key =
         'email-attachment-scan:' || p_scan_id::text
  ) then
    update public.email_attachment_scans scan
       set exception_notified_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where scan.id = p_scan_id;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.notify_email_attachment_scan_exception_as_system(
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.notify_email_attachment_scan_exception_as_system(
  uuid
) to service_role;

-- One canonical reconnect transition. Personal-mailbox warning fan-out is
-- queued by the 164000 lifecycle trigger. Company-mailbox transport warnings
-- go only to active OPS users with explicit integration-management authority.
create or replace function public.mark_email_connection_needs_reconnect_as_system(
  p_connection_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.email_connections%rowtype;
  v_inserted_count integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_connection_id is null then
    raise exception 'invalid_email_connection_reconnect_transition'
      using errcode = '22023';
  end if;

  select connection.*
    into v_connection
    from public.email_connections connection
   where connection.id = p_connection_id
   for update;
  if not found then
    return 0;
  end if;

  update public.email_connections connection
     set status = 'needs_reconnect',
         updated_at = clock_timestamp()
   where connection.id = p_connection_id;

  if v_connection.type::text = 'company' then
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
      deep_link_type,
      dedupe_key
    )
    select
      user_row.id::text,
      v_connection.company_id,
      'system',
      'Email connection paused',
      'Reconnect ' || coalesce(
        nullif(btrim(v_connection.email), ''),
        'this mailbox'
      ) || ' to resume email sync.',
      false,
      true,
      '/settings?tab=integrations',
      'Reconnect',
      'inbox',
      'email-connection-reconnect:' || p_connection_id::text
    from public.users user_row
    where user_row.company_id::text = v_connection.company_id
      and user_row.deleted_at is null
      and coalesce(user_row.is_active, false)
      and public.has_permission(
        user_row.id,
        'settings.integrations',
        'all'
      )
      and not exists (
        select 1
          from public.notifications notification
         where notification.user_id = user_row.id::text
           and notification.company_id = v_connection.company_id
           and notification.dedupe_key =
             'email-connection-reconnect:' || p_connection_id::text
           and notification.resolved_at is null
      )
    on conflict do nothing;
    get diagnostics v_inserted_count = row_count;
  end if;

  return v_inserted_count;
end;
$$;

revoke all on function public.mark_email_connection_needs_reconnect_as_system(
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.mark_email_connection_needs_reconnect_as_system(
  uuid
) to service_role;

-- Preserve the old attachment worker signature as a narrow compatibility
-- wrapper. It verifies the supplied company but derives all recipients through
-- the generic reconnect operation; company connector user_id is never read.
create or replace function public.mark_email_attachment_connection_needs_reconnect(
  p_connection_id uuid,
  p_company_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_connection_id is null or p_company_id is null then
    raise exception 'invalid_email_attachment_reconnect_transition'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.email_connections connection
     where connection.id = p_connection_id
       and connection.company_id = p_company_id::text
  ) then
    return 0;
  end if;
  return public.mark_email_connection_needs_reconnect_as_system(
    p_connection_id
  );
end;
$$;

revoke all on function public.mark_email_attachment_connection_needs_reconnect(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.mark_email_attachment_connection_needs_reconnect(
  uuid, uuid
) to service_role;

create or replace function public.resume_email_attachment_scans_on_reconnect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and new.sync_enabled is true
     and (
       old.status is distinct from new.status
       or old.sync_enabled is distinct from new.sync_enabled
     ) then
    update public.email_attachment_scans scan
       set status = 'pending',
           available_at = clock_timestamp(),
           lease_owner = null,
           lease_expires_at = null,
           last_error = null,
           updated_at = clock_timestamp()
     where scan.connection_id = new.id
       and scan.status = 'paused';

    update public.notifications notification
       set is_read = true,
           resolved_at = coalesce(
             notification.resolved_at,
             clock_timestamp()
           ),
           resolution_reason = 'email_reconnected'
     where notification.company_id = new.company_id
       and notification.type = 'system'
       and notification.dedupe_key in (
         'email-attachment-reconnect:' || new.id::text,
         'email-connection-reconnect:' || new.id::text
       )
       and notification.resolved_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.resume_email_attachment_scans_on_reconnect()
  from public, anon, authenticated, service_role;

-- Terminal queue notifications share the same fail-closed audience resolver;
-- no direct connector/admin/fallback recipient path remains.
create or replace function public.notify_terminal_email_attachment_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := (to_jsonb(new) ->> 'company_id')::uuid;
  v_connection_id uuid := (to_jsonb(new) ->> 'connection_id')::uuid;
  v_provider_thread_id text;
  v_activity_id uuid;
  v_thread_id uuid;
  v_recipient uuid;
  v_action_url text := '/inbox';
  v_title text;
  v_body text;
  v_dedupe_key text;
begin
  if new.status <> 'failed' or old.status = 'failed' then
    return new;
  end if;

  if tg_table_name = 'email_attachment_scans' then
    v_provider_thread_id := to_jsonb(new) ->> 'provider_thread_id';
    v_activity_id := (to_jsonb(new) ->> 'activity_id')::uuid;
    v_title := 'Email files need review';
    v_body := 'OPS could not finish copying files from this email after repeated attempts. Open the thread to review them.';
    v_dedupe_key := 'email-attachment-scan-failed:' || new.id::text;
  elsif tg_table_name = 'email_attachment_inspection_jobs' then
    select attachment.provider_thread_id, attachment.activity_id
      into v_provider_thread_id, v_activity_id
      from public.email_attachments attachment
     where attachment.id = new.email_attachment_id
       and attachment.company_id = v_company_id
       and attachment.connection_id = v_connection_id;
    if not found then
      return new;
    end if;
    v_title := 'Email file review incomplete';
    v_body := 'OPS could not finish checking an email file after repeated attempts. Open the thread to review it.';
    v_dedupe_key := 'email-attachment-inspection-failed:' || new.id::text;
  else
    raise exception 'unsupported attachment failure queue';
  end if;

  v_recipient := private.resolve_email_attachment_notification_recipient(
    v_company_id,
    v_connection_id,
    v_provider_thread_id,
    v_activity_id
  );
  if v_recipient is null then
    return new;
  end if;

  select thread.id
    into v_thread_id
    from public.email_threads thread
   where thread.company_id = v_company_id
     and thread.connection_id = v_connection_id
     and thread.provider_thread_id = v_provider_thread_id
   order by thread.updated_at desc nulls last, thread.id asc
   limit 1;
  if v_thread_id is not null then
    v_action_url := '/inbox?thread=' || v_thread_id::text;
  end if;

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
    deep_link_type,
    dedupe_key
  ) values (
    v_recipient::text,
    v_company_id::text,
    'system',
    v_title,
    v_body,
    false,
    false,
    v_action_url,
    'Review thread',
    'inbox',
    v_dedupe_key
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.notify_terminal_email_attachment_failure()
  from public, anon, authenticated, service_role;

commit;
