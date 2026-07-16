begin;

-- Insert one lead-email notification while holding the same opportunity row
-- used to derive its recipient. Callers cannot choose a company, recipient,
-- title or body, so service-role access never becomes a generic notification
-- bridge. A concurrent reassignment either wins the row lock first (and this
-- returns false) or waits until this transaction's notification is durable.
create or replace function public.create_email_opportunity_notification_as_system(
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_expected_assignment_version bigint,
  p_event_type text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opportunity public.opportunities%rowtype;
  v_connection public.email_connections%rowtype;
  v_thread public.email_threads%rowtype;
  v_recipient_user_id uuid;
  v_client_name text := 'A client';
  v_notification_type text;
  v_title text;
  v_body text;
  v_persistent boolean;
  v_action_label text;
  v_dedupe_key text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_opportunity_id is null
     or p_connection_id is null
     or nullif(btrim(p_provider_thread_id), '') is null
     or p_expected_assignment_version is null
     or p_expected_assignment_version < 0
     or p_event_type not in (
       'terminal_likely_won',
       'terminal_likely_lost',
       'accept_auto_won',
       'accept_review_won',
       'thread_customer',
       'thread_platform_bid',
       'thread_urgent'
     ) then
    raise exception 'invalid_email_opportunity_notification'
      using errcode = '22023';
  end if;

  select opportunity.*
    into v_opportunity
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.deleted_at is null
     and opportunity.assignment_version = p_expected_assignment_version
     and opportunity.assigned_to is not null
   for update;
  if not found then
    return false;
  end if;
  v_recipient_user_id := v_opportunity.assigned_to;

  if not exists (
    select 1
      from public.users user_row
     where user_row.id = v_recipient_user_id
       and user_row.company_id = v_opportunity.company_id
       and user_row.deleted_at is null
       and coalesce(user_row.is_active, false)
  ) then
    return false;
  end if;

  select connection.*
    into v_connection
    from public.email_connections connection
   where connection.id = p_connection_id
     and connection.company_id = v_opportunity.company_id::text
   for share;
  if not found then
    return false;
  end if;
  if v_connection.type::text = 'individual'
     and coalesce(v_connection.user_id, '') <> v_recipient_user_id::text then
    return false;
  end if;

  select thread.*
    into v_thread
    from public.email_threads thread
   where thread.company_id = v_opportunity.company_id
     and thread.connection_id = p_connection_id
     and thread.provider_thread_id = btrim(p_provider_thread_id)
     and thread.opportunity_id = p_opportunity_id
   for share;
  if not found then
    return false;
  end if;
  if not exists (
    select 1
      from public.opportunity_email_threads link
     where link.opportunity_id = p_opportunity_id
       and link.connection_id = p_connection_id
       and link.thread_id = btrim(p_provider_thread_id)
  ) then
    return false;
  end if;

  if not private.user_can_view_opportunity_inbox(
    v_recipient_user_id,
    p_opportunity_id,
    p_connection_id
  ) then
    return false;
  end if;
  if p_event_type in ('terminal_likely_won', 'accept_review_won')
     and not private.user_can_convert_opportunity(
      v_recipient_user_id,
      p_opportunity_id
    ) then
    return false;
  end if;

  if v_opportunity.client_id is not null then
    select coalesce(nullif(btrim(client.name), ''), 'A client')
      into v_client_name
      from public.clients client
     where client.id = v_opportunity.client_id
       and client.company_id = v_opportunity.company_id;
    v_client_name := coalesce(v_client_name, 'A client');
  end if;

  case p_event_type
    when 'terminal_likely_won' then
      v_notification_type := 'role_needed';
      v_title := 'Possible deal won';
      v_body := v_client_name || ' may have accepted your estimate. Review and confirm.';
      v_persistent := true;
      v_action_label := 'Mark as Won';
    when 'terminal_likely_lost' then
      v_notification_type := 'role_needed';
      v_title := 'Possible deal lost';
      v_body := v_client_name || ' may have declined. Review and confirm.';
      v_persistent := true;
      v_action_label := 'Review';
    when 'accept_auto_won' then
      v_notification_type := 'system';
      v_title := 'Deal won';
      v_body := v_client_name || ' accepted. This lead was moved to Won.';
      v_persistent := false;
      v_action_label := 'View lead';
    when 'accept_review_won' then
      v_notification_type := 'system';
      v_title := 'Possible deal won';
      v_body := v_client_name || ' may have accepted. Review and confirm.';
      v_persistent := true;
      v_action_label := 'Mark as Won';
    when 'thread_customer' then
      v_notification_type := 'leads_waiting';
      v_title := 'New lead: ' || coalesce(
        nullif(btrim(v_thread.latest_sender_name), ''),
        nullif(btrim(v_thread.latest_sender_email), ''),
        'Unknown sender'
      );
      v_body := coalesce(nullif(btrim(v_thread.subject), ''), '(no subject)');
      v_persistent := false;
      v_action_label := 'Open thread';
    when 'thread_platform_bid' then
      v_notification_type := 'leads_waiting';
      v_title := 'Platform bid: ' || coalesce(
        nullif(split_part(split_part(v_thread.latest_sender_email, '@', 2), '.', 1), ''),
        'Platform'
      );
      v_body := coalesce(nullif(btrim(v_thread.subject), ''), '(no subject)');
      v_persistent := false;
      v_action_label := 'Review';
    when 'thread_urgent' then
      v_notification_type := 'role_needed';
      v_title := 'Urgent reply needed: ' || coalesce(
        nullif(btrim(v_thread.latest_sender_name), ''),
        nullif(btrim(v_thread.latest_sender_email), ''),
        'Unknown sender'
      );
      v_body := coalesce(nullif(btrim(v_thread.subject), ''), '(no subject)');
      v_persistent := false;
      v_action_label := 'Reply now';
  end case;

  v_dedupe_key :=
    'email-opportunity-event:' || p_event_type || ':' ||
    p_opportunity_id::text || ':' || v_thread.id::text || ':' ||
    p_expected_assignment_version::text;

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
    v_recipient_user_id::text,
    v_opportunity.company_id::text,
    v_notification_type,
    v_title,
    v_body,
    false,
    v_persistent,
    case
      when p_event_type in (
        'thread_customer',
        'thread_platform_bid',
        'thread_urgent'
      ) then '/inbox?thread=' || v_thread.id::text ||
        '&opportunityId=' || p_opportunity_id::text
      else '/pipeline'
    end,
    v_action_label,
    'inbox',
    v_dedupe_key
  )
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function public.create_email_opportunity_notification_as_system(
  uuid,
  uuid,
  text,
  bigint,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.create_email_opportunity_notification_as_system(
  uuid,
  uuid,
  text,
  bigint,
  text
) to service_role;

-- Deliver a generic sync-complete notification only to the current canonical
-- owner of an individual mailbox. The connection row is the concurrency fence:
-- shared-mailbox connector metadata can never become notification authority,
-- and an ownership change either completes first (making the snapshot stale)
-- or waits until this transaction has derived and persisted the old owner's
-- notification.
create or replace function public.create_email_sync_complete_notification_as_system(
  p_connection_id uuid,
  p_expected_owner_user_id uuid,
  p_new_leads integer,
  p_matched integer,
  p_needs_review integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.email_connections%rowtype;
  v_company_id uuid;
  v_inbox_enabled boolean := false;
  v_body text;
  v_action_url text;
  v_action_label text;
  v_dedupe_key text;
  v_inserted_count integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_connection_id is null
     or p_expected_owner_user_id is null
     or p_new_leads is null
     or p_new_leads < 0
     or p_new_leads > 10000
     or p_matched is null
     or p_matched < 0
     or p_matched > 10000
     or p_needs_review is null
     or p_needs_review < 0
     or p_needs_review > 10000 then
    raise exception 'invalid_email_sync_complete_notification'
      using errcode = '22023';
  end if;
  if p_new_leads + p_matched + p_needs_review = 0 then
    return false;
  end if;

  select connection.*
    into v_connection
    from public.email_connections connection
   where connection.id = p_connection_id
   for update;
  if not found then
    return false;
  end if;
  if v_connection.type::text <> 'individual'
     or v_connection.user_id is null
     or v_connection.user_id <> p_expected_owner_user_id::text then
    return false;
  end if;

  select user_row.company_id
    into v_company_id
    from public.users user_row
   where user_row.id = p_expected_owner_user_id
     and user_row.company_id::text = v_connection.company_id
     and user_row.deleted_at is null
     and coalesce(user_row.is_active, false)
   for share;
  if not found then
    return false;
  end if;

  if not private.user_can_view_inbox_connection(
    p_expected_owner_user_id,
    v_company_id,
    p_connection_id,
    null
  ) then
    return false;
  end if;

  select exists (
    select 1
      from public.admin_feature_overrides flag
     where flag.company_id = v_company_id
       and flag.feature_key = 'inbox_ui'
       and flag.enabled = true
  ) into v_inbox_enabled;

  v_body := concat_ws(
    ' · ',
    case
      when p_new_leads > 0 then
        p_new_leads::text || ' new lead' ||
        case when p_new_leads = 1 then '' else 's' end
    end,
    case
      when p_matched > 0 then
        p_matched::text || ' email' ||
        case when p_matched = 1 then '' else 's' end || ' matched'
    end,
    case
      when p_needs_review > 0 then
        p_needs_review::text ||
        case when p_needs_review = 1 then ' needs review' else ' need review' end
    end
  );
  if nullif(v_body, '') is null then
    return false;
  end if;

  v_action_url := case
    when v_inbox_enabled then '/inbox'
    else '/pipeline'
  end;
  v_action_label := case
    when v_inbox_enabled then 'Review inbox'
    else 'View pipeline'
  end;
  v_dedupe_key :=
    'email-sync-complete:' || p_connection_id::text || ':' ||
    p_expected_owner_user_id::text || ':' ||
    extract(epoch from date_trunc('hour', transaction_timestamp()))::bigint::text || ':' ||
    p_new_leads::text || ':' || p_matched::text || ':' ||
    p_needs_review::text;

  -- The connection row lock serializes every delivery for this mailbox. The
  -- explicit lookup keeps the hourly snapshot deduped even after the user has
  -- read or resolved the prior notification (the legacy unique index covers
  -- only unread, unresolved rows).
  if exists (
    select 1
      from public.notifications notification
     where notification.user_id = p_expected_owner_user_id::text
       and notification.company_id = v_company_id::text
       and notification.type = 'email_sync_complete'
       and notification.dedupe_key = v_dedupe_key
  ) then
    return false;
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
    p_expected_owner_user_id::text,
    v_company_id::text,
    'email_sync_complete',
    'Email sync · ' || coalesce(
      nullif(btrim(v_connection.email), ''),
      'Connected mailbox'
    ),
    v_body,
    false,
    false,
    v_action_url,
    v_action_label,
    'inbox',
    v_dedupe_key
  )
  on conflict do nothing;

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count = 1;
end;
$$;

revoke all on function public.create_email_sync_complete_notification_as_system(
  uuid,
  uuid,
  integer,
  integer,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.create_email_sync_complete_notification_as_system(
  uuid,
  uuid,
  integer,
  integer,
  integer
) to service_role;

commit;
