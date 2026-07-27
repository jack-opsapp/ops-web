begin;

-- Public lead-field provenance remains editable by assigned operators. It is
-- valuable audit context, but cannot authorize provider work. This private,
-- append-only record is written only by the service ingestion boundary after
-- it has re-proved the exact parser fact, activity, mailbox, and lead.
create table private.email_contact_form_recipient_attestations (
  source_activity_id uuid primary key
    references public.activities(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  opportunity_id uuid not null
    references public.opportunities(id) on delete restrict,
  connection_id uuid not null
    references public.email_connections(id) on delete restrict,
  provider_message_id text not null check (btrim(provider_message_id) <> ''),
  provider_thread_id text not null check (btrim(provider_thread_id) <> ''),
  canonical_recipient text not null check (
    canonical_recipient = lower(btrim(canonical_recipient))
    and canonical_recipient ~
      '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  provenance_source text not null default 'contact_form'
    check (provenance_source = 'contact_form'),
  attested_by_role text not null default 'service_role'
    check (attested_by_role = 'service_role'),
  created_at timestamptz not null default now(),
  unique (company_id, connection_id, provider_message_id)
);

alter table private.email_contact_form_recipient_attestations
  enable row level security;
revoke all on table private.email_contact_form_recipient_attestations
  from public, anon, authenticated, service_role;

create or replace function private.reject_email_contact_form_recipient_attestation_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'contact_form_recipient_attestation_immutable'
    using errcode = '55000';
end;
$function$;

revoke all on function private.reject_email_contact_form_recipient_attestation_mutation()
  from public, anon, authenticated, service_role;

create trigger email_contact_form_recipient_attestation_immutable
before update or delete on private.email_contact_form_recipient_attestations
for each row
execute function private.reject_email_contact_form_recipient_attestation_mutation();

-- Contact-form ingestion normally persists the parsed submitter as the
-- activity's effective sender. Older/recovered notification rows may retain
-- the internal forwarding mailbox instead. Resolve the draft recipient from
-- the lead, never from that transport sender, and accept the wrapper only when
-- service ingestion attested the parser fact against this exact activity.
create or replace function private.email_assignment_contact_form_draft_canonical_recipient(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_source_activity_id uuid,
  p_connection_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_opportunity_email text;
  v_client_email text;
  v_client_id uuid;
  v_client_ref uuid;
  v_legacy_client_id uuid;
  v_source_sender text;
  v_canonical_email text;
begin
  if p_company_id is null
     or p_opportunity_id is null
     or p_source_activity_id is null
     or p_connection_id is null
     or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or nullif(btrim(coalesce(p_provider_thread_id, '')), '') is null then
    return null;
  end if;

  select
    nullif(lower(btrim(coalesce(opportunity.contact_email, ''))), ''),
    nullif(lower(btrim(coalesce(client.email, ''))), ''),
    client.id,
    opportunity.client_ref,
    opportunity.client_id,
    nullif(lower(btrim(coalesce(activity.from_email, ''))), '')
    into
      v_opportunity_email,
      v_client_email,
      v_client_id,
      v_client_ref,
      v_legacy_client_id,
      v_source_sender
  from public.opportunities opportunity
  join public.activities activity
    on activity.id = p_source_activity_id
   and activity.company_id = p_company_id
   and activity.opportunity_id = p_opportunity_id
   and activity.email_connection_id = p_connection_id
   and activity.email_message_id = p_provider_message_id
   and activity.email_thread_id = p_provider_thread_id
   and activity.type = 'email'
   and activity.direction = 'inbound'
   and not coalesce(activity.match_needs_review, false)
   and nullif(btrim(coalesce(activity.from_email, '')), '') is not null
   and nullif(btrim(coalesce(activity.body_text, '')), '') is not null
  left join public.clients client
    on client.id = coalesce(opportunity.client_ref, opportunity.client_id)
   and client.company_id = p_company_id
   and client.deleted_at is null
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id;
  if not found then
    return null;
  end if;

  if v_client_ref is not null
     and v_legacy_client_id is not null
     and v_client_ref <> v_legacy_client_id then
    return null;
  end if;

  -- Opportunity identity is authoritative. The active linked client is only a
  -- fallback when the opportunity email is blank; disagreement fails closed.
  if v_opportunity_email is not null
     and v_opportunity_email !~
       '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return null;
  end if;
  if v_client_email is not null
     and v_client_email !~
       '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return null;
  end if;
  if v_opportunity_email is not null
     and v_client_email is not null
     and v_opportunity_email <> v_client_email then
    return null;
  end if;

  v_canonical_email := coalesce(v_opportunity_email, v_client_email);
  if v_canonical_email is null
     or v_canonical_email !~
       '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or v_source_sender is null
     or v_source_sender !~
       '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return null;
  end if;

  -- Modern ingestion has already replaced a trusted wrapper with the parsed
  -- submitter. Preserve that exact, already-deployed proof path.
  if v_source_sender = v_canonical_email then
    return v_canonical_email;
  end if;

  -- A retained wrapper is accepted only with immutable service attestation for
  -- this exact activity, connection, lead, provider identity, and recipient.
  -- Editable public provenance is deliberately never an authorization input.
  if exists (
    select 1
    from private.email_contact_form_recipient_attestations attestation
    where attestation.source_activity_id = p_source_activity_id
      and attestation.company_id = p_company_id
      and attestation.opportunity_id = p_opportunity_id
      and attestation.connection_id = p_connection_id
      and attestation.provider_message_id = p_provider_message_id
      and attestation.provider_thread_id = p_provider_thread_id
      and attestation.canonical_recipient = v_canonical_email
  ) then
    return v_canonical_email;
  end if;

  return null;
end;
$function$;

revoke all on function private.email_assignment_contact_form_draft_canonical_recipient(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated, service_role;

-- Rebuild enqueue with every existing event, assignment, mailbox, activity,
-- source-key, and reply guard intact. Only recipient derivation changes.
create or replace function private.enqueue_email_assignment_contact_form_draft(
  p_assignment_event_id uuid,
  p_source_activity_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  event public.opportunity_assignment_events%rowtype;
  opportunity public.opportunities%rowtype;
  activity public.activities%rowtype;
  connection public.email_connections%rowtype;
  client public.clients%rowtype;
  user_row public.users%rowtype;
  v_match text[];
  v_connection_id uuid;
  v_provider_message_id text;
  v_actor_user_id uuid;
  v_customer_email text;
  v_customer_name text;
begin
  select assignment_event.* into event
  from public.opportunity_assignment_events assignment_event
  where assignment_event.id = p_assignment_event_id;
  if not found or event.new_assignee_id is null then
    return;
  end if;

  v_actor_user_id := event.new_assignee_id;

  select opportunity_row.* into opportunity
  from public.opportunities opportunity_row
  where opportunity_row.id = event.opportunity_id
    and opportunity_row.company_id = event.company_id
    and opportunity_row.assigned_to = event.new_assignee_id
    and opportunity_row.assignment_version = event.assignment_version
    and opportunity_row.deleted_at is null
    and opportunity_row.archived_at is null
    and opportunity_row.stage not in ('won', 'lost', 'discarded')
    and opportunity_row.source::text = 'email';
  if not found then
    return;
  end if;

  -- A verified current event may invalidate older work. The event/version
  -- equality above prevents delayed future rendezvous from staling the current
  -- assignment.
  update public.email_assignment_contact_form_draft_queue queue
     set status = case
           when queue.provider_create_started_at is not null then
             'reconciliation_required'
           else 'stale'
         end,
         lease_holder = null,
         lease_expires_at = null,
         completed_at = case
           when queue.provider_create_started_at is not null then now()
           else null
         end,
         result_reason = case
           when queue.provider_create_started_at is not null then
             'provider_reconciliation_required'
           else null
         end,
         last_error = 'assignment superseded',
         updated_at = now()
   where queue.opportunity_id = event.opportunity_id
     and queue.assignment_version <> event.assignment_version
     and queue.status in ('pending', 'processing', 'retrying');

  if opportunity.source_thread_key is null
     or opportunity.source_thread_key !~
       '^email:[^:]+:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}:message:.+$'
  then
    return;
  end if;
  v_match := regexp_match(
    opportunity.source_thread_key,
    '^email:([^:]+):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}):message:(.+)$'
  );
  if v_match is null or array_length(v_match, 1) <> 3 then
    return;
  end if;
  v_connection_id := v_match[2]::uuid;
  v_provider_message_id := btrim(v_match[3]);

  select connection_row.* into connection
  from public.email_connections connection_row
  where connection_row.id = v_connection_id
    and connection_row.company_id = opportunity.company_id::text
    and lower(connection_row.provider::text) = lower(v_match[1])
    and connection_row.status = 'active'
    and coalesce(connection_row.sync_enabled, false)
    and connection_row.type::text in ('company', 'individual');
  if not found then
    return;
  end if;

  select user_record.* into user_row
  from public.users user_record
  where user_record.id = v_actor_user_id
    and user_record.company_id = opportunity.company_id
    and user_record.deleted_at is null
    and coalesce(user_record.is_active, false);
  if not found then
    return;
  end if;

  if connection.type::text = 'individual'
     and connection.user_id is distinct from v_actor_user_id::text then
    return;
  elsif connection.type::text <> 'company'
     and connection.type::text <> 'individual' then
    return;
  end if;

  select activity_row.* into activity
  from public.activities activity_row
  where (p_source_activity_id is null or activity_row.id = p_source_activity_id)
    and activity_row.company_id = opportunity.company_id
    and activity_row.opportunity_id = opportunity.id
    and activity_row.email_connection_id = v_connection_id
    and activity_row.email_message_id = v_provider_message_id
    and activity_row.type = 'email'
    and activity_row.direction = 'inbound'
    and not coalesce(activity_row.match_needs_review, false)
    and nullif(btrim(coalesce(activity_row.email_thread_id, '')), '') is not null
    and nullif(btrim(coalesce(activity_row.from_email, '')), '') is not null
    and nullif(btrim(coalesce(activity_row.body_text, '')), '') is not null
  order by activity_row.created_at asc, activity_row.id asc
  limit 1;
  if not found then
    return;
  end if;

  select client_row.* into client
  from public.clients client_row
  where client_row.id = coalesce(opportunity.client_ref, opportunity.client_id)
    and client_row.company_id = opportunity.company_id
    and client_row.deleted_at is null;

  v_customer_email :=
    private.email_assignment_contact_form_draft_canonical_recipient(
      opportunity.company_id,
      opportunity.id,
      activity.id,
      connection.id,
      v_provider_message_id,
      btrim(activity.email_thread_id)
    );
  if v_customer_email is null then
    return;
  end if;

  v_customer_name := coalesce(
    nullif(btrim(opportunity.contact_name), ''),
    nullif(btrim(client.name), '')
  );
  if private.email_assignment_contact_form_draft_has_reply(
    opportunity.company_id,
    opportunity.id,
    connection.id,
    activity.created_at,
    v_customer_email
  ) then
    return;
  end if;

  insert into public.email_assignment_contact_form_draft_queue (
    assignment_event_id,
    company_id,
    opportunity_id,
    assignment_version,
    actor_user_id,
    connection_id,
    source_activity_id,
    provider_message_id,
    source_provider_thread_id,
    customer_email,
    customer_name,
    source_subject,
    source_body_text
  ) values (
    event.id,
    opportunity.company_id,
    opportunity.id,
    event.assignment_version,
    v_actor_user_id,
    connection.id,
    activity.id,
    v_provider_message_id,
    btrim(activity.email_thread_id),
    v_customer_email,
    v_customer_name,
    coalesce(activity.subject, ''),
    activity.body_text
  )
  on conflict (assignment_event_id) do nothing;
end;
$function$;

revoke all on function private.enqueue_email_assignment_contact_form_draft(
  uuid,
  uuid
) from public, anon, authenticated, service_role;

-- The sync service calls this only after it has parsed a real contact-form
-- submitter and persisted the exact inbound activity. The RPC independently
-- re-proves every supplied identity, snapshots the parser provenance into an
-- immutable private row, then retries the assignment/activity rendezvous.
create or replace function public.attest_email_contact_form_recipient_as_system(
  p_source_activity_id uuid,
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_parsed_recipient text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_opportunity_email text;
  v_client_email text;
  v_client_ref uuid;
  v_legacy_client_id uuid;
  v_canonical_email text;
  v_assignment_event_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if p_source_activity_id is null
     or p_company_id is null
     or p_opportunity_id is null
     or p_connection_id is null
     or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or nullif(btrim(coalesce(p_provider_thread_id, '')), '') is null
     or nullif(lower(btrim(coalesce(p_parsed_recipient, ''))), '') is null then
    raise exception 'contact_form_recipient_attestation_invalid'
      using errcode = '22023';
  end if;

  select
    nullif(lower(btrim(coalesce(opportunity.contact_email, ''))), ''),
    nullif(lower(btrim(coalesce(client.email, ''))), ''),
    opportunity.client_ref,
    opportunity.client_id
    into
      v_opportunity_email,
      v_client_email,
      v_client_ref,
      v_legacy_client_id
  from public.activities activity
  join public.opportunities opportunity
    on opportunity.id = p_opportunity_id
   and opportunity.company_id = p_company_id
   and opportunity.deleted_at is null
   and opportunity.archived_at is null
   and opportunity.stage not in ('won', 'lost', 'discarded')
   and opportunity.source::text = 'email'
  join public.email_connections connection
    on connection.id = p_connection_id
   and connection.company_id = p_company_id::text
   and connection.status = 'active'
   and coalesce(connection.sync_enabled, false)
   and connection.type::text in ('company', 'individual')
  left join public.clients client
    on client.id = coalesce(opportunity.client_ref, opportunity.client_id)
   and client.company_id = p_company_id
   and client.deleted_at is null
  where activity.id = p_source_activity_id
    and activity.company_id = p_company_id
    and activity.opportunity_id = p_opportunity_id
    and activity.email_connection_id = p_connection_id
    and activity.email_message_id = p_provider_message_id
    and activity.email_thread_id = p_provider_thread_id
    and activity.type = 'email'
    and activity.direction = 'inbound'
    and not coalesce(activity.match_needs_review, false)
    and nullif(btrim(coalesce(activity.from_email, '')), '') is not null
    and nullif(btrim(coalesce(activity.body_text, '')), '') is not null
  for update of opportunity;
  if not found then
    return false;
  end if;

  if v_client_ref is not null
     and v_legacy_client_id is not null
     and v_client_ref <> v_legacy_client_id then
    return false;
  end if;
  if v_opportunity_email is not null
     and v_opportunity_email !~
       '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return false;
  end if;
  if v_client_email is not null
     and v_client_email !~
       '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return false;
  end if;
  if v_opportunity_email is not null
     and v_client_email is not null
     and v_opportunity_email <> v_client_email then
    return false;
  end if;

  v_canonical_email := coalesce(v_opportunity_email, v_client_email);
  if v_canonical_email is null
     or v_canonical_email !~
       '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or lower(btrim(p_parsed_recipient)) <> v_canonical_email then
    return false;
  end if;

  insert into private.email_contact_form_recipient_attestations (
    source_activity_id,
    company_id,
    opportunity_id,
    connection_id,
    provider_message_id,
    provider_thread_id,
    canonical_recipient,
    provenance_source,
    attested_by_role
  ) values (
    p_source_activity_id,
    p_company_id,
    p_opportunity_id,
    p_connection_id,
    p_provider_message_id,
    p_provider_thread_id,
    v_canonical_email,
    'contact_form',
    'service_role'
  )
  on conflict do nothing;

  if not exists (
    select 1
    from private.email_contact_form_recipient_attestations attestation
    where attestation.source_activity_id = p_source_activity_id
      and attestation.company_id = p_company_id
      and attestation.opportunity_id = p_opportunity_id
      and attestation.connection_id = p_connection_id
      and attestation.provider_message_id = p_provider_message_id
      and attestation.provider_thread_id = p_provider_thread_id
      and attestation.canonical_recipient = v_canonical_email
      and attestation.provenance_source = 'contact_form'
      and attestation.attested_by_role = 'service_role'
  ) then
    raise exception 'contact_form_recipient_attestation_conflict'
      using errcode = '55000';
  end if;

  select assignment_event.id into v_assignment_event_id
  from public.opportunities opportunity
  join public.opportunity_assignment_events assignment_event
    on assignment_event.opportunity_id = opportunity.id
   and assignment_event.company_id = opportunity.company_id
   and assignment_event.assignment_version = opportunity.assignment_version
   and assignment_event.new_assignee_id = opportunity.assigned_to
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.assigned_to is not null
    and opportunity.deleted_at is null
    and opportunity.archived_at is null;

  if v_assignment_event_id is not null then
    perform private.enqueue_email_assignment_contact_form_draft(
      v_assignment_event_id,
      p_source_activity_id
    );
  end if;

  return true;
end;
$function$;

revoke all on function public.attest_email_contact_form_recipient_as_system(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.attest_email_contact_form_recipient_as_system(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
) to service_role;

-- This one helper is called by claim, prepare, explicit reauthorization,
-- provider-create reservation, and completion. Replacing it repeats the new
-- canonical/provenance proof at every existing provider boundary.
create or replace function private.email_assignment_contact_form_draft_authorized(
  p_queue_id uuid,
  p_require_customer_autonomy boolean
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.email_assignment_contact_form_draft_queue queue
    join public.opportunity_assignment_events event
      on queue.assignment_event_id = event.id
     and queue.company_id = event.company_id
     and queue.opportunity_id = event.opportunity_id
     and queue.assignment_version = event.assignment_version
     and queue.actor_user_id = event.new_assignee_id
    join public.opportunities opportunity
      on opportunity.id = queue.opportunity_id
     and opportunity.company_id = queue.company_id
     and opportunity.assigned_to = queue.actor_user_id
     and queue.assignment_version = opportunity.assignment_version
     and opportunity.deleted_at is null
     and opportunity.archived_at is null
     and opportunity.stage not in ('won', 'lost', 'discarded')
     and opportunity.source::text = 'email'
    join public.users user_row
      on user_row.id = queue.actor_user_id
     and user_row.company_id = queue.company_id
     and user_row.deleted_at is null
     and coalesce(user_row.is_active, false)
    join public.email_connections connection
      on queue.connection_id = connection.id
     and connection.company_id = queue.company_id::text
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
     and connection.type::text in ('company', 'individual')
    join public.activities activity
      on queue.source_activity_id = activity.id
     and activity.company_id = queue.company_id
     and activity.opportunity_id = opportunity.id
     and activity.email_connection_id = connection.id
     and activity.email_message_id = queue.provider_message_id
     and activity.email_thread_id = queue.source_provider_thread_id
     and activity.type = 'email'
     and activity.direction = 'inbound'
     and not coalesce(activity.match_needs_review, false)
     and nullif(btrim(coalesce(activity.from_email, '')), '') is not null
     and coalesce(activity.subject, '') = queue.source_subject
     and activity.body_text = queue.source_body_text
     and nullif(btrim(coalesce(activity.body_text, '')), '') is not null
    left join public.clients client
      on client.id = coalesce(opportunity.client_ref, opportunity.client_id)
     and client.company_id = queue.company_id
     and client.deleted_at is null
    where queue.id = p_queue_id
      and event.new_assignee_id is not null
      and event.new_assignee_id = queue.actor_user_id
      and opportunity.source_thread_key =
        'email:' || lower(connection.provider::text) || ':' ||
        connection.id::text || ':message:' || queue.provider_message_id
      and (
        lower(btrim(coalesce(opportunity.contact_email, ''))) =
          lower(btrim(queue.customer_email))
        or lower(btrim(coalesce(client.email, ''))) =
          lower(btrim(queue.customer_email))
      )
      and private.email_assignment_contact_form_draft_canonical_recipient(
        queue.company_id,
        queue.opportunity_id,
        queue.source_activity_id,
        queue.connection_id,
        queue.provider_message_id,
        queue.source_provider_thread_id
      ) = lower(btrim(queue.customer_email))
      and private.user_can_send_opportunity_inbox(
        queue.actor_user_id,
        opportunity.id,
        connection.id
      )
      and not private.email_assignment_contact_form_draft_has_reply(
        queue.company_id,
        queue.opportunity_id,
        queue.connection_id,
        activity.created_at,
        queue.customer_email
      )
      and (
        not p_require_customer_autonomy
        or coalesce(
          connection.auto_send_settings
            -> 'category_autonomy'
            ->> 'primary:CUSTOMER',
          'off'
        ) in ('auto_draft', 'auto_send', 'auto_follow_up')
      )
  );
$function$;

revoke all on function private.email_assignment_contact_form_draft_authorized(
  uuid,
  boolean
) from public, anon, authenticated, service_role;

-- Future guarded orphan recovery binds an existing inbound activity to its
-- lead with a NULL -> non-NULL opportunity update. Reuse the same exact-source
-- rendezvous for that transition; all other updates remain inert.
create or replace function private.queue_email_assignment_contact_form_draft_from_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment_event_id uuid;
begin
  if tg_op = 'UPDATE' then
    if old.opportunity_id is not null
       or new.opportunity_id is null
       or new.company_id is distinct from old.company_id
       or new.type is distinct from old.type
       or new.direction is distinct from old.direction
       or new.email_connection_id is distinct from old.email_connection_id
       or new.email_message_id is distinct from old.email_message_id
       or new.email_thread_id is distinct from old.email_thread_id
       or new.from_email is distinct from old.from_email
       or new.body_text is distinct from old.body_text then
      return new;
    end if;
  end if;

  if new.type is distinct from 'email'
     or new.direction is distinct from 'inbound'
     or new.opportunity_id is null
     or new.email_connection_id is null
     or nullif(btrim(coalesce(new.email_message_id, '')), '') is null
     or nullif(btrim(coalesce(new.email_thread_id, '')), '') is null
     or nullif(btrim(coalesce(new.from_email, '')), '') is null
     or nullif(btrim(coalesce(new.body_text, '')), '') is null
     or coalesce(new.match_needs_review, false) then
    return new;
  end if;

  select assignment_event.id into v_assignment_event_id
  from public.opportunities opportunity
  join public.opportunity_assignment_events assignment_event
    on assignment_event.opportunity_id = opportunity.id
   and assignment_event.company_id = opportunity.company_id
   and assignment_event.assignment_version = opportunity.assignment_version
   and assignment_event.new_assignee_id = opportunity.assigned_to
  where opportunity.id = new.opportunity_id
    and opportunity.company_id = new.company_id
    and opportunity.assigned_to is not null
    and opportunity.deleted_at is null
    and opportunity.archived_at is null;

  if v_assignment_event_id is not null then
    perform private.enqueue_email_assignment_contact_form_draft(
      v_assignment_event_id,
      new.id
    );
  end if;

  return new;
end;
$function$;

revoke all on function private.queue_email_assignment_contact_form_draft_from_activity()
  from public, anon, authenticated, service_role;

drop trigger if exists activities_assignment_contact_form_draft_queue
  on public.activities;
create trigger activities_assignment_contact_form_draft_queue
after insert or update of opportunity_id on public.activities
for each row
execute function private.queue_email_assignment_contact_form_draft_from_activity();

commit;
