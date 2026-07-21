begin;

-- The daily sweep is a durable scheduler, not a deterministic first page.
-- Persisting attempt state prevents the first 200 actor-mailbox scopes (or a
-- permanently failing subset) from starving everyone that sorts after them.
alter table public.email_autonomy_milestones
  add column if not exists graduation_last_attempt_at timestamptz,
  add column if not exists graduation_last_succeeded_at timestamptz,
  add column if not exists graduation_failure_count integer not null default 0,
  add column if not exists graduation_next_attempt_at timestamptz,
  add column if not exists graduation_last_error text;

alter table public.email_autonomy_milestones
  drop constraint if exists email_autonomy_milestones_graduation_failure_count_check;

alter table public.email_autonomy_milestones
  add constraint email_autonomy_milestones_graduation_failure_count_check
  check (graduation_failure_count >= 0);

create index if not exists email_autonomy_milestones_graduation_schedule_idx
  on public.email_autonomy_milestones (
    graduation_next_attempt_at,
    graduation_last_attempt_at,
    company_id,
    connection_id,
    user_id
  );

-- Both the scheduler and per-category accuracy checks are daily hot paths.
-- Keep them on exact actor-mailbox keys before the durable queue accumulates.
create index if not exists email_outbound_learning_graduation_scope_idx
  on public.email_outbound_learning_queue (company_id, connection_id, user_id)
  where status = 'completed'
    and learning_authority in ('operator_authored', 'operator_approved')
    and apply_learning is true
    and actor_proof_type in (
      'accepted_send_intent',
      'accepted_approved_action',
      'native_mailbox_draft',
      'personal_mailbox_owner'
    );

create index if not exists email_outbound_learning_mailbox_accuracy_idx
  on public.email_outbound_learning_queue (
    company_id,
    connection_id,
    user_id,
    occurred_at desc nulls last,
    completed_at desc,
    id desc
  )
  where status = 'completed'
    and learning_authority = 'operator_approved'
    and apply_learning is true
    and draft_history_id is not null
    and draft_outcome is not null
    and actor_proof_type in (
      'accepted_send_intent',
      'accepted_approved_action',
      'native_mailbox_draft'
    );

-- Mailbox-specific graduation must not borrow successful outcomes from a
-- second mailbox owned or operated by the same OPS actor. Keep the older
-- four-argument aggregate bridge for company-wide calibration displays and
-- expose this required-connection overload for every autonomy gate.
create or replace function public.get_human_draft_accuracy_as_system(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_profile_types text[] default null,
  p_limit integer default 50
)
returns table (
  draft_outcome jsonb,
  profile_type text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.users actor
    join public.email_connections connection
      on connection.id = p_connection_id
     and connection.company_id = p_company_id::text
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
     and (
       connection.type::text <> 'individual'
       or btrim(coalesce(connection.user_id, '')) = p_actor_user_id::text
     )
    where actor.id = p_actor_user_id
      and actor.company_id = p_company_id
      and coalesce(actor.is_active, false)
      and actor.deleted_at is null
  ) then
    return;
  end if;

  return query
  select queue.draft_outcome, queue.profile_type
  from public.email_outbound_learning_queue queue
  where queue.company_id = p_company_id::text
    and queue.connection_id = p_connection_id
    and queue.user_id = p_actor_user_id::text
    and queue.status = 'completed'
    and queue.learning_authority = 'operator_approved'
    and queue.apply_learning is true
    and queue.draft_history_id is not null
    and queue.draft_outcome is not null
    and queue.actor_proof_type in (
      'accepted_send_intent',
      'accepted_approved_action',
      'native_mailbox_draft'
    )
    and (
      p_profile_types is null
      or cardinality(p_profile_types) = 0
      or queue.profile_type = any (p_profile_types)
    )
  order by
    queue.occurred_at desc nulls last,
    queue.completed_at desc,
    queue.id desc
  limit v_limit;
end;
$function$;

revoke all on function public.get_human_draft_accuracy_as_system(
  uuid, uuid, uuid, text[], integer
) from public, anon, authenticated, service_role;
grant execute on function public.get_human_draft_accuracy_as_system(
  uuid, uuid, uuid, text[], integer
) to service_role;

create or replace function public.list_phase_c_graduation_actor_scopes_as_system(
  p_limit integer default 200
)
returns table (
  company_id uuid,
  connection_id uuid,
  actor_user_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select
    candidate.company_id,
    candidate.connection_id,
    candidate.actor_user_id
  from (
    select distinct
      company.id as company_id,
      connection.id as connection_id,
      actor.id as actor_user_id
    from public.email_outbound_learning_queue queue
    join public.companies company
      on company.id::text = queue.company_id
    join public.email_connections connection
      on connection.id = queue.connection_id
     and connection.company_id = queue.company_id
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
    join public.users actor
      on actor.id::text = queue.user_id
     and actor.company_id = company.id
     and coalesce(actor.is_active, false)
     and actor.deleted_at is null
    where queue.status = 'completed'
      and queue.learning_authority in ('operator_authored', 'operator_approved')
      and queue.apply_learning is true
      and (
        connection.type::text <> 'individual'
        or btrim(coalesce(connection.user_id, '')) = actor.id::text
      )
      and queue.actor_proof_type in (
        'accepted_send_intent',
        'accepted_approved_action',
        'native_mailbox_draft',
        'personal_mailbox_owner'
      )
  ) candidate
  left join public.email_autonomy_milestones milestone
    on milestone.company_id = candidate.company_id
   and milestone.connection_id = candidate.connection_id
   and milestone.user_id = candidate.actor_user_id
  where milestone.graduation_next_attempt_at is null
     or milestone.graduation_next_attempt_at <= now()
  order by
    milestone.graduation_last_attempt_at asc nulls first,
    candidate.company_id,
    candidate.connection_id,
    candidate.actor_user_id
  limit v_limit;
end;
$function$;

revoke all on function public.list_phase_c_graduation_actor_scopes_as_system(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_phase_c_graduation_actor_scopes_as_system(integer)
  to service_role;

create or replace function public.complete_phase_c_graduation_scope_check_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_succeeded boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_succeeded is null then
    raise exception 'graduation_check_result_required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.email_outbound_learning_queue queue
    join public.email_connections connection
      on connection.id = queue.connection_id
     and connection.company_id = queue.company_id
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
     and (
       connection.type::text <> 'individual'
       or btrim(coalesce(connection.user_id, '')) = p_actor_user_id::text
     )
    join public.users actor
      on actor.id::text = queue.user_id
     and actor.company_id = p_company_id
     and coalesce(actor.is_active, false)
     and actor.deleted_at is null
    where queue.company_id = p_company_id::text
      and queue.connection_id = p_connection_id
      and queue.user_id = p_actor_user_id::text
      and queue.status = 'completed'
      and queue.learning_authority in ('operator_authored', 'operator_approved')
      and queue.apply_learning is true
      and queue.actor_proof_type in (
        'accepted_send_intent',
        'accepted_approved_action',
        'native_mailbox_draft',
        'personal_mailbox_owner'
      )
  ) then
    raise exception 'graduation_scope_unavailable' using errcode = '42501';
  end if;

  insert into public.email_autonomy_milestones (
    company_id,
    connection_id,
    user_id,
    graduation_last_attempt_at,
    graduation_last_succeeded_at,
    graduation_failure_count,
    graduation_next_attempt_at,
    graduation_last_error
  ) values (
    p_company_id,
    p_connection_id,
    p_actor_user_id,
    v_now,
    case when p_succeeded then v_now else null end,
    case when p_succeeded then 0 else 1 end,
    case
      when p_succeeded then v_now + interval '24 hours'
      else v_now + interval '1 hour'
    end,
    case
      when p_succeeded then null
      else left(coalesce(nullif(btrim(p_error), ''), 'milestone check failed'), 500)
    end
  )
  on conflict (company_id, connection_id, user_id) do update
  set graduation_last_attempt_at = excluded.graduation_last_attempt_at,
      graduation_last_succeeded_at = case
        when p_succeeded then excluded.graduation_last_succeeded_at
        else email_autonomy_milestones.graduation_last_succeeded_at
      end,
      graduation_failure_count = case
        when p_succeeded then 0
        else email_autonomy_milestones.graduation_failure_count + 1
      end,
      graduation_next_attempt_at = case
        when p_succeeded then v_now + interval '24 hours'
        when email_autonomy_milestones.graduation_failure_count <= 0
          then v_now + interval '1 hour'
        when email_autonomy_milestones.graduation_failure_count = 1
          then v_now + interval '2 hours'
        when email_autonomy_milestones.graduation_failure_count = 2
          then v_now + interval '4 hours'
        when email_autonomy_milestones.graduation_failure_count = 3
          then v_now + interval '8 hours'
        else v_now + interval '16 hours'
      end,
      graduation_last_error = case
        when p_succeeded then null
        else excluded.graduation_last_error
      end,
      updated_at = v_now;
end;
$function$;

revoke all on function public.complete_phase_c_graduation_scope_check_as_system(
  uuid, uuid, uuid, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_phase_c_graduation_scope_check_as_system(
  uuid, uuid, uuid, boolean, text
) to service_role;

-- A category becomes ready once. Reading or resolving the prompt must not make
-- the daily sweep mint it again. New keys start with this migration, so the
-- lifetime constraint requires no historical rewrite or backfill.
create unique index if not exists notifications_phase_c_graduation_unique
  on public.notifications (user_id, company_id, dedupe_key)
  where dedupe_key like 'phase-c-graduation:%';

create or replace function public.record_phase_c_graduation_prompt_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_category text,
  p_title text,
  p_body text,
  p_action_url text,
  p_action_label text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_category text := upper(nullif(btrim(p_category), ''));
  v_dedupe_key text;
  v_inserted integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if v_category is null
     or v_category not in (
       'CUSTOMER', 'VENDOR', 'SUBTRADE', 'JOB_SEEKER', 'PLATFORM_BID',
       'LEGAL', 'COLLECTIONS', 'MARKETING', 'RECEIPT', 'PERSONAL',
       'INTERNAL', 'OTHER'
     )
     or nullif(btrim(p_title), '') is null
     or nullif(btrim(p_body), '') is null then
    raise exception 'graduation_prompt_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.users actor
    join public.email_connections connection
      on connection.id = p_connection_id
     and connection.company_id = p_company_id::text
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
     and (
       connection.type::text <> 'individual'
       or btrim(coalesce(connection.user_id, '')) = p_actor_user_id::text
     )
    where actor.id = p_actor_user_id
      and actor.company_id = p_company_id
      and coalesce(actor.is_active, false)
      and actor.deleted_at is null
  ) then
    raise exception 'graduation_prompt_scope_unavailable' using errcode = '42501';
  end if;

  v_dedupe_key :=
    'phase-c-graduation:v1:'
    || p_company_id::text || ':'
    || p_connection_id::text || ':'
    || p_actor_user_id::text || ':'
    || lower(v_category);

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
  ) values (
    p_actor_user_id::text,
    p_company_id::text,
    'ai_milestone',
    btrim(p_title),
    btrim(p_body),
    false,
    true,
    nullif(btrim(p_action_url), ''),
    nullif(btrim(p_action_label), ''),
    v_dedupe_key
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return true;
  end if;

  if not exists (
    select 1
    from public.notifications notification
    where notification.user_id = p_actor_user_id::text
      and notification.company_id = p_company_id::text
      and notification.type = 'ai_milestone'
      and notification.dedupe_key = v_dedupe_key
  ) then
    raise exception 'graduation_prompt_not_reconciled' using errcode = '55000';
  end if;

  return false;
end;
$function$;

revoke all on function public.record_phase_c_graduation_prompt_as_system(
  uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_phase_c_graduation_prompt_as_system(
  uuid, uuid, uuid, text, text, text, text, text
) to service_role;

commit;
