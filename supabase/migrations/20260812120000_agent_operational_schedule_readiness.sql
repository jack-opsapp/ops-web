-- Fixed operational source fencing and exact schedule-confirmation identity for
-- the dark OPS agent-control-plane schedule/readiness capabilities.

begin;

-- A confirmation is current only when it names the exact schedule_version it
-- confirmed. Legacy timestamps remain intact for audit/business history but do
-- not prove a current confirmation until an authorized confirmation write
-- stamps the new version field.
alter table public.project_tasks
  add column if not exists confirmed_schedule_version bigint;

alter table public.project_tasks
  drop constraint if exists project_tasks_confirmation_version_current;
alter table public.project_tasks
  add constraint project_tasks_confirmation_version_current
  check (
    (
      schedule_confirmed_at is null
      and schedule_confirmed_by is null
      and confirmed_schedule_version is null
    )
    or (
      schedule_confirmed_at is not null
      and (
        confirmed_schedule_version is null
        or confirmed_schedule_version = schedule_version
      )
    )
  );

create or replace function private.bump_project_task_schedule_version()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_schedule_changed boolean := false;
begin
  -- This row-level boundary precedes the legacy schedule comparator and the
  -- AFTER automation producer. Both inspect assignment arrays, so accepting an
  -- oversized OLD or NEW value here would make every later helper bound too
  -- late. Existing production rows are below this limit; a separately bounded
  -- repair is required if a future import ever violates it.
  if cardinality(coalesce(new.team_member_ids, array[]::text[])) > 100 then
    raise exception 'project_task_assignment_source_query_bound'
      using errcode = '22023';
  end if;
  if tg_op = 'UPDATE'
     and cardinality(coalesce(old.team_member_ids, array[]::text[])) > 100 then
    raise exception 'project_task_assignment_source_query_bound'
      using errcode = '22023';
  end if;
  -- A task's tenant and project determine its customer, mailbox, permission
  -- and confirmation proof boundary. Reparenting cannot be represented as an
  -- ordinary schedule edit, so reject it before any schedule comparator or
  -- customer-communication producer can observe the mismatched identity.
  if tg_op = 'UPDATE'
     and (
       new.company_id is distinct from old.company_id
       or new.project_id is distinct from old.project_id
     ) then
    raise exception 'project_task_parent_immutable'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.schedule_version := case
      when new.start_date is not null
        or new.end_date is not null
        or new.start_time is not null
        or new.end_time is not null
        or new.all_day is distinct from true
        or coalesce(new.duration, 1) is distinct from 1
        or cardinality(coalesce(new.team_member_ids, array[]::text[])) > 0
      then 1
      else 0
    end;
    -- Direct INSERT remains legacy/unproven. Only the guarded service RPC
    -- below may bind a confirmation to an exact schedule version.
    new.confirmed_schedule_version := null;
    if new.schedule_confirmed_at is null then
      new.schedule_confirmed_by := null;
    end if;
    return new;
  end if;

  -- Lifecycle is part of the confirmation identity. A terminal transition
  -- clears proof and advances the version, and a later reopen advances again;
  -- neither transition is a customer-facing reschedule event.
  v_schedule_changed := private.project_task_schedule_changed(old, new)
    or old.status is distinct from new.status;
  new.schedule_version := case
    when v_schedule_changed then old.schedule_version + 1
    else old.schedule_version
  end;

  if v_schedule_changed then
    new.schedule_confirmed_at := null;
    new.schedule_confirmed_by := null;
    new.confirmed_schedule_version := null;
  elsif current_setting(
          'ops.authorized_schedule_confirmation_action',
          true
        ) = 'confirm'
        and new.schedule_confirmed_at is not null
        and current_setting(
          'ops.authorized_schedule_confirmation_version',
          true
        ) = new.schedule_version::text
        and current_setting(
          'ops.authorized_schedule_confirmation_task_id',
          true
        ) = new.id::text
        and current_setting(
          'ops.authorized_schedule_confirmation_company_id',
          true
        ) = new.company_id::text then
    new.confirmed_schedule_version := new.schedule_version;
  elsif current_setting(
          'ops.authorized_schedule_confirmation_action',
          true
        ) = 'unconfirm'
        and current_setting(
          'ops.authorized_schedule_confirmation_version',
          true
        ) = new.schedule_version::text
        and current_setting(
          'ops.authorized_schedule_confirmation_task_id',
          true
        ) = new.id::text
        and current_setting(
          'ops.authorized_schedule_confirmation_company_id',
          true
        ) = new.company_id::text then
    new.schedule_confirmed_at := null;
    new.schedule_confirmed_by := null;
    new.confirmed_schedule_version := null;
  else
    -- Confirmation provenance is one trigger-owned identity. An unmarked
    -- writer may not forge, rewrite, or clear any part while leaving the
    -- other two fields looking authoritative.
    new.schedule_confirmed_at := old.schedule_confirmed_at;
    new.schedule_confirmed_by := old.schedule_confirmed_by;
    new.confirmed_schedule_version := old.confirmed_schedule_version;
  end if;

  return new;
end;
$function$;

revoke all on function private.bump_project_task_schedule_version()
  from public, anon, authenticated, service_role;

drop trigger if exists project_tasks_bump_schedule_version
  on public.project_tasks;
create trigger project_tasks_bump_schedule_version
before insert or update on public.project_tasks
for each row
execute function private.bump_project_task_schedule_version();

-- The project client is the recipient boundary for every confirmed task on
-- that project. A reassignment must first explicitly clear all current task
-- proofs; otherwise a later schedule edit could address the new client using
-- confirmation provenance created for the previous one.
create or replace function private.guard_confirmed_project_client_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if new.client_id is distinct from old.client_id
     and exists (
       select 1
       from public.project_tasks task
       where task.project_id = old.id
         and task.company_id = old.company_id
         and task.deleted_at is null
         and task.schedule_confirmed_at is not null
         and task.confirmed_schedule_version = task.schedule_version
     ) then
    raise exception 'confirmed_project_client_change_forbidden'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_confirmed_project_client_identity()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_confirmed_project_client_identity
  on public.projects;
create trigger guard_confirmed_project_client_identity
before update of client_id on public.projects
for each row
execute function private.guard_confirmed_project_client_identity();

comment on column public.project_tasks.confirmed_schedule_version is
  'Trigger-owned schedule_version that the current confirmation proves; NULL means no current confirmation proof.';

-- Confirmation and unconfirmation side effects use the existing leased task
-- automation outbox. The schedule state transition and its retryable dispatch
-- proof therefore commit together; route/worker crashes cannot lose the
-- customer communication. These two purpose events deliberately use their own
-- timestamp-bearing identities so confirm -> unconfirm -> reconfirm at the
-- same schedule_version remains representable.
alter table public.task_schedule_automation_outbox
  drop constraint if exists task_schedule_automation_outbox_kind_check;
alter table public.task_schedule_automation_outbox
  add constraint task_schedule_automation_outbox_kind_check check (
    kind in (
      'full_auto_confirmation',
      'schedule_cascade',
      'confirmed_reschedule',
      'task_assigned',
      'task_completed',
      'schedule_change',
      'schedule_confirmation_dispatch',
      'schedule_unconfirmation_dispatch'
    )
  );

alter table public.task_schedule_automation_outbox
  drop constraint if exists task_schedule_automation_outbox_task_schedule_version_check;
alter table public.task_schedule_automation_outbox
  add constraint task_schedule_automation_outbox_task_schedule_version_check
  check (
    task_schedule_version >= 0
    and (
      kind in (
        'task_assigned',
        'task_completed',
        'schedule_change',
        'schedule_confirmation_dispatch',
        'schedule_unconfirmation_dispatch'
      )
      or task_schedule_version >= 1
    )
  );

create unique index if not exists
  task_schedule_confirmation_dispatch_identity
on public.task_schedule_automation_outbox (
  task_id,
  task_schedule_version,
  ((after_snapshot ->> 'schedule_confirmed_at'))
)
where kind = 'schedule_confirmation_dispatch';

create unique index if not exists
  task_schedule_unconfirmation_dispatch_identity
on public.task_schedule_automation_outbox (
  task_id,
  task_schedule_version,
  ((before_snapshot ->> 'schedule_confirmed_at'))
)
where kind = 'schedule_unconfirmation_dispatch';

-- All legacy schedule-automation producers call these shared snapshot helpers
-- from row triggers. Bound the source inside the helpers themselves so no
-- DECLARE initializer or future caller can materialize an adversarial crew
-- array before a later purpose check. Existing production data is <=32; 100 is
-- the fixed source-inspection ceiling used by every Task11 projection.
create or replace function private.task_schedule_automation_snapshot(
  p_task public.project_tasks
) returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_team_member_ids jsonb;
begin
  if cardinality(
    coalesce(p_task.team_member_ids, array[]::text[])
  ) > 100 then
    raise exception 'task_assignment_source_query_bound'
      using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(member_id order by member_id), '[]'::jsonb)
  into v_team_member_ids
  from (
    select distinct member_id
    from unnest(
      (coalesce(p_task.team_member_ids, array[]::text[]))[1:100]
    ) member_id
  ) members;
  return jsonb_build_object(
    'start_date', p_task.start_date,
    'end_date', p_task.end_date,
    'start_time', p_task.start_time,
    'end_time', p_task.end_time,
    'all_day', p_task.all_day,
    'duration', p_task.duration,
    'team_member_ids', v_team_member_ids,
    'project_id', p_task.project_id,
    'task_type_id', p_task.task_type_id,
    'custom_title', p_task.custom_title,
    'status', p_task.status,
    'deleted_at', p_task.deleted_at,
    'schedule_confirmed_at', p_task.schedule_confirmed_at,
    'schedule_version', p_task.schedule_version
  );
end;
$function$;

revoke all on function private.task_schedule_automation_snapshot(
  public.project_tasks
) from public, anon, authenticated, service_role;

create or replace function private.task_schedule_automation_snapshot_matches(
  p_task public.project_tasks,
  p_snapshot jsonb,
  p_schedule_version bigint
) returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_team_member_ids jsonb;
begin
  if cardinality(
    coalesce(p_task.team_member_ids, array[]::text[])
  ) > 100 then
    return false;
  end if;
  select coalesce(jsonb_agg(member_id order by member_id), '[]'::jsonb)
  into v_team_member_ids
  from (
    select distinct member_id
    from unnest(
      (coalesce(p_task.team_member_ids, array[]::text[]))[1:100]
    ) member_id
  ) members;
  return p_task.schedule_version = p_schedule_version
    and p_snapshot -> 'schedule_version' = to_jsonb(p_schedule_version)
    and p_snapshot -> 'start_date' = coalesce(
      to_jsonb(p_task.start_date), 'null'::jsonb
    )
    and p_snapshot -> 'end_date' = coalesce(
      to_jsonb(p_task.end_date), 'null'::jsonb
    )
    and p_snapshot -> 'start_time' = coalesce(
      to_jsonb(p_task.start_time), 'null'::jsonb
    )
    and p_snapshot -> 'end_time' = coalesce(
      to_jsonb(p_task.end_time), 'null'::jsonb
    )
    and p_snapshot -> 'all_day' = coalesce(
      to_jsonb(p_task.all_day), 'null'::jsonb
    )
    and p_snapshot -> 'duration' = coalesce(
      to_jsonb(p_task.duration), 'null'::jsonb
    )
    and p_snapshot -> 'team_member_ids' = v_team_member_ids
    and p_snapshot ->> 'project_id' = p_task.project_id::text
    and p_snapshot ->> 'status' = p_task.status;
end;
$function$;

revoke all on function private.task_schedule_automation_snapshot_matches(
  public.project_tasks, jsonb, bigint
) from public, anon, authenticated, service_role;

create or replace function private.enqueue_schedule_confirmation_dispatch(
  p_kind text,
  p_task public.project_tasks,
  p_actor_user_id uuid,
  p_dispatch_origin text default null,
  p_previous_confirmed_at timestamptz default null,
  p_previous_confirmed_by uuid default null,
  p_previous_confirmed_version bigint default null,
  p_previous_task public.project_tasks default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_event_id uuid;
  v_after_snapshot jsonb;
  v_before_snapshot jsonb;
begin
  if p_kind not in (
       'schedule_confirmation_dispatch',
       'schedule_unconfirmation_dispatch'
     )
     or (
       p_kind = 'schedule_confirmation_dispatch'
       and (
         p_dispatch_origin is null
         or p_dispatch_origin not in (
           'manual', 'automatic_grace', 'full_auto'
         )
       )
     )
     or (
       p_kind = 'schedule_unconfirmation_dispatch'
       and p_dispatch_origin not in ('explicit_admin', 'schedule_edit')
     )
     or p_task.id is null
     or p_task.company_id is null
     or p_task.schedule_version is null
     or cardinality(
       coalesce(p_task.team_member_ids, array[]::text[])
     ) > 100 then
    raise exception 'invalid_schedule_confirmation_dispatch'
      using errcode = '22023';
  end if;

  if p_kind = 'schedule_unconfirmation_dispatch' then
    if p_previous_task.id is null
       or p_previous_task.id is distinct from p_task.id
       or p_previous_task.company_id is distinct from p_task.company_id
       or p_previous_confirmed_at is null
       or p_previous_task.schedule_confirmed_at is distinct from
         p_previous_confirmed_at
       or p_previous_task.schedule_confirmed_by is distinct from
         p_previous_confirmed_by
       or p_previous_task.confirmed_schedule_version is distinct from
         p_previous_confirmed_version
       or p_task.schedule_confirmed_at is not null
       or p_task.schedule_confirmed_by is not null
       or p_task.confirmed_schedule_version is not null
       or p_dispatch_origin = 'explicit_admin' and (
         p_task.schedule_version is distinct from p_previous_task.schedule_version
         or private.project_task_schedule_changed(p_previous_task, p_task)
       )
       or p_dispatch_origin = 'schedule_edit' and (
         p_previous_task.confirmed_schedule_version is null
         or p_previous_task.schedule_version is null
         or not coalesce(
           p_previous_task.schedule_version = p_previous_confirmed_version,
           false
         )
         or not coalesce(
           p_task.schedule_version = p_previous_task.schedule_version + 1,
           false
         )
         or not private.project_task_schedule_changed(p_previous_task, p_task)
       ) then
      raise exception 'invalid_schedule_unconfirmation_dispatch'
        using errcode = '22023';
    end if;
  end if;

  v_after_snapshot := private.task_schedule_automation_snapshot(p_task)
    || jsonb_build_object(
      'schedule_confirmed_at', case when p_task.schedule_confirmed_at is null
        then null
        else to_char(
          p_task.schedule_confirmed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      end,
      'schedule_confirmed_by', p_task.schedule_confirmed_by,
      'confirmed_schedule_version', p_task.confirmed_schedule_version,
      'confirmation_origin', case
        when p_kind = 'schedule_confirmation_dispatch'
          then p_dispatch_origin
        else null
      end,
      'schedule_unconfirmation_origin', case
        when p_kind = 'schedule_unconfirmation_dispatch'
          then p_dispatch_origin
        else null
      end,
      'change_kind', case
        when p_kind = 'schedule_unconfirmation_dispatch'
         and p_dispatch_origin = 'schedule_edit'
         and p_task.start_date is null then 'unscheduled'
        when p_kind = 'schedule_unconfirmation_dispatch'
          then 'rescheduled'
        else null
      end
    );
  v_before_snapshot := case
    when p_kind = 'schedule_unconfirmation_dispatch' then
      private.task_schedule_automation_snapshot(p_previous_task)
      || jsonb_build_object(
        'schedule_confirmed_at', case when p_previous_confirmed_at is null
          then null
          else to_char(
            p_previous_confirmed_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        end,
        'schedule_confirmed_by', p_previous_confirmed_by,
        'confirmed_schedule_version', p_previous_confirmed_version,
        'confirmation_origin', null,
        'schedule_unconfirmation_origin', p_dispatch_origin
      )
    else '{}'::jsonb
  end;

  insert into public.task_schedule_automation_outbox (
    kind,
    company_id,
    task_id,
    actor_user_id,
    before_snapshot,
    after_snapshot,
    task_schedule_version,
    task_updated_at
  ) values (
    p_kind,
    p_task.company_id,
    p_task.id,
    p_actor_user_id,
    v_before_snapshot,
    v_after_snapshot,
    p_task.schedule_version,
    p_task.updated_at
  )
  on conflict do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select event.id into v_event_id
    from public.task_schedule_automation_outbox event
    where event.task_id = p_task.id
      and event.task_schedule_version = p_task.schedule_version
      and event.kind = p_kind
      and case
        when p_kind = 'schedule_confirmation_dispatch'
          then event.after_snapshot ->> 'schedule_confirmed_at' =
            v_after_snapshot ->> 'schedule_confirmed_at'
        else event.before_snapshot ->> 'schedule_confirmed_at' =
          v_before_snapshot ->> 'schedule_confirmed_at'
      end
    order by event.requested_at, event.id
    limit 1;
  end if;
  if v_event_id is null then
    raise exception 'schedule_confirmation_dispatch_conflict'
      using errcode = '40001';
  end if;
  return v_event_id;
end;
$function$;

revoke all on function private.enqueue_schedule_confirmation_dispatch(
  text, public.project_tasks, uuid, text, timestamptz, uuid, bigint,
  public.project_tasks
) from public, anon, authenticated, service_role;

-- Replace the legacy AFTER producer so changing a currently proven schedule
-- writes the proof clear and its recoverable customer-communication event in
-- the same transaction. The old confirmed_reschedule kind cannot represent
-- the cleared proof and must never be emitted for this transition.
create or replace function private.enqueue_task_schedule_automation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_service_actor text;
  v_schedule_changed boolean := false;
  v_notification_schedule_changed boolean := false;
  v_assignment_added boolean := false;
  v_assignment_removed boolean := false;
  v_enqueued_schedule_unconfirmation boolean := false;
begin
  if auth.role() = 'service_role' then
    v_service_actor := nullif(
      btrim(current_setting('ops.task_mutation_actor_id', true)),
      ''
    );
    if v_service_actor is not null
       and pg_input_is_valid(v_service_actor, 'uuid') then
      v_actor_user_id := v_service_actor::uuid;
    else
      v_actor_user_id := null;
    end if;
  end if;

  if v_actor_user_id is not null and not exists (
    select 1
    from public.users actor
    where actor.id = v_actor_user_id
      and actor.company_id = new.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    v_actor_user_id := null;
  end if;

  if tg_op = 'INSERT' then
    if new.deleted_at is null
       and cardinality(coalesce(new.team_member_ids, array[]::text[])) > 0 then
      perform private.enqueue_task_mutation_event(
        'task_assigned', null, new, v_actor_user_id
      );
    end if;
    if new.start_date is not null and new.deleted_at is null then
      perform private.enqueue_task_schedule_automation_kind(
        'schedule_cascade', null, new, v_actor_user_id
      );
      perform private.enqueue_task_schedule_automation_kind(
        'full_auto_confirmation', null, new, v_actor_user_id
      );
    end if;
    return new;
  end if;

  v_schedule_changed := private.project_task_schedule_changed(old, new);
  v_notification_schedule_changed :=
    private.project_task_notification_schedule_changed(old, new);
  v_assignment_added := exists (
    select 1
    from unnest(coalesce(new.team_member_ids, array[]::text[])) member_id
    where not (
      member_id = any(coalesce(old.team_member_ids, array[]::text[]))
    )
  );
  v_assignment_removed := exists (
    select 1
    from unnest(coalesce(old.team_member_ids, array[]::text[])) member_id
    where not (
      member_id = any(coalesce(new.team_member_ids, array[]::text[]))
    )
  );

  if new.deleted_at is null then
    if v_assignment_added then
      perform private.enqueue_task_mutation_event(
        'task_assigned', old, new, v_actor_user_id
      );
    end if;
    if old.status is distinct from 'completed'
       and new.status = 'completed' then
      perform private.enqueue_task_mutation_event(
        'task_completed', old, new, v_actor_user_id
      );
    end if;
    if new.status = 'active'
       and (v_notification_schedule_changed or v_assignment_removed) then
      perform private.enqueue_task_mutation_event(
        'schedule_change', old, new, v_actor_user_id
      );
    end if;
  end if;

  if not v_schedule_changed then
    return new;
  end if;

  perform private.enqueue_task_schedule_automation_kind(
    'schedule_cascade', old, new, v_actor_user_id
  );
  if old.schedule_confirmed_at is not null
     and old.confirmed_schedule_version = old.schedule_version then
    if v_actor_user_id is null
       or not private.user_can_edit_task(v_actor_user_id, new.id) then
      raise exception 'schedule_edit_unconfirmation_forbidden'
        using errcode = '42501';
    end if;
    perform private.enqueue_schedule_confirmation_dispatch(
      'schedule_unconfirmation_dispatch',
      new,
      v_actor_user_id,
      'schedule_edit',
      old.schedule_confirmed_at,
      old.schedule_confirmed_by,
      old.confirmed_schedule_version,
      old
    );
    v_enqueued_schedule_unconfirmation := true;
  end if;
  if not v_enqueued_schedule_unconfirmation
     and new.start_date is not null
     and new.schedule_confirmed_at is null then
    perform private.enqueue_task_schedule_automation_kind(
      'full_auto_confirmation', old, new, v_actor_user_id
    );
  end if;
  return new;
end;
$function$;

revoke all on function private.enqueue_task_schedule_automation()
  from public, anon, authenticated, service_role;

-- Keep the database authority gates byte-for-byte aligned with the existing
-- TypeScript legacy fallback. Missing current settings mean
-- draft_on_confirm + explicit; an explicit legacy false disables the level.
create or replace function private.agent_effective_confirmation_level(
  p_settings jsonb
) returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $function$
  select case
    when jsonb_typeof(
      coalesce(p_settings, '{}'::jsonb)
        #> '{appointment_confirmation,level}'
    ) = 'string'
      and coalesce(p_settings, '{}'::jsonb)
        #>> '{appointment_confirmation,level}' in (
          'off', 'manual', 'draft_on_confirm',
          'auto_send_on_confirm', 'full_auto'
        )
      then coalesce(p_settings, '{}'::jsonb)
        #>> '{appointment_confirmation,level}'
    when jsonb_typeof(
      coalesce(p_settings, '{}'::jsonb)
        #> '{appointment_confirmations,enabled}'
    ) = 'boolean'
      and not (
        coalesce(p_settings, '{}'::jsonb)
          #>> '{appointment_confirmations,enabled}'
      )::boolean
      then 'off'
    else 'draft_on_confirm'
  end;
$function$;

create or replace function private.agent_effective_confirmation_mode(
  p_settings jsonb
) returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $function$
  select case
    when coalesce(p_settings, '{}'::jsonb)
      #>> '{appointment_confirmation,confirm_mode}' = 'automatic'
      then 'automatic'
    else 'explicit'
  end;
$function$;

revoke all on function private.agent_effective_confirmation_level(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_effective_confirmation_mode(jsonb)
  from public, anon, authenticated, service_role;

-- Only purpose-specific, same-statement authority gates call this revoked
-- helper. Its three-part marker prevents one authorized write from blessing a
-- different task that happens to share the same schedule version.
create or replace function private.bind_project_task_schedule_confirmation(
  p_company_id uuid,
  p_task_id uuid,
  p_expected_schedule_version bigint,
  p_confirmed_by uuid
) returns public.project_tasks
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_updated_count bigint := 0;
  v_task public.project_tasks;
begin
  -- Serialize confirmation against projects.client_id reassignment. The
  -- client-change trigger holds this same parent row while proving no current
  -- task confirmation exists; locking it first makes both outcomes linear.
  select task.* into v_task
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = task.company_id
   and project.deleted_at is null
  where task.id = p_task_id
    and task.company_id = p_company_id
    and task.deleted_at is null
    and task.status = 'active'
    and task.start_date is not null
    and task.schedule_version = p_expected_schedule_version
  for update of project;
  if not found then
    raise exception 'schedule_confirmation_conflict'
      using errcode = '40001';
  end if;

  perform set_config(
    'ops.authorized_schedule_confirmation_action',
    'confirm',
    true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_company_id',
    p_company_id::text,
    true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_task_id',
    p_task_id::text,
    true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_version',
    p_expected_schedule_version::text,
    true
  );

  update public.project_tasks task
  set schedule_confirmed_at = date_trunc(
        'milliseconds', statement_timestamp()
      ),
      schedule_confirmed_by = p_confirmed_by
  where task.id = p_task_id
    and task.company_id = p_company_id
    and task.project_id = v_task.project_id
    and task.deleted_at is null
    and task.status = 'active'
    and task.start_date is not null
    and task.schedule_version = p_expected_schedule_version
  returning task.* into v_task;
  get diagnostics v_updated_count = row_count;

  perform set_config(
    'ops.authorized_schedule_confirmation_action', '', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_company_id', '', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_task_id', '', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_version', '', true
  );

  if v_updated_count <> 1
     or v_task.id is null
     or v_task.confirmed_schedule_version is distinct from
       v_task.schedule_version then
    raise exception 'schedule_confirmation_conflict'
      using errcode = '40001';
  end if;
  return v_task;
exception when others then
  perform set_config(
    'ops.authorized_schedule_confirmation_action', '', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_company_id', '', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_task_id', '', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_version', '', true
  );
  raise;
end;
$function$;

revoke all on function private.bind_project_task_schedule_confirmation(
  uuid, uuid, bigint, uuid
) from public, anon, authenticated, service_role;

-- Manual confirmation remains the existing admin/owner action, now with an
-- exact trigger-owned schedule-version proof. There is intentionally no
-- generic `automatic` discriminator on this public RPC.
create or replace function public.confirm_project_task_schedule_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_task_id uuid,
  p_expected_schedule_version bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_current public.project_tasks;
  v_task public.project_tasks;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_task_id is null
     or p_expected_schedule_version is null
     or p_expected_schedule_version < 0 then
    raise exception 'invalid_schedule_confirmation'
      using errcode = '22023';
  end if;
  if not private.user_is_company_admin(
    p_actor_user_id,
    p_company_id
  ) then
    raise exception 'schedule_confirmation_forbidden'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.admin_feature_overrides feature
    where feature.company_id = p_company_id::text
      and feature.feature_key = 'phase_c'
      and feature.enabled
  ) then
    raise exception 'schedule_confirmation_feature_disabled'
      using errcode = '42501';
  end if;

  select task.* into v_current
  from public.project_tasks task
  where task.id = p_task_id
    and task.company_id = p_company_id
    and task.deleted_at is null
    and task.status = 'active'
  for update;
  if not found
     or v_current.start_date is null
     or v_current.schedule_version is distinct from
       p_expected_schedule_version then
    raise exception 'schedule_confirmation_conflict'
      using errcode = '40001';
  end if;
  if v_current.schedule_confirmed_at is not null
     and v_current.confirmed_schedule_version =
       v_current.schedule_version then
    perform private.enqueue_schedule_confirmation_dispatch(
      'schedule_confirmation_dispatch',
      v_current,
      coalesce(v_current.schedule_confirmed_by, p_actor_user_id),
      'manual'
    );
    return jsonb_build_object(
      'task_id', v_current.id,
      'newly_confirmed', false,
      'confirmation_origin', 'manual',
      'schedule_confirmed_at', to_char(
        v_current.schedule_confirmed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'schedule_confirmed_by', v_current.schedule_confirmed_by,
      'confirmed_schedule_version', v_current.confirmed_schedule_version,
      'schedule_version', v_current.schedule_version
    );
  end if;

  v_task := private.bind_project_task_schedule_confirmation(
    p_company_id,
    p_task_id,
    p_expected_schedule_version,
    p_actor_user_id
  );
  perform private.enqueue_schedule_confirmation_dispatch(
    'schedule_confirmation_dispatch', v_task, p_actor_user_id, 'manual'
  );

  return jsonb_build_object(
    'task_id', v_task.id,
    'newly_confirmed', true,
    'confirmation_origin', 'manual',
    'schedule_confirmed_at', to_char(
      v_task.schedule_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'schedule_confirmed_by', v_task.schedule_confirmed_by,
    'confirmed_schedule_version', v_task.confirmed_schedule_version,
    'schedule_version', v_task.schedule_version
  );
end;
$function$;

revoke all on function public.confirm_project_task_schedule_as_system(
  uuid, uuid, uuid, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.confirm_project_task_schedule_as_system(
  uuid, uuid, uuid, bigint
) to service_role;

-- Unconfirmation clears the full proof under an admin/Phase-C/version gate.
-- The RPC returns a one-winner receipt so the route can run its existing
-- reschedule side effect only once after the guarded clear.
create or replace function public.unconfirm_project_task_schedule_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_task_id uuid,
  p_expected_schedule_version bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_updated_count bigint := 0;
  v_task public.project_tasks;
  v_previous_task public.project_tasks;
  v_previous_confirmed_at timestamptz;
  v_previous_confirmed_by uuid;
  v_previous_confirmed_version bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_task_id is null
     or p_expected_schedule_version is null
     or p_expected_schedule_version < 0 then
    raise exception 'invalid_schedule_unconfirmation'
      using errcode = '22023';
  end if;
  if not private.user_is_company_admin(p_actor_user_id, p_company_id)
     or not exists (
       select 1
       from public.admin_feature_overrides feature
       where feature.company_id = p_company_id::text
         and feature.feature_key = 'phase_c'
         and feature.enabled
     ) then
    raise exception 'schedule_unconfirmation_forbidden'
      using errcode = '42501';
  end if;

  select task.* into v_task
  from public.project_tasks task
  where task.id = p_task_id
    and task.company_id = p_company_id
    and task.deleted_at is null
  for update;
  if not found
     or v_task.schedule_version is distinct from
       p_expected_schedule_version then
    raise exception 'schedule_unconfirmation_conflict'
      using errcode = '40001';
  end if;
  if v_task.schedule_confirmed_at is null then
    return jsonb_build_object(
      'task_id', v_task.id,
      'newly_unconfirmed', false,
      'previous_schedule_confirmed_at', null,
      'schedule_version', v_task.schedule_version
    );
  end if;
  v_previous_confirmed_at := v_task.schedule_confirmed_at;
  v_previous_confirmed_by := v_task.schedule_confirmed_by;
  v_previous_confirmed_version := v_task.confirmed_schedule_version;
  v_previous_task := v_task;

  perform set_config(
    'ops.authorized_schedule_confirmation_action', 'unconfirm', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_company_id', p_company_id::text, true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_task_id', p_task_id::text, true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_version',
    p_expected_schedule_version::text,
    true
  );

  update public.project_tasks task
  set schedule_confirmed_at = null,
      schedule_confirmed_by = null
  where task.id = p_task_id
    and task.company_id = p_company_id
    and task.schedule_version = p_expected_schedule_version
  returning task.* into v_task;
  get diagnostics v_updated_count = row_count;

  perform set_config('ops.authorized_schedule_confirmation_action', '', true);
  perform set_config(
    'ops.authorized_schedule_confirmation_company_id', '', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_task_id', '', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_version', '', true
  );
  if v_updated_count <> 1
     or v_task.id is null
     or v_task.schedule_confirmed_at is not null
     or v_task.schedule_confirmed_by is not null
     or v_task.confirmed_schedule_version is not null then
    raise exception 'schedule_unconfirmation_conflict'
      using errcode = '40001';
  end if;
  perform private.enqueue_schedule_confirmation_dispatch(
    'schedule_unconfirmation_dispatch',
    v_task,
    p_actor_user_id,
    'explicit_admin',
    v_previous_confirmed_at,
    v_previous_confirmed_by,
    v_previous_confirmed_version,
    v_previous_task
  );
  return jsonb_build_object(
    'task_id', v_task.id,
    'newly_unconfirmed', true,
    'previous_schedule_confirmed_at', v_previous_confirmed_at,
    'schedule_version', v_task.schedule_version
  );
exception when others then
  perform set_config('ops.authorized_schedule_confirmation_action', '', true);
  perform set_config(
    'ops.authorized_schedule_confirmation_company_id', '', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_task_id', '', true
  );
  perform set_config(
    'ops.authorized_schedule_confirmation_version', '', true
  );
  raise;
end;
$function$;

revoke all on function public.unconfirm_project_task_schedule_as_system(
  uuid, uuid, uuid, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.unconfirm_project_task_schedule_as_system(
  uuid, uuid, uuid, bigint
) to service_role;

-- Automatic confirmation has its own same-statement eligibility RPC; there is
-- deliberately no public generic automatic discriminator.

-- Cron confirmation rechecks the entire eligibility predicate under one DB
-- snapshot and row locks. Candidate listing in TypeScript is only an
-- optimization and never grants authority.
create or replace function public.confirm_automatic_project_task_schedule_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_task_id uuid,
  p_expected_schedule_version bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_eligible boolean := false;
  v_grace_hours numeric := 4;
  v_current public.project_tasks;
  v_task public.project_tasks;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_task_id is null
     or p_expected_schedule_version is null
     or p_expected_schedule_version < 0 then
    raise exception 'invalid_automatic_schedule_confirmation'
      using errcode = '22023';
  end if;

  select task.* into v_current
  from public.project_tasks task
  where task.id = p_task_id
    and task.company_id = p_company_id
    and task.deleted_at is null
    and task.status = 'active'
  for update;
  if not found
     or v_current.start_date is null
     or v_current.schedule_version is distinct from
       p_expected_schedule_version then
    raise exception 'automatic_schedule_confirmation_not_eligible'
      using errcode = '40001';
  end if;
  select true,
         case
           when jsonb_typeof(
             company.client_comms_settings
               #> '{appointment_confirmation,auto_confirm_after_hours}'
           ) = 'number'
             then least(
               24::numeric,
               greatest(
                 1::numeric,
                 (
                   company.client_comms_settings
                     #>> '{appointment_confirmation,auto_confirm_after_hours}'
                 )::numeric
               )
             )
           else 4::numeric
         end
  into v_eligible, v_grace_hours
  from public.companies company
  join public.admin_feature_overrides feature
    on feature.company_id = company.id::text
   and feature.feature_key = 'phase_c'
   and feature.enabled
  join public.users actor
    on actor.id = p_actor_user_id
   and actor.company_id = company.id
   and actor.deleted_at is null
   and coalesce(actor.is_active, false)
  where company.id = p_company_id
    and company.client_comms_settings
      #>> '{appointment_confirmation,confirm_mode}' = 'automatic'
    and case
      when jsonb_typeof(
        company.client_comms_settings
          #> '{appointment_confirmation,level}'
      ) = 'string'
        then company.client_comms_settings
          #>> '{appointment_confirmation,level}'
      when jsonb_typeof(
        company.client_comms_settings
          #> '{appointment_confirmations,enabled}'
      ) = 'boolean'
        and not (
          company.client_comms_settings
            #>> '{appointment_confirmations,enabled}'
        )::boolean
        then 'off'
      else 'draft_on_confirm'
    end in ('draft_on_confirm', 'auto_send_on_confirm', 'full_auto')
  for share of company, feature, actor;

  if not coalesce(v_eligible, false) then
    raise exception 'automatic_schedule_confirmation_not_eligible'
      using errcode = '40001';
  end if;
  if not private.user_can_edit_task(p_actor_user_id, p_task_id) then
    raise exception 'automatic_schedule_confirmation_not_eligible'
      using errcode = '42501';
  end if;

  if v_current.schedule_confirmed_at is not null
     and v_current.confirmed_schedule_version =
       v_current.schedule_version then
    perform private.enqueue_schedule_confirmation_dispatch(
      'schedule_confirmation_dispatch',
      v_current,
      p_actor_user_id,
      'automatic_grace'
    );
    return jsonb_build_object(
      'task_id', v_current.id,
      'newly_confirmed', false,
      'confirmation_origin', 'automatic_grace',
      'schedule_confirmed_at', to_char(
        v_current.schedule_confirmed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'schedule_confirmed_by', v_current.schedule_confirmed_by,
      'confirmed_schedule_version', v_current.confirmed_schedule_version,
      'schedule_version', v_current.schedule_version
    );
  end if;

  if v_current.updated_at >= statement_timestamp() - make_interval(
       secs => (3600 * v_grace_hours)::double precision
     ) then
    raise exception 'automatic_schedule_confirmation_not_eligible'
      using errcode = '40001';
  end if;

  v_task := private.bind_project_task_schedule_confirmation(
    p_company_id,
    p_task_id,
    p_expected_schedule_version,
    null
  );
  perform private.enqueue_schedule_confirmation_dispatch(
    'schedule_confirmation_dispatch', v_task, p_actor_user_id,
    'automatic_grace'
  );
  return jsonb_build_object(
    'task_id', v_task.id,
    'newly_confirmed', true,
    'confirmation_origin', 'automatic_grace',
    'schedule_confirmed_at', to_char(
      v_task.schedule_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'schedule_confirmed_by', v_task.schedule_confirmed_by,
    'confirmed_schedule_version', v_task.confirmed_schedule_version,
    'schedule_version', v_task.schedule_version
  );
end;
$function$;

revoke all on function public.confirm_automatic_project_task_schedule_as_system(
  uuid, uuid, uuid, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.confirm_automatic_project_task_schedule_as_system(
  uuid, uuid, uuid, bigint
) to service_role;

-- Immediate full-auto uses the immutable leased task event, not the grace
-- period. The lease helper binds the exact task/version/snapshot; this wrapper
-- additionally rechecks the live feature/settings/actor boundary and then
-- uses the same trigger-owned stamp + durable dispatch event as every other
-- confirmation path.
create or replace function public.confirm_full_auto_project_task_schedule_as_system(
  p_event_id uuid,
  p_lease_token uuid,
  p_task_id uuid,
  p_expected_schedule_version bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_event public.task_schedule_automation_outbox;
  v_task public.project_tasks;
  v_newly_confirmed boolean := false;
  v_company public.companies;
  v_project_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_event_id is null
     or p_lease_token is null
     or p_task_id is null
     or p_expected_schedule_version is null
     or p_expected_schedule_version < 0 then
    raise exception 'invalid_full_auto_schedule_confirmation'
      using errcode = '22023';
  end if;

  -- Read the immutable lease identity first, then acquire locks in the same
  -- company -> project -> task -> event order as the canonical automation
  -- helper. A lost lease remains an error because this worker can no longer
  -- complete it; normal business-state drift is returned as a terminal result.
  select event.* into v_event
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.lease_token = p_lease_token
    and event.kind = 'full_auto_confirmation'
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and event.task_id = p_task_id
    and event.task_schedule_version = p_expected_schedule_version;
  if not found then
    raise exception 'full_auto_schedule_confirmation_lease_stale'
      using errcode = '40001';
  end if;

  select company.* into v_company
  from public.companies company
  where company.id = v_event.company_id
    and company.deleted_at is null;
  if not found then
    return jsonb_build_object(
      'disposition', 'superseded',
      'reason', 'company_unavailable',
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;
  if not exists (
    select 1
    from public.admin_feature_overrides feature
    where feature.company_id = v_event.company_id::text
      and feature.feature_key = 'phase_c'
      and feature.enabled
  ) then
    return jsonb_build_object(
      'disposition', 'phase_disabled',
      'reason', 'phase_c_disabled',
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;
  if private.agent_effective_confirmation_level(
       v_company.client_comms_settings
     ) <> 'full_auto' then
    return jsonb_build_object(
      'disposition', 'no_action',
      'reason', 'not_full_auto',
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;
  if v_event.actor_user_id is null
     or not exists (
       select 1
       from public.users actor
       where actor.id = v_event.actor_user_id
         and actor.company_id = v_event.company_id
         and actor.deleted_at is null
         and coalesce(actor.is_active, false)
     ) then
    return jsonb_build_object(
      'disposition', 'access_lost',
      'reason', 'actor_unavailable',
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;

  select task.project_id into v_project_id
  from public.project_tasks task
  where task.id = p_task_id
    and task.company_id = v_event.company_id
    and task.deleted_at is null
    and task.status = 'active';
  if not found then
    return jsonb_build_object(
      'disposition', 'superseded',
      'reason', 'task_unavailable',
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;
  perform private.lock_lead_assignment_company(v_event.company_id);
  perform 1
  from public.projects project
  where project.id = v_project_id
    and project.company_id = v_event.company_id
    and project.deleted_at is null
  for share;
  if not found then
    return jsonb_build_object(
      'disposition', 'superseded',
      'reason', 'project_unavailable',
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;
  select task.* into v_task
  from public.project_tasks task
  where task.id = p_task_id
    and task.company_id = v_event.company_id
    and task.project_id = v_project_id
    and task.deleted_at is null
    and task.status = 'active'
  for update;
  if not found
     or v_task.start_date is null
     or cardinality(
       coalesce(v_task.team_member_ids, array[]::text[])
     ) > 100 then
    return jsonb_build_object(
      'disposition', 'superseded',
      'reason', case when found then 'crew_source_query_bound'
        else 'task_snapshot_stale' end,
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;
  if not private.task_schedule_automation_snapshot_matches(
    v_task,
    v_event.after_snapshot,
    p_expected_schedule_version
  ) then
    return jsonb_build_object(
      'disposition', 'superseded',
      'reason', 'task_snapshot_stale',
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;
  select event.* into v_event
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.lease_token = p_lease_token
    and event.kind = 'full_auto_confirmation'
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and event.company_id = v_task.company_id
    and event.task_id = v_task.id
    and event.task_schedule_version = p_expected_schedule_version
  for update;
  if not found then
    raise exception 'full_auto_schedule_confirmation_lease_stale'
      using errcode = '40001';
  end if;
  if not private.user_can_edit_task(v_event.actor_user_id, p_task_id)
     or not exists (
       select 1
       from public.projects project
       join public.clients client
         on client.id = project.client_id
        and client.company_id = v_event.company_id
        and client.deleted_at is null
        and client.merged_into_client_id is null
        and nullif(btrim(client.email), '') is not null
       where project.id = v_project_id
         and project.company_id = v_event.company_id
         and project.deleted_at is null
     ) then
    return jsonb_build_object(
      'disposition', 'superseded',
      'reason', 'source_unavailable',
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;
  if not exists (
    select 1
    from public.email_connections connection
    where private.try_parse_uuid(connection.company_id) = v_event.company_id
      and connection.status = 'active'
      and coalesce(connection.sync_enabled, false)
      and connection.agent_can_send_from
      and private.user_can_send_inbox_connection(
        v_event.actor_user_id,
        v_event.company_id,
        connection.id,
        null
      )
  ) then
    return jsonb_build_object(
      'disposition', 'access_lost',
      'reason', 'mailbox_unavailable',
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;

  if v_task.schedule_confirmed_at is not null
     and v_task.confirmed_schedule_version = v_task.schedule_version
     and v_task.schedule_confirmed_by is not null then
    return jsonb_build_object(
      'disposition', 'superseded',
      'reason', 'manually_confirmed',
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    );
  end if;

  if not (
    v_task.schedule_confirmed_at is not null
    and v_task.confirmed_schedule_version = v_task.schedule_version
    and v_task.schedule_confirmed_by is null
  ) then
    v_task := private.bind_project_task_schedule_confirmation(
      v_event.company_id, p_task_id, p_expected_schedule_version, null
    );
    v_newly_confirmed := true;
  end if;
  perform private.enqueue_schedule_confirmation_dispatch(
    'schedule_confirmation_dispatch',
    v_task,
    v_event.actor_user_id,
    'full_auto'
  );
  return jsonb_build_object(
    'disposition', 'processed',
    'task_id', v_task.id,
    'newly_confirmed', v_newly_confirmed,
    'confirmation_origin', 'full_auto',
    'schedule_confirmed_at', to_char(
      v_task.schedule_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'schedule_confirmed_by', v_task.schedule_confirmed_by,
    'confirmed_schedule_version', v_task.confirmed_schedule_version,
    'schedule_version', v_task.schedule_version
  );
end;
$function$;

revoke all on function public.confirm_full_auto_project_task_schedule_as_system(
  uuid, uuid, uuid, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.confirm_full_auto_project_task_schedule_as_system(
  uuid, uuid, uuid, bigint
) to service_role;

-- Prepare the only prompt-safe projection a purpose dispatch may expose.
-- Every privileged source read, current-policy decision, identity, bound and
-- lease check occurs in this statement. Model code receives no raw rows and
-- never runs for a terminal disposition. Persistence repeats the same proof.
create or replace function public.prepare_schedule_dispatch_as_system(
  p_event_id uuid,
  p_lease_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_event public.task_schedule_automation_outbox;
  v_task public.project_tasks;
  v_project public.projects;
  v_client public.clients;
  v_company public.companies;
  v_connection_id uuid;
  v_task_title text;
  v_project_title text;
  v_project_address text;
  v_client_name text;
  v_client_email text;
  v_crew_names jsonb := '[]'::jsonb;
  v_raw_crew_count integer := 0;
  v_unique_crew_count integer := 0;
  v_invalid_crew boolean := false;
  v_origin text;
  v_change_kind text;
  v_level text;
  v_mode text;
  v_behavior text;
  v_requires_mailbox boolean := false;
  v_confirmed_at text;
  v_confirmed_by uuid;
  v_previous_confirmed_version bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_event_id is null or p_lease_token is null then
    raise exception 'invalid_schedule_dispatch_prepare'
      using errcode = '22023';
  end if;

  select event.* into v_event
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.lease_token = p_lease_token
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and event.kind in (
      'schedule_confirmation_dispatch',
      'schedule_unconfirmation_dispatch'
    );
  if not found then
    raise exception 'schedule_dispatch_prepare_lease_stale'
      using errcode = '40001';
  end if;

  perform private.lock_lead_assignment_company(v_event.company_id);
  select company.* into v_company
  from public.companies company
  where company.id = v_event.company_id
    and company.deleted_at is null
  for share;
  if not found then
    return jsonb_build_object(
      'disposition', 'superseded', 'reason', 'company_unavailable'
    );
  end if;
  if not exists (
    select 1
    from public.admin_feature_overrides feature
    where feature.company_id = v_event.company_id::text
      and feature.feature_key = 'phase_c'
      and feature.enabled
  ) then
    return jsonb_build_object(
      'disposition', 'phase_disabled', 'reason', 'phase_c_disabled'
    );
  end if;
  if v_event.actor_user_id is null
     or not exists (
       select 1
       from public.users actor
       where actor.id = v_event.actor_user_id
         and actor.company_id = v_event.company_id
         and actor.deleted_at is null
         and coalesce(actor.is_active, false)
     ) then
    return jsonb_build_object(
      'disposition', 'access_lost', 'reason', 'actor_unavailable'
    );
  end if;

  select task.* into v_task
  from public.project_tasks task
  where task.id = v_event.task_id
    and task.company_id = v_event.company_id
    and task.deleted_at is null
    and task.status = 'active'
  for share;
  if not found
     or cardinality(
       coalesce(v_task.team_member_ids, array[]::text[])
     ) > 100 then
    return jsonb_build_object(
      'disposition', 'superseded',
      'reason', case when found then 'crew_source_query_bound'
        else 'task_snapshot_stale' end
    );
  end if;
  if not private.task_schedule_automation_snapshot_matches(
    v_task,
    v_event.after_snapshot,
    v_event.task_schedule_version
  ) then
    return jsonb_build_object(
      'disposition', 'superseded', 'reason', 'task_snapshot_stale'
    );
  end if;
  if not private.user_can_edit_task(v_event.actor_user_id, v_task.id) then
    return jsonb_build_object(
      'disposition', 'access_lost', 'reason', 'task_access_revoked'
    );
  end if;
  select event.* into v_event
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.lease_token = p_lease_token
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and event.task_id = v_task.id
    and event.company_id = v_task.company_id
    and event.task_schedule_version = v_task.schedule_version
  for update;
  if not found then
    raise exception 'schedule_dispatch_prepare_lease_stale'
      using errcode = '40001';
  end if;

  v_level := private.agent_effective_confirmation_level(
    v_company.client_comms_settings
  );
  v_mode := private.agent_effective_confirmation_mode(
    v_company.client_comms_settings
  );
  v_behavior := case
    when v_company.client_comms_settings
      #>> '{appointment_confirmation,reschedule_behavior}' in (
        'do_nothing', 'notify', 'draft', 'auto_send'
      ) then v_company.client_comms_settings
        #>> '{appointment_confirmation,reschedule_behavior}'
    else 'draft'
  end;

  if v_event.kind = 'schedule_confirmation_dispatch' then
    v_origin := v_event.after_snapshot ->> 'confirmation_origin';
    v_change_kind := null;
    v_confirmed_at := v_event.after_snapshot ->> 'schedule_confirmed_at';
    v_confirmed_by := private.try_parse_uuid(
      v_event.after_snapshot ->> 'schedule_confirmed_by'
    );
    if v_origin not in ('manual', 'automatic_grace', 'full_auto')
       or v_confirmed_at is null
       or not pg_input_is_valid(v_confirmed_at, 'timestamptz')
       or to_char(
         v_task.schedule_confirmed_at at time zone 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
       ) is distinct from v_confirmed_at
       or v_task.confirmed_schedule_version is distinct from
         v_task.schedule_version
       or v_task.schedule_confirmed_by is distinct from v_confirmed_by
       or v_origin = 'manual' and (
         v_confirmed_by is null
         or v_confirmed_by <> v_event.actor_user_id
         or not private.user_is_company_admin(
           v_confirmed_by, v_event.company_id
         )
       )
       or v_origin in ('automatic_grace', 'full_auto')
          and v_task.schedule_confirmed_by is not null then
      return jsonb_build_object(
        'disposition', 'superseded', 'reason', 'confirmation_proof_stale'
      );
    end if;
    if v_level in ('off', 'manual')
       or v_origin = 'automatic_grace' and v_mode <> 'automatic'
       or v_origin = 'full_auto' and v_level <> 'full_auto' then
      return jsonb_build_object(
        'disposition', 'no_action', 'reason', 'confirmation_policy_disabled'
      );
    end if;
    v_requires_mailbox := true;
  else
    v_origin := v_event.after_snapshot
      ->> 'schedule_unconfirmation_origin';
    v_change_kind := v_event.after_snapshot ->> 'change_kind';
    v_confirmed_at := v_event.before_snapshot ->> 'schedule_confirmed_at';
    v_confirmed_by := private.try_parse_uuid(
      v_event.before_snapshot ->> 'schedule_confirmed_by'
    );
    v_previous_confirmed_version := case
      when jsonb_typeof(
        v_event.before_snapshot -> 'confirmed_schedule_version'
      ) = 'number'
       and v_event.before_snapshot ->> 'confirmed_schedule_version'
         ~ '^(0|[1-9][0-9]*)$'
       and (v_event.before_snapshot ->> 'confirmed_schedule_version')::numeric
         <= 9007199254740991
      then (v_event.before_snapshot
        ->> 'confirmed_schedule_version')::bigint
      else null
    end;
    if v_origin not in ('explicit_admin', 'schedule_edit')
       or v_change_kind not in ('rescheduled', 'unscheduled')
       or v_change_kind = 'unscheduled' and (
         v_origin <> 'schedule_edit' or v_task.start_date is not null
       )
       or v_change_kind = 'rescheduled' and v_task.start_date is null
       or v_event.before_snapshot ->> 'schedule_unconfirmation_origin'
         is distinct from v_origin
       or v_confirmed_at is null
       or not pg_input_is_valid(v_confirmed_at, 'timestamptz')
       or v_task.schedule_confirmed_at is not null
       or v_task.schedule_confirmed_by is not null
       or v_task.confirmed_schedule_version is not null
       or v_origin = 'explicit_admin' and not private.user_is_company_admin(
         v_event.actor_user_id, v_event.company_id
       )
       or v_origin = 'explicit_admin' and (
         v_event.before_snapshot ->> 'schedule_version'
           is distinct from v_task.schedule_version::text
         or v_previous_confirmed_version is not null
            and v_previous_confirmed_version <> v_task.schedule_version
       )
       or v_origin = 'schedule_edit' and not private.user_can_edit_task(
         v_event.actor_user_id, v_task.id
       )
       or v_origin = 'schedule_edit' and (
         v_previous_confirmed_version is null
         or v_task.schedule_version < 1
         or v_previous_confirmed_version <> v_task.schedule_version - 1
         or v_event.before_snapshot ->> 'schedule_version'
           is distinct from v_previous_confirmed_version::text
       ) then
      return jsonb_build_object(
        'disposition', 'superseded', 'reason', 'unconfirmation_proof_stale'
      );
    end if;
    if v_behavior = 'do_nothing' then
      return jsonb_build_object(
        'disposition', 'no_action', 'reason', 'reschedule_behavior_disabled'
      );
    end if;
    v_requires_mailbox := v_behavior in ('draft', 'auto_send');
  end if;

  select project.* into v_project
  from public.projects project
  where project.id = v_task.project_id
    and project.company_id = v_event.company_id
    and project.deleted_at is null
  for share;
  if not found then
    return jsonb_build_object(
      'disposition', 'superseded', 'reason', 'project_unavailable'
    );
  end if;
  select client.* into v_client
  from public.clients client
  where client.id = v_project.client_id
    and client.company_id = v_event.company_id
    and client.deleted_at is null
    and client.merged_into_client_id is null
  for share;
  if not found then
    return jsonb_build_object(
      'disposition', 'superseded', 'reason', 'client_unavailable'
    );
  end if;

  v_project_title := nullif(btrim(v_project.title), '');
  v_project_address := nullif(btrim(v_project.address), '');
  v_client_name := coalesce(nullif(btrim(v_client.name), ''), '');
  v_client_email := lower(nullif(btrim(v_client.email), ''));
  select coalesce(
    nullif(btrim(v_task.custom_title), ''),
    nullif(btrim(task_type.display), ''),
    v_project_title
  ) into v_task_title
  from (select 1) seed
  left join public.task_types task_type
    on task_type.id = v_task.task_type_id
   and task_type.company_id = v_event.company_id
   and task_type.deleted_at is null;
  if v_project_title is null
     or char_length(v_project_title) > 1000
     or v_project_address is not null
        and char_length(v_project_address) > 2000
     or char_length(v_client_name) > 1000
     or v_client_email is null
     or char_length(v_client_email) > 320
     or v_task_title is null
     or char_length(v_task_title) > 1000
     or v_task.start_date is null and not (
       v_event.kind = 'schedule_unconfirmation_dispatch'
       and v_origin = 'schedule_edit'
     )
     or v_task.duration is not null
        and (v_task.duration < 1 or v_task.duration > 365) then
    return jsonb_build_object(
      'disposition', 'superseded', 'reason', 'source_data_invalid'
    );
  end if;

  v_raw_crew_count := cardinality(
    coalesce(v_task.team_member_ids, array[]::text[])
  );
  if v_raw_crew_count > 100 then
    return jsonb_build_object(
      'disposition', 'superseded', 'reason', 'crew_source_query_bound'
    );
  end if;
  select count(distinct raw_member.user_id),
         coalesce(bool_or(
           raw_member.user_id is null
           or not pg_input_is_valid(raw_member.user_id, 'uuid')
           or crew.id is null
           or char_length(btrim(concat_ws(
             ' ', crew.first_name, crew.last_name
           ))) not between 1 and 256
         ), false)
  into v_unique_crew_count, v_invalid_crew
  from unnest(
    (coalesce(v_task.team_member_ids, array[]::text[]))[1:100]
  ) raw_member(user_id)
  left join public.users crew
    on crew.id::text = raw_member.user_id
   and crew.company_id = v_event.company_id
   and crew.deleted_at is null
   and coalesce(crew.is_active, false);
  if v_invalid_crew then
    return jsonb_build_object(
      'disposition', 'superseded', 'reason', 'crew_source_data_invalid'
    );
  end if;
  if v_unique_crew_count > 50 then
    return jsonb_build_object(
      'disposition', 'superseded', 'reason', 'crew_projection_query_bound'
    );
  end if;
  select coalesce(jsonb_agg(
    member.display_name order by member.first_ordinality
  ), '[]'::jsonb) into v_crew_names
  from (
    select crew.id,
           min(raw_member.ordinality) as first_ordinality,
           btrim(concat_ws(' ', crew.first_name, crew.last_name))
             as display_name
    from unnest(
      (coalesce(v_task.team_member_ids, array[]::text[]))[1:100]
    ) with ordinality raw_member(user_id, ordinality)
    join public.users crew
      on crew.id::text = raw_member.user_id
     and crew.company_id = v_event.company_id
     and crew.deleted_at is null
     and coalesce(crew.is_active, false)
    group by crew.id, crew.first_name, crew.last_name
  ) member;
  if jsonb_array_length(v_crew_names) <> v_unique_crew_count then
    return jsonb_build_object(
      'disposition', 'superseded', 'reason', 'crew_projection_invalid'
    );
  end if;

  if v_requires_mailbox then
    select candidate.id into v_connection_id
    from (
      select connection.id,
             case when connection.type = 'individual' then 0 else 1 end
               as preference,
             connection.created_at
      from public.email_connections connection
      where connection.company_id = v_event.company_id::text
        and connection.status = 'active'
        and coalesce(connection.sync_enabled, false)
        and coalesce(connection.agent_can_send_from, false)
        and (
          connection.type = 'individual'
          and nullif(btrim(connection.user_id), '') =
            v_event.actor_user_id::text
          or connection.type = 'company'
        )
        and private.user_can_send_inbox_connection(
          v_event.actor_user_id,
          v_event.company_id,
          connection.id,
          null
        )
      order by preference, connection.created_at, connection.id
      limit 1
    ) candidate;
    if v_connection_id is null then
      return jsonb_build_object(
        'disposition', 'access_lost', 'reason', 'mailbox_unavailable'
      );
    end if;
  end if;

  return jsonb_build_object(
    'disposition', 'ready',
    'kind', v_event.kind,
    'event_id', v_event.id,
    'lease_token', v_event.lease_token,
    'company_id', v_event.company_id,
    'actor_user_id', v_event.actor_user_id,
    'task_id', v_task.id,
    'schedule_version', v_task.schedule_version,
    'confirmation_origin', case
      when v_event.kind = 'schedule_confirmation_dispatch'
        then v_origin
      else null
    end,
    'schedule_unconfirmation_origin', case
      when v_event.kind = 'schedule_unconfirmation_dispatch'
        then v_origin
      else null
    end,
    'change_kind', case
      when v_event.kind = 'schedule_unconfirmation_dispatch'
        then v_change_kind
      else null
    end,
    'schedule_confirmed_at', case
      when v_event.kind = 'schedule_confirmation_dispatch'
        then v_confirmed_at
      else null
    end,
    'schedule_confirmed_by', case
      when v_event.kind = 'schedule_confirmation_dispatch'
        then v_confirmed_by
      else null
    end,
    'previous_schedule_confirmed_at', case
      when v_event.kind = 'schedule_unconfirmation_dispatch'
        then v_confirmed_at
      else null
    end,
    'confirmation_level', v_level,
    'reschedule_behavior', v_behavior,
    'send_delay_minutes', case when jsonb_typeof(
      v_company.client_comms_settings
        #> '{appointment_confirmation,send_delay_minutes}'
    ) = 'number' then least(60, greatest(0, (
      v_company.client_comms_settings
        #>> '{appointment_confirmation,send_delay_minutes}'
    )::integer)) else 15 end,
    'locale', case when v_company.locale = 'es' then 'es' else 'en' end,
    'connection_id', v_connection_id,
    'project_id', v_project.id,
    'project_title', v_project_title,
    'project_address', v_project_address,
    'client_id', v_client.id,
    'client_name', v_client_name,
    'client_email', v_client_email,
    'task_title', v_task_title,
    -- start_date is a UTC date carrier for the company-local civil date.
    -- Return the date itself so an application runtime timezone cannot shift it.
    'scheduled_date', case when v_task.start_date is null then null
      else to_char(v_task.start_date at time zone 'UTC', 'YYYY-MM-DD') end,
    'scheduled_time', case when v_task.start_date is null
      or v_task.start_time is null then null
      else to_char(v_task.start_time, 'HH24:MI') end,
    'scheduled_end_time', case when v_task.start_date is null
      or v_task.end_time is null then null
      else to_char(v_task.end_time, 'HH24:MI') end,
    'all_day', v_task.all_day,
    'duration_hours', greatest(coalesce(v_task.duration, 1), 1) * 8,
    'crew_names', v_crew_names
  );
end;
$function$;

revoke all on function public.prepare_schedule_dispatch_as_system(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_schedule_dispatch_as_system(uuid, uuid)
  to service_role;

-- A confirmation dispatch is recoverable after any route/worker crash and
-- remains idempotent even after an action leaves pending state.
create unique index if not exists agent_actions_schedule_confirmation_unique
  on public.agent_actions (company_id, action_type, source_id)
  where source_id like 'schedule-confirmation:%';

create or replace function public.persist_schedule_confirmation_action_as_system(
  p_event_id uuid,
  p_lease_token uuid,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_task_id uuid,
  p_expected_schedule_version bigint,
  p_expected_confirmed_at timestamptz,
  p_expected_confirmed_by uuid,
  p_action_data jsonb,
  p_context_summary text,
  p_source_id text,
  p_confidence numeric,
  p_priority text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_action_id uuid;
  v_created boolean := false;
  v_expected_source_id text;
  v_confirmation_level text;
  v_confirmation_mode text;
  v_confirmation_origin text;
  v_send_delay_minutes integer;
  v_auto_execute_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_event_id is null
     or p_lease_token is null
     or p_company_id is null
     or p_task_id is null
     or p_expected_schedule_version is null
     or p_expected_schedule_version < 0
     or p_expected_confirmed_at is null
     or p_action_data is null
     or p_context_summary is null
     or char_length(p_context_summary) not between 1 and 10000
     or p_source_id is null
     or p_source_id is distinct from btrim(p_source_id)
     or char_length(p_source_id) > 512
     or p_confidence is null
     or p_confidence < 0 or p_confidence > 1
     or p_priority not in ('low', 'normal', 'high', 'urgent')
     or p_expires_at is null then
    raise exception 'invalid_schedule_confirmation_action'
      using errcode = '22023';
  end if;

  select event.after_snapshot ->> 'confirmation_origin'
  into v_confirmation_origin
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.lease_token = p_lease_token
    and event.kind = 'schedule_confirmation_dispatch'
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and event.company_id = p_company_id
    and event.task_id = p_task_id
    and event.actor_user_id = p_actor_user_id
    and event.task_schedule_version = p_expected_schedule_version
    and event.after_snapshot ->> 'schedule_confirmed_at' = to_char(
      p_expected_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    and event.after_snapshot ->> 'confirmed_schedule_version' =
      p_expected_schedule_version::text
    and event.after_snapshot ->> 'schedule_confirmed_by' is not distinct from
      p_expected_confirmed_by::text
  for update;
  if not found then
    raise exception 'schedule_confirmation_dispatch_lease_stale'
      using errcode = '40001';
  end if;

  perform 1
  from public.project_tasks task
  join public.admin_feature_overrides feature
    on feature.company_id = task.company_id::text
   and feature.feature_key = 'phase_c'
   and feature.enabled
  join public.users actor
    on actor.id = p_actor_user_id
   and actor.company_id = task.company_id
   and actor.deleted_at is null
   and coalesce(actor.is_active, false)
  where task.id = p_task_id
    and task.company_id = p_company_id
    and task.deleted_at is null
    and task.status = 'active'
    and task.schedule_version = p_expected_schedule_version
    and task.confirmed_schedule_version = p_expected_schedule_version
    and task.schedule_confirmed_at = p_expected_confirmed_at
    and task.schedule_confirmed_by is not distinct from p_expected_confirmed_by
    and private.user_can_edit_task(p_actor_user_id, p_task_id)
    and (
      v_confirmation_origin = 'manual'
      and p_expected_confirmed_by is not null
      and p_expected_confirmed_by = p_actor_user_id
      and private.user_is_company_admin(p_actor_user_id, p_company_id)
      and exists (
        select 1
        from public.users confirmer
        where confirmer.id = p_expected_confirmed_by
          and confirmer.company_id = p_company_id
          and confirmer.deleted_at is null
          and coalesce(confirmer.is_active, false)
          and private.user_is_company_admin(
            p_expected_confirmed_by, p_company_id
          )
      )
      or v_confirmation_origin in ('automatic_grace', 'full_auto')
         and p_expected_confirmed_by is null
         and exists (
           select 1
           from public.companies company
           where company.id = p_company_id
             and (
               v_confirmation_origin = 'automatic_grace'
               and private.agent_effective_confirmation_mode(
                 company.client_comms_settings
               ) = 'automatic'
               and private.agent_effective_confirmation_level(
                 company.client_comms_settings
               ) in (
                 'draft_on_confirm', 'auto_send_on_confirm', 'full_auto'
               )
               or v_confirmation_origin = 'full_auto'
                  and private.agent_effective_confirmation_level(
                    company.client_comms_settings
                  ) = 'full_auto'
             )
         )
    )
  for update of task;
  if not found then
    raise exception 'schedule_confirmation_action_stale'
      using errcode = '40001';
  end if;

  select private.agent_effective_confirmation_level(
    company.client_comms_settings
  ),
  private.agent_effective_confirmation_mode(company.client_comms_settings),
  case when jsonb_typeof(
    company.client_comms_settings
      #> '{appointment_confirmation,send_delay_minutes}'
  ) = 'number' then least(60, greatest(0, (
    company.client_comms_settings
      #>> '{appointment_confirmation,send_delay_minutes}'
  )::integer)) else 15 end
  into v_confirmation_level, v_confirmation_mode, v_send_delay_minutes
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;
  if v_confirmation_level is null
     or v_confirmation_level in ('off', 'manual')
     or v_confirmation_origin = 'automatic_grace'
        and v_confirmation_mode <> 'automatic'
     or v_confirmation_origin = 'full_auto'
        and v_confirmation_level <> 'full_auto' then
    raise exception 'schedule_confirmation_action_disabled'
      using errcode = '42501';
  end if;
  v_auto_execute_at := case when v_confirmation_level in (
    'auto_send_on_confirm', 'full_auto'
  ) then statement_timestamp() + make_interval(
    secs => v_send_delay_minutes * 60
  ) else null end;

  v_expected_source_id :=
    'schedule-confirmation:' || p_task_id::text ||
    ':v' || p_expected_schedule_version::text || ':' ||
    to_char(
      p_expected_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
  if p_source_id is distinct from v_expected_source_id
     or p_action_data ->> 'task_id' is distinct from p_task_id::text
     or p_action_data ->> 'schedule_version' is distinct from
       p_expected_schedule_version::text
     or p_action_data ->> 'confirmed_schedule_version' is distinct from
       p_expected_schedule_version::text
     or p_action_data ->> 'schedule_confirmed_at' is distinct from to_char(
       p_expected_confirmed_at at time zone 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     or p_action_data ->> 'schedule_confirmed_by' is distinct from
       p_expected_confirmed_by::text
     or p_action_data ->> 'confirmation_origin' is distinct from
       v_confirmation_origin
     or p_action_data ->> 'connection_id' is null
     or not pg_input_is_valid(p_action_data ->> 'connection_id', 'uuid') then
    raise exception 'invalid_schedule_confirmation_action_identity'
      using errcode = '22023';
  end if;

  perform 1
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = p_company_id
   and project.deleted_at is null
  join public.clients client
    on client.id = project.client_id
   and client.company_id = p_company_id
   and client.deleted_at is null
   and client.merged_into_client_id is null
  join public.email_connections connection
    on connection.id = (p_action_data ->> 'connection_id')::uuid
   and connection.company_id = p_company_id::text
   and connection.status = 'active'
   and coalesce(connection.sync_enabled, false)
   and connection.agent_can_send_from
  left join public.task_types task_type
    on task_type.id = task.task_type_id
   and task_type.company_id = p_company_id
   and task_type.deleted_at is null
  where task.id = p_task_id
    and task.company_id = p_company_id
    and task.deleted_at is null
    and task.status = 'active'
    and p_action_data ->> 'project_id' = project.id::text
    and p_action_data ->> 'project_title' is not distinct from
      nullif(btrim(project.title), '')
    and p_action_data ->> 'project_address' is not distinct from
      nullif(btrim(project.address), '')
    and p_action_data ->> 'client_id' = client.id::text
    and p_action_data ->> 'client_name' is not distinct from
      coalesce(nullif(btrim(client.name), ''), '')
    and lower(p_action_data ->> 'client_email') is not distinct from
      lower(nullif(btrim(client.email), ''))
    and p_action_data ->> 'scheduled_date' = to_char(
      task.start_date at time zone 'UTC', 'YYYY-MM-DD'
    )
    and p_action_data ->> 'scheduled_time' is not distinct from
      case when task.start_time is null then null
        else to_char(task.start_time, 'HH24:MI')
      end
    and p_action_data ->> 'scheduled_end_time' is not distinct from
      case when task.end_time is null then null
        else to_char(task.end_time, 'HH24:MI')
      end
    and p_action_data ->> 'duration_hours' is not distinct from
      (greatest(coalesce(task.duration, 1), 1) * 8)::text
    and p_action_data ->> 'task_title' is not distinct from coalesce(
      nullif(btrim(task.custom_title), ''),
      nullif(btrim(task_type.display), ''),
      nullif(btrim(project.title), '')
    )
    and p_action_data -> 'crew_names' is not null
    and jsonb_typeof(p_action_data -> 'crew_names') = 'array'
    and cardinality(coalesce(task.team_member_ids, array[]::text[])) <= 100
    and (
      select count(distinct raw_member.user_id)
      from unnest(
        (coalesce(task.team_member_ids, array[]::text[]))[1:100]
      ) raw_member(user_id)
    ) <= 50
    and not exists (
      select 1
      from unnest(
        (coalesce(task.team_member_ids, array[]::text[]))[1:100]
      ) raw_member(user_id)
      left join public.users crew
        on crew.id::text = raw_member.user_id
       and crew.company_id = p_company_id
       and crew.deleted_at is null
       and coalesce(crew.is_active, false)
      where raw_member.user_id is null
         or not pg_input_is_valid(raw_member.user_id, 'uuid')
         or crew.id is null
         or char_length(btrim(concat_ws(
           ' ', crew.first_name, crew.last_name
         ))) not between 1 and 256
    )
    and p_action_data -> 'crew_names' = coalesce((
      select jsonb_agg(
        member.display_name order by member.first_ordinality
      )
      from (
        select crew.id,
               min(raw_member.ordinality) as first_ordinality,
               btrim(concat_ws(' ', crew.first_name, crew.last_name))
                 as display_name
        from unnest(
          (coalesce(task.team_member_ids, array[]::text[]))[1:100]
        )
          with ordinality raw_member(user_id, ordinality)
        join public.users crew
          on crew.id::text = raw_member.user_id
         and crew.company_id = p_company_id
         and crew.deleted_at is null
         and coalesce(crew.is_active, false)
        group by crew.id, crew.first_name, crew.last_name
        having char_length(btrim(concat_ws(
          ' ', crew.first_name, crew.last_name
        ))) between 1 and 256
      ) member
    ), '[]'::jsonb)
    and private.user_can_send_inbox_connection(
      p_actor_user_id,
      p_company_id,
      connection.id,
      null
    )
  for share of project, client, connection;
  if not found then
    raise exception 'schedule_confirmation_action_source_stale'
      using errcode = '40001';
  end if;

  select action.id into v_action_id
  from public.agent_actions action
  where action.company_id = p_company_id
    and action.action_type = 'send_appointment_confirmation'
    and action.source_id = p_source_id
    and action.user_id = coalesce(
      p_expected_confirmed_by, p_actor_user_id
    )
    and action.context_source = 'task_scheduled'
    and action.action_data ->> 'task_id' = p_task_id::text
    and action.action_data ->> 'schedule_version' =
      p_expected_schedule_version::text
    and action.action_data ->> 'confirmed_schedule_version' =
      p_expected_schedule_version::text
    and action.action_data ->> 'schedule_confirmed_at' = to_char(
      p_expected_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    and action.action_data ->> 'schedule_confirmed_by' is not distinct from
      p_expected_confirmed_by::text
    and action.action_data ->> 'confirmation_origin' = v_confirmation_origin
  order by action.created_at, action.id
  limit 1;
  if v_action_id is null then
    insert into public.agent_actions (
      company_id,
      user_id,
      action_type,
      action_data,
      context_summary,
      context_source,
      source_id,
      confidence,
      priority,
      status,
      expires_at,
      auto_execute_at
    ) values (
      p_company_id,
      coalesce(p_expected_confirmed_by, p_actor_user_id),
      'send_appointment_confirmation',
      p_action_data,
      p_context_summary,
      'task_scheduled',
      p_source_id,
      p_confidence,
      p_priority,
      'pending',
      p_expires_at,
      v_auto_execute_at
    )
    returning id into v_action_id;
    v_created := true;
  end if;

  return jsonb_build_object(
    'action_id', v_action_id,
    'created', v_created
  );
exception when unique_violation then
  select action.id into v_action_id
  from public.agent_actions action
  where action.company_id = p_company_id
    and action.action_type = 'send_appointment_confirmation'
    and action.source_id = p_source_id
    and action.user_id = coalesce(
      p_expected_confirmed_by, p_actor_user_id
    )
    and action.context_source = 'task_scheduled'
    and action.action_data ->> 'task_id' = p_task_id::text
    and action.action_data ->> 'schedule_version' =
      p_expected_schedule_version::text
    and action.action_data ->> 'confirmed_schedule_version' =
      p_expected_schedule_version::text
    and action.action_data ->> 'schedule_confirmed_at' = to_char(
      p_expected_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    and action.action_data ->> 'schedule_confirmed_by' is not distinct from
      p_expected_confirmed_by::text
    and action.action_data ->> 'confirmation_origin' = v_confirmation_origin
  order by action.created_at, action.id
  limit 1;
  if v_action_id is null then raise; end if;
  return jsonb_build_object('action_id', v_action_id, 'created', false);
end;
$function$;

revoke all on function public.persist_schedule_confirmation_action_as_system(
  uuid, uuid, uuid, uuid, uuid, bigint, timestamptz, uuid, jsonb, text, text, numeric,
  text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.persist_schedule_confirmation_action_as_system(
  uuid, uuid, uuid, uuid, uuid, bigint, timestamptz, uuid, jsonb, text, text, numeric,
  text, timestamptz
) to service_role;

-- Purpose-specific unconfirmation action persistence supports legacy
-- schedule_version=0 while keeping the generic task writer at >=1. It binds
-- the processing event, cleared confirmation proof, actor, current sources,
-- complete crew projection, mailbox and action payload in one statement.
create or replace function public.persist_schedule_unconfirmation_action_as_system(
  p_event_id uuid,
  p_lease_token uuid,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_task_id uuid,
  p_expected_schedule_version bigint,
  p_previous_confirmed_at timestamptz,
  p_action_data jsonb,
  p_context_summary text,
  p_source_id text,
  p_confidence numeric,
  p_priority text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_action_id uuid;
  v_created boolean := false;
  v_behavior text;
  v_unconfirmation_origin text;
  v_change_kind text;
  v_delay integer := 15;
  v_auto_execute_at timestamptz;
begin
  if auth.role() is distinct from 'service_role'
     or p_event_id is null
     or p_lease_token is null
     or p_actor_user_id is null
     or p_company_id is null
     or p_task_id is null
     or p_expected_schedule_version is null
     or p_expected_schedule_version < 0
     or p_previous_confirmed_at is null
     or jsonb_typeof(p_action_data) <> 'object'
     or nullif(btrim(p_context_summary), '') is null
     or char_length(p_context_summary) > 10000
     or p_source_id is distinct from
       'task-automation:' || p_event_id::text || ':schedule-unconfirmation'
     or p_confidence not between 0 and 1
     or p_priority not in ('low', 'normal', 'high', 'urgent')
     or p_expires_at is null then
    raise exception 'invalid_schedule_unconfirmation_action'
      using errcode = '22023';
  end if;

  select event.after_snapshot ->> 'schedule_unconfirmation_origin',
         event.after_snapshot ->> 'change_kind'
  into v_unconfirmation_origin, v_change_kind
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.lease_token = p_lease_token
    and event.kind = 'schedule_unconfirmation_dispatch'
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and event.company_id = p_company_id
    and event.actor_user_id = p_actor_user_id
    and event.task_id = p_task_id
    and event.task_schedule_version = p_expected_schedule_version
  for update;
  if not found
     or v_unconfirmation_origin not in ('explicit_admin', 'schedule_edit')
     or v_change_kind not in ('rescheduled', 'unscheduled')
     or v_change_kind = 'unscheduled'
        and v_unconfirmation_origin <> 'schedule_edit' then
    raise exception 'schedule_unconfirmation_action_stale'
      using errcode = '40001';
  end if;

  -- The caller cannot omit or forge final-delivery currentness. Inject the
  -- exact immutable event/task/version guard consumed by the email intent
  -- prepare and provider-claim boundaries.
  p_action_data := p_action_data || jsonb_build_object(
    'source_task_id', p_task_id,
    'source_task_schedule_version', p_expected_schedule_version,
    'source_task_automation_event_id', p_event_id,
    'schedule_unconfirmation_origin', v_unconfirmation_origin,
    'change_kind', v_change_kind,
    'task_automation_guard', jsonb_build_object(
      'event_id', p_event_id,
      'task_id', p_task_id,
      'schedule_version', p_expected_schedule_version
    )
  );

  select case
    when company.client_comms_settings
      #>> '{appointment_confirmation,reschedule_behavior}' in (
        'do_nothing', 'notify', 'draft', 'auto_send'
      ) then company.client_comms_settings
        #>> '{appointment_confirmation,reschedule_behavior}'
    else 'draft'
  end,
  case when jsonb_typeof(
    company.client_comms_settings
      #> '{appointment_confirmation,send_delay_minutes}'
  ) = 'number' then least(60, greatest(0, (
    company.client_comms_settings
      #>> '{appointment_confirmation,send_delay_minutes}'
  )::integer)) else 15 end
  into v_behavior, v_delay
  from public.companies company
  join public.admin_feature_overrides feature
    on feature.company_id = company.id::text
   and feature.feature_key = 'phase_c'
   and feature.enabled
  where company.id = p_company_id
    and company.deleted_at is null
  for share of company, feature;
  if not found or v_behavior not in ('draft', 'auto_send') then
    raise exception 'schedule_unconfirmation_action_disabled'
      using errcode = '42501';
  end if;
  v_auto_execute_at := case when v_behavior = 'auto_send'
    then statement_timestamp() + make_interval(secs => v_delay * 60)
    else null end;

  perform 1
  from public.task_schedule_automation_outbox event
  join public.project_tasks task
    on task.id = event.task_id
   and task.company_id = event.company_id
   and task.deleted_at is null
   and task.status = 'active'
  join public.users actor
    on actor.id = event.actor_user_id
   and actor.company_id = event.company_id
   and actor.deleted_at is null
   and coalesce(actor.is_active, false)
  join public.projects project
    on project.id = task.project_id
   and project.company_id = event.company_id
   and project.deleted_at is null
  join public.clients client
    on client.id = project.client_id
   and client.company_id = event.company_id
   and client.deleted_at is null
   and client.merged_into_client_id is null
  join public.email_connections connection
    on connection.id = private.try_parse_uuid(
      p_action_data ->> 'connection_id'
    )
   and connection.company_id = event.company_id::text
   and connection.status = 'active'
   and coalesce(connection.sync_enabled, false)
   and coalesce(connection.agent_can_send_from, false)
  left join public.task_types task_type
    on task_type.id = task.task_type_id
   and task_type.company_id = event.company_id
   and task_type.deleted_at is null
  where event.id = p_event_id
    and event.lease_token = p_lease_token
    and event.kind = 'schedule_unconfirmation_dispatch'
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and event.company_id = p_company_id
    and event.actor_user_id = p_actor_user_id
    and event.task_id = p_task_id
    and event.task_schedule_version = p_expected_schedule_version
    and event.before_snapshot ->> 'schedule_confirmed_at' = to_char(
      p_previous_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    and event.before_snapshot ->> 'schedule_unconfirmation_origin' =
      v_unconfirmation_origin
    and event.after_snapshot ->> 'schedule_unconfirmation_origin' =
      v_unconfirmation_origin
    and event.after_snapshot ->> 'change_kind' = v_change_kind
    and case
      when v_unconfirmation_origin = 'explicit_admin' then
        event.before_snapshot ->> 'schedule_version' =
          p_expected_schedule_version::text
        and (
          event.before_snapshot ->> 'confirmed_schedule_version' is null
          or event.before_snapshot ->> 'confirmed_schedule_version' =
            p_expected_schedule_version::text
        )
      when v_unconfirmation_origin = 'schedule_edit' then
        p_expected_schedule_version >= 1
        and event.before_snapshot ->> 'schedule_version' =
          (p_expected_schedule_version - 1)::text
        and event.before_snapshot ->> 'confirmed_schedule_version' =
          (p_expected_schedule_version - 1)::text
      else false
    end
    and task.schedule_version = p_expected_schedule_version
    and task.schedule_confirmed_at is null
    and task.schedule_confirmed_by is null
    and task.confirmed_schedule_version is null
    and private.user_can_edit_task(p_actor_user_id, p_task_id)
    and (
      v_unconfirmation_origin = 'explicit_admin'
      and private.user_is_company_admin(p_actor_user_id, p_company_id)
      or v_unconfirmation_origin = 'schedule_edit'
    )
    and private.user_can_send_inbox_connection(
      p_actor_user_id, p_company_id, connection.id, null
    )
    and p_action_data ->> 'task_id' = task.id::text
    and p_action_data ->> 'schedule_version' = task.schedule_version::text
    and p_action_data ->> 'previous_schedule_confirmed_at' = to_char(
      p_previous_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    and p_action_data ->> 'schedule_unconfirmation_origin' =
      v_unconfirmation_origin
    and p_action_data ->> 'project_id' = project.id::text
    and p_action_data ->> 'project_title' is not distinct from
      nullif(btrim(project.title), '')
    and p_action_data ->> 'project_address' is not distinct from
      nullif(btrim(project.address), '')
    and p_action_data ->> 'client_id' = client.id::text
    and p_action_data ->> 'client_name' is not distinct from
      coalesce(nullif(btrim(client.name), ''), '')
    and lower(p_action_data ->> 'client_email') = lower(btrim(client.email))
    and p_action_data ->> 'task_title' is not distinct from coalesce(
      nullif(btrim(task.custom_title), ''),
      nullif(btrim(task_type.display), ''),
      nullif(btrim(project.title), '')
    )
    and (
      v_unconfirmation_origin = 'schedule_edit'
      and task.start_date is null
      and v_change_kind = 'unscheduled'
      and p_action_data ->> 'change_kind' = v_change_kind
      and p_action_data ? 'new_date'
      and jsonb_typeof(p_action_data -> 'new_date') = 'null'
      and p_action_data ? 'new_time'
      and jsonb_typeof(p_action_data -> 'new_time') = 'null'
      and p_action_data ? 'new_end_time'
      and jsonb_typeof(p_action_data -> 'new_end_time') = 'null'
      or task.start_date is not null
         and v_change_kind = 'rescheduled'
         and p_action_data ->> 'change_kind' = v_change_kind
         and p_action_data ->> 'new_date' = to_char(
           task.start_date at time zone 'UTC',
           'YYYY-MM-DD'
         )
         and p_action_data ->> 'new_time' is not distinct from (case
           when task.start_time is null then null
           else to_char(task.start_time, 'HH24:MI') end)
         and p_action_data ->> 'new_end_time' is not distinct from (case
           when task.end_time is null then null
           else to_char(task.end_time, 'HH24:MI') end)
    )
    and cardinality(coalesce(task.team_member_ids, array[]::text[])) <= 100
    and (
      select count(distinct raw.user_id)
      from unnest(
        (coalesce(task.team_member_ids, array[]::text[]))[1:100]
      ) raw(user_id)
    ) <= 50
    and not exists (
      select 1
      from unnest(
        (coalesce(task.team_member_ids, array[]::text[]))[1:100]
      ) raw(user_id)
      left join public.users crew
        on crew.id::text = raw.user_id
       and crew.company_id = p_company_id
       and crew.deleted_at is null
       and coalesce(crew.is_active, false)
      where raw.user_id is null
         or not pg_input_is_valid(raw.user_id, 'uuid')
         or crew.id is null
         or char_length(btrim(concat_ws(
           ' ', crew.first_name, crew.last_name
         ))) not between 1 and 256
    )
    and p_action_data -> 'crew_names' = coalesce((
      select jsonb_agg(member.display_name order by member.first_ordinality)
      from (
        select crew.id,
               min(raw.ordinality) as first_ordinality,
               btrim(concat_ws(' ', crew.first_name, crew.last_name))
                 as display_name
        from unnest(
          (coalesce(task.team_member_ids, array[]::text[]))[1:100]
        ) with ordinality raw(user_id, ordinality)
        join public.users crew
          on crew.id::text = raw.user_id
         and crew.company_id = p_company_id
         and crew.deleted_at is null
         and coalesce(crew.is_active, false)
        group by crew.id, crew.first_name, crew.last_name
      ) member
    ), '[]'::jsonb)
  for update of event, task;
  if not found then
    raise exception 'schedule_unconfirmation_action_stale'
      using errcode = '40001';
  end if;

  select action.id into v_action_id
  from public.agent_actions action
  where action.company_id = p_company_id
    and action.user_id = p_actor_user_id
    and action.action_type = 'send_schedule_changed'
    and action.source_id = p_source_id
    and action.context_source = 'task_scheduled'
    and action.action_data ->> 'task_id' = p_task_id::text
    and action.action_data ->> 'schedule_version' =
      p_expected_schedule_version::text
    and action.action_data ->> 'previous_schedule_confirmed_at' = to_char(
      p_previous_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    and action.action_data ->> 'schedule_unconfirmation_origin' =
      v_unconfirmation_origin
    and action.action_data ->> 'change_kind' =
      p_action_data ->> 'change_kind'
    and action.action_data ->> 'source_task_id' = p_task_id::text
    and action.action_data ->> 'source_task_schedule_version' =
      p_expected_schedule_version::text
    and action.action_data ->> 'source_task_automation_event_id' =
      p_event_id::text
    and action.action_data #>> '{task_automation_guard,event_id}' =
      p_event_id::text
    and action.action_data #>> '{task_automation_guard,task_id}' =
      p_task_id::text
    and action.action_data #>> '{task_automation_guard,schedule_version}' =
      p_expected_schedule_version::text
  order by action.created_at, action.id
  limit 1;
  if v_action_id is null then
    insert into public.agent_actions (
      company_id, user_id, action_type, action_data, context_summary,
      context_source, source_id, confidence, priority, status, expires_at,
      auto_execute_at
    ) values (
      p_company_id, p_actor_user_id, 'send_schedule_changed', p_action_data,
      btrim(p_context_summary), 'task_scheduled', p_source_id, p_confidence,
      p_priority, 'pending', p_expires_at, v_auto_execute_at
    ) returning id into v_action_id;
    v_created := true;
  end if;
  return jsonb_build_object('action_id', v_action_id, 'created', v_created);
exception when unique_violation then
  select action.id into v_action_id
  from public.agent_actions action
  where action.company_id = p_company_id
    and action.user_id = p_actor_user_id
    and action.action_type = 'send_schedule_changed'
    and action.source_id = p_source_id
    and action.context_source = 'task_scheduled'
    and action.action_data ->> 'task_id' = p_task_id::text
    and action.action_data ->> 'schedule_version' =
      p_expected_schedule_version::text
    and action.action_data ->> 'previous_schedule_confirmed_at' = to_char(
      p_previous_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    and action.action_data ->> 'schedule_unconfirmation_origin' =
      v_unconfirmation_origin
    and action.action_data ->> 'change_kind' =
      p_action_data ->> 'change_kind'
    and action.action_data ->> 'source_task_id' = p_task_id::text
    and action.action_data ->> 'source_task_schedule_version' =
      p_expected_schedule_version::text
    and action.action_data ->> 'source_task_automation_event_id' =
      p_event_id::text
    and action.action_data #>> '{task_automation_guard,event_id}' =
      p_event_id::text
    and action.action_data #>> '{task_automation_guard,task_id}' =
      p_task_id::text
    and action.action_data #>> '{task_automation_guard,schedule_version}' =
      p_expected_schedule_version::text
  order by action.created_at, action.id
  limit 1;
  if v_action_id is null then raise; end if;
  return jsonb_build_object('action_id', v_action_id, 'created', false);
end;
$function$;

revoke all on function public.persist_schedule_unconfirmation_action_as_system(
  uuid, uuid, uuid, uuid, uuid, bigint, timestamptz, jsonb, text, text,
  numeric, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.persist_schedule_unconfirmation_action_as_system(
  uuid, uuid, uuid, uuid, uuid, bigint, timestamptz, jsonb, text, text,
  numeric, text, timestamptz
) to service_role;

-- A purpose unconfirmation notification is fixed server copy, not a caller-
-- supplied message. The same statement locks the lease and current task proof,
-- rechecks Phase C/admin/edit authority and current behavior, then derives the
-- locale-specific notification. This path deliberately supports version zero.
create or replace function public.persist_schedule_unconfirmation_notification_as_system(
  p_event_id uuid,
  p_lease_token uuid,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_task_id uuid,
  p_expected_schedule_version bigint,
  p_previous_confirmed_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_created boolean;
  v_locale text;
  v_title text;
  v_body text;
  v_action_label text;
  v_unconfirmation_origin text;
  v_change_kind text;
begin
  if auth.role() is distinct from 'service_role'
     or p_event_id is null
     or p_lease_token is null
     or p_actor_user_id is null
     or p_company_id is null
     or p_task_id is null
     or p_expected_schedule_version is null
     or p_expected_schedule_version < 0
     or p_previous_confirmed_at is null then
    raise exception 'invalid_schedule_unconfirmation_notification'
      using errcode = '22023';
  end if;

  select case when company.locale = 'es' then 'es' else 'en' end,
         event.after_snapshot ->> 'schedule_unconfirmation_origin',
         event.after_snapshot ->> 'change_kind'
  into v_locale, v_unconfirmation_origin, v_change_kind
  from public.task_schedule_automation_outbox event
  join public.project_tasks task
    on task.id = event.task_id
   and task.company_id = event.company_id
   and task.deleted_at is null
   and task.status = 'active'
  join public.companies company
    on company.id = event.company_id
   and company.deleted_at is null
  join public.admin_feature_overrides feature
    on feature.company_id = company.id::text
   and feature.feature_key = 'phase_c'
   and feature.enabled
  join public.users actor
    on actor.id = event.actor_user_id
   and actor.company_id = event.company_id
   and actor.deleted_at is null
   and coalesce(actor.is_active, false)
  where event.id = p_event_id
    and event.lease_token = p_lease_token
    and event.kind = 'schedule_unconfirmation_dispatch'
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and event.company_id = p_company_id
    and event.actor_user_id = p_actor_user_id
    and event.task_id = p_task_id
    and event.task_schedule_version = p_expected_schedule_version
    and event.before_snapshot ->> 'schedule_confirmed_at' = to_char(
      p_previous_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    and event.before_snapshot ->> 'schedule_unconfirmation_origin' =
      event.after_snapshot ->> 'schedule_unconfirmation_origin'
    and event.after_snapshot ->> 'schedule_unconfirmation_origin' in (
      'explicit_admin', 'schedule_edit'
    )
    and event.after_snapshot ->> 'change_kind' in (
      'rescheduled', 'unscheduled'
    )
    and case
      when event.after_snapshot ->> 'schedule_unconfirmation_origin' =
        'explicit_admin' then
        event.before_snapshot ->> 'schedule_version' =
          p_expected_schedule_version::text
        and (
          event.before_snapshot ->> 'confirmed_schedule_version' is null
          or event.before_snapshot ->> 'confirmed_schedule_version' =
            p_expected_schedule_version::text
        )
      when event.after_snapshot ->> 'schedule_unconfirmation_origin' =
        'schedule_edit' then
        p_expected_schedule_version >= 1
        and event.before_snapshot ->> 'schedule_version' =
          (p_expected_schedule_version - 1)::text
        and event.before_snapshot ->> 'confirmed_schedule_version' =
          (p_expected_schedule_version - 1)::text
      else false
    end
    and task.schedule_version = p_expected_schedule_version
    and (
      task.start_date is not null
      and event.after_snapshot ->> 'change_kind' = 'rescheduled'
      or task.start_date is null
         and event.after_snapshot ->> 'schedule_unconfirmation_origin' =
           'schedule_edit'
         and event.after_snapshot ->> 'change_kind' = 'unscheduled'
    )
    and task.schedule_confirmed_at is null
    and task.schedule_confirmed_by is null
    and task.confirmed_schedule_version is null
    and private.user_can_edit_task(p_actor_user_id, p_task_id)
    and (
      event.after_snapshot ->> 'schedule_unconfirmation_origin' =
        'explicit_admin'
      and private.user_is_company_admin(p_actor_user_id, p_company_id)
      or event.after_snapshot ->> 'schedule_unconfirmation_origin' =
        'schedule_edit'
    )
    and coalesce(
      company.client_comms_settings
        #>> '{appointment_confirmation,reschedule_behavior}',
      'draft'
    ) = 'notify'
  for update of event, task;
  if not found then
    raise exception 'schedule_unconfirmation_notification_stale'
      using errcode = '40001';
  end if;

  if v_locale = 'es' and v_change_kind = 'unscheduled' then
    v_title := 'VISITA CONFIRMADA SIN FECHA';
    v_body := 'Una visita confirmada se eliminó del calendario. Avisa al cliente o fija una nueva fecha.';
    v_action_label := 'Abrir calendario';
  elsif v_locale = 'es' then
    v_title := 'TAREA CONFIRMADA REPROGRAMADA';
    v_body := 'Una cita previamente confirmada ha cambiado. Considera avisar al cliente.';
    v_action_label := 'Abrir calendario';
  elsif v_change_kind = 'unscheduled' then
    v_title := 'CONFIRMED VISIT UNSCHEDULED';
    v_body := 'A confirmed visit was removed from the calendar. Let the client know or set a new date.';
    v_action_label := 'Open Calendar';
  else
    v_title := 'CONFIRMED TASK RESCHEDULED';
    v_body := 'A previously-confirmed appointment was changed. Consider letting the client know.';
    v_action_label := 'Open Calendar';
  end if;

  v_created := public.create_notification_if_new_with_status(
    p_actor_user_id::text,
    p_company_id::text,
    'mention',
    v_title,
    v_body,
    false,
    '/schedule',
    v_action_label,
    null,
    null,
    'task-automation-notification:' || p_event_id::text
  );
  return jsonb_build_object('created', v_created);
end;
$function$;

revoke all on function public.persist_schedule_unconfirmation_notification_as_system(
  uuid, uuid, uuid, uuid, uuid, bigint, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.persist_schedule_unconfirmation_notification_as_system(
  uuid, uuid, uuid, uuid, uuid, bigint, timestamptz
) to service_role;

-- Full-auto confirmation now follows the same purpose-specific confirm RPC and
-- durable dispatch event as cron/manual confirmation. Keep the legacy action
-- writer for the other automation kinds, but fail closed if old application
-- code tries to insert a confirmation action before binding its proof.
alter function public.persist_task_automation_agent_action(
  uuid, uuid, uuid, bigint, text, jsonb, text, text, text, numeric,
  text, timestamptz, timestamptz
) rename to persist_task_automation_agent_action_unversioned_impl;

revoke all on function public.persist_task_automation_agent_action_unversioned_impl(
  uuid, uuid, uuid, bigint, text, jsonb, text, text, text, numeric,
  text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create function public.persist_task_automation_agent_action(
  p_event_id uuid,
  p_lease_token uuid,
  p_task_id uuid,
  p_task_schedule_version bigint,
  p_action_type text,
  p_action_data jsonb,
  p_context_summary text,
  p_context_source text,
  p_source_id text,
  p_confidence numeric default 0.5,
  p_priority text default 'normal',
  p_expires_at timestamptz default null,
  p_auto_execute_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  perform 1
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.lease_token = p_lease_token
    and event.task_id = p_task_id
    and event.task_schedule_version = p_task_schedule_version
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and event.kind not in (
      'schedule_confirmation_dispatch',
      'schedule_unconfirmation_dispatch'
    )
    and not (
      event.kind = 'full_auto_confirmation'
      and p_action_type = 'send_appointment_confirmation'
    );
  if not found then
    raise exception 'task_automation_confirmation_requires_purpose_dispatch'
      using errcode = '42501';
  end if;

  v_result := public.persist_task_automation_agent_action_unversioned_impl(
    p_event_id,
    p_lease_token,
    p_task_id,
    p_task_schedule_version,
    p_action_type,
    p_action_data,
    p_context_summary,
    p_context_source,
    p_source_id,
    p_confidence,
    p_priority,
    p_expires_at,
    p_auto_execute_at
  );
  return v_result;
end;
$function$;

revoke all on function public.persist_task_automation_agent_action(
  uuid, uuid, uuid, bigint, text, jsonb, text, text, text, numeric,
  text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.persist_task_automation_agent_action(
  uuid, uuid, uuid, bigint, text, jsonb, text, text, text, numeric,
  text, timestamptz, timestamptz
) to service_role;

-- Preserve the legacy implementation for ordinary automation notifications,
-- but never allow a purpose event to reach its caller-owned copy surface.
alter function public.persist_task_automation_notification(
  uuid, uuid, uuid, bigint, text, text, text, text
) rename to persist_task_automation_notification_unversioned_impl;

revoke all on function public.persist_task_automation_notification_unversioned_impl(
  uuid, uuid, uuid, bigint, text, text, text, text
) from public, anon, authenticated, service_role;

create function public.persist_task_automation_notification(
  p_event_id uuid,
  p_lease_token uuid,
  p_task_id uuid,
  p_task_schedule_version bigint,
  p_title text,
  p_body text,
  p_action_url text default '/schedule',
  p_action_label text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  perform 1
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.lease_token = p_lease_token
    and event.task_id = p_task_id
    and event.task_schedule_version = p_task_schedule_version
    and event.status = 'processing'
    and event.lease_expires_at > now()
    and event.kind not in (
      'schedule_confirmation_dispatch',
      'schedule_unconfirmation_dispatch'
    );
  if not found then
    raise exception 'task_automation_notification_requires_purpose_dispatch'
      using errcode = '42501';
  end if;

  v_result := public.persist_task_automation_notification_unversioned_impl(
    p_event_id,
    p_lease_token,
    p_task_id,
    p_task_schedule_version,
    p_title,
    p_body,
    p_action_url,
    p_action_label
  );
  return v_result;
end;
$function$;

revoke all on function public.persist_task_automation_notification(
  uuid, uuid, uuid, bigint, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.persist_task_automation_notification(
  uuid, uuid, uuid, bigint, text, text, text, text
) to service_role;

-- Manifest v4 compatibility keeps the already-shipped, fully authorized v3
-- readers behind thin public wrappers. The legacy implementations remain
-- private/revoked and still perform their original same-statement authority
-- and source checks; only the manifest literal is translated internally.
create or replace function private.agent_legacy_manifest_v3_revision()
returns text
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select '2026-08-11.capability-manifest.v3'::text;
$function$;

revoke all on function private.agent_legacy_manifest_v3_revision()
  from public, anon, authenticated, service_role;

alter function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) rename to read_agent_job_conversation_context_v3_impl;
alter function public.read_agent_job_conversation_context_v3_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) set schema private;
revoke all on function private.read_agent_job_conversation_context_v3_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_job_conversation_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_exact_turn_limit integer default 20,
  p_sections text[] default array[
    'memory',
    'recent_turns',
    'participants',
    'gaps',
    'cross_job_seed'
  ]::text[],
  p_required_through_turn_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_id is distinct from 'get_job_conversation_context'
     or p_capability_revision is distinct from
       'get_job_conversation_context:2026-08-07.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-12.capability-manifest.v4' then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  return private.read_agent_job_conversation_context_v3_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    private.agent_legacy_manifest_v3_revision(),
    p_required_oauth_scopes,
    p_inbox_scope,
    p_clients_scope,
    p_job_permission,
    p_job_scope,
    p_job_kind,
    p_job_id,
    p_exact_turn_limit,
    p_sections,
    p_required_through_turn_id
  );
end;
$function$;

revoke all on function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) to service_role;

alter function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) rename to read_agent_correspondence_evidence_v3_impl;
alter function public.read_agent_correspondence_evidence_v3_impl(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) set schema private;
revoke all on function private.read_agent_correspondence_evidence_v3_impl(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_correspondence_evidence_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scope text,
  p_inbox_scope text,
  p_evidence_ids text[]
) returns table (
  evidence_id text,
  company_id uuid,
  source_id text,
  occurred_at text,
  subject text,
  side text,
  participant_id text,
  participant_resolution_status text,
  direction text,
  source_activity_id uuid,
  source_correspondence_event_id uuid,
  recipient_identities text[],
  cc_recipient_identities text[],
  redaction_kinds text[],
  normalized_plain_text text,
  original_content_hash text,
  attachments jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_id is distinct from 'get_correspondence_evidence'
     or p_capability_revision is distinct from
       'get_correspondence_evidence:2026-08-07.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-12.capability-manifest.v4' then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;
  return query
  select
    legacy.evidence_id,
    legacy.company_id,
    legacy.source_id,
    legacy.occurred_at,
    legacy.subject,
    legacy.side,
    legacy.participant_id,
    legacy.participant_resolution_status,
    legacy.direction,
    legacy.source_activity_id,
    legacy.source_correspondence_event_id,
    legacy.recipient_identities,
    legacy.cc_recipient_identities,
    legacy.redaction_kinds,
    legacy.normalized_plain_text,
    legacy.original_content_hash,
    legacy.attachments
  from private.read_agent_correspondence_evidence_v3_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    private.agent_legacy_manifest_v3_revision(),
    p_required_oauth_scope,
    p_inbox_scope,
    p_evidence_ids
  ) as legacy;
end;
$function$;

revoke all on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) to service_role;

-- Projection hashes are independently recomputed by TypeScript. This fixed
-- serializer exactly matches compact JSON with recursively sorted ASCII keys;
-- jsonb::text itself is not a wire contract because it inserts spaces.
create or replace function private.canonical_agent_projection_json(
  p_value jsonb
) returns text
language plpgsql
immutable
strict
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_kind text := jsonb_typeof(p_value);
  v_result text;
begin
  if v_kind = 'array' then
    select '[' || coalesce(
      string_agg(
        private.canonical_agent_projection_json(element.value),
        ',' order by element.ordinality
      ),
      ''
    ) || ']'
    into v_result
    from jsonb_array_elements(p_value) with ordinality
      as element(value, ordinality);
    return v_result;
  end if;

  if v_kind = 'object' then
    select '{' || coalesce(
      string_agg(
        to_jsonb(member.key)::text || ':' ||
          private.canonical_agent_projection_json(member.value),
        ',' order by member.key collate "C"
      ),
      ''
    ) || '}'
    into v_result
    from jsonb_each(p_value) as member(key, value);
    return v_result;
  end if;

  if v_kind = 'number' and (
    trunc(p_value::text::numeric) is distinct from p_value::text::numeric
    or abs(p_value::text::numeric) > 9007199254740991::numeric
  ) then
    raise exception 'agent_projection_number_not_safe_integer'
      using errcode = '22023';
  end if;

  return p_value::text;
end;
$function$;

revoke all on function private.canonical_agent_projection_json(jsonb)
  from public, anon, authenticated, service_role;

-- Cross-language golden vector: quotes, backslashes, newline, punctuation,
-- Unicode, null, booleans, safe integers, arrays, and nested objects.
do $block$
declare
  v_vector jsonb := jsonb_build_object(
    'z', E'quotes " backslash \\\\ newline\n unicode café 雪',
    'a', jsonb_build_array(
      null,
      true,
      false,
      0,
      -12,
      125,
      9007199254740991,
      jsonb_build_object('punct', '!:@,[]{}')
    )
  );
  v_canonical text;
  v_hash text;
begin
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception
      'agent_operational_read_prerequisite_missing: extensions.digest(bytea,text)';
  end if;
  -- PostgreSQL JSONB normalizes numeric negative zero before the serializer;
  -- TypeScript rejects a distinguishable JavaScript -0, so both runtimes can
  -- only hash the shared canonical integer 0.
  if '-0'::jsonb::text is distinct from '0' then
    raise exception 'agent_projection_negative_zero_normalization_mismatch';
  end if;
  v_canonical := private.canonical_agent_projection_json(v_vector);
  if v_canonical is distinct from
    $golden${"a":[null,true,false,0,-12,125,9007199254740991,{"punct":"!:@,[]{}"}],"z":"quotes \" backslash \\\\ newline\n unicode café 雪"}$golden$ then
    raise exception 'agent_projection_canonical_json_golden_mismatch';
  end if;
  v_hash := encode(
    extensions.digest(convert_to(v_canonical, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_hash is distinct from
    'a09675457eaaf2363adab2ed25209060361e9b8cf523782a4d2cd62b6a9844a2' then
    raise exception 'agent_projection_sha256_golden_mismatch';
  end if;
end;
$block$;

-- Every table that can change an operational schedule/readiness projection
-- advances one tenant-local monotonic fence. The table remains private and is
-- reachable only from fixed SECURITY DEFINER read functions.
create table if not exists private.agent_operational_read_revisions (
  -- Deliberately no companies FK: a company DELETE must retain its final
  -- revision tombstone without an ON DELETE race or cascading the fence away.
  company_id uuid primary key,
  source_revision bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  constraint agent_operational_read_revisions_safe_integer
    check (source_revision between 0 and 9007199254740991)
);

revoke all on table private.agent_operational_read_revisions
  from public, anon, authenticated, service_role;

insert into private.agent_operational_read_revisions (
  company_id,
  source_revision,
  updated_at
)
select company.id, 0, statement_timestamp()
from public.companies company
on conflict (company_id) do nothing;

create or replace function private.advance_agent_operational_read_revision(
  p_company_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
begin
  if p_company_id is null then
    return;
  end if;
  insert into private.agent_operational_read_revisions as revision (
    company_id,
    source_revision,
    updated_at
  ) values (
    p_company_id,
    1,
    statement_timestamp()
  )
  on conflict (company_id) do update
  set source_revision = revision.source_revision + 1,
      updated_at = excluded.updated_at
  where revision.source_revision < 9007199254740991;
  if not found then
    raise exception 'agent_operational_read_revision_exhausted'
      using errcode = '22003';
  end if;
end;
$function$;

revoke all on function private.advance_agent_operational_read_revision(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.bump_agent_operational_read_revision()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_old_company_id uuid;
  v_new_company_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_table_name = 'companies' then
      v_old_company_id := old.id;
    elsif tg_table_name = 'project_photos' then
      v_old_company_id := case
        when pg_input_is_valid(old.company_id::text, 'uuid')
          then old.company_id::text::uuid
        else null
      end;
    else
      v_old_company_id := old.company_id;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if tg_table_name = 'companies' then
      v_new_company_id := new.id;
    elsif tg_table_name = 'project_photos' then
      v_new_company_id := case
        when pg_input_is_valid(new.company_id::text, 'uuid')
          then new.company_id::text::uuid
        else null
      end;
    else
      v_new_company_id := new.company_id;
    end if;
  end if;

  if v_old_company_id is not null then
    perform private.advance_agent_operational_read_revision(v_old_company_id);
  end if;

  if v_new_company_id is not null
     and v_new_company_id is distinct from v_old_company_id then
    perform private.advance_agent_operational_read_revision(v_new_company_id);
  end if;

  -- AFTER row-trigger return values are ignored. NULL avoids polymorphic
  -- record coercion and makes that fact explicit.
  return null;
end;
$function$;

revoke all on function private.bump_agent_operational_read_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists companies_bump_agent_operational_read_revision
  on public.companies;
create trigger companies_bump_agent_operational_read_revision
after insert or update or delete on public.companies
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists project_tasks_bump_agent_operational_read_revision
  on public.project_tasks;
create trigger project_tasks_bump_agent_operational_read_revision
after insert or update or delete on public.project_tasks
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists projects_bump_agent_operational_read_revision
  on public.projects;
create trigger projects_bump_agent_operational_read_revision
after insert or update or delete on public.projects
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists users_bump_agent_operational_read_revision
  on public.users;
create trigger users_bump_agent_operational_read_revision
after insert or update or delete on public.users
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists clients_bump_agent_operational_read_revision
  on public.clients;
create trigger clients_bump_agent_operational_read_revision
after insert or update or delete on public.clients
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists project_photos_bump_agent_operational_read_revision
  on public.project_photos;
create trigger project_photos_bump_agent_operational_read_revision
after insert or update or delete on public.project_photos
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists task_types_bump_agent_operational_read_revision
  on public.task_types;
create trigger task_types_bump_agent_operational_read_revision
after insert or update or delete on public.task_types
for each row execute function private.bump_agent_operational_read_revision();

-- Resolve one local wall-clock value only when it maps to exactly one UTC
-- instant. Spring gaps and fall folds return NULL and are rejected by the read
-- RPCs instead of guessing an appointment time.
create or replace function private.agent_unambiguous_local_instant(
  p_local timestamp without time zone,
  p_timezone text
) returns timestamptz
language sql
stable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  with guessed as materialized (
    select p_local at time zone p_timezone as instant
  ), probes as materialized (
    select guessed.instant from guessed
    union all
    select guessed.instant - interval '36 hours' from guessed
    union all
    select guessed.instant + interval '36 hours' from guessed
  ), possible_offset as materialized (
    select distinct
           (probe.instant at time zone p_timezone) -
             (probe.instant at time zone 'UTC') as utc_offset
    from probes probe
  ), matching as (
    select distinct
           (p_local - tz.utc_offset) at time zone 'UTC' as instant
    from possible_offset tz
    where (
      (p_local - tz.utc_offset) at time zone 'UTC'
    ) at time zone p_timezone = p_local
  )
  select case when count(*) = 1 then min(instant) else null end
  from matching;
$function$;

revoke all on function private.agent_unambiguous_local_instant(
  timestamp without time zone, text
) from public, anon, authenticated, service_role;

-- Calendar-day boundaries differ from timed wall clocks: a midnight gap uses
-- the first representable instant of that same civil date, and a midnight fold
-- uses its earliest occurrence. A wholly skipped civil date remains invalid.
create or replace function private.agent_civil_date_start(
  p_date date,
  p_timezone text
) returns timestamptz
language sql
stable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  with local_value as materialized (
    select p_date::timestamp without time zone as value
  ), guessed as materialized (
    select local.value at time zone p_timezone as instant
    from local_value local
  ), probes as materialized (
    select guessed.instant from guessed
    union all
    select guessed.instant - interval '36 hours' from guessed
    union all
    select guessed.instant + interval '36 hours' from guessed
  ), possible_offset as materialized (
    select distinct
           (probe.instant at time zone p_timezone) -
             (probe.instant at time zone 'UTC') as utc_offset
    from probes probe
  ), exact_match as materialized (
    select distinct
           (local.value - tz.utc_offset) at time zone 'UTC' as instant
    from local_value local
    cross join possible_offset tz
    where (
      (local.value - tz.utc_offset) at time zone 'UTC'
    ) at time zone p_timezone = local.value
  ), boundary as materialized (
    select min(match.instant) as instant from exact_match match
  )
  select coalesce(
    boundary.instant,
    case when (guessed.instant at time zone p_timezone)::date = p_date
      then guessed.instant
      else null
    end
  )
  from boundary
  cross join guessed;
$function$;

revoke all on function private.agent_civil_date_start(date, text)
  from public, anon, authenticated, service_role;

-- Legacy project_tasks wall-clock columns are TEXT. Keep every cast inside a
-- non-inlined PL/pgSQL guard so planner reordering can never evaluate a cast
-- for malformed source data.
create or replace function private.agent_parse_schedule_wall_time(
  p_value text
) returns time without time zone
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
begin
  if p_value !~
    '^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$' then
    return null;
  end if;
  return p_value::time;
end;
$function$;

revoke all on function private.agent_parse_schedule_wall_time(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_rfc3339_utc(
  p_value timestamptz
) returns text
language sql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select to_char(
    p_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$function$;

revoke all on function private.agent_rfc3339_utc(timestamptz)
  from public, anon, authenticated, service_role;

-- Operational schedule projections rely on the database tzdb, not an app
-- runtime's bundled ICU data. The 2026c North-American permanent-DST rules are
-- a deployment prerequisite; fail the migration and every read closed when a
-- platform has stale timezone data.
create or replace function private.agent_assert_operational_timezone_rules()
returns void
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $function$
begin
  if timestamp with time zone '2026-11-01 11:30:00+00'
       at time zone 'America/Vancouver'
       is distinct from timestamp '2026-11-01 04:30:00'
     or timestamp with time zone '2026-11-01 11:30:00+00'
       at time zone 'America/Edmonton'
       is distinct from timestamp '2026-11-01 05:30:00'
     or timestamp with time zone '2026-11-01 11:30:00+00'
       at time zone 'Africa/Casablanca'
       is distinct from timestamp '2026-11-01 11:30:00'
     or timestamp with time zone '2026-11-01 11:30:00+00'
       at time zone 'UTC'
       is distinct from timestamp '2026-11-01 11:30:00' then
    -- DATED BACKSTOP (2026-08-17, Jackson's ship ruling; bug_reports follow-up
    -- filed): the platform tzdb predates the 2026c permanent-DST rules and the
    -- Supabase build refresh is pending (support ticket open). Booking horizons
    -- keep the damage window empty until at least mid-September: stale and
    -- current rules agree for every instant before 2026-11-01, and no
    -- November-or-later schedule realistically enters the system before then.
    -- Until 2026-09-15 this check therefore WARNS instead of failing; from
    -- 2026-09-15 it hard-fails exactly as originally written, so stale rules
    -- can never overlap real November scheduling. Restore the unconditional
    -- raise the moment the platform tzdb is current.
    if clock_timestamp() >= timestamptz '2026-09-15 00:00:00+00' then
      raise exception 'operational_timezone_rules_unavailable'
        using errcode = '55000';
    end if;
    raise warning 'operational_timezone_rules_stale: platform tzdb predates 2026c; hard enforcement resumes 2026-09-15';
  end if;
end;
$function$;

revoke all on function private.agent_assert_operational_timezone_rules()
  from public, anon, authenticated, service_role;

do $timezone_rules$
begin
  perform private.agent_assert_operational_timezone_rules();
end;
$timezone_rules$;

create or replace function public.read_agent_scheduled_jobs_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[] default null,
  p_display_timezone text default null,
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_start_utc timestamptz default null,
  p_cursor_task_id uuid default null,
  p_limit integer default 25
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_current_source_revision bigint;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  perform private.agent_assert_operational_timezone_rules();
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or char_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision
       !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or cardinality(p_registered_permission_keys) not between 1 and 256
     or not ('calendar.view' = any(p_registered_permission_keys))
     or not ('projects.view' = any(p_registered_permission_keys))
     or not ('tasks.view' = any(p_registered_permission_keys))
     or p_capability_id is distinct from 'list_scheduled_jobs'
     or p_capability_revision is distinct from
       'list_scheduled_jobs:2026-08-07.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-12.capability-manifest.v4'
     or p_required_oauth_scopes is distinct from
       array['ops.jobs.read', 'ops.schedule.read']::text[]
     or p_calendar_scope not in ('all', 'own')
     or p_projects_scope not in ('all', 'assigned')
     or p_tasks_scope not in ('all', 'assigned')
     or p_from is null
     or p_to is null
     or p_to <= p_from
     or p_to > p_from + interval '90 days'
     or p_task_statuses is null
     or cardinality(p_task_statuses) not between 1 and 3
     or p_limit is null
     or p_limit < 1
     or p_limit > 50
     or (p_cursor_source_revision is null) is distinct from
       (p_cursor_start_utc is null)
     or (p_cursor_source_revision is null) is distinct from
       (p_cursor_task_id is null)
     or p_cursor_source_revision < 0
     or p_cursor_source_revision > 9007199254740991
     or (p_read_as_of is null) is distinct from
       (p_cursor_source_revision is null)
     or p_display_timezone is not null and not exists (
       select 1 from pg_timezone_names timezone
       where timezone.name = p_display_timezone
     ) then
    raise exception 'invalid_agent_scheduled_jobs_request'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from btrim(registry.permission_key)
       or char_length(registry.permission_key) not between 1 and 128
  ) or (
    select count(distinct registry.permission_key)
    from unnest(p_registered_permission_keys) registry(permission_key)
  ) <> cardinality(p_registered_permission_keys)
  or exists (
    select 1 from unnest(p_task_statuses) requested(status)
    where requested.status not in ('active', 'completed', 'cancelled')
  ) or (
    select count(distinct requested.status)
    from unnest(p_task_statuses) requested(status)
  ) <> cardinality(p_task_statuses)
  or p_confirmation_states is not null and (
    cardinality(p_confirmation_states) not between 1 and 2
    or exists (
      select 1 from unnest(p_confirmation_states) requested(state)
      where requested.state not in ('confirmed', 'unconfirmed')
    )
    or (
      select count(distinct requested.state)
      from unnest(p_confirmation_states) requested(state)
    ) <> cardinality(p_confirmation_states)
  ) then
    raise exception 'invalid_agent_scheduled_jobs_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'calendar.view'
           ) as calendar_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'tasks.view'
           ) as tasks_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), read_context as materialized (
    select authority.permission_snapshot_revision,
           authority.calendar_scope,
           authority.projects_scope,
           authority.tasks_scope,
           revision.source_revision,
           date_trunc(
             'milliseconds',
             coalesce(p_read_as_of, statement_timestamp())
           ) as read_at,
           company.timezone as company_timezone,
           coalesce(p_display_timezone, company.timezone) as display_timezone
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_operational_read_revisions revision
      on revision.company_id = company.id
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.calendar_scope = p_calendar_scope
      and authority.projects_scope = p_projects_scope
      and authority.tasks_scope = p_tasks_scope
      and (
        p_cursor_source_revision is null
        or revision.source_revision = p_cursor_source_revision
      )
      and revision.source_revision between 0 and 9007199254740991
  ), authorized_task_candidate as materialized (
    select task.id as task_id,
           task.project_id,
           task.company_id,
           coalesce(
             nullif(btrim(task.custom_title), ''),
             nullif(btrim(task_type.display), ''),
             nullif(btrim(project.title), '')
           ) as task_title,
           task.status as task_status,
           task.start_date,
           task.end_date,
           task.start_time,
           task.end_time,
           task.all_day,
           greatest(coalesce(task.duration, 1), 1) as duration,
           task.team_member_ids,
           task.schedule_confirmed_at,
           task.confirmed_schedule_version,
           task.schedule_locked,
           task.schedule_version,
           task.updated_at as task_updated_at,
           project.title as project_title,
           project.address as project_address,
           project.status as project_status,
           project.status_version as project_status_version,
           project.updated_at as project_updated_at,
           context.source_revision,
           context.read_at,
           context.company_timezone,
           context.display_timezone
    from read_context context
    join public.project_tasks task
      on task.company_id = p_company_id
    join public.projects project
      on project.id = task.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    left join public.task_types task_type
      on task_type.id = task.task_type_id
     and task_type.company_id = p_company_id
     and task_type.deleted_at is null
    where task.deleted_at is null
      and task.start_date is not null
      and task.start_date < p_to + interval '2 days'
      and coalesce(
        task.end_date,
        task.start_date + make_interval(
          days => greatest(coalesce(task.duration, 1), 1)
        )
      ) >= p_from - interval '2 days'
      and task.status = any(p_task_statuses)
      and context.company_timezone is not null
      and exists (
        select 1 from pg_timezone_names timezone
        where timezone.name = context.company_timezone
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'project',
        project.id,
        'view'
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'task',
        task.id,
        'view'
      )
      and (
        context.calendar_scope = 'all'
        or (
          context.calendar_scope = 'own'
          and p_actor_user_id::text = any(
            coalesce(task.team_member_ids, array[]::text[])
          )
        )
      )
      and (
        context.tasks_scope = 'all'
        or p_actor_user_id::text = any(
          coalesce(task.team_member_ids, array[]::text[])
        )
      )
      and (
        context.projects_scope = 'all'
        or exists (
          select 1
          from public.project_tasks project_assignment
          where project_assignment.project_id = project.id
            and project_assignment.company_id = p_company_id
            and project_assignment.deleted_at is null
            and project_assignment.status = 'active'
            and p_actor_user_id::text = any(
              coalesce(
                project_assignment.team_member_ids,
                array[]::text[]
              )
          )
        )
      )
    order by task.start_date, task.id
    limit 2501
  ), authorized_task as materialized (
    select candidate.*
    from authorized_task_candidate candidate
    order by candidate.start_date, candidate.task_id
  ), authorized_task_bound as materialized (
    select exists (
      select 1 from authorized_task candidate
      offset 2500 limit 1
    ) as exceeded
  ), invalid_authorized_source as materialized (
    select task.task_id
    from authorized_task task
    where task.task_title is null
       or char_length(task.task_title) > 1000
       or task.project_address is not null
          and nullif(btrim(task.project_address), '') is not null
          and char_length(btrim(task.project_address)) > 2000
       or task.project_status not in (
         'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
         'closed', 'archived'
       )
       or not task.all_day
          and (
            task.start_time is null
            or task.end_time is null
          )
       or task.end_date is not null
          and (task.end_date at time zone 'UTC')::date <
            (task.start_date at time zone 'UTC')::date
       or task.project_updated_at is null
       or task.task_updated_at is null
       or task.schedule_version not between 0 and 9007199254740991
       or task.project_status_version not between 0 and 9007199254740991
    limit 1
  ), local_schedule as materialized (
    select task.*,
           (
             (task.start_date at time zone 'UTC')::date
               + case when task.all_day
                   then time '00:00:00'
                   when task.start_time is not null
                     then task.start_time
                   else null::time
                 end
           )::timestamp without time zone as local_start_value,
           (
             case when task.all_day then
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date
                   + task.duration - 1
               ) + time '00:00:00'
             else
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   case
                     when task.start_time is not null
                       and task.end_time is not null
                       and task.end_time <= task.start_time
                       then 1
                     else 0
                   end
               ) + case
                 when task.end_time is not null
                   then task.end_time
                 else null::time
               end
             end
           )::timestamp without time zone as local_end_value
    from authorized_task task
    where task.task_title is not null
      and char_length(task.task_title) <= 1000
      and (
        task.project_address is null
        or nullif(btrim(task.project_address), '') is null
        or char_length(btrim(task.project_address)) <= 2000
      )
      and task.project_status in (
        'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
        'closed', 'archived'
      )
      and (
        task.all_day
        or task.start_time is not null
           and task.end_time is not null
      )
      and task.project_updated_at is not null
      and task.task_updated_at is not null
      and task.schedule_version between 0 and 9007199254740991
      and task.project_status_version between 0 and 9007199254740991
      and (
        task.end_date is null
        or (task.end_date at time zone 'UTC')::date >=
          (task.start_date at time zone 'UTC')::date
      )
  ), resolved_schedule as materialized (
    select schedule.*,
           case when schedule.all_day
             then private.agent_civil_date_start(
               schedule.local_start_value::date,
               schedule.company_timezone
             )
             else private.agent_unambiguous_local_instant(
               schedule.local_start_value,
               schedule.company_timezone
             )
           end as scheduled_start_utc,
           case when schedule.all_day
             then private.agent_civil_date_start(
               schedule.local_end_value::date + 1,
               schedule.company_timezone
             )
             else private.agent_unambiguous_local_instant(
               schedule.local_end_value,
               schedule.company_timezone
             )
           end as scheduled_end_utc
    from local_schedule schedule
  ), invalid_resolved_source as materialized (
    select schedule.task_id
    from resolved_schedule schedule
    where schedule.scheduled_start_utc is null
       or schedule.scheduled_end_utc is null
       or schedule.scheduled_end_utc <= schedule.scheduled_start_utc
    limit 1
  ), window_candidate as materialized (
    select schedule.*,
           case when schedule.task_status <> 'active' then 'past'
             when schedule.scheduled_start_utc > schedule.read_at then 'upcoming'
             when schedule.scheduled_end_utc > schedule.read_at then 'in_progress'
             else 'past_due'
           end as timing_state,
           case when schedule.schedule_confirmed_at is not null
                  and schedule.confirmed_schedule_version =
                    schedule.schedule_version
             then 'confirmed' else 'unconfirmed'
           end as confirmation_state
    from resolved_schedule schedule
    where schedule.scheduled_start_utc is not null
      and schedule.scheduled_end_utc is not null
      and schedule.scheduled_end_utc > schedule.scheduled_start_utc
      and schedule.scheduled_end_utc > p_from
      and schedule.scheduled_start_utc < p_to
  ), filtered_candidate as materialized (
    select candidate.*
    from window_candidate candidate
    where (
        p_confirmation_states is null
        or candidate.confirmation_state = any(p_confirmation_states)
      )
      and (
        p_cursor_start_utc is null
        or (
          candidate.scheduled_start_utc,
          candidate.task_id
        ) > (
          p_cursor_start_utc,
          p_cursor_task_id
        )
      )
  ), page_seed as materialized (
    select candidate.task_id,
           candidate.project_id,
           candidate.task_title,
           candidate.task_status,
           candidate.all_day,
           candidate.team_member_ids,
           candidate_assignment.valid_assignment_count,
           candidate_assignment.assignment_source_bound,
           candidate_assignment.assignment_source_invalid,
           candidate.schedule_confirmed_at,
           candidate.confirmed_schedule_version,
           candidate.schedule_locked,
           candidate.schedule_version,
           candidate.task_updated_at,
           candidate.project_title,
           candidate.project_address,
           candidate.project_status,
           candidate.project_status_version,
           candidate.project_updated_at,
           candidate.source_revision,
           candidate.read_at,
           candidate.company_timezone,
           candidate.display_timezone,
           candidate.local_start_value,
           candidate.local_end_value,
           candidate.scheduled_start_utc,
           candidate.scheduled_end_utc,
           candidate.timing_state,
           candidate.confirmation_state
    from filtered_candidate candidate
    cross join lateral (
      select cardinality(
        coalesce(candidate.team_member_ids, array[]::text[])
      ) > 100 as assignment_source_bound,
      case when cardinality(
        coalesce(candidate.team_member_ids, array[]::text[])
      ) > 100 then false else exists (
        select 1
        from unnest(
          (coalesce(candidate.team_member_ids, array[]::text[]))[1:100]
        ) raw_member(user_id)
        left join public.users crew_user
          on pg_input_is_valid(raw_member.user_id, 'uuid')
         and crew_user.id::text = raw_member.user_id
         and crew_user.company_id = p_company_id
         and crew_user.deleted_at is null
         and coalesce(crew_user.is_active, false)
         and char_length(btrim(concat_ws(
           ' ', crew_user.first_name, crew_user.last_name
         ))) between 1 and 256
        where raw_member.user_id is null
           or not pg_input_is_valid(raw_member.user_id, 'uuid')
           or crew_user.id is null
      ) end as assignment_source_invalid,
      case when cardinality(
        coalesce(candidate.team_member_ids, array[]::text[])
      ) > 100 then 0 else (
        select count(distinct crew_user.id)::integer
        from unnest(
          (coalesce(candidate.team_member_ids, array[]::text[]))[1:100]
        ) raw_member(user_id)
        join public.users crew_user
          on pg_input_is_valid(raw_member.user_id, 'uuid')
         and crew_user.id::text = raw_member.user_id
         and crew_user.company_id = p_company_id
         and crew_user.deleted_at is null
         and coalesce(crew_user.is_active, false)
         and char_length(btrim(concat_ws(
           ' ', crew_user.first_name, crew_user.last_name
         ))) between 1 and 256
      ) end as valid_assignment_count
    ) candidate_assignment
    order by candidate.scheduled_start_utc, candidate.task_id
    limit p_limit + 1
  ), page_plus_one as materialized (
    select candidate.*,
           row_number() over (
             order by candidate.scheduled_start_utc, candidate.task_id
           ) as page_rank,
           sum(least(candidate.valid_assignment_count, 50)) over (
             order by candidate.scheduled_start_utc, candidate.task_id
             rows between unbounded preceding and current row
           ) as running_raw_assignment_count
    from page_seed candidate
  ), retained_page as materialized (
    select page.*
    from page_plus_one page
    where page.page_rank <= p_limit
      and page.running_raw_assignment_count <= 100
  ), crew_identity as materialized (
    select retained.task_id,
           crew_user.id as user_id,
           btrim(concat_ws(' ', crew_user.first_name, crew_user.last_name))
             as display_name,
           row_number() over (
             partition by retained.task_id order by crew_user.id
           ) as crew_rank,
           retained.valid_assignment_count
    from retained_page retained
    cross join lateral (
      select distinct raw_member.user_id
      from unnest(
        (coalesce(retained.team_member_ids, array[]::text[]))[1:100]
      ) raw_member(user_id)
      where raw_member.user_id is not null
    ) member
    join public.users crew_user
      on crew_user.id::text = member.user_id
     and crew_user.company_id = p_company_id
     and crew_user.deleted_at is null
     and coalesce(crew_user.is_active, false)
    where pg_input_is_valid(member.user_id, 'uuid')
  ), bounded_crew as materialized (
    select crew.task_id,
           crew.user_id,
           crew.display_name,
           crew.crew_rank,
           crew.valid_assignment_count
    from crew_identity crew
    where crew.crew_rank <= 50
      and crew.display_name is not null
      and char_length(crew.display_name) between 1 and 256
  ), crew_projection as materialized (
    select crew.task_id,
           jsonb_agg(
             jsonb_build_object(
               'user_id', crew.user_id,
               'display_name', crew.display_name
             ) order by crew.user_id
           ) as assignments,
           max(crew.valid_assignment_count)::integer as assignment_total
    from bounded_crew crew
    group by crew.task_id
  ), exact_occurrence as materialized (
    select retained.*,
           coalesce(crew.assignments, '[]'::jsonb) as assignments,
           retained.valid_assignment_count as assignment_total,
           jsonb_build_object(
             'job_ref', jsonb_build_object(
               'kind', 'project', 'id', retained.project_id
             ),
             'occurrence_ref', jsonb_build_object(
               'kind', 'project_task', 'id', retained.task_id
             ),
             'title', retained.task_title,
             'address', nullif(btrim(retained.project_address), ''),
             'task_status', retained.task_status,
             'timing_state', retained.timing_state,
             'confirmation_state', retained.confirmation_state,
             'schedule_confirmed_at', case
               when retained.confirmation_state = 'confirmed'
                 then private.agent_rfc3339_utc(
                   retained.schedule_confirmed_at
                 )
               else null
             end,
             'confirmed_schedule_version', case
               when retained.confirmation_state = 'confirmed'
                 then retained.confirmed_schedule_version
               else null
             end,
             'schedule_locked', retained.schedule_locked,
             'schedule_version', retained.schedule_version,
             'task_updated_at', private.agent_rfc3339_utc(
               retained.task_updated_at
             ),
             'project_status', retained.project_status,
             'project_status_version', retained.project_status_version,
             'project_updated_at', private.agent_rfc3339_utc(
               retained.project_updated_at
             ),
             'schedule', jsonb_build_object(
               'all_day', retained.all_day,
               'company_timezone', retained.company_timezone,
               'local_start', to_char(
                 retained.local_start_value,
                 'YYYY-MM-DD"T"HH24:MI:SS'
               ),
               'local_end_inclusive', case when retained.all_day
                 then to_char(
                   retained.local_end_value::date +
                     time '23:59:59.999999',
                   'YYYY-MM-DD"T"HH24:MI:SS.US'
                 )
                 else to_char(
                   retained.local_end_value,
                   'YYYY-MM-DD"T"HH24:MI:SS'
                 )
               end,
               'start_utc', private.agent_rfc3339_utc(
                 retained.scheduled_start_utc
               ),
               'start_utc_offset_minutes', (
                 extract(epoch from (
                   retained.scheduled_start_utc at time zone
                     retained.company_timezone
                   - retained.scheduled_start_utc at time zone 'UTC'
                 )) / 60
               )::integer,
               'start_pre_boundary_utc_offset_minutes', case
                 when retained.all_day then (
                   extract(epoch from (
                     (retained.scheduled_start_utc - interval '1 millisecond')
                       at time zone retained.company_timezone
                     - (retained.scheduled_start_utc - interval '1 millisecond')
                       at time zone 'UTC'
                   )) / 60
                 )::integer
                 else null
               end,
               'end_utc_exclusive', private.agent_rfc3339_utc(
                 retained.scheduled_end_utc
               ),
               'end_utc_offset_minutes', (
                 extract(epoch from (
                   retained.scheduled_end_utc at time zone
                     retained.company_timezone
                   - retained.scheduled_end_utc at time zone 'UTC'
                 )) / 60
               )::integer,
               'end_pre_boundary_utc_offset_minutes', case
                 when retained.all_day then (
                   extract(epoch from (
                     (retained.scheduled_end_utc - interval '1 millisecond')
                       at time zone retained.company_timezone
                     - (retained.scheduled_end_utc - interval '1 millisecond')
                       at time zone 'UTC'
                   )) / 60
                 )::integer
                 else null
               end,
               'display', jsonb_build_object(
                 'timezone', retained.display_timezone,
                 'local_start', to_char(
                   retained.scheduled_start_utc at time zone
                     retained.display_timezone,
                   'YYYY-MM-DD"T"HH24:MI:SS.MS'
                 ),
                 'local_end_exclusive', to_char(
                   retained.scheduled_end_utc at time zone
                     retained.display_timezone,
                   'YYYY-MM-DD"T"HH24:MI:SS.MS'
                 ),
                 'start_utc_offset_minutes', (
                   extract(epoch from (
                     retained.scheduled_start_utc at time zone
                       retained.display_timezone
                     - retained.scheduled_start_utc at time zone 'UTC'
                   )) / 60
                 )::integer,
                 'end_utc_offset_minutes', (
                   extract(epoch from (
                     retained.scheduled_end_utc at time zone
                       retained.display_timezone
                     - retained.scheduled_end_utc at time zone 'UTC'
                   )) / 60
                 )::integer
               )
             ),
             'assignments', coalesce(crew.assignments, '[]'::jsonb),
             'assignment_total', retained.valid_assignment_count,
             'assignments_omitted_count', greatest(
               retained.valid_assignment_count -
                 jsonb_array_length(coalesce(crew.assignments, '[]'::jsonb)),
               0
             )
           ) as occurrence
    from retained_page retained
    left join crew_projection crew on crew.task_id = retained.task_id
  ), projection as materialized (
    select occurrence.*,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'capability_id', p_capability_id,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'capability_revision', p_capability_revision,
             'company_id', p_company_id,
             'occurrence', occurrence.occurrence,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'read_at', private.agent_rfc3339_utc(occurrence.read_at),
             'source_revision', occurrence.source_revision
           ) as projection
    from exact_occurrence occurrence
  ), hashed_projection as materialized (
    select projection.*,
           'sha256:' || encode(
             extensions.digest(
               convert_to(
                 private.canonical_agent_projection_json(
                   projection.projection
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as source_content_hash
    from projection
  ), packaged as materialized (
    select hashed.*,
           jsonb_build_object(
             'source_domain', 'operations',
             'source_type', 'scheduled_job_occurrence_projection',
             'source_id', hashed.task_id,
             'version', 'scheduled-job-occurrence-projection:v1:' ||
               hashed.source_content_hash
           ) as source_version,
           'evidence:scheduled_job_occurrence_projection:' ||
             hashed.task_id::text as evidence_id
    from hashed_projection hashed
  ), validated as materialized (
    select context.*,
           (select exceeded from authorized_task_bound)
             as source_query_bound,
           exists (
             select 1 from retained_page seed
             where seed.assignment_source_bound
           ) as assignment_source_bound,
           exists (
             select 1 from retained_page seed
             where seed.assignment_source_invalid
           ) as assignment_source_invalid,
           exists(select 1 from invalid_authorized_source)
             or exists(select 1 from invalid_resolved_source)
             as source_data_invalid,
           exists(select 1 from page_plus_one page where page.task_id not in (
             select retained.task_id from retained_page retained
           )) as has_more
    from read_context context
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'read_at', private.agent_rfc3339_utc(validated.read_at),
    'source_fence', jsonb_build_object(
      'source_domain', 'operations',
      'source_type', 'operational_read_revision',
      'source_id', 'private.agent_operational_read_revisions',
      'version', 'revision:' || validated.source_revision::text
    ),
    'company_timezone', validated.company_timezone,
    'display_timezone', validated.display_timezone,
    '_source_query_bound', validated.source_query_bound
      or validated.assignment_source_bound,
    '_source_data_invalid', validated.source_data_invalid
      or validated.assignment_source_invalid,
    'occurrences', coalesce((
      select jsonb_agg(item.occurrence order by item.scheduled_start_utc, item.task_id)
      from packaged item
    ), '[]'::jsonb),
    'occurrence_proofs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'occurrence_ref', jsonb_build_object(
          'kind', 'project_task', 'id', item.task_id
        ),
        'source_version', item.source_version,
        'source_content_hash', item.source_content_hash,
        'evidence_id', item.evidence_id,
        'projection', item.projection
      ) order by item.scheduled_start_utc, item.task_id)
      from packaged item
    ), '[]'::jsonb),
    'returned_occurrence_count', (
      select count(*)::integer from packaged
    ),
    'next_cursor_claims', case when validated.has_more then (
      select jsonb_build_object(
        'source_revision', validated.source_revision,
        'start_utc', private.agent_rfc3339_utc(last_item.scheduled_start_utc),
        'task_id', last_item.task_id
      ) from retained_page last_item
      order by last_item.scheduled_start_utc desc, last_item.task_id desc
      limit 1
    ) else null end,
    'has_more', validated.has_more,
    'source_versions', jsonb_build_array(jsonb_build_object(
      'source_domain', 'operations',
      'source_type', 'operational_read_revision',
      'source_id', 'private.agent_operational_read_revisions',
      'version', 'revision:' || validated.source_revision::text
    )) || coalesce((
      select jsonb_agg(item.source_version order by item.scheduled_start_utc, item.task_id)
      from packaged item
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'evidence_id', item.evidence_id,
        'source_domain', item.source_version ->> 'source_domain',
        'source_type', item.source_version ->> 'source_type',
        'source_id', item.source_version ->> 'source_id',
        'version', item.source_version ->> 'version',
        'occurred_at', private.agent_rfc3339_utc(item.read_at),
        'relationship', 'supports',
        'locator', 'ops://projects/' || item.project_id::text ||
          '/tasks/' || item.task_id::text,
        'trust', 'authoritative_ops'
      ) order by item.scheduled_start_utc, item.task_id)
      from packaged item
    ), '[]'::jsonb)
  ) into v_result
  from validated
  where p_cursor_source_revision is null or
      validated.source_revision = p_cursor_source_revision;

  if coalesce((v_result ->> '_source_query_bound')::boolean, false) then
    raise exception 'agent_scheduled_jobs_source_query_bound'
      using errcode = '54000', detail = jsonb_build_object(
        'gap_code', 'SOURCE_QUERY_BOUND',
        'source_kind', 'task_schedule'
      )::text;
  end if;
  v_result := v_result - '_source_query_bound';

  if coalesce((v_result ->> '_source_data_invalid')::boolean, false) then
    raise exception 'agent_scheduled_jobs_source_data_invalid'
      using errcode = '22023', detail = jsonb_build_object(
        'gap_code', 'SOURCE_DATA_INVALID',
        'source_kind', 'task_schedule'
      )::text;
  end if;
  v_result := v_result - '_source_data_invalid';

  if v_result is null then
    select revision.source_revision into v_current_source_revision
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_operational_read_revisions revision
      on revision.company_id = company.id
    where p_cursor_source_revision is not null
      and revision.source_revision <> p_cursor_source_revision
      and authority.permission_snapshot_revision =
        p_permission_snapshot_revision
    group by revision.source_revision, authority.permission_snapshot_revision
    having max(permission.value ->> 'scope') filter (
      where permission.value ->> 'permission' = 'calendar.view'
    ) = p_calendar_scope
      and max(permission.value ->> 'scope') filter (
        where permission.value ->> 'permission' = 'projects.view'
      ) = p_projects_scope
      and max(permission.value ->> 'scope') filter (
        where permission.value ->> 'permission' = 'tasks.view'
      ) = p_tasks_scope;
    if v_current_source_revision is not null then
      raise exception 'agent_operational_read_cursor_stale'
        using errcode = '40001', detail = jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'operational_read_revision',
          'source_id', 'private.agent_operational_read_revisions',
          'version', 'revision:' || v_current_source_revision::text
        )::text;
    end if;
    raise exception 'agent_scheduled_jobs_read_forbidden_or_invalid'
      using errcode = '42501';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) to service_role;

create or replace function public.read_agent_job_readiness_issues_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_first_scheduled_start_utc timestamptz default null,
  p_cursor_project_id uuid default null,
  p_scan_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_expected_oauth_scopes text[];
  v_current_source_revision bigint;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  perform private.agent_assert_operational_timezone_rules();
  if p_rule_codes is not null then
    select array_agg(requested.scope order by requested.scope)
    into v_expected_oauth_scopes
    from (
      select 'ops.jobs.read'::text as scope
      union
      select 'ops.schedule.read'::text
      union
      select 'ops.photos.read'::text
      where 'SITE_PHOTOS_MISSING' = any(p_rule_codes)
      union
      select 'ops.customers.read'::text
      where 'CUSTOMER_RECORD_UNRESOLVED' = any(p_rule_codes)
    ) requested;
  end if;
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or char_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision
       !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or cardinality(p_registered_permission_keys) not between 1 and 256
     or not ('calendar.view' = any(p_registered_permission_keys))
     or not ('projects.view' = any(p_registered_permission_keys))
     or not ('tasks.view' = any(p_registered_permission_keys))
     or not ('clients.view' = any(p_registered_permission_keys))
     or not ('photos.view' = any(p_registered_permission_keys))
     or p_capability_id is distinct from 'list_job_readiness_issues'
     or p_capability_revision is distinct from
       'list_job_readiness_issues:2026-08-07.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-12.capability-manifest.v4'
     or p_required_oauth_scopes is distinct from v_expected_oauth_scopes
     or p_calendar_scope not in ('all', 'own')
     or p_projects_scope not in ('all', 'assigned')
     or p_tasks_scope not in ('all', 'assigned')
     or (
       'CUSTOMER_RECORD_UNRESOLVED' = any(p_rule_codes)
     ) is distinct from (p_clients_scope is not null)
     or p_clients_scope is not null
       and p_clients_scope not in ('all', 'assigned')
     or (
       'SITE_PHOTOS_MISSING' = any(p_rule_codes)
     ) is distinct from (p_photos_scope is not null)
     or p_photos_scope is not null
       and p_photos_scope not in ('all', 'assigned')
     or p_from is null
     or p_to is null
     or p_to <= p_from
     or p_to > p_from + interval '90 days'
     or p_rule_codes is null
     or cardinality(p_rule_codes) not between 1 and 5
     or p_scan_limit is null
     or p_scan_limit < 1
     or p_scan_limit > 50
     or (p_cursor_source_revision is null) is distinct from
       (p_cursor_first_scheduled_start_utc is null)
     or (p_cursor_source_revision is null) is distinct from
       (p_cursor_project_id is null)
     or (p_read_as_of is null) is distinct from
       (p_cursor_source_revision is null)
     or p_cursor_source_revision < 0
     or p_cursor_source_revision > 9007199254740991 then
    raise exception 'invalid_agent_job_readiness_request'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from btrim(registry.permission_key)
       or char_length(registry.permission_key) not between 1 and 128
  ) or (
    select count(distinct registry.permission_key)
    from unnest(p_registered_permission_keys) registry(permission_key)
  ) <> cardinality(p_registered_permission_keys)
  or exists (
    select 1 from unnest(p_rule_codes) requested(rule_code)
    where requested.rule_code not in (
      'SITE_PHOTOS_MISSING',
      'CUSTOMER_RECORD_UNRESOLVED',
      'SCHEDULE_UNCONFIRMED',
      'CREW_UNASSIGNED',
      'ADDRESS_INCOMPLETE'
    )
  ) or (
    select count(distinct requested.rule_code)
    from unnest(p_rule_codes) requested(rule_code)
  ) <> cardinality(p_rule_codes) then
    raise exception 'invalid_agent_job_readiness_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'calendar.view'
           ) as calendar_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'clients.view'
               and 'CUSTOMER_RECORD_UNRESOLVED' = any(p_rule_codes)
           ) as clients_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'photos.view'
               and 'SITE_PHOTOS_MISSING' = any(p_rule_codes)
           ) as photos_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'tasks.view'
           ) as tasks_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), read_context as materialized (
    select authority.permission_snapshot_revision,
           authority.calendar_scope,
           authority.clients_scope,
           authority.photos_scope,
           authority.projects_scope,
           authority.tasks_scope,
           revision.source_revision,
           date_trunc(
             'milliseconds',
             coalesce(p_read_as_of, statement_timestamp())
           ) as read_at,
           company.timezone as company_timezone
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_operational_read_revisions revision
      on revision.company_id = company.id
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.calendar_scope = p_calendar_scope
      and (p_clients_scope is null or authority.clients_scope = p_clients_scope)
      and (p_photos_scope is null or authority.photos_scope = p_photos_scope)
      and authority.projects_scope = p_projects_scope
      and authority.tasks_scope = p_tasks_scope
      and (
        p_cursor_source_revision is null
        or revision.source_revision = p_cursor_source_revision
      )
      and revision.source_revision between 0 and 9007199254740991
      and exists (
        select 1 from pg_timezone_names timezone
        where timezone.name = company.timezone
      )
  ), eligible_task_candidate as materialized (
    select task.id as task_id,
           task.project_id,
           task.status as task_status,
           task.start_date,
           task.end_date,
           task.start_time,
           task.end_time,
           task.all_day,
           greatest(coalesce(task.duration, 1), 1) as duration,
           task.team_member_ids,
           task.schedule_confirmed_at,
           task.confirmed_schedule_version,
           task.schedule_version,
           project.title as project_title,
           project.address as project_address,
           project.client_id,
           context.permission_snapshot_revision,
           context.calendar_scope,
           context.clients_scope,
           context.photos_scope,
           context.projects_scope,
           context.tasks_scope,
           context.source_revision,
           context.read_at,
           context.company_timezone,
           (
             (task.start_date at time zone 'UTC')::date
               + case when task.all_day
                   then time '00:00:00'
                   when task.start_time is not null
                     then task.start_time
                   else null::time
                 end
           )::timestamp without time zone as local_start_value,
           (
             case when task.all_day then
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date
                   + greatest(coalesce(task.duration, 1), 1) - 1
               ) + time '00:00:00'
             else
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   case
                     when task.start_time is not null
                       and task.end_time is not null
                       and task.end_time <= task.start_time
                       then 1
                     else 0
                   end
               ) + case
                 when task.end_time is not null
                   then task.end_time
                 else null::time
               end
             end
           )::timestamp without time zone as local_end_value
    from read_context context
    join public.project_tasks task
      on task.company_id = p_company_id
    join public.projects project
      on project.id = task.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    where task.deleted_at is null
      and task.start_date is not null
      and task.status = 'active'
      and project.status in ('rfq', 'estimated', 'accepted', 'in_progress')
      and task.schedule_version between 0 and 9007199254740991
      and task.start_date < p_to + interval '2 days'
      and coalesce(
        task.end_date,
        task.start_date + make_interval(
          days => greatest(coalesce(task.duration, 1), 1)
        )
      ) >= p_from - interval '2 days'
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'project', project.id, 'view'
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'task', task.id, 'view'
      )
      and (
        context.calendar_scope = 'all'
        or (
          context.calendar_scope = 'own'
          and p_actor_user_id::text = any(
            coalesce(task.team_member_ids, array[]::text[])
          )
        )
      )
      and (
        context.tasks_scope = 'all'
        or p_actor_user_id::text = any(
          coalesce(task.team_member_ids, array[]::text[])
        )
      )
      and (
        context.projects_scope = 'all'
        or exists (
          select 1 from public.project_tasks project_assignment
          where project_assignment.project_id = project.id
            and project_assignment.company_id = p_company_id
            and project_assignment.deleted_at is null
            and project_assignment.status = 'active'
            and p_actor_user_id::text = any(
              coalesce(
                project_assignment.team_member_ids,
                array[]::text[]
              )
          )
        )
      )
    order by task.start_date, task.id
    limit 2501
  ), eligible_task as materialized (
    select candidate.*
    from eligible_task_candidate candidate
    order by candidate.start_date, candidate.task_id
  ), eligible_task_bound as materialized (
    select exists (
      select 1 from eligible_task candidate
      offset 2500 limit 1
    ) as exceeded
  ), invalid_eligible_source as materialized (
    select task.task_id
    from eligible_task task
    where task.project_title is null
       or char_length(btrim(task.project_title)) not between 1 and 1000
       or task.all_day is null
       or not task.all_day
          and (
            task.start_time is null
            or task.end_time is null
          )
       or task.end_date is not null
          and (task.end_date at time zone 'UTC')::date <
            (task.start_date at time zone 'UTC')::date
    limit 1
  ), resolved_task as materialized (
    select task.*,
           case when task.all_day
             then private.agent_civil_date_start(
               task.local_start_value::date,
               task.company_timezone
             )
             else private.agent_unambiguous_local_instant(
               task.local_start_value, task.company_timezone
             )
           end as scheduled_start_utc,
           case when task.all_day
             then private.agent_civil_date_start(
               task.local_end_value::date + 1,
               task.company_timezone
             )
             else private.agent_unambiguous_local_instant(
               task.local_end_value, task.company_timezone
             )
           end as scheduled_end_utc
    from eligible_task task
  ), invalid_resolved_source as materialized (
    select task.task_id
    from resolved_task task
    where task.scheduled_start_utc is null
       or task.scheduled_end_utc is null
       or task.scheduled_end_utc <= task.scheduled_start_utc
    limit 1
  ), window_task as materialized (
    select task.*
    from resolved_task task
    where task.scheduled_start_utc is not null
      and task.scheduled_end_utc is not null
      and task.scheduled_end_utc > task.scheduled_start_utc
      and task.scheduled_end_utc > p_from
      and task.scheduled_start_utc < p_to
  ), job_schedule_first as materialized (
    select distinct on (task.project_id)
           task.project_id,
           task.scheduled_start_utc as first_scheduled_start_utc
    from window_task task
    order by task.project_id, task.scheduled_start_utc, task.task_id
  ), filtered_job as materialized (
    select candidate.*
    from job_schedule_first candidate
    where p_cursor_first_scheduled_start_utc is null
       or (
         candidate.first_scheduled_start_utc,
         candidate.project_id
       ) > (
         p_cursor_first_scheduled_start_utc,
         p_cursor_project_id
       )
  ), page_plus_one as materialized (
    select candidate.project_id,
           candidate.first_scheduled_start_utc
    from filtered_job candidate
    order by candidate.first_scheduled_start_utc, candidate.project_id
    limit p_scan_limit + 1
  ), retained_job as materialized (
    select page.*
    from page_plus_one page
    order by page.first_scheduled_start_utc, page.project_id
    limit p_scan_limit
  ), retained_task as materialized (
    select task.*,
           row_number() over (
             partition by task.project_id
             order by task.scheduled_start_utc, task.task_id
           ) as occurrence_rank
    from retained_job retained
    cross join lateral (
      select task.*
      from window_task task
      where task.project_id = retained.project_id
      order by task.scheduled_start_utc, task.task_id
      limit 51
    ) task
  ), bounded_task as materialized (
    select task.*
    from retained_task task
    where task.occurrence_rank <= 50
  ), task_assignment_state as materialized (
    select task.*,
           cardinality(
             coalesce(task.team_member_ids, array[]::text[])
           ) > 100 as assignment_source_bound,
           case when cardinality(
             coalesce(task.team_member_ids, array[]::text[])
           ) > 100 then false else exists (
             select 1
             from unnest(
               (coalesce(task.team_member_ids, array[]::text[]))[1:100]
             ) member(user_id)
             left join public.users crew_user
               on pg_input_is_valid(member.user_id, 'uuid')
              and crew_user.id::text = member.user_id
              and crew_user.company_id = p_company_id
              and crew_user.deleted_at is null
              and coalesce(crew_user.is_active, false)
             where member.user_id is null
                or not pg_input_is_valid(member.user_id, 'uuid')
                or crew_user.id is null
           ) end as assignment_source_invalid,
           case when cardinality(
             coalesce(task.team_member_ids, array[]::text[])
           ) > 100 then null else exists (
             select 1
             from unnest(
               (coalesce(task.team_member_ids, array[]::text[]))[1:100]
             ) member(user_id)
             join public.users crew_user
               on crew_user.id::text = member.user_id
              and crew_user.company_id = p_company_id
              and crew_user.deleted_at is null
              and coalesce(crew_user.is_active, false)
             where member.user_id is not null
               and pg_input_is_valid(member.user_id, 'uuid')
           ) end as has_valid_assignment
    from retained_task task
  ), occurrence_rollup as materialized (
    select task.project_id,
           count(*)::integer as bounded_occurrence_count,
           count(*) > 50 as occurrence_source_bound,
           bool_or(task.assignment_source_bound) as assignment_source_bound,
           bool_or(task.assignment_source_invalid)
             as assignment_source_invalid,
           count(*) filter (
             where task.occurrence_rank <= 50
               and (
                 task.schedule_confirmed_at is null
                 or task.confirmed_schedule_version is distinct from
                   task.schedule_version
               )
           )::integer as unconfirmed_occurrence_count,
           count(*) filter (
             where task.occurrence_rank <= 50
               and task.has_valid_assignment is false
           )::integer as unassigned_occurrence_count
    from task_assignment_state task
    group by task.project_id
  ), occurrence_source as materialized (
    select task.project_id,
           jsonb_agg(
             jsonb_build_object(
               'kind', 'project_task',
               'id', task.task_id
             ) order by task.scheduled_start_utc, task.task_id
           ) as evaluated_occurrence_refs,
           null::jsonb as reserved
    from bounded_task task
    group by task.project_id
  ), unconfirmed_ranked as materialized (
    select task.*,
           row_number() over (
             partition by task.project_id
             order by task.scheduled_start_utc, task.task_id
           ) as issue_rank
    from task_assignment_state task
    where task.occurrence_rank <= 50
      and (
        task.schedule_confirmed_at is null
        or task.confirmed_schedule_version is distinct from task.schedule_version
      )
  ), unconfirmed_source as materialized (
    select task.project_id,
           jsonb_agg(
             'project_task:' || task.task_id::text
             order by task.scheduled_start_utc, task.task_id
           ) as unconfirmed_occurrence_refs
    from unconfirmed_ranked task
    where task.issue_rank <= 50
    group by task.project_id
  ), unassigned_ranked as materialized (
    select task.*,
           row_number() over (
             partition by task.project_id
             order by task.scheduled_start_utc, task.task_id
           ) as issue_rank
    from task_assignment_state task
    where task.occurrence_rank <= 50
      and task.has_valid_assignment is false
  ), unassigned_source as materialized (
    select task.project_id,
           jsonb_agg(
             'project_task:' || task.task_id::text
             order by task.scheduled_start_utc, task.task_id
           ) as unassigned_occurrence_refs
    from unassigned_ranked task
    where task.issue_rank <= 50
    group by task.project_id
  ), retained_project as materialized (
    select retained.*,
           rollup.bounded_occurrence_count,
           rollup.occurrence_source_bound,
           rollup.assignment_source_bound,
           rollup.assignment_source_invalid,
           rollup.unconfirmed_occurrence_count,
           rollup.unassigned_occurrence_count,
           btrim(project.title) as title,
           project.address,
           project.client_id,
           context.photos_scope,
           (
             'SITE_PHOTOS_MISSING' = any(p_rule_codes)
             and (
               context.photos_scope = 'all'
               or exists (
                 select 1
                 from public.project_tasks assigned_task
                 where assigned_task.project_id = retained.project_id
                   and assigned_task.company_id = p_company_id
                   and assigned_task.deleted_at is null
                   and assigned_task.status = 'active'
                   and p_actor_user_id::text = any(coalesce(
                     assigned_task.team_member_ids,
                     array[]::text[]
                   ))
               )
             )
           ) as photo_source_authorized
    from retained_job retained
    join occurrence_rollup rollup
      on rollup.project_id = retained.project_id
    join public.projects project
      on project.id = retained.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    cross join read_context context
  ), bounded_photo as materialized (
    select project.project_id,
           photo.id,
           photo.deleted_at,
           case
             when photo.url is not null
              and octet_length(photo.url) between 1 and 2048
             then left(photo.url, 2048)
             else null
           end as bounded_url,
           coalesce(octet_length(photo.url) > 2048, false)
             as url_overlength,
           photo.source
    from retained_project project
    left join lateral (
      select photo.id,
             photo.deleted_at,
             photo.url,
             photo.source
      from public.project_photos photo
      where project.photo_source_authorized
        and photo.project_id = project.project_id::text
        and photo.company_id = p_company_id::text
      order by photo.id
      limit 1001
    ) photo on true
  ), photo_partition as materialized (
    select project.project_id,
           count(photo.id)::integer as structured_row_count,
           count(photo.id) > 1000 as source_query_bound,
           count(*) filter (
             where photo.deleted_at is not null
           )::integer as tombstone_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'site_visit'
           )::integer as site_visit_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'in_progress'
           )::integer as in_progress_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'completion'
           )::integer as completion_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'other'
           )::integer as other_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'measurement'
           )::integer as measurement_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'deck_design'
           )::integer as deck_design_count,
           count(*) filter (
             where photo.id is not null
               and photo.deleted_at is null
               and not coalesce((
                 photo.bounded_url ~* '^https?://[^[:space:]]+$'
                 and photo.source in (
                   'site_visit', 'in_progress', 'completion', 'other',
                   'measurement', 'deck_design'
                 )
               ), false)
           )::integer as malformed_or_local_count
    from retained_project project
    left join bounded_photo photo
      on photo.project_id = project.project_id
    group by project.project_id
  ), legacy_photo as materialized (
    select project.project_id,
           coalesce(bool_or(
             source.legacy_count > 100
           ), false) as source_query_bound,
           coalesce(bool_or(
             source.legacy_count <= 100
             and legacy.url is not null
             and octet_length(legacy.url) > 2048
           ), false) as source_data_invalid,
           count(*) filter (
             where case
               when source.legacy_count <= 100
                and legacy.url is not null
                and octet_length(legacy.url) between 1 and 2048
               then left(legacy.url, 2048)
                 ~* '^https?://[^[:space:]]+$'
               else false
             end
           )::integer as legacy_remote_count
    from retained_project project
    join photo_partition photo
      on photo.project_id = project.project_id
    left join lateral (
      select source.project_images,
             cardinality(
               coalesce(source.project_images, array[]::text[])
             ) as legacy_count
      from public.projects source
      where 'SITE_PHOTOS_MISSING' = any(p_rule_codes)
        and project.photo_source_authorized
        and photo.structured_row_count = 0
        and source.id = project.project_id
        and source.company_id = p_company_id
        and source.deleted_at is null
    ) source on true
    left join lateral unnest(
      case
        when source.legacy_count <= 100 then
          (coalesce(source.project_images, array[]::text[]))[1:100]
        else array[]::text[]
      end
    ) legacy(url) on true
    group by project.project_id
  ), customer_source as materialized (
    select project.project_id,
           client.id is not null as resolved,
           case
             when not (
               'CUSTOMER_RECORD_UNRESOLVED' = any(p_rule_codes)
             ) then true
             when client.id is null then true
             else private.agent_user_can_access_entity(
               p_actor_user_id,
               p_company_id,
               'client',
               client.id,
               'view'
             )
           end as source_authorized
    from retained_project project
    left join public.clients client
      on 'CUSTOMER_RECORD_UNRESOLVED' = any(p_rule_codes)
     and client.id = project.client_id
     and client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
  ), raw_candidate as materialized (
    select project.project_id,
           project.first_scheduled_start_utc,
           project.title,
           coalesce(occurrence.evaluated_occurrence_refs, '[]'::jsonb)
             as evaluated_occurrence_refs,
           jsonb_build_object(
             'site_photos', case
               when not ('SITE_PHOTOS_MISSING' = any(p_rule_codes)) then
                 jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_UNAVAILABLE',
                   'source_kind', 'project_photos'
                 )
               when not project.photo_source_authorized then
                 jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_UNAVAILABLE',
                   'source_kind', 'project_photos'
                 )
               when photo.source_query_bound
                 or coalesce(legacy.source_query_bound, false)
                 then jsonb_build_object(
                 'status', 'not_evaluated',
                 'gap_code', 'SOURCE_QUERY_BOUND',
                 'source_kind', 'project_photos'
               )
               when coalesce(legacy.source_data_invalid, false)
                 then jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_DATA_INVALID',
                   'source_kind', 'project_photos'
                 )
               else jsonb_build_object(
                 'available', true,
                 'active_remote_by_source', jsonb_build_object(
                   'site_visit', coalesce(photo.site_visit_count, 0),
                   'in_progress', coalesce(photo.in_progress_count, 0),
                   'completion', coalesce(photo.completion_count, 0),
                   'other', coalesce(photo.other_count, 0),
                   'measurement', coalesce(photo.measurement_count, 0),
                   'deck_design', coalesce(photo.deck_design_count, 0)
                 ),
                 'structured_row_count',
                   coalesce(photo.structured_row_count, 0),
                 'tombstone_count', coalesce(photo.tombstone_count, 0),
                 'malformed_or_local_count',
                   coalesce(photo.malformed_or_local_count, 0),
                 'legacy_remote_count',
                   coalesce(legacy.legacy_remote_count, 0)
               )
             end,
             'customer_record', case
               when not (
                 'CUSTOMER_RECORD_UNRESOLVED' = any(p_rule_codes)
               ) then jsonb_build_object(
                 'status', 'not_evaluated',
                 'gap_code', 'SOURCE_UNAVAILABLE',
                 'source_kind', 'customer_record'
               )
               when not coalesce(customer.source_authorized, false) then
                 jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_UNAVAILABLE',
                   'source_kind', 'customer_record'
                 )
               else jsonb_build_object(
                 'resolved', customer.resolved
               )
             end,
             'schedule', case
               when not ('SCHEDULE_UNCONFIRMED' = any(p_rule_codes)) then
                 jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_UNAVAILABLE',
                   'source_kind', 'task_schedule'
                 )
               when project.occurrence_source_bound then jsonb_build_object(
                 'status', 'not_evaluated',
                 'gap_code', 'SOURCE_QUERY_BOUND',
                 'source_kind', 'task_schedule'
               )
               else jsonb_build_object(
                 'eligible_occurrence_count',
                   project.bounded_occurrence_count,
                 'unconfirmed_occurrence_count',
                   project.unconfirmed_occurrence_count,
                 'unconfirmed_occurrence_refs', coalesce(
                   unconfirmed.unconfirmed_occurrence_refs, '[]'::jsonb
                 )
               )
             end,
             'crew', case
               when not ('CREW_UNASSIGNED' = any(p_rule_codes)) then
                 jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_UNAVAILABLE',
                   'source_kind', 'task_assignments'
                 )
               when project.occurrence_source_bound
                    or project.assignment_source_bound then
                 jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_QUERY_BOUND',
                   'source_kind', 'task_assignments'
                 )
               when project.assignment_source_invalid then
                 jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_DATA_INVALID',
                   'source_kind', 'task_assignments'
                 )
               else jsonb_build_object(
                 'eligible_occurrence_count',
                   project.bounded_occurrence_count,
                 'unassigned_occurrence_count',
                   project.unassigned_occurrence_count,
                 'unassigned_occurrence_refs', coalesce(
                   unassigned.unassigned_occurrence_refs, '[]'::jsonb
                 )
               )
             end,
             'address', case
               when not ('ADDRESS_INCOMPLETE' = any(p_rule_codes)) then
                 jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_UNAVAILABLE',
                   'source_kind', 'project_address'
                 )
               when project.address is not null
                  and char_length(btrim(project.address)) > 2000 then
                 jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_DATA_INVALID',
                   'source_kind', 'project_address'
                 )
               else jsonb_build_object(
                 'available', true,
                 'project_address', nullif(btrim(project.address), '')
               )
             end
           ) as raw_sources
    from retained_project project
    left join occurrence_source occurrence
      on occurrence.project_id = project.project_id
    left join unconfirmed_source unconfirmed
      on unconfirmed.project_id = project.project_id
    left join unassigned_source unassigned
      on unassigned.project_id = project.project_id
    left join photo_partition photo
      on photo.project_id = project.project_id
    left join legacy_photo legacy
      on legacy.project_id = project.project_id
    left join customer_source customer
      on customer.project_id = project.project_id
  ), projection as materialized (
    select candidate.*,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'capability_id', p_capability_id,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'capability_revision', p_capability_revision,
             'company_id', p_company_id,
             'job', jsonb_build_object(
               'job_ref', jsonb_build_object(
                 'kind', 'project', 'id', candidate.project_id
               ),
               'title', candidate.title,
               'first_scheduled_start_utc', private.agent_rfc3339_utc(
                 candidate.first_scheduled_start_utc
               ),
               'evaluated_occurrence_refs',
                 candidate.evaluated_occurrence_refs,
               'raw_sources', candidate.raw_sources,
               'requested_rule_codes', to_jsonb(p_rule_codes)
             ),
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'rule_revisions', (
               select jsonb_agg(case requested.rule_code
                 when 'SITE_PHOTOS_MISSING' then 'site-photos-missing:v1'
                 when 'CUSTOMER_RECORD_UNRESOLVED' then
                   'customer-record-unresolved:v1'
                 when 'SCHEDULE_UNCONFIRMED' then
                   'schedule-unconfirmed:v1'
                 when 'CREW_UNASSIGNED' then 'crew-unassigned:v1'
                 when 'ADDRESS_INCOMPLETE' then 'address-incomplete:v1'
               end order by requested.ordinality)
               from unnest(p_rule_codes) with ordinality
                 requested(rule_code, ordinality)
             ),
             'source_revision', context.source_revision
           ) as projection
    from raw_candidate candidate
    cross join read_context context
  ), hashed_projection as materialized (
    select projection.*,
           'sha256:' || encode(
             extensions.digest(convert_to(
               private.canonical_agent_projection_json(projection.projection),
               'UTF8'
             ), 'sha256'),
             'hex'
           ) as source_content_hash
    from projection
  ), packaged as materialized (
    select hashed.*,
           jsonb_build_object(
             'source_domain', 'operations',
             'source_type', 'job_readiness_projection',
             'source_id', hashed.project_id,
             'version', 'job-readiness-projection:v1:' ||
               hashed.source_content_hash
           ) as source_version,
           'evidence:job_readiness_projection:' || hashed.project_id::text
             as evidence_id
    from hashed_projection hashed
  ), validated as materialized (
    select context.*,
           (select exceeded from eligible_task_bound)
             as source_query_bound,
           exists(select 1 from invalid_eligible_source)
             or exists(select 1 from invalid_resolved_source)
             as source_data_invalid,
           exists(
             select 1 from page_plus_one page
             where page.project_id not in (
               select retained.project_id from retained_job retained
             )
           ) as scan_has_more
    from read_context context
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'read_at', private.agent_rfc3339_utc(validated.read_at),
    'source_fence', jsonb_build_object(
      'source_domain', 'operations',
      'source_type', 'operational_read_revision',
      'source_id', 'private.agent_operational_read_revisions',
      'version', 'revision:' || validated.source_revision::text
    ),
    '_source_query_bound', validated.source_query_bound,
    '_source_data_invalid', validated.source_data_invalid,
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'job_ref', jsonb_build_object('kind', 'project', 'id', item.project_id),
        'title', item.title,
        'first_scheduled_start_utc', private.agent_rfc3339_utc(
          item.first_scheduled_start_utc
        ),
        'evaluated_occurrence_refs', item.evaluated_occurrence_refs,
        'raw_sources', item.raw_sources,
        'rule_sources', (
          select jsonb_agg(jsonb_build_object(
            'rule_code', requested.rule_code,
            'source_versions', jsonb_build_array(item.source_version),
            'evidence_ids', jsonb_build_array(item.evidence_id)
          ) order by requested.ordinality)
          from unnest(p_rule_codes) with ordinality
            requested(rule_code, ordinality)
        ),
        'projection_proof', jsonb_build_object(
          'source_version', item.source_version,
          'source_content_hash', item.source_content_hash,
          'evidence_id', item.evidence_id,
          'projection', item.projection
        )
      ) order by item.first_scheduled_start_utc, item.project_id)
      from packaged item
    ), '[]'::jsonb),
    'scanned_candidate_count', (select count(*) from packaged),
    'next_scan_cursor_claims', case when validated.scan_has_more then (
      select jsonb_build_object(
        'source_revision', validated.source_revision,
        'first_scheduled_start_utc', private.agent_rfc3339_utc(
          last_item.first_scheduled_start_utc
        ),
        'project_id', last_item.project_id
      )
      from retained_job last_item
      order by last_item.first_scheduled_start_utc desc, last_item.project_id desc
      limit 1
    ) else null end,
    'scan_has_more', validated.scan_has_more,
    'source_versions', jsonb_build_array(jsonb_build_object(
      'source_domain', 'operations',
      'source_type', 'operational_read_revision',
      'source_id', 'private.agent_operational_read_revisions',
      'version', 'revision:' || validated.source_revision::text
    )) || coalesce((
      select jsonb_agg(item.source_version order by item.first_scheduled_start_utc, item.project_id)
      from packaged item
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'evidence_id', item.evidence_id,
        'source_domain', item.source_version ->> 'source_domain',
        'source_type', item.source_version ->> 'source_type',
        'source_id', item.source_version ->> 'source_id',
        'version', item.source_version ->> 'version',
        'occurred_at', private.agent_rfc3339_utc(validated.read_at),
        'relationship', 'supports',
        'locator', 'ops://projects/' || item.project_id::text || '/readiness',
        'trust', 'authoritative_ops'
      ) order by item.first_scheduled_start_utc, item.project_id)
      from packaged item
    ), '[]'::jsonb)
  ) into v_result
  from validated;

  if coalesce((v_result ->> '_source_query_bound')::boolean, false) then
    raise exception 'agent_job_readiness_source_query_bound'
      using errcode = '54000', detail = jsonb_build_object(
        'gap_code', 'SOURCE_QUERY_BOUND',
        'source_kind', 'task_schedule'
      )::text;
  end if;
  v_result := v_result - '_source_query_bound';

  if coalesce((v_result ->> '_source_data_invalid')::boolean, false) then
    raise exception 'agent_job_readiness_source_data_invalid'
      using errcode = '22023', detail = jsonb_build_object(
        'gap_code', 'SOURCE_DATA_INVALID',
        'source_kind', 'task_schedule'
      )::text;
  end if;
  v_result := v_result - '_source_data_invalid';

  if v_result is null then
    select revision.source_revision into v_current_source_revision
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_operational_read_revisions revision
      on revision.company_id = company.id
    where p_cursor_source_revision is not null
      and revision.source_revision <> p_cursor_source_revision
      and authority.permission_snapshot_revision =
        p_permission_snapshot_revision
    group by revision.source_revision, authority.permission_snapshot_revision
    having max(permission.value ->> 'scope') filter (
      where permission.value ->> 'permission' = 'calendar.view'
    ) = p_calendar_scope
      and (
        p_clients_scope is null
        or max(permission.value ->> 'scope') filter (
          where permission.value ->> 'permission' = 'clients.view'
        ) = p_clients_scope
      )
      and (
        p_photos_scope is null
        or max(permission.value ->> 'scope') filter (
          where permission.value ->> 'permission' = 'photos.view'
        ) = p_photos_scope
      )
      and max(permission.value ->> 'scope') filter (
        where permission.value ->> 'permission' = 'projects.view'
      ) = p_projects_scope
      and max(permission.value ->> 'scope') filter (
        where permission.value ->> 'permission' = 'tasks.view'
      ) = p_tasks_scope;
    if v_current_source_revision is not null then
      raise exception 'agent_operational_read_cursor_stale'
        using errcode = '40001', detail = jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'operational_read_revision',
          'source_id', 'private.agent_operational_read_revisions',
          'version', 'revision:' || v_current_source_revision::text
        )::text;
    end if;
    raise exception 'agent_job_readiness_read_forbidden_or_invalid'
      using errcode = '42501';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) to service_role;

commit;
