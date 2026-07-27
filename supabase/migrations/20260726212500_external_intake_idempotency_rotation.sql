begin;

-- Rotation-safe upload replay. Historical keyed digests are lookup-only;
-- only the active digest is written for a genuinely new batch. The company
-- quota row serializes candidate lookup and the existing reservation command,
-- including during an application key-ring rollout.

create or replace function public.reserve_external_intake_upload_batch_rotating_as_system(
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
  p_idempotency_candidates jsonb,
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
  v_candidate jsonb;
  v_candidate_count integer;
  v_matching_batch_ids uuid[];
  v_existing private.external_intake_upload_batches%rowtype;
  v_selected_digest_version smallint;
  v_selected_digest bytea;
begin
  perform private.require_external_api_service_role();

  if p_request_id is null
    or p_principal_id is null
    or p_credential_id is null
    or p_company_id is null
    or p_idempotency_digest_version is null
    or p_idempotency_digest_version <= 0
    or p_idempotency_digest is null
    or octet_length(p_idempotency_digest) <> 32
    or p_idempotency_candidates is null
    or jsonb_typeof(p_idempotency_candidates) <> 'array'
  then
    raise exception 'external_intake_idempotency_candidates_invalid'
      using errcode = '22023';
  end if;

  v_candidate_count := jsonb_array_length(p_idempotency_candidates);
  if v_candidate_count < 1 or v_candidate_count > 32 then
    raise exception 'external_intake_idempotency_candidates_invalid'
      using errcode = '22023';
  end if;

  for v_candidate in
    select candidate.value
    from jsonb_array_elements(p_idempotency_candidates) candidate(value)
  loop
    if jsonb_typeof(v_candidate) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_candidate) key_name
        where key_name not in ('kid', 'digest')
      )
      or coalesce(v_candidate ->> 'kid', '') !~ '^[1-9][0-9]{0,4}$'
      or (v_candidate ->> 'kid')::integer > 32767
      or char_length(coalesce(v_candidate ->> 'digest', '')) <> 66
      or left(v_candidate ->> 'digest', 2) <> E'\\x'
      or substring(v_candidate ->> 'digest' from 3)
        !~ '^[0-9a-f]{64}$'
    then
      raise exception 'external_intake_idempotency_candidates_invalid'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(distinct candidate.value ->> 'kid')
    from jsonb_array_elements(p_idempotency_candidates) candidate(value)
  ) <> v_candidate_count
    or (
      select count(distinct candidate.value ->> 'digest')
      from jsonb_array_elements(p_idempotency_candidates) candidate(value)
    ) <> v_candidate_count
    or not exists (
      select 1
      from jsonb_array_elements(p_idempotency_candidates) candidate(value)
      where (candidate.value ->> 'kid')::smallint
          = p_idempotency_digest_version
        and decode(
          substring(candidate.value ->> 'digest' from 3),
          'hex'
        ) = p_idempotency_digest
    )
  then
    raise exception 'external_intake_idempotency_candidates_invalid'
      using errcode = '22023';
  end if;

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

  select array_agg(batch.id order by batch.created_at, batch.id)
  into v_matching_batch_ids
  from private.external_intake_upload_batches batch
  where batch.principal_id = p_principal_id
    and batch.company_id = p_company_id
    and exists (
      select 1
      from jsonb_array_elements(p_idempotency_candidates) candidate(value)
      where (candidate.value ->> 'kid')::smallint
          = batch.idempotency_digest_version
        and decode(
          substring(candidate.value ->> 'digest' from 3),
          'hex'
        ) = batch.idempotency_digest
    );

  if coalesce(cardinality(v_matching_batch_ids), 0) > 1 then
    raise exception 'external_intake_idempotency_split_brain'
      using errcode = '55000';
  end if;

  v_selected_digest_version := p_idempotency_digest_version;
  v_selected_digest := p_idempotency_digest;
  if coalesce(cardinality(v_matching_batch_ids), 0) = 1 then
    select batch.*
    into strict v_existing
    from private.external_intake_upload_batches batch
    where batch.id = v_matching_batch_ids[1]
      and batch.company_id = p_company_id
    for update;

    v_selected_digest_version := v_existing.idempotency_digest_version;
    v_selected_digest := v_existing.idempotency_digest;
  end if;

  return public.reserve_external_intake_upload_batch_as_system(
    p_request_id,
    p_principal_id,
    p_credential_id,
    p_company_id,
    p_digest_version,
    p_credential_digest,
    p_visible_prefix,
    p_authorization_epoch,
    p_source_public_id,
    p_form_public_id,
    v_selected_digest_version,
    v_selected_digest,
    p_manifest_hash_version,
    p_manifest_hash,
    p_files,
    p_requested_origin,
    p_capability_expires_at,
    p_delete_not_before,
    p_batch_expires_at,
    p_route,
    p_method,
    p_request_received_at
  );
end;
$function$;

-- Remove the pre-key-ring entry point. An old application instance fails
-- closed during rollout instead of creating a ledger under a digest that the
-- rotating wrapper did not inspect.
revoke all on function public.reserve_external_intake_upload_batch_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid,
  smallint, bytea, smallint, bytea, jsonb, text, timestamptz, timestamptz,
  timestamptz, text, text, timestamptz
) from public, anon, authenticated, service_role;

revoke all on function public.reserve_external_intake_upload_batch_rotating_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid,
  smallint, bytea, jsonb, smallint, bytea, jsonb, text, timestamptz,
  timestamptz, timestamptz, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_external_intake_upload_batch_rotating_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid,
  smallint, bytea, jsonb, smallint, bytea, jsonb, text, timestamptz,
  timestamptz, timestamptz, text, text, timestamptz
) to service_role;

comment on function public.reserve_external_intake_upload_batch_rotating_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid,
  smallint, bytea, jsonb, smallint, bytea, jsonb, text, timestamptz,
  timestamptz, timestamptz, text, text, timestamptz
) is
  'Rotation-safe upload reservation: retained digests resolve replay, while only the active digest can create a batch.';

commit;
