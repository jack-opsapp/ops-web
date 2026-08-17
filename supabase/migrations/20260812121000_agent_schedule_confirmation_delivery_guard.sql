-- Schedule confirmation/change email authority remains live until the last
-- safe database boundary before provider I/O. A reschedule, confirmation-state
-- change, task or project lifecycle change, customer merge/email change,
-- mailbox revocation, or source-copy change invalidates the prepared intent
-- transactionally.
begin;

-- Keep the raw assignment array outside every aggregate until its hard bound
-- has been checked procedurally. This helper returns one complete, stable
-- projection: invalid, foreign, inactive, deleted, unnamed, or excess crew
-- references never become partially truthful delivery data.
create or replace function private.schedule_dispatch_crew_names_are_current(
  p_company_id uuid,
  p_team_member_ids text[],
  p_expected_crew_names jsonb
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_raw_count integer := coalesce(cardinality(p_team_member_ids), 0);
  v_unique_count integer := 0;
  v_every_reference_valid boolean := false;
  v_current_projection jsonb := '[]'::jsonb;
begin
  if p_company_id is null
     or jsonb_typeof(p_expected_crew_names) <> 'array'
     or v_raw_count > 100 then
    return false;
  end if;

  with raw_member as materialized (
    select member.user_id,
           member.ordinality
    from unnest(coalesce(p_team_member_ids, array[]::text[]))
      with ordinality member(user_id, ordinality)
  ), validated as materialized (
    select raw_member.user_id,
           raw_member.ordinality,
           crew.id as crew_id,
           btrim(concat_ws(' ', crew.first_name, crew.last_name))
             as display_name
    from raw_member
    left join public.users crew
      on crew.id::text = raw_member.user_id
     and crew.company_id = p_company_id
     and crew.deleted_at is null
     and coalesce(crew.is_active, false)
  )
  select coalesce(bool_and(
           validated.user_id is not null
           and validated.user_id <> ''
           and validated.user_id = btrim(validated.user_id)
           and pg_input_is_valid(validated.user_id, 'uuid')
           and validated.crew_id is not null
           and char_length(validated.display_name) between 1 and 256
         ), true),
         count(distinct validated.crew_id)::integer
  into v_every_reference_valid, v_unique_count
  from validated;

  if not v_every_reference_valid or v_unique_count > 50 then
    return false;
  end if;

  with raw_member as materialized (
    select member.user_id,
           member.ordinality
    from unnest(coalesce(p_team_member_ids, array[]::text[]))
      with ordinality member(user_id, ordinality)
  ), current_member as materialized (
    select crew.id as crew_id,
           min(raw_member.ordinality) as first_ordinality,
           btrim(concat_ws(' ', crew.first_name, crew.last_name))
             as display_name
    from raw_member
    join public.users crew
      on crew.id::text = raw_member.user_id
     and crew.company_id = p_company_id
     and crew.deleted_at is null
     and coalesce(crew.is_active, false)
    group by crew.id, crew.first_name, crew.last_name
  )
  select coalesce(
           jsonb_agg(
             current_member.display_name
             order by current_member.first_ordinality
           ),
           '[]'::jsonb
         )
  into v_current_projection
  from current_member;

  return v_current_projection = p_expected_crew_names;
exception when others then
  return false;
end;
$function$;

revoke all on function private.schedule_dispatch_crew_names_are_current(
  uuid, text[], jsonb
) from public, anon, authenticated, service_role;

-- Classify retry/recovery work only from a complete, deterministic purpose
-- identity. This helper intentionally does not decide whether the live source
-- remains authorized; prepare/claim perform that stronger check. It prevents
-- a generic or malformed action from entering the purpose-only retry lane.
create or replace function private.purpose_schedule_email_action_identity_is_exact(
  p_action_type text,
  p_context_source text,
  p_source_id text,
  p_action_data jsonb
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_task_id uuid;
  v_event_id uuid;
  v_schedule_version bigint;
  v_confirmed_at timestamptz;
begin
  if p_context_source is distinct from 'task_scheduled'
     or jsonb_typeof(p_action_data) is distinct from 'object' then
    return false;
  end if;

  if p_action_type = 'send_appointment_confirmation' then
    if not p_action_data ? 'task_id'
       or not p_action_data ? 'schedule_version'
       or not p_action_data ? 'confirmed_schedule_version'
       or not p_action_data ? 'schedule_confirmed_at'
       or not p_action_data ? 'schedule_confirmed_by'
       or not p_action_data ? 'confirmation_origin'
       or jsonb_typeof(p_action_data -> 'task_id') <> 'string'
       or not pg_input_is_valid(p_action_data ->> 'task_id', 'uuid')
       or jsonb_typeof(p_action_data -> 'schedule_version') <> 'number'
       or jsonb_typeof(
         p_action_data -> 'confirmed_schedule_version'
       ) <> 'number'
       or (p_action_data ->> 'schedule_version') !~ '^(0|[1-9][0-9]*)$'
       or p_action_data ->> 'confirmed_schedule_version' is distinct from
         p_action_data ->> 'schedule_version'
       or (p_action_data ->> 'schedule_version')::numeric >
         9007199254740991
       or jsonb_typeof(
         p_action_data -> 'schedule_confirmed_at'
       ) <> 'string'
       or (p_action_data ->> 'schedule_confirmed_at') !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
       or not pg_input_is_valid(
         p_action_data ->> 'schedule_confirmed_at',
         'timestamp with time zone'
       )
       or jsonb_typeof(
         p_action_data -> 'confirmation_origin'
       ) <> 'string'
       or p_action_data ->> 'confirmation_origin' not in (
         'manual', 'automatic_grace', 'full_auto'
       )
       or (
         jsonb_typeof(p_action_data -> 'schedule_confirmed_by') <> 'null'
         and (
           jsonb_typeof(
             p_action_data -> 'schedule_confirmed_by'
           ) <> 'string'
           or not pg_input_is_valid(
             p_action_data ->> 'schedule_confirmed_by', 'uuid'
           )
         )
       )
       or not (
         p_action_data ->> 'confirmation_origin' = 'manual'
         and jsonb_typeof(
           p_action_data -> 'schedule_confirmed_by'
         ) = 'string'
         or p_action_data ->> 'confirmation_origin' in (
           'automatic_grace', 'full_auto'
         )
            and jsonb_typeof(
              p_action_data -> 'schedule_confirmed_by'
            ) = 'null'
       ) then
      return false;
    end if;
    v_task_id := (p_action_data ->> 'task_id')::uuid;
    v_schedule_version := (p_action_data ->> 'schedule_version')::bigint;
    v_confirmed_at :=
      (p_action_data ->> 'schedule_confirmed_at')::timestamptz;
    return p_source_id is not distinct from
      'schedule-confirmation:' || v_task_id::text ||
      ':v' || v_schedule_version::text || ':' ||
      to_char(
        v_confirmed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      );
  end if;

  if p_action_type is distinct from 'send_schedule_changed'
     or not p_action_data ? 'task_id'
     or not p_action_data ? 'schedule_version'
     or not p_action_data ? 'previous_schedule_confirmed_at'
     or not p_action_data ? 'source_task_id'
     or not p_action_data ? 'source_task_schedule_version'
     or not p_action_data ? 'source_task_automation_event_id'
     or not p_action_data ? 'task_automation_guard'
     or not p_action_data ? 'schedule_unconfirmation_origin'
     or jsonb_typeof(p_action_data -> 'task_id') <> 'string'
     or jsonb_typeof(p_action_data -> 'source_task_id') <> 'string'
     or jsonb_typeof(
       p_action_data -> 'source_task_automation_event_id'
     ) <> 'string'
     or not pg_input_is_valid(p_action_data ->> 'task_id', 'uuid')
     or not pg_input_is_valid(p_action_data ->> 'source_task_id', 'uuid')
     or not pg_input_is_valid(
       p_action_data ->> 'source_task_automation_event_id', 'uuid'
     )
     or jsonb_typeof(p_action_data -> 'schedule_version') <> 'number'
     or jsonb_typeof(
       p_action_data -> 'source_task_schedule_version'
     ) <> 'number'
     or (p_action_data ->> 'schedule_version') !~ '^(0|[1-9][0-9]*)$'
     or p_action_data ->> 'source_task_schedule_version' is distinct from
       p_action_data ->> 'schedule_version'
     or (p_action_data ->> 'schedule_version')::numeric >
       9007199254740991
     or jsonb_typeof(
       p_action_data -> 'previous_schedule_confirmed_at'
     ) <> 'string'
     or (p_action_data ->> 'previous_schedule_confirmed_at') !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
     or not pg_input_is_valid(
       p_action_data ->> 'previous_schedule_confirmed_at',
       'timestamp with time zone'
     )
     or jsonb_typeof(
       p_action_data -> 'schedule_unconfirmation_origin'
     ) <> 'string'
     or p_action_data ->> 'schedule_unconfirmation_origin' not in (
       'explicit_admin', 'schedule_edit'
     )
     or jsonb_typeof(p_action_data -> 'task_automation_guard') <> 'object' then
    return false;
  end if;
  v_task_id := (p_action_data ->> 'task_id')::uuid;
  v_event_id :=
    (p_action_data ->> 'source_task_automation_event_id')::uuid;
  v_schedule_version := (p_action_data ->> 'schedule_version')::bigint;
  return p_action_data ->> 'source_task_id' is not distinct from
      v_task_id::text
    and p_action_data -> 'task_automation_guard' = jsonb_build_object(
      'event_id', v_event_id,
      'task_id', v_task_id,
      'schedule_version', v_schedule_version
    )
    and p_source_id is not distinct from
      'task-automation:' || v_event_id::text || ':schedule-unconfirmation';
exception when others then
  return false;
end;
$function$;

revoke all on function private.purpose_schedule_email_action_identity_is_exact(
  text, text, text, jsonb
) from public, anon, authenticated, service_role;

-- A purpose-bound schedule email is generated from an exact source snapshot.
-- Human approval may change lifecycle/review fields, but no caller (including a
-- direct table/RLS caller) may retarget the recipient, copy, task, source,
-- authority, or delivery timing by rewriting the proposal in place.
create or replace function private.guard_purpose_schedule_email_action_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_old_is_protected boolean;
  v_new_is_protected boolean;
begin
  v_old_is_protected := (
    old.action_type = 'send_appointment_confirmation'
  ) or (
    old.action_type = 'send_schedule_changed'
    and (
      old.source_id ~* '^task-automation:.*:schedule-unconfirmation$'
      or old.action_data ? 'schedule_unconfirmation_origin'
    )
  );
  v_new_is_protected := (
    new.action_type = 'send_appointment_confirmation'
  ) or (
    new.action_type = 'send_schedule_changed'
    and (
      new.source_id ~* '^task-automation:.*:schedule-unconfirmation$'
      or new.action_data ? 'schedule_unconfirmation_origin'
    )
  );

  if (v_old_is_protected or v_new_is_protected)
     and (
       new.id is distinct from old.id
       or new.company_id is distinct from old.company_id
       or new.user_id is distinct from old.user_id
       or new.action_type is distinct from old.action_type
       or new.action_data is distinct from old.action_data
       or new.context_summary is distinct from old.context_summary
       or new.context_source is distinct from old.context_source
       or new.source_id is distinct from old.source_id
       or new.confidence is distinct from old.confidence
       or new.priority is distinct from old.priority
       or new.expires_at is distinct from old.expires_at
       or (
         new.auto_execute_at is distinct from old.auto_execute_at
         and not (
           old.status = 'approved'
           and new.status = 'pending'
           and old.reviewed_by is not null
           and new.auto_execute_at is null
         )
       )
       or new.created_at is distinct from old.created_at
     ) then
    raise exception 'PURPOSE_SCHEDULE_EMAIL_ACTION_IMMUTABLE'
      using errcode = '55000';
  end if;

  if v_old_is_protected or v_new_is_protected then
    if new.status is distinct from old.status
       and auth.role() is distinct from 'service_role' then
      raise exception 'PURPOSE_SCHEDULE_EMAIL_STATE_TRANSITION_FORBIDDEN'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and not (
         old.status = 'pending'
           and new.status in ('approved', 'rejected', 'cancelled', 'expired')
         or old.status = 'approved'
           and new.status in ('pending', 'executed', 'failed')
         or old.status = 'failed' and new.status = 'executed'
       ) then
      raise exception 'PURPOSE_SCHEDULE_EMAIL_STATE_TRANSITION_INVALID'
        using errcode = '55000';
    end if;
    if new.status is not distinct from old.status
       and (
         new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at
       ) then
      raise exception 'PURPOSE_SCHEDULE_EMAIL_REVIEW_STATE_INVALID'
        using errcode = '55000';
    end if;
    if old.status = 'pending' and new.status = 'approved' then
      if new.executed_at is distinct from old.executed_at
         or new.execution_result is distinct from old.execution_result
         or new.review_notes is distinct from old.review_notes then
        raise exception 'PURPOSE_SCHEDULE_EMAIL_APPROVAL_STATE_INVALID'
          using errcode = '55000';
      elsif new.reviewed_by is null then
        -- Only the trusted autonomous prepare RPC may approve without a human
        -- reviewer. An authenticated table/RLS caller can never manufacture an
        -- autonomous approval by clearing reviewed_by.
        null;
      elsif new.reviewed_at is null
         or not private.user_is_company_admin(
              new.reviewed_by,
              new.company_id
            ) then
        raise exception 'PURPOSE_SCHEDULE_EMAIL_APPROVAL_FORBIDDEN'
          using errcode = '42501';
      end if;
    elsif old.status = 'approved' and new.status = 'pending' then
      if auth.role() is distinct from 'service_role'
         or new.reviewed_by is not null
         or new.reviewed_at is not null
         or new.executed_at is distinct from old.executed_at
         or new.execution_result is distinct from old.execution_result
         or new.review_notes is distinct from old.review_notes
         or new.auto_execute_at is distinct from (case
           when old.reviewed_by is not null then null
           else old.auto_execute_at
         end)
         or exists (
           select 1
           from public.approved_action_email_intents intent
           where intent.action_id = old.id
         ) then
        raise exception 'PURPOSE_SCHEDULE_EMAIL_RETRY_STATE_INVALID'
          using errcode = '55000';
      end if;
    elsif new.status = 'approved' and old.status <> 'approved' then
      raise exception 'PURPOSE_SCHEDULE_EMAIL_APPROVAL_STATE_INVALID'
        using errcode = '55000';
    elsif old.status = 'approved'
       and (
         new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at
       ) then
      raise exception 'PURPOSE_SCHEDULE_EMAIL_REVIEW_IMMUTABLE'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_purpose_schedule_email_action_update()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_purpose_schedule_email_action_update
  on public.agent_actions;
create trigger guard_purpose_schedule_email_action_update
before update of
  id,
  company_id,
  user_id,
  action_type,
  action_data,
  context_summary,
  context_source,
  source_id,
  confidence,
  priority,
  expires_at,
  auto_execute_at,
  created_at,
  status,
  reviewed_by,
  reviewed_at
on public.agent_actions
for each row
execute function private.guard_purpose_schedule_email_action_update();

create or replace function private.schedule_confirmation_email_intent_is_current(
  p_intent_id uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_intent public.approved_action_email_intents%rowtype;
  v_action public.agent_actions%rowtype;
  v_data jsonb;
  v_task_id uuid;
  v_schedule_version bigint;
  v_confirmed_schedule_version bigint;
  v_schedule_confirmed_at timestamptz;
  v_schedule_confirmed_by uuid;
  v_confirmation_origin text;
  v_expected_source_id text;
begin
  select intent.*
  into v_intent
  from public.approved_action_email_intents intent
  where intent.id = p_intent_id;
  if not found then
    return false;
  end if;

  if v_intent.action_type <> 'send_appointment_confirmation' then
    return true;
  end if;

  select action.*
  into v_action
  from public.agent_actions action
  where action.id = v_intent.action_id
    and action.company_id = v_intent.company_id;
  if not found
     or v_action.action_type <> 'send_appointment_confirmation'
     or v_action.action_data is distinct from v_intent.action_data_snapshot then
    return false;
  end if;
  v_data := v_action.action_data;
  if v_action.source_id not like 'schedule-confirmation:%' then
    return false;
  end if;
  if v_action.context_source is distinct from 'task_scheduled' then
    return false;
  end if;

  if jsonb_typeof(v_data) <> 'object'
     or not v_data ? 'task_id'
     or not v_data ? 'schedule_version'
     or not v_data ? 'confirmed_schedule_version'
     or not v_data ? 'schedule_confirmed_at'
     or not v_data ? 'schedule_confirmed_by'
     or not v_data ? 'confirmation_origin'
     or not v_data ? 'project_id'
     or not v_data ? 'client_id'
     or not v_data ? 'client_email'
     or not v_data ? 'connection_id'
     or not pg_input_is_valid(v_data ->> 'task_id', 'uuid')
     or not pg_input_is_valid(v_data ->> 'project_id', 'uuid')
     or not pg_input_is_valid(v_data ->> 'client_id', 'uuid')
     or not pg_input_is_valid(v_data ->> 'connection_id', 'uuid')
     or jsonb_typeof(v_data -> 'confirmation_origin') <> 'string'
     or v_data ->> 'confirmation_origin' not in (
       'manual', 'automatic_grace', 'full_auto'
     )
     or jsonb_typeof(v_data -> 'schedule_version') <> 'number'
     or jsonb_typeof(v_data -> 'confirmed_schedule_version') <> 'number'
     or (v_data ->> 'schedule_version') !~ '^(0|[1-9][0-9]*)$'
     or (v_data ->> 'confirmed_schedule_version') !~ '^(0|[1-9][0-9]*)$'
     or (v_data ->> 'schedule_version')::numeric > 9007199254740991
     or (v_data ->> 'confirmed_schedule_version')::numeric > 9007199254740991
     or (v_data ->> 'schedule_confirmed_at')
       !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
     or not pg_input_is_valid(
       v_data ->> 'schedule_confirmed_at', 'timestamp with time zone'
     )
     or (
       jsonb_typeof(v_data -> 'schedule_confirmed_by') <> 'null'
       and (
         jsonb_typeof(v_data -> 'schedule_confirmed_by') <> 'string'
         or not pg_input_is_valid(
           v_data ->> 'schedule_confirmed_by', 'uuid'
         )
       )
     ) then
    return false;
  end if;

  v_task_id := (v_data ->> 'task_id')::uuid;
  v_schedule_version := (v_data ->> 'schedule_version')::bigint;
  v_confirmed_schedule_version :=
    (v_data ->> 'confirmed_schedule_version')::bigint;
  v_schedule_confirmed_at :=
    (v_data ->> 'schedule_confirmed_at')::timestamptz;
  v_schedule_confirmed_by := case
    when jsonb_typeof(v_data -> 'schedule_confirmed_by') = 'null' then null
    else (v_data ->> 'schedule_confirmed_by')::uuid
  end;
  v_confirmation_origin := v_data ->> 'confirmation_origin';
  if v_confirmed_schedule_version <> v_schedule_version then
    return false;
  end if;

  v_expected_source_id :=
    'schedule-confirmation:' || v_task_id::text ||
    ':v' || v_schedule_version::text || ':' ||
    to_char(
      v_schedule_confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
  if v_action.source_id is distinct from v_expected_source_id
     or v_action.context_source is distinct from 'task_scheduled'
     or v_intent.connection_id::text is distinct from
       (v_data ->> 'connection_id')
     or v_intent.project_id::text is distinct from (v_data ->> 'project_id')
     or v_intent.client_id::text is distinct from (v_data ->> 'client_id')
     or cardinality(v_intent.to_emails) <> 1 then
    return false;
  end if;

  perform 1
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = v_intent.company_id
   and project.deleted_at is null
  join public.companies company
    on company.id = v_intent.company_id
   and company.deleted_at is null
  join public.admin_feature_overrides feature
    on feature.company_id = v_intent.company_id::text
   and feature.feature_key = 'phase_c'
   and feature.enabled
  join public.users recovery_actor
    on recovery_actor.id = v_intent.actor_user_id
   and recovery_actor.company_id = v_intent.company_id
   and recovery_actor.deleted_at is null
   and coalesce(recovery_actor.is_active, false)
  join public.users source_actor
    on source_actor.id = v_action.user_id
   and source_actor.company_id = v_intent.company_id
   and source_actor.deleted_at is null
   and coalesce(source_actor.is_active, false)
  join public.clients client
    on client.id = project.client_id
   and client.company_id = v_intent.company_id
   and client.deleted_at is null
   and client.merged_into_client_id is null
   and nullif(btrim(client.email), '') is not null
  join public.email_connections connection
    on connection.id = v_intent.connection_id
   and connection.id::text = v_data ->> 'connection_id'
   and connection.company_id = v_intent.company_id::text
   and connection.status = 'active'
   and coalesce(connection.sync_enabled, false)
   and coalesce(connection.agent_can_send_from, false)
  left join public.task_types task_type
    on task_type.id = task.task_type_id
   and task_type.company_id = v_intent.company_id
   and task_type.deleted_at is null
  where task.id = v_task_id
    and task.company_id = v_intent.company_id
    and task.deleted_at is null
    and task.status = 'active'
    and task.schedule_version = v_schedule_version
    and task.confirmed_schedule_version = task.schedule_version
    and task.confirmed_schedule_version = v_confirmed_schedule_version
    and task.schedule_confirmed_at = v_schedule_confirmed_at
    and task.schedule_confirmed_by is not distinct from v_schedule_confirmed_by
    and private.user_can_edit_task(v_action.user_id, v_task_id)
    and private.user_can_send_inbox_connection(
      v_action.user_id,
      v_intent.company_id,
      v_intent.connection_id,
      null
    )
    and private.agent_effective_confirmation_level(
      company.client_comms_settings
    ) in ('draft_on_confirm', 'auto_send_on_confirm', 'full_auto')
    and (
      v_confirmation_origin = 'manual'
      and v_schedule_confirmed_by is not null
      and v_action.user_id = v_schedule_confirmed_by
      and private.user_is_company_admin(
        v_intent.actor_user_id, v_intent.company_id
      )
      and private.user_is_company_admin(
        v_action.user_id, v_intent.company_id
      )
      and private.user_is_company_admin(
        v_schedule_confirmed_by, v_intent.company_id
      )
      or v_confirmation_origin = 'automatic_grace'
         and v_schedule_confirmed_by is null
         and private.agent_effective_confirmation_mode(
           company.client_comms_settings
         ) = 'automatic'
      or v_confirmation_origin = 'full_auto'
         and v_schedule_confirmed_by is null
         and private.agent_effective_confirmation_level(
           company.client_comms_settings
         ) = 'full_auto'
    )
    and exists (
      select 1
      from public.task_schedule_automation_outbox event
      where event.kind = 'schedule_confirmation_dispatch'
        and event.status <> 'failed'
        and event.company_id = v_intent.company_id
        and event.task_id = task.id
        and event.actor_user_id = v_action.user_id
        and event.task_schedule_version = v_schedule_version
        and case
          when pg_input_is_valid(
            event.after_snapshot ->> 'schedule_confirmed_at',
            'timestamp with time zone'
          ) then (
            event.after_snapshot ->> 'schedule_confirmed_at'
          )::timestamptz = v_schedule_confirmed_at
          else false
        end
        and event.after_snapshot ->> 'confirmed_schedule_version' =
          v_confirmed_schedule_version::text
        and event.after_snapshot ->> 'schedule_confirmed_by'
          is not distinct from v_schedule_confirmed_by::text
        and event.after_snapshot ->> 'confirmation_origin' =
          v_confirmation_origin
    )
    and project.id::text = v_data ->> 'project_id'
    and project.id = v_intent.project_id
    and client.id::text = v_data ->> 'client_id'
    and client.id = v_intent.client_id
    and lower(btrim(v_data ->> 'client_email')) =
      lower(btrim(client.email))
    and lower(btrim(v_intent.to_emails[1])) = lower(btrim(client.email))
    and lower(btrim(v_intent.client_from_address_snapshot)) =
      lower(btrim(connection.email))
    and v_data ->> 'project_title' is not distinct from
      nullif(btrim(project.title), '')
    and v_data ->> 'project_address' is not distinct from
      nullif(btrim(project.address), '')
    and v_data ->> 'client_name' is not distinct from
      coalesce(nullif(btrim(client.name), ''), '')
    and v_data ->> 'task_title' is not distinct from coalesce(
      nullif(btrim(task.custom_title), ''),
      nullif(btrim(task_type.display), ''),
      nullif(btrim(project.title), '')
    )
    and v_data ->> 'scheduled_date' = to_char(
      task.start_date at time zone 'UTC',
      'YYYY-MM-DD'
    )
    and v_data ->> 'scheduled_time' is not distinct from (case
      when task.start_time is null then null
      else to_char(task.start_time, 'HH24:MI')
    end)
    and v_data ->> 'scheduled_end_time' is not distinct from (case
      when task.end_time is null then null
      else to_char(task.end_time, 'HH24:MI')
    end)
    and v_data ->> 'duration_hours' is not distinct from
      (greatest(coalesce(task.duration, 1), 1) * 8)::text
    and private.schedule_dispatch_crew_names_are_current(
      v_intent.company_id,
      task.team_member_ids,
      v_data -> 'crew_names'
    )
  for share of task, project, client, connection;
  return found;
exception when others then
  return false;
end;
$function$;

revoke all on function private.schedule_confirmation_email_intent_is_current(uuid)
  from public, anon, authenticated, service_role;

-- Reschedule/unconfirmation drafts carry a server-injected immutable event
-- proof. Re-resolve every prompt-visible source and every authority edge from
-- that proof before either preparing or claiming provider delivery.
create or replace function private.schedule_unconfirmation_email_intent_is_current(
  p_intent_id uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_intent public.approved_action_email_intents%rowtype;
  v_action public.agent_actions%rowtype;
  v_data jsonb;
  v_task_id uuid;
  v_event_id uuid;
  v_schedule_version bigint;
  v_previous_confirmed_at timestamptz;
  v_unconfirmation_origin text;
  v_expected_source_id text;
  v_task public.project_tasks%rowtype;
  v_event public.task_schedule_automation_outbox%rowtype;
begin
  select intent.*
  into v_intent
  from public.approved_action_email_intents intent
  where intent.id = p_intent_id;
  if not found then
    return false;
  end if;

  if v_intent.action_type <> 'send_schedule_changed' then
    return true;
  end if;

  select action.*
  into v_action
  from public.agent_actions action
  where action.id = v_intent.action_id
    and action.company_id = v_intent.company_id;
  if not found
     or v_action.action_type <> 'send_schedule_changed'
     or v_action.action_data is distinct from v_intent.action_data_snapshot then
    return false;
  end if;
  v_data := v_action.action_data;
  if v_action.source_id ~* (
       '^task-automation:.*:schedule-unconfirmation$'
     )
     and (
       v_action.source_id !~* (
         '^task-automation:[0-9a-f]{8}-[0-9a-f]{4}-' ||
         '[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:' ||
         'schedule-unconfirmation$'
       )
       or v_action.context_source is distinct from 'task_scheduled'
     )
     or jsonb_typeof(v_data) = 'object'
        and v_data ? 'schedule_unconfirmation_origin'
        and (
          v_action.source_id !~* (
            '^task-automation:[0-9a-f]{8}-[0-9a-f]{4}-' ||
            '[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:' ||
            'schedule-unconfirmation$'
          )
          or v_action.context_source is distinct from 'task_scheduled'
        ) then
    return false;
  end if;
  if v_action.source_id !~* (
       '^task-automation:[0-9a-f]{8}-[0-9a-f]{4}-' ||
       '[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:' ||
       'schedule-unconfirmation$'
     )
     or v_action.context_source is distinct from 'task_scheduled' then
    return true;
  end if;

  if jsonb_typeof(v_data) <> 'object'
     or not v_data ? 'task_id'
     or not v_data ? 'schedule_version'
     or not v_data ? 'previous_schedule_confirmed_at'
     or not v_data ? 'source_task_id'
     or not v_data ? 'source_task_schedule_version'
     or not v_data ? 'source_task_automation_event_id'
     or not v_data ? 'task_automation_guard'
     or not v_data ? 'schedule_unconfirmation_origin'
     or not v_data ? 'project_id'
     or not v_data ? 'client_id'
     or not v_data ? 'client_email'
     or not v_data ? 'connection_id'
     or not pg_input_is_valid(v_data ->> 'task_id', 'uuid')
     or not pg_input_is_valid(v_data ->> 'source_task_id', 'uuid')
     or not pg_input_is_valid(
       v_data ->> 'source_task_automation_event_id', 'uuid'
     )
     or not pg_input_is_valid(v_data ->> 'project_id', 'uuid')
     or not pg_input_is_valid(v_data ->> 'client_id', 'uuid')
     or not pg_input_is_valid(v_data ->> 'connection_id', 'uuid')
     or jsonb_typeof(v_data -> 'schedule_version') <> 'number'
     or jsonb_typeof(v_data -> 'source_task_schedule_version') <> 'number'
     or (v_data ->> 'schedule_version') !~ '^(0|[1-9][0-9]*)$'
     or (v_data ->> 'source_task_schedule_version')
       !~ '^(0|[1-9][0-9]*)$'
     or (v_data ->> 'schedule_version')::numeric > 9007199254740991
     or (v_data ->> 'source_task_schedule_version')::numeric >
       9007199254740991
     or (v_data ->> 'previous_schedule_confirmed_at')
       !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
     or not pg_input_is_valid(
       v_data ->> 'previous_schedule_confirmed_at',
       'timestamp with time zone'
     )
     or jsonb_typeof(
       v_data -> 'schedule_unconfirmation_origin'
     ) <> 'string'
     or v_data ->> 'schedule_unconfirmation_origin' not in (
       'explicit_admin', 'schedule_edit'
     )
     or jsonb_typeof(v_data -> 'task_automation_guard') <> 'object' then
    return false;
  end if;

  v_task_id := (v_data ->> 'task_id')::uuid;
  v_event_id := (v_data ->> 'source_task_automation_event_id')::uuid;
  v_schedule_version := (v_data ->> 'schedule_version')::bigint;
  v_previous_confirmed_at :=
    (v_data ->> 'previous_schedule_confirmed_at')::timestamptz;
  v_unconfirmation_origin :=
    v_data ->> 'schedule_unconfirmation_origin';
  if v_data ->> 'source_task_id' is distinct from v_task_id::text
     or v_data ->> 'source_task_schedule_version' is distinct from
       v_schedule_version::text
     or v_data -> 'task_automation_guard' is distinct from jsonb_build_object(
       'event_id', v_event_id,
       'task_id', v_task_id,
       'schedule_version', v_schedule_version
     ) then
    return false;
  end if;

  v_expected_source_id :=
    'task-automation:' || v_event_id::text || ':schedule-unconfirmation';
  if v_action.source_id is distinct from v_expected_source_id
     or v_action.context_source is distinct from 'task_scheduled'
     or v_intent.connection_id::text is distinct from
       (v_data ->> 'connection_id')
     or v_intent.project_id::text is distinct from (v_data ->> 'project_id')
     or v_intent.client_id::text is distinct from (v_data ->> 'client_id')
     or cardinality(v_intent.to_emails) <> 1 then
    return false;
  end if;

  -- The legacy snapshot matcher aggregates the task assignment array. Prove
  -- the hard raw bound first in procedural control flow, then call it against
  -- the already-loaded rows. SQL predicate evaluation order is not a bound.
  select task.*
  into v_task
  from public.project_tasks task
  where task.id = v_task_id
    and task.company_id = v_intent.company_id
    and task.deleted_at is null
    and task.status = 'active';
  if not found
     or cardinality(
       coalesce(v_task.team_member_ids, array[]::text[])
     ) > 100 then
    return false;
  end if;
  select event.*
  into v_event
  from public.task_schedule_automation_outbox event
  where event.id = v_event_id
    and event.kind = 'schedule_unconfirmation_dispatch'
    and event.status <> 'failed'
    and event.company_id = v_intent.company_id
    and event.task_id = v_task_id
    and event.actor_user_id = v_action.user_id
    and event.task_schedule_version = v_schedule_version;
  if not found
     or v_event.after_snapshot ->> 'schedule_unconfirmation_origin'
       is distinct from v_unconfirmation_origin
     or not private.task_schedule_automation_snapshot_matches(
       v_task,
       v_event.after_snapshot,
       v_schedule_version
     ) then
    return false;
  end if;

  perform 1
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = v_intent.company_id
   and project.deleted_at is null
  join public.companies company
    on company.id = v_intent.company_id
   and company.deleted_at is null
  join public.admin_feature_overrides feature
    on feature.company_id = v_intent.company_id::text
   and feature.feature_key = 'phase_c'
   and feature.enabled
  join public.users source_actor
    on source_actor.id = v_action.user_id
   and source_actor.company_id = v_intent.company_id
   and source_actor.deleted_at is null
   and coalesce(source_actor.is_active, false)
  join public.users recovery_actor
    on recovery_actor.id = v_intent.actor_user_id
   and recovery_actor.company_id = v_intent.company_id
   and recovery_actor.deleted_at is null
   and coalesce(recovery_actor.is_active, false)
  join public.clients client
    on client.id = project.client_id
   and client.company_id = v_intent.company_id
   and client.deleted_at is null
   and client.merged_into_client_id is null
   and nullif(btrim(client.email), '') is not null
  join public.email_connections connection
    on connection.id = v_intent.connection_id
   and connection.id::text = v_data ->> 'connection_id'
   and connection.company_id = v_intent.company_id::text
   and connection.status = 'active'
   and coalesce(connection.sync_enabled, false)
   and coalesce(connection.agent_can_send_from, false)
  join public.task_schedule_automation_outbox event
    on event.id = v_event_id
   and event.kind = 'schedule_unconfirmation_dispatch'
   and event.status <> 'failed'
   and event.company_id = v_intent.company_id
   and event.task_id = task.id
   and event.actor_user_id = v_action.user_id
   and event.task_schedule_version = v_schedule_version
  left join public.task_types task_type
    on task_type.id = task.task_type_id
   and task_type.company_id = v_intent.company_id
   and task_type.deleted_at is null
  where task.id = v_task_id
    and task.company_id = v_intent.company_id
    and task.deleted_at is null
    and task.status = 'active'
    and task.schedule_version = v_schedule_version
    and task.schedule_confirmed_at is null
    and task.schedule_confirmed_by is null
    and task.confirmed_schedule_version is null
    and private.user_can_edit_task(v_action.user_id, v_task_id)
    and (
      v_unconfirmation_origin = 'explicit_admin'
      and private.user_is_company_admin(
        v_action.user_id, v_intent.company_id
      )
      and private.user_is_company_admin(
        v_intent.actor_user_id, v_intent.company_id
      )
      or v_unconfirmation_origin = 'schedule_edit'
         and private.user_can_edit_task(
           v_action.user_id, v_task_id
         )
         and private.user_can_edit_task(
           v_intent.actor_user_id, v_task_id
         )
    )
    and private.user_can_send_inbox_connection(
      v_action.user_id,
      v_intent.company_id,
      v_intent.connection_id,
      null
    )
    and case
      when company.client_comms_settings
        #>> '{appointment_confirmation,reschedule_behavior}' in (
          'do_nothing', 'notify', 'draft', 'auto_send'
        ) then company.client_comms_settings
          #>> '{appointment_confirmation,reschedule_behavior}'
      else 'draft'
    end in ('draft', 'auto_send')
    and case
      when pg_input_is_valid(
        event.before_snapshot ->> 'schedule_confirmed_at',
        'timestamp with time zone'
      ) then (
        event.before_snapshot ->> 'schedule_confirmed_at'
      )::timestamptz = v_previous_confirmed_at
      else false
    end
    and (
      v_unconfirmation_origin = 'explicit_admin'
      and event.before_snapshot ->> 'schedule_version' =
        v_schedule_version::text
      and (
        v_schedule_version = 0
        and event.before_snapshot ? 'confirmed_schedule_version'
        and jsonb_typeof(
          event.before_snapshot -> 'confirmed_schedule_version'
        ) = 'null'
        or v_schedule_version > 0
           and event.before_snapshot ->> 'confirmed_schedule_version' =
             v_schedule_version::text
      )
      or v_unconfirmation_origin = 'schedule_edit'
         and v_schedule_version > 0
         and event.before_snapshot ->> 'schedule_version' =
           (v_schedule_version - 1)::text
         and event.before_snapshot ->> 'confirmed_schedule_version' =
           (v_schedule_version - 1)::text
    )
    and event.after_snapshot ? 'schedule_confirmed_at'
    and jsonb_typeof(event.after_snapshot -> 'schedule_confirmed_at') = 'null'
    and event.after_snapshot ? 'schedule_confirmed_by'
    and jsonb_typeof(event.after_snapshot -> 'schedule_confirmed_by') = 'null'
    and event.after_snapshot ? 'confirmed_schedule_version'
    and jsonb_typeof(
      event.after_snapshot -> 'confirmed_schedule_version'
    ) = 'null'
    and event.after_snapshot ->> 'schedule_unconfirmation_origin' =
      v_unconfirmation_origin
    and project.id::text = v_data ->> 'project_id'
    and project.id = v_intent.project_id
    and client.id::text = v_data ->> 'client_id'
    and client.id = v_intent.client_id
    and lower(btrim(v_data ->> 'client_email')) =
      lower(btrim(client.email))
    and lower(btrim(v_intent.to_emails[1])) = lower(btrim(client.email))
    and lower(btrim(v_intent.client_from_address_snapshot)) =
      lower(btrim(connection.email))
    and v_data ->> 'project_title' is not distinct from
      nullif(btrim(project.title), '')
    and v_data ->> 'project_address' is not distinct from
      nullif(btrim(project.address), '')
    and v_data ->> 'client_name' is not distinct from
      coalesce(nullif(btrim(client.name), ''), '')
    and v_data ->> 'task_title' is not distinct from coalesce(
      nullif(btrim(task.custom_title), ''),
      nullif(btrim(task_type.display), ''),
      nullif(btrim(project.title), '')
    )
    and v_data ->> 'original_date' = ''
    and jsonb_typeof(v_data -> 'original_time') = 'null'
    and (
      v_data ->> 'change_kind' = 'rescheduled'
      and task.start_date is not null
      and v_data ->> 'new_date' = to_char(
        task.start_date at time zone 'UTC',
        'YYYY-MM-DD'
      )
      and v_data ->> 'new_time' is not distinct from (case
        when task.start_time is null then null
        else to_char(task.start_time, 'HH24:MI')
      end)
      and v_data ->> 'new_end_time' is not distinct from (case
        when task.end_time is null then null
        else to_char(task.end_time, 'HH24:MI')
      end)
      or v_unconfirmation_origin = 'schedule_edit'
         and v_data ->> 'change_kind' = 'unscheduled'
         and task.start_date is null
         and jsonb_typeof(v_data -> 'new_date') = 'null'
         and jsonb_typeof(v_data -> 'new_time') = 'null'
         and jsonb_typeof(v_data -> 'new_end_time') = 'null'
    )
    and private.schedule_dispatch_crew_names_are_current(
      v_intent.company_id,
      task.team_member_ids,
      v_data -> 'crew_names'
    )
  for share of task, project, client, connection, event;
  return found;
exception when others then
  return false;
end;
$function$;

revoke all on function private.schedule_unconfirmation_email_intent_is_current(uuid)
  from public, anon, authenticated, service_role;

alter function private.approved_action_email_intent_is_authorized(uuid, boolean)
  rename to approved_action_email_intent_is_authorized_pre_schedule_guard;

revoke all on function private.approved_action_email_intent_is_authorized_pre_schedule_guard(
  uuid, boolean
) from public, anon, authenticated, service_role;

create or replace function private.approved_action_email_intent_is_authorized(
  p_intent_id uuid,
  p_require_signature boolean default true
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if not private.approved_action_email_intent_is_authorized_pre_schedule_guard(
    p_intent_id,
    p_require_signature
  ) then
    return false;
  end if;
  return private.schedule_confirmation_email_intent_is_current(p_intent_id)
    and private.schedule_unconfirmation_email_intent_is_current(p_intent_id);
end;
$function$;

revoke all on function private.approved_action_email_intent_is_authorized(
  uuid, boolean
) from public, anon, authenticated, service_role;

-- Before provider claim, retry means returning the immutable proposal to its
-- original queue state. The safe pre-provider intent is removed so a later
-- human approval resolves the actual new reviewer/signature rather than
-- inheriting stale actor attribution. Once `sending` is reached, this RPC can
-- never reset or delete the durable provider boundary.
create or replace function public.reset_purpose_schedule_email_action_for_retry_as_system(
  p_action_id uuid,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_action public.agent_actions%rowtype;
  v_intent public.approved_action_email_intents%rowtype;
  v_intent_status text;
  v_is_confirmation boolean;
  v_is_unconfirmation boolean;
  v_data jsonb;
  v_task_id uuid;
  v_event_id uuid;
  v_schedule_version bigint;
  v_confirmed_at timestamptz;
begin
  if auth.role() is distinct from 'service_role'
     or p_action_id is null
     or char_length(coalesce(p_error, '')) > 10000 then
    raise exception 'PURPOSE_SCHEDULE_EMAIL_RETRY_ARGUMENT_INVALID'
      using errcode = '22023';
  end if;

  select action.*
  into v_action
  from public.agent_actions action
  where action.id = p_action_id
  for update;
  if not found then
    raise exception 'PURPOSE_SCHEDULE_EMAIL_RETRY_ACTION_NOT_FOUND';
  end if;
  v_data := v_action.action_data;

  if not private.purpose_schedule_email_action_identity_is_exact(
    v_action.action_type,
    v_action.context_source,
    v_action.source_id,
    v_data
  ) then
    raise exception 'PURPOSE_SCHEDULE_EMAIL_RETRY_IDENTITY_INVALID'
      using errcode = '22023';
  end if;

  v_is_confirmation :=
    v_action.action_type = 'send_appointment_confirmation'
    and v_action.context_source = 'task_scheduled'
    and jsonb_typeof(v_data) = 'object'
    and v_data ? 'task_id'
    and v_data ? 'schedule_version'
    and v_data ? 'confirmed_schedule_version'
    and v_data ? 'schedule_confirmed_at'
    and v_data ? 'confirmation_origin'
    and pg_input_is_valid(v_data ->> 'task_id', 'uuid')
    and jsonb_typeof(v_data -> 'schedule_version') = 'number'
    and jsonb_typeof(v_data -> 'confirmed_schedule_version') = 'number'
    and (v_data ->> 'schedule_version') ~ '^(0|[1-9][0-9]*)$'
    and (v_data ->> 'confirmed_schedule_version') =
      (v_data ->> 'schedule_version')
    and (v_data ->> 'schedule_version')::numeric <= 9007199254740991
    and (v_data ->> 'schedule_confirmed_at')
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    and pg_input_is_valid(
      v_data ->> 'schedule_confirmed_at',
      'timestamp with time zone'
    )
    and v_data ->> 'confirmation_origin' in (
      'manual', 'automatic_grace', 'full_auto'
    );
  if v_is_confirmation then
    v_task_id := (v_data ->> 'task_id')::uuid;
    v_schedule_version := (v_data ->> 'schedule_version')::bigint;
    v_confirmed_at := (v_data ->> 'schedule_confirmed_at')::timestamptz;
    v_is_confirmation := v_action.source_id is not distinct from
      'schedule-confirmation:' || v_task_id::text ||
      ':v' || v_schedule_version::text || ':' ||
      to_char(
        v_confirmed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      );
  end if;

  v_is_unconfirmation :=
    v_action.action_type = 'send_schedule_changed'
    and v_action.context_source = 'task_scheduled'
    and jsonb_typeof(v_data) = 'object'
    and v_data ? 'task_id'
    and v_data ? 'schedule_version'
    and v_data ? 'source_task_id'
    and v_data ? 'source_task_schedule_version'
    and v_data ? 'source_task_automation_event_id'
    and v_data ? 'task_automation_guard'
    and v_data ? 'schedule_unconfirmation_origin'
    and pg_input_is_valid(v_data ->> 'task_id', 'uuid')
    and pg_input_is_valid(
      v_data ->> 'source_task_automation_event_id',
      'uuid'
    )
    and jsonb_typeof(v_data -> 'schedule_version') = 'number'
    and jsonb_typeof(v_data -> 'source_task_schedule_version') = 'number'
    and (v_data ->> 'schedule_version') ~ '^(0|[1-9][0-9]*)$'
    and (v_data ->> 'source_task_schedule_version') =
      (v_data ->> 'schedule_version')
    and (v_data ->> 'schedule_version')::numeric <= 9007199254740991
    and v_data ->> 'schedule_unconfirmation_origin' in (
      'explicit_admin', 'schedule_edit'
    );
  if v_is_unconfirmation then
    v_task_id := (v_data ->> 'task_id')::uuid;
    v_event_id := (v_data ->> 'source_task_automation_event_id')::uuid;
    v_schedule_version := (v_data ->> 'schedule_version')::bigint;
    v_is_unconfirmation :=
      v_data ->> 'source_task_id' = v_task_id::text
      and v_data -> 'task_automation_guard' = jsonb_build_object(
        'event_id', v_event_id,
        'task_id', v_task_id,
        'schedule_version', v_schedule_version
      )
      and v_action.source_id =
        'task-automation:' || v_event_id::text || ':schedule-unconfirmation';
  end if;

  if not (v_is_confirmation or v_is_unconfirmation) then
    raise exception 'PURPOSE_SCHEDULE_EMAIL_RETRY_IDENTITY_INVALID'
      using errcode = '22023';
  end if;

  select intent.*
  into v_intent
  from public.approved_action_email_intents intent
  where intent.action_id = v_action.id
  for update;
  if found then
    v_intent_status := v_intent.status;
    if v_intent.company_id is distinct from v_action.company_id
       or v_intent.action_type is distinct from v_action.action_type
       or v_intent.action_data_snapshot is distinct from v_action.action_data
       or v_intent.execution_mode not in ('manual', 'autonomous')
       or v_intent.execution_mode = 'manual'
          and (
            v_action.reviewed_by is null
            or v_action.reviewed_at is null
            or v_intent.actor_user_id is distinct from v_action.reviewed_by
          )
       or v_intent.execution_mode = 'autonomous'
          and (
            v_action.reviewed_by is not null
            or v_action.reviewed_at is not null
            or v_action.auto_execute_at is null
            or v_intent.actor_user_id is distinct from v_action.user_id
          )
       or v_intent.status not in ('awaiting_signature', 'prepared')
       or v_intent.provider_message_id is not null
       or v_intent.accepted_provider_thread_id is not null
       or v_intent.provider_accepted_at is not null then
      raise exception 'PURPOSE_SCHEDULE_EMAIL_RETRY_NOT_SAFE'
        using errcode = '55000';
    end if;
  else
    v_intent_status := null;
  end if;

  if v_action.status = 'pending'
     and v_action.reviewed_by is null
     and v_action.reviewed_at is null
     and v_intent.id is null then
    return jsonb_build_object(
      'action_id', v_action.id,
      'reset', false,
      'status', 'pending',
      'previous_intent_status', null
    );
  end if;
  if v_action.status <> 'approved' then
    raise exception 'PURPOSE_SCHEDULE_EMAIL_RETRY_ACTION_STATE_INVALID'
      using errcode = '55000';
  end if;
  if (v_action.reviewed_by is null) <> (v_action.reviewed_at is null)
     or v_action.reviewed_by is null
        and v_action.auto_execute_at is null then
    raise exception 'PURPOSE_SCHEDULE_EMAIL_RETRY_ACTION_STATE_INVALID'
      using errcode = '55000';
  end if;

  if v_intent.id is not null then
    delete from public.approved_action_email_intents intent
    where intent.id = v_intent.id;
  end if;
  update public.agent_actions action
  set status = 'pending',
      reviewed_by = null,
      reviewed_at = null,
      auto_execute_at = case
        when v_action.reviewed_by is not null then null
        else v_action.auto_execute_at
      end,
      error = left(nullif(p_error, ''), 2000)
  where action.id = v_action.id;

  return jsonb_build_object(
    'action_id', v_action.id,
    'reset', true,
    'status', 'pending',
    'previous_intent_status', v_intent_status
  );
end;
$function$;

revoke all on function public.reset_purpose_schedule_email_action_for_retry_as_system(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.reset_purpose_schedule_email_action_for_retry_as_system(
  uuid, text
) to service_role;

-- A lost reset response is harmless, but a reset transaction that never
-- commits can leave an autonomous purpose action approved while its durable
-- intent is still wholly pre-provider. The ordinary due-action query selects
-- pending rows only, so expose a separate closed, bounded recovery lane. The
-- database owns the clock and the hard batch size; callers can neither widen
-- the search nor nominate arbitrary actions.
create index if not exists agent_actions_purpose_approved_retry_due_idx
on public.agent_actions (auto_execute_at, created_at, id)
where status = 'approved'
  and reviewed_by is null
  and reviewed_at is null
  and auto_execute_at is not null
  and context_source = 'task_scheduled'
  and action_type in (
    'send_appointment_confirmation', 'send_schedule_changed'
  );

create index if not exists agent_actions_purpose_manual_retry_stale_idx
on public.agent_actions (updated_at, created_at, id)
where status = 'approved'
  and reviewed_by is not null
  and reviewed_at is not null
  and context_source = 'task_scheduled'
  and action_type in (
    'send_appointment_confirmation', 'send_schedule_changed'
  );

create or replace function public.list_due_purpose_schedule_email_action_retries_as_system()
returns table(action_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select action.id
  from public.agent_actions action
  left join public.approved_action_email_intents intent
    on intent.action_id = action.id
  where action.status = 'approved'
    -- Never race the request which created or last advanced this pre-provider
    -- state. The cron cadence is 20 minutes; a 15-minute quiet period recovers
    -- a failed reset on the next pass while excluding an in-flight request.
    and greatest(
      action.updated_at,
      coalesce(intent.updated_at, action.updated_at)
    ) <= statement_timestamp() - interval '15 minutes'
    and private.purpose_schedule_email_action_identity_is_exact(
      action.action_type,
      action.context_source,
      action.source_id,
      action.action_data
    )
    and (
      action.reviewed_by is null
      and action.reviewed_at is null
      and action.auto_execute_at is not null
      and action.auto_execute_at <= statement_timestamp()
      and (
        intent.id is null
        or intent.execution_mode = 'autonomous'
           and intent.actor_user_id = action.user_id
      )
      or action.reviewed_by is not null
         and action.reviewed_at is not null
         and (
           intent.id is null
           or intent.execution_mode = 'manual'
              and intent.actor_user_id = action.reviewed_by
         )
    )
    and (
      intent.id is null
      or intent.company_id = action.company_id
         and intent.action_type = action.action_type
         and intent.action_data_snapshot = action.action_data
         and intent.status in ('awaiting_signature', 'prepared')
         and intent.provider_message_id is null
         and intent.accepted_provider_thread_id is null
         and intent.provider_accepted_at is null
    )
  order by case when action.reviewed_by is null
             then action.auto_execute_at
             else action.updated_at
           end,
           action.created_at,
           action.id
  limit 10;
end;
$function$;

revoke all on function public.list_due_purpose_schedule_email_action_retries_as_system()
  from public, anon, authenticated, service_role;
grant execute on function public.list_due_purpose_schedule_email_action_retries_as_system()
  to service_role;

alter function public.prepare_approved_action_email_intent(
  uuid, text, uuid, text, text, text, text
) rename to prepare_approved_action_email_intent_pre_schedule_guard;

revoke all on function public.prepare_approved_action_email_intent_pre_schedule_guard(
  uuid, text, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.prepare_approved_action_email_intent(
  p_action_id uuid,
  p_execution_mode text,
  p_signature_id uuid default null,
  p_signature_content_hash text default null,
  p_expected_authored_body_hash text default null,
  p_rendered_body text default null,
  p_rendered_body_hash text default null
) returns public.approved_action_email_intents
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_intent public.approved_action_email_intents%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select prepared.*
  into v_intent
  from public.prepare_approved_action_email_intent_pre_schedule_guard(
    p_action_id,
    p_execution_mode,
    p_signature_id,
    p_signature_content_hash,
    p_expected_authored_body_hash,
    p_rendered_body,
    p_rendered_body_hash
  ) prepared;
  if v_intent.id is not null
     and v_intent.status in ('awaiting_signature', 'prepared')
     and not private.approved_action_email_intent_is_authorized(
       v_intent.id,
       v_intent.status <> 'awaiting_signature'
     ) then
    raise exception 'APPROVED_ACTION_EMAIL_AUTHORIZATION_REVOKED';
  end if;
  return v_intent;
end;
$function$;

revoke all on function public.prepare_approved_action_email_intent(
  uuid, text, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_approved_action_email_intent(
  uuid, text, uuid, text, text, text, text
) to service_role;

alter function public.claim_approved_action_email_delivery(uuid)
  rename to claim_approved_action_email_delivery_pre_schedule_guard;

revoke all on function public.claim_approved_action_email_delivery_pre_schedule_guard(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.claim_approved_action_email_delivery(
  p_intent_id uuid
) returns public.approved_action_email_intents
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_intent public.approved_action_email_intents%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select claimed.*
  into v_intent
  from public.claim_approved_action_email_delivery_pre_schedule_guard(
    p_intent_id
  ) claimed;
  if v_intent.id is not null
     and not private.approved_action_email_intent_is_authorized(
       v_intent.id,
       true
     ) then
    raise exception 'APPROVED_ACTION_EMAIL_AUTHORIZATION_REVOKED';
  end if;
  return v_intent;
end;
$function$;

revoke all on function public.claim_approved_action_email_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_approved_action_email_delivery(uuid)
  to service_role;

commit;
