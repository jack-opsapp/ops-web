begin;

-- Personal mailbox disable/reconnect and relationship changes are queued
-- transactionally, then projected into persistent notifications by a retryable
-- service-role processor. Notification delivery failure therefore never causes
-- an existing conversation to be rerouted through a different mailbox.
create table if not exists public.email_connection_lifecycle_outbox (
  connection_id uuid
    references public.email_connections(id) on delete cascade,
  company_id text not null,
  reason text not null,
  requested_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  primary key (connection_id)
);

create index if not exists email_connection_lifecycle_outbox_pending_idx
  on public.email_connection_lifecycle_outbox (requested_at, connection_id)
  where processed_at is null;

create index if not exists opportunity_email_threads_connection_impact_idx
  on public.opportunity_email_threads (
    connection_id,
    opportunity_id,
    thread_id
  )
  where connection_id is not null;

alter table public.email_connection_lifecycle_outbox enable row level security;
revoke all on table public.email_connection_lifecycle_outbox
  from public, anon, authenticated;
grant select, update
  on table public.email_connection_lifecycle_outbox to service_role;

create or replace function public.enqueue_personal_mailbox_lifecycle_event(
  p_connection_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_company_id text;
  v_connection_type text;
  v_connection_status text;
  v_sync_enabled boolean;
begin
  if p_connection_id is null then
    return;
  end if;

  select
    connection.company_id::text,
    connection.type::text,
    connection.status,
    connection.sync_enabled
    into v_company_id, v_connection_type, v_connection_status, v_sync_enabled
  from public.email_connections as connection
  where connection.id = p_connection_id;

  if not found or v_connection_type <> 'individual' then
    return;
  end if;

  -- Active personal connections cannot have an unavailable-mailbox impact.
  -- Their status transition itself is still queued so an existing warning is
  -- resolved immediately after reconnect.
  if coalesce(p_reason, '') <> 'connection_status_changed'
     and v_connection_status = 'active'
     and v_sync_enabled then
    return;
  end if;

  insert into public.email_connection_lifecycle_outbox (
    connection_id,
    company_id,
    reason,
    requested_at,
    processed_at,
    last_error
  )
  values (
    p_connection_id,
    v_company_id,
    coalesce(nullif(btrim(p_reason), ''), 'relationship_changed'),
    clock_timestamp(),
    null,
    null
  )
  on conflict (connection_id) do update
    set company_id = excluded.company_id,
        reason = excluded.reason,
        requested_at = excluded.requested_at,
        processed_at = null,
        last_error = null;
end;
$$;

revoke all on function public.enqueue_personal_mailbox_lifecycle_event(uuid, text)
  from public, anon, authenticated;

create or replace function public.process_personal_mailbox_lifecycle_event(
  p_connection_id uuid
)
returns table (
  affected_conversation_count integer,
  notified_user_count integer,
  resolved_notification_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_event public.email_connection_lifecycle_outbox%rowtype;
  v_connection record;
  v_company_uuid uuid;
  v_affected_count integer := 0;
  v_notified_count integer := 0;
  v_resolved_count integer := 0;
  v_updated_count integer := 0;
  v_dedupe_key text := 'personal-mailbox-unavailable:' || p_connection_id::text;
  v_body text;
  v_resolution_reason text;
begin
  select event.*
    into v_event
  from public.email_connection_lifecycle_outbox as event
  where event.connection_id = p_connection_id
    and event.processed_at is null
  for update skip locked;

  if not found then
    return query select 0, 0, 0;
    return;
  end if;

  select
    connection.id,
    connection.company_id::text as company_id,
    connection.type::text as connection_type,
    connection.email,
    connection.status,
    connection.sync_enabled
  into v_connection
  from public.email_connections as connection
  where connection.id = p_connection_id;

  if not found then
    update public.email_connection_lifecycle_outbox as event
       set processed_at = clock_timestamp(),
           attempt_count = event.attempt_count + 1,
           last_error = null
     where event.connection_id = p_connection_id;
    return query select 0, 0, 0;
    return;
  end if;

  if v_connection.connection_type <> 'individual' then
    update public.email_connection_lifecycle_outbox as event
       set processed_at = clock_timestamp(),
           attempt_count = event.attempt_count + 1,
           last_error = null
     where event.connection_id = p_connection_id;
    return query select 0, 0, 0;
    return;
  end if;

  select company.id
    into v_company_uuid
  from public.companies as company
  where company.id::text = v_connection.company_id
    and company.deleted_at is null
  for share;

  if not found then
    raise exception 'personal mailbox lifecycle company is invalid'
      using errcode = '23503';
  end if;

  select count(distinct thread.id)::integer
    into v_affected_count
  from public.email_threads as thread
  where thread.connection_id = p_connection_id
    and thread.company_id = v_company_uuid
    and thread.archived_at is null
    and exists (
      select 1
      from public.opportunities as opportunity
      where opportunity.company_id = v_company_uuid
        and opportunity.archived_at is null
        and opportunity.deleted_at is null
        and opportunity.stage not in ('won', 'lost', 'discarded')
        and (
          opportunity.id = thread.opportunity_id
          or exists (
            select 1
            from public.opportunity_email_threads as link
            where link.connection_id = p_connection_id
              and link.thread_id = thread.provider_thread_id
              and link.opportunity_id = opportunity.id
          )
        )
    );

  if v_connection.status = 'active'
     and v_connection.sync_enabled then
    v_resolution_reason := 'mailbox_reconnected';
  elsif v_affected_count = 0 then
    v_resolution_reason := 'mailbox_impact_cleared';
  end if;

  if v_resolution_reason is not null then
    update public.notifications as notification
       set is_read = true,
           resolved_at = clock_timestamp(),
           resolution_reason = v_resolution_reason,
           resolved_by = null
     where notification.company_id = v_connection.company_id
       and notification.type = 'system'
       and notification.dedupe_key = v_dedupe_key
       and notification.resolved_at is null;
    get diagnostics v_resolved_count = row_count;
  else
    -- Permission is evaluated by canonical OPS user UUID. Email address and
    -- mailbox ownership are deliberately absent from notification authority.
    update public.notifications as notification
       set is_read = true,
           resolved_at = clock_timestamp(),
           resolution_reason = 'mailbox_warning_audience_changed',
           resolved_by = null
     where notification.company_id = v_connection.company_id
       and notification.type = 'system'
       and notification.dedupe_key = v_dedupe_key
       and notification.resolved_at is null
       and not exists (
         select 1
         from public.users as candidate
         where candidate.id::text = notification.user_id
           and candidate.company_id = v_company_uuid
           and candidate.deleted_at is null
           and coalesce(candidate.is_active, false)
           and private.effective_pipeline_scope_for_user(
             candidate.id, v_company_uuid, 'pipeline.assign'
           ) = 'all'
           and private.effective_pipeline_scope_for_user(
             candidate.id, v_company_uuid, 'pipeline.edit'
           ) = 'all'
           and private.effective_pipeline_scope_for_user(
             candidate.id, v_company_uuid, 'pipeline.view'
           ) = 'all'
       );
    get diagnostics v_resolved_count = row_count;

    v_body := case
      when v_affected_count = 1 then
        format(
          '1 active lead conversation still uses %s. Reconnect it, set external forwarding, or start a new client conversation.',
          v_connection.email
        )
      else
        format(
          '%s active lead conversations still use %s. Reconnect it, set external forwarding, or start a new client conversation.',
          v_affected_count,
          v_connection.email
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
      dedupe_key
    )
    select
      candidate.id::text,
      v_connection.company_id,
      'system',
      'Personal mailbox needs attention',
      v_body,
      false,
      true,
      '/pipeline',
      'Review leads',
      v_dedupe_key
    from public.users as candidate
    where candidate.company_id = v_company_uuid
      and candidate.deleted_at is null
      and coalesce(candidate.is_active, false)
      and private.effective_pipeline_scope_for_user(
        candidate.id, v_company_uuid, 'pipeline.assign'
      ) = 'all'
      and private.effective_pipeline_scope_for_user(
        candidate.id, v_company_uuid, 'pipeline.edit'
      ) = 'all'
      and private.effective_pipeline_scope_for_user(
        candidate.id, v_company_uuid, 'pipeline.view'
      ) = 'all'
    on conflict do nothing;

    -- Refresh the count/copy on the one open row per recipient. The partial
    -- dedupe index prevents a concurrent processor from creating a duplicate.
    update public.notifications as notification
       set title = 'Personal mailbox needs attention',
           body = v_body,
           persistent = true,
           action_url = '/pipeline',
           action_label = 'Review leads'
     where notification.company_id = v_connection.company_id
       and notification.type = 'system'
       and notification.dedupe_key = v_dedupe_key
       and notification.is_read = false
       and notification.resolved_at is null
       and exists (
         select 1
         from public.users as candidate
         where candidate.id::text = notification.user_id
           and candidate.company_id = v_company_uuid
           and candidate.deleted_at is null
           and coalesce(candidate.is_active, false)
           and private.effective_pipeline_scope_for_user(
             candidate.id, v_company_uuid, 'pipeline.assign'
           ) = 'all'
           and private.effective_pipeline_scope_for_user(
             candidate.id, v_company_uuid, 'pipeline.edit'
           ) = 'all'
           and private.effective_pipeline_scope_for_user(
             candidate.id, v_company_uuid, 'pipeline.view'
           ) = 'all'
       );

    select count(*)::integer
      into v_notified_count
    from public.users as candidate
    where candidate.company_id = v_company_uuid
      and candidate.deleted_at is null
      and coalesce(candidate.is_active, false)
      and private.effective_pipeline_scope_for_user(
        candidate.id, v_company_uuid, 'pipeline.assign'
      ) = 'all'
      and private.effective_pipeline_scope_for_user(
        candidate.id, v_company_uuid, 'pipeline.edit'
      ) = 'all'
      and private.effective_pipeline_scope_for_user(
        candidate.id, v_company_uuid, 'pipeline.view'
      ) = 'all';

    if v_notified_count = 0 then
      raise exception
        'no active company-wide assignment user can receive mailbox warning';
    end if;
  end if;

  update public.email_connection_lifecycle_outbox as event
     set processed_at = clock_timestamp(),
         attempt_count = event.attempt_count + 1,
         last_error = null
   where event.connection_id = p_connection_id
     and event.requested_at = v_event.requested_at;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'personal mailbox lifecycle event changed during processing';
  end if;

  return query
  select v_affected_count, v_notified_count, v_resolved_count;
end;
$$;

revoke all on function public.process_personal_mailbox_lifecycle_event(uuid)
  from public, anon, authenticated;
grant execute on function public.process_personal_mailbox_lifecycle_event(uuid)
  to service_role;

create or replace function public.queue_personal_mailbox_connection_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform public.enqueue_personal_mailbox_lifecycle_event(
    new.id,
    'connection_status_changed'
  );
  return new;
end;
$$;

create or replace function public.queue_personal_mailbox_thread_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_personal_mailbox_lifecycle_event(
      old.connection_id,
      'thread_relationship_changed'
    );
    return old;
  end if;

  perform public.enqueue_personal_mailbox_lifecycle_event(
    new.connection_id,
    'thread_relationship_changed'
  );
  if tg_op = 'UPDATE' and old.connection_id is distinct from new.connection_id then
    perform public.enqueue_personal_mailbox_lifecycle_event(
      old.connection_id,
      'thread_relationship_changed'
    );
  end if;
  return new;
end;
$$;

create or replace function public.queue_personal_mailbox_link_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.connection_id is not null then
      perform public.enqueue_personal_mailbox_lifecycle_event(
        old.connection_id,
        'thread_relationship_changed'
      );
    end if;
    return old;
  end if;

  if new.connection_id is not null then
    perform public.enqueue_personal_mailbox_lifecycle_event(
      new.connection_id,
      'thread_relationship_changed'
    );
  end if;
  if tg_op = 'UPDATE'
     and old.connection_id is distinct from new.connection_id
     and old.connection_id is not null then
    perform public.enqueue_personal_mailbox_lifecycle_event(
      old.connection_id,
      'thread_relationship_changed'
    );
  end if;
  return new;
end;
$$;

create or replace function public.queue_personal_mailbox_opportunity_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_connection_id uuid;
begin
  for v_connection_id in
    select thread.connection_id
    from public.email_threads as thread
    where thread.opportunity_id = new.id
    union
    select link.connection_id
    from public.opportunity_email_threads as link
    where link.opportunity_id = new.id
      and link.connection_id is not null
  loop
    perform public.enqueue_personal_mailbox_lifecycle_event(
      v_connection_id,
      'opportunity_state_changed'
    );
  end loop;
  return new;
end;
$$;

revoke all on function public.queue_personal_mailbox_connection_change()
  from public, anon, authenticated;
revoke all on function public.queue_personal_mailbox_thread_change()
  from public, anon, authenticated;
revoke all on function public.queue_personal_mailbox_link_change()
  from public, anon, authenticated;
revoke all on function public.queue_personal_mailbox_opportunity_change()
  from public, anon, authenticated;

drop trigger if exists email_connections_personal_lifecycle_queue
  on public.email_connections;
create trigger email_connections_personal_lifecycle_queue
after update of status, sync_enabled on public.email_connections
for each row
when (
  old.status is distinct from new.status
  or old.sync_enabled is distinct from new.sync_enabled
)
execute function public.queue_personal_mailbox_connection_change();

drop trigger if exists email_threads_personal_lifecycle_insert_delete_queue
  on public.email_threads;
create trigger email_threads_personal_lifecycle_insert_delete_queue
after insert or delete on public.email_threads
for each row execute function public.queue_personal_mailbox_thread_change();

drop trigger if exists email_threads_personal_lifecycle_update_queue
  on public.email_threads;
create trigger email_threads_personal_lifecycle_update_queue
after update of connection_id, provider_thread_id, opportunity_id, archived_at, company_id
on public.email_threads
for each row execute function public.queue_personal_mailbox_thread_change();

drop trigger if exists opportunity_email_threads_personal_lifecycle_insert_delete_queue
  on public.opportunity_email_threads;
create trigger opportunity_email_threads_personal_lifecycle_insert_delete_queue
after insert or delete on public.opportunity_email_threads
for each row execute function public.queue_personal_mailbox_link_change();

drop trigger if exists opportunity_email_threads_personal_lifecycle_update_queue
  on public.opportunity_email_threads;
create trigger opportunity_email_threads_personal_lifecycle_update_queue
after update of connection_id, thread_id, opportunity_id
on public.opportunity_email_threads
for each row execute function public.queue_personal_mailbox_link_change();

drop trigger if exists opportunities_personal_mailbox_lifecycle_queue
  on public.opportunities;
create trigger opportunities_personal_mailbox_lifecycle_queue
after update of stage, archived_at, deleted_at, company_id
on public.opportunities
for each row
when (
  old.stage is distinct from new.stage
  or old.archived_at is distinct from new.archived_at
  or old.deleted_at is distinct from new.deleted_at
  or old.company_id is distinct from new.company_id
)
execute function public.queue_personal_mailbox_opportunity_change();

-- Existing disabled personal connections predate these triggers. Seed one
-- coalesced event per connection so the retry worker can warn only where an
-- active lead-linked conversation is actually found.
insert into public.email_connection_lifecycle_outbox (
  connection_id,
  company_id,
  reason,
  requested_at,
  processed_at,
  last_error
)
select
  connection.id,
  connection.company_id::text,
  'migration_backfill',
  clock_timestamp(),
  null,
  null
from public.email_connections as connection
where connection.type::text = 'individual'
  and (
    connection.status <> 'active'
    or not connection.sync_enabled
  )
on conflict (connection_id) do update
  set company_id = excluded.company_id,
      reason = excluded.reason,
      requested_at = excluded.requested_at,
      processed_at = null,
      last_error = null;

commit;
