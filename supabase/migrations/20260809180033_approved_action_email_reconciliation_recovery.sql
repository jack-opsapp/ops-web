begin;

-- Provider acceptance is the delivery boundary. Recovery may replay only
-- OPS-side persistence and therefore spends retry budget only when a replay
-- actually fails, never when a worker merely acquires a lease.
alter table public.approved_action_email_intents
  add column if not exists max_reconciliation_attempts integer not null default 8,
  add column if not exists reconciliation_exhausted_at timestamptz;

-- Provider delivery state is a fenced state machine. The predecessor granted
-- service_role direct write access while the transport RPCs were introduced;
-- remove that bypass now and require every transition to pass through a
-- security-definer RPC with its status, token, and lease checks.
revoke all on table public.approved_action_email_intents from service_role;
grant select on table public.approved_action_email_intents to service_role;

-- A counter above the supported hard ceiling cannot be normalized without
-- erasing evidence. Fail the migration with an actionable preflight instead
-- of installing a constraint that silently strands the row.
do $$
begin
  if exists (
    select 1
    from public.approved_action_email_intents
    where reconciliation_attempts < 0
  ) then
    raise exception
      'APPROVED_ACTION_EMAIL_RECONCILIATION_PREFLIGHT_NEGATIVE_ATTEMPTS';
  end if;

  if exists (
    select 1
    from public.approved_action_email_intents
    where reconciliation_attempts > 100
  ) then
    raise exception
      'APPROVED_ACTION_EMAIL_RECONCILIATION_PREFLIGHT_ATTEMPTS_ABOVE_100';
  end if;
end;
$$;

update public.approved_action_email_intents
set max_reconciliation_attempts = least(
  greatest(max_reconciliation_attempts, reconciliation_attempts, 8),
  100
);

create table if not exists private.approved_action_email_reconciliation_alert_outbox (
  intent_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  desired_state text not null check (desired_state in ('open', 'resolved')),
  desired_version bigint not null default 1 check (desired_version > 0),
  applied_version bigint not null default 0 check (applied_version >= 0),
  projection_attempts integer not null default 0 check (projection_attempts >= 0),
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approved_action_email_reconciliation_alert_version_order
    check (applied_version <= desired_version),
  constraint approved_action_email_reconciliation_alert_intent_company_fkey
    foreign key (company_id, intent_id)
    references public.approved_action_email_intents(company_id, id)
    on delete cascade,
  constraint approved_action_email_reconciliation_alert_actor_company_fkey
    foreign key (company_id, actor_user_id)
    references public.users(company_id, id)
    on delete restrict
);

revoke all on table private.approved_action_email_reconciliation_alert_outbox
  from public, anon, authenticated, service_role;

create index if not exists approved_action_email_reconciliation_alert_pending_idx
  on private.approved_action_email_reconciliation_alert_outbox(
    available_at,
    updated_at,
    intent_id
  )
  where desired_version > applied_version;

-- This alert owns one durable row per recipient and intent. Resolution keeps
-- the row so a deliberately re-opened incident updates the same notification.
create unique index if not exists notifications_approved_action_reconciliation_uidx
  on public.notifications(user_id, company_id, dedupe_key)
  where dedupe_key like 'approved-action-email-reconciliation:%';

-- Backfill every already-capped recoverable row. A live legacy lease remains
-- in flight; the runtime finalizer terminalizes it only after lease expiry.
with terminalized as (
  update public.approved_action_email_intents i
  set status = 'reconciliation_failed',
      reconciliation_lease_token = null,
      reconciliation_lease_expires_at = null,
      reconciliation_exhausted_at = coalesce(
        i.reconciliation_exhausted_at,
        now()
      ),
      last_error = coalesce(
        nullif(i.last_error, ''),
        'approved-action email reconciliation retry budget exhausted'
      ),
      updated_at = now()
  where i.reconciliation_attempts >= i.max_reconciliation_attempts
    and (
      i.status in ('provider_accepted', 'reconciliation_failed')
      or (
        i.status = 'reconciling'
        and (
          i.reconciliation_lease_expires_at is null
          or i.reconciliation_lease_expires_at <= now()
        )
      )
    )
  returning i.id, i.company_id, i.actor_user_id
)
insert into private.approved_action_email_reconciliation_alert_outbox (
  intent_id,
  company_id,
  actor_user_id,
  desired_state,
  desired_version,
  applied_version,
  available_at
)
select
  terminalized.id,
  terminalized.company_id,
  terminalized.actor_user_id,
  'open',
  1,
  0,
  now()
from terminalized
on conflict (intent_id) do update
set desired_state = 'open',
    desired_version =
      private.approved_action_email_reconciliation_alert_outbox.desired_version + 1,
    available_at = now(),
    last_error = null,
    updated_at = now();

alter table public.approved_action_email_intents
  drop constraint if exists approved_action_email_intents_reconciliation_attempts_check;
alter table public.approved_action_email_intents
  add constraint approved_action_email_intents_reconciliation_attempts_check
  check (
    reconciliation_attempts >= 0
    and max_reconciliation_attempts between 1 and 100
    and reconciliation_attempts <= max_reconciliation_attempts
  ) not valid;
alter table public.approved_action_email_intents
  validate constraint approved_action_email_intents_reconciliation_attempts_check;

alter table public.approved_action_email_intents
  drop constraint if exists approved_action_email_intents_reconciliation_exhausted_check;
alter table public.approved_action_email_intents
  add constraint approved_action_email_intents_reconciliation_exhausted_check
  check (
    reconciliation_exhausted_at is null
    or (
      status = 'reconciliation_failed'
      and reconciliation_attempts >= max_reconciliation_attempts
    )
  ) not valid;
alter table public.approved_action_email_intents
  validate constraint approved_action_email_intents_reconciliation_exhausted_check;

create index if not exists approved_action_email_intents_accepted_recovery_idx
  on public.approved_action_email_intents(updated_at, id)
  where status in ('provider_accepted', 'reconciliation_failed');

create index if not exists approved_action_email_intents_expired_lease_recovery_idx
  on public.approved_action_email_intents(reconciliation_lease_expires_at, id)
  where status = 'reconciling';

create or replace function public.claim_approved_action_email_reconciliation(
  p_intent_id uuid,
  p_lease_seconds integer default 300
)
returns public.approved_action_email_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.approved_action_email_intents%rowtype;
  v_lease_seconds integer := least(
    greatest(coalesce(p_lease_seconds, 300), 30),
    900
  );
begin
  with candidate as (
    select i.id
    from public.approved_action_email_intents i
    where i.id = p_intent_id
      and i.reconciliation_attempts < i.max_reconciliation_attempts
      and i.reconciliation_exhausted_at is null
      and (
        i.status in ('provider_accepted', 'reconciliation_failed')
        or (
          i.status = 'reconciling'
          and (
            i.reconciliation_lease_expires_at is null
            or i.reconciliation_lease_expires_at <= now()
          )
        )
      )
    for update skip locked
  )
  update public.approved_action_email_intents i
  set status = 'reconciling',
      reconciliation_lease_token = gen_random_uuid(),
      reconciliation_lease_expires_at =
        now() + make_interval(secs => v_lease_seconds),
      last_error = null,
      updated_at = now()
  from candidate
  where i.id = candidate.id
  returning i.* into v_intent;

  return v_intent;
end;
$$;

create or replace function public.claim_next_approved_action_email_reconciliation(
  p_failed_before timestamptz,
  p_lease_seconds integer
)
returns public.approved_action_email_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.approved_action_email_intents%rowtype;
  v_lease_seconds integer := least(
    greatest(coalesce(p_lease_seconds, 300), 30),
    900
  );
begin
  with candidate as (
    select i.id
    from public.approved_action_email_intents i
    where i.reconciliation_attempts < i.max_reconciliation_attempts
      and i.reconciliation_exhausted_at is null
      and (
        (
          i.status in ('provider_accepted', 'reconciliation_failed')
          and i.updated_at <= p_failed_before
        )
        or (
          i.status = 'reconciling'
          and (
            i.reconciliation_lease_expires_at is null
            or i.reconciliation_lease_expires_at <= now()
          )
        )
      )
    order by
      case
        when i.status = 'reconciling'
          then i.reconciliation_lease_expires_at
        else i.updated_at
      end nulls first,
      i.id
    limit 1
    for update skip locked
  )
  update public.approved_action_email_intents i
  set status = 'reconciling',
      reconciliation_lease_token = gen_random_uuid(),
      reconciliation_lease_expires_at =
        now() + make_interval(secs => v_lease_seconds),
      last_error = null,
      updated_at = now()
  from candidate
  where i.id = candidate.id
  returning i.* into v_intent;

  return v_intent;
end;
$$;

create or replace function public.renew_approved_action_email_reconciliation(
  p_intent_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 300
)
returns public.approved_action_email_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.approved_action_email_intents%rowtype;
  v_lease_seconds integer := least(
    greatest(coalesce(p_lease_seconds, 300), 30),
    900
  );
begin
  update public.approved_action_email_intents i
  set reconciliation_lease_expires_at =
        now() + make_interval(secs => v_lease_seconds),
      updated_at = now()
  where i.id = p_intent_id
    and i.status = 'reconciling'
    and i.reconciliation_lease_token = p_lease_token
    and i.reconciliation_lease_expires_at > now()
  returning i.* into v_intent;

  if not found then
    raise exception 'APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_INVALID';
  end if;

  return v_intent;
end;
$$;

create or replace function public.complete_approved_action_email_reconciliation(
  p_intent_id uuid,
  p_lease_token uuid,
  p_activity_id uuid
)
returns public.approved_action_email_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.approved_action_email_intents%rowtype;
  v_execution_result jsonb;
  v_action_transitioned boolean := false;
begin
  select i.*
  into v_intent
  from public.approved_action_email_intents i
  where i.id = p_intent_id
    and i.status = 'reconciling'
    and i.reconciliation_lease_token = p_lease_token
    and i.reconciliation_lease_expires_at > now()
  for update;

  if not found then
    raise exception 'APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_INVALID';
  end if;

  if not exists (
    select 1
    from public.activities activity
    where activity.id = p_activity_id
      and activity.company_id = v_intent.company_id
      and activity.email_connection_id = v_intent.connection_id
      and activity.email_message_id = v_intent.provider_message_id
      and activity.email_thread_id = v_intent.accepted_provider_thread_id
      and activity.type = 'email'
      and activity.direction = 'outbound'
      and activity.created_by = v_intent.actor_user_id
      and activity.opportunity_id is not distinct from v_intent.opportunity_id
      and activity.client_id is not distinct from v_intent.client_id
      and activity.invoice_id is not distinct from v_intent.invoice_id
      and activity.project_id is not distinct from v_intent.project_id::text
  ) then
    raise exception
      'APPROVED_ACTION_EMAIL_RECONCILIATION_ACTIVITY_IDENTITY_INVALID';
  end if;

  v_execution_result := jsonb_build_object(
    'intentId', v_intent.id,
    'messageId', v_intent.provider_message_id,
    'threadId', v_intent.accepted_provider_thread_id,
    'activityId', p_activity_id,
    'actorUserId', v_intent.actor_user_id,
    'connectionId', v_intent.connection_id
  );

  update public.agent_actions action
  set status = 'executed',
      executed_at = coalesce(action.executed_at, now()),
      error = null,
      execution_result = v_execution_result,
      updated_at = now()
  where action.id = v_intent.action_id
    and action.company_id = v_intent.company_id
    and action.status in ('approved', 'failed');
  v_action_transitioned := found;

  if not v_action_transitioned and not exists (
    select 1
    from public.agent_actions action
    where action.id = v_intent.action_id
      and action.company_id = v_intent.company_id
      and action.status = 'executed'
      and action.execution_result = v_execution_result
  ) then
    raise exception
      'APPROVED_ACTION_EMAIL_RECONCILIATION_ACTION_STATE_INVALID';
  end if;

  update public.approved_action_email_intents i
  set status = 'reconciled',
      reconciled_activity_id = p_activity_id,
      reconciled_at = now(),
      reconciliation_lease_token = null,
      reconciliation_lease_expires_at = null,
      reconciliation_exhausted_at = null,
      last_error = null,
      updated_at = now()
  where i.id = v_intent.id
  returning i.* into v_intent;

  insert into private.approved_action_email_reconciliation_alert_outbox (
    intent_id,
    company_id,
    actor_user_id,
    desired_state,
    desired_version,
    applied_version,
    available_at
  ) values (
    v_intent.id,
    v_intent.company_id,
    v_intent.actor_user_id,
    'resolved',
    1,
    0,
    now()
  )
  on conflict (intent_id) do update
  set desired_state = 'resolved',
      desired_version =
        private.approved_action_email_reconciliation_alert_outbox.desired_version + 1,
      available_at = now(),
      last_error = null,
      updated_at = now();

  return v_intent;
end;
$$;

create or replace function public.fail_approved_action_email_reconciliation(
  p_intent_id uuid,
  p_lease_token uuid,
  p_error text
)
returns public.approved_action_email_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.approved_action_email_intents%rowtype;
begin
  update public.approved_action_email_intents i
  set status = 'reconciliation_failed',
      reconciliation_attempts = least(
        i.reconciliation_attempts + 1,
        i.max_reconciliation_attempts
      ),
      reconciliation_lease_token = null,
      reconciliation_lease_expires_at = null,
      reconciliation_exhausted_at = case
        when i.reconciliation_attempts + 1 >= i.max_reconciliation_attempts
          then coalesce(i.reconciliation_exhausted_at, now())
        else null
      end,
      last_error = left(
        coalesce(p_error, 'approved-action email reconciliation failed'),
        2000
      ),
      updated_at = now()
  where i.id = p_intent_id
    and i.status = 'reconciling'
    and i.reconciliation_lease_token = p_lease_token
    and i.reconciliation_lease_expires_at > now()
  returning i.* into v_intent;

  if not found then
    raise exception 'APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_INVALID';
  end if;

  update public.agent_actions action
  set error = v_intent.last_error,
      updated_at = now()
  where action.id = v_intent.action_id
    and action.company_id = v_intent.company_id
    and action.status in ('approved', 'failed');

  if v_intent.reconciliation_exhausted_at is not null then
    insert into private.approved_action_email_reconciliation_alert_outbox (
      intent_id,
      company_id,
      actor_user_id,
      desired_state,
      desired_version,
      applied_version,
      available_at
    ) values (
      v_intent.id,
      v_intent.company_id,
      v_intent.actor_user_id,
      'open',
      1,
      0,
      now()
    )
    on conflict (intent_id) do update
    set desired_state = 'open',
        desired_version =
          private.approved_action_email_reconciliation_alert_outbox.desired_version + 1,
        available_at = now(),
        last_error = null,
        updated_at = now();
  end if;

  return v_intent;
end;
$$;

create or replace function public.release_approved_action_email_reconciliation(
  p_intent_id uuid,
  p_lease_token uuid,
  p_error text
)
returns public.approved_action_email_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.approved_action_email_intents%rowtype;
begin
  update public.approved_action_email_intents i
  set status = 'reconciliation_failed',
      reconciliation_lease_token = null,
      reconciliation_lease_expires_at = null,
      reconciliation_exhausted_at = case
        when i.reconciliation_attempts >= i.max_reconciliation_attempts
          then coalesce(i.reconciliation_exhausted_at, now())
        else i.reconciliation_exhausted_at
      end,
      last_error = left(
        coalesce(p_error, 'approved-action email reconciliation interrupted'),
        2000
      ),
      updated_at = now()
  where i.id = p_intent_id
    and i.status = 'reconciling'
    and i.reconciliation_lease_token = p_lease_token
    and i.reconciliation_lease_expires_at > now()
  returning i.* into v_intent;

  if not found then
    raise exception 'APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_INVALID';
  end if;

  if v_intent.reconciliation_exhausted_at is not null then
    insert into private.approved_action_email_reconciliation_alert_outbox (
      intent_id,
      company_id,
      actor_user_id,
      desired_state,
      desired_version,
      applied_version,
      available_at
    ) values (
      v_intent.id,
      v_intent.company_id,
      v_intent.actor_user_id,
      'open',
      1,
      0,
      now()
    )
    on conflict (intent_id) do update
    set desired_state = 'open',
        desired_version =
          private.approved_action_email_reconciliation_alert_outbox.desired_version + 1,
        available_at = now(),
        last_error = null,
        updated_at = now();
  end if;

  return v_intent;
end;
$$;

create or replace function public.finalize_expired_approved_action_email_reconciliations(
  p_limit integer default 25
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  with candidates as (
    select i.id
    from public.approved_action_email_intents i
    where i.reconciliation_attempts >= i.max_reconciliation_attempts
      and i.reconciliation_exhausted_at is null
      and (
        i.status in ('provider_accepted', 'reconciliation_failed')
        or (
          i.status = 'reconciling'
          and (
            i.reconciliation_lease_expires_at is null
            or i.reconciliation_lease_expires_at <= now()
          )
        )
      )
    order by i.updated_at, i.id
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    for update skip locked
  ), terminalized as (
    update public.approved_action_email_intents i
    set status = 'reconciliation_failed',
        reconciliation_lease_token = null,
        reconciliation_lease_expires_at = null,
        reconciliation_exhausted_at = now(),
        last_error = coalesce(
          nullif(i.last_error, ''),
          'approved-action email reconciliation retry budget exhausted'
        ),
        updated_at = now()
    from candidates
    where i.id = candidates.id
    returning i.id, i.company_id, i.actor_user_id
  ), enqueued as (
    insert into private.approved_action_email_reconciliation_alert_outbox (
      intent_id,
      company_id,
      actor_user_id,
      desired_state,
      desired_version,
      applied_version,
      available_at
    )
    select
      terminalized.id,
      terminalized.company_id,
      terminalized.actor_user_id,
      'open',
      1,
      0,
      now()
    from terminalized
    on conflict (intent_id) do update
    set desired_state = 'open',
        desired_version =
          private.approved_action_email_reconciliation_alert_outbox.desired_version + 1,
        available_at = now(),
        last_error = null,
        updated_at = now()
    returning intent_id
  )
  select count(*)::integer into v_count from enqueued;

  return v_count;
end;
$$;

create or replace function public.project_next_approved_action_email_reconciliation_alert()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox private.approved_action_email_reconciliation_alert_outbox%rowtype;
  v_error text;
  v_projected_rows integer := 0;
begin
  select outbox.*
  into v_outbox
  from private.approved_action_email_reconciliation_alert_outbox outbox
  where outbox.desired_version > outbox.applied_version
    and outbox.available_at <= now()
  order by outbox.available_at, outbox.updated_at, outbox.intent_id
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object(
      'processed', false,
      'succeeded', true,
      'error', null
    );
  end if;

  begin
    if v_outbox.desired_state = 'resolved' then
      update public.notifications notification
      set resolved_at = coalesce(notification.resolved_at, now()),
          is_read = true
      where notification.company_id = v_outbox.company_id::text
        and notification.type = 'system'
        and notification.dedupe_key =
          'approved-action-email-reconciliation:' || v_outbox.intent_id::text;
    else
      with manager_recipients as (
        select recipient.id
        from public.companies company
        join public.users recipient
          on recipient.company_id = company.id
        where company.id = v_outbox.company_id
          and recipient.deleted_at is null
          and coalesce(recipient.is_active, false)
          and (
            recipient.id::text = company.account_holder_id
            or recipient.id::text = any(
              coalesce(company.admin_ids, array[]::text[])
            )
            or private.permission_user_is_admin(
              recipient.id,
              v_outbox.company_id
            )
          )
      ), recipients as (
        select manager.id from manager_recipients manager
        union
        select actor.id
        from public.users actor
        where actor.id = v_outbox.actor_user_id
          and actor.company_id = v_outbox.company_id
          and actor.deleted_at is null
          and coalesce(actor.is_active, false)
          and not exists (select 1 from manager_recipients)
      )
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
        dedupe_key,
        resolved_at
      )
      select
        recipients.id::text,
        v_outbox.company_id::text,
        'system',
        'Email sent. Review required',
        'OPS couldn''t finish recording this email. Do not send it again.',
        false,
        true,
        '/agent/queue',
        'Review',
        'approved-action-email-reconciliation:' || v_outbox.intent_id::text,
        null
      from recipients
      on conflict (user_id, company_id, dedupe_key)
        where dedupe_key like 'approved-action-email-reconciliation:%'
      do update
      set title = excluded.title,
          body = excluded.body,
          is_read = false,
          persistent = true,
          action_url = excluded.action_url,
          action_label = excluded.action_label,
          resolved_at = null;

      get diagnostics v_projected_rows = row_count;
      if v_projected_rows = 0 then
        raise exception
          'APPROVED_ACTION_EMAIL_RECONCILIATION_ALERT_RECIPIENT_UNAVAILABLE';
      end if;
    end if;

    update private.approved_action_email_reconciliation_alert_outbox outbox
    set applied_version = v_outbox.desired_version,
        projection_attempts = 0,
        last_error = null,
        available_at = now(),
        updated_at = now()
    where outbox.intent_id = v_outbox.intent_id;

    return jsonb_build_object(
      'processed', true,
      'succeeded', true,
      'error', null
    );
  exception when others then
    get stacked diagnostics v_error = message_text;

    update private.approved_action_email_reconciliation_alert_outbox outbox
    set projection_attempts = projection_attempts + 1,
        last_error = left(v_error, 2000),
        available_at = now() + make_interval(
          secs => least(
            3600,
            60 * power(2::numeric, least(projection_attempts, 6))::integer
          )
        ),
        updated_at = now()
    where outbox.intent_id = v_outbox.intent_id;

    return jsonb_build_object(
      'processed', true,
      'succeeded', false,
      'error', v_error
    );
  end;
end;
$$;

revoke all on function public.claim_approved_action_email_reconciliation(
  uuid,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_approved_action_email_reconciliation(
  uuid,
  integer
) to service_role;

revoke all on function public.claim_next_approved_action_email_reconciliation(
  timestamptz,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_next_approved_action_email_reconciliation(
  timestamptz,
  integer
) to service_role;

revoke all on function public.renew_approved_action_email_reconciliation(
  uuid,
  uuid,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.renew_approved_action_email_reconciliation(
  uuid,
  uuid,
  integer
) to service_role;

revoke all on function public.complete_approved_action_email_reconciliation(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.complete_approved_action_email_reconciliation(
  uuid,
  uuid,
  uuid
) to service_role;

revoke all on function public.fail_approved_action_email_reconciliation(
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.fail_approved_action_email_reconciliation(
  uuid,
  uuid,
  text
) to service_role;

revoke all on function public.release_approved_action_email_reconciliation(
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.release_approved_action_email_reconciliation(
  uuid,
  uuid,
  text
) to service_role;

revoke all on function public.finalize_expired_approved_action_email_reconciliations(
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_expired_approved_action_email_reconciliations(
  integer
) to service_role;

revoke all on function public.project_next_approved_action_email_reconciliation_alert()
  from public, anon, authenticated, service_role;
grant execute on function public.project_next_approved_action_email_reconciliation_alert()
  to service_role;

commit;
