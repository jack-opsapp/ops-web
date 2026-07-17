begin;

-- Every conversion entry point writes one immutable opportunity_conversion_events
-- row. This recipient-addressed outbox turns that durable fact into one rail
-- notification and an optional push without trusting a browser, mailbox, email
-- address, or conversion actor to choose the recipient.

do $do$
begin
  if to_regclass('public.opportunity_conversion_events') is null
     or to_regclass('public.opportunities') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.users') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.notification_preferences') is null
     or to_regprocedure('private.user_can_view_opportunity(uuid,uuid)') is null
     or to_regprocedure('private.user_can_view_project(uuid,uuid)') is null
     or to_regprocedure('private.lock_lead_assignment_company(uuid)') is null
  then
    raise exception 'opportunity conversion notification prerequisites are missing'
      using errcode = '55000';
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
    raise exception 'notification hardening prerequisites are missing'
      using errcode = '55000';
  end if;
end
$do$;

create table public.opportunity_conversion_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  conversion_event_id uuid not null references public.opportunity_conversion_events (id) on delete restrict,
  company_id uuid not null references public.companies (id) on delete restrict,
  opportunity_id uuid not null references public.opportunities (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  recipient_user_id uuid not null references public.users (id) on delete restrict,
  actor_user_id uuid references public.users (id) on delete restrict,
  assignment_version bigint not null check (assignment_version >= 0),
  event_created_at timestamptz not null,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  notification_id uuid references public.notifications (id) on delete restrict,
  destination text check (destination is null or destination in ('lead', 'project')),
  disposition text check (
    disposition is null
    or disposition in (
      'notified',
      'stale',
      'inaccessible',
      'terminal_failure'
    )
  ),
  push_state text not null default 'pending'
    check (push_state in ('pending', 'sent', 'suppressed', 'failed')),
  last_error text,
  delivered_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversion_event_id, recipient_user_id),
  check (
    (
      state = 'processing'
      and lease_token is not null
      and lease_expires_at is not null
      and claimed_by is not null
      and claimed_at is not null
    )
    or (
      state <> 'processing'
      and lease_token is null
      and lease_expires_at is null
      and claimed_by is null
      and claimed_at is null
    )
  )
);

create index opportunity_conversion_notification_deliveries_claim_idx
  on public.opportunity_conversion_notification_deliveries (
    available_at,
    lease_expires_at,
    event_created_at,
    id
  )
  where state in ('pending', 'processing', 'failed');

create unique index notifications_conversion_delivery_dedupe_idx
  on public.notifications (dedupe_key)
  where dedupe_key like 'conversion-notification-delivery:%';

alter table public.opportunity_conversion_notification_deliveries
  enable row level security;
revoke all on table public.opportunity_conversion_notification_deliveries
  from public, anon, authenticated, service_role;

create or replace function private.guard_opportunity_conversion_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'conversion notification deliveries are immutable'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.conversion_event_id is distinct from old.conversion_event_id
     or new.company_id is distinct from old.company_id
     or new.opportunity_id is distinct from old.opportunity_id
     or new.project_id is distinct from old.project_id
     or new.recipient_user_id is distinct from old.recipient_user_id
     or new.actor_user_id is distinct from old.actor_user_id
     or new.assignment_version is distinct from old.assignment_version
     or new.event_created_at is distinct from old.event_created_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'conversion notification deliveries are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_opportunity_conversion_notification_delivery()
  from public, anon, authenticated, service_role;

create trigger guard_opportunity_conversion_notification_delivery
before update or delete on public.opportunity_conversion_notification_deliveries
for each row execute function private.guard_opportunity_conversion_notification_delivery();

create or replace function private.enqueue_opportunity_conversion_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  opportunity public.opportunities%rowtype;
  project public.projects%rowtype;
begin
  if new.event_type <> 'converted_to_project' then
    raise exception 'unsupported opportunity conversion event type'
      using errcode = '55000';
  end if;

  select opportunity_row.*
    into opportunity
    from public.opportunities opportunity_row
   where opportunity_row.id = new.opportunity_id
   for key share;

  if not found
     or opportunity.company_id is distinct from new.company_id
     or opportunity.assignment_version is distinct from new.assignment_version
     or opportunity.project_ref is distinct from new.project_id
     or opportunity.deleted_at is not null
  then
    raise exception 'conversion event opportunity snapshot is invalid'
      using errcode = '55000';
  end if;

  select project_row.*
    into project
    from public.projects project_row
   where project_row.id = new.project_id
   for key share;

  if not found
     or project.company_id is distinct from new.company_id
     or project.opportunity_ref is distinct from new.opportunity_id
     or project.deleted_at is not null
  then
    raise exception 'conversion event project relationship is invalid'
      using errcode = '55000';
  end if;

  if opportunity.assigned_to is null
     or (
       new.actor_user_id is not null
       and opportunity.assigned_to = new.actor_user_id
     )
  then
    return new;
  end if;

  insert into public.opportunity_conversion_notification_deliveries (
    conversion_event_id,
    company_id,
    opportunity_id,
    project_id,
    recipient_user_id,
    actor_user_id,
    assignment_version,
    event_created_at
  ) values (
    new.id,
    new.company_id,
    new.opportunity_id,
    new.project_id,
    opportunity.assigned_to,
    new.actor_user_id,
    new.assignment_version,
    new.created_at
  )
  on conflict (conversion_event_id, recipient_user_id) do nothing;

  return new;
end;
$function$;

revoke all on function private.enqueue_opportunity_conversion_notification_delivery()
  from public, anon, authenticated, service_role;

create trigger opportunity_conversion_events_enqueue_notification
after insert on public.opportunity_conversion_events
for each row execute function private.enqueue_opportunity_conversion_notification_delivery();

create or replace function public.claim_opportunity_conversion_notification_deliveries(
  p_worker_id uuid,
  p_lease_seconds integer default 180
) returns table (
  delivery_id uuid,
  delivery_lease_token uuid,
  conversion_event_id uuid,
  company_id uuid,
  opportunity_id uuid,
  project_id uuid,
  recipient_user_id uuid,
  actor_user_id uuid,
  notification_id uuid,
  lead_title text,
  destination text,
  should_push boolean,
  requires_notification boolean,
  disposition text
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  delivery record;
  event_row public.opportunity_conversion_events%rowtype;
  opportunity public.opportunities%rowtype;
  project public.projects%rowtype;
  user_row public.users%rowtype;
  preference public.notification_preferences%rowtype;
  v_company_id uuid;
  v_company_deleted_at timestamptz;
  v_company_exists boolean;
  v_notification_id uuid;
  v_lease_token uuid;
  v_dedupe_key text;
  v_lead_title text;
  v_notification_body text;
  v_action_url text;
  v_action_label text;
  v_destination text;
  v_project_id text;
  v_deep_link_type text;
  v_preference_push jsonb;
  v_wants_push boolean;
  v_should_push boolean;
  v_disposition text;
  v_project_accessible boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_worker_id is null
     or p_lease_seconds < 30
     or p_lease_seconds > 900
  then
    raise exception 'invalid conversion delivery claim arguments'
      using errcode = '22023';
  end if;

  -- Read only the company key first. Every assignment/permission-sensitive
  -- operation then takes the same company advisory lock before any row lock.
  select candidate.company_id
    into v_company_id
    from public.opportunity_conversion_notification_deliveries candidate
   where (
     (
       candidate.state in ('pending', 'failed')
       and candidate.available_at <= now()
       and candidate.attempts < candidate.max_attempts
     )
     or (
       candidate.state = 'processing'
       and candidate.lease_expires_at <= now()
     )
   )
   order by
     case
       when candidate.state = 'processing' then candidate.lease_expires_at
       else candidate.available_at
     end,
     candidate.event_created_at,
     candidate.id
   limit 1;

  if not found then
    return;
  end if;

  perform private.lock_lead_assignment_company(v_company_id);
  select company.deleted_at
    into v_company_deleted_at
    from public.companies company
   where company.id = v_company_id
   for share;
  v_company_exists := found;

  select candidate.*
    into delivery
    from public.opportunity_conversion_notification_deliveries candidate
   where candidate.company_id = v_company_id
     and (
       (
         candidate.state in ('pending', 'failed')
         and candidate.available_at <= now()
         and candidate.attempts < candidate.max_attempts
       )
       or (
         candidate.state = 'processing'
         and candidate.lease_expires_at <= now()
       )
     )
   order by
     case
       when candidate.state = 'processing' then candidate.lease_expires_at
       else candidate.available_at
     end,
     candidate.event_created_at,
     candidate.id
   for update of candidate skip locked
   limit 1;

  if not found then
    return;
  end if;

  if delivery.state = 'processing'
     and delivery.attempts >= delivery.max_attempts
  then
    update public.opportunity_conversion_notification_deliveries row
       set state = 'failed',
           claimed_at = null,
           claimed_by = null,
           lease_token = null,
           lease_expires_at = null,
           push_state = 'failed',
           disposition = 'terminal_failure',
           available_at = 'infinity'::timestamptz,
           terminal_at = now(),
           last_error = coalesce(
             row.last_error,
             'lease expired after maximum attempts'
           ),
           updated_at = now()
     where row.id = delivery.id;

    return query values (
      delivery.id,
      null::uuid,
      delivery.conversion_event_id,
      delivery.company_id,
      delivery.opportunity_id,
      delivery.project_id,
      delivery.recipient_user_id,
      delivery.actor_user_id,
      delivery.notification_id,
      'Lead converted to project'::text,
      null::text,
      false,
      false,
      'terminal_failure'::text
    );
    return;
  end if;

  select event.* into event_row
  from public.opportunity_conversion_events event
  where event.id = delivery.conversion_event_id;

  select opportunity_row.* into opportunity
  from public.opportunities opportunity_row
  where opportunity_row.id = delivery.opportunity_id
  for share;

  select project_row.* into project
  from public.projects project_row
  where project_row.id = delivery.project_id
  for share;

  select recipient.* into user_row
  from public.users recipient
  where recipient.id = delivery.recipient_user_id
  for share;

  select preferences.* into preference
  from public.notification_preferences preferences
  where preferences.user_id = delivery.recipient_user_id
    and preferences.company_id = delivery.company_id
  for share;

  v_disposition := null;
  if event_row.id is null
     or event_row.event_type <> 'converted_to_project'
     or event_row.company_id is distinct from delivery.company_id
     or event_row.opportunity_id is distinct from delivery.opportunity_id
     or event_row.project_id is distinct from delivery.project_id
     or event_row.actor_user_id is distinct from delivery.actor_user_id
     or event_row.assignment_version is distinct from delivery.assignment_version
     or event_row.created_at is distinct from delivery.event_created_at
     or opportunity.id is null
     or opportunity.company_id is distinct from delivery.company_id
     or opportunity.project_ref is distinct from delivery.project_id
     or project.id is null
     or project.company_id is distinct from delivery.company_id
     or project.opportunity_ref is distinct from delivery.opportunity_id
     or opportunity.deleted_at is not null
     or project.deleted_at is not null
  then
    v_disposition := 'stale';
  elsif not v_company_exists
     or v_company_deleted_at is not null
     or user_row.id is null
     or user_row.company_id is distinct from delivery.company_id
     or user_row.deleted_at is not null
     or not coalesce(user_row.is_active, false)
     or not private.user_can_view_opportunity(
       delivery.recipient_user_id,
       delivery.opportunity_id
     )
  then
    v_disposition := 'inaccessible';
  end if;

  if v_disposition is not null then
    if delivery.notification_id is not null then
      update public.notifications notification
         set is_read = true,
             resolved_at = now(),
             resolution_reason = 'conversion_delivery_suppressed'
       where notification.id = delivery.notification_id
         and notification.dedupe_key =
           'conversion-notification-delivery:' || delivery.id::text;
    end if;

    update public.opportunity_conversion_notification_deliveries row
       set state = 'delivered',
           attempts = row.attempts + 1,
           claimed_at = null,
           claimed_by = null,
           lease_token = null,
           lease_expires_at = null,
           push_state = 'suppressed',
           disposition = v_disposition,
           delivered_at = now(),
           terminal_at = null,
           last_error = case v_disposition
             when 'stale' then 'suppressed stale conversion delivery'
             else 'suppressed conversion delivery for inaccessible recipient'
           end,
           updated_at = now()
     where row.id = delivery.id;

    return query values (
      delivery.id,
      null::uuid,
      delivery.conversion_event_id,
      delivery.company_id,
      delivery.opportunity_id,
      delivery.project_id,
      delivery.recipient_user_id,
      delivery.actor_user_id,
      delivery.notification_id,
      coalesce(nullif(btrim(opportunity.title), ''), 'Lead converted to project'),
      null::text,
      false,
      false,
      v_disposition
    );
    return;
  end if;

  v_preference_push := preference.channel_preferences #> '{project_updates,push}';
  v_wants_push := case
    when jsonb_typeof(v_preference_push) = 'boolean'
      then (v_preference_push #>> '{}')::boolean
    else true
  end;

  v_lead_title := coalesce(
    nullif(btrim(opportunity.title), ''),
    'Lead converted to project'
  );
  v_notification_body := left(v_lead_title || ' is now a project.', 140);
  v_project_accessible := private.user_can_view_project(
    delivery.recipient_user_id,
    delivery.project_id
  );

  if v_project_accessible then
    v_destination := 'project';
    v_action_url := '/dashboard?openProject=' || delivery.project_id::text || '&mode=view';
    v_action_label := 'View Project';
    v_project_id := delivery.project_id::text;
    v_deep_link_type := 'project';
  else
    v_destination := 'lead';
    v_action_url := '/pipeline?opportunityId=' || delivery.opportunity_id::text;
    v_action_label := 'View lead';
    v_project_id := null;
    v_deep_link_type := 'lead';
  end if;

  v_dedupe_key := 'conversion-notification-delivery:' || delivery.id::text;
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
    delivery.recipient_user_id::text,
    delivery.company_id::text,
    'lead_converted',
    'Lead converted',
    v_notification_body,
    false,
    false,
    v_action_url,
    v_action_label,
    v_project_id,
    v_deep_link_type,
    v_dedupe_key
  )
  on conflict do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select notification.id into v_notification_id
    from public.notifications notification
    where notification.dedupe_key = v_dedupe_key
      and notification.user_id = delivery.recipient_user_id::text
      and notification.company_id = delivery.company_id::text
      and notification.type = 'lead_converted';
  end if;

  if v_notification_id is null then
    raise exception 'conversion notification could not be materialized'
      using errcode = '55000';
  end if;

  v_should_push := v_wants_push and coalesce(preference.push_enabled, true);
  v_lease_token := gen_random_uuid();

  update public.opportunity_conversion_notification_deliveries row
     set state = 'processing',
         attempts = row.attempts + 1,
         claimed_at = now(),
         claimed_by = p_worker_id,
         lease_token = v_lease_token,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         notification_id = v_notification_id,
         destination = v_destination,
         disposition = null,
         push_state = 'pending',
         terminal_at = null,
         last_error = null,
         updated_at = now()
   where row.id = delivery.id;

  return query values (
    delivery.id,
    v_lease_token,
    delivery.conversion_event_id,
    delivery.company_id,
    delivery.opportunity_id,
    delivery.project_id,
    delivery.recipient_user_id,
    delivery.actor_user_id,
    v_notification_id,
    v_lead_title,
    v_destination,
    v_should_push,
    true,
    'notified'::text
  );
end;
$function$;

create or replace function public.complete_opportunity_conversion_notification_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_push_state text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  delivery public.opportunity_conversion_notification_deliveries%rowtype;
  event_row public.opportunity_conversion_events%rowtype;
  opportunity public.opportunities%rowtype;
  project public.projects%rowtype;
  user_row public.users%rowtype;
  v_company_id uuid;
  v_company_deleted_at timestamptz;
  v_company_exists boolean;
  v_dedupe_key text;
  expected_action_url text;
  expected_deep_link text;
  expected_project_id text;
  inaccessible boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_delivery_id is null or p_lease_token is null
     or p_push_state not in ('sent', 'suppressed')
  then
    raise exception 'invalid conversion delivery completion arguments'
      using errcode = '22023';
  end if;

  select row.company_id into v_company_id
  from public.opportunity_conversion_notification_deliveries row
  where row.id = p_delivery_id;

  if not found then
    raise exception 'conversion notification delivery not found'
      using errcode = 'P0002';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);
  select company.deleted_at
  into v_company_deleted_at
  from public.companies company
  where company.id = v_company_id
  for share;
  v_company_exists := found;

  select row.* into delivery
  from public.opportunity_conversion_notification_deliveries row
  where row.id = p_delivery_id
    and row.company_id = v_company_id
  for update;

  if not found then
    raise exception 'conversion notification delivery not found'
      using errcode = 'P0002';
  end if;
  if delivery.state <> 'processing'
     or delivery.lease_token is distinct from p_lease_token
     or delivery.lease_expires_at <= now()
  then
    raise exception 'conversion notification delivery lease is no longer active'
      using errcode = '55000';
  end if;

  select event.* into event_row
  from public.opportunity_conversion_events event
  where event.id = delivery.conversion_event_id;
  select opportunity_row.* into opportunity
  from public.opportunities opportunity_row
  where opportunity_row.id = delivery.opportunity_id
  for share;
  select project_row.* into project
  from public.projects project_row
  where project_row.id = delivery.project_id
  for share;
  select recipient.* into user_row
  from public.users recipient
  where recipient.id = delivery.recipient_user_id
  for share;

  inaccessible := not v_company_exists
    or v_company_deleted_at is not null
    or event_row.id is null
    or event_row.company_id is distinct from delivery.company_id
    or event_row.opportunity_id is distinct from delivery.opportunity_id
    or event_row.project_id is distinct from delivery.project_id
    or event_row.actor_user_id is distinct from delivery.actor_user_id
    or event_row.assignment_version is distinct from delivery.assignment_version
    or event_row.created_at is distinct from delivery.event_created_at
    or opportunity.id is null
    or opportunity.company_id is distinct from delivery.company_id
    or opportunity.project_ref is distinct from delivery.project_id
    or opportunity.deleted_at is not null
    or project.id is null
    or project.company_id is distinct from delivery.company_id
    or project.opportunity_ref is distinct from delivery.opportunity_id
    or project.deleted_at is not null
    or user_row.id is null
    or user_row.company_id is distinct from delivery.company_id
    or user_row.deleted_at is not null
    or not coalesce(user_row.is_active, false)
    or not private.user_can_view_opportunity(
      delivery.recipient_user_id,
      delivery.opportunity_id
    )
    or (
      delivery.destination = 'project'
      and not private.user_can_view_project(
        delivery.recipient_user_id,
        delivery.project_id
      )
    );

  v_dedupe_key := 'conversion-notification-delivery:' || delivery.id::text;
  if delivery.destination = 'project' then
    expected_action_url := '/dashboard?openProject=' || delivery.project_id::text || '&mode=view';
    expected_deep_link := 'project';
    expected_project_id := delivery.project_id::text;
  elsif delivery.destination = 'lead' then
    expected_action_url := '/pipeline?opportunityId=' || delivery.opportunity_id::text;
    expected_deep_link := 'lead';
    expected_project_id := null;
  else
    raise exception 'conversion notification destination is missing'
      using errcode = '55000';
  end if;

  if delivery.notification_id is null
     or not exists (
       select 1
       from public.notifications notification
       where notification.id = delivery.notification_id
         and notification.user_id = delivery.recipient_user_id::text
         and notification.company_id = delivery.company_id::text
         and notification.type = 'lead_converted'
         and notification.title = 'Lead converted'
         and notification.persistent is false
         and notification.action_url = expected_action_url
         and notification.deep_link_type = expected_deep_link
         and notification.project_id is not distinct from expected_project_id
         and notification.dedupe_key = v_dedupe_key
     )
  then
    raise exception 'conversion notification proof is missing'
      using errcode = '55000';
  end if;

  if inaccessible then
    update public.notifications notification
       set is_read = true,
           resolved_at = now(),
           resolution_reason = 'conversion_delivery_suppressed'
     where notification.id = delivery.notification_id
       and notification.dedupe_key = v_dedupe_key;

    update public.opportunity_conversion_notification_deliveries row
       set state = 'delivered',
           claimed_at = null,
           claimed_by = null,
           lease_token = null,
           lease_expires_at = null,
           push_state = p_push_state,
           disposition = 'inaccessible',
           delivered_at = now(),
           terminal_at = null,
           last_error = 'recipient access changed before delivery completion',
           updated_at = now()
     where row.id = p_delivery_id;

    return jsonb_build_object(
      'ok', true,
      'delivery_id', p_delivery_id,
      'notification_id', delivery.notification_id,
      'suppressed', true,
      'push_state', p_push_state
    );
  end if;

  update public.opportunity_conversion_notification_deliveries row
     set state = 'delivered',
         claimed_at = null,
         claimed_by = null,
         lease_token = null,
         lease_expires_at = null,
         push_state = p_push_state,
         disposition = 'notified',
         delivered_at = now(),
         terminal_at = null,
         last_error = null,
         updated_at = now()
   where row.id = p_delivery_id;

  return jsonb_build_object(
    'ok', true,
    'delivery_id', p_delivery_id,
    'notification_id', delivery.notification_id,
    'suppressed', false,
    'push_state', p_push_state
  );
end;
$function$;

create or replace function public.fail_opportunity_conversion_notification_delivery(
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
  delivery public.opportunity_conversion_notification_deliveries%rowtype;
  v_company_id uuid;
  terminal boolean;
  backoff_seconds integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_delivery_id is null or p_lease_token is null then
    raise exception 'delivery id and lease token are required'
      using errcode = '22023';
  end if;

  select row.company_id into v_company_id
  from public.opportunity_conversion_notification_deliveries row
  where row.id = p_delivery_id;

  if not found then
    raise exception 'conversion notification delivery lease is no longer active'
      using errcode = '55000';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);
  perform 1
  from public.companies company
  where company.id = v_company_id
  for share;

  select row.* into delivery
  from public.opportunity_conversion_notification_deliveries row
  where row.id = p_delivery_id
    and row.company_id = v_company_id
  for update;

  if not found
     or delivery.state <> 'processing'
     or delivery.lease_token is distinct from p_lease_token
     or delivery.lease_expires_at <= now()
  then
    raise exception 'conversion notification delivery lease is no longer active'
      using errcode = '55000';
  end if;

  terminal := not coalesce(p_retryable, true)
    or delivery.attempts >= delivery.max_attempts;
  backoff_seconds := least(
    900,
    15 * power(2, least(delivery.attempts, 6))::integer
  );

  update public.opportunity_conversion_notification_deliveries row
     set state = 'failed',
         claimed_at = null,
         claimed_by = null,
         lease_token = null,
         lease_expires_at = null,
         push_state = case when terminal then 'failed' else 'pending' end,
         disposition = case when terminal then 'terminal_failure' else null end,
         available_at = case
           when terminal then 'infinity'::timestamptz
           else now() + make_interval(secs => backoff_seconds)
         end,
         terminal_at = case when terminal then now() else null end,
         last_error = left(coalesce(nullif(p_error, ''), 'Unknown delivery failure'), 2000),
         updated_at = now()
   where row.id = p_delivery_id;

  return jsonb_build_object(
    'ok', true,
    'delivery_id', p_delivery_id,
    'terminal', terminal,
    'attempts', delivery.attempts
  );
end;
$function$;

revoke all on function public.claim_opportunity_conversion_notification_deliveries(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_opportunity_conversion_notification_delivery(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_opportunity_conversion_notification_delivery(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_opportunity_conversion_notification_deliveries(uuid, integer) to service_role;
grant execute on function public.complete_opportunity_conversion_notification_delivery(uuid, uuid, text) to service_role;
grant execute on function public.fail_opportunity_conversion_notification_delivery(uuid, uuid, text, boolean) to service_role;

commit;
