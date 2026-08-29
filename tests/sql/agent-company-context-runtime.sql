begin;

-- PostgreSQL 17 rollback-only runtime proof for the Task 20 company source
-- fence, private overview projection, and fixed public context RPC. The
-- caller applies both Task 20 migrations to a production-typed disposable
-- schema before running this file.
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

do $catalog_contract$
declare
  v_private_signature constant text :=
    'private.agent_p2_company_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,timestamp with time zone)';
  v_public_signature constant text :=
    'public.read_agent_company_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text)';
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'agent_company_context_runtime_failed: requires_pg17';
  end if;
  if pg_catalog.to_regprocedure(v_private_signature) is null
     or pg_catalog.to_regprocedure(v_public_signature) is null then
    raise exception 'agent_company_context_runtime_failed: function_missing';
  end if;
  if pg_catalog.has_function_privilege(
       'anon', v_public_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', v_public_signature, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_public_signature, 'EXECUTE'
     ) then
    raise exception 'agent_company_context_runtime_failed: public_acl';
  end if;
  if pg_catalog.has_function_privilege(
       'anon', v_private_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', v_private_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', v_private_signature, 'EXECUTE'
     ) then
    raise exception 'agent_company_context_runtime_failed: private_acl';
  end if;
end;
$catalog_contract$;

insert into public.companies (
  id,
  name,
  description,
  industries,
  industry,
  locale,
  timezone,
  currency_code,
  default_work_start,
  default_work_end,
  skip_weekends_in_auto_schedule,
  precise_scheduling_enabled,
  logo_url,
  website
) values (
  '91000000-0000-4000-8000-000000000001',
  'Canpro Deck and Rail',
  'Initial profile',
  array['railings', 'decks', 'decks']::text[],
  'trades',
  'en-CA',
  'America/Vancouver',
  'CAD',
  '08:00:00',
  '17:00:00',
  true,
  true,
  'https://assets.opsapp.co/company/logo.png',
  'https://canpro.example/'
);

insert into public.users (
  id,
  company_id,
  first_name,
  last_name,
  is_active,
  is_company_admin
) values (
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Review',
  'Operator',
  true,
  false
);

insert into public.user_permission_overrides (
  id,
  user_id,
  company_id,
  permission,
  scope,
  granted
) values (
  '91200000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'settings.company',
  'all',
  true
);

insert into public.company_inventory_settings (
  company_id,
  inventory_mode
) values (
  '91000000-0000-4000-8000-000000000001',
  'off'
);

insert into public.company_settings (
  company_id,
  catalog_setup_completed_at
) values (
  '91000000-0000-4000-8000-000000000001',
  null
);

insert into private.mcp_oauth_clients (
  client_id,
  client_name,
  redirect_uris,
  token_endpoint_auth_method,
  grant_types,
  response_types,
  scope,
  registration_source,
  scope_ceiling,
  consent_catalog_revision,
  exposure_revision
) values (
  '91300000-0000-4000-8000-000000000001',
  'Company context runtime',
  array['https://company-context-runtime.ops.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.company.read',
  'manual',
  array['ops.company.read']::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

insert into private.mcp_oauth_grants (
  id,
  user_id,
  company_id,
  client_id,
  scopes,
  revision,
  accepted_labels,
  consent_catalog_revision,
  exposure_revision
) values (
  '91400000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  array['ops.company.read']::text[],
  'dddddddddddddddddddddddddddddddd',
  private.mcp_oauth_labels_for_scopes(
    array['ops.company.read']::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

create temporary table agent_company_revision_before(
  source_revision bigint not null
) on commit drop;
insert into agent_company_revision_before
select source_revision
from private.agent_read_domain_revisions
where company_id = '91000000-0000-4000-8000-000000000001'
  and domain = 'company';

update public.companies
set description = 'Outdoor living systems.'
where id = '91000000-0000-4000-8000-000000000001';
update public.company_inventory_settings
set inventory_mode = 'tracked'
where company_id = '91000000-0000-4000-8000-000000000001';
update public.company_settings
set catalog_setup_completed_at = pg_catalog.statement_timestamp()
where company_id = '91000000-0000-4000-8000-000000000001';

do $source_fence_contract$
declare
  v_before bigint;
  v_after bigint;
begin
  select source_revision into strict v_before
  from agent_company_revision_before;
  select source_revision into strict v_after
  from private.agent_read_domain_revisions
  where company_id = '91000000-0000-4000-8000-000000000001'
    and domain = 'company';
  if v_after is distinct from v_before + 3 then
    raise exception
      'agent_company_context_runtime_failed: source_fence % -> %',
      v_before,
      v_after;
  end if;
end;
$source_fence_contract$;

create temporary table agent_company_context_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  array['settings.company']::text[]
) authority;

create temporary table agent_company_context_result
on commit drop as
select public.read_agent_company_context_as_system(
  'company-context-runtime',
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '91400000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  'dddddddddddddddddddddddddddddddd',
  array['ops.company.read']::text[],
  (
    select permission_snapshot_revision
    from agent_company_context_authority
  ),
  array['settings.company']::text[],
  'get_company_context',
  'get_company_context:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array['ops.company.read']::text[],
  'all'
) as payload;

do $projection_contract$
declare
  v_payload jsonb;
  v_without_proof jsonb;
  v_expected_proof text;
begin
  select payload into strict v_payload
  from agent_company_context_result;
  v_without_proof := v_payload - 'proof_ref';
  v_expected_proof := 'ops_proof:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(v_without_proof),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if v_payload -> 'result' -> 'company_ref' ->> 'id' is distinct from
       '91000000-0000-4000-8000-000000000001'
     or v_payload -> 'result' -> 'profile' ->> 'display_name' is distinct from
       'Canpro Deck and Rail'
     or v_payload -> 'result' -> 'profile' -> 'industries' is distinct from
       '["decks", "railings"]'::jsonb
     or v_payload -> 'result' -> 'regional' is distinct from
       '{"locale":"en-CA","timezone":"America/Vancouver","currency_code":"CAD"}'::jsonb
     or v_payload -> 'result' -> 'working_window' is distinct from
       '{"start_local":"08:00:00","end_local":"17:00:00","weekend_policy":"skip","precise_scheduling_enabled":true}'::jsonb
     or v_payload -> 'result' -> 'catalog' is distinct from
       '{"inventory_mode":"tracked","setup_state":"complete"}'::jsonb
     or v_payload -> 'result' -> 'public_assets' -> 'logo' ->> 'state'
       is distinct from 'available'
     or v_payload -> 'result' -> 'public_assets' -> 'website' ->> 'state'
       is distinct from 'available'
     or v_payload -> 'source_inspected' is distinct from
       '{"companies":1,"inventory_settings":1,"company_settings":1}'::jsonb
     or v_payload -> 'source_revisions' -> 0 ->> 'domain'
       is distinct from 'company'
     or (v_payload -> 'source_revisions' -> 0 ->> 'source_revision')::bigint < 3
     or v_payload ->> 'proof_ref' is distinct from v_expected_proof then
    raise exception
      'agent_company_context_runtime_failed: projection_or_proof %',
      v_payload;
  end if;

  if v_payload::text ~
       'account_holder_id|admin_ids|stripe_customer_id|subscription_plan|trial_end_date|raw_settings|schedule_settings|invoice_settings|lifecycle_settings|physical_address|latitude|longitude|"email"|"phone"' then
    raise exception
      'agent_company_context_runtime_failed: private_field_leak %',
      v_payload;
  end if;
end;
$projection_contract$;

do $legacy_industry_fallback_contract$
declare
  v_payload jsonb;
  v_snapshot text;
begin
  update public.companies
  set industries = array[]::text[],
      industry = 'decks'
  where id = '91000000-0000-4000-8000-000000000001';

  select permission_snapshot_revision into strict v_snapshot
  from private.resolve_agent_actor_authority(
    '91100000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    array['settings.company']::text[]
  );

  select public.read_agent_company_context_as_system(
    'company-context-legacy-industry',
    '91100000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '91400000-0000-4000-8000-000000000001',
    '91300000-0000-4000-8000-000000000001',
    'dddddddddddddddddddddddddddddddd',
    array['ops.company.read']::text[],
    v_snapshot,
    array['settings.company']::text[],
    'get_company_context',
    'get_company_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.company.read']::text[],
    'all'
  ) into strict v_payload;

  if v_payload -> 'result' -> 'profile' -> 'industries'
       is distinct from '["decks"]'::jsonb then
    raise exception
      'agent_company_context_runtime_failed: legacy_industry_fallback %',
      v_payload;
  end if;
end;
$legacy_industry_fallback_contract$;

do $bounded_unicode_industries_contract$
declare
  v_payload jsonb;
  v_snapshot text;
begin
  update public.companies
  set industries = array[E'\uE000', '😀']::text[]
  where id = '91000000-0000-4000-8000-000000000001';
  select permission_snapshot_revision into strict v_snapshot
  from private.resolve_agent_actor_authority(
    '91100000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    array['settings.company']::text[]
  );
  select public.read_agent_company_context_as_system(
    'company-context-unicode-industries',
    '91100000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '91400000-0000-4000-8000-000000000001',
    '91300000-0000-4000-8000-000000000001',
    'dddddddddddddddddddddddddddddddd',
    array['ops.company.read']::text[],
    v_snapshot,
    array['settings.company']::text[],
    'get_company_context',
    'get_company_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.company.read']::text[],
    'all'
  ) into strict v_payload;
  if v_payload #> '{result,profile,industries}' is distinct from
       pg_catalog.jsonb_build_array(E'\uE000', '😀') then
    raise exception
      'agent_company_context_runtime_failed: unicode_industry_order %',
      v_payload;
  end if;

  update public.companies
  set industries = array_fill('decks'::text, array[17])
  where id = '91000000-0000-4000-8000-000000000001';
  begin
    perform public.read_agent_company_context_as_system(
      'company-context-unbounded-industries',
      '91100000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '91400000-0000-4000-8000-000000000001',
      '91300000-0000-4000-8000-000000000001',
      'dddddddddddddddddddddddddddddddd',
      array['ops.company.read']::text[],
      v_snapshot,
      array['settings.company']::text[],
      'get_company_context',
      'get_company_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.company.read']::text[],
      'all'
    );
    raise exception
      'agent_company_context_runtime_failed: raw_industry_bound_missing';
  exception
    when sqlstate '22000' then null;
  end;
end;
$bounded_unicode_industries_contract$;

do $noncanonical_work_window_contract$
declare
  v_snapshot text;
begin
  update public.companies
  set industries = array['decks']::text[],
      default_work_end = time '24:00:00'
  where id = '91000000-0000-4000-8000-000000000001';
  select permission_snapshot_revision into strict v_snapshot
  from private.resolve_agent_actor_authority(
    '91100000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    array['settings.company']::text[]
  );
  begin
    perform public.read_agent_company_context_as_system(
      'company-context-noncanonical-work-window',
      '91100000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '91400000-0000-4000-8000-000000000001',
      '91300000-0000-4000-8000-000000000001',
      'dddddddddddddddddddddddddddddddd',
      array['ops.company.read']::text[],
      v_snapshot,
      array['settings.company']::text[],
      'get_company_context',
      'get_company_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.company.read']::text[],
      'all'
    );
    raise exception
      'agent_company_context_runtime_failed: 24_hour_visible';
  exception
    when sqlstate '22000' then null;
  end;
end;
$noncanonical_work_window_contract$;

do $revoked_grant_contract$
declare
  v_snapshot text;
begin
  select permission_snapshot_revision into strict v_snapshot
  from agent_company_context_authority;
  update private.mcp_oauth_grants
  set revoked_at = pg_catalog.statement_timestamp()
  where id = '91400000-0000-4000-8000-000000000001';
  begin
    perform public.read_agent_company_context_as_system(
      'company-context-revoked',
      '91100000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '91400000-0000-4000-8000-000000000001',
      '91300000-0000-4000-8000-000000000001',
      'dddddddddddddddddddddddddddddddd',
      array['ops.company.read']::text[],
      v_snapshot,
      array['settings.company']::text[],
      'get_company_context',
      'get_company_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.company.read']::text[],
      'all'
    );
    raise exception
      'agent_company_context_runtime_failed: revoked_grant_visible';
  exception
    when sqlstate 'P0002' then null;
  end;
end;
$revoked_grant_contract$;

do $invalid_source_contract$
declare
  v_snapshot text;
begin
  update private.mcp_oauth_grants
  set revoked_at = null
  where id = '91400000-0000-4000-8000-000000000001';
  update public.companies
  set currency_code = 'cad'
  where id = '91000000-0000-4000-8000-000000000001';
  select permission_snapshot_revision into strict v_snapshot
  from private.resolve_agent_actor_authority(
    '91100000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    array['settings.company']::text[]
  );
  begin
    perform public.read_agent_company_context_as_system(
      'company-context-invalid-source',
      '91100000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '91400000-0000-4000-8000-000000000001',
      '91300000-0000-4000-8000-000000000001',
      'dddddddddddddddddddddddddddddddd',
      array['ops.company.read']::text[],
      v_snapshot,
      array['settings.company']::text[],
      'get_company_context',
      'get_company_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.company.read']::text[],
      'all'
    );
    raise exception
      'agent_company_context_runtime_failed: invalid_source_visible';
  exception
    when sqlstate '22000' then null;
  end;
end;
$invalid_source_contract$;

rollback;
