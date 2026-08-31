-- Foundation Zero routine execution. This migration adds only dormant,
-- OPS-owned scheduling mechanics. It creates no routine, registers no cron,
-- calls no model/provider, and grants no host or browser direct access.

do $prerequisites$
begin
  if pg_catalog.to_regclass('private.agent_day_closeout_routines') is null
     or pg_catalog.to_regclass('private.agent_day_closeout_runs') is null
     or pg_catalog.to_regprocedure(
       'private.assert_agent_day_closeout_authority(uuid,uuid,uuid,uuid,text,text[],text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.persist_agent_day_closeout_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,date,text,text,text,jsonb)'
     ) is null then
    raise exception 'agent_day_closeout_routine_worker_prerequisite_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

alter table private.agent_day_closeout_routines
  add column claim_expires_at timestamptz,
  add column attempt_count smallint not null default 0,
  add column retry_not_before timestamptz;

alter table private.agent_day_closeout_routines
  alter column enabled set default false;

alter table private.agent_day_closeout_routines
  add constraint agent_day_closeout_routines_attempt_count_valid
    check (attempt_count between 0 and 4),
  add constraint agent_day_closeout_routines_claim_complete
    check (
      (claimed_at is null and claim_token is null and claim_expires_at is null)
      or
      (claimed_at is not null and claim_token is not null and claim_expires_at > claimed_at)
    ),
  add constraint agent_day_closeout_routines_manifest_pinned
    check (
      capability_manifest_revision = '2026-08-30.capability-manifest.v9'
    ),
  add constraint agent_day_closeout_routines_exposure_pinned
    check (exposure_revision = '2026-08-30.mcp-exposure.v3');

create table private.agent_day_closeout_routine_failures (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null
    references private.agent_day_closeout_routines(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid not null,
  oauth_grant_id uuid not null references private.mcp_oauth_grants(id),
  oauth_client_id uuid not null references private.mcp_oauth_clients(client_id),
  grant_revision text not null,
  granted_scope_ceiling text[] not null,
  permission_snapshot_revision text not null,
  capability_manifest_revision text not null check (
    capability_manifest_revision = '2026-08-30.capability-manifest.v9'
  ),
  exposure_revision text not null check (
    exposure_revision = '2026-08-30.mcp-exposure.v3'
  ),
  business_date date not null,
  timezone text not null,
  scheduled_for timestamptz not null,
  schedule_revision bigint not null check (
    schedule_revision between 0 and 9007199254740991
  ),
  attempt_number smallint not null check (attempt_number between 1 and 4),
  outcome text not null check (outcome in ('blocked', 'failed')),
  failure_code text not null,
  idempotency_key text not null check (
    length(idempotency_key) between 8 and 200
  ),
  created_at timestamptz not null default statement_timestamp(),
  constraint agent_day_closeout_routine_failures_outcome_valid check (
    (outcome = 'blocked' and failure_code = 'AUTHORITY_BLOCKED')
    or
    (
      outcome = 'failed'
      and failure_code in (
        'ROUTINE_EXECUTION_FAILED',
        'ROUTINE_EXECUTION_BUDGET_EXPIRED',
        'CLAIM_ATTEMPTS_EXHAUSTED'
      )
    )
  ),
  unique (company_id, actor_user_id, oauth_client_id, idempotency_key)
);

alter table private.agent_day_closeout_routine_failures enable row level security;
revoke all on table private.agent_day_closeout_routine_failures
  from public, anon, authenticated, service_role;

drop index if exists private.agent_day_closeout_routines_due_idx;
create index agent_day_closeout_routines_due_idx
  on private.agent_day_closeout_routines (
    coalesce(retry_not_before, next_run_at), id
  )
  where enabled;

create or replace function private.next_agent_day_closeout_run(
  p_local_time time,
  p_timezone text,
  p_weekdays smallint[],
  p_after timestamptz
) returns timestamptz
language plpgsql
stable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_candidate timestamptz;
  v_day_offset integer;
  v_local_date date;
begin
  if length(p_timezone) not between 1 and 128
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = p_timezone
     )
     or cardinality(p_weekdays) not between 1 and 7
     or not (p_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]) then
    raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_SCHEDULE_INVALID'
      using errcode = '22023';
  end if;

  v_local_date := (p_after at time zone p_timezone)::date;
  for v_day_offset in 0..8 loop
    v_candidate := (v_local_date + v_day_offset + p_local_time)
      at time zone p_timezone;
    if v_candidate > p_after
       and extract(
         isodow from (v_local_date + v_day_offset)
       )::smallint = any(p_weekdays) then
      return v_candidate;
    end if;
  end loop;

  raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_NEXT_RUN_UNAVAILABLE'
    using errcode = '55000';
end;
$function$;

revoke all on function private.next_agent_day_closeout_run(
  time, text, smallint[], timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.claim_agent_day_closeout_routines_as_system(
  p_limit integer,
  p_lease_seconds integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_claims jsonb;
begin
  if not (p_limit between 1 and 25)
     or not (p_lease_seconds between 60 and 900) then
    raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_CLAIM_INVALID'
      using errcode = '22023';
  end if;

  with due as (
    select routine.id
    from private.agent_day_closeout_routines routine
    where routine.enabled
      and coalesce(routine.retry_not_before, routine.next_run_at)
        <= statement_timestamp()
      and (
        routine.claim_token is null
        or routine.claim_expires_at <= statement_timestamp()
      )
    order by coalesce(routine.retry_not_before, routine.next_run_at), routine.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.agent_day_closeout_routines routine
    set claimed_at = statement_timestamp(),
        claim_token = gen_random_uuid(),
        claim_expires_at = statement_timestamp()
          + make_interval(secs => p_lease_seconds),
        retry_not_before = null,
        attempt_count = least(routine.attempt_count + 1, 4),
        updated_at = statement_timestamp()
    from due
    where routine.id = due.id
    returning routine.*
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'routine_id', claimed.id,
        'company_id', claimed.company_id,
        'actor_user_id', claimed.actor_user_id,
        'oauth_grant_id', claimed.oauth_grant_id,
        'oauth_client_id', claimed.oauth_client_id,
        'grant_revision', claimed.grant_revision,
        'granted_scope_ceiling', claimed.granted_scope_ceiling,
        'permission_snapshot_revision', claimed.permission_snapshot_revision,
        'capability_manifest_revision', claimed.capability_manifest_revision,
        'exposure_revision', claimed.exposure_revision,
        'local_time', to_char(claimed.local_time, 'HH24:MI:SS'),
        'timezone', claimed.timezone,
        'weekdays', claimed.weekdays,
        'scheduled_for', claimed.next_run_at,
        'schedule_revision', claimed.schedule_revision,
        'claim_token', claimed.claim_token,
        'claim_expires_at', claimed.claim_expires_at,
        'attempt_number', claimed.attempt_count
      ) order by claimed.next_run_at, claimed.id
    ),
    '[]'::jsonb
  ) into v_claims
  from claimed;

  return v_claims;
end;
$function$;

create or replace function public.assert_agent_day_closeout_routine_claim_as_system(
  p_routine_id uuid,
  p_claim_token uuid,
  p_scheduled_for timestamptz
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  routine private.agent_day_closeout_routines%rowtype;
  v_permission_revision text;
begin
  select source.* into routine
  from private.agent_day_closeout_routines source
  where source.id = p_routine_id
    and source.enabled
    and source.claim_token = p_claim_token
    and source.claim_expires_at > statement_timestamp()
    and source.next_run_at = p_scheduled_for
  for update;
  if not found then
    raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_CLAIM_STALE'
      using errcode = '40001';
  end if;

  v_permission_revision := private.assert_agent_day_closeout_authority(
    routine.actor_user_id, routine.company_id, routine.oauth_grant_id,
    routine.oauth_client_id, routine.grant_revision,
    routine.granted_scope_ceiling, null, routine.exposure_revision
  );

  update private.agent_day_closeout_routines target
  set permission_snapshot_revision = v_permission_revision,
      updated_at = statement_timestamp()
  where target.id = routine.id
    and target.claim_token = p_claim_token;

  return jsonb_build_object(
    'authorized', true,
    'routine_id', routine.id,
    'scheduled_for', routine.next_run_at,
    'actor_user_id', routine.actor_user_id,
    'company_id', routine.company_id,
    'oauth_grant_id', routine.oauth_grant_id,
    'oauth_client_id', routine.oauth_client_id,
    'grant_revision', routine.grant_revision,
    'granted_scope_ceiling', routine.granted_scope_ceiling,
    'permission_snapshot_revision', v_permission_revision,
    'capability_manifest_revision', routine.capability_manifest_revision,
    'exposure_revision', routine.exposure_revision
  );
end;
$function$;

create or replace function public.persist_agent_day_closeout_routine_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_exposure_revision text,
  p_capability_manifest_revision text,
  p_business_date date,
  p_timezone text,
  p_idempotency_key text,
  p_input_hash text,
  p_result_base jsonb,
  p_routine_id uuid,
  p_claim_token uuid,
  p_scheduled_for timestamptz,
  p_schedule_revision bigint
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  routine private.agent_day_closeout_routines%rowtype;
  v_replayed boolean;
  v_result jsonb;
  v_run private.agent_day_closeout_runs%rowtype;
begin
  select source.* into routine
  from private.agent_day_closeout_routines source
  where source.id = p_routine_id
    and source.enabled
    and source.company_id = p_company_id
    and source.actor_user_id = p_actor_user_id
    and source.oauth_grant_id = p_oauth_grant_id
    and source.oauth_client_id = p_oauth_client_id
    and source.grant_revision = p_grant_revision
    and source.granted_scope_ceiling = p_granted_scope_ceiling
    and source.capability_manifest_revision = p_capability_manifest_revision
    and source.exposure_revision = p_exposure_revision
    and source.claim_token = p_claim_token
    and source.claim_expires_at > statement_timestamp()
    and source.next_run_at = p_scheduled_for
    and source.schedule_revision = p_schedule_revision
    and source.timezone = p_timezone
  for update;
  if not found then
    raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_CLAIM_STALE'
      using errcode = '40001';
  end if;

  perform private.assert_agent_day_closeout_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_exposure_revision
  );

  v_result := public.persist_agent_day_closeout_as_system(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision, p_business_date, p_timezone, p_idempotency_key,
    p_input_hash, p_result_base
  );
  v_replayed := coalesce((v_result ->> 'replayed')::boolean, false);

  select run.* into strict v_run
  from private.agent_day_closeout_runs run
  where run.id = (v_result ->> 'run_id')::uuid
    and run.company_id = p_company_id
    and run.actor_user_id = p_actor_user_id
    and run.oauth_client_id = p_oauth_client_id
    and run.idempotency_key = p_idempotency_key
  for update;

  if v_replayed and v_run.routine_id is null then
    raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_IDEMPOTENCY_CONFLICT'
      using errcode = '23505';
  end if;
  if v_run.routine_id is not null
     and v_run.routine_id is distinct from p_routine_id then
    raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_IDEMPOTENCY_CONFLICT'
      using errcode = '23505';
  end if;

  update private.agent_day_closeout_runs run
  set routine_id = p_routine_id,
      trigger_kind = 'routine'
  where run.id = v_run.id;

  return v_result;
end;
$function$;

create or replace function public.finalize_agent_day_closeout_routine_as_system(
  p_routine_id uuid,
  p_claim_token uuid,
  p_scheduled_for timestamptz,
  p_idempotency_key text,
  p_outcome text,
  p_run_id uuid,
  p_failure_code text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_action_id uuid;
  v_action_label text;
  routine private.agent_day_closeout_routines%rowtype;
  v_action_url text;
  v_body text;
  v_change_cursor jsonb := '{}'::jsonb;
  v_effective_failure_code text := p_failure_code;
  v_effective_outcome text := p_outcome;
  v_effective_run_id uuid := p_run_id;
  v_failure_id uuid;
  v_next_run_at timestamptz;
  v_retry_scheduled boolean := false;
  v_run private.agent_day_closeout_runs%rowtype;
  v_title text;
begin
  if p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
     or p_outcome not in ('clear', 'attention', 'partial', 'blocked', 'failed')
     or (
       p_outcome in ('clear', 'attention', 'partial')
       and (p_run_id is null or (
         p_outcome = 'partial'
         and p_failure_code is distinct from 'SOURCE_COVERAGE_PARTIAL'
       ) or (
         p_outcome in ('clear', 'attention') and p_failure_code is not null
       ))
     )
     or (
       p_outcome = 'blocked'
       and (p_run_id is not null or p_failure_code is distinct from 'AUTHORITY_BLOCKED')
     )
     or (
       p_outcome = 'failed'
       and (
         p_run_id is not null
         or p_failure_code not in (
           'ROUTINE_EXECUTION_FAILED',
           'ROUTINE_EXECUTION_BUDGET_EXPIRED',
           'CLAIM_ATTEMPTS_EXHAUSTED'
         )
       )
     ) then
    raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_FINALIZATION_INVALID'
      using errcode = '22023';
  end if;

  select source.* into routine
  from private.agent_day_closeout_routines source
  where source.id = p_routine_id
  for update;
  if not found
     or routine.claim_token is distinct from p_claim_token
     or routine.claim_expires_at <= statement_timestamp()
     or routine.next_run_at is distinct from p_scheduled_for then
    raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_CLAIM_STALE'
     using errcode = '40001';
  end if;

  -- Persistence and its network response are not atomic. Recover the exact
  -- occurrence before recording any retry or terminal failure.
  select run.* into v_run
  from private.agent_day_closeout_runs run
  where run.routine_id = routine.id
    and run.company_id = routine.company_id
    and run.actor_user_id = routine.actor_user_id
    and run.oauth_grant_id = routine.oauth_grant_id
    and run.oauth_client_id = routine.oauth_client_id
    and run.idempotency_key = p_idempotency_key
    and run.trigger_kind = 'routine'
    and run.status in ('prepared', 'filed')
  for update;
  if found then
    if p_run_id is not null and p_run_id is distinct from v_run.id then
      raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
    v_effective_outcome := v_run.state;
    v_effective_run_id := v_run.id;
    v_effective_failure_code := case
      when v_run.state = 'partial' then 'SOURCE_COVERAGE_PARTIAL'
      else null
    end;
  end if;

  if v_effective_outcome in ('clear', 'attention', 'partial') then
    select run.* into v_run
    from private.agent_day_closeout_runs run
    where run.id = v_effective_run_id
      and run.routine_id = routine.id
      and run.company_id = routine.company_id
      and run.actor_user_id = routine.actor_user_id
      and run.oauth_grant_id = routine.oauth_grant_id
      and run.oauth_client_id = routine.oauth_client_id
      and run.idempotency_key = p_idempotency_key
      and run.trigger_kind = 'routine'
      and run.state = v_effective_outcome
      and run.status in ('prepared', 'filed')
    for update;
    if not found then
      raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_RUN_MISMATCH'
        using errcode = '42501';
    end if;

    select coalesce(
      jsonb_object_agg(revision.domain, revision.source_revision order by revision.domain),
      '{}'::jsonb
    ) into v_change_cursor
    from (
      select source_revision ->> 'domain' as domain,
             max((source_revision ->> 'source_revision')::bigint)
               as source_revision
      from jsonb_array_elements(v_run.result_snapshot -> 'components') component
      cross join lateral jsonb_array_elements(
        component -> 'source_revisions'
      ) source_revision
      where source_revision ->> 'domain' is not null
        and source_revision ->> 'source_revision' ~ '^[0-9]+$'
      group by source_revision ->> 'domain'
    ) revision;

    v_next_run_at := private.next_agent_day_closeout_run(
      routine.local_time,
      routine.timezone,
      routine.weekdays,
      greatest(statement_timestamp(), p_scheduled_for)
    );
    update private.agent_day_closeout_routines target
    set next_run_at = v_next_run_at,
        claimed_at = null,
        claim_token = null,
        claim_expires_at = null,
        retry_not_before = null,
        attempt_count = 0,
        last_run_at = statement_timestamp(),
        last_success_at = case
          when v_effective_outcome in ('clear', 'attention') then statement_timestamp()
          else target.last_success_at
        end,
        last_failure_code = case
          when v_effective_outcome = 'partial' then v_effective_failure_code else null
        end,
        change_cursor = v_change_cursor,
        updated_at = statement_timestamp()
    where target.id = routine.id
      and target.claim_token = p_claim_token;

    if v_effective_outcome in ('clear', 'attention') then
      update public.notifications notification
      set is_read = true,
          persistent = false
      where notification.user_id = routine.actor_user_id::text
        and notification.company_id = routine.company_id::text
        and notification.dedupe_key like
          'day-closeout-routine:' || routine.id::text || ':%'
        and notification.persistent;
    else
      v_action_id := nullif(
        v_run.result_snapshot #>> '{filing,action_id}', ''
      )::uuid;
      if v_action_id is not null then
        update public.notifications notification
        set title = 'Day closeout incomplete',
            body = 'Some records could not be checked. Review the closeout before filing.'
        where notification.user_id = routine.actor_user_id::text
          and notification.company_id = routine.company_id::text
          and notification.dedupe_key = 'day-closeout:' || v_action_id::text;
        if not found then
          v_title := 'Day closeout incomplete';
          v_body := 'Some records could not be checked. Review the closeout before filing.';
          v_action_url := '/agent/queue';
          v_action_label := 'REVIEW';
        end if;
      else
        v_title := 'Day closeout incomplete';
        v_body := 'Some records could not be checked. Run closeout again from your connected assistant.';
      end if;
    end if;
  elsif v_effective_outcome = 'failed'
        and v_effective_failure_code in (
          'ROUTINE_EXECUTION_FAILED',
          'ROUTINE_EXECUTION_BUDGET_EXPIRED'
        )
        and routine.attempt_count < 3 then
    update private.agent_day_closeout_routines target
    set claimed_at = null,
        claim_token = null,
        claim_expires_at = null,
        retry_not_before = statement_timestamp() + case
          when routine.attempt_count = 1 then interval '5 minutes'
          else interval '15 minutes'
        end,
        last_failure_code = v_effective_failure_code,
        updated_at = statement_timestamp()
    where target.id = routine.id
      and target.claim_token = p_claim_token;
    v_retry_scheduled := true;
  else
    insert into private.agent_day_closeout_routine_failures (
      routine_id, company_id, actor_user_id, oauth_grant_id,
      oauth_client_id, grant_revision, granted_scope_ceiling,
      permission_snapshot_revision, capability_manifest_revision,
      exposure_revision, business_date, timezone, scheduled_for,
      schedule_revision, attempt_number, outcome, failure_code,
      idempotency_key
    ) values (
      routine.id, routine.company_id, routine.actor_user_id,
      routine.oauth_grant_id, routine.oauth_client_id,
      routine.grant_revision, routine.granted_scope_ceiling,
      routine.permission_snapshot_revision, routine.capability_manifest_revision,
      routine.exposure_revision,
      (p_scheduled_for at time zone routine.timezone)::date,
      routine.timezone, p_scheduled_for, routine.schedule_revision,
      routine.attempt_count, v_effective_outcome,
      v_effective_failure_code, p_idempotency_key
    )
    on conflict (company_id, actor_user_id, oauth_client_id, idempotency_key)
      do nothing
    returning id into v_failure_id;

    if v_failure_id is null then
      select failure.id into v_failure_id
      from private.agent_day_closeout_routine_failures failure
      where failure.routine_id = routine.id
        and failure.company_id = routine.company_id
        and failure.actor_user_id = routine.actor_user_id
        and failure.oauth_client_id = routine.oauth_client_id
        and failure.scheduled_for = p_scheduled_for
        and failure.schedule_revision = routine.schedule_revision
        and failure.idempotency_key = p_idempotency_key
        and failure.outcome = v_effective_outcome
        and failure.failure_code = v_effective_failure_code;
      if v_failure_id is null then
        raise exception 'AGENT_DAY_CLOSEOUT_ROUTINE_IDEMPOTENCY_CONFLICT'
          using errcode = '23505';
      end if;
    end if;

    if v_effective_outcome = 'blocked' then
      update private.agent_day_closeout_routines target
      set enabled = false,
          claimed_at = null,
          claim_token = null,
          claim_expires_at = null,
          retry_not_before = null,
          last_run_at = statement_timestamp(),
          last_failure_code = v_effective_failure_code,
          updated_at = statement_timestamp()
      where target.id = routine.id
        and target.claim_token = p_claim_token;
      v_title := 'Day closeout paused';
      v_body := 'Authorization changed. Reconnect your assistant before this routine runs again.';
      v_action_url := '/settings';
      v_action_label := 'REVIEW';
    else
      v_next_run_at := private.next_agent_day_closeout_run(
        routine.local_time,
        routine.timezone,
        routine.weekdays,
        greatest(statement_timestamp(), p_scheduled_for)
      );
      update private.agent_day_closeout_routines target
      set next_run_at = v_next_run_at,
          claimed_at = null,
          claim_token = null,
          claim_expires_at = null,
          retry_not_before = null,
          attempt_count = 0,
          last_run_at = statement_timestamp(),
          last_failure_code = v_effective_failure_code,
          updated_at = statement_timestamp()
      where target.id = routine.id
        and target.claim_token = p_claim_token;
      v_title := 'Day closeout failed';
      v_body := 'The routine could not finish. Run closeout again from your connected assistant.';
    end if;
  end if;

  if v_title is not null then
    insert into public.notifications (
      user_id, company_id, type, title, body, is_read, persistent,
      action_url, action_label, dedupe_key
    ) values (
      routine.actor_user_id::text, routine.company_id::text,
      'agent_suggestion', v_title, v_body,
      false, true, v_action_url, v_action_label,
      'day-closeout-routine:' || routine.id::text || ':' ||
        routine.schedule_revision::text || ':' ||
        extract(epoch from p_scheduled_for)::bigint::text
    ) on conflict do nothing;
  end if;

  return jsonb_build_object(
    'routine_id', routine.id,
    'outcome', v_effective_outcome,
    'run_id', v_effective_run_id,
    'failure_id', v_failure_id,
    'retry_scheduled', v_retry_scheduled
  );
end;
$function$;

revoke all on function public.claim_agent_day_closeout_routines_as_system(
  integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_agent_day_closeout_routines_as_system(
  integer, integer
) to service_role;

revoke all on function public.assert_agent_day_closeout_routine_claim_as_system(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.assert_agent_day_closeout_routine_claim_as_system(
  uuid, uuid, timestamptz
) to service_role;

revoke all on function public.persist_agent_day_closeout_routine_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, date, text, text,
  text, jsonb, uuid, uuid, timestamptz, bigint
) from public, anon, authenticated;
grant execute on function public.persist_agent_day_closeout_routine_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, date, text, text,
  text, jsonb, uuid, uuid, timestamptz, bigint
) to service_role;

revoke all on function public.finalize_agent_day_closeout_routine_as_system(
  uuid, uuid, timestamptz, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.finalize_agent_day_closeout_routine_as_system(
  uuid, uuid, timestamptz, text, text, uuid, text
) to service_role;

comment on function public.claim_agent_day_closeout_routines_as_system(
  integer, integer
) is 'Claims a bounded lease over due OPS-owned day-closeout routines. No host owns schedule state.';

comment on function public.persist_agent_day_closeout_routine_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, date, text, text,
  text, jsonb, uuid, uuid, timestamptz, bigint
) is 'Persists one deterministic routine occurrence only after exact current actor, tenant, grant, client, schedule, and claim validation.';

comment on function public.finalize_agent_day_closeout_routine_as_system(
  uuid, uuid, timestamptz, text, text, uuid, text
) is 'Advances the OPS-owned wall-clock schedule, bounds retries, and emits durable partial, blocked, or failed visibility without external effects.';
