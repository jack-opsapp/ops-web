begin;

-- Rollback-only executable contract for replay-safe original-submission files.
-- Run only after the full migration chain on a local database or an explicitly
-- approved disposable branch.

set local lock_timeout = '10s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select set_config('request.jwt.claim.role', 'service_role', true);

create temp table external_intake_upload_contract_results (
  check_name text primary key,
  passed boolean not null,
  details text
) on commit drop;

create temp table external_intake_upload_contract_fixture (
  company_id uuid primary key,
  principal_id uuid not null,
  credential_id uuid not null,
  source_id uuid not null,
  form_id uuid not null,
  other_source_id uuid not null,
  other_form_id uuid not null,
  authorization_epoch bigint not null
) on commit drop;

create temp table external_intake_upload_contract_values (
  value_name text primary key,
  value jsonb not null
) on commit drop;

insert into public.companies (
  id,
  bubble_id,
  name,
  subscription_status,
  subscription_plan
) values (
  'e2000000-0000-4000-8000-000000000001',
  'external-upload-contract-company',
  'External Upload Contract',
  'trial',
  'trial'
);

insert into public.users (
  id,
  bubble_id,
  company_id,
  first_name,
  last_name,
  email,
  role,
  is_company_admin,
  is_active,
  deleted_at
) values (
  'e2000000-0000-4000-8000-000000000101',
  'external-upload-contract-owner',
  'e2000000-0000-4000-8000-000000000001',
  'External',
  'Upload Owner',
  'external-upload-owner@example.invalid',
  'owner',
  true,
  true,
  null
);

insert into public.admin_feature_overrides (
  id,
  company_id,
  feature_key,
  enabled,
  enabled_by,
  enabled_at,
  metadata
) values (
  'e2000000-0000-4000-8000-000000000201',
  'e2000000-0000-4000-8000-000000000001',
  'external_api',
  true,
  'e2000000-0000-4000-8000-000000000101',
  clock_timestamp(),
  '{"contract_fixture":true}'::jsonb
);

insert into external_intake_upload_contract_values (value_name, value)
values (
  'source',
  public.create_lead_intake_source_as_system(
    'e2000000-0000-4000-8000-000000000101',
    'Upload Website',
    'upload.example.invalid',
    'CA',
    array['https://upload.example.invalid']::text[],
    'website',
    null,
    null
  )
);

insert into external_intake_upload_contract_values (value_name, value)
values (
  'other_source',
  public.create_lead_intake_source_as_system(
    'e2000000-0000-4000-8000-000000000101',
    'Other Website',
    'other-upload.example.invalid',
    'CA',
    array['https://other-upload.example.invalid']::text[],
    'website',
    null,
    null
  )
);

insert into external_intake_upload_contract_values (value_name, value)
values (
  'credential',
  public.create_external_api_credential_as_system(
    'e2000000-0000-4000-8000-000000000101',
    'Upload contract key',
    'intake',
    array['intake.write']::text[],
    array[(
      select (value ->> 'sourceId')::uuid
      from external_intake_upload_contract_values
      where value_name = 'source'
    )]::uuid[],
    1::smallint,
    decode(repeat('11', 32), 'hex'),
    'opsxupl1',
    clock_timestamp() + interval '1 day'
  )
);

insert into external_intake_upload_contract_fixture (
  company_id,
  principal_id,
  credential_id,
  source_id,
  form_id,
  other_source_id,
  other_form_id,
  authorization_epoch
)
select
  'e2000000-0000-4000-8000-000000000001',
  (credential.value ->> 'principalId')::uuid,
  (credential.value ->> 'credentialId')::uuid,
  (source.value ->> 'sourceId')::uuid,
  (source.value -> 'forms' -> 0 ->> 'formId')::uuid,
  (other_source.value ->> 'sourceId')::uuid,
  (other_source.value -> 'forms' -> 0 ->> 'formId')::uuid,
  (credential.value ->> 'authorizationEpoch')::bigint
from external_intake_upload_contract_values credential
cross join external_intake_upload_contract_values source
cross join external_intake_upload_contract_values other_source
where credential.value_name = 'credential'
  and source.value_name = 'source'
  and other_source.value_name = 'other_source';

create function pg_temp.reserve_external_upload(
  p_request_id uuid,
  p_source_id uuid,
  p_form_id uuid,
  p_idempotency_digest bytea,
  p_manifest_hash bytea,
  p_files jsonb,
  p_origin text
) returns jsonb
language plpgsql
as $function$
declare
  v_fixture external_intake_upload_contract_fixture%rowtype;
  v_received_at timestamptz := clock_timestamp();
begin
  select * into strict v_fixture
  from external_intake_upload_contract_fixture;

  return public.reserve_external_intake_upload_batch_rotating_as_system(
    p_request_id,
    v_fixture.principal_id,
    v_fixture.credential_id,
    v_fixture.company_id,
    1::smallint,
    decode(repeat('11', 32), 'hex'),
    'opsxupl1',
    v_fixture.authorization_epoch,
    p_source_id,
    p_form_id,
    1::smallint,
    p_idempotency_digest,
    jsonb_build_array(
      jsonb_build_object(
        'kid',
        1,
        'digest',
        E'\\x' || encode(p_idempotency_digest, 'hex')
      )
    ),
    1::smallint,
    p_manifest_hash,
    p_files,
    p_origin,
    v_received_at + interval '2 minutes',
    v_received_at + interval '3 minutes',
    v_received_at + interval '10 minutes',
    '/v1/intake/uploads',
    'POST',
    v_received_at
  );
end;
$function$;

-- Exact replay returns the same batch and public upload IDs without a second
-- rolling-byte or pending-object reservation.

insert into external_intake_upload_contract_values (value_name, value)
select
  'first_reservation',
  pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000301',
    fixture.source_id,
    fixture.form_id,
    decode(repeat('21', 32), 'hex'),
    decode(repeat('31', 32), 'hex'),
    '[{"callerFileId":"photo","filename":"photo.jpg","sizeBytes":4096,"contentType":"image/jpeg","sha256":"0707070707070707070707070707070707070707070707070707070707070707"}]'::jsonb,
    'https://upload.example.invalid'
  )
from external_intake_upload_contract_fixture fixture;

insert into external_intake_upload_contract_values (value_name, value)
select
  'exact_replay',
  pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000302',
    fixture.source_id,
    fixture.form_id,
    decode(repeat('21', 32), 'hex'),
    decode(repeat('31', 32), 'hex'),
    '[{"callerFileId":"photo","filename":"photo.jpg","sizeBytes":4096,"contentType":"image/jpeg","sha256":"0707070707070707070707070707070707070707070707070707070707070707"}]'::jsonb,
    null
  )
from external_intake_upload_contract_fixture fixture;

insert into external_intake_upload_contract_results (check_name, passed)
select
  'exact_replay_does_not_reserve_twice',
  first.value ->> 'status' = 'new'
  and replay.value ->> 'status' = 'replay'
  and first.value ->> 'batch_id' = replay.value ->> 'batch_id'
  and first.value -> 'uploads' -> 0 ->> 'public_upload_id'
    = replay.value -> 'uploads' -> 0 ->> 'public_upload_id'
  and first.value -> 'uploads' -> 0 ->> 'caller_file_id'
    = replay.value -> 'uploads' -> 0 ->> 'caller_file_id'
  and (
    select count(*)
    from private.external_intake_rolling_byte_reservations reservation
    where reservation.batch_id =
      (first.value ->> 'batch_id')::uuid
  ) = 1
  and (
    select count(*)
    from private.external_intake_pending_object_reservations reservation
    join private.external_intake_upload_intents intent
      on intent.id = reservation.intent_id
    where intent.batch_id = (first.value ->> 'batch_id')::uuid
  ) = 1
from external_intake_upload_contract_values first
cross join external_intake_upload_contract_values replay
where first.value_name = 'first_reservation'
  and replay.value_name = 'exact_replay';

insert into external_intake_upload_contract_values (value_name, value)
select
  'rotated_replay',
  public.reserve_external_intake_upload_batch_rotating_as_system(
    'e2000000-0000-4000-8000-000000000312',
    fixture.principal_id,
    fixture.credential_id,
    fixture.company_id,
    1::smallint,
    decode(repeat('11', 32), 'hex'),
    'opsxupl1',
    fixture.authorization_epoch,
    fixture.source_id,
    fixture.form_id,
    2::smallint,
    decode(repeat('29', 32), 'hex'),
    jsonb_build_array(
      jsonb_build_object(
        'kid',
        2,
        'digest',
        E'\\x' || repeat('29', 32)
      ),
      jsonb_build_object(
        'kid',
        1,
        'digest',
        E'\\x' || repeat('21', 32)
      )
    ),
    1::smallint,
    decode(repeat('31', 32), 'hex'),
    '[{"callerFileId":"photo","filename":"photo.jpg","sizeBytes":4096,"contentType":"image/jpeg","sha256":"0707070707070707070707070707070707070707070707070707070707070707"}]'::jsonb,
    null,
    clock_timestamp() + interval '2 minutes',
    clock_timestamp() + interval '3 minutes',
    clock_timestamp() + interval '10 minutes',
    '/v1/intake/uploads',
    'POST',
    clock_timestamp()
  )
from external_intake_upload_contract_fixture fixture;

insert into external_intake_upload_contract_results (check_name, passed)
select
  'idempotency_key_rotation_replays_original',
  first.value ->> 'status' = 'new'
  and rotated.value ->> 'status' = 'replay'
  and first.value ->> 'batch_id' = rotated.value ->> 'batch_id'
  and (
    select batch.idempotency_digest_version = 1
      and batch.idempotency_digest = decode(repeat('21', 32), 'hex')
    from private.external_intake_upload_batches batch
    where batch.id = (first.value ->> 'batch_id')::uuid
  )
from external_intake_upload_contract_values first
cross join external_intake_upload_contract_values rotated
where first.value_name = 'first_reservation'
  and rotated.value_name = 'rotated_replay';

insert into external_intake_upload_contract_results (check_name, passed)
select
  'changed_manifest_conflicts',
  result ->> 'status' = 'conflict'
from external_intake_upload_contract_fixture fixture
cross join lateral (
  select pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000303',
    fixture.source_id,
    fixture.form_id,
    decode(repeat('21', 32), 'hex'),
    decode(repeat('32', 32), 'hex'),
    '[{"callerFileId":"photo","filename":"changed.jpg","sizeBytes":4096,"contentType":"image/jpeg"}]'::jsonb,
    null
  ) result
) call;

-- Expired batches never mint a fresh reservation for the same identity.

insert into external_intake_upload_contract_values (value_name, value)
select
  'expiring_reservation',
  pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000304',
    fixture.source_id,
    fixture.form_id,
    decode(repeat('22', 32), 'hex'),
    decode(repeat('33', 32), 'hex'),
    '[{"callerFileId":"plans","filename":"plans.pdf","sizeBytes":2048,"contentType":"application/pdf"}]'::jsonb,
    null
  )
from external_intake_upload_contract_fixture fixture;

update private.external_intake_upload_batches batch
set state = 'expired',
    released_at = clock_timestamp()
where batch.id = (
  select (value ->> 'batch_id')::uuid
  from external_intake_upload_contract_values
  where value_name = 'expiring_reservation'
);

insert into external_intake_upload_contract_results (check_name, passed)
select
  'expired_batch_returns_expired',
  result ->> 'status' = 'expired'
from external_intake_upload_contract_fixture fixture
cross join lateral (
  select pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000305',
    fixture.source_id,
    fixture.form_id,
    decode(repeat('22', 32), 'hex'),
    decode(repeat('33', 32), 'hex'),
    '[{"callerFileId":"plans","filename":"plans.pdf","sizeBytes":2048,"contentType":"application/pdf"}]'::jsonb,
    null
  ) result
) call;

insert into external_intake_upload_contract_results (check_name, passed)
select
  'cross_source_denied',
  result ->> 'status' = 'source_not_allowed'
from external_intake_upload_contract_fixture fixture
cross join lateral (
  select pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000306',
    fixture.other_source_id,
    fixture.other_form_id,
    decode(repeat('23', 32), 'hex'),
    decode(repeat('34', 32), 'hex'),
    '[{"callerFileId":"photo","filename":"photo.jpg","sizeBytes":1024,"contentType":"image/jpeg"}]'::jsonb,
    null
  ) result
) call;

insert into external_intake_upload_contract_results (check_name, passed)
select
  'cross_form_denied',
  result ->> 'status' = 'form_not_allowed'
from external_intake_upload_contract_fixture fixture
cross join lateral (
  select pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000311',
    fixture.source_id,
    fixture.other_form_id,
    decode(repeat('28', 32), 'hex'),
    decode(repeat('39', 32), 'hex'),
    '[{"callerFileId":"photo","filename":"photo.jpg","sizeBytes":1024,"contentType":"image/jpeg"}]'::jsonb,
    null
  ) result
) call;

insert into external_intake_upload_contract_results (check_name, passed)
select
  'origin_mismatch_denied',
  result ->> 'status' = 'source_not_allowed'
from external_intake_upload_contract_fixture fixture
cross join lateral (
  select pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000307',
    fixture.source_id,
    fixture.form_id,
    decode(repeat('24', 32), 'hex'),
    decode(repeat('35', 32), 'hex'),
    '[{"callerFileId":"photo","filename":"photo.jpg","sizeBytes":1024,"contentType":"image/jpeg"}]'::jsonb,
    'https://wrong.example.invalid'
  ) result
) call;

-- Object evidence is write-once. Exact event replay is accepted; any changed
-- version, size, or checksum is rejected without altering the first evidence.

do $contract$
declare
  v_fixture external_intake_upload_contract_fixture%rowtype;
  v_reservation jsonb;
  v_upload jsonb;
  v_uploaded_at timestamptz := clock_timestamp();
  v_first jsonb;
  v_replay jsonb;
  v_conflict_denied boolean := false;
begin
  select * into strict v_fixture
  from external_intake_upload_contract_fixture;

  v_reservation := pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000308',
    v_fixture.source_id,
    v_fixture.form_id,
    decode(repeat('25', 32), 'hex'),
    decode(repeat('36', 32), 'hex'),
    '[{"callerFileId":"evidence","filename":"evidence.jpg","sizeBytes":1024,"contentType":"image/jpeg","sha256":"0808080808080808080808080808080808080808080808080808080808080808"}]'::jsonb,
    null
  );
  v_upload := v_reservation -> 'uploads' -> 0;

  v_first := public.record_external_intake_uploaded_object_as_system(
    v_fixture.principal_id,
    v_fixture.credential_id,
    v_fixture.company_id,
    1::smallint,
    decode(repeat('11', 32), 'hex'),
    'opsxupl1',
    v_fixture.authorization_epoch,
    v_fixture.source_id,
    v_fixture.form_id,
    (v_upload ->> 'public_upload_id')::uuid,
    'quarantine/'
      || v_fixture.company_id::text || '/'
      || v_fixture.source_id::text || '/'
      || (v_reservation ->> 'batch_id') || '/'
      || (v_upload ->> 'public_upload_id'),
    'version-contract-1',
    1024,
    decode(repeat('08', 32), 'hex'),
    v_uploaded_at
  );

  v_replay := public.record_external_intake_uploaded_object_as_system(
    v_fixture.principal_id,
    v_fixture.credential_id,
    v_fixture.company_id,
    1::smallint,
    decode(repeat('11', 32), 'hex'),
    'opsxupl1',
    v_fixture.authorization_epoch,
    v_fixture.source_id,
    v_fixture.form_id,
    (v_upload ->> 'public_upload_id')::uuid,
    'quarantine/'
      || v_fixture.company_id::text || '/'
      || v_fixture.source_id::text || '/'
      || (v_reservation ->> 'batch_id') || '/'
      || (v_upload ->> 'public_upload_id'),
    'version-contract-1',
    1024,
    decode(repeat('08', 32), 'hex'),
    v_uploaded_at
  );

  begin
    perform public.record_external_intake_uploaded_object_as_system(
      v_fixture.principal_id,
      v_fixture.credential_id,
      v_fixture.company_id,
      1::smallint,
      decode(repeat('11', 32), 'hex'),
      'opsxupl1',
      v_fixture.authorization_epoch,
      v_fixture.source_id,
      v_fixture.form_id,
      (v_upload ->> 'public_upload_id')::uuid,
      'quarantine/'
        || v_fixture.company_id::text || '/'
        || v_fixture.source_id::text || '/'
        || (v_reservation ->> 'batch_id') || '/'
        || (v_upload ->> 'public_upload_id'),
      'version-contract-2',
      1024,
      decode(repeat('08', 32), 'hex'),
      v_uploaded_at
    );
  exception
    when unique_violation then
      v_conflict_denied := true;
  end;

  insert into external_intake_upload_contract_results (
    check_name,
    passed
  )
  select
    'immutable_object_evidence',
    v_first ->> 'status' = 'recorded'
    and v_replay ->> 'status' = 'replay'
    and v_conflict_denied
    and intent.object_version_id = 'version-contract-1'
    and intent.observed_size_bytes = 1024
    and intent.observed_checksum_sha256 = decode(repeat('08', 32), 'hex')
  from private.external_intake_upload_intents intent
  where intent.public_upload_id =
    (v_upload ->> 'public_upload_id')::uuid;
end;
$contract$;

-- Fill the rolling window to 950 MiB. The next 50 MiB succeeds; the following
-- 50 MiB is denied. The two-session companion contract executes these final
-- reservations concurrently to prove the same company lock closes the race.

insert into private.external_intake_upload_batches (
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
)
select
  fixture.company_id,
  fixture.principal_id,
  fixture.credential_id,
  source.id,
  form_row.id,
  1,
  decode(lpad(to_hex(series.value + 1000), 64, '0'), 'hex'),
  1,
  decode(lpad(to_hex(series.value + 2000), 64, '0'), 'hex'),
  52428800,
  1,
  clock_timestamp() + interval '10 minutes'
from external_intake_upload_contract_fixture fixture
join private.lead_intake_sources source
  on source.public_source_id = fixture.source_id
join private.lead_intake_forms form_row
  on form_row.public_form_id = fixture.form_id
cross join generate_series(1, 19) series(value);

insert into private.external_intake_rolling_byte_reservations (
  batch_id,
  company_id,
  reserved_bytes
)
select
  batch.id,
  batch.company_id,
  batch.reserved_bytes
from private.external_intake_upload_batches batch
join external_intake_upload_contract_fixture fixture
  on fixture.company_id = batch.company_id
where batch.reserved_bytes = 52428800
  and not exists (
    select 1
    from private.external_intake_rolling_byte_reservations reservation
    where reservation.batch_id = batch.id
  );

insert into external_intake_upload_contract_values (value_name, value)
select
  'quota_last_allowed',
  pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000309',
    fixture.source_id,
    fixture.form_id,
    decode(repeat('26', 32), 'hex'),
    decode(repeat('37', 32), 'hex'),
    '[{"callerFileId":"partA","filename":"part-a.pdf","sizeBytes":26214400,"contentType":"application/pdf"},{"callerFileId":"partB","filename":"part-b.pdf","sizeBytes":26214400,"contentType":"application/pdf"}]'::jsonb,
    null
  )
from external_intake_upload_contract_fixture fixture;

insert into external_intake_upload_contract_results (check_name, passed)
select
  'quota_concurrency_cannot_oversubscribe',
  allowed.value ->> 'status' = 'new'
  and denied.result ->> 'status' = 'quota_exceeded'
from external_intake_upload_contract_values allowed
cross join external_intake_upload_contract_fixture fixture
cross join lateral (
  select pg_temp.reserve_external_upload(
    'e2000000-0000-4000-8000-000000000310',
    fixture.source_id,
    fixture.form_id,
    decode(repeat('27', 32), 'hex'),
    decode(repeat('38', 32), 'hex'),
    '[{"callerFileId":"partA","filename":"part-a.pdf","sizeBytes":26214400,"contentType":"application/pdf"},{"callerFileId":"partB","filename":"part-b.pdf","sizeBytes":26214400,"contentType":"application/pdf"}]'::jsonb,
    null
  ) result
) denied
where allowed.value_name = 'quota_last_allowed';

do $contract$
declare
  v_failures text;
  v_missing text;
  v_expected constant text[] := array[
    'exact_replay_does_not_reserve_twice',
    'idempotency_key_rotation_replays_original',
    'changed_manifest_conflicts',
    'expired_batch_returns_expired',
    'cross_source_denied',
    'cross_form_denied',
    'origin_mismatch_denied',
    'immutable_object_evidence',
    'quota_concurrency_cannot_oversubscribe'
  ]::text[];
begin
  select string_agg(expected.check_name, ', ' order by expected.check_name)
  into v_missing
  from unnest(v_expected) expected(check_name)
  where not exists (
    select 1
    from external_intake_upload_contract_results result
    where result.check_name = expected.check_name
  );

  if v_missing is not null then
    raise exception 'external_intake_upload_contract_checks_missing: %',
      v_missing using errcode = '55000';
  end if;

  select string_agg(
    result.check_name || coalesce(': ' || result.details, ''),
    ', ' order by result.check_name
  )
  into v_failures
  from external_intake_upload_contract_results result
  where not result.passed;

  if v_failures is not null then
    raise exception 'external_intake_upload_contract_failed: %',
      v_failures using errcode = '55000';
  end if;
end;
$contract$;

select 'OPS_EXTERNAL_API_SQL_CONTRACT_PASS';

select check_name, passed
from external_intake_upload_contract_results
order by check_name;

rollback;
