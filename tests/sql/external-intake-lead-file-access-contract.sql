begin;

-- Rollback-only executable contract for website attachment projection,
-- guarded descriptors, conversion convergence, and privacy erasure.

set local lock_timeout = '10s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';
select set_config('request.jwt.claim.role', 'service_role', true);

create temp table external_intake_file_values (
  value_name text primary key,
  value jsonb not null
) on commit drop;

insert into public.companies (
  id, bubble_id, name, subscription_status, subscription_plan
) values (
  'f4000000-0000-4000-8000-000000000001',
  'external-intake-file-contract-company',
  'External Intake File Contract',
  'trial',
  'trial'
);

insert into public.users (
  id, bubble_id, company_id, first_name, last_name, email, role,
  is_company_admin, is_active, deleted_at
) values (
  'f4000000-0000-4000-8000-000000000101',
  'external-intake-file-contract-owner',
  'f4000000-0000-4000-8000-000000000001',
  'File',
  'Owner',
  'file-owner@example.invalid',
  'owner',
  true,
  true,
  null
);

insert into public.admin_feature_overrides (
  id, company_id, feature_key, enabled, enabled_by, enabled_at, metadata
) values (
  'f4000000-0000-4000-8000-000000000201',
  'f4000000-0000-4000-8000-000000000001',
  'external_api',
  true,
  'f4000000-0000-4000-8000-000000000101',
  clock_timestamp(),
  '{"contract_fixture":true}'::jsonb
);

insert into external_intake_file_values (value_name, value)
values (
  'source',
  public.create_lead_intake_source_as_system(
    'f4000000-0000-4000-8000-000000000101',
    'File Contract Site',
    'file-contract.example.invalid',
    'CA',
    array['https://file-contract.example.invalid']::text[],
    'website',
    null,
    null
  )
);

insert into external_intake_file_values (value_name, value)
values (
  'credential',
  public.create_external_api_credential_as_system(
    'f4000000-0000-4000-8000-000000000101',
    'File contract key',
    'intake',
    array['intake.write']::text[],
    array[(
      select (value ->> 'sourceId')::uuid
      from external_intake_file_values
      where value_name = 'source'
    )]::uuid[],
    1::smallint,
    decode(repeat('f4', 32), 'hex'),
    'opsxfile',
    clock_timestamp() + interval '1 day'
  )
);

insert into public.clients (
  id, company_id, name, email, created_at, updated_at
) values (
  'f4000000-0000-4000-8000-000000000301',
  'f4000000-0000-4000-8000-000000000001',
  'File Contract Client',
  'client@example.invalid',
  clock_timestamp(),
  clock_timestamp()
);

insert into public.opportunities (
  id, company_id, client_id, client_ref, title, description, contact_name,
  contact_email, stage, source, created_at, updated_at
) values (
  'f4000000-0000-4000-8000-000000000401',
  'f4000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000301',
  'f4000000-0000-4000-8000-000000000301',
  'Website file contract',
  'Guarded attachment fixture',
  'File Contract Client',
  'client@example.invalid',
  'new_lead',
  'website',
  clock_timestamp(),
  clock_timestamp()
);

insert into public.projects (
  id, company_id, client_id, opportunity_id, title, status, created_at, updated_at
) values (
  'f4000000-0000-4000-8000-000000000501',
  'f4000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000301',
  'f4000000-0000-4000-8000-000000000401',
  'Website file project',
  'active',
  clock_timestamp(),
  clock_timestamp()
);

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
)
select
  'f4000000-0000-4000-8000-000000000601',
  'f4000000-0000-4000-8000-000000000001',
  (credential.value ->> 'principalId')::uuid,
  (credential.value ->> 'credentialId')::uuid,
  (
    select intake_source.id
    from private.lead_intake_sources intake_source
    where intake_source.public_source_id =
      (source.value ->> 'sourceId')::uuid
  ),
  (
    select intake_form.id
    from private.lead_intake_forms intake_form
    where intake_form.public_form_id =
      (source.value -> 'forms' -> 0 ->> 'formId')::uuid
  ),
  1,
  decode(repeat('61', 32), 'hex'),
  1,
  decode(repeat('62', 32), 'hex'),
  4096,
  2,
  clock_timestamp() + interval '10 minutes'
from external_intake_file_values credential
cross join external_intake_file_values source
where credential.value_name = 'credential'
  and source.value_name = 'source';

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
  state,
  capability_expires_at,
  delete_not_before,
  object_version_id,
  observed_size_bytes,
  observed_checksum_sha256,
  uploaded_at
) values
(
  'f4000000-0000-4000-8000-000000000701',
  'f4000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000601',
  'f4000000-0000-4000-8000-000000000711',
  1,
  'photo-1',
  'jobsite.jpg',
  2048,
  'image/jpeg',
  decode(repeat('71', 32), 'hex'),
  'quarantine/f4000000-0000-4000-8000-000000000001/f4000000-0000-4000-8000-000000000101/f4000000-0000-4000-8000-000000000601/f4000000-0000-4000-8000-000000000701',
  'accepted',
  clock_timestamp() + interval '5 minutes',
  clock_timestamp() + interval '6 minutes',
  'quarantine-v1',
  2048,
  decode(repeat('71', 32), 'hex'),
  clock_timestamp()
),
(
  'f4000000-0000-4000-8000-000000000702',
  'f4000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000601',
  'f4000000-0000-4000-8000-000000000712',
  2,
  'document-1',
  'plans.pdf',
  2048,
  'application/pdf',
  decode(repeat('72', 32), 'hex'),
  'quarantine/f4000000-0000-4000-8000-000000000001/f4000000-0000-4000-8000-000000000101/f4000000-0000-4000-8000-000000000601/f4000000-0000-4000-8000-000000000702',
  'pending_inspection',
  clock_timestamp() + interval '5 minutes',
  clock_timestamp() + interval '6 minutes',
  'quarantine-v2',
  2048,
  decode(repeat('72', 32), 'hex'),
  clock_timestamp()
);

insert into private.external_intake_submissions (
  id,
  public_submission_id,
  company_id,
  principal_id,
  credential_id,
  source_id,
  form_id,
  opportunity_id,
  matched_client_id,
  normalized_email,
  customer_outcome,
  evidence_schema_version,
  canonicalization_version,
  canonical_request_hash,
  original_contact,
  original_organization,
  original_work,
  original_service_address,
  ordered_answers,
  raw_attribution,
  raw_source_payload,
  external_reference
)
select
  'f4000000-0000-4000-8000-000000000801',
  'f4000000-0000-4000-8000-000000000811',
  'f4000000-0000-4000-8000-000000000001',
  (credential.value ->> 'principalId')::uuid,
  (credential.value ->> 'credentialId')::uuid,
  (
    select intake_source.id
    from private.lead_intake_sources intake_source
    where intake_source.public_source_id =
      (source.value ->> 'sourceId')::uuid
  ),
  (
    select intake_form.id
    from private.lead_intake_forms intake_form
    where intake_form.public_form_id =
      (source.value -> 'forms' -> 0 ->> 'formId')::uuid
  ),
  'f4000000-0000-4000-8000-000000000401',
  'f4000000-0000-4000-8000-000000000301',
  'client@example.invalid',
  'matched',
  1,
  1,
  decode(repeat('81', 32), 'hex'),
  '{"name":"File Contract Client","email":"client@example.invalid"}'::jsonb,
  '{}'::jsonb,
  '{"summary":"Build from plans"}'::jsonb,
  '{}'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb,
  '{"provider":"contract"}'::jsonb,
  '{}'::jsonb
from external_intake_file_values credential
cross join external_intake_file_values source
where credential.value_name = 'credential'
  and source.value_name = 'source';

insert into private.external_intake_submission_uploads (
  submission_id,
  company_id,
  intent_id,
  public_upload_id,
  ordinal,
  attachment_state
) values
(
  'f4000000-0000-4000-8000-000000000801',
  'f4000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000701',
  'f4000000-0000-4000-8000-000000000711',
  1,
  'accepted'
),
(
  'f4000000-0000-4000-8000-000000000801',
  'f4000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000702',
  'f4000000-0000-4000-8000-000000000712',
  2,
  'pending_inspection'
);

insert into private.external_intake_inspection_jobs (
  id,
  company_id,
  intent_id,
  status,
  generation,
  attempts,
  first_queued_at,
  deadline_at,
  detected_content_type,
  delivery_mode,
  accepted_object_key,
  accepted_object_version_id,
  accepted_size_bytes,
  accepted_checksum_sha256,
  completed_at
) values (
  'f4000000-0000-4000-8000-000000000901',
  'f4000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000701',
  'complete',
  1,
  1,
  statement_timestamp(),
  statement_timestamp() + interval '24 hours',
  'image/jpeg',
  'inline_image',
  'safe-derivative/f4000000-0000-4000-8000-000000000001/f4000000-0000-4000-8000-000000000701/f4000000-0000-4000-8000-000000000921.jpg',
  'safe-v1',
  1024,
  decode(repeat('91', 32), 'hex'),
  clock_timestamp()
);

insert into private.external_intake_delivery_objects (
  id,
  inspection_id,
  intent_id,
  company_id,
  generation,
  delivery_mode,
  storage_object_key,
  state,
  object_version_id,
  size_bytes,
  checksum_sha256,
  published_at
) values
(
  'f4000000-0000-4000-8000-000000000911',
  'f4000000-0000-4000-8000-000000000901',
  'f4000000-0000-4000-8000-000000000701',
  'f4000000-0000-4000-8000-000000000001',
  1,
  'attachment',
  'accepted-original/f4000000-0000-4000-8000-000000000001/f4000000-0000-4000-8000-000000000701/f4000000-0000-4000-8000-000000000920',
  'published',
  'original-v1',
  2048,
  decode(repeat('92', 32), 'hex'),
  clock_timestamp()
),
(
  'f4000000-0000-4000-8000-000000000912',
  'f4000000-0000-4000-8000-000000000901',
  'f4000000-0000-4000-8000-000000000701',
  'f4000000-0000-4000-8000-000000000001',
  1,
  'inline_image',
  'safe-derivative/f4000000-0000-4000-8000-000000000001/f4000000-0000-4000-8000-000000000701/f4000000-0000-4000-8000-000000000921.jpg',
  'published',
  'safe-v1',
  1024,
  decode(repeat('91', 32), 'hex'),
  clock_timestamp()
);

-- Scan-before-conversion: the first file is already clean when the lead links.
update public.opportunities
set project_ref = 'f4000000-0000-4000-8000-000000000501',
    project_id = 'f4000000-0000-4000-8000-000000000501',
    updated_at = clock_timestamp()
where id = 'f4000000-0000-4000-8000-000000000401';

do $$
declare
  v_job record;
  v_result jsonb;
begin
  for v_job in
    select *
    from public.claim_external_intake_project_file_projections_as_system(
      'file-contract-worker',
      10,
      360
    )
  loop
    v_result :=
      public.finish_external_intake_project_file_projection_as_system(
        v_job.id,
        'file-contract-worker',
        v_job.lease_generation,
        v_job.lease_token,
        'project',
        null,
        null
      );
  end loop;

  if (
    select count(*)
    from private.external_intake_project_file_relationships
    where project_id = 'f4000000-0000-4000-8000-000000000501'
  ) <> 1 then
    raise exception 'scan_before_conversion_projection_failed';
  end if;
end
$$;

-- Conversion-before-scan: acceptance arrives later and makes the existing
-- pending job immediately claimable without creating another relationship.
insert into private.external_intake_inspection_jobs (
  id,
  company_id,
  intent_id,
  status,
  generation,
  attempts,
  first_queued_at,
  deadline_at,
  detected_content_type,
  delivery_mode,
  accepted_object_key,
  accepted_object_version_id,
  accepted_size_bytes,
  accepted_checksum_sha256,
  completed_at
) values (
  'f4000000-0000-4000-8000-000000000902',
  'f4000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000702',
  'complete',
  1,
  1,
  statement_timestamp(),
  statement_timestamp() + interval '24 hours',
  'application/pdf',
  'attachment',
  'accepted-original/f4000000-0000-4000-8000-000000000001/f4000000-0000-4000-8000-000000000702/f4000000-0000-4000-8000-000000000922',
  'document-v1',
  2048,
  decode(repeat('93', 32), 'hex'),
  clock_timestamp()
);

insert into private.external_intake_delivery_objects (
  id,
  inspection_id,
  intent_id,
  company_id,
  generation,
  delivery_mode,
  storage_object_key,
  state,
  object_version_id,
  size_bytes,
  checksum_sha256,
  published_at
) values (
  'f4000000-0000-4000-8000-000000000913',
  'f4000000-0000-4000-8000-000000000902',
  'f4000000-0000-4000-8000-000000000702',
  'f4000000-0000-4000-8000-000000000001',
  1,
  'attachment',
  'accepted-original/f4000000-0000-4000-8000-000000000001/f4000000-0000-4000-8000-000000000702/f4000000-0000-4000-8000-000000000922',
  'published',
  'document-v1',
  2048,
  decode(repeat('93', 32), 'hex'),
  clock_timestamp()
);

update private.external_intake_upload_intents
set state = 'accepted',
    updated_at = clock_timestamp()
where id = 'f4000000-0000-4000-8000-000000000702';

do $$
declare
  v_job record;
begin
  select *
  into strict v_job
  from public.claim_external_intake_project_file_projections_as_system(
    'file-contract-worker',
    10,
    360
  )
  where intent_id = 'f4000000-0000-4000-8000-000000000702';

  perform public.finish_external_intake_project_file_projection_as_system(
    v_job.id,
    'file-contract-worker',
    v_job.lease_generation,
    v_job.lease_token,
    'project',
    null,
    null
  );

  if (
    select count(*)
    from private.external_intake_project_file_relationships
    where project_id = 'f4000000-0000-4000-8000-000000000501'
  ) <> 2 then
    raise exception 'conversion_before_scan_projection_failed';
  end if;

  perform private.enqueue_external_intake_project_files(
    'f4000000-0000-4000-8000-000000000001',
    'f4000000-0000-4000-8000-000000000401',
    'f4000000-0000-4000-8000-000000000501',
    null
  );
  if exists (
    select 1
    from public.claim_external_intake_project_file_projections_as_system(
      'file-contract-replay',
      10,
      360
    )
  ) then
    raise exception 'duplicate_projection_replayed';
  end if;
end
$$;

do $$
declare
  v_context jsonb;
  v_resolution jsonb;
  v_project_files jsonb;
begin
  v_context := public.get_opportunity_assigned_context(
    'f4000000-0000-4000-8000-000000000401'
  );
  if jsonb_array_length(v_context -> 'intake_attachments') <> 2
    or v_context::text like '%storage_object_key%'
    or v_context::text like '%object_version_id%'
  then
    raise exception 'guarded_attachment_descriptor_failed';
  end if;

  v_project_files := public.list_project_intake_files(
    'f4000000-0000-4000-8000-000000000501'
  );
  if jsonb_array_length(v_project_files) <> 2
    or v_project_files::text like '%accepted-original%'
    or v_project_files::text like '%safe-derivative%'
  then
    raise exception 'guarded_project_file_descriptor_failed';
  end if;

  v_resolution := public.resolve_external_intake_attachment_as_system(
    'f4000000-0000-4000-8000-000000000101',
    'f4000000-0000-4000-8000-000000000401',
    'f4000000-0000-4000-8000-000000000711',
    'preview'
  );
  if v_resolution ->> 'delivery_mode' <> 'inline_image' then
    raise exception 'guarded_preview_resolution_failed';
  end if;

  if public.resolve_external_intake_attachment_as_system(
    'f4000000-0000-4000-8000-000000000101',
    'f4000000-0000-4000-8000-000000000401',
    'f4000000-0000-4000-8000-000000000712',
    'preview'
  ) is not null then
    raise exception 'document_inline_resolution_failed';
  end if;
end
$$;

select public.request_external_intake_erasure_as_system(
  'f4000000-0000-4000-8000-000000000801',
  'f4000000-0000-4000-8000-000000000101',
  'privacy_officer',
  'Verified deletion request'
);

do $$
begin
  if jsonb_array_length(
    private.external_intake_attachment_descriptors(
      'f4000000-0000-4000-8000-000000000401'
    )
  ) <> 0 then
    raise exception 'privacy_request_did_not_block_visibility';
  end if;

  update private.external_intake_erasure_outbox
  set not_before = clock_timestamp() - interval '1 second',
      available_at = clock_timestamp() - interval '1 second'
  where submission_id = 'f4000000-0000-4000-8000-000000000801';
end
$$;

do $$
declare
  v_erasure record;
begin
  select *
  into strict v_erasure
  from public.claim_external_intake_erasures_as_system(
    'file-contract-eraser',
    5,
    360
  );

  if jsonb_array_length(v_erasure.storage_objects) <> 5
    or jsonb_array_length(v_erasure.invalidation_paths) <> 3
  then
    raise exception 'privacy_erasure_object_manifest_failed';
  end if;

  if not public.finish_external_intake_erasure_as_system(
    v_erasure.id,
    'file-contract-eraser',
    v_erasure.lease_generation,
    v_erasure.lease_token,
    'deleted',
    'contract-invalidation',
    null,
    null
  ) then
    raise exception 'privacy_erasure_finish_failed';
  end if;

  if exists (
    select 1
    from private.external_intake_project_file_relationships
    where submission_id = 'f4000000-0000-4000-8000-000000000801'
  ) or exists (
    select 1
    from private.external_intake_project_file_projection_outbox
    where submission_id = 'f4000000-0000-4000-8000-000000000801'
  ) then
    raise exception 'privacy_erasure_project_link_failed';
  end if;

  if not exists (
    select 1
    from private.external_intake_submissions submission
    where submission.id = 'f4000000-0000-4000-8000-000000000801'
      and submission.normalized_email is null
      and submission.normalized_phone is null
      and submission.raw_source_payload
        = '{"state":"privacy_erased"}'::jsonb
      and submission.personal_evidence_tombstone
        = '{"state":"privacy_erased"}'::jsonb
  ) then
    raise exception 'privacy_erasure_submission_tombstone_failed';
  end if;

  if exists (
    select 1
    from private.external_intake_upload_intents intent
    where intent.id in (
      'f4000000-0000-4000-8000-000000000701',
      'f4000000-0000-4000-8000-000000000702'
    )
      and (
        intent.original_filename <> 'privacy-erased'
        or intent.expected_checksum_sha256 is not null
        or intent.observed_checksum_sha256 is not null
      )
  ) then
    raise exception 'privacy_erasure_upload_metadata_failed';
  end if;

  if not exists (
    select 1
    from private.external_lead_projection_versions version
    join private.external_lead_handles handle
      on handle.id = version.handle_id
     and handle.company_id = version.company_id
    where handle.opportunity_id =
      'f4000000-0000-4000-8000-000000000401'
      and version.operation = 'deletion'
      and version.public_projection
        = '{"state":"privacy_erased"}'::jsonb
  ) then
    raise exception 'privacy_erasure_projection_tombstone_failed';
  end if;
end
$$;

rollback;
