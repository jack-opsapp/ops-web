begin;

-- Durable, private processing for external-intake quarantine objects.
-- This migration provisions no AWS resource, enables no company, and exposes
-- no browser-readable relation. Storage events and worker commands are
-- accepted only through fixed service-role functions.

do $prerequisites$
begin
  if to_regclass('private.external_intake_upload_intents') is null
    or to_regclass('private.external_intake_scan_slot_reservations') is null
    or to_regclass('private.external_intake_cleanup_reservations') is null
    or to_regprocedure(
      'private.require_external_api_service_role()'
    ) is null
    or to_regprocedure(
      'private.acquire_external_intake_scan_slot(uuid,integer)'
    ) is null
  then
    raise exception 'external_intake_attachment_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create table private.external_intake_object_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  intent_id uuid not null,
  provider_event_id text not null,
  event_identity_digest bytea not null,
  event_type text not null,
  storage_object_key text not null,
  object_version_id text not null,
  provider_sequencer text,
  occurred_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint external_intake_object_events_provider_event_key
    unique (provider_event_id),
  constraint external_intake_object_events_identity_key
    unique (event_identity_digest),
  constraint external_intake_object_events_intent_company_fkey
    foreign key (intent_id, company_id)
    references private.external_intake_upload_intents (id, company_id)
    on delete restrict,
  constraint external_intake_object_events_digest_check
    check (octet_length(event_identity_digest) = 32),
  constraint external_intake_object_events_type_check
    check (event_type in ('object_created', 'guardduty_result')),
  constraint external_intake_object_events_provider_id_check
    check (
      char_length(provider_event_id) between 1 and 512
      and provider_event_id !~ '[[:cntrl:]]'
    ),
  constraint external_intake_object_events_key_check
    check (
      storage_object_key ~ '^quarantine/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
      and storage_object_key !~ '[?#]'
      and storage_object_key !~ '(^|/)[.][.]?(/|$)'
    ),
  constraint external_intake_object_events_version_check
    check (
      char_length(object_version_id) between 1 and 1024
      and object_version_id !~ '[[:cntrl:]]'
    )
);

create index external_intake_object_events_unprocessed_idx
  on private.external_intake_object_events (occurred_at, id)
  where processed_at is null;

create table private.external_intake_guardduty_results (
  id uuid primary key default gen_random_uuid(),
  object_event_id uuid not null
    references private.external_intake_object_events (id) on delete restrict,
  company_id uuid not null,
  intent_id uuid not null,
  object_version_id text not null,
  guardduty_status text not null,
  scanned_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint external_intake_guardduty_event_key
    unique (object_event_id),
  constraint external_intake_guardduty_intent_company_fkey
    foreign key (intent_id, company_id)
    references private.external_intake_upload_intents (id, company_id)
    on delete restrict,
  constraint external_intake_guardduty_status_check
    check (
      guardduty_status in (
        'NO_THREATS_FOUND',
        'THREATS_FOUND',
        'UNSUPPORTED',
        'ACCESS_DENIED',
        'FAILED'
      )
    ),
  constraint external_intake_guardduty_version_check
    check (
      char_length(object_version_id) between 1 and 1024
      and object_version_id !~ '[[:cntrl:]]'
    )
);

create index external_intake_guardduty_intent_idx
  on private.external_intake_guardduty_results (
    intent_id,
    object_version_id,
    scanned_at desc
  );

create table private.external_intake_inspection_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  intent_id uuid not null,
  status text not null default 'pending',
  generation bigint not null default 0,
  attempts integer not null default 0,
  available_at timestamptz not null default statement_timestamp(),
  first_queued_at timestamptz not null default statement_timestamp(),
  deadline_at timestamptz not null
    default statement_timestamp() + interval '24 hours',
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_safe_code text,
  detected_content_type text,
  delivery_mode text,
  accepted_object_key text,
  accepted_object_version_id text,
  accepted_size_bytes bigint,
  accepted_checksum_sha256 bytea,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint external_intake_inspection_jobs_intent_key
    unique (intent_id),
  constraint external_intake_inspection_jobs_intent_company_fkey
    foreign key (intent_id, company_id)
    references private.external_intake_upload_intents (id, company_id)
    on delete restrict,
  constraint external_intake_inspection_jobs_status_check
    check (
      status in ('pending', 'processing', 'retrying', 'complete', 'failed')
    ),
  constraint external_intake_inspection_jobs_generation_check
    check (generation >= 0 and attempts >= 0),
  constraint external_intake_inspection_jobs_deadline_check
    check (
      deadline_at = first_queued_at + interval '24 hours'
    ),
  constraint external_intake_inspection_jobs_lease_check
    check (
      (
        status = 'processing'
        and lease_owner is not null
        and lease_token is not null
        and lease_expires_at is not null
        and lease_expires_at > updated_at
      )
      or (
        status <> 'processing'
        and lease_owner is null
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  constraint external_intake_inspection_jobs_safe_code_check
    check (
      last_safe_code is null
      or last_safe_code ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  constraint external_intake_inspection_jobs_delivery_mode_check
    check (
      delivery_mode is null
      or delivery_mode in ('attachment', 'inline_image')
    ),
  constraint external_intake_inspection_jobs_accepted_object_check
    check (
      (
        accepted_object_key is null
        and accepted_object_version_id is null
        and accepted_size_bytes is null
        and accepted_checksum_sha256 is null
        and delivery_mode is null
      )
      or (
        (
          (
            delivery_mode = 'attachment'
            and accepted_object_key
              ~ '^accepted-original/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
          )
          or (
            delivery_mode = 'inline_image'
            and accepted_object_key
              ~ '^safe-derivative/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
          )
        )
        and char_length(accepted_object_version_id) between 1 and 1024
        and accepted_size_bytes between 1 and 26214400
        and octet_length(accepted_checksum_sha256) = 32
      )
    )
);

create index external_intake_inspection_jobs_claim_idx
  on private.external_intake_inspection_jobs (
    available_at,
    first_queued_at,
    id
  )
  where status in ('pending', 'retrying', 'processing');

create table private.external_intake_delivery_objects (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null
    references private.external_intake_inspection_jobs (id) on delete restrict,
  intent_id uuid not null,
  company_id uuid not null,
  generation bigint not null,
  delivery_mode text not null,
  storage_object_key text not null,
  state text not null default 'staged',
  object_version_id text,
  size_bytes bigint,
  checksum_sha256 bytea,
  delete_not_before timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0,
  lease_generation bigint not null default 0,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_safe_code text,
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint external_intake_delivery_objects_job_generation_mode_key
    unique (inspection_id, generation, delivery_mode),
  constraint external_intake_delivery_objects_storage_key
    unique (storage_object_key),
  constraint external_intake_delivery_objects_intent_company_fkey
    foreign key (intent_id, company_id)
    references private.external_intake_upload_intents (id, company_id)
    on delete restrict,
  constraint external_intake_delivery_objects_generation_check
    check (generation > 0 and attempt_count >= 0 and lease_generation >= 0),
  constraint external_intake_delivery_objects_mode_check
    check (delivery_mode in ('attachment', 'inline_image')),
  constraint external_intake_delivery_objects_key_check
    check (
      (
        delivery_mode = 'attachment'
        and storage_object_key
          ~ '^accepted-original/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
      )
      or (
        delivery_mode = 'inline_image'
        and storage_object_key
          ~ '^safe-derivative/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
      )
    ),
  constraint external_intake_delivery_objects_state_check
    check (
      state in (
        'staged',
        'uploaded',
        'published',
        'delete_pending',
        'deleting',
        'deleted'
      )
    ),
  constraint external_intake_delivery_objects_evidence_check
    check (
      (
        object_version_id is null
        and size_bytes is null
        and checksum_sha256 is null
        and state = 'staged'
      )
      or (
        state in ('delete_pending', 'deleting', 'deleted')
        and size_bytes is null
        and checksum_sha256 is null
        and (
          object_version_id is null
          or (
            char_length(object_version_id) between 1 and 1024
            and object_version_id !~ '[[:cntrl:]]'
          )
        )
      )
      or (
        char_length(object_version_id) between 1 and 1024
        and size_bytes between 1 and 26214400
        and octet_length(checksum_sha256) = 32
        and state in (
          'uploaded',
          'published',
          'delete_pending',
          'deleting',
          'deleted'
        )
      )
    ),
  constraint external_intake_delivery_objects_lease_check
    check (
      (
        state = 'deleting'
        and lease_owner is not null
        and lease_token is not null
        and lease_expires_at is not null
      )
      or (
        state <> 'deleting'
        and lease_owner is null
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  constraint external_intake_delivery_objects_terminal_check
    check (
      (state = 'published' and published_at is not null and deleted_at is null)
      or (state = 'deleted' and deleted_at is not null)
      or (
        state not in ('published', 'deleted')
        and published_at is null
        and deleted_at is null
      )
    ),
  constraint external_intake_delivery_objects_safe_code_check
    check (
      last_safe_code is null
      or last_safe_code ~ '^[a-z][a-z0-9_]{0,63}$'
    )
);

create index external_intake_delivery_objects_cleanup_idx
  on private.external_intake_delivery_objects (
    state,
    delete_not_before,
    lease_expires_at,
    created_at
  )
  where state in ('staged', 'uploaded', 'delete_pending', 'deleting');

alter table private.external_intake_cleanup_reservations
  add column object_version_id text,
  add column lease_owner text,
  add column lease_token uuid;

alter table private.external_intake_cleanup_reservations
  add constraint external_intake_cleanup_object_version_check
  check (
    object_version_id is null
    or (
      char_length(object_version_id) between 1 and 1024
      and object_version_id !~ '[[:cntrl:]]'
    )
  ),
  add constraint external_intake_cleanup_lease_owner_check
  check (
    (
      state = 'leased'
      and lease_owner is not null
      and lease_token is not null
      and lease_expires_at is not null
    )
    or (
      state <> 'leased'
      and lease_owner is null
      and lease_token is null
      and lease_expires_at is null
    )
  );

-- Allow a durable inspection retry to reacquire the same company-scoped slot
-- after its prior lease expires. The exact intent remains pending_inspection;
-- no state is rewound and every reacquisition increments the slot generation.

create or replace function private.acquire_external_intake_scan_slot(
  p_intent_id uuid,
  p_lease_seconds integer
) returns table (
  slot_id uuid,
  generation bigint,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_slot private.external_intake_scan_slot_reservations%rowtype;
  v_active_count bigint;
begin
  if p_intent_id is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 900
  then
    raise exception 'external_intake_scan_slot_arguments_invalid'
      using errcode = '22023';
  end if;

  select intent.company_id
  into v_company_id
  from private.external_intake_upload_intents intent
  where intent.id = p_intent_id;

  if not found then
    raise exception 'external_intake_upload_not_found'
      using errcode = 'P0002';
  end if;

  insert into private.external_intake_company_quota_locks (
    company_id
  ) values (
    v_company_id
  )
  on conflict (company_id) do nothing;

  perform 1
  from private.external_intake_company_quota_locks quota
  where quota.company_id = v_company_id
  for update;

  update private.external_intake_scan_slot_reservations slot
  set status = 'released',
      released_at = clock_timestamp()
  where slot.company_id = v_company_id
    and slot.status = 'active'
    and slot.lease_expires_at <= clock_timestamp();

  select slot.*
  into v_slot
  from private.external_intake_scan_slot_reservations slot
  where slot.intent_id = p_intent_id
    and slot.company_id = v_company_id
  for update;

  if found
    and v_slot.status = 'active'
    and v_slot.lease_expires_at > clock_timestamp()
  then
    return query
    select v_slot.id, v_slot.generation, v_slot.lease_expires_at;
    return;
  end if;

  select count(*)
  into v_active_count
  from private.external_intake_scan_slot_reservations slot
  where slot.company_id = v_company_id
    and slot.status = 'active'
    and slot.lease_expires_at > clock_timestamp();

  if v_active_count >= 5 then
    raise exception 'external_intake_scan_slots_exhausted'
      using errcode = '53300';
  end if;

  perform 1
  from private.external_intake_upload_intents intent
  where intent.id = p_intent_id
    and intent.company_id = v_company_id
    and intent.state in ('uploaded', 'claimed', 'pending_inspection')
  for update;

  if not found then
    raise exception 'external_intake_upload_not_claimable'
      using errcode = '55000';
  end if;

  update private.external_intake_upload_intents intent
  set state = 'claimed'
  where intent.id = p_intent_id
    and intent.state = 'uploaded';

  if v_slot.id is null then
    insert into private.external_intake_scan_slot_reservations (
      company_id,
      intent_id,
      lease_expires_at
    ) values (
      v_company_id,
      p_intent_id,
      clock_timestamp() + make_interval(secs => p_lease_seconds)
    )
    returning * into v_slot;
  else
    update private.external_intake_scan_slot_reservations slot
    set generation = slot.generation + 1,
        status = 'active',
        acquired_at = clock_timestamp(),
        lease_expires_at =
          clock_timestamp() + make_interval(secs => p_lease_seconds),
        released_at = null
    where slot.id = v_slot.id
    returning * into v_slot;
  end if;

  return query
  select v_slot.id, v_slot.generation, v_slot.lease_expires_at;
end;
$function$;

create or replace function private.release_external_intake_processing_slot(
  p_intent_id uuid
) returns void
language sql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  update private.external_intake_scan_slot_reservations slot
  set status = 'released',
      released_at = clock_timestamp()
  where slot.intent_id = p_intent_id
    and slot.status = 'active';
$function$;

create or replace function private.release_external_intake_pending_object(
  p_intent_id uuid
) returns void
language sql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  update private.external_intake_pending_object_reservations reservation
  set status = 'released',
      released_at = clock_timestamp()
  where reservation.intent_id = p_intent_id
    and reservation.status = 'reserved';
$function$;

-- Provider event ingestion -------------------------------------------------

create or replace function public.record_external_intake_object_event_as_system(
  p_provider_event_id text,
  p_event_type text,
  p_storage_object_key text,
  p_object_version_id text,
  p_provider_sequencer text,
  p_observed_size_bytes bigint,
  p_observed_checksum_sha256 bytea,
  p_guardduty_status text,
  p_occurred_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_intent private.external_intake_upload_intents%rowtype;
  v_event private.external_intake_object_events%rowtype;
  v_event_digest bytea;
begin
  perform private.require_external_api_service_role();

  if p_provider_event_id is null
    or char_length(p_provider_event_id) not between 1 and 512
    or p_provider_event_id ~ '[[:cntrl:]]'
    or p_event_type not in ('object_created', 'guardduty_result')
    or p_storage_object_key is null
    or p_storage_object_key
      !~ '^quarantine/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
    or p_object_version_id is null
    or char_length(p_object_version_id) not between 1 and 1024
    or p_object_version_id ~ '[[:cntrl:]]'
    or (
      p_provider_sequencer is not null
      and p_provider_sequencer !~ '^[A-Fa-f0-9]{1,256}$'
    )
    or p_occurred_at is null
    or p_occurred_at > clock_timestamp() + interval '5 minutes'
    or (
      p_event_type = 'object_created'
      and (
        p_observed_size_bytes is null
        or p_observed_size_bytes not between 1 and 26214400
        or (
          p_observed_checksum_sha256 is not null
          and octet_length(p_observed_checksum_sha256) <> 32
        )
        or p_guardduty_status is not null
      )
    )
    or (
      p_event_type = 'guardduty_result'
      and (
        p_guardduty_status is null
        or p_guardduty_status not in (
          'NO_THREATS_FOUND',
          'THREATS_FOUND',
          'UNSUPPORTED',
          'ACCESS_DENIED',
          'FAILED'
        )
        or p_observed_size_bytes is not null
        or p_observed_checksum_sha256 is not null
      )
    )
  then
    raise exception 'external_intake_object_event_invalid'
      using errcode = '22023';
  end if;

  select event_row.*
  into v_event
  from private.external_intake_object_events event_row
  where event_row.provider_event_id = p_provider_event_id;

  if found then
    if v_event.event_type = p_event_type
      and v_event.storage_object_key = p_storage_object_key
      and v_event.object_version_id = p_object_version_id
    then
      return jsonb_build_object('status', 'replay');
    end if;
    raise exception 'external_intake_provider_event_conflict'
      using errcode = '23505';
  end if;

  select intent.*
  into v_intent
  from private.external_intake_upload_intents intent
  where intent.storage_object_key = p_storage_object_key
  for update;

  if not found then
    return jsonb_build_object('status', 'ignored');
  end if;

  v_event_digest := extensions.digest(
    convert_to(
      concat_ws(
        E'\n',
        p_event_type,
        p_storage_object_key,
        p_object_version_id,
        coalesce(p_provider_sequencer, ''),
        coalesce(p_guardduty_status, '')
      ),
      'utf8'
    ),
    'sha256'
  );

  insert into private.external_intake_object_events (
    company_id,
    intent_id,
    provider_event_id,
    event_identity_digest,
    event_type,
    storage_object_key,
    object_version_id,
    provider_sequencer,
    occurred_at,
    processed_at
  ) values (
    v_intent.company_id,
    v_intent.id,
    p_provider_event_id,
    v_event_digest,
    p_event_type,
    p_storage_object_key,
    p_object_version_id,
    nullif(p_provider_sequencer, ''),
    p_occurred_at,
    clock_timestamp()
  )
  on conflict do nothing
  returning * into v_event;

  if not found then
    select event_row.*
    into v_event
    from private.external_intake_object_events event_row
    where event_row.provider_event_id = p_provider_event_id
      or event_row.event_identity_digest = v_event_digest
    order by
      case
        when event_row.provider_event_id = p_provider_event_id then 0
        else 1
      end
    limit 1;

    if found
      and v_event.event_type = p_event_type
      and v_event.storage_object_key = p_storage_object_key
      and v_event.object_version_id = p_object_version_id
    then
      return jsonb_build_object('status', 'replay');
    end if;

    raise exception 'external_intake_provider_event_conflict'
      using errcode = '23505';
  end if;

  if p_event_type = 'guardduty_result' then
    insert into private.external_intake_guardduty_results (
      object_event_id,
      company_id,
      intent_id,
      object_version_id,
      guardduty_status,
      scanned_at
    ) values (
      v_event.id,
      v_intent.company_id,
      v_intent.id,
      p_object_version_id,
      p_guardduty_status,
      p_occurred_at
    );

    return jsonb_build_object('status', 'recorded');
  end if;

  if v_intent.object_version_id is not null
    and (
      v_intent.object_version_id <> p_object_version_id
      or v_intent.observed_size_bytes <> p_observed_size_bytes
      or v_intent.observed_checksum_sha256
        is distinct from p_observed_checksum_sha256
    )
  then
    raise exception 'external_intake_upload_object_conflict'
      using errcode = '23505';
  end if;

  if v_intent.object_version_id is null then
    update private.external_intake_upload_intents intent
    set object_version_id = p_object_version_id,
        observed_size_bytes = p_observed_size_bytes,
        observed_checksum_sha256 = p_observed_checksum_sha256,
        uploaded_at = p_occurred_at,
        state = case
          when intent.state = 'issued' then 'uploaded'
          else intent.state
        end
    where intent.id = v_intent.id;
  end if;

  update private.external_intake_rolling_byte_reservations reservation
  set status = 'consumed'
  where reservation.batch_id = v_intent.batch_id
    and reservation.status = 'reserved';

  if v_intent.state in ('issued', 'uploaded', 'claimed', 'pending_inspection') then
    insert into private.external_intake_inspection_jobs (
      company_id,
      intent_id,
      first_queued_at,
      deadline_at
    ) values (
      v_intent.company_id,
      v_intent.id,
      statement_timestamp(),
      statement_timestamp() + interval '24 hours'
    )
    on conflict (intent_id) do nothing;
  else
    insert into private.external_intake_cleanup_reservations (
      intent_id,
      company_id,
      storage_object_key,
      object_version_id,
      delete_not_before
    ) values (
      v_intent.id,
      v_intent.company_id,
      v_intent.storage_object_key,
      p_object_version_id,
      v_intent.delete_not_before
    )
    on conflict (intent_id) do update
      set object_version_id = excluded.object_version_id,
          updated_at = clock_timestamp()
      where private.external_intake_cleanup_reservations.state <> 'complete';
  end if;

  return jsonb_build_object('status', 'recorded');
end;
$function$;

-- Bounded inspection leasing ----------------------------------------------

create or replace function public.claim_external_intake_inspections_as_system(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
) returns table (
  id uuid,
  intent_id uuid,
  company_id uuid,
  object_key text,
  object_version_id text,
  filename text,
  declared_content_type text,
  expected_size_bytes bigint,
  expected_checksum_sha256 text,
  observed_size_bytes bigint,
  observed_checksum_sha256 text,
  guardduty_status text,
  first_queued_at timestamptz,
  deadline_at timestamptz,
  delete_not_before timestamptz,
  attempts integer,
  generation bigint,
  lease_token uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_candidate private.external_intake_inspection_jobs%rowtype;
  v_guardduty_status text;
  v_lease_token uuid;
begin
  perform private.require_external_api_service_role();

  if p_worker_id is null
    or char_length(p_worker_id) not between 1 and 128
    or p_worker_id !~ '^[A-Za-z0-9_.:-]+$'
    or p_limit is null
    or not (p_limit between 1 and 25)
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 900
  then
    raise exception 'external_intake_inspection_claim_invalid'
      using errcode = '22023';
  end if;

  for v_candidate in
    select job.*
    from private.external_intake_inspection_jobs job
    where (
        job.status in ('pending', 'retrying')
        and job.available_at <= clock_timestamp()
      )
      or (
        job.status = 'processing'
        and job.lease_expires_at <= clock_timestamp()
      )
    order by job.available_at, job.first_queued_at, job.id
    for update skip locked
    limit p_limit
  loop
    begin
      perform *
      from private.acquire_external_intake_scan_slot(
        v_candidate.intent_id,
        p_lease_seconds
      );
    exception
      when sqlstate '53300' then
        continue;
      when sqlstate '55000' then
        continue;
    end;

    v_lease_token := gen_random_uuid();

    update private.external_intake_inspection_jobs job
    set status = 'processing',
        generation = job.generation + 1,
        attempts = job.attempts + 1,
        lease_owner = p_worker_id,
        lease_token = v_lease_token,
        lease_expires_at =
          clock_timestamp() + make_interval(secs => p_lease_seconds),
        last_safe_code = null,
        updated_at = clock_timestamp()
    where job.id = v_candidate.id
    returning job.* into v_candidate;

    update private.external_intake_upload_intents intent
    set state = 'pending_inspection'
    where intent.id = v_candidate.intent_id
      and intent.state = 'claimed';

    select result.guardduty_status
    into v_guardduty_status
    from private.external_intake_guardduty_results result
    join private.external_intake_upload_intents intent
      on intent.id = result.intent_id
     and intent.company_id = result.company_id
    where result.intent_id = v_candidate.intent_id
      and result.object_version_id = intent.object_version_id
    order by
      case result.guardduty_status
        when 'THREATS_FOUND' then 0
        when 'NO_THREATS_FOUND' then 1
        else 2
      end,
      result.scanned_at desc,
      result.id
    limit 1;

    return query
    select
      v_candidate.id,
      intent.id,
      intent.company_id,
      intent.storage_object_key,
      intent.object_version_id,
      intent.original_filename,
      intent.declared_content_type,
      intent.expected_size_bytes,
      case
        when intent.expected_checksum_sha256 is null then null
        else encode(intent.expected_checksum_sha256, 'hex')
      end,
      intent.observed_size_bytes,
      case
        when intent.observed_checksum_sha256 is null then null
        else encode(intent.observed_checksum_sha256, 'hex')
      end,
      v_guardduty_status,
      v_candidate.first_queued_at,
      v_candidate.deadline_at,
      intent.delete_not_before,
      v_candidate.attempts,
      v_candidate.generation,
      v_candidate.lease_token
    from private.external_intake_upload_intents intent
    where intent.id = v_candidate.intent_id;
  end loop;
end;
$function$;

create or replace function public.stage_external_intake_delivery_as_system(
  p_inspection_id uuid,
  p_worker_id text,
  p_generation bigint,
  p_lease_token uuid,
  p_delivery_mode text,
  p_storage_object_key text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_job private.external_intake_inspection_jobs%rowtype;
  v_delivery private.external_intake_delivery_objects%rowtype;
begin
  perform private.require_external_api_service_role();

  if p_inspection_id is null
    or p_worker_id is null
    or p_generation is null
    or p_generation < 1
    or p_lease_token is null
    or p_delivery_mode not in ('attachment', 'inline_image')
    or p_storage_object_key is null
    or not (
      (
        p_delivery_mode = 'attachment'
        and p_storage_object_key
          ~ '^accepted-original/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
      )
      or (
        p_delivery_mode = 'inline_image'
        and p_storage_object_key
          ~ '^safe-derivative/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
      )
    )
  then
    raise exception 'external_intake_delivery_stage_invalid'
      using errcode = '22023';
  end if;

  select job.*
  into v_job
  from private.external_intake_inspection_jobs job
  where job.id = p_inspection_id
    and job.status = 'processing'
    and job.lease_owner = p_worker_id
    and job.generation = p_generation
    and job.lease_token = p_lease_token
  for update;

  if not found then
    return jsonb_build_object('status', 'stale');
  end if;

  insert into private.external_intake_delivery_objects (
    inspection_id,
    intent_id,
    company_id,
    generation,
    delivery_mode,
    storage_object_key,
    delete_not_before
  ) values (
    v_job.id,
    v_job.intent_id,
    v_job.company_id,
    v_job.generation,
    p_delivery_mode,
    p_storage_object_key,
    v_job.lease_expires_at + interval '60 seconds'
  )
  on conflict (inspection_id, generation, delivery_mode) do nothing
  returning * into v_delivery;

  if not found then
    select delivery.*
    into v_delivery
    from private.external_intake_delivery_objects delivery
    where delivery.inspection_id = v_job.id
      and delivery.generation = v_job.generation
      and delivery.delivery_mode = p_delivery_mode;

    if v_delivery.delivery_mode <> p_delivery_mode
      or v_delivery.storage_object_key <> p_storage_object_key
    then
      raise exception 'external_intake_delivery_stage_conflict'
        using errcode = '23505';
    end if;
  end if;

  return jsonb_build_object(
    'status', 'staged',
    'delivery_id', v_delivery.id,
    'state', v_delivery.state,
    'object_version_id', v_delivery.object_version_id,
    'size_bytes', v_delivery.size_bytes,
    'checksum_sha256', case
      when v_delivery.checksum_sha256 is null then null
      else encode(v_delivery.checksum_sha256, 'hex')
    end
  );
end;
$function$;

create or replace function public.record_external_intake_delivery_as_system(
  p_delivery_id uuid,
  p_inspection_id uuid,
  p_worker_id text,
  p_generation bigint,
  p_lease_token uuid,
  p_object_version_id text,
  p_size_bytes bigint,
  p_checksum_sha256 bytea
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_delivery private.external_intake_delivery_objects%rowtype;
begin
  perform private.require_external_api_service_role();

  if p_delivery_id is null
    or p_inspection_id is null
    or p_worker_id is null
    or p_generation is null
    or p_generation < 1
    or p_lease_token is null
    or p_object_version_id is null
    or char_length(p_object_version_id) not between 1 and 1024
    or p_size_bytes not between 1 and 26214400
    or octet_length(p_checksum_sha256) <> 32
  then
    raise exception 'external_intake_delivery_record_invalid'
      using errcode = '22023';
  end if;

  perform 1
  from private.external_intake_inspection_jobs job
  where job.id = p_inspection_id
    and job.status = 'processing'
    and job.lease_owner = p_worker_id
    and job.generation = p_generation
    and job.lease_token = p_lease_token
  for update;

  if not found then
    return false;
  end if;

  select delivery.*
  into v_delivery
  from private.external_intake_delivery_objects delivery
  where delivery.id = p_delivery_id
    and delivery.inspection_id = p_inspection_id
    and delivery.generation = p_generation
  for update;

  if not found then
    return false;
  end if;

  if v_delivery.object_version_id is not null then
    return v_delivery.object_version_id = p_object_version_id
      and v_delivery.size_bytes = p_size_bytes
      and v_delivery.checksum_sha256 = p_checksum_sha256;
  end if;

  update private.external_intake_delivery_objects delivery
  set state = 'uploaded',
      object_version_id = p_object_version_id,
      size_bytes = p_size_bytes,
      checksum_sha256 = p_checksum_sha256,
      updated_at = clock_timestamp()
  where delivery.id = v_delivery.id
    and delivery.state = 'staged';

  return found;
end;
$function$;

create or replace function public.abandon_external_intake_delivery_as_system(
  p_delivery_id uuid,
  p_safe_code text
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform private.require_external_api_service_role();

  if p_delivery_id is null
    or p_safe_code is null
    or p_safe_code !~ '^[a-z][a-z0-9_]{0,63}$'
  then
    raise exception 'external_intake_delivery_abandon_invalid'
      using errcode = '22023';
  end if;

  update private.external_intake_delivery_objects delivery
  set state = 'delete_pending',
      delete_not_before = clock_timestamp(),
      last_safe_code = p_safe_code,
      updated_at = clock_timestamp()
  where delivery.id = p_delivery_id
    and delivery.state in ('staged', 'uploaded');

  return found;
end;
$function$;

create or replace function public.finish_external_intake_inspection_as_system(
  p_inspection_id uuid,
  p_worker_id text,
  p_generation bigint,
  p_lease_token uuid,
  p_outcome text,
  p_safe_code text,
  p_available_at timestamptz,
  p_detected_content_type text,
  p_delivery_object_id uuid,
  p_delivery_mode text,
  p_accepted_object_key text,
  p_accepted_object_version_id text,
  p_accepted_size_bytes bigint,
  p_accepted_checksum_sha256 bytea
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_job private.external_intake_inspection_jobs%rowtype;
  v_intent private.external_intake_upload_intents%rowtype;
  v_delivery private.external_intake_delivery_objects%rowtype;
  v_delivery_count integer;
  v_attachment_count integer;
  v_inline_count integer;
  v_all_uploaded boolean;
begin
  perform private.require_external_api_service_role();

  if p_inspection_id is null
    or p_worker_id is null
    or p_generation is null
    or p_generation < 1
    or p_lease_token is null
    or p_outcome not in ('accepted', 'rejected', 'retrying')
    or (
      p_outcome = 'retrying'
      and (
        p_available_at is null
        or p_available_at <= clock_timestamp()
        or p_safe_code is null
      )
    )
    or (
      p_outcome = 'rejected'
      and p_safe_code is null
    )
    or (
      p_outcome = 'accepted'
      and (
        p_safe_code is not null
        or p_detected_content_type is null
        or p_delivery_object_id is null
        or p_delivery_mode not in ('attachment', 'inline_image')
        or p_accepted_object_key is null
        or p_accepted_object_version_id is null
        or p_accepted_size_bytes not between 1 and 26214400
        or p_accepted_checksum_sha256 is null
        or octet_length(p_accepted_checksum_sha256) <> 32
      )
    )
    or (
      p_safe_code is not null
      and p_safe_code !~ '^[a-z][a-z0-9_]{0,63}$'
    )
    or (
      p_outcome = 'accepted'
      and not (
        (
          p_delivery_mode = 'attachment'
          and p_accepted_object_key
            ~ '^accepted-original/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
        )
        or (
          p_delivery_mode = 'inline_image'
          and p_accepted_object_key
            ~ '^safe-derivative/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
        )
      )
    )
    or (
      p_outcome <> 'accepted'
      and (
        p_delivery_mode is not null
        or p_delivery_object_id is not null
        or p_accepted_object_key is not null
        or p_accepted_object_version_id is not null
        or p_accepted_size_bytes is not null
        or p_accepted_checksum_sha256 is not null
      )
    )
  then
    raise exception 'external_intake_inspection_finish_invalid'
      using errcode = '22023';
  end if;

  select job.*
  into v_job
  from private.external_intake_inspection_jobs job
  where job.id = p_inspection_id
    and job.status = 'processing'
    and job.lease_owner = p_worker_id
    and job.generation = p_generation
    and job.lease_token = p_lease_token
  for update;

  if not found then
    return false;
  end if;

  select intent.*
  into v_intent
  from private.external_intake_upload_intents intent
  where intent.id = v_job.intent_id
  for update;

  if p_outcome = 'retrying' then
    update private.external_intake_inspection_jobs job
    set status = 'retrying',
        available_at = least(p_available_at, job.deadline_at),
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        last_safe_code = p_safe_code,
        updated_at = clock_timestamp()
    where job.id = v_job.id;
    perform private.release_external_intake_processing_slot(v_job.intent_id);
    return true;
  end if;

  if v_intent.state <> 'pending_inspection' then
    return false;
  end if;

  if p_outcome = 'accepted' then
    select delivery.*
    into v_delivery
    from private.external_intake_delivery_objects delivery
    where delivery.id = p_delivery_object_id
      and delivery.inspection_id = v_job.id
      and delivery.intent_id = v_intent.id
      and delivery.company_id = v_intent.company_id
      and delivery.generation = v_job.generation
      and delivery.state = 'uploaded'
      and delivery.delivery_mode = p_delivery_mode
      and delivery.storage_object_key = p_accepted_object_key
      and delivery.object_version_id = p_accepted_object_version_id
      and delivery.size_bytes = p_accepted_size_bytes
      and delivery.checksum_sha256 = p_accepted_checksum_sha256
    for update;

    if not found then
      return false;
    end if;

    select
      count(*),
      count(*) filter (where delivery.delivery_mode = 'attachment'),
      count(*) filter (where delivery.delivery_mode = 'inline_image'),
      bool_and(delivery.state = 'uploaded')
    into
      v_delivery_count,
      v_attachment_count,
      v_inline_count,
      v_all_uploaded
    from private.external_intake_delivery_objects delivery
    where delivery.inspection_id = v_job.id
      and delivery.generation = v_job.generation;

    if not v_all_uploaded
      or (
        p_delivery_mode = 'attachment'
        and (
          v_delivery_count <> 1
          or v_attachment_count <> 1
          or v_inline_count <> 0
        )
      )
      or (
        p_delivery_mode = 'inline_image'
        and (
          v_delivery_count <> 2
          or v_attachment_count <> 1
          or v_inline_count <> 1
        )
      )
    then
      return false;
    end if;

    update private.external_intake_upload_intents intent
    set state = 'accepted'
    where intent.id = v_intent.id;

    update private.external_intake_inspection_jobs job
    set status = 'complete',
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        last_safe_code = null,
        detected_content_type = p_detected_content_type,
        delivery_mode = p_delivery_mode,
        accepted_object_key = p_accepted_object_key,
        accepted_object_version_id = p_accepted_object_version_id,
        accepted_size_bytes = p_accepted_size_bytes,
        accepted_checksum_sha256 = p_accepted_checksum_sha256,
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where job.id = v_job.id;

    update private.external_intake_delivery_objects delivery
    set state = 'published',
        published_at = clock_timestamp(),
        last_safe_code = null,
        updated_at = clock_timestamp()
    where delivery.inspection_id = v_job.id
      and delivery.generation = v_job.generation
      and delivery.state = 'uploaded';

    insert into private.external_intake_cleanup_reservations (
      intent_id,
      company_id,
      storage_object_key,
      object_version_id,
      delete_not_before
    ) values (
      v_intent.id,
      v_intent.company_id,
      v_intent.storage_object_key,
      v_intent.object_version_id,
      v_intent.delete_not_before
    )
    on conflict (intent_id) do update
      set object_version_id = excluded.object_version_id,
          updated_at = clock_timestamp()
      where private.external_intake_cleanup_reservations.state <> 'complete';
  else
    update private.external_intake_upload_intents intent
    set state = 'rejected',
        safe_code = p_safe_code
    where intent.id = v_intent.id;

    update private.external_intake_inspection_jobs job
    set status = 'failed',
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        last_safe_code = p_safe_code,
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where job.id = v_job.id;

    insert into private.external_intake_cleanup_reservations (
      intent_id,
      company_id,
      storage_object_key,
      object_version_id,
      delete_not_before
    ) values (
      v_intent.id,
      v_intent.company_id,
      v_intent.storage_object_key,
      v_intent.object_version_id,
      v_intent.delete_not_before
    )
    on conflict (intent_id) do update
      set object_version_id = excluded.object_version_id,
          updated_at = clock_timestamp()
      where private.external_intake_cleanup_reservations.state <> 'complete';
  end if;

  perform private.release_external_intake_processing_slot(v_job.intent_id);
  perform private.release_external_intake_pending_object(v_job.intent_id);
  return true;
end;
$function$;

-- Exact-version cleanup never creates a delete marker and never runs before
-- the capability expiry plus its recorded clock-skew margin.

create or replace function public.claim_external_intake_cleanups_as_system(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
) returns table (
  intent_id uuid,
  company_id uuid,
  storage_object_key text,
  object_version_id text,
  attempt_count integer,
  lease_generation bigint,
  lease_token uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform private.require_external_api_service_role();

  if p_worker_id is null
    or char_length(p_worker_id) not between 1 and 128
    or p_worker_id !~ '^[A-Za-z0-9_.:-]+$'
    or p_limit is null
    or not (p_limit between 1 and 25)
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 900
  then
    raise exception 'external_intake_cleanup_claim_invalid'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select cleanup.intent_id
    from private.external_intake_cleanup_reservations cleanup
    join private.external_intake_upload_intents intent
      on intent.id = cleanup.intent_id
     and intent.company_id = cleanup.company_id
    where cleanup.state in ('pending', 'leased')
      and cleanup.delete_not_before >= intent.capability_expires_at
      and cleanup.delete_not_before <= clock_timestamp()
      and (
        cleanup.state = 'pending'
        or cleanup.lease_expires_at <= clock_timestamp()
      )
      and cleanup.object_version_id is not null
    order by cleanup.delete_not_before, cleanup.created_at, cleanup.intent_id
    for update of cleanup skip locked
    limit p_limit
  ),
  claimed as (
    update private.external_intake_cleanup_reservations cleanup
    set state = 'leased',
        attempt_count = cleanup.attempt_count + 1,
        lease_generation = cleanup.lease_generation + 1,
        lease_owner = p_worker_id,
        lease_token = gen_random_uuid(),
        lease_expires_at =
          clock_timestamp() + make_interval(secs => p_lease_seconds),
        updated_at = clock_timestamp()
    from candidates
    where cleanup.intent_id = candidates.intent_id
    returning cleanup.*
  )
  select
    claimed.intent_id,
    claimed.company_id,
    claimed.storage_object_key,
    claimed.object_version_id,
    claimed.attempt_count,
    claimed.lease_generation,
    claimed.lease_token
  from claimed;
end;
$function$;

create or replace function public.finish_external_intake_cleanup_as_system(
  p_intent_id uuid,
  p_worker_id text,
  p_generation bigint,
  p_lease_token uuid,
  p_object_version_id text,
  p_outcome text,
  p_safe_code text,
  p_available_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_cleanup private.external_intake_cleanup_reservations%rowtype;
begin
  perform private.require_external_api_service_role();

  if p_intent_id is null
    or p_worker_id is null
    or p_generation is null
    or p_generation < 1
    or p_lease_token is null
    or p_object_version_id is null
    or p_outcome not in ('deleted', 'retrying')
    or (
      p_outcome = 'deleted'
      and (p_safe_code is not null or p_available_at is not null)
    )
    or (
      p_outcome = 'retrying'
      and (
        p_safe_code is null
        or p_safe_code !~ '^[a-z][a-z0-9_]{0,63}$'
        or p_available_at is null
        or p_available_at <= clock_timestamp()
      )
    )
  then
    raise exception 'external_intake_cleanup_finish_invalid'
      using errcode = '22023';
  end if;

  select cleanup.*
  into v_cleanup
  from private.external_intake_cleanup_reservations cleanup
  where cleanup.intent_id = p_intent_id
    and cleanup.state = 'leased'
    and cleanup.lease_owner = p_worker_id
    and cleanup.lease_generation = p_generation
    and cleanup.lease_token = p_lease_token
    and cleanup.object_version_id = p_object_version_id
  for update;

  if not found then
    return false;
  end if;

  if p_outcome = 'deleted' then
    update private.external_intake_cleanup_reservations cleanup
    set state = 'complete',
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        last_error_code = null,
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where cleanup.intent_id = p_intent_id;
  else
    update private.external_intake_cleanup_reservations cleanup
    set state = 'pending',
        delete_not_before = greatest(
          cleanup.delete_not_before,
          p_available_at
        ),
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        last_error_code = p_safe_code,
        updated_at = clock_timestamp()
    where cleanup.intent_id = p_intent_id;
  end if;

  return true;
end;
$function$;

create or replace function public.claim_external_intake_delivery_cleanups_as_system(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
) returns table (
  delivery_id uuid,
  storage_object_key text,
  object_version_id text,
  attempt_count integer,
  lease_generation bigint,
  lease_token uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform private.require_external_api_service_role();

  if p_worker_id is null
    or char_length(p_worker_id) not between 1 and 128
    or p_worker_id !~ '^[A-Za-z0-9_.:-]+$'
    or p_limit is null
    or not (p_limit between 1 and 25)
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 900
  then
    raise exception 'external_intake_delivery_cleanup_claim_invalid'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select delivery.id
    from private.external_intake_delivery_objects delivery
    join private.external_intake_inspection_jobs job
      on job.id = delivery.inspection_id
    where delivery.state in (
        'staged',
        'uploaded',
        'delete_pending',
        'deleting'
      )
      and delivery.delete_not_before <= clock_timestamp()
      and (
        delivery.state = 'delete_pending'
        or (
          delivery.state = 'deleting'
          and delivery.lease_expires_at <= clock_timestamp()
        )
        or (
          delivery.state in ('staged', 'uploaded')
          and (
            job.status <> 'processing'
            or job.generation <> delivery.generation
            or job.lease_expires_at <= clock_timestamp()
          )
        )
      )
    order by delivery.delete_not_before, delivery.created_at, delivery.id
    for update of delivery skip locked
    limit p_limit
  ),
  claimed as (
    update private.external_intake_delivery_objects delivery
    set state = 'deleting',
        attempt_count = delivery.attempt_count + 1,
        lease_generation = delivery.lease_generation + 1,
        lease_owner = p_worker_id,
        lease_token = gen_random_uuid(),
        lease_expires_at =
          clock_timestamp() + make_interval(secs => p_lease_seconds),
        updated_at = clock_timestamp()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    claimed.storage_object_key,
    claimed.object_version_id,
    claimed.attempt_count,
    claimed.lease_generation,
    claimed.lease_token
  from claimed;
end;
$function$;

create or replace function public.finish_external_intake_delivery_cleanup_as_system(
  p_delivery_id uuid,
  p_worker_id text,
  p_generation bigint,
  p_lease_token uuid,
  p_observed_object_version_id text,
  p_outcome text,
  p_safe_code text,
  p_available_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_delivery private.external_intake_delivery_objects%rowtype;
begin
  perform private.require_external_api_service_role();

  if p_delivery_id is null
    or p_worker_id is null
    or p_generation is null
    or p_generation < 1
    or p_lease_token is null
    or p_outcome not in ('deleted', 'retrying')
    or (
      p_observed_object_version_id is not null
      and (
        char_length(p_observed_object_version_id) not between 1 and 1024
        or p_observed_object_version_id ~ '[[:cntrl:]]'
      )
    )
    or (
      p_outcome = 'deleted'
      and (p_safe_code is not null or p_available_at is not null)
    )
    or (
      p_outcome = 'retrying'
      and (
        p_safe_code is null
        or p_safe_code !~ '^[a-z][a-z0-9_]{0,63}$'
        or p_available_at is null
        or p_available_at <= clock_timestamp()
      )
    )
  then
    raise exception 'external_intake_delivery_cleanup_finish_invalid'
      using errcode = '22023';
  end if;

  select delivery.*
  into v_delivery
  from private.external_intake_delivery_objects delivery
  where delivery.id = p_delivery_id
    and delivery.state = 'deleting'
    and delivery.lease_owner = p_worker_id
    and delivery.lease_generation = p_generation
    and delivery.lease_token = p_lease_token
  for update;

  if not found
    or (
      v_delivery.object_version_id is not null
      and v_delivery.object_version_id
        is distinct from p_observed_object_version_id
    )
  then
    return false;
  end if;

  if p_outcome = 'deleted' then
    update private.external_intake_delivery_objects delivery
    set state = 'deleted',
        object_version_id = coalesce(
          delivery.object_version_id,
          p_observed_object_version_id
        ),
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        last_safe_code = null,
        deleted_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where delivery.id = v_delivery.id;
  else
    update private.external_intake_delivery_objects delivery
    set state = 'delete_pending',
        object_version_id = coalesce(
          delivery.object_version_id,
          p_observed_object_version_id
        ),
        delete_not_before = greatest(
          delivery.delete_not_before,
          p_available_at
        ),
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        last_safe_code = p_safe_code,
        updated_at = clock_timestamp()
    where delivery.id = v_delivery.id;
  end if;

  return true;
end;
$function$;

-- Bounded expiry and terminalization ---------------------------------------

create or replace function public.maintain_external_intake_files_as_system(
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_expired integer := 0;
  v_terminalized integer := 0;
  v_scheduled integer := 0;
  v_credentials_retired integer := 0;
begin
  perform private.require_external_api_service_role();

  if p_limit is null or not (p_limit between 1 and 500) then
    raise exception 'external_intake_maintenance_limit_invalid'
      using errcode = '22023';
  end if;

  with candidates as (
    select credential.id
    from private.external_api_credentials credential
    where credential.status = 'overlap'
      and credential.overlap_until <= clock_timestamp()
    order by credential.overlap_until, credential.id
    for update skip locked
    limit p_limit
  )
  update private.external_api_credentials credential
  set status = 'retired',
      retired_at = clock_timestamp(),
      overlap_started_at = null,
      overlap_until = null,
      updated_at = clock_timestamp()
  from candidates
  where credential.id = candidates.id;
  get diagnostics v_credentials_retired = row_count;

  with candidates as (
    select intent.id
    from private.external_intake_upload_intents intent
    where intent.state = 'issued'
      and intent.capability_expires_at <= clock_timestamp()
    order by intent.capability_expires_at, intent.id
    for update skip locked
    limit p_limit
  )
  update private.external_intake_upload_intents intent
  set state = 'expired',
      safe_code = 'upload_expired'
  from candidates
  where intent.id = candidates.id;
  get diagnostics v_expired = row_count;

  with overdue as (
    select job.id, job.intent_id
    from private.external_intake_inspection_jobs job
    where job.status in ('pending', 'processing', 'retrying')
      and job.deadline_at <= clock_timestamp()
    order by job.deadline_at, job.id
    for update skip locked
    limit p_limit
  ),
  terminal_jobs as (
    update private.external_intake_inspection_jobs job
    set status = 'failed',
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        last_safe_code = 'inspection_unavailable',
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    from overdue
    where job.id = overdue.id
    returning job.intent_id
  )
  update private.external_intake_upload_intents intent
  set state = case
        when intent.state = 'pending_inspection' then 'rejected'
        else 'expired'
      end,
      safe_code = 'inspection_unavailable'
  from terminal_jobs
  where intent.id = terminal_jobs.intent_id
    and intent.state in (
      'uploaded',
      'claimed',
      'pending_inspection'
    );
  get diagnostics v_terminalized = row_count;

  update private.external_intake_scan_slot_reservations slot
  set status = 'released',
      released_at = clock_timestamp()
  from private.external_intake_upload_intents intent
  where intent.id = slot.intent_id
    and intent.state in (
      'accepted',
      'rejected',
      'closed_missing',
      'expired'
    )
    and slot.status = 'active';

  update private.external_intake_pending_object_reservations reservation
  set status = 'released',
      released_at = clock_timestamp()
  from private.external_intake_upload_intents intent
  where intent.id = reservation.intent_id
    and intent.state in (
      'accepted',
      'rejected',
      'closed_missing',
      'expired'
    )
    and reservation.status = 'reserved';

  insert into private.external_intake_cleanup_reservations (
    intent_id,
    company_id,
    storage_object_key,
    object_version_id,
    delete_not_before
  )
  select
    intent.id,
    intent.company_id,
    intent.storage_object_key,
    intent.object_version_id,
    intent.delete_not_before
  from private.external_intake_upload_intents intent
  where intent.state in ('rejected', 'closed_missing', 'expired')
    and intent.object_version_id is not null
  order by intent.updated_at, intent.id
  limit p_limit
  on conflict (intent_id) do update
    set object_version_id = excluded.object_version_id,
        updated_at = clock_timestamp()
    where private.external_intake_cleanup_reservations.state <> 'complete';
  get diagnostics v_scheduled = row_count;

  return jsonb_build_object(
    'expired', v_expired,
    'terminalized', v_terminalized,
    'cleanup_scheduled', v_scheduled,
    'credentials_retired', v_credentials_retired
  );
end;
$function$;

-- Private relations remain outside the Data API.

alter table private.external_intake_object_events
  enable row level security;
alter table private.external_intake_guardduty_results
  enable row level security;
alter table private.external_intake_inspection_jobs
  enable row level security;
alter table private.external_intake_delivery_objects
  enable row level security;

revoke all on table private.external_intake_object_events
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_guardduty_results
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_inspection_jobs
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_delivery_objects
  from public, anon, authenticated, service_role;

revoke all on function private.acquire_external_intake_scan_slot(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.release_external_intake_processing_slot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.release_external_intake_pending_object(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.record_external_intake_object_event_as_system(
  text, text, text, text, text, bigint, bytea, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.record_external_intake_object_event_as_system(
  text, text, text, text, text, bigint, bytea, text, timestamptz
) to service_role;

revoke all on function public.claim_external_intake_inspections_as_system(
  text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_external_intake_inspections_as_system(
  text, integer, integer
) to service_role;

revoke all on function public.stage_external_intake_delivery_as_system(
  uuid, text, bigint, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.stage_external_intake_delivery_as_system(
  uuid, text, bigint, uuid, text, text
) to service_role;

revoke all on function public.record_external_intake_delivery_as_system(
  uuid, uuid, text, bigint, uuid, text, bigint, bytea
) from public, anon, authenticated, service_role;
grant execute on function public.record_external_intake_delivery_as_system(
  uuid, uuid, text, bigint, uuid, text, bigint, bytea
) to service_role;

revoke all on function public.abandon_external_intake_delivery_as_system(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.abandon_external_intake_delivery_as_system(
  uuid, text
) to service_role;

revoke all on function public.finish_external_intake_inspection_as_system(
  uuid, text, bigint, uuid, text, text, timestamptz, text, uuid, text, text,
  text, bigint, bytea
) from public, anon, authenticated, service_role;
grant execute on function public.finish_external_intake_inspection_as_system(
  uuid, text, bigint, uuid, text, text, timestamptz, text, uuid, text, text,
  text, bigint, bytea
) to service_role;

revoke all on function public.claim_external_intake_cleanups_as_system(
  text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_external_intake_cleanups_as_system(
  text, integer, integer
) to service_role;

revoke all on function public.finish_external_intake_cleanup_as_system(
  uuid, text, bigint, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finish_external_intake_cleanup_as_system(
  uuid, text, bigint, uuid, text, text, text, timestamptz
) to service_role;

revoke all on function public.claim_external_intake_delivery_cleanups_as_system(
  text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_external_intake_delivery_cleanups_as_system(
  text, integer, integer
) to service_role;

revoke all on function public.finish_external_intake_delivery_cleanup_as_system(
  uuid, text, bigint, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finish_external_intake_delivery_cleanup_as_system(
  uuid, text, bigint, uuid, text, text, text, timestamptz
) to service_role;

revoke all on function public.maintain_external_intake_files_as_system(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.maintain_external_intake_files_as_system(integer)
  to service_role;

comment on table private.external_intake_object_events is
  'Idempotent, metadata-only S3 and GuardDuty event ledger for exact quarantine versions.';
comment on table private.external_intake_inspection_jobs is
  'Company-scoped durable structural and malware inspection work with a 24-hour deadline.';
comment on table private.external_intake_delivery_objects is
  'Generation-fenced accepted copies and safe derivatives; abandoned objects remain durably cleanup-eligible.';

commit;
