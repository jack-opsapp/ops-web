-- Live-derived types and canonical functions captured 2026-09-06. Disposable fixture only.
\ir agent-customer-update-setup.sql
set check_function_bodies=off;
-- Relevant live-verified delivery fields only; provider implementation is not mocked.
create table public.approved_action_email_intents(id uuid primary key default gen_random_uuid(),company_id uuid not null,action_data_snapshot jsonb not null,status text not null);

create type public.site_visit_status as enum('scheduled','in_progress','completed','cancelled');
create table public.site_visits (
id uuid default gen_random_uuid() not null,
company_id text not null,
opportunity_id uuid,
project_id text,
client_id text,
scheduled_at timestamp with time zone not null,
duration_minutes integer default 60 not null,
assignee_ids text[] default '{}'::text[],
status site_visit_status default 'scheduled'::site_visit_status not null,
completed_at timestamp with time zone,
notes text,
internal_notes text,
measurements text,
photos text[] default '{}'::text[],
activity_id uuid,
calendar_event_id text,
created_by text not null,
created_at timestamp with time zone default now(),
updated_at timestamp with time zone default now(),
deleted_at timestamp with time zone,
client_ref uuid,
project_ref uuid,
google_calendar_event_id text,
google_calendar_id text,
google_calendar_synced_at timestamp with time zone,
booked_at timestamp with time zone,
reminder_lead_minutes integer,
appointment_handoff_id uuid,
appointment_kind text,
appointment_title text,
appointment_location text,
appointment_attendees jsonb
);
alter table public.site_visits add primary key(id);
create table private.guest_booking_intents (
id uuid default gen_random_uuid() not null,
company_id uuid not null,
integration_id uuid not null,
state text default 'held'::text not null,
slot_start_at timestamp with time zone not null,
duration_minutes integer not null,
hold_expires_at timestamp with time zone not null,
contact_name text,
contact_email_digest text,
contact_email_encrypted text,
contact_phone_raw text,
verified_channel text,
verified_at timestamp with time zone,
answers jsonb default '[]'::jsonb not null,
resolved_client_id uuid,
resolved_opportunity_id uuid,
resolved_site_visit_id uuid,
network_fingerprint text not null,
closed_reason text,
created_at timestamp with time zone default statement_timestamp() not null,
updated_at timestamp with time zone default statement_timestamp() not null
);
alter table private.guest_booking_intents add primary key(id);
create table public.calendar_user_events (
id uuid default gen_random_uuid() not null,
user_id text not null,
company_id text not null,
type text not null,
title text default ''::text not null,
start_date timestamp with time zone not null,
end_date timestamp with time zone not null,
all_day boolean default true not null,
notes text,
status text default 'none'::text not null,
reviewed_by text,
reviewed_at timestamp with time zone,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone,
deleted_at timestamp with time zone,
address text,
team_member_ids text[] default '{}'::text[],
series_id uuid
);
alter table public.calendar_user_events add primary key(id);
create table public.project_tasks (
id uuid default gen_random_uuid() not null,
bubble_id text,
company_id uuid not null,
project_id uuid not null,
task_type_id uuid,
custom_title text,
task_notes text,
status text default 'active'::text not null,
task_color text default '#417394'::text,
display_order integer default 0,
team_member_ids text[] default '{}'::text[],
source_line_item_id text,
source_estimate_id text,
created_at timestamp with time zone default now(),
updated_at timestamp with time zone default now(),
deleted_at timestamp with time zone,
start_date timestamp with time zone,
end_date timestamp with time zone,
duration integer,
dependency_overrides jsonb,
start_time time without time zone default '08:00:00'::time without time zone,
end_time time without time zone default '17:00:00'::time without time zone,
schedule_confirmed_at timestamp with time zone,
schedule_confirmed_by uuid,
all_day boolean default true not null,
recurrence_id uuid,
recurrence_origin_date date,
inventory_deducted boolean default false not null,
paired_from_task_id uuid,
schedule_locked boolean default false not null,
priority_rank double precision,
schedule_version bigint default 0 not null,
confirmed_schedule_version bigint
);
alter table public.project_tasks add primary key(id);
create table public.projects (
id uuid default gen_random_uuid() not null,
bubble_id text,
company_id uuid not null,
client_id uuid,
title text not null,
address text,
latitude double precision,
longitude double precision,
status text default 'rfq'::text not null,
notes text,
description text,
all_day boolean default false,
project_images text[] default '{}'::text[],
team_member_ids text[] default '{}'::text[],
opportunity_id text,
start_date timestamp with time zone,
end_date timestamp with time zone,
duration integer,
created_at timestamp with time zone default now(),
updated_at timestamp with time zone default now(),
deleted_at timestamp with time zone,
completed_at timestamp with time zone,
visibility text default 'all'::text,
trade text,
created_by uuid,
vinyl_order_status text default 'not_ordered'::text,
vinyl_ordered_at timestamp with time zone,
vinyl_ordered_by uuid,
estimated_value numeric,
source text,
platform_metadata jsonb,
opportunity_ref uuid,
priority_rank double precision,
title_is_auto boolean default false not null,
vinyl_color text,
vinyl_po text,
status_version bigint default 0 not null,
vinyl_source text,
primary_sub_client_id uuid
);
alter table public.projects add primary key(id);
create table public.site_visit_booking_policies (
company_id uuid not null,
mode text default 'off'::text not null,
windows jsonb default '[]'::jsonb not null,
timezone text not null,
min_notice_hours integer default 48 not null,
horizon_days integer default 21 not null,
visit_duration_minutes integer default 60 not null,
slot_granularity_minutes integer default 60 not null,
max_bookings_per_day integer,
default_owner_id uuid,
created_at timestamp with time zone default statement_timestamp() not null,
updated_at timestamp with time zone default statement_timestamp() not null
);
alter table public.site_visit_booking_policies add primary key(company_id);
create table public.task_mutation_events (
id uuid default gen_random_uuid() not null,
event_sequence bigint generated always as identity not null,
company_id uuid not null,
task_id uuid not null,
project_id uuid not null,
actor_user_id uuid,
event_type text not null,
before_snapshot jsonb default '{}'::jsonb not null,
after_snapshot jsonb not null,
task_schedule_version bigint not null,
task_updated_at timestamp with time zone,
created_at timestamp with time zone default now() not null
);
alter table public.task_mutation_events add primary key(id);
create table public.task_recurrences (
id uuid default gen_random_uuid() not null,
company_id uuid not null,
project_id uuid,
client_id uuid,
task_type_id uuid,
title text not null,
team_member_ids uuid[] default '{}'::uuid[] not null,
rrule text not null,
start_anchor date not null,
end_anchor date,
all_day boolean default true not null,
start_time time without time zone,
end_time time without time zone,
duration integer default 1 not null,
notes text,
next_generation_at timestamp with time zone default now() not null,
created_by uuid,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
alter table public.task_recurrences add primary key(id);
create table public.task_reminders (
id uuid default gen_random_uuid() not null,
task_id uuid not null,
company_id uuid not null,
source_template_id uuid,
label text not null,
lead_time_days integer not null,
fire_time_local time without time zone default '09:00:00'::time without time zone not null,
requires_ack boolean not null,
recipient_mode text not null,
recipient_config jsonb default '{}'::jsonb not null,
fires_at timestamp with time zone,
acknowledged_at timestamp with time zone,
acknowledged_by uuid,
dismissed_at timestamp with time zone,
notified_at timestamp with time zone,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
alter table public.task_reminders add primary key(id);
create table public.task_schedule_automation_outbox (
id uuid default gen_random_uuid() not null,
kind text not null,
company_id uuid not null,
task_id uuid not null,
task_mutation_event_id uuid,
actor_user_id uuid,
before_snapshot jsonb default '{}'::jsonb not null,
after_snapshot jsonb not null,
task_schedule_version bigint not null,
task_updated_at timestamp with time zone,
requested_at timestamp with time zone default now() not null,
available_at timestamp with time zone default now() not null,
status text default 'pending'::text not null,
attempts integer default 0 not null,
worker_id uuid,
lease_token uuid,
lease_expires_at timestamp with time zone,
disposition text,
result jsonb default '{}'::jsonb not null,
completed_at timestamp with time zone,
last_error text
);
alter table public.task_schedule_automation_outbox add primary key(id);
create table public.task_scopes (
id uuid not null,
company_id uuid not null,
task_id uuid not null,
task_type_id uuid not null,
note text,
display_order integer default 0 not null,
completed_at timestamp with time zone,
completed_by uuid,
source_line_item_id text,
split_to_task_id uuid,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
alter table public.task_scopes add primary key(id);
create table public.task_type_reminders (
id uuid default gen_random_uuid() not null,
task_type_id uuid not null,
company_id uuid not null,
label text not null,
lead_time_days integer default 1 not null,
fire_time_local time without time zone default '09:00:00'::time without time zone not null,
requires_ack boolean default true not null,
recipient_mode text default 'task_crew'::text not null,
recipient_config jsonb default '{}'::jsonb not null,
display_order integer default 0 not null,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
alter table public.task_type_reminders add primary key(id);
create table public.task_types (
id uuid default gen_random_uuid() not null,
bubble_id text,
company_id uuid not null,
display text not null,
color text default '#417394'::text not null,
icon text,
is_default boolean default false,
display_order integer default 0,
default_team_member_ids text[] default '{}'::text[],
created_at timestamp with time zone default now(),
updated_at timestamp with time zone default now(),
deleted_at timestamp with time zone,
dependencies jsonb default '[]'::jsonb,
default_duration integer default 1 not null
);
alter table public.task_types add primary key(id);
CREATE OR REPLACE FUNCTION public.compute_reminder_fires_at(p_task_start_date timestamp with time zone, p_lead_time_days integer, p_fire_time_local time without time zone, p_company_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz text;
  v_local_date date;
BEGIN
  IF p_task_start_date IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT timezone INTO v_tz FROM public.companies WHERE id = p_company_id;
  IF v_tz IS NULL THEN
    v_tz := 'America/Vancouver';
  END IF;

  v_local_date := (p_task_start_date AT TIME ZONE v_tz)::date - p_lead_time_days;

  RETURN ((v_local_date + p_fire_time_local) AT TIME ZONE v_tz);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_permission text, p_required_scope text DEFAULT 'all'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_company_id uuid;
  v_scope text;
begin
  if p_user_id is null or p_permission is null then
    return false;
  end if;

  select actor.company_id
  into v_company_id
  from public.users actor
  join public.companies company
    on company.id = actor.company_id
   and company.deleted_at is null
  where actor.id = p_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);

  if not found then
    return false;
  end if;

  if private.user_is_company_admin(p_user_id, v_company_id) then
    return true;
  end if;

  v_scope := private.raw_permission_scope_for_user(
    p_user_id,
    v_company_id,
    p_permission
  );

  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned' then
    return p_required_scope in ('assigned', 'own');
  end if;
  if v_scope = 'own' then
    return p_required_scope = 'own';
  end if;
  return false;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.agent_civil_date_start(p_date date, p_timezone text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION private.agent_task_read_instant(p_date timestamp with time zone, p_all_day boolean, p_timezone text, p_end_exclusive boolean)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_date date;
  v_instant timestamptz;
begin
  if p_date is null then return null; end if;
  if not coalesce(p_all_day,false) then return p_date; end if;
  if not pg_catalog.isfinite(p_date)
     or extract(year from p_date at time zone 'UTC') not between 1 and 9999
     or p_timezone is null or not exists (
       select 1 from pg_catalog.pg_timezone_names zone where zone.name=p_timezone
     ) then
    raise exception 'agent_task_schedule_source_invalid' using errcode='22000';
  end if;
  v_date := (p_date at time zone 'UTC')::date + case when p_end_exclusive then 1 else 0 end;
  v_instant := private.agent_civil_date_start(v_date,p_timezone);
  if v_instant is null or extract(year from v_instant at time zone 'UTC') not between 1 and 9999 then
    raise exception 'agent_task_schedule_source_invalid' using errcode='22000';
  end if;
  return v_instant;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.agent_unambiguous_local_instant(p_local timestamp without time zone, p_timezone text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION private.bump_project_task_schedule_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION private.enqueue_schedule_confirmation_dispatch(p_kind text, p_task project_tasks, p_actor_user_id uuid, p_dispatch_origin text DEFAULT NULL::text, p_previous_confirmed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_previous_confirmed_by uuid DEFAULT NULL::uuid, p_previous_confirmed_version bigint DEFAULT NULL::bigint, p_previous_task project_tasks DEFAULT NULL::project_tasks)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION private.enqueue_task_mutation_event(p_event_type text, p_old project_tasks, p_new project_tasks, p_actor_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_event_id uuid;
  v_before_snapshot jsonb := case
    when p_old is null then '{}'::jsonb
    else private.task_schedule_automation_snapshot(p_old)
  end;
  v_after_snapshot jsonb := private.task_schedule_automation_snapshot(p_new);
begin
  if p_event_type not in (
    'task_assigned',
    'task_completed',
    'schedule_change'
  ) then
    raise exception 'invalid_task_mutation_event' using errcode = '22023';
  end if;

  insert into public.task_mutation_events (
    company_id,
    task_id,
    project_id,
    actor_user_id,
    event_type,
    before_snapshot,
    after_snapshot,
    task_schedule_version,
    task_updated_at
  ) values (
    p_new.company_id,
    p_new.id,
    p_new.project_id,
    p_actor_user_id,
    p_event_type,
    v_before_snapshot,
    v_after_snapshot,
    p_new.schedule_version,
    p_new.updated_at
  )
  returning id into v_event_id;

  insert into public.task_schedule_automation_outbox (
    id,
    kind,
    company_id,
    task_id,
    task_mutation_event_id,
    actor_user_id,
    before_snapshot,
    after_snapshot,
    task_schedule_version,
    task_updated_at
  ) values (
    v_event_id,
    p_event_type,
    p_new.company_id,
    p_new.id,
    v_event_id,
    p_actor_user_id,
    v_before_snapshot,
    v_after_snapshot,
    p_new.schedule_version,
    p_new.updated_at
  );

  return v_event_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.enqueue_task_schedule_automation_kind(p_kind text, p_old project_tasks, p_new project_tasks, p_actor_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_pending_id uuid;
  v_earliest_before_snapshot jsonb;
  v_before_snapshot jsonb := case
    when p_old is null then '{}'::jsonb
    else private.task_schedule_automation_snapshot(p_old)
  end;
  v_after_snapshot jsonb := private.task_schedule_automation_snapshot(p_new);
begin
  if p_kind not in (
    'full_auto_confirmation',
    'schedule_cascade',
    'confirmed_reschedule'
  ) then
    raise exception 'invalid task automation kind' using errcode = '22023';
  end if;

  -- Preserve A as the before snapshot when rapid A->B->C edits arrive before
  -- B is communicated. A processing B event also donates its original A
  -- snapshot to the newly queued C event; the worker will consume B as stale.
  select event.before_snapshot
  into v_earliest_before_snapshot
  from public.task_schedule_automation_outbox event
  where event.task_id = p_new.id
    and event.kind = p_kind
    and event.status in ('pending', 'processing')
  order by event.task_schedule_version, event.id
  limit 1;

  if v_earliest_before_snapshot is not null
     and v_earliest_before_snapshot <> '{}'::jsonb then
    v_before_snapshot := v_earliest_before_snapshot;
  end if;

  select event.id
  into v_pending_id
  from public.task_schedule_automation_outbox event
  where event.task_id = p_new.id
    and event.kind = p_kind
    and event.status = 'pending'
  order by event.requested_at, event.id
  limit 1
  for update;

  if v_pending_id is not null then
    update public.task_schedule_automation_outbox event
    set actor_user_id = p_actor_user_id,
        before_snapshot = v_before_snapshot,
        after_snapshot = v_after_snapshot,
        task_schedule_version = p_new.schedule_version,
        task_updated_at = p_new.updated_at,
        requested_at = now(),
        available_at = now(),
        attempts = 0,
        worker_id = null,
        lease_token = null,
        lease_expires_at = null,
        disposition = null,
        result = '{}'::jsonb,
        completed_at = null,
        last_error = null
    where event.id = v_pending_id
      and event.status = 'pending';
    return;
  end if;

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
    p_new.company_id,
    p_new.id,
    p_actor_user_id,
    v_before_snapshot,
    v_after_snapshot,
    p_new.schedule_version,
    p_new.updated_at
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.enqueue_task_schedule_automation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION private.get_current_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id FROM public.users
  WHERE (auth_id = (auth.jwt() ->> 'sub') OR firebase_uid = (auth.jwt() ->> 'sub'))
    AND deleted_at IS NULL
  LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION private.guard_project_task_parent_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_project_company_id uuid;
  v_project_status text;
  v_project_deleted_at timestamptz;
begin
  select project.company_id, project.status, project.deleted_at
    into v_project_company_id, v_project_status, v_project_deleted_at
    from public.projects project
   where project.id = new.project_id
   for share;

  if not found
     or v_project_company_id is distinct from new.company_id
     or v_project_deleted_at is not null then
    raise exception 'invalid_task_parent_project' using errcode = '23503';
  end if;

  if lower(coalesce(v_project_status, '')) in ('closed', 'archived')
     and new.deleted_at is null
     and lower(coalesce(new.status, 'active')) not in (
       'completed',
       'complete',
       'cancelled'
     ) then
    raise exception 'closed_project_task_mutation_denied'
      using errcode = '55000';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.guard_project_task_task_type_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_task_type_id uuid;
begin
  -- Deleting a historical task must remain possible even when its old type is
  -- already inactive.
  if new.deleted_at is not null then
    return new;
  end if;

  if new.task_type_id is null then
    return new;
  end if;

  select task_type.id
  into v_task_type_id
  from public.task_types task_type
  where task_type.id = new.task_type_id
    and task_type.company_id = new.company_id
    and task_type.deleted_at is null
  for key share;

  if v_task_type_id is null then
    raise exception using
      message = 'invalid_project_task_task_type',
      errcode = '23514';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.guard_task_scope_refs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_task public.project_tasks%rowtype;
begin
  select * into v_task from public.project_tasks where id = new.task_id;
  if not found or v_task.deleted_at is not null then
    raise exception 'scope_parent_task_missing' using errcode = '23503';
  end if;
  if v_task.company_id <> new.company_id then
    raise exception 'scope_company_mismatch' using errcode = '42501';
  end if;
  if not exists (select 1 from public.task_types tt where tt.id = new.task_type_id
                 and tt.company_id = new.company_id and tt.deleted_at is null) then
    raise exception 'scope_task_type_invalid' using errcode = '23503';
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION private.lock_lead_assignment_company(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
begin
  if p_company_id is null then
    raise exception 'lead_assignment_company_lock_required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lead-assignment-company:' || p_company_id::text,
      161000
    )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.project_task_notification_schedule_changed(p_old project_tasks, p_new project_tasks)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select
    p_old.start_date is distinct from p_new.start_date
    or p_old.end_date is distinct from p_new.end_date
    or p_old.start_time is distinct from p_new.start_time
    or p_old.end_time is distinct from p_new.end_time
    or p_old.all_day is distinct from p_new.all_day
    or p_old.duration is distinct from p_new.duration;
$function$
;
CREATE OR REPLACE FUNCTION private.project_task_schedule_changed(p_old project_tasks, p_new project_tasks)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select
    p_old.start_date is distinct from p_new.start_date
    or p_old.end_date is distinct from p_new.end_date
    or p_old.start_time is distinct from p_new.start_time
    or p_old.end_time is distinct from p_new.end_time
    or p_old.all_day is distinct from p_new.all_day
    or p_old.duration is distinct from p_new.duration
    or array(
      select distinct member_id
      from unnest(coalesce(p_old.team_member_ids, array[]::text[])) member_id
      order by member_id
    ) is distinct from array(
      select distinct member_id
      from unnest(coalesce(p_new.team_member_ids, array[]::text[])) member_id
      order by member_id
    );
$function$
;
CREATE OR REPLACE FUNCTION private.raw_permission_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_override_granted boolean;
  v_override_scope text;
  v_scope text;
begin
  if p_actor_user_id is null
     or p_actor_company_id is null
     or nullif(btrim(p_permission), '') is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return null;
  end if;

  select override.granted, override.scope
  into v_override_granted, v_override_scope
  from public.user_permission_overrides override
  where override.user_id = p_actor_user_id
    and override.company_id = p_actor_company_id
    and override.permission = p_permission
  limit 1;

  if found then
    if not v_override_granted then
      return null;
    end if;
    if v_override_scope is not null then
      if v_override_scope in ('all', 'assigned', 'own') then
        return v_override_scope;
      end if;
      return null;
    end if;
  end if;

  select permission.scope
  into v_scope
  from public.user_roles assignment
  join public.roles role
    on role.id = assignment.role_id
   and (role.is_preset or role.company_id = p_actor_company_id)
  join public.role_permissions permission
    on permission.role_id = assignment.role_id
   and permission.permission = p_permission
   and permission.scope in ('all', 'assigned', 'own')
  where assignment.user_id = p_actor_user_id::text
  order by case permission.scope
    when 'all' then 1
    when 'assigned' then 2
    when 'own' then 3
    else 4
  end
  limit 1;

  return v_scope;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.recompute_project_team_member_ids(p_project_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_team text[];
begin
  select coalesce(array_agg(distinct member_id order by member_id), array[]::text[])
  into v_team
  from (
    select unnest(coalesce(pt.team_member_ids, array[]::text[])) as member_id
    from public.project_tasks pt
    where pt.project_id = p_project_id
      and pt.deleted_at is null
  ) members
  where member_id is not null and member_id <> '';

  update public.projects p
  set
    team_member_ids = v_team,
    updated_at = now()
  where p.id = p_project_id
    and p.deleted_at is null
    and coalesce(p.team_member_ids, array[]::text[]) is distinct from v_team;

  return v_team;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.stamp_scopes_on_task_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.task_scopes
       set completed_at = coalesce(completed_at, now()),
           completed_by = coalesce(completed_by, private.get_current_user_id()),
           updated_at = now()
     where task_id = new.id and deleted_at is null and completed_at is null;
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION private.sync_project_team_member_ids_from_tasks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'DELETE' then
    perform private.recompute_project_team_member_ids(old.project_id);
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform private.recompute_project_team_member_ids(new.project_id);
    return new;
  end if;

  if old.project_id is distinct from new.project_id then
    perform private.recompute_project_team_member_ids(old.project_id);
  end if;

  perform private.recompute_project_team_member_ids(new.project_id);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.task_schedule_automation_snapshot(p_task project_tasks)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION private.update_task_with_event_for_actor(p_actor_user_id uuid, p_task_id uuid, p_expected_updated_at timestamp with time zone, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_company_id uuid;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_task public.project_tasks;
  v_next public.project_tasks;
  v_project_id uuid;
  v_previous_actor text := current_setting('ops.task_mutation_actor_id', true);
  v_changed boolean;
  v_schedule_changed boolean;
  v_team_member_ids uuid[] := array[]::uuid[];
  v_team_member_text text[] := array[]::text[];
begin
  if p_actor_user_id is null
     or p_task_id is null
     or jsonb_typeof(v_patch) is distinct from 'object'
     or v_patch = '{}'::jsonb
     or exists (
       select 1
       from jsonb_object_keys(v_patch) as patch_keys(key_name)
       where not (
         key_name = any(array[
           'status', 'task_color', 'task_notes', 'task_type_id',
           'custom_title', 'team_member_ids', 'dependency_overrides',
           'start_date', 'end_date', 'duration', 'start_time', 'end_time',
           'all_day', 'recurrence_id', 'recurrence_origin_date',
           'display_order'
         ]::text[])
       )
     ) then
    raise exception 'invalid_task_patch' using errcode = '22023';
  end if;

  select actor.company_id into v_company_id
  from public.users actor
  where actor.id = p_actor_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);
  if not found then
    raise exception 'task_edit_forbidden' using errcode = '42501';
  end if;
  perform private.lock_lead_assignment_company(v_company_id);

  select task.project_id into v_project_id
  from public.project_tasks task
  where task.id = p_task_id
    and task.company_id = v_company_id
    and task.deleted_at is null;
  if not found then
    raise exception 'task_edit_forbidden' using errcode = '42501';
  end if;
  perform 1
  from public.projects project
  where project.id = v_project_id
    and project.company_id = v_company_id
    and project.deleted_at is null
  for share;
  if not found then
    raise exception 'task_edit_forbidden' using errcode = '42501';
  end if;

  select task.* into v_task
  from public.project_tasks task
  where task.id = p_task_id
    and task.company_id = v_company_id
    and task.project_id = v_project_id
    and task.deleted_at is null
  for update;
  if not found or not private.user_can_edit_task(p_actor_user_id, p_task_id) then
    raise exception 'task_edit_forbidden' using errcode = '42501';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'task_id', p_task_id,
      'updated_at', v_task.updated_at,
      'schedule_version', v_task.schedule_version
    );
  end if;

  begin
    v_next := jsonb_populate_record(v_task, v_patch);
  exception when invalid_text_representation or numeric_value_out_of_range
    or invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid_task_patch' using errcode = '22023';
  end;

  if v_patch ? 'team_member_ids' then
    if jsonb_typeof(v_patch -> 'team_member_ids') is distinct from 'array' then
      raise exception 'invalid_task_patch' using errcode = '22023';
    end if;
    begin
      select coalesce(array_agg(member_id::uuid order by member_id::uuid), array[]::uuid[])
      into v_team_member_ids
      from jsonb_array_elements_text(v_patch -> 'team_member_ids') member(member_id);
    exception when invalid_text_representation then
      raise exception 'invalid_task_patch' using errcode = '22023';
    end;
    if cardinality(v_team_member_ids) <> (
      select count(distinct member_id)
      from unnest(v_team_member_ids) member(member_id)
    ) then
      raise exception 'invalid_task_patch' using errcode = '22023';
    end if;
    v_team_member_text := array(
      select member_id::text
      from unnest(v_team_member_ids) member_id
      order by member_id
    );
    v_next.team_member_ids := v_team_member_text;
  else
    v_team_member_text := array(
      select distinct member_id
      from unnest(coalesce(v_task.team_member_ids, array[]::text[])) member_id
      order by member_id
    );
  end if;

  if v_next.status not in ('active', 'completed', 'cancelled')
     or v_next.duration is null
     or v_next.duration < 1
     or v_next.display_order is null
     or v_next.display_order < 0
     or (v_next.end_date is not null and v_next.start_date is null)
     or (v_next.end_date is not null and v_next.end_date < v_next.start_date)
     or (v_next.recurrence_origin_date is not null and v_next.recurrence_id is null)
     or (v_next.start_time is not null and v_next.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
     or (v_next.end_time is not null and v_next.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
     or (v_next.dependency_overrides is not null
       and jsonb_typeof(v_next.dependency_overrides) <> 'array') then
    raise exception 'invalid_task_patch' using errcode = '22023';
  end if;

  if v_next.status is distinct from v_task.status
     and not private.user_can_change_task_status(p_actor_user_id, p_task_id) then
    raise exception 'task_status_forbidden' using errcode = '42501';
  end if;
  if v_team_member_text is distinct from array(
    select distinct member_id
    from unnest(coalesce(v_task.team_member_ids, array[]::text[])) member_id
    order by member_id
  ) and not public.has_permission(p_actor_user_id, 'tasks.assign', 'all') then
    raise exception 'task_assignment_forbidden' using errcode = '42501';
  end if;

  if v_next.task_type_id is null or not exists (
    select 1
    from public.task_types task_type
    where task_type.id = v_next.task_type_id
      and task_type.company_id = v_company_id
      and task_type.deleted_at is null
  ) then
    raise exception 'invalid_task_type' using errcode = '22023';
  end if;
  if v_next.recurrence_id is not null and not exists (
    select 1
    from public.task_recurrences recurrence
    where recurrence.id = v_next.recurrence_id
      and recurrence.company_id = v_company_id
      and recurrence.project_id = v_task.project_id
      and recurrence.deleted_at is null
  ) then
    raise exception 'invalid_task_recurrence' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.users member
    where member.id = any(v_team_member_ids)
      and member.company_id = v_company_id
      and member.deleted_at is null
      and coalesce(member.is_active, false)
  ) <> cardinality(v_team_member_ids) then
    raise exception 'invalid_task_team' using errcode = '22023';
  end if;

  v_schedule_changed :=
    v_task.start_date is distinct from v_next.start_date
    or v_task.end_date is distinct from v_next.end_date
    or v_task.start_time is distinct from v_next.start_time
    or v_task.end_time is distinct from v_next.end_time
    or v_task.all_day is distinct from v_next.all_day
    or v_task.duration is distinct from v_next.duration
    or array(
      select distinct member_id
      from unnest(coalesce(v_task.team_member_ids, array[]::text[])) member_id
      order by member_id
    ) is distinct from v_team_member_text;
  v_changed := v_schedule_changed
    or v_task.status is distinct from v_next.status
    or v_task.task_color is distinct from v_next.task_color
    or v_task.task_notes is distinct from v_next.task_notes
    or v_task.task_type_id is distinct from v_next.task_type_id
    or v_task.custom_title is distinct from v_next.custom_title
    or v_task.dependency_overrides is distinct from v_next.dependency_overrides
    or v_task.recurrence_id is distinct from v_next.recurrence_id
    or v_task.recurrence_origin_date is distinct from v_next.recurrence_origin_date
    or v_task.display_order is distinct from v_next.display_order;
  if not v_changed then
    return jsonb_build_object(
      'ok', true,
      'conflict', false,
      'changed', false,
      'schedule_changed', false,
      'task_id', p_task_id,
      'updated_at', v_task.updated_at,
      'schedule_version', v_task.schedule_version
    );
  end if;

  perform set_config('ops.task_mutation_actor_id', p_actor_user_id::text, true);
  begin
    update public.project_tasks task
    set status = v_next.status,
        task_color = v_next.task_color,
        task_notes = v_next.task_notes,
        task_type_id = v_next.task_type_id,
        custom_title = v_next.custom_title,
        team_member_ids = v_team_member_text,
        dependency_overrides = v_next.dependency_overrides,
        start_date = v_next.start_date,
        end_date = v_next.end_date,
        duration = v_next.duration,
        start_time = v_next.start_time,
        end_time = v_next.end_time,
        all_day = v_next.all_day,
        recurrence_id = v_next.recurrence_id,
        recurrence_origin_date = v_next.recurrence_origin_date,
        display_order = v_next.display_order,
        updated_at = clock_timestamp()
    where task.id = p_task_id
    returning task.* into v_task;

  exception when others then
    perform set_config(
      'ops.task_mutation_actor_id',
      coalesce(v_previous_actor, ''),
      true
    );
    raise;
  end;
  perform set_config(
    'ops.task_mutation_actor_id',
    coalesce(v_previous_actor, ''),
    true
  );
  return jsonb_build_object(
    'ok', true,
    'conflict', false,
    'changed', true,
    'schedule_changed', v_schedule_changed,
    'task_id', p_task_id,
    'updated_at', v_task.updated_at,
    'schedule_version', v_task.schedule_version
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_change_task_status(p_actor_user_id uuid, p_task_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_task public.project_tasks;
begin
  select task.* into v_task
  from public.project_tasks task
  where task.id = p_task_id
    and task.deleted_at is null;
  if not found or not private.user_can_edit_task(p_actor_user_id, p_task_id) then
    return false;
  end if;
  if public.has_permission(
    p_actor_user_id,
    'tasks.change_status',
    'all'
  ) then
    return true;
  end if;
  return public.has_permission(
      p_actor_user_id,
      'tasks.change_status',
      'assigned'
    ) and (
      p_actor_user_id::text = any(
        coalesce(v_task.team_member_ids, array[]::text[])
      )
      or private.user_is_project_member_for_task(
        p_actor_user_id,
        v_task.company_id,
        v_task.project_id
      )
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_edit_task(p_actor_user_id uuid, p_task_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_task public.project_tasks;
begin
  select task.* into v_task
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = task.company_id
   and project.deleted_at is null
  where task.id = p_task_id
    and task.deleted_at is null;
  if not found or not exists (
    select 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = v_task.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'tasks.edit', 'all') then
    return true;
  end if;
  return public.has_permission(
      p_actor_user_id,
      'tasks.edit',
      'assigned'
    ) and (
      p_actor_user_id::text = any(
        coalesce(v_task.team_member_ids, array[]::text[])
      )
      or private.user_is_project_member_for_task(
        p_actor_user_id,
        v_task.company_id,
        v_task.project_id
      )
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_view_project(p_actor_user_id uuid, p_project_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_project record;
begin
  select p.company_id
    into v_project
    from public.projects p
   where p.id = p_project_id
     and p.deleted_at is null;

  if not found or not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_project.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'projects.view', 'all') then
    return true;
  end if;

  if not public.has_permission(
    p_actor_user_id,
    'projects.view',
    'assigned'
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.project_tasks pt
     where pt.project_id = p_project_id
       and pt.deleted_at is null
       and p_actor_user_id::text = any(
         coalesce(pt.team_member_ids, array[]::text[])
       )
  ) or exists (
    select 1
      from public.project_notes pn
     where pn.project_id = p_project_id::text
       and pn.deleted_at is null
       and p_actor_user_id::text = any(
         coalesce(pn.mentioned_user_ids, array[]::text[])
       )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_view_task(p_actor_user_id uuid, p_task_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_task public.project_tasks;
begin
  select task.* into v_task
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = task.company_id
   and project.deleted_at is null
  where task.id = p_task_id
    and task.deleted_at is null;
  if not found or not exists (
    select 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = v_task.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'tasks.view', 'all') then
    return true;
  end if;
  return public.has_permission(
      p_actor_user_id,
      'tasks.view',
      'assigned'
    ) and (
      p_actor_user_id::text = any(
        coalesce(v_task.team_member_ids, array[]::text[])
      )
      or private.user_can_view_project(
        p_actor_user_id,
        v_task.project_id
      )
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_is_company_admin(p_actor_user_id uuid, p_actor_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
      and (
        coalesce(actor.is_company_admin, false)
        or actor.id::text = company.account_holder_id
        or actor.id::text = any(
          coalesce(company.admin_ids, array[]::text[])
        )
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION private.user_is_project_member_for_task(p_actor_user_id uuid, p_company_id uuid, p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.project_tasks assigned_task
    join public.projects project on project.id = assigned_task.project_id
    where assigned_task.project_id = p_project_id
      and assigned_task.company_id = p_company_id
      and assigned_task.deleted_at is null
      and assigned_task.status = 'active'
      and project.company_id = p_company_id
      and project.deleted_at is null
      and p_actor_user_id::text = any(
        coalesce(assigned_task.team_member_ids, array[]::text[])
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.tg_project_tasks_reschedule_reminders()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new_fires timestamptz;
BEGIN
  -- Freeze when terminal
  IF NEW.status IN ('completed','cancelled') THEN
    RETURN NEW;
  END IF;
  -- Only act when scheduling fields actually changed
  IF NEW.start_date IS NOT DISTINCT FROM OLD.start_date
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time THEN
    RETURN NEW;
  END IF;

  UPDATE public.task_reminders tr
  SET fires_at = public.compute_reminder_fires_at(NEW.start_date, tr.lead_time_days, tr.fire_time_local, NEW.company_id),
      notified_at = CASE
        WHEN public.compute_reminder_fires_at(NEW.start_date, tr.lead_time_days, tr.fire_time_local, NEW.company_id) > now()
             AND tr.notified_at IS NOT NULL
          THEN NULL
        ELSE tr.notified_at
      END,
      updated_at = now()
  WHERE tr.task_id = NEW.id
    AND tr.acknowledged_at IS NULL
    AND tr.deleted_at IS NULL;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $function$
;
set check_function_bodies=on;
