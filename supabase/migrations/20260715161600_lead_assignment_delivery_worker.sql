begin;

-- Durable lead-assignment delivery worker. Assignment state is already committed
-- before this outbox is consumed; this worker only materializes the recipient's
-- rail notification and optional push without ever widening lead access.

do $do$
begin
  if to_regclass('public.opportunity_assignment_deliveries') is null
     or to_regclass('public.opportunity_assignment_events') is null
     or to_regclass('public.opportunities') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.notification_preferences') is null
     or to_regprocedure('private.user_can_view_opportunity(uuid,uuid)') is null
  then
    raise exception 'lead assignment delivery worker prerequisites are missing';
  end if;

  if (
    select count(*)
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notifications'
       and column_name in (
         'dedupe_key',
         'deep_link_type',
         'resolved_at',
         'resolution_reason'
       )
  ) <> 4 then
    raise exception 'notification dedupe/deep-link/resolution contract is missing';
  end if;
end
$do$;

alter table public.opportunity_assignment_deliveries
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists max_attempts integer not null default 8,
  add column if not exists notification_id uuid,
  add column if not exists disposition text,
  add column if not exists push_state text not null default 'pending',
  add column if not exists terminal_at timestamptz;

-- No worker existed before this migration. Normalize any manually stranded
-- processing rows so the new token-guarded claimant can recover them safely.
update public.opportunity_assignment_deliveries
   set state = 'failed',
       available_at = now(),
       claimed_at = null,
       claimed_by = null,
       lease_token = null,
       lease_expires_at = null,
       last_error = coalesce(last_error, 'requeued during delivery worker activation'),
       updated_at = now()
 where state = 'processing'
   and lease_token is null;

do $do$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.opportunity_assignment_deliveries'::regclass
       and conname = 'opportunity_assignment_deliveries_max_attempts_check'
  ) then
    alter table public.opportunity_assignment_deliveries
      add constraint opportunity_assignment_deliveries_max_attempts_check
      check (max_attempts between 1 and 20);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.opportunity_assignment_deliveries'::regclass
       and conname = 'opportunity_assignment_deliveries_disposition_check'
  ) then
    alter table public.opportunity_assignment_deliveries
      add constraint opportunity_assignment_deliveries_disposition_check
      check (
        disposition is null
        or disposition in (
          'notified',
          'silent',
          'stale',
          'inaccessible',
          'terminal_failure'
        )
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.opportunity_assignment_deliveries'::regclass
       and conname = 'opportunity_assignment_deliveries_push_state_check'
  ) then
    alter table public.opportunity_assignment_deliveries
      add constraint opportunity_assignment_deliveries_push_state_check
      check (push_state in ('pending', 'sent', 'suppressed'));
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.opportunity_assignment_deliveries'::regclass
       and conname = 'opportunity_assignment_deliveries_lease_check'
  ) then
    alter table public.opportunity_assignment_deliveries
      add constraint opportunity_assignment_deliveries_lease_check
      check (
        (
          state = 'processing'
          and lease_token is not null
          and lease_expires_at is not null
        )
        or (
          state <> 'processing'
          and lease_token is null
          and lease_expires_at is null
        )
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.opportunity_assignment_deliveries'::regclass
       and conname = 'opportunity_assignment_deliveries_notification_fkey'
  ) then
    alter table public.opportunity_assignment_deliveries
      add constraint opportunity_assignment_deliveries_notification_fkey
      foreign key (notification_id)
      references public.notifications (id)
      on delete restrict;
  end if;
end
$do$;

create index if not exists opportunity_assignment_deliveries_worker_claim_idx
  on public.opportunity_assignment_deliveries (
    available_at,
    lease_expires_at,
    created_at,
    id
  )
  where state in ('pending', 'processing', 'failed');

-- Unlike the general unread-notification dedupe index, this identity remains
-- unique after dismissal. A recovered worker can therefore never recreate the
-- same visible assignment notification.
create unique index if not exists notifications_lead_assignment_delivery_dedupe_idx
  on public.notifications (dedupe_key)
  where dedupe_key like 'lead-assignment-delivery:%';

-- New preference category is push-only and default-enabled. Existing explicit
-- values are preserved; absence is also interpreted as enabled by the claimant.
update public.notification_preferences
   set channel_preferences = jsonb_set(
         case
           when jsonb_typeof(channel_preferences) = 'object'
             then channel_preferences
           else '{}'::jsonb
         end,
         '{lead_assignments}',
         '{"push": true, "email": false}'::jsonb,
         true
       ),
       updated_at = now()
 where channel_preferences is null
    or jsonb_typeof(channel_preferences) <> 'object'
    or not channel_preferences ? 'lead_assignments';

alter table public.notification_preferences
  alter column channel_preferences set default '{
    "task_assigned": {"push": true, "email": false},
    "task_completed": {"push": true, "email": false},
    "schedule_changes": {"push": true, "email": false},
    "project_updates": {"push": true, "email": true},
    "lead_assignments": {"push": true, "email": false},
    "expense_submitted": {"push": true, "email": true},
    "expense_approved": {"push": true, "email": true},
    "invoice_sent": {"push": true, "email": false},
    "payment_received": {"push": true, "email": true},
    "team_mentions": {"push": true, "email": false},
    "daily_digest": {"push": false, "email": false}
  }'::jsonb;

create or replace function public.claim_opportunity_assignment_deliveries(
  p_worker_id uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 180
) returns table (
  delivery_id uuid,
  delivery_lease_token uuid,
  assignment_event_id uuid,
  company_id uuid,
  opportunity_id uuid,
  recipient_user_id uuid,
  notification_id uuid,
  lead_title text,
  should_push boolean,
  requires_notification boolean,
  disposition text
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_limit integer := greatest(0, least(coalesce(p_limit, 25), 100));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 180), 900));
  v_row record;
  v_notification_id uuid;
  v_lease_token uuid;
  v_dedupe_key text;
  v_lead_title text;
  v_notification_body text;
  v_pref_push jsonb;
  v_should_push boolean;
  v_disposition text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise insufficient_privilege using
      message = 'lead assignment delivery claims require service role';
  end if;
  if p_worker_id is null then
    raise exception 'lead assignment delivery worker id is required';
  end if;
  if v_limit = 0 then
    return;
  end if;

  for v_row in
    select
      d.*,
      o.title as opportunity_title,
      o.assigned_to as current_assignee_id,
      o.assignment_version as current_assignment_version,
      o.deleted_at as opportunity_deleted_at,
      o.archived_at as opportunity_archived_at,
      e.new_assignee_id,
      e.assignment_version as event_assignment_version,
      e.company_id as event_company_id,
      e.opportunity_id as event_opportunity_id,
      u.company_id as user_company_id,
      u.deleted_at as user_deleted_at,
      u.is_active as user_is_active,
      np.push_enabled as preference_push_enabled,
      np.channel_preferences
    from public.opportunity_assignment_deliveries d
    join public.opportunities o
      on o.id = d.opportunity_id
    join public.opportunity_assignment_events e
      on e.id = d.assignment_event_id
    join public.users u
      on u.id = d.recipient_user_id
    left join public.notification_preferences np
      on np.user_id = d.recipient_user_id
     and np.company_id = d.company_id
    where (
      (
        d.state in ('pending', 'failed')
        and d.available_at <= now()
        and d.attempts < d.max_attempts
      )
      or (d.state = 'processing' and d.lease_expires_at <= now())
    )
    order by
      case
        when d.state = 'processing' then d.lease_expires_at
        else d.available_at
      end,
      d.created_at,
      d.id
    for update of d, o skip locked
    limit v_limit
  loop
    v_disposition := null;

    -- A crashed worker that exhausted its final lease is terminal, but still
    -- returned so the cron reports the condition instead of hiding it.
    if v_row.state = 'processing'
       and v_row.attempts >= v_row.max_attempts
    then
      update public.opportunity_assignment_deliveries d
         set state = 'failed',
             disposition = 'terminal_failure',
             terminal_at = now(),
             claimed_at = null,
             claimed_by = null,
             lease_token = null,
             lease_expires_at = null,
             available_at = 'infinity'::timestamptz,
             last_error = coalesce(
               d.last_error,
               'lease expired after maximum attempts'
             ),
             updated_at = now()
       where d.id = v_row.id;

      return query values (
        v_row.id,
        null::uuid,
        v_row.assignment_event_id,
        v_row.company_id,
        v_row.opportunity_id,
        v_row.recipient_user_id,
        v_row.notification_id,
        coalesce(nullif(btrim(v_row.opportunity_title), ''), 'New lead'),
        false,
        false,
        'terminal_failure'::text
      );
      continue;
    end if;

    if v_row.notify = false then
      v_disposition := 'silent';
    elsif v_row.access_after = false
       or v_row.company_id is distinct from v_row.event_company_id
       or v_row.opportunity_id is distinct from v_row.event_opportunity_id
       or v_row.assignment_version is distinct from v_row.event_assignment_version
       or v_row.assignment_version is distinct from v_row.current_assignment_version
       or v_row.new_assignee_id is distinct from v_row.recipient_user_id
       or v_row.current_assignee_id is distinct from v_row.recipient_user_id
       or v_row.opportunity_deleted_at is not null
       or v_row.opportunity_archived_at is not null
    then
      v_disposition := 'stale';
    elsif v_row.user_company_id is distinct from v_row.company_id
       or v_row.user_deleted_at is not null
       or not coalesce(v_row.user_is_active, false)
       or not private.user_can_view_opportunity(
         v_row.recipient_user_id,
         v_row.opportunity_id
       )
    then
      v_disposition := 'inaccessible';
    end if;

    if v_disposition is not null then
      if v_disposition in ('stale', 'inaccessible')
         and v_row.notification_id is not null
      then
        update public.notifications n
           set is_read = true,
               resolved_at = now(),
               resolution_reason = 'assignment_delivery_suppressed'
         where n.id = v_row.notification_id
           and n.dedupe_key =
             'lead-assignment-delivery:' || v_row.id::text;
      end if;

      update public.opportunity_assignment_deliveries d
         set state = 'delivered',
             attempts = d.attempts + 1,
             claimed_at = null,
             claimed_by = null,
             lease_token = null,
             lease_expires_at = null,
             delivered_at = now(),
             disposition = v_disposition,
             push_state = 'suppressed',
             terminal_at = null,
             last_error = case v_disposition
               when 'silent' then null
               when 'stale' then 'suppressed stale assignment delivery'
               else 'suppressed delivery for inaccessible recipient'
             end,
             updated_at = now()
       where d.id = v_row.id;

      return query values (
        v_row.id,
        null::uuid,
        v_row.assignment_event_id,
        v_row.company_id,
        v_row.opportunity_id,
        v_row.recipient_user_id,
        v_row.notification_id,
        coalesce(nullif(btrim(v_row.opportunity_title), ''), 'New lead'),
        false,
        false,
        v_disposition
      );
      continue;
    end if;

    v_lead_title := coalesce(
      nullif(btrim(v_row.opportunity_title), ''),
      'New lead'
    );
    v_notification_body := left(
      v_lead_title || ' is now assigned to you.',
      140
    );
    v_dedupe_key := 'lead-assignment-delivery:' || v_row.id::text;
    v_notification_id := null;

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
      project_id,
      deep_link_type,
      dedupe_key
    ) values (
      v_row.recipient_user_id::text,
      v_row.company_id::text,
      'lead_assigned',
      'Lead assigned',
      v_notification_body,
      false,
      false,
      '/pipeline?opportunityId=' || v_row.opportunity_id::text,
      'OPEN LEAD',
      null,
      'lead',
      v_dedupe_key
    )
    on conflict do nothing
    returning id into v_notification_id;

    if v_notification_id is null then
      select n.id
        into v_notification_id
        from public.notifications n
       where n.dedupe_key = v_dedupe_key
         and n.user_id = v_row.recipient_user_id::text
         and n.company_id = v_row.company_id::text
         and n.type = 'lead_assigned';
    end if;

    if v_notification_id is null then
      raise exception 'lead assignment notification could not be materialized';
    end if;

    v_pref_push := v_row.channel_preferences #> '{lead_assignments,push}';
    v_should_push := coalesce(v_row.preference_push_enabled, true)
      and case
        when jsonb_typeof(v_pref_push) = 'boolean'
          then (v_pref_push #>> '{}')::boolean
        else true
      end;

    v_lease_token := gen_random_uuid();
    update public.opportunity_assignment_deliveries d
       set state = 'processing',
           attempts = d.attempts + 1,
           claimed_at = now(),
           claimed_by = p_worker_id::text,
           lease_token = v_lease_token,
           lease_expires_at = now() + make_interval(secs => v_lease_seconds),
           notification_id = v_notification_id,
           disposition = null,
           push_state = 'pending',
           terminal_at = null,
           last_error = null,
           updated_at = now()
     where d.id = v_row.id;

    return query values (
      v_row.id,
      v_lease_token,
      v_row.assignment_event_id,
      v_row.company_id,
      v_row.opportunity_id,
      v_row.recipient_user_id,
      v_notification_id,
      v_lead_title,
      v_should_push,
      true,
      'notified'::text
    );
  end loop;
end;
$function$;

create or replace function public.complete_opportunity_assignment_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_push_state text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_delivery public.opportunity_assignment_deliveries%rowtype;
  v_opportunity record;
  v_dedupe_key text;
  v_stale boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise insufficient_privilege using
      message = 'lead assignment delivery completion requires service role';
  end if;
  if p_delivery_id is null or p_lease_token is null then
    raise exception 'delivery id and lease token are required';
  end if;
  if p_push_state not in ('sent', 'suppressed') then
    raise exception 'push state must be sent or suppressed';
  end if;

  select d.*
    into v_delivery
    from public.opportunity_assignment_deliveries d
   where d.id = p_delivery_id
   for update;

  if not found then
    raise exception 'lead assignment delivery not found';
  end if;
  if v_delivery.state <> 'processing'
     or v_delivery.lease_token is distinct from p_lease_token
  then
    raise exception 'lead assignment delivery lease is no longer active';
  end if;

  v_dedupe_key := 'lead-assignment-delivery:' || v_delivery.id::text;
  if v_delivery.notification_id is null
     or not exists (
       select 1
         from public.notifications n
        where n.id = v_delivery.notification_id
          and n.user_id = v_delivery.recipient_user_id::text
          and n.company_id = v_delivery.company_id::text
          and n.type = 'lead_assigned'
          and n.persistent is false
          and n.action_url = '/pipeline?opportunityId=' || v_delivery.opportunity_id::text
          and n.deep_link_type = 'lead'
          and n.dedupe_key = v_dedupe_key
     )
  then
    raise exception 'lead assignment notification proof is missing';
  end if;

  select
    o.assignment_version,
    o.assigned_to,
    o.deleted_at,
    o.archived_at
    into v_opportunity
    from public.opportunities o
   where o.id = v_delivery.opportunity_id
   for update;

  if not found then
    v_stale := true;
  else
    v_stale := v_opportunity.assignment_version is distinct from
        v_delivery.assignment_version
      or v_opportunity.assigned_to is distinct from
        v_delivery.recipient_user_id
      or v_opportunity.deleted_at is not null
      or v_opportunity.archived_at is not null;

    if not v_stale then
      v_stale := not private.user_can_view_opportunity(
        v_delivery.recipient_user_id,
        v_delivery.opportunity_id
      );
    end if;
  end if;

  if v_stale then
    update public.notifications n
       set is_read = true,
           resolved_at = now(),
           resolution_reason = 'assignment_delivery_suppressed'
     where n.id = v_delivery.notification_id
       and n.dedupe_key = v_dedupe_key;

    update public.opportunity_assignment_deliveries d
       set state = 'delivered',
           delivered_at = now(),
           claimed_at = null,
           claimed_by = null,
           lease_token = null,
           lease_expires_at = null,
           disposition = 'stale',
           push_state = p_push_state,
           terminal_at = null,
           last_error = 'assignment changed before delivery completion',
           updated_at = now()
     where d.id = p_delivery_id;

    return jsonb_build_object(
      'ok', true,
      'delivery_id', p_delivery_id,
      'notification_id', v_delivery.notification_id,
      'push_state', p_push_state,
      'suppressed', true
    );
  end if;

  update public.opportunity_assignment_deliveries d
     set state = 'delivered',
         delivered_at = now(),
         claimed_at = null,
         claimed_by = null,
         lease_token = null,
         lease_expires_at = null,
         disposition = 'notified',
         push_state = p_push_state,
         terminal_at = null,
         last_error = null,
         updated_at = now()
   where d.id = p_delivery_id;

  return jsonb_build_object(
    'ok', true,
    'delivery_id', p_delivery_id,
    'notification_id', v_delivery.notification_id,
    'push_state', p_push_state
  );
end;
$function$;

create or replace function public.fail_opportunity_assignment_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_delivery public.opportunity_assignment_deliveries%rowtype;
  v_terminal boolean;
  v_backoff_seconds integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise insufficient_privilege using
      message = 'lead assignment delivery failure handling requires service role';
  end if;
  if p_delivery_id is null or p_lease_token is null then
    raise exception 'delivery id and lease token are required';
  end if;

  select d.*
    into v_delivery
    from public.opportunity_assignment_deliveries d
   where d.id = p_delivery_id
   for update;

  if not found then
    raise exception 'lead assignment delivery not found';
  end if;
  if v_delivery.state <> 'processing'
     or v_delivery.lease_token is distinct from p_lease_token
  then
    raise exception 'lead assignment delivery lease is no longer active';
  end if;

  v_terminal := not coalesce(p_retryable, true)
    or v_delivery.attempts >= v_delivery.max_attempts;
  v_backoff_seconds := least(
    3600::numeric,
    30::numeric * power(
      2::numeric,
      least(greatest(v_delivery.attempts - 1, 0), 7)::numeric
    )
  )::integer;

  update public.opportunity_assignment_deliveries d
     set state = 'failed',
         available_at = case
           when v_terminal then 'infinity'::timestamptz
           else now() + make_interval(secs => v_backoff_seconds)
         end,
         claimed_at = null,
         claimed_by = null,
         lease_token = null,
         lease_expires_at = null,
         disposition = case
           when v_terminal then 'terminal_failure'
           else null
         end,
         terminal_at = case when v_terminal then now() else null end,
         last_error = left(coalesce(nullif(btrim(p_error), ''), 'delivery failed'), 2000),
         updated_at = now()
   where d.id = p_delivery_id;

  return jsonb_build_object(
    'ok', true,
    'delivery_id', p_delivery_id,
    'terminal', v_terminal,
    'retry_at', case
      when v_terminal then null
      else now() + make_interval(secs => v_backoff_seconds)
    end
  );
end;
$function$;

revoke all on function public.claim_opportunity_assignment_deliveries(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_opportunity_assignment_deliveries(uuid, integer, integer)
  to service_role;

revoke all on function public.complete_opportunity_assignment_delivery(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_opportunity_assignment_delivery(uuid, uuid, text)
  to service_role;

revoke all on function public.fail_opportunity_assignment_delivery(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_opportunity_assignment_delivery(uuid, uuid, text, boolean)
  to service_role;

comment on function public.claim_opportunity_assignment_deliveries(uuid, integer, integer) is
  'Service-only SKIP LOCKED lead-assignment delivery claim. Silently consumes old-assignee, stale, and inaccessible rows; materializes one durable rail notification before returning push work.';
comment on function public.complete_opportunity_assignment_delivery(uuid, uuid, text) is
  'Completes only the active delivery lease after verifying its durable rail notification.';
comment on function public.fail_opportunity_assignment_delivery(uuid, uuid, text, boolean) is
  'Fails only the active delivery lease with bounded exponential retry or terminal disposition.';

commit;
