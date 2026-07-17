begin;

-- Project status writes have two independent responsibilities: authorize the
-- transition (including the dedicated archive permission) and durably queue
-- the timeline/notification/Phase-C lifecycle work in the same transaction.
-- Browser callbacks may eagerly drain this queue, but never own durability.

-- Project lifecycle code has long treated this company JSON as canonical, but
-- the historical migration chain never declared it on a clean database.
alter table public.companies
  add column if not exists lifecycle_settings jsonb;

-- `updated_at` is driven by PostgreSQL `now()`, which is transaction-stable.
-- A monotonic row version is therefore the only safe way to distinguish an
-- ABA sequence (A -> B -> A -> B), including multiple changes in one xact.
alter table public.projects
  add column if not exists status_version bigint not null default 0;

alter table public.projects
  drop constraint if exists projects_status_version_nonnegative;
alter table public.projects
  add constraint projects_status_version_nonnegative
  check (status_version >= 0);

create or replace function private.bump_project_status_version()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if new.status is distinct from old.status then
    new.status_version := old.status_version + 1;
    -- This trigger sorts after the legacy generic timestamp trigger so every
    -- real status mutation receives a fresh wall-clock CAS token, including
    -- trigger-driven transitions that do not explicitly touch updated_at.
    new.updated_at := clock_timestamp();
  else
    -- `status_version` is trigger-owned even when a caller tries to write it
    -- directly through a broad legacy table grant.
    new.status_version := old.status_version;
  end if;
  return new;
end;
$function$;

revoke all on function private.bump_project_status_version()
  from public, anon, authenticated, service_role;

drop trigger if exists projects_bump_status_version on public.projects;
drop trigger if exists zz_projects_bump_status_version on public.projects;
create trigger zz_projects_bump_status_version
before update of status, status_version on public.projects
for each row
execute function private.bump_project_status_version();

create table if not exists public.project_status_lifecycle_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  old_status text not null,
  new_status text not null,
  project_status_version bigint not null check (project_status_version >= 1),
  project_updated_at timestamptz not null,
  requested_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  worker_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  last_error text
);

create index if not exists project_status_lifecycle_outbox_pending_idx
  on public.project_status_lifecycle_outbox (available_at, requested_at, id)
  where status in ('pending', 'processing');

alter table public.project_status_lifecycle_outbox enable row level security;
revoke all on table public.project_status_lifecycle_outbox
  from public, anon, authenticated, service_role;

-- A stable lifecycle event id makes the timeline insert and every downstream
-- notification idempotent even when a worker dies after a side effect.
create unique index if not exists project_notes_status_lifecycle_event_unique
  on public.project_notes ((content_metadata ->> 'lifecycle_event_id'))
  where event_kind = 'status_change'
    and content_metadata ? 'lifecycle_event_id';

-- Timeline rows are a projection of the immutable outbox event, not authority.
-- Browser roles may create ordinary notes but cannot forge a lifecycle event
-- id, and no role may later rewrite/delete a projected lifecycle audit row.
create or replace function private.guard_project_status_lifecycle_note()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_old_event_id text := case
    when tg_op in ('UPDATE', 'DELETE')
      then nullif(btrim(old.content_metadata ->> 'lifecycle_event_id'), '')
    else null
  end;
  v_new_event_id text := case
    when tg_op in ('INSERT', 'UPDATE')
      then nullif(btrim(new.content_metadata ->> 'lifecycle_event_id'), '')
    else null
  end;
begin
  if tg_op = 'INSERT' then
    if new.event_kind = 'status_change'
       and (
         v_new_event_id is null
         or v_new_event_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ) then
      raise exception 'status lifecycle proof is required'
        using errcode = '22023';
    end if;
    if (new.event_kind = 'status_change' or v_new_event_id is not null)
       and auth.role() is distinct from 'service_role' then
      raise exception 'project lifecycle notes are server-authored'
        using errcode = '42501';
    end if;
    if new.event_kind = 'status_change'
       and not exists (
         select 1
         from public.project_status_lifecycle_outbox event
         where event.id = v_new_event_id::uuid
           and event.company_id::text = new.company_id
           and event.project_id::text = new.project_id
           and event.old_status = new.content_metadata ->> 'from'
           and event.new_status = new.content_metadata ->> 'to'
           and event.project_status_version::text =
             new.content_metadata ->> 'lifecycle_status_version'
       ) then
      raise exception 'status lifecycle proof is invalid'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if old.event_kind = 'status_change' or v_old_event_id is not null then
    raise exception 'project lifecycle notes are immutable'
      using errcode = '55000';
  end if;
  if new.event_kind = 'status_change' or v_new_event_id is not null then
    raise exception 'project lifecycle notes are server-authored'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_project_status_lifecycle_note()
  from public, anon, authenticated, service_role;

drop trigger if exists project_notes_guard_status_lifecycle on public.project_notes;
create trigger project_notes_guard_status_lifecycle
before insert or update or delete on public.project_notes
for each row
execute function private.guard_project_status_lifecycle_note();

-- Dedupe must outlive the unread/pending lifecycle of the projected rows.
-- Otherwise a worker crash after a user reads/approves an effect can recreate
-- the same notification or Phase-C action on retry.
create unique index if not exists notifications_project_status_event_unique
  on public.notifications (user_id, company_id, dedupe_key)
  where dedupe_key like 'project-status-lifecycle:%';

create unique index if not exists agent_actions_project_status_event_unique
  on public.agent_actions (company_id, action_type, source_id)
  where source_id like 'project-status-lifecycle:%';

-- Event IDs provide retry identity; these semantic keys additionally prevent
-- two different status events (for example a fast ABA) from racing identical
-- still-pending Phase-C proposals into the queue.
with duplicate_lifecycle_tasks as (
  select action.id,
         row_number() over (
           partition by
             action.company_id,
             action.action_data ->> 'project_id',
             coalesce(
               nullif(action.action_data ->> 'task_type_id', ''),
               'title:' || lower(btrim(action.action_data ->> 'custom_title'))
             )
           order by action.created_at, action.id
         ) as duplicate_rank
    from public.agent_actions action
   where action.status = 'pending'
     and action.action_type = 'create_task'
     and action.context_source = 'stage_change'
     and nullif(action.action_data ->> 'project_id', '') is not null
)
update public.agent_actions action
   set status = 'cancelled',
       error = 'Superseded duplicate lifecycle proposal'
  from duplicate_lifecycle_tasks duplicate
 where action.id = duplicate.id
   and duplicate.duplicate_rank > 1;

create unique index if not exists agent_actions_pending_lifecycle_task_unique
  on public.agent_actions (
    company_id,
    (action_data ->> 'project_id'),
    (coalesce(
      nullif(action_data ->> 'task_type_id', ''),
      'title:' || lower(btrim(action_data ->> 'custom_title'))
    ))
  )
  where status = 'pending'
    and action_type = 'create_task'
    and context_source = 'stage_change'
    and nullif(action_data ->> 'project_id', '') is not null;

with duplicate_estimate_invoices as (
  select action.id,
         row_number() over (
           partition by
             action.company_id,
             action.action_data ->> 'estimate_id'
           order by action.created_at, action.id
         ) as duplicate_rank
    from public.agent_actions action
   where action.status = 'pending'
     and action.action_type = 'create_invoice'
     and nullif(action.action_data ->> 'estimate_id', '') is not null
)
update public.agent_actions action
   set status = 'cancelled',
       error = 'Superseded duplicate invoice proposal'
  from duplicate_estimate_invoices duplicate
 where action.id = duplicate.id
   and duplicate.duplicate_rank > 1;

create unique index if not exists agent_actions_pending_estimate_invoice_unique
  on public.agent_actions (
    company_id,
    (action_data ->> 'estimate_id')
  )
  where status = 'pending'
    and action_type = 'create_invoice'
    and nullif(action_data ->> 'estimate_id', '') is not null;

with duplicate_project_invoices as (
  select action.id,
         row_number() over (
           partition by
             action.company_id,
             action.action_data ->> 'project_id'
           order by action.created_at, action.id
         ) as duplicate_rank
    from public.agent_actions action
   where action.status = 'pending'
     and action.action_type = 'create_invoice'
     and nullif(action.action_data ->> 'project_id', '') is not null
     and nullif(action.action_data ->> 'estimate_id', '') is null
)
update public.agent_actions action
   set status = 'cancelled',
       error = 'Superseded duplicate invoice proposal'
  from duplicate_project_invoices duplicate
 where action.id = duplicate.id
   and duplicate.duplicate_rank > 1;

create unique index if not exists agent_actions_pending_project_invoice_unique
  on public.agent_actions (
    company_id,
    (action_data ->> 'project_id')
  )
  where status = 'pending'
    and action_type = 'create_invoice'
    and nullif(action_data ->> 'project_id', '') is not null
    and nullif(action_data ->> 'estimate_id', '') is null;

create or replace function private.enqueue_project_status_lifecycle()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_system_actor text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- The paid-invoice cascade is a nested system trigger. The authenticated
  -- payment recorder is not the person who decided to move the project, so it
  -- must never be attributed to them or used as Phase-C authority.
  if pg_trigger_depth() > 1
     and current_setting('ops.project_status_system_source', true) =
       'paid_invoice' then
    v_actor_user_id := null;

  -- A service-only guarded RPC may snapshot the real OPS actor for attribution.
  -- Company mailbox/provider identity is never an actor input.
  elsif auth.role() = 'service_role' then
    v_system_actor := nullif(
      btrim(current_setting('ops.project_status_actor_id', true)),
      ''
    );
    if v_system_actor is not null
       and v_system_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_actor_user_id := v_system_actor::uuid;
    end if;
  end if;

  insert into public.project_status_lifecycle_outbox (
    company_id,
    project_id,
    actor_user_id,
    old_status,
    new_status,
    project_status_version,
    project_updated_at
  ) values (
    new.company_id,
    new.id,
    v_actor_user_id,
    old.status,
    new.status,
    new.status_version,
    new.updated_at
  );

  return new;
end;
$function$;

revoke all on function private.enqueue_project_status_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists projects_enqueue_status_lifecycle on public.projects;
create trigger projects_enqueue_status_lifecycle
after update of status on public.projects
for each row
when (old.status is distinct from new.status)
execute function private.enqueue_project_status_lifecycle();

-- Preserve the source-agnostic paid-invoice cascade while marking the nested
-- status transition as actorless. Payment recording must never be blocked by
-- this best-effort convenience; the durable close proposal remains fallback.
create or replace function public.close_project_when_fully_paid()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_outstanding numeric(12,2);
  v_prior_source text := current_setting(
    'ops.project_status_system_source',
    true
  );
begin
  if new.project_id is null then
    return new;
  end if;

  select coalesce(sum(invoice.balance_due), 0)
    into v_outstanding
    from public.invoices invoice
   where invoice.project_id = new.project_id
     and invoice.deleted_at is null
     and invoice.status <> 'void';

  if v_outstanding <= 0 then
    perform set_config(
      'ops.project_status_system_source',
      'paid_invoice',
      true
    );
    update public.projects
       set status = 'closed'
     where id = new.project_id
       and status = 'completed'
       and deleted_at is null;
    perform set_config(
      'ops.project_status_system_source',
      coalesce(v_prior_source, ''),
      true
    );
  end if;

  return new;
exception
  when others then
    perform set_config(
      'ops.project_status_system_source',
      coalesce(v_prior_source, ''),
      true
    );
    raise warning 'close_project_when_fully_paid failed for invoice % (project %): %',
      new.id, new.project_id, sqlerrm;
    return new;
end;
$function$;

revoke all on function public.close_project_when_fully_paid()
  from public, anon, authenticated, service_role;

-- Closing and subsequently creating new debt must serialize on the project
-- row. A concurrent invoice mutation either commits first (so close sees its
-- balance) or waits, observes the newly closed project, and is rejected until
-- an operator deliberately reopens it.
create or replace function private.guard_closed_project_invoice_balance()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_project_status text;
begin
  if new.project_id is null
     or new.deleted_at is not null
     or new.status = 'void'
     or coalesce(new.balance_due, 0) <= 0 then
    return new;
  end if;

  select project.status
    into v_project_status
    from public.projects project
   where project.id = new.project_id
     and project.deleted_at is null
   for share;

  if v_project_status = 'closed' then
    raise exception 'reopen the project before adding an outstanding balance'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_closed_project_invoice_balance()
  from public, anon, authenticated, service_role;

drop trigger if exists invoices_guard_closed_project_balance
  on public.invoices;
create trigger invoices_guard_closed_project_balance
before insert or update of project_id, balance_due, status, deleted_at
on public.invoices
for each row
execute function private.guard_closed_project_invoice_balance();

-- One immutable, service-only proof resolves the historical actor, current
-- event version, copy inputs, and active task-derived recipients in one
-- statement. The actor's authority was proven by the guarded mutation that
-- created this event; a later revoke must not strand an otherwise-valid event.
-- Email/login identity and caller-supplied company/copy never enter the seam.
create or replace function public.resolve_project_status_notification_as_system(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_event_id uuid
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_proof jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_project_id is null or p_event_id is null then
    raise exception 'invalid notification proof' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'event_id', event.id,
    'company_id', event.company_id,
    'project_id', event.project_id,
    'actor_user_id', event.actor_user_id,
    'old_status', event.old_status,
    'new_status', event.new_status,
    'status_version', event.project_status_version,
    'project_title', project.title,
    'recipient_user_ids', (
      select coalesce(
        jsonb_agg(member.member_id order by member.member_id),
        '[]'::jsonb
      )
      from (
        select distinct recipient.id as member_id
        from public.project_tasks task
        cross join lateral unnest(
          coalesce(task.team_member_ids, array[]::text[])
        ) as members(member_id)
        join public.users recipient
          on recipient.id::text = members.member_id
        where task.project_id = project.id
          and task.company_id = project.company_id
          and task.deleted_at is null
          and private.user_can_view_project(
            recipient.id,
            project.id
          )
      ) member
    )
  ) into v_proof
  from public.project_status_lifecycle_outbox event
  join public.projects project
    on project.id = event.project_id
   and project.company_id = event.company_id
   and project.deleted_at is null
  where event.id = p_event_id
    and event.project_id = p_project_id
    and event.actor_user_id = p_actor_user_id
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and project.status = event.new_status
    and project.status_version = event.project_status_version;

  return v_proof;
end;
$function$;

revoke all on function public.resolve_project_status_notification_as_system(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_project_status_notification_as_system(uuid, uuid, uuid)
  to service_role;

-- RLS is column-agnostic, so add a restrictive new-row policy that blocks a
-- direct browser update to archived unless the current OPS user has the
-- dedicated all-scope archive permission. Service role still has to use the
-- guarded bridge below in application code so actor attribution is retained.
drop policy if exists project_archive_write_scope on public.projects;
create policy project_archive_write_scope
on public.projects
as restrictive
for update
to public
using (true)
with check (
  status <> 'archived'
  or public.has_permission(
    private.get_current_user_id(),
    'projects.archive',
    'all'
  )
);

-- Replace the timestamp-only legacy RPC with a version-aware CAS, close its
-- SECURITY DEFINER archive bypass, and let the outbox own durable follow-up.
create or replace function public.change_project_status(
  p_project_id uuid,
  p_new_status text,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  raise exception 'project status version is required'
    using errcode = '55000';
end;
$function$;

revoke all on function public.change_project_status(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.change_project_status(
  p_project_id uuid,
  p_new_status text,
  p_expected_updated_at timestamptz,
  p_expected_status_version bigint
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_project public.projects%rowtype;
  v_company_id uuid;
  v_updated_at timestamptz;
  v_status_version bigint;
  v_actor_user_id uuid := private.get_current_user_id();
begin
  if p_project_id is null
     or p_new_status is null
     or p_expected_updated_at is null
     or p_expected_status_version is null
     or p_expected_status_version < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  if p_new_status not in ('rfq', 'estimated', 'accepted', 'in_progress', 'completed', 'closed', 'archived') then
    raise exception 'invalid project status' using errcode = '22023';
  end if;

  select p.company_id into v_company_id
  from public.projects p
  where p.id = p_project_id and p.deleted_at is null;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform private.lock_lead_assignment_company(v_company_id);
  perform 1
    from public.companies company
   where company.id = v_company_id
   for share;
  perform 1
    from public.users actor
   where actor.id = v_actor_user_id
   for share;

  if not private.user_can_edit_project(v_actor_user_id, p_project_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_new_status = 'archived'
     and not public.has_permission(v_actor_user_id, 'projects.archive', 'all') then
    raise exception 'project archive permission required' using errcode = '42501';
  end if;

  select * into v_project
  from public.projects
  where id = p_project_id and deleted_at is null
  for update;

  if not found
     or v_project.company_id is distinct from v_company_id
     or v_project.updated_at is distinct from p_expected_updated_at
     or v_project.status_version is distinct from p_expected_status_version then
    raise exception 'project conflict' using errcode = 'P0001';
  end if;
  -- Re-check after taking the row lock so a concurrent membership/status
  -- change cannot race the canonical authorization snapshot.
  if not private.user_can_edit_project(v_actor_user_id, p_project_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_new_status = 'archived'
     and not public.has_permission(v_actor_user_id, 'projects.archive', 'all') then
    raise exception 'project archive permission required' using errcode = '42501';
  end if;
  if v_project.status is not distinct from p_new_status then
    return jsonb_build_object(
      'changed', false,
      'updated_at', v_project.updated_at,
      'status_version', v_project.status_version,
      'from_status', v_project.status,
      'to_status', p_new_status
    );
  end if;

  update public.projects
  set status = p_new_status, updated_at = now()
  where id = p_project_id
  returning updated_at, status_version into v_updated_at, v_status_version;

  return jsonb_build_object(
    'changed', true,
    'updated_at', v_updated_at,
    'status_version', v_status_version,
    'from_status', v_project.status,
    'to_status', p_new_status
  );
end;
$function$;

revoke all on function public.change_project_status(uuid, text, timestamptz, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.change_project_status(uuid, text, timestamptz, bigint)
  to anon, authenticated;

-- Bulk table status edits carry the same monotonic snapshot. Other bulk edits
-- retain their historical timestamp CAS and simply report the unchanged status
-- version for cache/undo reconciliation.
create or replace function public.bulk_update_project_table(
  p_operations jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_operation jsonb;
  v_action text;
  v_project_id uuid;
  v_expected_updated_at timestamptz;
  v_expected_status_version bigint;
  v_success jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_result jsonb;
  v_updated_at timestamptz;
  v_status_version bigint;
begin
  if p_operations is null or jsonb_typeof(p_operations) <> 'array' then
    raise exception 'invalid operations' using errcode = '22023';
  end if;
  if jsonb_array_length(p_operations) > 100 then
    raise exception 'too many operations' using errcode = '22023';
  end if;

  for v_operation in select * from jsonb_array_elements(p_operations)
  loop
    begin
      v_action := v_operation ->> 'action';
      v_project_id := (v_operation ->> 'project_id')::uuid;
      v_expected_updated_at := (
        v_operation ->> 'expected_updated_at'
      )::timestamptz;
      v_status_version := null;

      if v_project_id is null or v_expected_updated_at is null then
        raise exception 'invalid operation' using errcode = '22023';
      end if;

      if v_action = 'status' then
        v_expected_status_version := (
          v_operation ->> 'expected_status_version'
        )::bigint;
        if v_expected_status_version is null
           or v_expected_status_version < 0 then
          raise exception 'project status version is required'
            using errcode = '22023';
        end if;
        v_result := public.change_project_status(
          v_project_id,
          v_operation ->> 'status',
          v_expected_updated_at,
          v_expected_status_version
        );
        v_updated_at := (v_result ->> 'updated_at')::timestamptz;
        v_status_version := (v_result ->> 'status_version')::bigint;

      elsif v_action = 'date' then
        if (v_operation ->> 'field') not in ('start_date', 'end_date') then
          raise exception 'invalid date field' using errcode = '22023';
        end if;
        if not private.current_user_can_edit_project(v_project_id) then
          raise exception 'permission denied' using errcode = '42501';
        end if;

        if v_operation ->> 'field' = 'start_date' then
          update public.projects project
             set start_date = nullif(v_operation ->> 'value', '')::date,
                 updated_at = now()
           where project.id = v_project_id
             and project.deleted_at is null
             and project.company_id = private.get_user_company_id()
             and project.updated_at = v_expected_updated_at
          returning project.updated_at, project.status_version
               into v_updated_at, v_status_version;
        else
          update public.projects project
             set end_date = nullif(v_operation ->> 'value', '')::date,
                 updated_at = now()
           where project.id = v_project_id
             and project.deleted_at is null
             and project.company_id = private.get_user_company_id()
             and project.updated_at = v_expected_updated_at
          returning project.updated_at, project.status_version
               into v_updated_at, v_status_version;
        end if;
        if v_updated_at is null then
          raise exception 'project conflict' using errcode = 'P0001';
        end if;

      elsif v_action = 'assign_team' then
        v_result := public.assign_project_team_member(
          v_project_id,
          (v_operation ->> 'user_id')::uuid,
          array(
            select jsonb_array_elements_text(
              v_operation -> 'task_ids'
            )::uuid
          ),
          v_expected_updated_at
        );
        v_updated_at := (v_result ->> 'updated_at')::timestamptz;

      elsif v_action = 'remove_team' then
        v_result := public.remove_project_team_member(
          v_project_id,
          (v_operation ->> 'user_id')::uuid,
          case
            when v_operation ? 'task_ids'
              and jsonb_typeof(v_operation -> 'task_ids') = 'array'
              then array(
                select jsonb_array_elements_text(
                  v_operation -> 'task_ids'
                )::uuid
              )
            else null
          end,
          v_expected_updated_at
        );
        v_updated_at := (v_result ->> 'updated_at')::timestamptz;

      else
        raise exception 'invalid action' using errcode = '22023';
      end if;

      if v_status_version is null then
        select project.status_version
          into v_status_version
          from public.projects project
         where project.id = v_project_id;
      end if;

      v_success := v_success || jsonb_build_array(jsonb_build_object(
        'project_id', v_project_id,
        'updated_at', v_updated_at,
        'status_version', v_status_version,
        'action', v_action
      ));
    exception
      when others then
        v_failed := v_failed || jsonb_build_array(jsonb_build_object(
          'project_id', coalesce(v_operation ->> 'project_id', ''),
          'action', coalesce(v_action, v_operation ->> 'action', ''),
          'code', sqlstate,
          'message', sqlerrm
        ));
    end;
  end loop;

  return jsonb_build_object(
    'success', v_success,
    'failed', v_failed,
    'success_count', jsonb_array_length(v_success),
    'failed_count', jsonb_array_length(v_failed)
  );
end;
$function$;

revoke all on function public.bulk_update_project_table(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.bulk_update_project_table(jsonb)
  to anon, authenticated;

-- Service workflows must provide the canonical OPS user UUID and pass the same
-- row-specific project authorization as the human route. Email/provider/login
-- addresses are deliberately absent from this contract.
create or replace function public.change_project_status_as_system(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_new_status text,
  p_expected_updated_at timestamptz,
  p_expected_status text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  raise exception 'project status version is required'
    using errcode = '55000';
end;
$function$;

revoke all on function public.change_project_status_as_system(uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated, service_role;

create or replace function public.change_project_status_as_system(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_new_status text,
  p_expected_updated_at timestamptz,
  p_expected_status text,
  p_expected_status_version bigint
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_project public.projects%rowtype;
  v_company_id uuid;
  v_updated_at timestamptz;
  v_status_version bigint;
  v_prior_actor text := current_setting('ops.project_status_actor_id', true);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_project_id is null or p_new_status is null
     or p_expected_updated_at is null or p_expected_status is null
     or p_expected_status_version is null
     or p_expected_status_version < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if p_new_status not in ('rfq', 'estimated', 'accepted', 'in_progress', 'completed', 'closed', 'archived') then
    raise exception 'invalid project status' using errcode = '22023';
  end if;

  select p.company_id into v_company_id
  from public.projects p
  where p.id = p_project_id and p.deleted_at is null;
  if not found then
    raise exception 'project access denied' using errcode = '42501';
  end if;
  perform private.lock_lead_assignment_company(v_company_id);
  perform 1
    from public.companies company
   where company.id = v_company_id
   for share;
  perform 1
    from public.users actor
   where actor.id = p_actor_user_id
   for share;

  if not private.user_can_edit_project(p_actor_user_id, p_project_id) then
    raise exception 'project access denied' using errcode = '42501';
  end if;
  if p_new_status = 'archived'
     and not public.has_permission(p_actor_user_id, 'projects.archive', 'all') then
    raise exception 'project archive permission required' using errcode = '42501';
  end if;

  select * into v_project
  from public.projects
  where id = p_project_id and deleted_at is null
  for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if v_project.company_id is distinct from v_company_id
     or v_project.updated_at is distinct from p_expected_updated_at
     or v_project.status is distinct from p_expected_status
     or v_project.status_version is distinct from p_expected_status_version then
    raise exception 'project conflict' using errcode = 'P0001';
  end if;
  -- Authorization is intentionally repeated under the project row lock.
  if not private.user_can_edit_project(p_actor_user_id, p_project_id) then
    raise exception 'project access denied' using errcode = '42501';
  end if;
  if p_new_status = 'archived'
     and not public.has_permission(p_actor_user_id, 'projects.archive', 'all') then
    raise exception 'project archive permission required' using errcode = '42501';
  end if;
  if v_project.status is not distinct from p_new_status then
    return jsonb_build_object(
      'changed', false,
      'updated_at', v_project.updated_at,
      'status_version', v_project.status_version,
      'from_status', v_project.status,
      'to_status', p_new_status
    );
  end if;

  perform set_config('ops.project_status_actor_id', p_actor_user_id::text, true);
  update public.projects
  set status = p_new_status, updated_at = now()
  where id = p_project_id
  returning updated_at, status_version into v_updated_at, v_status_version;
  perform set_config(
    'ops.project_status_actor_id',
    coalesce(v_prior_actor, ''),
    true
  );

  return jsonb_build_object(
    'changed', true,
    'updated_at', v_updated_at,
    'status_version', v_status_version,
    'from_status', v_project.status,
    'to_status', p_new_status
  );
exception
  when others then
    perform set_config(
      'ops.project_status_actor_id',
      coalesce(v_prior_actor, ''),
      true
    );
    raise;
end;
$function$;

revoke all on function public.change_project_status_as_system(uuid, uuid, text, timestamptz, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.change_project_status_as_system(uuid, uuid, text, timestamptz, text, bigint)
  to service_role;

-- Approval-queue terminal project actions are one recoverable transaction:
-- reviewer attribution, current authorization, proposal CAS, close eligibility,
-- project mutation/outbox enqueue, and action execution state either all land
-- or none do. The action UUID is the durable idempotency key.
create or replace function public.execute_project_status_action_as_system(
  p_actor_user_id uuid,
  p_action_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_action public.agent_actions%rowtype;
  v_project public.projects%rowtype;
  v_company_id uuid;
  v_project_id uuid;
  v_expected_status text;
  v_expected_updated_at timestamptz;
  v_expected_status_version bigint;
  v_target_status text;
  v_failure text;
  v_outstanding numeric := 0;
  v_close_after_days integer := 30;
  v_latest_task_activity timestamptz;
  v_updated_at timestamptz;
  v_status_version bigint;
  v_execution_result jsonb;
  v_prior_actor text := current_setting('ops.project_status_actor_id', true);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_action_id is null then
    raise exception 'invalid action execution arguments' using errcode = '22023';
  end if;

  -- Read only the company key before acquiring the shared company lock. All
  -- authority and mutation inputs are re-read from the locked row below.
  select action.company_id
    into v_company_id
    from public.agent_actions action
   where action.id = p_action_id;
  if not found then
    raise exception 'action access denied' using errcode = '42501';
  end if;
  perform private.lock_lead_assignment_company(v_company_id);
  perform 1
    from public.companies company
   where company.id = v_company_id
   for share;
  perform 1
    from public.users actor
   where actor.id = p_actor_user_id
   for share;

  select *
    into v_action
    from public.agent_actions action
   where action.id = p_action_id
     and action.company_id = v_company_id
   for update;
  if not found
     or v_action.action_type not in ('close_project', 'archive_project') then
    raise exception 'action access denied' using errcode = '42501';
  end if;

  -- The service bridge authenticates the real OPS actor server-side, but the
  -- database remains the final approval-authority boundary.
  if not exists (
    select 1
      from public.users actor
      join public.companies company
        on company.id = actor.company_id
     where actor.id = p_actor_user_id
       and actor.company_id = v_action.company_id
       and actor.deleted_at is null
       and coalesce(actor.is_active, false)
       and (
         company.account_holder_id = actor.id::text
         or actor.id::text = any(
           coalesce(company.admin_ids, array[]::text[])
         )
       )
  ) then
    raise exception 'action access denied' using errcode = '42501';
  end if;

  if v_action.status = 'executed' then
    if v_action.reviewed_by is distinct from p_actor_user_id then
      raise exception 'action access denied' using errcode = '42501';
    end if;
    return jsonb_build_object(
      'ok', true,
      'action_id', v_action.id,
      'status', v_action.status,
      'execution_result', v_action.execution_result,
      'recovered', true
    );
  end if;
  if v_action.status in ('failed', 'expired') then
    if v_action.reviewed_by is distinct from p_actor_user_id then
      raise exception 'action access denied' using errcode = '42501';
    end if;
    return jsonb_build_object(
      'ok', false,
      'action_id', v_action.id,
      'status', v_action.status,
      'reason', coalesce(v_action.error, 'Action is no longer executable'),
      'recovered', true
    );
  end if;
  if v_action.status not in ('pending', 'approved')
     or (v_action.status = 'pending' and v_action.reviewed_by is not null)
     or (v_action.status = 'approved'
         and v_action.reviewed_by is distinct from p_actor_user_id) then
    raise exception 'action already handled' using errcode = 'P0001';
  end if;

  if v_action.expires_at is not null and v_action.expires_at <= now() then
    update public.agent_actions action
       set status = 'expired',
           reviewed_by = coalesce(action.reviewed_by, p_actor_user_id),
           reviewed_at = coalesce(action.reviewed_at, clock_timestamp()),
           error = 'Action expired before execution'
     where action.id = v_action.id;
    return jsonb_build_object(
      'ok', false,
      'action_id', v_action.id,
      'status', 'expired',
      'reason', 'Action expired before execution'
    );
  end if;

  begin
    if coalesce(v_action.action_data ->> 'project_id', '')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid project id';
    end if;
    v_project_id := (v_action.action_data ->> 'project_id')::uuid;
    v_expected_status := nullif(
      btrim(v_action.action_data ->> 'expected_project_status'),
      ''
    );
    v_expected_updated_at := (
      v_action.action_data ->> 'expected_project_updated_at'
    )::timestamptz;
    v_expected_status_version := (
      v_action.action_data ->> 'expected_project_status_version'
    )::bigint;
    if v_expected_status is null
       or v_expected_updated_at is null
       or v_expected_status_version < 0 then
      raise exception 'missing status snapshot';
    end if;
  exception
    when others then
      v_failure := case v_action.action_type
        when 'close_project' then 'Close proposal has no valid project status snapshot'
        else 'Archive proposal has no valid project status snapshot'
      end;
      update public.agent_actions action
         set status = 'failed',
             reviewed_by = coalesce(action.reviewed_by, p_actor_user_id),
             reviewed_at = coalesce(action.reviewed_at, clock_timestamp()),
             error = v_failure
       where action.id = v_action.id;
      return jsonb_build_object(
        'ok', false,
        'action_id', v_action.id,
        'status', 'failed',
        'reason', v_failure
      );
  end;

  select *
    into v_project
    from public.projects project
   where project.id = v_project_id
     and project.company_id = v_action.company_id
     and project.deleted_at is null
   for update;
  if not found then
    v_failure := 'Project is no longer available';
    update public.agent_actions action
       set status = 'failed',
           reviewed_by = coalesce(action.reviewed_by, p_actor_user_id),
           reviewed_at = coalesce(action.reviewed_at, clock_timestamp()),
           error = v_failure
     where action.id = v_action.id;
    return jsonb_build_object(
      'ok', false,
      'action_id', v_action.id,
      'status', 'failed',
      'reason', v_failure
    );
  end if;

  if not private.user_can_edit_project(p_actor_user_id, v_project.id) then
    raise exception 'project access denied' using errcode = '42501';
  end if;
  if v_action.action_type = 'archive_project'
     and not public.has_permission(
       p_actor_user_id,
       'projects.archive',
       'all'
     ) then
    raise exception 'project archive permission required'
      using errcode = '42501';
  end if;

  if v_project.status is distinct from v_expected_status
     or v_project.updated_at is distinct from v_expected_updated_at
     or v_project.status_version is distinct from v_expected_status_version then
    v_failure := 'Project changed since this action was proposed';
    update public.agent_actions action
       set status = 'failed',
           reviewed_by = coalesce(action.reviewed_by, p_actor_user_id),
           reviewed_at = coalesce(action.reviewed_at, clock_timestamp()),
           error = v_failure
     where action.id = v_action.id;
    return jsonb_build_object(
      'ok', false,
      'action_id', v_action.id,
      'status', 'failed',
      'reason', v_failure
    );
  end if;

  v_target_status := case v_action.action_type
    when 'close_project' then 'closed'
    else 'archived'
  end;

  if v_action.action_type = 'close_project' then
    if v_project.status <> 'completed'
       or exists (
         select 1
           from public.project_tasks task
          where task.project_id = v_project.id
            and task.company_id = v_project.company_id
            and task.deleted_at is null
            and lower(task.status) not in (
              'completed',
              'complete',
              'cancelled'
            )
       ) then
      v_failure := 'Project is no longer complete and ready to close';
    else
      select coalesce(sum(invoice.balance_due), 0)
        into v_outstanding
        from public.invoices invoice
       where invoice.project_id = v_project.id
         and invoice.deleted_at is null
         and invoice.status <> 'void';
      if v_outstanding > 0 then
        v_failure := 'Project has an outstanding invoice balance';
      end if;
    end if;

    if v_failure is null then
      select case
        when jsonb_typeof(company.lifecycle_settings -> 'archive_after_days') =
          'number'
          then greatest(
            0,
            (company.lifecycle_settings ->> 'archive_after_days')::integer
          )
        else 30
      end
        into v_close_after_days
        from public.companies company
       where company.id = v_project.company_id;

      select max(task.updated_at)
        into v_latest_task_activity
        from public.project_tasks task
       where task.project_id = v_project.id
         and task.company_id = v_project.company_id
         and task.deleted_at is null;

      if v_close_after_days <= 0
         or greatest(
           v_project.updated_at,
           coalesce(v_latest_task_activity, v_project.updated_at)
         ) > clock_timestamp() - make_interval(days => v_close_after_days) then
        v_failure := 'Project no longer meets the close inactivity window';
      end if;
    end if;

    if v_failure is not null then
      update public.agent_actions action
         set status = 'failed',
             reviewed_by = coalesce(action.reviewed_by, p_actor_user_id),
             reviewed_at = coalesce(action.reviewed_at, clock_timestamp()),
             error = v_failure
       where action.id = v_action.id;
      return jsonb_build_object(
        'ok', false,
        'action_id', v_action.id,
        'status', 'failed',
        'reason', v_failure
      );
    end if;
  end if;

  -- Authorization and eligibility are repeated after every lock and directly
  -- before persistence. Task mutations share this company/project lock order.
  if not private.user_can_edit_project(p_actor_user_id, v_project.id) then
    raise exception 'project access denied' using errcode = '42501';
  end if;
  if v_action.action_type = 'archive_project'
     and not public.has_permission(
       p_actor_user_id,
       'projects.archive',
       'all'
     ) then
    raise exception 'project archive permission required'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.users actor
      join public.companies company
        on company.id = actor.company_id
     where actor.id = p_actor_user_id
       and actor.company_id = v_action.company_id
       and actor.deleted_at is null
       and coalesce(actor.is_active, false)
       and (
         company.account_holder_id = actor.id::text
         or actor.id::text = any(
           coalesce(company.admin_ids, array[]::text[])
         )
       )
  ) then
    raise exception 'action access denied' using errcode = '42501';
  end if;

  perform set_config('ops.project_status_actor_id', p_actor_user_id::text, true);
  update public.projects project
     set status = v_target_status
   where project.id = v_project.id
   returning project.updated_at, project.status_version
        into v_updated_at, v_status_version;
  perform set_config(
    'ops.project_status_actor_id',
    coalesce(v_prior_actor, ''),
    true
  );

  v_execution_result := jsonb_build_object(
    'projectId', v_project.id,
    'projectTitle', v_project.title,
    case v_action.action_type
      when 'close_project' then 'closedAt'
      else 'archivedAt'
    end,
    v_updated_at,
    'statusVersion', v_status_version,
    'executionKey', 'project-status-action:' || v_action.id::text
  );

  update public.agent_actions action
     set status = 'executed',
         reviewed_by = coalesce(action.reviewed_by, p_actor_user_id),
         reviewed_at = coalesce(action.reviewed_at, clock_timestamp()),
         executed_at = clock_timestamp(),
         execution_result = v_execution_result,
         error = null
   where action.id = v_action.id;

  return jsonb_build_object(
    'ok', true,
    'action_id', v_action.id,
    'status', 'executed',
    'execution_result', v_execution_result,
    'recovered', false
  );
exception
  when others then
    perform set_config(
      'ops.project_status_actor_id',
      coalesce(v_prior_actor, ''),
      true
    );
    raise;
end;
$function$;

revoke all on function public.execute_project_status_action_as_system(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.execute_project_status_action_as_system(uuid, uuid)
  to service_role;

create or replace function public.terminalize_expired_project_status_lifecycle_events()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_terminalized integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.project_status_lifecycle_outbox event
  set status = 'failed',
      completed_at = now(),
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = coalesce(
        event.last_error,
        'Lifecycle worker lease expired after maximum attempts'
      )
  where event.status = 'processing'
    and event.attempts >= 10
    and event.lease_expires_at <= now();
  get diagnostics v_terminalized = row_count;
  return v_terminalized;
end;
$function$;

create or replace function public.claim_project_status_lifecycle_events(
  p_worker_id uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 180
) returns table (
  event_id uuid,
  lease_token uuid,
  company_id uuid,
  project_id uuid,
  actor_user_id uuid,
  old_status text,
  new_status text,
  project_status_version bigint,
  project_updated_at timestamptz,
  requested_at timestamptz,
  attempt integer
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_limit < 1 or p_limit > 100
     or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid claim arguments' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select event.id
    from public.project_status_lifecycle_outbox event
    where event.status in ('pending', 'processing')
      and event.available_at <= now()
      and (
        event.status = 'pending'
        or event.lease_expires_at is null
        or event.lease_expires_at <= now()
      )
      and event.attempts < 10
    order by event.requested_at, event.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.project_status_lifecycle_outbox event
    set status = 'processing',
        attempts = event.attempts + 1,
        worker_id = p_worker_id,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        last_error = null
    from candidates
    where event.id = candidates.id
    returning event.*
  )
  select
    claimed.id,
    claimed.lease_token,
    claimed.company_id,
    claimed.project_id,
    claimed.actor_user_id,
    claimed.old_status,
    claimed.new_status,
    claimed.project_status_version,
    claimed.project_updated_at,
    claimed.requested_at,
    claimed.attempts
  from claimed
  order by claimed.requested_at, claimed.id;
end;
$function$;

create or replace function public.complete_project_status_lifecycle_event(
  p_event_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_completed_count bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.project_status_lifecycle_outbox event
  set status = 'completed',
      completed_at = now(),
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = null
  where event.id = p_event_id
    and event.status = 'processing'
    and event.lease_token = p_lease_token
    and event.lease_expires_at > now();
  get diagnostics v_completed_count = row_count;
  return v_completed_count = 1;
end;
$function$;

create or replace function public.fail_project_status_lifecycle_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean default true
) returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_attempts integer;
  v_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select event.attempts into v_attempts
  from public.project_status_lifecycle_outbox event
  where event.id = p_event_id
    and event.status = 'processing'
    and event.lease_token = p_lease_token
    and event.lease_expires_at > now()
  for update;
  if not found then
    return 'stale';
  end if;

  v_status := case
    when p_retryable and v_attempts < 10 then 'pending'
    else 'failed'
  end;
  update public.project_status_lifecycle_outbox event
  set status = v_status,
      available_at = case
        when v_status = 'pending'
          then now() + make_interval(
            secs => least(900, 15 * power(2, least(v_attempts, 6)))
          )
        else event.available_at
      end,
      completed_at = case when v_status = 'failed' then now() else null end,
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(p_error, 'Unknown lifecycle failure'), 2000)
  where event.id = p_event_id;
  return v_status;
end;
$function$;

revoke all on function public.claim_project_status_lifecycle_events(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_project_status_lifecycle_event(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_project_status_lifecycle_event(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.terminalize_expired_project_status_lifecycle_events()
  from public, anon, authenticated, service_role;
grant execute on function public.terminalize_expired_project_status_lifecycle_events()
  to service_role;
grant execute on function public.claim_project_status_lifecycle_events(uuid, integer, integer)
  to service_role;
grant execute on function public.complete_project_status_lifecycle_event(uuid, uuid)
  to service_role;
grant execute on function public.fail_project_status_lifecycle_event(uuid, uuid, text, boolean)
  to service_role;

commit;
