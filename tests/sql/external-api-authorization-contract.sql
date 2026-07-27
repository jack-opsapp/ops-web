begin;

-- Rollback-only executable contract for the external API authorization
-- foundation. Run only after the full migration chain is applied to an
-- isolated local database or an explicitly approved disposable branch.

set local lock_timeout = '10s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select set_config('request.jwt.claim.role', 'service_role', true);

create temp table external_api_contract_results (
  check_name text primary key,
  passed boolean not null,
  details text
) on commit drop;

create temp table external_api_contract_values (
  value_name text primary key,
  value jsonb not null
) on commit drop;

create temp table external_api_projection_results (
  ordinal integer primary key,
  public_lead_id uuid not null,
  change_sequence bigint not null
) on commit drop;

insert into public.companies (
  id,
  bubble_id,
  name,
  subscription_status,
  subscription_plan
) values
  (
    'e1000000-0000-4000-8000-000000000001',
    'external-api-contract-company-a',
    'External API Contract A',
    'trial',
    'trial'
  ),
  (
    'e1000000-0000-4000-8000-000000000002',
    'external-api-contract-company-b',
    'External API Contract B',
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
) values
  (
    'e1000000-0000-4000-8000-000000000101',
    'external-api-contract-owner-a',
    'e1000000-0000-4000-8000-000000000001',
    'External',
    'Owner A',
    'external-api-owner-a@example.invalid',
    'owner',
    true,
    true,
    null
  ),
  (
    'e1000000-0000-4000-8000-000000000102',
    'external-api-contract-owner-b',
    'e1000000-0000-4000-8000-000000000002',
    'External',
    'Owner B',
    'external-api-owner-b@example.invalid',
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
) values
  (
    'e1000000-0000-4000-8000-000000000201',
    'e1000000-0000-4000-8000-000000000001',
    'external_api',
    true,
    'e1000000-0000-4000-8000-000000000101',
    clock_timestamp(),
    '{"contract_fixture":true}'::jsonb
  ),
  (
    'e1000000-0000-4000-8000-000000000202',
    'e1000000-0000-4000-8000-000000000002',
    'external_api',
    true,
    'e1000000-0000-4000-8000-000000000102',
    clock_timestamp(),
    '{"contract_fixture":true}'::jsonb
  );

insert into external_api_contract_values (value_name, value)
values (
  'source_a',
  public.create_lead_intake_source_as_system(
    'e1000000-0000-4000-8000-000000000101',
    'Website A',
    'a.example.invalid',
    'CA',
    array['https://a.example.invalid']::text[],
    'website',
    null,
    '[{"key":"quote","label":"Quote request","active":true}]'::jsonb
  )
);

insert into external_api_contract_values (value_name, value)
values (
  'source_b',
  public.create_lead_intake_source_as_system(
    'e1000000-0000-4000-8000-000000000102',
    'Website B',
    'b.example.invalid',
    'US',
    array['https://b.example.invalid']::text[],
    'website',
    null,
    null
  )
);

insert into external_api_contract_results (
  check_name,
  passed
)
select
  'default_form_is_stable',
  count(*) = 1
  and bool_and(form_row.form_key = 'default')
  and bool_and(form_row.is_default)
  and bool_and(form_row.is_active)
from private.lead_intake_forms form_row
join private.lead_intake_sources source
  on source.id = form_row.source_id
where source.public_source_id = (
  select (value ->> 'sourceId')::uuid
  from external_api_contract_values
  where value_name = 'source_a'
)
  and form_row.is_default;

insert into external_api_contract_results (check_name, passed)
select
  'null_create_forms_means_default_only',
  count(*) = 1
  and bool_and(form_row.form_key = 'default')
  and bool_and(form_row.is_default)
from private.lead_intake_forms form_row
join private.lead_intake_sources source
  on source.id = form_row.source_id
where source.public_source_id = (
  select (value ->> 'sourceId')::uuid
  from external_api_contract_values
  where value_name = 'source_b'
);

insert into external_api_contract_values (value_name, value)
values (
  'source_a_after_null_forms_update',
  public.update_lead_intake_source_as_system(
    'e1000000-0000-4000-8000-000000000101',
    (
      select (value ->> 'sourceId')::uuid
      from external_api_contract_values
      where value_name = 'source_a'
    ),
    (
      select (value ->> 'updatedAt')::timestamptz
      from external_api_contract_values
      where value_name = 'source_a'
    ),
    'Website A',
    'a.example.invalid',
    'CA',
    array['https://a.example.invalid']::text[],
    'website',
    null,
    true,
    null
  )
);

insert into external_api_contract_results (check_name, passed)
select
  'null_update_forms_preserves_custom_forms',
  count(*) = 2
  and count(*) filter (
    where form_row.form_key = 'quote'
      and form_row.is_active
  ) = 1
from private.lead_intake_forms form_row
join private.lead_intake_sources source
  on source.id = form_row.source_id
where source.public_source_id = (
  select (value ->> 'sourceId')::uuid
  from external_api_contract_values
  where value_name = 'source_a'
);

-- Cross-company actor and caller-selected source denial ----------------------

do $contract$
begin
  begin
    perform public.update_lead_intake_source_as_system(
      'e1000000-0000-4000-8000-000000000102',
      (
        select (value ->> 'sourceId')::uuid
        from external_api_contract_values
        where value_name = 'source_a'
      ),
      (
        select (value ->> 'updatedAt')::timestamptz
        from external_api_contract_values
        where value_name = 'source_a'
      ),
      'Cross-tenant attempt',
      'a.example.invalid',
      'CA',
      array['https://a.example.invalid']::text[],
      'website',
      null,
      true,
      null
    );
    insert into external_api_contract_results
      values ('cross_company_actor_denied', false, 'call unexpectedly succeeded');
  exception
    when sqlstate 'P0002' then
      insert into external_api_contract_results
        values ('cross_company_actor_denied', true, null);
  end;

  begin
    perform public.create_external_api_credential_as_system(
      'e1000000-0000-4000-8000-000000000101',
      'Cross-source attempt',
      'intake',
      array['intake.write']::text[],
      array[(
        select (value ->> 'sourceId')::uuid
        from external_api_contract_values
        where value_name = 'source_b'
      )]::uuid[],
      1::smallint,
      decode(repeat('09', 32), 'hex'),
      'opsxsrc1',
      clock_timestamp() + interval '30 days'
    );
    insert into external_api_contract_results
      values ('cross_company_source_denied', false, 'call unexpectedly succeeded');
  exception
    when sqlstate '42501' then
      insert into external_api_contract_results
        values ('cross_company_source_denied', true, null);
  end;
end;
$contract$;

insert into external_api_contract_results (
  check_name,
  passed,
  details
)
select
  'caller_selected_company_parameter_absent',
  bool_and(
    not coalesce(procedure.proargnames, '{}'::text[])
      @> array['p_company_id']::text[]
  ),
  null
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in (
    'authenticate_external_api_credential_as_system',
    'list_external_api_settings_as_system',
    'create_lead_intake_source_as_system',
    'update_lead_intake_source_as_system',
    'create_external_api_credential_as_system',
    'update_external_api_credential_as_system',
    'rotate_external_api_credential_as_system',
    'revoke_external_api_credential_as_system',
    'record_external_api_request_audit_as_system',
    'purge_external_api_network_fingerprints_as_system'
  );

-- Scope and class constraints ------------------------------------------------

do $contract$
begin
  begin
    perform public.create_external_api_credential_as_system(
      'e1000000-0000-4000-8000-000000000101',
      'Mixed class attempt',
      'intake',
      array['intake.write', 'analytics.leads.read']::text[],
      array[(
        select (value ->> 'sourceId')::uuid
        from external_api_contract_values
        where value_name = 'source_a'
      )]::uuid[],
      1::smallint,
      decode(repeat('0a', 32), 'hex'),
      'opsmixed',
      clock_timestamp() + interval '30 days'
    );
    insert into external_api_contract_results
      values ('mixed_server_key_scope_denied', false, 'call unexpectedly succeeded');
  exception
    when sqlstate '22023' then
      insert into external_api_contract_results
        values ('mixed_server_key_scope_denied', true, null);
  end;

  begin
    perform public.create_external_api_credential_as_system(
      'e1000000-0000-4000-8000-000000000101',
      'Financial-only attempt',
      'analytics',
      array['analytics.financial.read']::text[],
      '{}'::uuid[],
      1::smallint,
      decode(repeat('0b', 32), 'hex'),
      'opsfin01',
      clock_timestamp() + interval '30 days'
    );
    insert into external_api_contract_results
      values ('financial_without_lead_read_denied', false, 'call unexpectedly succeeded');
  exception
    when sqlstate '22023' then
      insert into external_api_contract_results
        values ('financial_without_lead_read_denied', true, null);
  end;
end;
$contract$;

-- Required NULL arguments fail closed without state mutation -----------------

do $contract$
declare
  v_source_count bigint;
  v_credential_count bigint;
begin
  select count(*)
  into v_source_count
  from private.lead_intake_sources;

  begin
    perform public.create_lead_intake_source_as_system(
      'e1000000-0000-4000-8000-000000000101',
      'Missing coarse source',
      'null-source.example.invalid',
      'CA',
      array['https://null-source.example.invalid']::text[],
      null,
      null,
      null
    );
    insert into external_api_contract_results
      values (
        'nullable_default_source_denied',
        false,
        'call unexpectedly succeeded'
      );
  exception
    when sqlstate '22023' then
      insert into external_api_contract_results (check_name, passed)
      select
        'nullable_default_source_denied',
        count(*) = v_source_count
      from private.lead_intake_sources;
  end;

  begin
    perform public.update_lead_intake_source_as_system(
      'e1000000-0000-4000-8000-000000000101',
      (
        select (value ->> 'sourceId')::uuid
        from external_api_contract_values
        where value_name = 'source_a_after_null_forms_update'
      ),
      (
        select (value ->> 'updatedAt')::timestamptz
        from external_api_contract_values
        where value_name = 'source_a_after_null_forms_update'
      ),
      'Website A',
      'a.example.invalid',
      'CA',
      array['https://a.example.invalid']::text[],
      'website',
      null,
      null,
      null
    );
    insert into external_api_contract_results
      values (
        'nullable_source_active_denied',
        false,
        'call unexpectedly succeeded'
      );
  exception
    when sqlstate '22023' then
      insert into external_api_contract_results (check_name, passed)
      select
        'nullable_source_active_denied',
        source.status = 'active'
        and source.updated_at = (
          select (value ->> 'updatedAt')::timestamptz
          from external_api_contract_values
          where value_name = 'source_a_after_null_forms_update'
        )
      from private.lead_intake_sources source
      where source.public_source_id = (
        select (value ->> 'sourceId')::uuid
        from external_api_contract_values
        where value_name = 'source_a_after_null_forms_update'
      );
  end;

  select count(*)
  into v_credential_count
  from private.external_api_credentials;

  begin
    perform public.create_external_api_credential_as_system(
      'e1000000-0000-4000-8000-000000000101',
      'Missing class',
      null,
      array['intake.write']::text[],
      array[(
        select (value ->> 'sourceId')::uuid
        from external_api_contract_values
        where value_name = 'source_a'
      )]::uuid[],
      1::smallint,
      decode(repeat('0c', 32), 'hex'),
      'opsnullc',
      clock_timestamp() + interval '30 days'
    );
    insert into external_api_contract_results
      values (
        'nullable_credential_class_denied',
        false,
        'call unexpectedly succeeded'
      );
  exception
    when sqlstate '22023' then
      insert into external_api_contract_results (check_name, passed)
      select
        'nullable_credential_class_denied',
        count(*) = v_credential_count
      from private.external_api_credentials;
  end;

  begin
    perform public.create_external_api_credential_as_system(
      'e1000000-0000-4000-8000-000000000101',
      'Missing scopes',
      'intake',
      null,
      array[(
        select (value ->> 'sourceId')::uuid
        from external_api_contract_values
        where value_name = 'source_a'
      )]::uuid[],
      1::smallint,
      decode(repeat('0d', 32), 'hex'),
      'opsnulls',
      clock_timestamp() + interval '30 days'
    );
    insert into external_api_contract_results
      values (
        'nullable_credential_scopes_denied',
        false,
        'call unexpectedly succeeded'
      );
  exception
    when sqlstate '22023' then
      insert into external_api_contract_results (check_name, passed)
      select
        'nullable_credential_scopes_denied',
        count(*) = v_credential_count
      from private.external_api_credentials;
  end;

  begin
    perform public.record_external_api_request_audit_as_system(
      null,
      'e1000000-0000-4000-8000-000000000905',
      '/v1/intake/submissions',
      'POST',
      clock_timestamp(),
      'rejected',
      'invalid_credential',
      4::smallint,
      1,
      'allowed',
      'not_applicable',
      'not_applicable',
      null,
      null,
      null,
      null,
      null,
      null
    );
    insert into external_api_contract_results
      values (
        'nullable_audit_phase_denied',
        false,
        'call unexpectedly succeeded'
      );
  exception
    when sqlstate '22023' then
      insert into external_api_contract_results (check_name, passed)
      select
        'nullable_audit_phase_denied',
        not exists (
          select 1
          from private.external_api_request_audit audit_row
          where audit_row.request_id =
            'e1000000-0000-4000-8000-000000000905'
        );
  end;

  begin
    perform public.record_external_api_request_audit_as_system(
      'pre_auth',
      'e1000000-0000-4000-8000-000000000906',
      '/v1/intake/submissions',
      'POST',
      clock_timestamp(),
      'rejected',
      'invalid_credential',
      4::smallint,
      1,
      'allowed',
      'not_applicable',
      'not_applicable',
      null,
      null,
      null,
      null,
      null,
      'opsorphan'
    );
    insert into external_api_contract_results
      values (
        'fingerprint_prefix_without_digest_denied',
        false,
        'orphan prefix unexpectedly succeeded'
      );
  exception
    when sqlstate '22023' then
      insert into external_api_contract_results (check_name, passed)
      select
        'fingerprint_prefix_without_digest_denied',
        not exists (
          select 1
          from private.external_api_request_audit audit_row
          where audit_row.request_id =
            'e1000000-0000-4000-8000-000000000906'
        );
  end;
end;
$contract$;

-- Active authentication and rotation identity -------------------------------

insert into external_api_contract_values (value_name, value)
values (
  'credential_a',
  public.create_external_api_credential_as_system(
    'e1000000-0000-4000-8000-000000000101',
    'Website A intake',
    'intake',
    array['intake.write']::text[],
    array[(
      select (value ->> 'sourceId')::uuid
      from external_api_contract_values
      where value_name = 'source_a'
    )]::uuid[],
    1::smallint,
    decode(repeat('11', 32), 'hex'),
    'opsinta1',
    clock_timestamp() + interval '30 days'
  )
);

insert into external_api_contract_results (check_name, passed)
select
  'active_credential_authenticates',
  authentication.authenticated
from public.authenticate_external_api_credential_as_system(
  1::smallint,
  decode(repeat('11', 32), 'hex'),
  'opsinta1'
) authentication;

insert into external_api_contract_results (check_name, passed)
select
  'invalid_credential_redacts_identity',
  not authentication.authenticated
  and authentication.denial_code = 'invalid_credential'
  and authentication.principal_id is null
  and authentication.credential_id is null
  and authentication.company_id is null
  and authentication.credential_class is null
  and authentication.scopes is null
  and authentication.allowed_source_ids is null
  and authentication.authorization_epoch is null
from public.authenticate_external_api_credential_as_system(
  1::smallint,
  decode(repeat('10', 32), 'hex'),
  'opsnone1'
) authentication;

update public.admin_feature_overrides feature
set enabled = false
where feature.company_id =
    'e1000000-0000-4000-8000-000000000001'
  and feature.feature_key = 'external_api';

insert into external_api_contract_results (check_name, passed)
select
  'feature_disabled_denial_redacts_identity',
  not authentication.authenticated
  and authentication.denial_code = 'feature_disabled'
  and authentication.principal_id is null
  and authentication.credential_id is null
  and authentication.company_id is null
  and authentication.credential_class is null
  and authentication.scopes is null
  and authentication.allowed_source_ids is null
  and authentication.authorization_epoch is null
from public.authenticate_external_api_credential_as_system(
  1::smallint,
  decode(repeat('11', 32), 'hex'),
  'opsinta1'
) authentication;

update public.admin_feature_overrides feature
set enabled = true
where feature.company_id =
    'e1000000-0000-4000-8000-000000000001'
  and feature.feature_key = 'external_api';

insert into external_api_contract_values (value_name, value)
values (
  'rotation_a',
  public.rotate_external_api_credential_as_system(
    'e1000000-0000-4000-8000-000000000101',
    (
      select (value ->> 'credentialId')::uuid
      from external_api_contract_values
      where value_name = 'credential_a'
    ),
    (
      select (value ->> 'updatedAt')::timestamptz
      from external_api_contract_values
      where value_name = 'credential_a'
    ),
    1::smallint,
    decode(repeat('12', 32), 'hex'),
    'opsinta2',
    3600,
    clock_timestamp() + interval '30 days'
  )
);

insert into external_api_contract_results (check_name, passed)
select
  'rotation_preserves_principal',
  (
    select value ->> 'principalId'
    from external_api_contract_values
    where value_name = 'credential_a'
  ) = (
    select value ->> 'principalId'
    from external_api_contract_values
    where value_name = 'rotation_a'
  );

insert into external_api_contract_results (check_name, passed)
select
  'rotation_overlap_authenticates_both_keys',
  (
    select authentication.authenticated
    from public.authenticate_external_api_credential_as_system(
      1::smallint,
      decode(repeat('11', 32), 'hex'),
      'opsinta1'
    ) authentication
  )
  and (
    select authentication.authenticated
    from public.authenticate_external_api_credential_as_system(
      1::smallint,
      decode(repeat('12', 32), 'hex'),
      'opsinta2'
    ) authentication
  );

insert into external_api_contract_values (value_name, value)
values (
  'source_a_inactive',
  public.update_lead_intake_source_as_system(
    'e1000000-0000-4000-8000-000000000101',
    (
      select (value ->> 'sourceId')::uuid
      from external_api_contract_values
      where value_name = 'source_a_after_null_forms_update'
    ),
    (
      select (value ->> 'updatedAt')::timestamptz
      from external_api_contract_values
      where value_name = 'source_a_after_null_forms_update'
    ),
    'Website A',
    'a.example.invalid',
    'CA',
    array['https://a.example.invalid']::text[],
    'website',
    null,
    false,
    null
  )
);

insert into external_api_contract_results (check_name, passed)
select
  'inactive_granted_source_denies_and_redacts_identity',
  not authentication.authenticated
  and authentication.denial_code = 'invalid_credential'
  and authentication.principal_id is null
  and authentication.credential_id is null
  and authentication.company_id is null
  and authentication.credential_class is null
  and authentication.scopes is null
  and authentication.allowed_source_ids is null
  and authentication.authorization_epoch is null
from public.authenticate_external_api_credential_as_system(
  1::smallint,
  decode(repeat('12', 32), 'hex'),
  'opsinta2'
) authentication;

do $contract$
begin
  begin
    perform private.insert_external_api_authenticated_audit_base(
      'e1000000-0000-4000-8000-000000000907',
      (
        select (value ->> 'principalId')::uuid
        from external_api_contract_values
        where value_name = 'rotation_a'
      ),
      (
        select (value ->> 'credentialId')::uuid
        from external_api_contract_values
        where value_name = 'rotation_a'
      ),
      '/v1/intake/submissions',
      'POST',
      clock_timestamp()
    );
    insert into external_api_contract_results
      values (
        'inactive_source_cannot_create_authenticated_audit',
        false,
        'inactive source unexpectedly created an authenticated audit base'
      );
  exception
    when sqlstate '42501' then
      insert into external_api_contract_results (check_name, passed)
      select
        'inactive_source_cannot_create_authenticated_audit',
        not exists (
          select 1
          from private.external_api_request_audit audit_row
          where audit_row.request_id =
            'e1000000-0000-4000-8000-000000000907'
        );
  end;
end;
$contract$;

insert into external_api_contract_values (value_name, value)
values (
  'source_a_reactivated',
  public.update_lead_intake_source_as_system(
    'e1000000-0000-4000-8000-000000000101',
    (
      select (value ->> 'sourceId')::uuid
      from external_api_contract_values
      where value_name = 'source_a_inactive'
    ),
    (
      select (value ->> 'updatedAt')::timestamptz
      from external_api_contract_values
      where value_name = 'source_a_inactive'
    ),
    'Website A',
    'a.example.invalid',
    'CA',
    array['https://a.example.invalid']::text[],
    'website',
    null,
    true,
    null
  )
);

insert into external_api_contract_results (check_name, passed)
select
  'source_reactivation_restores_authentication',
  authentication.authenticated
from public.authenticate_external_api_credential_as_system(
  1::smallint,
  decode(repeat('12', 32), 'hex'),
  'opsinta2'
) authentication;

-- Expired and old-epoch fixtures --------------------------------------------

insert into private.external_api_principals (
  id,
  company_id,
  credential_family_id,
  principal_type,
  credential_class,
  scopes,
  status,
  authorization_epoch,
  granted_by_user_id
) values
  (
    'e1000000-0000-4000-8000-000000000301',
    'e1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000401',
    'server_key',
    'analytics',
    array['analytics.leads.read']::text[],
    'active',
    1,
    'e1000000-0000-4000-8000-000000000101'
  ),
  (
    'e1000000-0000-4000-8000-000000000302',
    'e1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000402',
    'server_key',
    'analytics',
    array['analytics.leads.read']::text[],
    'active',
    1,
    'e1000000-0000-4000-8000-000000000101'
  );

insert into private.external_api_credentials (
  id,
  company_id,
  principal_id,
  name,
  digest_version,
  secret_digest,
  visible_prefix,
  issued_authorization_epoch,
  status,
  expires_at,
  created_by_user_id,
  created_at,
  updated_at
) values
  (
    'e1000000-0000-4000-8000-000000000501',
    'e1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000301',
    'Expired fixture',
    1,
    decode(repeat('21', 32), 'hex'),
    'opsanex1',
    1,
    'active',
    clock_timestamp() - interval '1 day',
    'e1000000-0000-4000-8000-000000000101',
    clock_timestamp() - interval '2 days',
    clock_timestamp() - interval '2 days'
  ),
  (
    'e1000000-0000-4000-8000-000000000502',
    'e1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000302',
    'Old epoch fixture',
    1,
    decode(repeat('22', 32), 'hex'),
    'opsanep1',
    1,
    'active',
    clock_timestamp() + interval '30 days',
    'e1000000-0000-4000-8000-000000000101',
    clock_timestamp(),
    clock_timestamp()
  );

update private.external_api_principals principal
set authorization_epoch = 2,
    updated_at = clock_timestamp()
where principal.id = 'e1000000-0000-4000-8000-000000000302';

insert into external_api_contract_results (check_name, passed)
select
  'expired_credential_denied',
  not authentication.authenticated
  and authentication.denial_code = 'invalid_credential'
  and authentication.principal_id is null
  and authentication.credential_id is null
  and authentication.company_id is null
  and authentication.credential_class is null
  and authentication.scopes is null
  and authentication.allowed_source_ids is null
  and authentication.authorization_epoch is null
from public.authenticate_external_api_credential_as_system(
  1::smallint,
  decode(repeat('21', 32), 'hex'),
  'opsanex1'
) authentication;

insert into external_api_contract_results (check_name, passed)
select
  'old_epoch_credential_denied',
  not authentication.authenticated
  and authentication.denial_code = 'invalid_credential'
  and authentication.principal_id is null
  and authentication.credential_id is null
  and authentication.company_id is null
  and authentication.credential_class is null
  and authentication.scopes is null
  and authentication.allowed_source_ids is null
  and authentication.authorization_epoch is null
from public.authenticate_external_api_credential_as_system(
  1::smallint,
  decode(repeat('22', 32), 'hex'),
  'opsanep1'
) authentication;

-- Direct ACLs and service-only wrapper bodies --------------------------------

insert into external_api_contract_results (check_name, passed)
select
  'private_tables_deny_app_roles',
  bool_and(
    not has_table_privilege(
      role_name,
      table_name,
      privilege_name
    )
  )
from unnest(array['anon', 'authenticated', 'service_role']) role_name
cross join unnest(array[
  'private.external_api_principals',
  'private.external_api_principal_sources',
  'private.external_api_credentials',
  'private.lead_intake_sources',
  'private.lead_intake_forms',
  'private.external_api_request_audit',
  'private.external_api_network_fingerprints',
  'private.external_api_security_events',
  'private.external_lead_handles',
  'private.external_attribution_dictionary',
  'private.external_attribution_lookup_digests',
  'private.external_lead_source_projections',
  'private.external_lead_projection_state',
  'private.external_lead_projection_versions',
  'private.external_lead_projection_baselines'
]) table_name
cross join unnest(array[
  'select',
  'insert',
  'update',
  'delete'
]) privilege_name;

insert into external_api_contract_results (check_name, passed)
select
  'private_functions_deny_app_roles',
  count(*) = 63
  and bool_and(
    not has_function_privilege(role_name, procedure.oid, 'execute')
  )
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace
  on namespace.oid = procedure.pronamespace
cross join unnest(
  array['anon', 'authenticated', 'service_role']
) role_name
where namespace.nspname = 'private'
  and procedure.proname in (
    'guard_external_api_request_audit_mutation',
    'reject_external_api_audit_mutation',
    'reject_external_lead_projection_version_mutation',
    'require_external_api_service_role',
    'lock_external_api_company_shared',
    'lock_external_api_company_exclusive',
    'lock_external_api_feature_override_mutation',
    'external_api_company_feature_enabled',
    'require_external_api_management_actor',
    'append_external_api_security_event',
    'external_api_origins_are_valid',
    'guard_lead_intake_source_owner',
    'assert_lead_intake_source_default_form',
    'guard_lead_intake_form_identity',
    'replace_lead_intake_source_forms',
    'guard_external_api_principal_source',
    'assert_external_api_principal_source_policy',
    'guard_external_api_credential_identity',
    'external_api_safe_tokens',
    'insert_external_api_authenticated_audit_base',
    'append_external_lead_projection_foundation'
  );

insert into external_api_contract_results (check_name, passed)
select
  'public_wrappers_are_service_only',
  count(*) = 30
  and bool_and(
    has_function_privilege(role_name, procedure.oid, 'execute')
      = (role_name = 'service_role')
  )
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace
  on namespace.oid = procedure.pronamespace
cross join unnest(
  array['anon', 'authenticated', 'service_role']
) role_name
where namespace.nspname = 'public'
  and procedure.proname in (
    'authenticate_external_api_credential_as_system',
    'list_external_api_settings_as_system',
    'create_lead_intake_source_as_system',
    'update_lead_intake_source_as_system',
    'create_external_api_credential_as_system',
    'update_external_api_credential_as_system',
    'rotate_external_api_credential_as_system',
    'revoke_external_api_credential_as_system',
    'record_external_api_request_audit_as_system',
    'purge_external_api_network_fingerprints_as_system'
  );

do $contract$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    perform public.list_external_api_settings_as_system(
      'e1000000-0000-4000-8000-000000000101'
    );
    insert into external_api_contract_results
      values ('public_wrapper_body_role_guard', false, 'call unexpectedly succeeded');
  exception
    when sqlstate '42501' then
      insert into external_api_contract_results
        values ('public_wrapper_body_role_guard', true, null);
  end;
  perform set_config('request.jwt.claim.role', 'service_role', true);
end;
$contract$;

-- Redacted audit, strict request identity, and finalize-once semantics --------

insert into external_api_contract_results (
  check_name,
  passed
)
select
  'audit_surface_has_no_sensitive_fields',
  not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'private'
      and column_row.table_name in (
        'external_api_request_audit',
        'external_api_network_fingerprints',
        'external_api_security_events'
      )
      and column_row.column_name in (
        'authorization_header',
        'raw_secret',
        'request_body',
        'signed_url',
        'ip_address',
        'email',
        'phone',
        'message',
        'file_content'
      )
  )
  and not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    cross join unnest(coalesce(procedure.proargnames, '{}'::text[])) argument
    where namespace.nspname = 'public'
      and procedure.proname = 'record_external_api_request_audit_as_system'
      and argument in (
        'p_authorization_header',
        'p_raw_secret',
        'p_request_body',
        'p_signed_url',
        'p_ip_address'
      )
  );

do $contract$
begin
  begin
    perform public.record_external_api_request_audit_as_system(
      'pre_auth',
      'e1000000-0000-4000-8000-000000000901',
      'https://evil.invalid/file?X-Amz-Signature=secret',
      'POST',
      clock_timestamp(),
      'rejected',
      'invalid_credential',
      4::smallint,
      1,
      'allowed',
      'not_applicable',
      'not_applicable',
      null,
      null,
      null,
      1::smallint,
      decode(repeat('31', 32), 'hex'),
      'opsbad01'
    );
    insert into external_api_contract_results
      values ('audit_signed_link_rejected', false, 'call unexpectedly succeeded');
  exception
    when sqlstate '23514' then
      insert into external_api_contract_results
        values ('audit_signed_link_rejected', true, null);
  end;
end;
$contract$;

select private.insert_external_api_authenticated_audit_base(
  'e1000000-0000-4000-8000-000000000902',
  (
    select (value ->> 'principalId')::uuid
    from external_api_contract_values
    where value_name = 'credential_a'
  ),
  (
    select (value ->> 'credentialId')::uuid
    from external_api_contract_values
    where value_name = 'credential_a'
  ),
  '/v1/intake/submissions',
  'POST',
  clock_timestamp()
);

do $contract$
begin
  begin
    perform private.insert_external_api_authenticated_audit_base(
      'e1000000-0000-4000-8000-000000000902',
      (
        select (value ->> 'principalId')::uuid
        from external_api_contract_values
        where value_name = 'credential_a'
      ),
      (
        select (value ->> 'credentialId')::uuid
        from external_api_contract_values
        where value_name = 'credential_a'
      ),
      '/v1/intake/submissions',
      'POST',
      clock_timestamp()
    );
    insert into external_api_contract_results
      values ('request_id_is_not_idempotency', false, 'duplicate unexpectedly succeeded');
  exception
    when unique_violation then
      insert into external_api_contract_results
        values ('request_id_is_not_idempotency', true, null);
  end;

  begin
    perform public.record_external_api_request_audit_as_system(
      'finalize',
      'e1000000-0000-4000-8000-000000000902',
      null,
      null,
      null,
      'accepted',
      'Bearer raw-secret-must-not-fit',
      2::smallint,
      8,
      'allowed',
      'new',
      'not_applicable',
      null,
      null,
      1,
      null,
      null,
      null
    );
    insert into external_api_contract_results
      values ('audit_finalization_failure_preserves_base', false, 'unsafe finalization unexpectedly succeeded');
  exception
    when sqlstate '22023' then
      insert into external_api_contract_results (
        check_name,
        passed,
        details
      )
      select
        'audit_finalization_failure_preserves_base',
        audit_row.finalized_at is null
          and audit_row.outcome = 'authenticated',
        null
      from private.external_api_request_audit audit_row
      where audit_row.request_id =
        'e1000000-0000-4000-8000-000000000902';
  end;
end;
$contract$;

select public.record_external_api_request_audit_as_system(
  'finalize',
  'e1000000-0000-4000-8000-000000000902',
  null,
  null,
  null,
  'accepted',
  null,
  2::smallint,
  8,
  'allowed',
  'new',
  'not_applicable',
  null,
  null,
  1,
  null,
  null,
  null
);

insert into external_api_contract_results (check_name, passed)
select
  'authenticated_audit_finalizes_once',
  audit_row.finalized_at is not null
  and audit_row.response_class = 2
  and audit_row.result_size = 1
from private.external_api_request_audit audit_row
where audit_row.request_id =
  'e1000000-0000-4000-8000-000000000902';

do $contract$
begin
  begin
    perform public.record_external_api_request_audit_as_system(
      'finalize',
      'e1000000-0000-4000-8000-000000000902',
      null,
      null,
      null,
      'error',
      'second_finalize_must_fail',
      5::smallint,
      999,
      'denied',
      'conflict',
      'bypass',
      null,
      null,
      999,
      null,
      null,
      null
    );
    insert into external_api_contract_results
      values (
        'authenticated_audit_rejects_second_finalize',
        false,
        'second finalization unexpectedly succeeded'
      );
  exception
    when sqlstate '23505' then
      insert into external_api_contract_results (check_name, passed)
      select
        'authenticated_audit_rejects_second_finalize',
        audit_row.outcome = 'accepted'
        and audit_row.response_class = 2
        and audit_row.duration_ms = 8
        and audit_row.result_size = 1
      from private.external_api_request_audit audit_row
      where audit_row.request_id =
        'e1000000-0000-4000-8000-000000000902';
  end;
end;
$contract$;

select public.record_external_api_request_audit_as_system(
  'pre_auth',
  'e1000000-0000-4000-8000-000000000903',
  '/v1/intake/submissions',
  'POST',
  clock_timestamp(),
  'rejected',
  'invalid_credential',
  4::smallint,
  2,
  'allowed',
  'not_applicable',
  'not_applicable',
  null,
  null,
  null,
  1::smallint,
  decode(repeat('32', 32), 'hex'),
  'opsbad02'
);

insert into external_api_contract_results (check_name, passed)
select
  'network_fingerprint_has_hard_30_day_expiry',
  fingerprint.expires_at > fingerprint.captured_at
  and fingerprint.expires_at
    <= fingerprint.captured_at + interval '30 days'
  and octet_length(fingerprint.fingerprint_digest) = 32
from private.external_api_network_fingerprints fingerprint
where fingerprint.request_id =
  'e1000000-0000-4000-8000-000000000903';

select public.revoke_external_api_credential_as_system(
  'e1000000-0000-4000-8000-000000000101',
  (
    select (value ->> 'credentialId')::uuid
    from external_api_contract_values
    where value_name = 'rotation_a'
  ),
  'owner_revoked'
);

insert into external_api_contract_results (check_name, passed)
select
  'revoked_credential_denied',
  not authentication.authenticated
  and authentication.denial_code = 'invalid_credential'
  and authentication.principal_id is null
  and authentication.credential_id is null
  and authentication.company_id is null
  and authentication.credential_class is null
  and authentication.scopes is null
  and authentication.allowed_source_ids is null
  and authentication.authorization_epoch is null
from public.authenticate_external_api_credential_as_system(
  1::smallint,
  decode(repeat('12', 32), 'hex'),
  'opsinta2'
) authentication;

insert into external_api_contract_results (check_name, passed)
select
  'revocation_invalidates_entire_credential_family',
  count(*) = 2
  and bool_and(credential.status = 'revoked')
from private.external_api_credentials credential
where credential.principal_id = (
  select (value ->> 'principalId')::uuid
  from external_api_contract_values
  where value_name = 'rotation_a'
);

do $contract$
begin
  begin
    perform private.insert_external_api_authenticated_audit_base(
      'e1000000-0000-4000-8000-000000000904',
      (
        select (value ->> 'principalId')::uuid
        from external_api_contract_values
        where value_name = 'rotation_a'
      ),
      (
        select (value ->> 'credentialId')::uuid
        from external_api_contract_values
        where value_name = 'rotation_a'
      ),
      '/v1/intake/submissions',
      'POST',
      clock_timestamp()
    );
    insert into external_api_contract_results
      values (
        'revoked_credential_cannot_create_authenticated_audit',
        false,
        'revoked identity unexpectedly created an authenticated audit base'
      );
  exception
    when sqlstate '42501' then
      insert into external_api_contract_results
        values (
          'revoked_credential_cannot_create_authenticated_audit',
          true,
          null
        );
  end;
end;
$contract$;

-- Minimal stable projection and attribution foundation -----------------------

select set_config('ops.external_projection_refreshing', 'on', true);

insert into public.opportunities (
  id,
  company_id,
  title,
  stage,
  source,
  created_at,
  updated_at
) values (
  'e1000000-0000-4000-8000-000000000601',
  'e1000000-0000-4000-8000-000000000001',
  'External API projection fixture',
  'new_lead',
  'website',
  clock_timestamp(),
  clock_timestamp()
);

insert into external_api_projection_results (
  ordinal,
  public_lead_id,
  change_sequence
)
select
  1,
  result.public_lead_id,
  result.change_sequence
from private.append_external_lead_projection_foundation(
  'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000601',
  1::smallint,
  'upsert',
  '{"sourceChannel":"website"}'::jsonb,
  '{"recordState":"active","stage":"new_lead"}'::jsonb,
  clock_timestamp()
) result;

insert into external_api_projection_results (
  ordinal,
  public_lead_id,
  change_sequence
)
select
  2,
  result.public_lead_id,
  result.change_sequence
from private.append_external_lead_projection_foundation(
  'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000601',
  1::smallint,
  'upsert',
  '{"sourceChannel":"website"}'::jsonb,
  '{"recordState":"active","stage":"qualifying"}'::jsonb,
  clock_timestamp()
) result;

select set_config('ops.external_projection_refreshing', 'off', true);

insert into external_api_contract_results (check_name, passed)
select
  'projection_sequence_is_company_monotonic',
  first_result.public_lead_id = second_result.public_lead_id
  and first_result.change_sequence = 1
  and second_result.change_sequence = 2
  and state.high_water_sequence = 2
from external_api_projection_results first_result
join external_api_projection_results second_result
  on second_result.ordinal = 2
join private.external_lead_projection_state state
  on state.company_id =
    'e1000000-0000-4000-8000-000000000001'
where first_result.ordinal = 1;

insert into external_api_contract_results (check_name, passed)
select
  'projection_baseline_tracks_latest_version',
  baseline.latest_sequence = 2
  and baseline.public_projection ->> 'stage' = 'qualifying'
  and (
    select count(*)
    from private.external_lead_projection_versions version
    where version.company_id = baseline.company_id
      and version.handle_id = baseline.handle_id
  ) = 2
from private.external_lead_projection_baselines baseline
where baseline.public_lead_id = (
  select public_lead_id
  from external_api_projection_results
  where ordinal = 1
);

do $contract$
begin
  begin
    update private.external_lead_projection_versions version
    set public_projection = '{"tampered":true}'::jsonb
    where version.company_id =
      'e1000000-0000-4000-8000-000000000001';
    insert into external_api_contract_results
      values ('projection_versions_are_append_only', false, 'update unexpectedly succeeded');
  exception
    when sqlstate '42501' then
      insert into external_api_contract_results
        values ('projection_versions_are_append_only', true, null);
  end;

  begin
    perform private.append_external_lead_projection_foundation(
      'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000601',
      1::smallint,
      'upsert',
      '{"sourceChannel":"website"}'::jsonb,
      '{"recordState":"active"}'::jsonb,
      clock_timestamp()
    );
    insert into external_api_contract_results
      values ('cross_company_projection_denied', false, 'call unexpectedly succeeded');
  exception
    when sqlstate '42501' then
      insert into external_api_contract_results
        values ('cross_company_projection_denied', true, null);
  end;
end;
$contract$;

insert into private.external_attribution_dictionary (
  id,
  company_id,
  source_id,
  dimension,
  public_attribution_id,
  approved_label,
  label_approved
) values (
  'e1000000-0000-4000-8000-000000000701',
  'e1000000-0000-4000-8000-000000000001',
  (
    select source.id
    from private.lead_intake_sources source
    where source.public_source_id = (
      select (value ->> 'sourceId')::uuid
      from external_api_contract_values
      where value_name = 'source_a'
    )
  ),
  'utm_campaign',
  'e1000000-0000-4000-8000-000000000702',
  'Approved campaign',
  true
);

insert into private.external_attribution_lookup_digests (
  dictionary_id,
  company_id,
  lookup_key_version,
  lookup_digest
) values (
  'e1000000-0000-4000-8000-000000000701',
  'e1000000-0000-4000-8000-000000000001',
  1,
  decode(repeat('41', 32), 'hex')
);

insert into external_api_contract_results (check_name, passed)
select
  'attribution_public_handle_is_separate_from_lookup_digest',
  dictionary.public_attribution_id =
    'e1000000-0000-4000-8000-000000000702'
  and lookup.lookup_key_version = 1
  and octet_length(lookup.lookup_digest) = 32
from private.external_attribution_dictionary dictionary
join private.external_attribution_lookup_digests lookup
  on lookup.dictionary_id = dictionary.id
 and lookup.company_id = dictionary.company_id
where dictionary.id =
  'e1000000-0000-4000-8000-000000000701';

set constraints all immediate;

do $contract$
declare
  v_failures text;
  v_missing_checks text;
  v_unexpected_checks text;
  v_expected_checks constant text[] := array[
    'default_form_is_stable',
    'null_create_forms_means_default_only',
    'null_update_forms_preserves_custom_forms',
    'cross_company_actor_denied',
    'cross_company_source_denied',
    'caller_selected_company_parameter_absent',
    'mixed_server_key_scope_denied',
    'financial_without_lead_read_denied',
    'nullable_default_source_denied',
    'nullable_source_active_denied',
    'nullable_credential_class_denied',
    'nullable_credential_scopes_denied',
    'nullable_audit_phase_denied',
    'fingerprint_prefix_without_digest_denied',
    'active_credential_authenticates',
    'invalid_credential_redacts_identity',
    'feature_disabled_denial_redacts_identity',
    'rotation_preserves_principal',
    'rotation_overlap_authenticates_both_keys',
    'inactive_granted_source_denies_and_redacts_identity',
    'inactive_source_cannot_create_authenticated_audit',
    'source_reactivation_restores_authentication',
    'expired_credential_denied',
    'old_epoch_credential_denied',
    'private_tables_deny_app_roles',
    'private_functions_deny_app_roles',
    'public_wrappers_are_service_only',
    'public_wrapper_body_role_guard',
    'audit_surface_has_no_sensitive_fields',
    'audit_signed_link_rejected',
    'request_id_is_not_idempotency',
    'audit_finalization_failure_preserves_base',
    'authenticated_audit_finalizes_once',
    'authenticated_audit_rejects_second_finalize',
    'network_fingerprint_has_hard_30_day_expiry',
    'revoked_credential_denied',
    'revocation_invalidates_entire_credential_family',
    'revoked_credential_cannot_create_authenticated_audit',
    'projection_sequence_is_company_monotonic',
    'projection_baseline_tracks_latest_version',
    'projection_versions_are_append_only',
    'cross_company_projection_denied',
    'attribution_public_handle_is_separate_from_lookup_digest'
  ]::text[];
begin
  select string_agg(expected.check_name, ', ' order by expected.check_name)
  into v_missing_checks
  from unnest(v_expected_checks) expected(check_name)
  where not exists (
    select 1
    from external_api_contract_results result
    where result.check_name = expected.check_name
  );

  select string_agg(result.check_name, ', ' order by result.check_name)
  into v_unexpected_checks
  from external_api_contract_results result
  where not (result.check_name = any(v_expected_checks));

  if v_missing_checks is not null or v_unexpected_checks is not null then
    raise exception
      'external_api_authorization_contract_check_set_changed: missing=%, unexpected=%',
      coalesce(v_missing_checks, 'none'),
      coalesce(v_unexpected_checks, 'none')
      using errcode = '55000';
  end if;

  select string_agg(
    result.check_name || coalesce(': ' || result.details, ''),
    ', '
    order by result.check_name
  )
  into v_failures
  from external_api_contract_results result
  where not result.passed;

  if v_failures is not null then
    raise exception 'external_api_authorization_contract_failed: %', v_failures
      using errcode = '55000';
  end if;
end;
$contract$;

select 'OPS_EXTERNAL_API_SQL_CONTRACT_PASS';

select check_name, passed
from external_api_contract_results
order by check_name;

rollback;
