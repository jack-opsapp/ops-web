begin;

-- Replay-safe file reservations for the server-only external intake API.
-- This migration creates no browser-readable table, enables no company, and
-- provisions no storage service. Every public wrapper is fixed to service_role
-- and revalidates the authenticated credential inside its transaction.

do $prerequisites$
begin
  if to_regclass('private.external_api_principals') is null
    or to_regclass('private.external_api_credentials') is null
    or to_regclass('private.external_api_principal_sources') is null
    or to_regclass('private.lead_intake_sources') is null
    or to_regclass('private.lead_intake_forms') is null
    or to_regprocedure(
      'private.require_external_api_service_role()'
    ) is null
    or to_regprocedure(
      'private.lock_external_api_company_shared(uuid)'
    ) is null
    or to_regprocedure(
      'private.insert_external_api_authenticated_audit_base(uuid,uuid,uuid,text,text,timestamp with time zone)'
    ) is null
  then
    raise exception 'external_intake_upload_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create table private.external_intake_upload_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  principal_id uuid not null,
  credential_id uuid not null,
  source_id uuid not null,
  form_id uuid not null,
  idempotency_digest_version smallint not null,
  idempotency_digest bytea not null,
  manifest_hash_version smallint not null,
  manifest_hash bytea not null,
  reserved_bytes bigint not null,
  reserved_objects integer not null,
  state text not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  constraint external_intake_upload_batches_company_identity_key
    unique (id, company_id),
  constraint external_intake_upload_batches_idempotency_key
    unique (
      principal_id,
      idempotency_digest_version,
      idempotency_digest
    ),
  constraint external_intake_upload_batches_principal_company_fkey
    foreign key (principal_id, company_id)
    references private.external_api_principals (id, company_id)
    on delete restrict,
  constraint external_intake_upload_batches_credential_company_fkey
    foreign key (credential_id, company_id)
    references private.external_api_credentials (id, company_id)
    on delete restrict,
  constraint external_intake_upload_batches_source_company_fkey
    foreign key (source_id, company_id)
    references private.lead_intake_sources (id, company_id)
    on delete restrict,
  constraint external_intake_upload_batches_form_company_fkey
    foreign key (form_id, company_id)
    references private.lead_intake_forms (id, company_id)
    on delete restrict,
  constraint external_intake_upload_batches_idempotency_version_check
    check (idempotency_digest_version > 0),
  constraint external_intake_upload_batches_idempotency_digest_check
    check (octet_length(idempotency_digest) = 32),
  constraint external_intake_upload_batches_manifest_version_check
    check (manifest_hash_version > 0),
  constraint external_intake_upload_batches_manifest_hash_check
    check (octet_length(manifest_hash) = 32),
  constraint external_intake_upload_batches_byte_count_check
    check (reserved_bytes between 1 and 52428800),
  constraint external_intake_upload_batches_object_count_check
    check (reserved_objects between 1 and 10),
  constraint external_intake_upload_batches_state_check
    check (state in ('active', 'released', 'expired')),
  constraint external_intake_upload_batches_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint external_intake_upload_batches_release_check
    check (
      (state = 'active' and released_at is null)
      or (state in ('released', 'expired') and released_at is not null)
    )
);

create index external_intake_upload_batches_company_expiry_idx
  on private.external_intake_upload_batches (company_id, expires_at)
  where state = 'active';

create table private.external_intake_upload_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  batch_id uuid not null,
  public_upload_id uuid not null default gen_random_uuid(),
  ordinal integer not null,
  caller_file_id text not null,
  original_filename text not null,
  expected_size_bytes bigint not null,
  declared_content_type text not null,
  expected_checksum_sha256 bytea,
  storage_object_key text not null,
  state text not null default 'issued',
  capability_expires_at timestamptz not null,
  delete_not_before timestamptz not null,
  object_version_id text,
  observed_size_bytes bigint,
  observed_checksum_sha256 bytea,
  uploaded_at timestamptz,
  safe_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint external_intake_upload_intents_company_identity_key
    unique (id, company_id),
  constraint external_intake_upload_intents_public_upload_key
    unique (public_upload_id),
  constraint external_intake_upload_intents_storage_object_key
    unique (storage_object_key),
  constraint external_intake_upload_intents_batch_ordinal_key
    unique (batch_id, ordinal),
  constraint external_intake_upload_intents_batch_caller_key
    unique (batch_id, caller_file_id),
  constraint external_intake_upload_intents_batch_company_fkey
    foreign key (batch_id, company_id)
    references private.external_intake_upload_batches (id, company_id)
    on delete restrict,
  constraint external_intake_upload_intents_ordinal_check
    check (ordinal between 1 and 10),
  constraint external_intake_upload_intents_caller_file_id_check
    check (
      caller_file_id ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,127}$'
    ),
  constraint external_intake_upload_intents_filename_check
    check (
      char_length(original_filename) between 1 and 255
      and original_filename = btrim(original_filename)
      and original_filename !~ '[[:cntrl:]]'
      and strpos(original_filename, '/') = 0
      and strpos(original_filename, chr(92)) = 0
      and original_filename not in ('.', '..')
    ),
  constraint external_intake_upload_intents_size_check
    check (expected_size_bytes between 1 and 26214400),
  constraint external_intake_upload_intents_type_check
    check (
      declared_content_type in (
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/vnd.dwg',
        'image/vnd.dxf',
        'application/acad',
        'application/dxf'
      )
    ),
  constraint external_intake_upload_intents_expected_checksum_check
    check (
      expected_checksum_sha256 is null
      or octet_length(expected_checksum_sha256) = 32
    ),
  constraint external_intake_upload_intents_storage_key_check
    check (
      storage_object_key ~ '^quarantine/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
      and storage_object_key !~ '[?#]'
      and storage_object_key !~ '(^|/)[.][.]?(/|$)'
    ),
  constraint external_intake_upload_intents_state_check
    check (
      state in (
        'issued',
        'uploaded',
        'claimed',
        'pending_inspection',
        'accepted',
        'rejected',
        'closed_missing',
        'expired'
      )
    ),
  constraint external_intake_upload_intents_capability_expiry_check
    check (capability_expires_at > created_at),
  constraint external_intake_upload_intents_delete_not_before_check
    check (
      delete_not_before >= capability_expires_at + interval '60 seconds'
    ),
  constraint external_intake_upload_intents_object_evidence_check
    check (
      (
        object_version_id is null
        and observed_size_bytes is null
        and observed_checksum_sha256 is null
        and uploaded_at is null
        and state in ('issued', 'closed_missing', 'expired')
      )
      or
      (
        object_version_id is not null
        and char_length(object_version_id) between 1 and 1024
        and object_version_id !~ '[[:cntrl:]]'
        and observed_size_bytes between 1 and 26214400
        and (
          observed_checksum_sha256 is null
          or octet_length(observed_checksum_sha256) = 32
        )
        and uploaded_at is not null
        and state in (
          'uploaded',
          'claimed',
          'pending_inspection',
          'accepted',
          'rejected',
          'expired'
        )
      )
    ),
  constraint external_intake_upload_intents_safe_code_check
    check (
      (
        state in ('rejected', 'closed_missing', 'expired')
        and safe_code ~ '^[a-z][a-z0-9_]{0,63}$'
      )
      or (
        state not in ('rejected', 'closed_missing', 'expired')
        and safe_code is null
      )
    )
);

create index external_intake_upload_intents_company_state_idx
  on private.external_intake_upload_intents (
    company_id,
    state,
    capability_expires_at
  );

create index external_intake_upload_intents_batch_idx
  on private.external_intake_upload_intents (batch_id, ordinal);

create table private.external_intake_company_quota_locks (
  company_id uuid primary key
    references public.companies (id) on delete restrict,
  touched_at timestamptz not null default clock_timestamp()
);

create table private.external_intake_rolling_byte_reservations (
  batch_id uuid primary key,
  company_id uuid not null,
  reserved_bytes bigint not null,
  status text not null default 'reserved',
  reserved_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  constraint external_intake_rolling_bytes_batch_company_fkey
    foreign key (batch_id, company_id)
    references private.external_intake_upload_batches (id, company_id)
    on delete restrict,
  constraint external_intake_rolling_bytes_size_check
    check (reserved_bytes between 1 and 52428800),
  constraint external_intake_rolling_bytes_status_check
    check (status in ('reserved', 'consumed', 'released')),
  constraint external_intake_rolling_bytes_release_check
    check (
      (status in ('reserved', 'consumed') and released_at is null)
      or (status = 'released' and released_at is not null)
    )
);

create index external_intake_rolling_bytes_company_window_idx
  on private.external_intake_rolling_byte_reservations (
    company_id,
    reserved_at
  )
  where status in ('reserved', 'consumed');

create table private.external_intake_pending_object_reservations (
  intent_id uuid primary key,
  company_id uuid not null,
  status text not null default 'reserved',
  reserved_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  constraint external_intake_pending_objects_intent_company_fkey
    foreign key (intent_id, company_id)
    references private.external_intake_upload_intents (id, company_id)
    on delete restrict,
  constraint external_intake_pending_objects_status_check
    check (status in ('reserved', 'released')),
  constraint external_intake_pending_objects_release_check
    check (
      (status = 'reserved' and released_at is null)
      or (status = 'released' and released_at is not null)
    )
);

create index external_intake_pending_objects_company_idx
  on private.external_intake_pending_object_reservations (company_id)
  where status = 'reserved';

create table private.external_intake_scan_slot_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  intent_id uuid not null,
  generation bigint not null default 1,
  status text not null default 'active',
  acquired_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz not null,
  released_at timestamptz,
  constraint external_intake_scan_slots_intent_key
    unique (intent_id),
  constraint external_intake_scan_slots_intent_company_fkey
    foreign key (intent_id, company_id)
    references private.external_intake_upload_intents (id, company_id)
    on delete restrict,
  constraint external_intake_scan_slots_generation_check
    check (generation > 0),
  constraint external_intake_scan_slots_status_check
    check (status in ('active', 'released')),
  constraint external_intake_scan_slots_lease_check
    check (
      lease_expires_at > acquired_at
      and lease_expires_at <= acquired_at + interval '15 minutes'
    ),
  constraint external_intake_scan_slots_release_check
    check (
      (status = 'active' and released_at is null)
      or (status = 'released' and released_at is not null)
    )
);

create index external_intake_scan_slots_company_active_idx
  on private.external_intake_scan_slot_reservations (
    company_id,
    lease_expires_at
  )
  where status = 'active';

create table private.external_intake_cleanup_reservations (
  intent_id uuid primary key,
  company_id uuid not null,
  storage_object_key text not null,
  delete_not_before timestamptz not null,
  state text not null default 'pending',
  attempt_count integer not null default 0,
  lease_generation bigint not null default 0,
  lease_expires_at timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint external_intake_cleanup_intent_company_fkey
    foreign key (intent_id, company_id)
    references private.external_intake_upload_intents (id, company_id)
    on delete restrict,
  constraint external_intake_cleanup_storage_key
    unique (storage_object_key),
  constraint external_intake_cleanup_state_check
    check (state in ('pending', 'leased', 'complete')),
  constraint external_intake_cleanup_attempt_check
    check (attempt_count >= 0 and lease_generation >= 0),
  constraint external_intake_cleanup_error_check
    check (
      last_error_code is null
      or last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  constraint external_intake_cleanup_terminal_check
    check (
      (state = 'complete' and completed_at is not null)
      or (state <> 'complete' and completed_at is null)
    )
);

create index external_intake_cleanup_ready_idx
  on private.external_intake_cleanup_reservations (
    state,
    delete_not_before,
    lease_expires_at
  )
  where state <> 'complete';

-- Immutable identity and exact state transitions ---------------------------

create or replace function private.guard_external_intake_upload_transition()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if new.id is distinct from old.id
    or new.company_id is distinct from old.company_id
    or new.batch_id is distinct from old.batch_id
    or new.public_upload_id is distinct from old.public_upload_id
    or new.ordinal is distinct from old.ordinal
    or new.caller_file_id is distinct from old.caller_file_id
    or new.original_filename is distinct from old.original_filename
    or new.expected_size_bytes is distinct from old.expected_size_bytes
    or new.declared_content_type is distinct from old.declared_content_type
    or new.expected_checksum_sha256 is distinct from old.expected_checksum_sha256
    or new.storage_object_key is distinct from old.storage_object_key
    or new.created_at is distinct from old.created_at
  then
    raise exception 'external_intake_upload_identity_immutable'
      using errcode = '42501';
  end if;

  if old.object_version_id is not null
    and (
      new.object_version_id is distinct from old.object_version_id
      or new.observed_size_bytes is distinct from old.observed_size_bytes
      or new.observed_checksum_sha256 is distinct from old.observed_checksum_sha256
      or new.uploaded_at is distinct from old.uploaded_at
    )
  then
    raise exception 'external_intake_upload_object_conflict'
      using errcode = '23505';
  end if;

  if new.state <> old.state
    and not (
      (old.state = 'issued' and new.state in ('uploaded', 'expired'))
      or (
        old.state = 'uploaded'
        and new.state in ('claimed', 'closed_missing', 'expired')
      )
      or (
        old.state = 'claimed'
        and new.state in ('pending_inspection', 'closed_missing', 'expired')
      )
      or (
        old.state = 'pending_inspection'
        and new.state in ('accepted', 'rejected', 'closed_missing', 'expired')
      )
    )
  then
    raise exception 'external_intake_upload_transition_invalid'
      using errcode = '23514';
  end if;

  if (
      new.capability_expires_at is distinct from old.capability_expires_at
      or new.delete_not_before is distinct from old.delete_not_before
    )
    and old.state <> 'issued'
  then
    raise exception 'external_intake_upload_capability_immutable'
      using errcode = '42501';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

create trigger external_intake_upload_intents_guard_transition
before update on private.external_intake_upload_intents
for each row
execute function private.guard_external_intake_upload_transition();

-- Guard and quota helpers ---------------------------------------------------

create or replace function private.require_external_intake_credential(
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if p_principal_id is null
    or p_credential_id is null
    or p_company_id is null
    or p_digest_version is null
    or p_digest_version <= 0
    or p_credential_digest is null
    or octet_length(p_credential_digest) <> 32
    or p_visible_prefix is null
    or char_length(p_visible_prefix) not between 8 and 32
    or p_authorization_epoch is null
    or p_authorization_epoch <= 0
  then
    raise exception 'external_intake_credential_invalid'
      using errcode = '42501';
  end if;

  perform 1
  from private.external_api_principals principal
  join private.external_api_credentials credential
    on credential.principal_id = principal.id
   and credential.company_id = principal.company_id
  where principal.id = p_principal_id
    and principal.company_id = p_company_id
    and credential.id = p_credential_id
    and credential.digest_version = p_digest_version
    and credential.secret_digest = p_credential_digest
    and credential.visible_prefix = p_visible_prefix
    and credential.issued_authorization_epoch = p_authorization_epoch
    and principal.authorization_epoch = p_authorization_epoch
    and principal.status = 'active'
    and principal.revoked_at is null
    and principal.credential_class = 'intake'
    and principal.scopes = array['intake.write']::text[]
    and (
      credential.status = 'active'
      or (
        credential.status = 'overlap'
        and credential.overlap_until > clock_timestamp()
      )
    )
    and (
      credential.expires_at is null
      or credential.expires_at > clock_timestamp()
    )
    and private.external_api_company_feature_enabled(p_company_id)
  for share of principal, credential;

  if not found then
    raise exception 'external_intake_credential_invalid'
      using errcode = '42501';
  end if;
end;
$function$;

create or replace function private.external_intake_upload_batch_result(
  p_batch_id uuid,
  p_status text,
  p_audit_request_id uuid
) returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select jsonb_build_object(
    'status', p_status,
    'batch_id', batch.id,
    'audit_request_id', p_audit_request_id,
    'uploads', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'public_upload_id', intent.public_upload_id,
            'caller_file_id', intent.caller_file_id,
            'state', intent.state,
            'capability_expires_at', intent.capability_expires_at,
            'delete_not_before', intent.delete_not_before,
            'safe_code', intent.safe_code
          )
          order by intent.ordinal
        )
        from private.external_intake_upload_intents intent
        where intent.batch_id = batch.id
      ),
      '[]'::jsonb
    )
  )
  from private.external_intake_upload_batches batch
  where batch.id = p_batch_id;
$function$;

create or replace function private.expire_external_intake_reservations(
  p_company_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  update private.external_intake_upload_batches batch
  set state = 'expired',
      released_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where batch.company_id = p_company_id
    and batch.state = 'active'
    and batch.expires_at <= clock_timestamp();

  update private.external_intake_upload_intents intent
  set state = 'expired',
      safe_code = 'batch_expired'
  from private.external_intake_upload_batches batch
  where batch.id = intent.batch_id
    and batch.company_id = p_company_id
    and batch.state = 'expired'
    and intent.state in ('issued', 'uploaded');

  update private.external_intake_pending_object_reservations reservation
  set status = 'released',
      released_at = clock_timestamp()
  from private.external_intake_upload_intents intent
  where intent.id = reservation.intent_id
    and intent.company_id = p_company_id
    and intent.state in (
      'accepted',
      'rejected',
      'closed_missing',
      'expired'
    )
    and reservation.status = 'reserved';

  update private.external_intake_rolling_byte_reservations reservation
  set status = 'released',
      released_at = clock_timestamp()
  from private.external_intake_upload_batches batch
  where batch.id = reservation.batch_id
    and batch.company_id = p_company_id
    and batch.state in ('released', 'expired')
    and reservation.status = 'reserved'
    and not exists (
      select 1
      from private.external_intake_upload_intents intent
      where intent.batch_id = batch.id
        and intent.object_version_id is not null
    );

  insert into private.external_intake_cleanup_reservations (
    intent_id,
    company_id,
    storage_object_key,
    delete_not_before
  )
  select
    intent.id,
    intent.company_id,
    intent.storage_object_key,
    intent.delete_not_before
  from private.external_intake_upload_intents intent
  where intent.company_id = p_company_id
    and intent.state in ('rejected', 'closed_missing', 'expired')
    and intent.object_version_id is not null
  on conflict (intent_id) do nothing;
end;
$function$;

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
    and intent.state in ('uploaded', 'claimed')
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

-- Guarded service-role commands --------------------------------------------

create or replace function public.reserve_external_intake_upload_batch_as_system(
  p_request_id uuid,
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_source_public_id uuid,
  p_form_public_id uuid,
  p_idempotency_digest_version smallint,
  p_idempotency_digest bytea,
  p_manifest_hash_version smallint,
  p_manifest_hash bytea,
  p_files jsonb,
  p_requested_origin text,
  p_capability_expires_at timestamptz,
  p_delete_not_before timestamptz,
  p_batch_expires_at timestamptz,
  p_route text,
  p_method text,
  p_request_received_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_source private.lead_intake_sources%rowtype;
  v_form private.lead_intake_forms%rowtype;
  v_existing private.external_intake_upload_batches%rowtype;
  v_batch_id uuid;
  v_intent_id uuid;
  v_public_upload_id uuid;
  v_file jsonb;
  v_ordinal bigint;
  v_file_count integer;
  v_total_bytes bigint;
  v_rolling_bytes bigint;
  v_pending_objects bigint;
begin
  perform private.require_external_api_service_role();

  if p_request_id is null
    or p_principal_id is null
    or p_credential_id is null
    or p_company_id is null
    or p_source_public_id is null
    or p_form_public_id is null
    or p_idempotency_digest_version is null
    or p_idempotency_digest_version <= 0
    or p_idempotency_digest is null
    or octet_length(p_idempotency_digest) <> 32
    or p_manifest_hash_version is null
    or p_manifest_hash_version <= 0
    or p_manifest_hash is null
    or octet_length(p_manifest_hash) <> 32
    or p_files is null
    or jsonb_typeof(p_files) <> 'array'
    or p_route is null
    or p_route <> '/v1/intake/uploads'
    or p_method is null
    or p_method <> 'POST'
    or p_request_received_at is null
    or p_capability_expires_at is null
    or p_capability_expires_at <= clock_timestamp()
    or p_capability_expires_at > clock_timestamp() + interval '5 minutes'
    or p_delete_not_before is null
    or p_delete_not_before
      < p_capability_expires_at + interval '60 seconds'
    or p_batch_expires_at is null
    or p_batch_expires_at <= p_capability_expires_at
    or p_batch_expires_at
      > clock_timestamp() + interval '15 minutes'
  then
    raise exception 'external_intake_upload_arguments_invalid'
      using errcode = '22023';
  end if;

  v_file_count := jsonb_array_length(p_files);
  if v_file_count < 1 or v_file_count > 10 then
    raise exception 'external_intake_upload_arguments_invalid'
      using errcode = '22023';
  end if;

  for v_file in
    select file_row.value
    from jsonb_array_elements(p_files) file_row(value)
  loop
    if jsonb_typeof(v_file) <> 'object' then
      raise exception 'external_intake_upload_manifest_invalid'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_object_keys(v_file) key_name
      where key_name not in (
        'callerFileId',
        'filename',
        'sizeBytes',
        'contentType',
        'sha256'
      )
    )
      or coalesce(v_file ->> 'callerFileId', '')
        !~ '^[A-Za-z][A-Za-z0-9_.:-]{0,127}$'
      or char_length(coalesce(v_file ->> 'filename', ''))
        not between 1 and 255
      or (v_file ->> 'filename')
        is distinct from btrim(v_file ->> 'filename')
      or (v_file ->> 'filename') ~ '[[:cntrl:]]'
      or strpos(v_file ->> 'filename', '/') > 0
      or strpos(v_file ->> 'filename', chr(92)) > 0
      or (v_file ->> 'filename') in ('.', '..')
      or coalesce(v_file ->> 'sizeBytes', '')
        !~ '^[1-9][0-9]{0,8}$'
      or (v_file ->> 'sizeBytes')::bigint > 26214400
      or coalesce(v_file ->> 'contentType', '') not in (
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/vnd.dwg',
        'image/vnd.dxf',
        'application/acad',
        'application/dxf'
      )
      or (
        v_file ? 'sha256'
        and (
          jsonb_typeof(v_file -> 'sha256') <> 'string'
          or (v_file ->> 'sha256') !~ '^[0-9a-f]{64}$'
        )
      )
    then
      raise exception 'external_intake_upload_manifest_invalid'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(distinct file_row.value ->> 'callerFileId')
    from jsonb_array_elements(p_files) file_row(value)
  ) <> v_file_count then
    raise exception 'external_intake_upload_manifest_invalid'
      using errcode = '22023';
  end if;

  select sum((file_row.value ->> 'sizeBytes')::bigint)
  into v_total_bytes
  from jsonb_array_elements(p_files) file_row(value);

  if v_total_bytes is null
    or v_total_bytes < 1
    or v_total_bytes > 52428800
  then
    raise exception 'external_intake_upload_manifest_invalid'
      using errcode = '22023';
  end if;

  perform private.insert_external_api_authenticated_audit_base(
    p_request_id,
    p_principal_id,
    p_credential_id,
    p_route,
    p_method,
    p_request_received_at
  );

  perform private.require_external_intake_credential(
    p_principal_id,
    p_credential_id,
    p_company_id,
    p_digest_version,
    p_credential_digest,
    p_visible_prefix,
    p_authorization_epoch
  );

  select source.*
  into v_source
  from private.lead_intake_sources source
  join private.external_api_principal_sources source_grant
    on source_grant.source_id = source.id
   and source_grant.company_id = source.company_id
  where source.public_source_id = p_source_public_id
    and source.company_id = p_company_id
    and source.status = 'active'
    and source_grant.principal_id = p_principal_id
  for share of source, source_grant;

  if not found then
    return jsonb_build_object(
      'status', 'source_not_allowed',
      'batch_id', null,
      'audit_request_id', p_request_id,
      'uploads', '[]'::jsonb
    );
  end if;

  if p_requested_origin is not null
    and not (p_requested_origin = any(v_source.allowed_browser_origins))
  then
    return jsonb_build_object(
      'status', 'source_not_allowed',
      'batch_id', null,
      'audit_request_id', p_request_id,
      'uploads', '[]'::jsonb
    );
  end if;

  select form_row.*
  into v_form
  from private.lead_intake_forms form_row
  where form_row.public_form_id = p_form_public_id
    and form_row.company_id = p_company_id
    and form_row.source_id = v_source.id
    and form_row.is_active
  for share;

  if not found then
    return jsonb_build_object(
      'status', 'form_not_allowed',
      'batch_id', null,
      'audit_request_id', p_request_id,
      'uploads', '[]'::jsonb
    );
  end if;

  insert into private.external_intake_company_quota_locks (
    company_id
  ) values (
    p_company_id
  )
  on conflict (company_id) do nothing;

  perform 1
  from private.external_intake_company_quota_locks quota
  where quota.company_id = p_company_id
  for update;

  perform private.expire_external_intake_reservations(p_company_id);

  select batch.*
  into v_existing
  from private.external_intake_upload_batches batch
  where batch.principal_id = p_principal_id
    and batch.idempotency_digest_version = p_idempotency_digest_version
    and batch.idempotency_digest = p_idempotency_digest
  for update;

  if found then
    if v_existing.company_id <> p_company_id
      or v_existing.source_id <> v_source.id
      or v_existing.form_id <> v_form.id
      or v_existing.manifest_hash_version <> p_manifest_hash_version
      or v_existing.manifest_hash <> p_manifest_hash
    then
      return jsonb_build_object(
        'status', 'conflict',
        'batch_id', v_existing.id,
        'audit_request_id', p_request_id,
        'uploads', '[]'::jsonb
      );
    end if;

    if v_existing.state <> 'active'
      or v_existing.expires_at <= clock_timestamp()
      or p_delete_not_before > v_existing.expires_at
    then
      return jsonb_build_object(
        'status', 'expired',
        'batch_id', v_existing.id,
        'audit_request_id', p_request_id,
        'uploads', '[]'::jsonb
      );
    end if;

    update private.external_intake_upload_intents intent
    set capability_expires_at = p_capability_expires_at,
        delete_not_before = p_delete_not_before
    where intent.batch_id = v_existing.id
      and intent.state = 'issued'
      and intent.object_version_id is null;

    return private.external_intake_upload_batch_result(
      v_existing.id,
      'replay',
      p_request_id
    );
  end if;

  select coalesce(sum(reservation.reserved_bytes), 0)
  into v_rolling_bytes
  from private.external_intake_rolling_byte_reservations reservation
  where reservation.company_id = p_company_id
    and reservation.status in ('reserved', 'consumed')
    and reservation.reserved_at > clock_timestamp() - interval '24 hours';

  select count(*)
  into v_pending_objects
  from private.external_intake_pending_object_reservations reservation
  where reservation.company_id = p_company_id
    and reservation.status = 'reserved';

  if v_rolling_bytes + v_total_bytes > 1073741824
    or v_pending_objects + v_file_count > 100
  then
    return jsonb_build_object(
      'status', 'quota_exceeded',
      'batch_id', null,
      'audit_request_id', p_request_id,
      'uploads', '[]'::jsonb
    );
  end if;

  v_batch_id := gen_random_uuid();
  insert into private.external_intake_upload_batches (
    id,
    company_id,
    principal_id,
    credential_id,
    source_id,
    form_id,
    idempotency_digest_version,
    idempotency_digest,
    manifest_hash_version,
    manifest_hash,
    reserved_bytes,
    reserved_objects,
    expires_at
  ) values (
    v_batch_id,
    p_company_id,
    p_principal_id,
    p_credential_id,
    v_source.id,
    v_form.id,
    p_idempotency_digest_version,
    p_idempotency_digest,
    p_manifest_hash_version,
    p_manifest_hash,
    v_total_bytes,
    v_file_count,
    p_batch_expires_at
  );

  insert into private.external_intake_rolling_byte_reservations (
    batch_id,
    company_id,
    reserved_bytes
  ) values (
    v_batch_id,
    p_company_id,
    v_total_bytes
  );

  for v_file, v_ordinal in
    select file_row.value, file_row.ordinality
    from jsonb_array_elements(p_files)
      with ordinality as file_row(value, ordinality)
    order by file_row.ordinality
  loop
    v_intent_id := gen_random_uuid();
    v_public_upload_id := gen_random_uuid();

    insert into private.external_intake_upload_intents (
      id,
      company_id,
      batch_id,
      public_upload_id,
      ordinal,
      caller_file_id,
      original_filename,
      expected_size_bytes,
      declared_content_type,
      expected_checksum_sha256,
      storage_object_key,
      capability_expires_at,
      delete_not_before
    ) values (
      v_intent_id,
      p_company_id,
      v_batch_id,
      v_public_upload_id,
      v_ordinal::integer,
      v_file ->> 'callerFileId',
      v_file ->> 'filename',
      (v_file ->> 'sizeBytes')::bigint,
      v_file ->> 'contentType',
      case
        when v_file ? 'sha256'
          then decode(v_file ->> 'sha256', 'hex')
        else null
      end,
      'quarantine/'
        || p_company_id::text || '/'
        || v_source.public_source_id::text || '/'
        || v_batch_id::text || '/'
        || v_public_upload_id::text,
      p_capability_expires_at,
      p_delete_not_before
    );

    insert into private.external_intake_pending_object_reservations (
      intent_id,
      company_id
    ) values (
      v_intent_id,
      p_company_id
    );
  end loop;

  return private.external_intake_upload_batch_result(
    v_batch_id,
    'new',
    p_request_id
  );
end;
$function$;

create or replace function public.release_external_intake_upload_batch_as_system(
  p_batch_id uuid,
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_batch private.external_intake_upload_batches%rowtype;
begin
  perform private.require_external_api_service_role();
  perform private.require_external_intake_credential(
    p_principal_id,
    p_credential_id,
    p_company_id,
    p_digest_version,
    p_credential_digest,
    p_visible_prefix,
    p_authorization_epoch
  );

  insert into private.external_intake_company_quota_locks (
    company_id
  ) values (
    p_company_id
  )
  on conflict (company_id) do nothing;

  perform 1
  from private.external_intake_company_quota_locks quota
  where quota.company_id = p_company_id
  for update;

  select batch.*
  into v_batch
  from private.external_intake_upload_batches batch
  where batch.id = p_batch_id
    and batch.company_id = p_company_id
    and batch.principal_id = p_principal_id
    and batch.credential_id = p_credential_id
  for update;

  if not found or v_batch.state <> 'active' then
    return jsonb_build_object('released', false);
  end if;

  if exists (
    select 1
    from private.external_intake_upload_intents intent
    where intent.batch_id = p_batch_id
      and (
        intent.state <> 'issued'
        or intent.object_version_id is not null
      )
  ) then
    return jsonb_build_object('released', false);
  end if;

  update private.external_intake_upload_batches batch
  set state = 'released',
      released_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where batch.id = p_batch_id;

  update private.external_intake_upload_intents intent
  set state = 'expired',
      safe_code = 'capability_unavailable'
  where intent.batch_id = p_batch_id
    and intent.state = 'issued'
    and intent.object_version_id is null;

  update private.external_intake_rolling_byte_reservations reservation
  set status = 'released',
      released_at = clock_timestamp()
  where reservation.batch_id = p_batch_id
    and reservation.company_id = p_company_id
    and reservation.status = 'reserved';

  update private.external_intake_pending_object_reservations reservation
  set status = 'released',
      released_at = clock_timestamp()
  from private.external_intake_upload_intents intent
  where intent.id = reservation.intent_id
    and intent.batch_id = p_batch_id
    and reservation.company_id = p_company_id
    and reservation.status = 'reserved';

  return jsonb_build_object('released', true);
end;
$function$;

create or replace function public.record_external_intake_uploaded_object_as_system(
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_source_public_id uuid,
  p_form_public_id uuid,
  p_public_upload_id uuid,
  p_storage_object_key text,
  p_object_version_id text,
  p_observed_size_bytes bigint,
  p_observed_checksum_sha256 bytea,
  p_uploaded_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_intent private.external_intake_upload_intents%rowtype;
begin
  perform private.require_external_api_service_role();
  perform private.require_external_intake_credential(
    p_principal_id,
    p_credential_id,
    p_company_id,
    p_digest_version,
    p_credential_digest,
    p_visible_prefix,
    p_authorization_epoch
  );

  if p_source_public_id is null
    or p_form_public_id is null
    or p_public_upload_id is null
    or p_storage_object_key is null
    or char_length(p_storage_object_key) not between 1 and 1024
    or p_object_version_id is null
    or char_length(p_object_version_id) not between 1 and 1024
    or p_object_version_id ~ '[[:cntrl:]]'
    or p_observed_size_bytes is null
    or p_observed_size_bytes not between 1 and 26214400
    or (
      p_observed_checksum_sha256 is not null
      and octet_length(p_observed_checksum_sha256) <> 32
    )
    or p_uploaded_at is null
    or p_uploaded_at > clock_timestamp() + interval '5 minutes'
  then
    raise exception 'external_intake_uploaded_object_arguments_invalid'
      using errcode = '22023';
  end if;

  insert into private.external_intake_company_quota_locks (
    company_id
  ) values (
    p_company_id
  )
  on conflict (company_id) do nothing;

  perform 1
  from private.external_intake_company_quota_locks quota
  where quota.company_id = p_company_id
  for update;

  select intent.*
  into v_intent
  from private.external_intake_upload_intents intent
  join private.external_intake_upload_batches batch
    on batch.id = intent.batch_id
   and batch.company_id = intent.company_id
  join private.lead_intake_sources source
    on source.id = batch.source_id
   and source.company_id = batch.company_id
  join private.lead_intake_forms form_row
    on form_row.id = batch.form_id
   and form_row.company_id = batch.company_id
  join private.external_api_principal_sources source_grant
    on source_grant.principal_id = p_principal_id
   and source_grant.source_id = source.id
   and source_grant.company_id = source.company_id
  where intent.public_upload_id = p_public_upload_id
    and intent.company_id = p_company_id
    and batch.principal_id = p_principal_id
    and batch.credential_id = p_credential_id
    and source.public_source_id = p_source_public_id
    and form_row.public_form_id = p_form_public_id
    and form_row.source_id = source.id
  for update of intent;

  if not found then
    return jsonb_build_object('status', 'upload_not_found');
  end if;

  if v_intent.storage_object_key <> p_storage_object_key
    or v_intent.expected_size_bytes <> p_observed_size_bytes
    or (
      v_intent.expected_checksum_sha256 is not null
      and v_intent.expected_checksum_sha256
        is distinct from p_observed_checksum_sha256
    )
  then
    raise exception 'external_intake_upload_object_conflict'
      using errcode = '23505';
  end if;

  if v_intent.object_version_id is not null then
    if v_intent.object_version_id = p_object_version_id
      and v_intent.observed_size_bytes = p_observed_size_bytes
      and v_intent.observed_checksum_sha256
        is not distinct from p_observed_checksum_sha256
      and v_intent.uploaded_at = p_uploaded_at
    then
      return jsonb_build_object(
        'status', 'replay',
        'public_upload_id', v_intent.public_upload_id,
        'state', v_intent.state
      );
    end if;

    raise exception 'external_intake_upload_object_conflict'
      using errcode = '23505';
  end if;

  if v_intent.state <> 'issued'
    or v_intent.capability_expires_at <= p_uploaded_at
  then
    return jsonb_build_object(
      'status', 'expired',
      'public_upload_id', v_intent.public_upload_id,
      'state', v_intent.state
    );
  end if;

  update private.external_intake_upload_intents intent
  set object_version_id = p_object_version_id,
      observed_size_bytes = p_observed_size_bytes,
      observed_checksum_sha256 = p_observed_checksum_sha256,
      uploaded_at = p_uploaded_at,
      state = 'uploaded'
  where intent.id = v_intent.id;

  update private.external_intake_rolling_byte_reservations reservation
  set status = 'consumed'
  where reservation.batch_id = v_intent.batch_id
    and reservation.company_id = p_company_id
    and reservation.status = 'reserved';

  return jsonb_build_object(
    'status', 'recorded',
    'public_upload_id', v_intent.public_upload_id,
    'state', 'uploaded'
  );
end;
$function$;

-- Private relations are never exposed through the Data API.

alter table private.external_intake_upload_batches
  enable row level security;
alter table private.external_intake_upload_intents
  enable row level security;
alter table private.external_intake_company_quota_locks
  enable row level security;
alter table private.external_intake_rolling_byte_reservations
  enable row level security;
alter table private.external_intake_pending_object_reservations
  enable row level security;
alter table private.external_intake_scan_slot_reservations
  enable row level security;
alter table private.external_intake_cleanup_reservations
  enable row level security;

revoke all on table private.external_intake_upload_batches
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_upload_intents
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_company_quota_locks
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_rolling_byte_reservations
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_pending_object_reservations
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_scan_slot_reservations
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_cleanup_reservations
  from public, anon, authenticated, service_role;

revoke all on function private.guard_external_intake_upload_transition()
  from public, anon, authenticated, service_role;
revoke all on function private.require_external_intake_credential(
  uuid, uuid, uuid, smallint, bytea, text, bigint
) from public, anon, authenticated, service_role;
revoke all on function private.external_intake_upload_batch_result(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.expire_external_intake_reservations(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.acquire_external_intake_scan_slot(uuid, integer)
  from public, anon, authenticated, service_role;

revoke all on function public.reserve_external_intake_upload_batch_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid,
  smallint, bytea, smallint, bytea, jsonb, text, timestamptz, timestamptz,
  timestamptz, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_external_intake_upload_batch_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid,
  smallint, bytea, smallint, bytea, jsonb, text, timestamptz, timestamptz,
  timestamptz, text, text, timestamptz
) to service_role;

revoke all on function public.release_external_intake_upload_batch_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.release_external_intake_upload_batch_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint
) to service_role;

revoke all on function public.record_external_intake_uploaded_object_as_system(
  uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid, uuid, text,
  text, bigint, bytea, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.record_external_intake_uploaded_object_as_system(
  uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid, uuid, text,
  text, bigint, bytea, timestamptz
) to service_role;

comment on table private.external_intake_upload_batches is
  'Principal-scoped replay and quota reservations for original lead intake files.';
comment on table private.external_intake_upload_intents is
  'Private immutable upload targets and object evidence; never returned to API callers.';

commit;
