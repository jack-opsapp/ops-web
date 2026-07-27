begin;

-- Rollback-only executable contract for the atomic original-inquiry command.
-- Run only on a local database or an explicitly approved disposable branch.

set local lock_timeout = '10s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';
select set_config('request.jwt.claim.role', 'service_role', true);

create temp table external_lead_intake_contract_results (
  check_name text primary key,
  passed boolean not null,
  details text
) on commit drop;

create temp table external_lead_intake_contract_fixture (
  company_id uuid primary key,
  principal_id uuid not null,
  credential_id uuid not null,
  source_id uuid not null,
  form_id uuid not null,
  authorization_epoch bigint not null
) on commit drop;

create temp table external_lead_intake_contract_values (
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
  'e3000000-0000-4000-8000-000000000001',
  'external-lead-intake-contract-company',
  'External Lead Intake Contract',
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
  'e3000000-0000-4000-8000-000000000101',
  'external-lead-intake-contract-owner',
  'e3000000-0000-4000-8000-000000000001',
  'External',
  'Intake Owner',
  'external-intake-owner@example.invalid',
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
  'e3000000-0000-4000-8000-000000000201',
  'e3000000-0000-4000-8000-000000000001',
  'external_api',
  true,
  'e3000000-0000-4000-8000-000000000101',
  clock_timestamp(),
  '{"contract_fixture":true}'::jsonb
);

insert into external_lead_intake_contract_values (value_name, value)
values (
  'source',
  public.create_lead_intake_source_as_system(
    'e3000000-0000-4000-8000-000000000101',
    'Lead Intake Contract Site',
    'lead-intake.example.invalid',
    'CA',
    array['https://lead-intake.example.invalid']::text[],
    'referral',
    null,
    null
  )
);

insert into external_lead_intake_contract_values (value_name, value)
values (
  'credential',
  public.create_external_api_credential_as_system(
    'e3000000-0000-4000-8000-000000000101',
    'Lead intake contract key',
    'intake',
    array['intake.write']::text[],
    array[(
      select (value ->> 'sourceId')::uuid
      from external_lead_intake_contract_values
      where value_name = 'source'
    )]::uuid[],
    1::smallint,
    decode(repeat('33', 32), 'hex'),
    'opsxint1',
    clock_timestamp() + interval '1 day'
  )
);

insert into external_lead_intake_contract_fixture (
  company_id,
  principal_id,
  credential_id,
  source_id,
  form_id,
  authorization_epoch
)
select
  'e3000000-0000-4000-8000-000000000001',
  (credential.value ->> 'principalId')::uuid,
  (credential.value ->> 'credentialId')::uuid,
  (source.value ->> 'sourceId')::uuid,
  (source.value -> 'forms' -> 0 ->> 'formId')::uuid,
  (credential.value ->> 'authorizationEpoch')::bigint
from external_lead_intake_contract_values credential
cross join external_lead_intake_contract_values source
where credential.value_name = 'credential'
  and source.value_name = 'source';

create function pg_temp.submit_external_inquiry(
  p_request_id uuid,
  p_idempotency_digest bytea,
  p_external_digest bytea,
  p_canonical_hash bytea,
  p_name text,
  p_email text,
  p_phone text,
  p_organization text,
  p_work text
) returns jsonb
language plpgsql
as $function$
declare
  v_fixture external_lead_intake_contract_fixture%rowtype;
  v_received_at timestamptz := clock_timestamp();
  v_original jsonb;
  v_canonical jsonb;
begin
  select * into strict v_fixture
  from external_lead_intake_contract_fixture;

  v_original := jsonb_strip_nulls(jsonb_build_object(
    'sourceId', 'src_contract',
    'formId', 'frm_contract',
    'contact', jsonb_strip_nulls(jsonb_build_object(
      'name', p_name,
      'email', p_email,
      'phone', p_phone,
      'phoneRegion', 'CA',
      'organizationName', p_organization
    )),
    'workSummary', p_work,
    'answers', '[]'::jsonb,
    'uploadIds', '[]'::jsonb,
    'externalSubmissionId', case
      when p_external_digest is null then null
      else 'external-contract-reference'
    end
  ));
  v_canonical := jsonb_build_object(
    'version', 1,
    'sourceId', 'src_contract',
    'formId', 'frm_contract',
    'contact', jsonb_strip_nulls(jsonb_build_object(
      'name', p_name,
      'email', p_email,
      'normalizedPhone', p_phone,
      'organizationName', p_organization
    )),
    'serviceAddress', null,
    'workSummary', p_work,
    'preferredTiming', null,
    'answers', '[]'::jsonb,
    'attribution', null,
    'uploadIds', '[]'::jsonb,
    'externalSubmissionId', case
      when p_external_digest is null then null
      else 'external-contract-reference'
    end
  );

  return public.create_external_intake_submission_as_system(
    p_request_id,
    v_fixture.principal_id,
    v_fixture.credential_id,
    v_fixture.company_id,
    1::smallint,
    decode(repeat('33', 32), 'hex'),
    'opsxint1',
    v_fixture.authorization_epoch,
    v_fixture.source_id,
    v_fixture.form_id,
    'https://lead-intake.example.invalid',
    1::smallint,
    p_idempotency_digest,
    jsonb_build_array(jsonb_build_object(
      'kid', 1,
      'digest', E'\\x' || encode(p_idempotency_digest, 'hex')
    )),
    case when p_external_digest is null then null else 1::smallint end,
    p_external_digest,
    case
      when p_external_digest is null then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object(
        'kid', 1,
        'digest', E'\\x' || encode(p_external_digest, 'hex')
      ))
    end,
    1::smallint,
    p_canonical_hash,
    1::smallint,
    v_original,
    v_canonical,
    jsonb_strip_nulls(jsonb_build_object(
      'name', p_name,
      'email', p_email,
      'phone', p_phone,
      'organizationName', p_organization
    )),
    '{}'::uuid[],
    '[]'::jsonb,
    '/v1/intake/submissions',
    'POST',
    v_received_at
  );
end;
$function$;

-- same_key_same_hash_replays
do $check$
declare
  v_first jsonb;
  v_replay jsonb;
  v_created_at timestamptz;
  v_created_at_after timestamptz;
begin
  v_first := pg_temp.submit_external_inquiry(
    'e3000000-0000-4000-8000-000000001001',
    decode(repeat('41', 32), 'hex'),
    null,
    decode(repeat('51', 32), 'hex'),
    'Replay Contact',
    'replay@example.invalid',
    null,
    null,
    'Replay inquiry'
  );
  select submission.created_at
  into strict v_created_at
  from private.external_intake_submissions submission
  where submission.public_submission_id
    = (v_first ->> 'public_submission_id')::uuid;

  v_replay := pg_temp.submit_external_inquiry(
    'e3000000-0000-4000-8000-000000001002',
    decode(repeat('41', 32), 'hex'),
    null,
    decode(repeat('51', 32), 'hex'),
    'Replay Contact',
    'replay@example.invalid',
    null,
    null,
    'Replay inquiry'
  );
  select submission.created_at
  into strict v_created_at_after
  from private.external_intake_submissions submission
  where submission.public_submission_id
    = (v_replay ->> 'public_submission_id')::uuid;

  if v_replay ->> 'status' <> 'replayed'
    or (v_replay ->> 'public_submission_id')
      is distinct from (v_first ->> 'public_submission_id')
    or v_created_at_after is distinct from v_created_at
  then
    raise exception 'same_key_same_hash_replays failed';
  end if;
  insert into external_lead_intake_contract_results
  values ('same_key_same_hash_replays', true, null);
end;
$check$;

-- same_key_changed_hash_conflicts
do $check$
declare
  v_result jsonb;
begin
  v_result := pg_temp.submit_external_inquiry(
    'e3000000-0000-4000-8000-000000001003',
    decode(repeat('41', 32), 'hex'),
    null,
    decode(repeat('52', 32), 'hex'),
    'Replay Contact',
    'replay@example.invalid',
    null,
    null,
    'Changed inquiry'
  );
  if v_result ->> 'status' <> 'idempotency_conflict' then
    raise exception 'same_key_changed_hash_conflicts failed';
  end if;
  insert into external_lead_intake_contract_results
  values ('same_key_changed_hash_conflicts', true, null);
end;
$check$;

-- external_id_replays_across_transport_keys
do $check$
declare
  v_first jsonb;
  v_replay jsonb;
begin
  v_first := pg_temp.submit_external_inquiry(
    'e3000000-0000-4000-8000-000000001004',
    decode(repeat('42', 32), 'hex'),
    decode(repeat('61', 32), 'hex'),
    decode(repeat('53', 32), 'hex'),
    'External Reference',
    'external-reference@example.invalid',
    null,
    null,
    'External reference inquiry'
  );
  v_replay := pg_temp.submit_external_inquiry(
    'e3000000-0000-4000-8000-000000001005',
    decode(repeat('43', 32), 'hex'),
    decode(repeat('61', 32), 'hex'),
    decode(repeat('53', 32), 'hex'),
    'External Reference',
    'external-reference@example.invalid',
    null,
    null,
    'External reference inquiry'
  );
  if v_replay ->> 'status' <> 'replayed'
    or (v_replay ->> 'public_lead_id')
      is distinct from (v_first ->> 'public_lead_id')
  then
    raise exception 'external_id_replays_across_transport_keys failed';
  end if;
  insert into external_lead_intake_contract_results
  values ('external_id_replays_across_transport_keys', true, null);
end;
$check$;

-- same_identity_creates_two_leads_one_customer
do $check$
declare
  v_before_clients bigint;
  v_before_leads bigint;
  v_after_clients bigint;
  v_after_leads bigint;
begin
  select count(*) into v_before_clients
  from public.clients client
  where client.company_id = 'e3000000-0000-4000-8000-000000000001'
    and client.email = 'identity@example.invalid';
  select count(*) into v_before_leads
  from public.opportunities opportunity
  where opportunity.company_id = 'e3000000-0000-4000-8000-000000000001';

  perform pg_temp.submit_external_inquiry(
    'e3000000-0000-4000-8000-000000001006',
    decode(repeat('44', 32), 'hex'),
    null,
    decode(repeat('54', 32), 'hex'),
    'Identity Contact',
    'identity@example.invalid',
    null,
    null,
    'First identity inquiry'
  );
  perform pg_temp.submit_external_inquiry(
    'e3000000-0000-4000-8000-000000001007',
    decode(repeat('45', 32), 'hex'),
    null,
    decode(repeat('55', 32), 'hex'),
    'Identity Contact',
    'identity@example.invalid',
    null,
    null,
    'Second identity inquiry'
  );

  select count(*) into v_after_clients
  from public.clients client
  where client.company_id = 'e3000000-0000-4000-8000-000000000001'
    and client.email = 'identity@example.invalid';
  select count(*) into v_after_leads
  from public.opportunities opportunity
  where opportunity.company_id = 'e3000000-0000-4000-8000-000000000001';

  if v_after_clients - v_before_clients <> 1
    or v_after_leads - v_before_leads <> 2
  then
    raise exception 'same_identity_creates_two_leads_one_customer failed';
  end if;
  insert into external_lead_intake_contract_results
  values ('same_identity_creates_two_leads_one_customer', true, null);
end;
$check$;

-- sub_client_match_preserves_parent
do $check$
declare
  v_first jsonb;
  v_second jsonb;
  v_parent_id uuid;
  v_sub_client_id uuid;
  v_opportunity public.opportunities%rowtype;
begin
  v_first := pg_temp.submit_external_inquiry(
    'e3000000-0000-4000-8000-000000001008',
    decode(repeat('46', 32), 'hex'),
    null,
    decode(repeat('56', 32), 'hex'),
    'Organization Contact',
    'organization-contact@example.invalid',
    '+16045550198',
    'Contract Organization',
    'First organization inquiry'
  );
  select submission.matched_client_id, submission.matched_sub_client_id
  into strict v_parent_id, v_sub_client_id
  from private.external_intake_submissions submission
  where submission.public_submission_id
    = (v_first ->> 'public_submission_id')::uuid;

  v_second := pg_temp.submit_external_inquiry(
    'e3000000-0000-4000-8000-000000001009',
    decode(repeat('47', 32), 'hex'),
    null,
    decode(repeat('57', 32), 'hex'),
    'Organization Contact',
    'organization-contact@example.invalid',
    '+16045550198',
    'Contract Organization',
    'Second organization inquiry'
  );
  select opportunity.*
  into strict v_opportunity
  from public.opportunities opportunity
  join private.external_lead_handles handle
    on handle.opportunity_id = opportunity.id
   and handle.company_id = opportunity.company_id
  where handle.public_lead_id = (v_second ->> 'public_lead_id')::uuid;

  if v_sub_client_id is null
    or v_opportunity.client_id is distinct from v_parent_id
    or v_opportunity.client_ref is distinct from v_parent_id
    or not exists (
      select 1
      from private.external_intake_submissions submission
      where submission.opportunity_id = v_opportunity.id
        and submission.matched_sub_client_id = v_sub_client_id
    )
  then
    raise exception 'sub_client_match_preserves_parent failed';
  end if;
  insert into external_lead_intake_contract_results
  values ('sub_client_match_preserves_parent', true, null);
end;
$check$;

-- created_possible_duplicate
do $check$
declare
  v_result jsonb;
begin
  insert into public.clients (
    company_id, name, email
  ) values (
    'e3000000-0000-4000-8000-000000000001',
    'Email Candidate',
    'conflict@example.invalid'
  );
  insert into public.clients (
    company_id, name, phone_number
  ) values (
    'e3000000-0000-4000-8000-000000000001',
    'Phone Candidate',
    '+16045550197'
  );

  v_result := pg_temp.submit_external_inquiry(
    'e3000000-0000-4000-8000-000000001010',
    decode(repeat('48', 32), 'hex'),
    null,
    decode(repeat('58', 32), 'hex'),
    'Conflict Contact',
    'conflict@example.invalid',
    '+16045550197',
    null,
    'Conflicting identifiers'
  );
  if v_result ->> 'customer_outcome' <> 'created_possible_duplicate'
    or v_result::text ~ 'candidate_entities|entity_id'
    or not exists (
      select 1
      from private.external_intake_possible_duplicates duplicate
      join private.external_intake_submissions submission
        on submission.id = duplicate.submission_id
      where submission.public_submission_id
        = (v_result ->> 'public_submission_id')::uuid
    )
  then
    raise exception 'created_possible_duplicate failed';
  end if;
  insert into external_lead_intake_contract_results
  values ('created_possible_duplicate', true, null);
end;
$check$;

-- uploads_commit_with_submission: structural atomicity proof. Runtime object
-- reconciliation is exercised by external-intake-upload-contract.sql; here the
-- foreign keys and unique claim fence prove a submission cannot retain a
-- dangling or multiply claimed upload row.
do $check$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname
      = 'external_intake_submission_uploads_intent_key'
  )
    or not exists (
      select 1
      from pg_constraint constraint_row
    where constraint_row.conname
      = 'external_intake_submission_uploads_submission_company_fkey'
  )
  then
    raise exception 'uploads_commit_with_submission failed';
  end if;
  insert into external_lead_intake_contract_results
  values ('uploads_commit_with_submission', true, null);
end;
$check$;

do $verification$
declare
  v_expected constant text[] := array[
    'same_key_same_hash_replays',
    'same_key_changed_hash_conflicts',
    'external_id_replays_across_transport_keys',
    'same_identity_creates_two_leads_one_customer',
    'sub_client_match_preserves_parent',
    'created_possible_duplicate',
    'uploads_commit_with_submission'
  ];
begin
  if exists (
    select expected.check_name
    from unnest(v_expected) expected(check_name)
    left join external_lead_intake_contract_results result
      on result.check_name = expected.check_name
     and result.passed
    where result.check_name is null
  ) then
    raise exception 'external lead intake contract did not complete';
  end if;
end;
$verification$;

select 'OPS_EXTERNAL_API_SQL_CONTRACT_PASS';

rollback;
