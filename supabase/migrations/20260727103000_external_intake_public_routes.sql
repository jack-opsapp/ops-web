-- ============================================================================
-- EXTERNAL INTAKE PUBLIC READS AND POST-COMMIT DELIVERY
--
-- Adds the fixed, service-role-only commands used by the public config/status
-- routes and a leased worker boundary for derived post-commit enrichment.
-- Every public read revalidates the credential and commits its authenticated
-- audit base in the same transaction as the result.
-- ============================================================================

begin;

do $prerequisites$
begin
  if to_regclass('private.external_intake_submissions') is null
    or to_regclass('private.external_intake_post_commit_outbox') is null
    or to_regprocedure(
      'private.require_external_intake_credential(uuid,uuid,uuid,smallint,bytea,text,bigint)'
    ) is null
    or to_regprocedure(
      'private.insert_external_api_authenticated_audit_base(uuid,uuid,uuid,text,text,timestamp with time zone)'
    ) is null
  then
    raise exception 'external_intake_public_routes_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.external_intake_submission_result(
  p_submission_id uuid,
  p_replayed boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_submission private.external_intake_submissions%rowtype;
  v_public_lead_id uuid;
  v_attachments jsonb;
  v_mailbox_id uuid;
begin
  select submission.*
  into v_submission
  from private.external_intake_submissions submission
  where submission.id = p_submission_id;

  if not found then
    raise exception 'external_intake_submission_not_found'
      using errcode = 'P0002';
  end if;

  select handle.public_lead_id
  into v_public_lead_id
  from private.external_lead_handles handle
  where handle.company_id = v_submission.company_id
    and handle.opportunity_id = v_submission.opportunity_id;

  if v_public_lead_id is null then
    raise exception 'external_intake_public_lead_missing'
      using errcode = '55000';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'public_upload_id', upload.public_upload_id,
        'caller_file_id', intent.caller_file_id,
        'state', upload.attachment_state,
        'safe_code', intent.safe_code
      )
      order by upload.ordinal
    ),
    '[]'::jsonb
  )
  into v_attachments
  from private.external_intake_submission_uploads upload
  join private.external_intake_upload_intents intent
    on intent.id = upload.intent_id
   and intent.company_id = upload.company_id
  where upload.submission_id = v_submission.id;

  select case
    when count(*) = 1 then (array_agg(connection.id order by connection.id))[1]
    else null
  end
  into v_mailbox_id
  from public.email_connections connection
  where private.try_parse_uuid(connection.company_id)
      = v_submission.company_id
    and connection.type::text = 'company'
    and connection.status = 'active';

  return jsonb_build_object(
    'status', case when p_replayed then 'replayed' else 'created' end,
    'public_submission_id', v_submission.public_submission_id,
    'public_lead_id', v_public_lead_id,
    'customer_outcome', v_submission.customer_outcome,
    'lead_created_at', (
      select opportunity.created_at
      from public.opportunities opportunity
      where opportunity.id = v_submission.opportunity_id
    ),
    'initial_lead_stage', 'new_lead',
    'replayed', p_replayed,
    'attachments', v_attachments,
    'email_correlation', case
      when v_mailbox_id is null then null
      else jsonb_build_object(
        'company_id', v_submission.company_id,
        'mailbox_id', v_mailbox_id,
        'source_id', v_submission.source_id,
        'submission_id', v_submission.id,
        'lead_id', v_submission.opportunity_id
      )
    end
  );
end;
$function$;

create or replace function public.get_external_intake_config_as_system(
  p_request_id uuid,
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_route text,
  p_method text,
  p_request_received_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_sources jsonb;
begin
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'public_source_id', source.public_source_id,
        'label', source.site_label,
        'canonical_site_host', source.canonical_host,
        'default_phone_region', source.default_phone_region,
        'default_owner_configured',
          source.default_intake_owner_id is not null
          and private.company_mailbox_intake_owner_is_eligible(
            source.default_intake_owner_id,
            source.company_id
          ),
        'forms', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'public_form_id', form_row.public_form_id,
                'label', form_row.label,
                'is_default', form_row.is_default
              )
              order by form_row.is_default desc, form_row.form_key
            ),
            '[]'::jsonb
          )
          from private.lead_intake_forms form_row
          where form_row.company_id = source.company_id
            and form_row.source_id = source.id
            and form_row.is_active
        )
      )
      order by source.site_label, source.public_source_id
    ),
    '[]'::jsonb
  )
  into v_sources
  from private.lead_intake_sources source
  join private.external_api_principal_sources source_grant
    on source_grant.source_id = source.id
   and source_grant.company_id = source.company_id
  where source.company_id = p_company_id
    and source.status = 'active'
    and source_grant.principal_id = p_principal_id
    and exists (
      select 1
      from private.lead_intake_forms form_row
      where form_row.company_id = source.company_id
        and form_row.source_id = source.id
        and form_row.is_active
        and form_row.is_default
    );

  return jsonb_build_object(
    'status', 'ready',
    'sources', v_sources
  );
end;
$function$;

create or replace function public.get_external_intake_submission_status_as_system(
  p_request_id uuid,
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_public_submission_id uuid,
  p_route text,
  p_method text,
  p_request_received_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_submission private.external_intake_submissions%rowtype;
  v_public_lead_id uuid;
  v_attachments jsonb;
  v_terminal boolean;
begin
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

  if p_public_submission_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select submission.*
  into v_submission
  from private.external_intake_submissions submission
  where submission.public_submission_id = p_public_submission_id
    and submission.company_id = p_company_id
    and submission.principal_id = p_principal_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select handle.public_lead_id
  into v_public_lead_id
  from private.external_lead_handles handle
  where handle.company_id = v_submission.company_id
    and handle.opportunity_id = v_submission.opportunity_id;

  if v_public_lead_id is null then
    raise exception 'external_intake_public_lead_missing'
      using errcode = '55000';
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'public_upload_id', claimed.public_upload_id,
          'caller_file_id', intent.caller_file_id,
          'state', private.external_intake_attachment_state(intent.state),
          'safe_code', intent.safe_code
        )
        order by claimed.ordinal
      ),
      '[]'::jsonb
    ),
    coalesce(
      bool_and(
        private.external_intake_attachment_state(intent.state)
          <> 'pending_inspection'
      ),
      true
    )
  into v_attachments, v_terminal
  from private.external_intake_submission_uploads claimed
  join private.external_intake_upload_intents intent
    on intent.id = claimed.intent_id
   and intent.company_id = claimed.company_id
  where claimed.submission_id = v_submission.id
    and claimed.company_id = v_submission.company_id;

  return jsonb_build_object(
    'status', 'found',
    'public_submission_id', v_submission.public_submission_id,
    'public_lead_id', v_public_lead_id,
    'created_at', v_submission.created_at,
    'customer_outcome', v_submission.customer_outcome,
    'attachments', v_attachments,
    'attachment_processing_terminal', v_terminal,
    'poll_after_seconds', case when v_terminal then null else 10 end
  );
end;
$function$;

create or replace function public.list_external_intake_email_correlation_sources_as_system(
  p_company_id uuid,
  p_mailbox_id uuid
) returns uuid[]
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_source_ids uuid[];
begin
  perform private.require_external_api_service_role();
  perform 1
  from public.email_connections connection
  where connection.id = p_mailbox_id
    and private.try_parse_uuid(connection.company_id) = p_company_id
    and connection.type::text = 'company'
    and connection.status = 'active';
  if not found then
    return '{}'::uuid[];
  end if;

  select coalesce(
    array_agg(source.id order by source.id),
    '{}'::uuid[]
  )
  into v_source_ids
  from private.lead_intake_sources source
  where source.company_id = p_company_id;
  return v_source_ids;
end;
$function$;

create or replace function public.resolve_external_intake_email_correlation_as_system(
  p_company_id uuid,
  p_mailbox_id uuid,
  p_source_id uuid,
  p_submission_id uuid,
  p_opportunity_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_client_id uuid;
begin
  perform private.require_external_api_service_role();
  perform 1
  from public.email_connections connection
  where connection.id = p_mailbox_id
    and private.try_parse_uuid(connection.company_id) = p_company_id
    and connection.type::text = 'company'
    and connection.status = 'active';
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select opportunity.client_id
  into v_client_id
  from private.external_intake_submissions submission
  join public.opportunities opportunity
    on opportunity.id = submission.opportunity_id
   and opportunity.company_id = submission.company_id
  where submission.id = p_submission_id
    and submission.company_id = p_company_id
    and submission.source_id = p_source_id
    and submission.opportunity_id = p_opportunity_id
    and opportunity.deleted_at is null;

  if not found or v_client_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object(
    'status', 'found',
    'opportunity_id', p_opportunity_id,
    'client_id', v_client_id
  );
end;
$function$;

create or replace function public.claim_external_intake_post_commit_outbox_as_system(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 300
) returns table (
  outbox_id uuid,
  lease_token uuid,
  company_id uuid,
  opportunity_id uuid,
  original_context jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform private.require_external_api_service_role();
  if p_worker_id is null
    or char_length(btrim(p_worker_id)) not between 1 and 128
    or p_worker_id ~ '[[:cntrl:]]'
    or p_limit is null
    or p_limit not between 1 and 25
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 900
  then
    raise exception 'external_intake_outbox_claim_invalid'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select outbox.id
    from private.external_intake_post_commit_outbox outbox
    where (
        outbox.state = 'pending'
        and outbox.available_at <= clock_timestamp()
      )
      or (
        outbox.state = 'processing'
        and outbox.lease_expires_at <= clock_timestamp()
      )
    order by outbox.available_at, outbox.created_at, outbox.id
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update private.external_intake_post_commit_outbox outbox
    set state = 'processing',
        attempt_count = outbox.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at =
          clock_timestamp() + make_interval(secs => p_lease_seconds),
        last_error_code = null,
        updated_at = clock_timestamp()
    from candidates
    where outbox.id = candidates.id
    returning outbox.*
  )
  select
    claimed.id,
    claimed.lease_token,
    claimed.company_id,
    claimed.opportunity_id,
    jsonb_build_object(
      'work', submission.original_work,
      'serviceAddress', submission.original_service_address,
      'answers', submission.ordered_answers,
      'occurredAt', submission.created_at
    )
  from claimed
  join private.external_intake_submissions submission
    on submission.id = claimed.submission_id
   and submission.company_id = claimed.company_id
  order by claimed.created_at, claimed.id;
end;
$function$;

create or replace function public.complete_external_intake_post_commit_outbox_as_system(
  p_outbox_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_changed boolean;
begin
  perform private.require_external_api_service_role();
  update private.external_intake_post_commit_outbox outbox
  set state = 'complete',
      lease_token = null,
      lease_expires_at = null,
      completed_at = clock_timestamp(),
      last_error_code = null,
      updated_at = clock_timestamp()
  where outbox.id = p_outbox_id
    and outbox.state = 'processing'
    and outbox.lease_token = p_lease_token
    and outbox.lease_expires_at > clock_timestamp();
  v_changed := found;
  return v_changed;
end;
$function$;

create or replace function public.retry_external_intake_post_commit_outbox_as_system(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_changed boolean;
begin
  perform private.require_external_api_service_role();
  if p_error_code is null
    or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$'
  then
    raise exception 'external_intake_outbox_retry_invalid'
      using errcode = '22023';
  end if;

  update private.external_intake_post_commit_outbox outbox
  set state = 'pending',
      available_at = clock_timestamp() + make_interval(
        secs => least(3600, (15 * power(2, least(outbox.attempt_count, 8)))::integer)
      ),
      lease_token = null,
      lease_expires_at = null,
      last_error_code = p_error_code,
      updated_at = clock_timestamp()
  where outbox.id = p_outbox_id
    and outbox.state = 'processing'
    and outbox.lease_token = p_lease_token;
  v_changed := found;
  return v_changed;
end;
$function$;

revoke all on function public.get_external_intake_config_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, text, text,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.get_external_intake_config_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, text, text,
  timestamptz
) to service_role;

revoke all on function public.get_external_intake_submission_status_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, text, text,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.get_external_intake_submission_status_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, text, text,
  timestamptz
) to service_role;

revoke all on function public.list_external_intake_email_correlation_sources_as_system(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.list_external_intake_email_correlation_sources_as_system(
  uuid, uuid
) to service_role;

revoke all on function public.resolve_external_intake_email_correlation_as_system(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_external_intake_email_correlation_as_system(
  uuid, uuid, uuid, uuid, uuid
) to service_role;

revoke all on function public.claim_external_intake_post_commit_outbox_as_system(
  text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_external_intake_post_commit_outbox_as_system(
  text, integer, integer
) to service_role;

revoke all on function public.complete_external_intake_post_commit_outbox_as_system(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.complete_external_intake_post_commit_outbox_as_system(
  uuid, uuid
) to service_role;

revoke all on function public.retry_external_intake_post_commit_outbox_as_system(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.retry_external_intake_post_commit_outbox_as_system(
  uuid, uuid, text
) to service_role;

commit;
