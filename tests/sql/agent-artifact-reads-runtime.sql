begin;

-- Task 10 rollback-only PostgreSQL 17 acceptance fixture. It proves the
-- private source fence, both fixed public readers, nominal visit anchors,
-- tenant isolation, grant revocation, cursor invalidation, hard bounds, and
-- exact application-role ACLs without committing fixture data.
do $catalog_contract$
declare
  v_signature text;
  v_private_signature text;
  v_public_signature text;
  v_volatility "char";
  v_security_definer boolean;
  v_config text[];
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception
      'agent_artifact_runtime_failed: runtime_requires_postgresql_17';
  end if;

  foreach v_signature in array array[
    'private.agent_p2_artifact_uuid_from_text(text)',
    'private.agent_p2_artifact_safe_timestamp(timestamp with time zone)',
    'private.agent_p2_artifact_mime_family(text)',
    'private.agent_p2_artifact_private_evidence_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer)',
    'private.agent_p2_artifact_metadata_v1(text,text,text,timestamp with time zone,text,text,text,text,text,bigint,text,text,text)',
    'private.agent_p2_artifact_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)',
    'private.agent_p2_artifact_evidence_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)',
    'private.agent_p2_artifact_attention_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer,integer)',
    'public.read_agent_job_artifacts_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)',
    'public.read_agent_job_artifact_evidence_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_artifact_runtime_failed: missing %', v_signature;
    end if;

    select procedure.provolatile,
           procedure.prosecdef,
           procedure.proconfig
      into strict v_volatility, v_security_definer, v_config
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(v_signature);

    if v_volatility not in ('i', 's')
       or pg_catalog.cardinality(v_config) <> 1
       or pg_catalog.replace(pg_catalog.regexp_replace(
            v_config[1], '[[:space:]]+', '', 'g'
          ), '""', '') is distinct from 'search_path='
       or v_signature like 'private.%' and v_security_definer
       or v_signature like 'public.%' and not v_security_definer then
      raise exception 'agent_artifact_runtime_failed: unsafe shape %',
        v_signature;
    end if;
  end loop;

  foreach v_private_signature in array array[
    'private.agent_p2_artifact_uuid_from_text(text)',
    'private.agent_p2_artifact_safe_timestamp(timestamp with time zone)',
    'private.agent_p2_artifact_mime_family(text)',
    'private.agent_p2_artifact_private_evidence_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer)',
    'private.agent_p2_artifact_metadata_v1(text,text,text,timestamp with time zone,text,text,text,text,text,bigint,text,text,text)',
    'private.agent_p2_artifact_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)',
    'private.agent_p2_artifact_evidence_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)',
    'private.agent_p2_artifact_attention_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer,integer)'
  ]::text[] loop
    if pg_catalog.has_function_privilege(
         'anon', v_private_signature, 'EXECUTE'
       ) or pg_catalog.has_function_privilege(
         'authenticated', v_private_signature, 'EXECUTE'
       ) or pg_catalog.has_function_privilege(
         'service_role', v_private_signature, 'EXECUTE'
       ) then
      raise exception 'agent_artifact_runtime_failed: private execute %',
        v_private_signature;
    end if;
  end loop;

  foreach v_public_signature in array array[
    'public.read_agent_job_artifacts_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)',
    'public.read_agent_job_artifact_evidence_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)'
  ]::text[] loop
    if pg_catalog.has_function_privilege(
         'anon', v_public_signature, 'EXECUTE'
       ) or pg_catalog.has_function_privilege(
         'authenticated', v_public_signature, 'EXECUTE'
       ) or not pg_catalog.has_function_privilege(
         'service_role', v_public_signature, 'EXECUTE'
       ) then
      raise exception 'agent_artifact_runtime_failed: public acl %',
        v_public_signature;
    end if;
  end loop;
end;
$catalog_contract$;

do $production_type_contract$
declare
  v_expected record;
  v_actual text;
begin
  for v_expected in
    select expected.*
    from (values
      ('project_photos'::text, 'site_visit_id'::text, 'uuid'::text),
      ('invoices', 'project_id', 'uuid'),
      ('invoices', 'project_ref', 'uuid'),
      ('expenses', 'submitted_by', 'uuid'),
      ('estimates', 'project_id', 'text'),
      ('estimates', 'project_ref', 'uuid')
    ) expected(table_name, column_name, expected_type)
  loop
    select pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      into v_actual
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation
      on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = v_expected.table_name
      and attribute.attname = v_expected.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped;

    if v_actual is distinct from v_expected.expected_type then
      raise exception
        'agent_artifact_runtime_failed: production type mismatch %.% expected %, got %',
        v_expected.table_name, v_expected.column_name,
        v_expected.expected_type, coalesce(v_actual, '<missing>');
    end if;
  end loop;
end;
$production_type_contract$;

set local role authenticated;

do $application_acl$
begin
  if pg_catalog.has_function_privilege(
       current_user,
       'public.read_agent_job_artifacts_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)',
       'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       current_user,
       'public.read_agent_job_artifact_evidence_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)',
       'EXECUTE'
     ) then
    raise exception 'agent_artifact_runtime_failed: authenticated execute';
  end if;
end;
$application_acl$;

reset role;

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select pg_catalog.set_config(
  'request.jwt.claims', '{"role":"service_role"}', true
);

insert into public.companies (id, name) values
  ('8d000000-0000-4000-8000-000000000001', 'Artifact runtime company'),
  ('8d000000-0000-4000-8000-000000000002', 'Other artifact company');

insert into public.users (
  id, company_id, first_name, last_name, is_active, is_company_admin
) values
  (
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    'Artifact', 'Reader', true, false
  ),
  (
    '8d100000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    'Historical', 'Lead Reader', true, false
  );

insert into public.user_permission_overrides (
  id, user_id, company_id, permission, scope, granted
) values
  (
    '8d110000-0000-4000-8000-000000000001',
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    'calendar.view', 'all', true
  ),
  (
    '8d110000-0000-4000-8000-000000000002',
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    'clients.view', 'all', true
  ),
  (
    '8d110000-0000-4000-8000-000000000003',
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    'photos.view', 'all', true
  ),
  (
    '8d110000-0000-4000-8000-000000000004',
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    'pipeline.view', 'all', true
  ),
  (
    '8d110000-0000-4000-8000-000000000005',
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    'projects.view', 'all', true
  ),
  (
    '8d110000-0000-4000-8000-000000000006',
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    'deck_builder.view', 'all', true
  ),
  (
    '8d110000-0000-4000-8000-000000000011',
    '8d100000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    'calendar.view', 'all', true
  ),
  (
    '8d110000-0000-4000-8000-000000000012',
    '8d100000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    'clients.view', 'all', true
  ),
  (
    '8d110000-0000-4000-8000-000000000013',
    '8d100000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    'deck_builder.view', 'assigned', true
  ),
  (
    '8d110000-0000-4000-8000-000000000014',
    '8d100000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    'photos.view', 'all', true
  ),
  (
    '8d110000-0000-4000-8000-000000000015',
    '8d100000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    'pipeline.view', 'all', true
  );

insert into private.mcp_oauth_clients (
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source, scope_ceiling,
  consent_catalog_revision, exposure_revision
) values (
  '8d120000-0000-4000-8000-000000000001',
  'Artifact runtime client',
  array['https://runtime.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.files.read',
  'manual',
  array['ops.files.read']::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

insert into private.mcp_oauth_grants (
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values (
  '8d130000-0000-4000-8000-000000000001',
  '8d100000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d120000-0000-4000-8000-000000000001',
  array['ops.files.read']::text[],
  pg_catalog.md5('agent-artifact-runtime-grant'),
  private.mcp_oauth_labels_for_scopes(
    array['ops.files.read']::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

insert into public.clients (id, company_id, name) values
  (
    '8d200000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    'Carly Hunter'
  ),
  (
    '8d200000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000002',
    'Other customer'
  );

insert into public.opportunities (
  id, company_id, client_ref, title
) values
  (
    '8d300000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d200000-0000-4000-8000-000000000001',
    'Carly Hunter deck'
  ),
  (
    '8d300000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000002',
    '8d200000-0000-4000-8000-000000000002',
    'Other company deck'
  );

insert into public.projects (
  id, company_id, client_id, title, status
) values
  (
    '8d400000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d200000-0000-4000-8000-000000000001',
    'Carly Hunter project', 'in_progress'
  ),
  (
    '8d400000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000002',
    '8d200000-0000-4000-8000-000000000002',
    'Other company project', 'in_progress'
  );

insert into public.project_notes (
  id, project_id, company_id, author_id, content, created_at
) values
  (
    '8d500000-0000-4000-8000-000000000001',
    '8d400000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d100000-0000-4000-8000-000000000001',
    'First safe note',
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  ),
  (
    '8d500000-0000-4000-8000-000000000002',
    '8d400000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d100000-0000-4000-8000-000000000001',
    'Second safe note',
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() - interval '1 minute'
    )
  ),
  (
    '8d500000-0000-4000-8000-000000000003',
    '8d400000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000002',
    '8d100000-0000-4000-8000-000000000001',
    'Cross-company artifact must never appear',
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );

insert into private.agent_read_domain_revisions (
  company_id, domain, source_revision
) values
  ('8d000000-0000-4000-8000-000000000001', 'artifacts', 1),
  ('8d000000-0000-4000-8000-000000000002', 'artifacts', 1)
on conflict (company_id, domain) do nothing;

insert into private.agent_operational_read_revisions (
  company_id, source_revision
) values
  ('8d000000-0000-4000-8000-000000000001', 0),
  ('8d000000-0000-4000-8000-000000000002', 0)
on conflict (company_id) do nothing;

create temporary table agent_artifact_runtime_project_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8d100000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  array['projects.view']::text[]
) authority;

do $authority_contract$
begin
  if (
    select pg_catalog.count(*)
    from agent_artifact_runtime_project_authority
    where permission_snapshot_revision ~ '^sha256:[0-9a-f]{64}$'
  ) <> 1 then
    raise exception 'agent_artifact_runtime_failed: authority invalid';
  end if;
end;
$authority_contract$;

create temporary table agent_artifact_runtime_list
on commit drop as
select public.read_agent_job_artifacts_as_system(
  'agent-artifact-runtime-list',
  '8d100000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d130000-0000-4000-8000-000000000001',
  '8d120000-0000-4000-8000-000000000001',
  pg_catalog.md5('agent-artifact-runtime-grant'),
  array['ops.files.read']::text[],
  (select permission_snapshot_revision
   from agent_artifact_runtime_project_authority),
  array['projects.view']::text[],
  'list_job_artifacts',
  'list_job_artifacts:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array['ops.files.read']::text[],
  '{"projects.view":"all"}'::jsonb,
  'project',
  '8d400000-0000-4000-8000-000000000001',
  array['project_note']::text[],
  1, 2, 501,
  null, '[]'::jsonb, null, null, null
) as result;

do $list_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result from agent_artifact_runtime_list;
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 1
     or (v_result ->> 'source_has_more')::boolean is not true
     or v_result #>> '{rows,0,artifact,source_kind}' <> 'project_note'
     or v_result::text like '%Cross-company artifact must never appear%'
     or v_result::text like '%raw_locator%'
     or v_result::text like '%storage_path%'
     or v_result::text like '%source_url%'
     or v_result::text like '%receipt_image_url%' then
    raise exception
      'agent_artifact_runtime_failed: cross-company artifact leaked';
  end if;
end;
$list_contract$;

create temporary table agent_artifact_runtime_exact
on commit drop as
select public.read_agent_job_artifact_evidence_as_system(
  'agent-artifact-runtime-exact',
  '8d100000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d130000-0000-4000-8000-000000000001',
  '8d120000-0000-4000-8000-000000000001',
  pg_catalog.md5('agent-artifact-runtime-grant'),
  array['ops.files.read']::text[],
  (select permission_snapshot_revision
   from agent_artifact_runtime_project_authority),
  array['projects.view']::text[],
  'get_job_artifact_evidence',
  'get_job_artifact_evidence:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array['ops.files.read']::text[],
  '{"projects.view":"all"}'::jsonb,
  'project',
  '8d400000-0000-4000-8000-000000000001',
  array['project_note']::text[],
  'project_note',
  (select result #>> '{rows,0,evidence_ref}'
   from agent_artifact_runtime_list),
  501
) as result;

do $exact_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result from agent_artifact_runtime_exact;
  if v_result #>> '{content,kind}' <> 'inline_text'
     or v_result #>> '{content,content_kind}' <>
          'untrusted_business_data'
     or v_result::text like '%raw_locator%'
     or v_result::text like '%storage_path%'
     or v_result::text like '%source_url%' then
    raise exception
      'agent_artifact_runtime_failed: unsafe inspection accepted';
  end if;
end;
$exact_contract$;

do $proof_round_trip_contract$
declare
  v_list jsonb;
  v_exact jsonb;
  v_row jsonb;
  v_list_context jsonb;
  v_exact_context jsonb;
  v_expected_evidence_ref text;
  v_expected_item_proof_ref text;
  v_expected_collection_proof_ref text;
  v_expected_exact_proof_ref text;
begin
  select result into strict v_list from agent_artifact_runtime_list;
  select result into strict v_exact from agent_artifact_runtime_exact;
  v_row := v_list #> '{rows,0}';
  v_list_context := v_list - 'rows' - 'collection_proof_ref';
  v_exact_context := v_exact - 'artifact' - 'content' - 'source_id' -
    'proof_ref';

  v_expected_evidence_ref := 'ops_evidence:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(
          pg_catalog.jsonb_build_object(
            'company_id', (v_list ->> 'company_id')::uuid,
            'job_kind', v_list #>> '{job_ref,kind}',
            'job_id', (v_list #>> '{job_ref,id}')::uuid,
            'source_kind', v_row #>> '{artifact,source_kind}',
            'source_id', v_row ->> 'source_id'
          )
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_expected_item_proof_ref := 'ops_proof:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(
          v_list_context || pg_catalog.jsonb_build_object(
            'proof_kind', 'artifact_list_entity',
            'source_identity', pg_catalog.jsonb_build_object(
              'source_kind', v_row #>> '{artifact,source_kind}',
              'source_id', v_row ->> 'source_id'
            ),
            'artifact', v_row -> 'artifact'
          )
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_expected_collection_proof_ref := 'ops_proof:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(
          v_list_context || pg_catalog.jsonb_build_object(
            'proof_kind', 'artifact_list_collection',
            'returned_count', pg_catalog.jsonb_array_length(v_list -> 'rows'),
            'has_more', (v_list ->> 'source_has_more')::boolean,
            'children', pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'artifact_ref', pg_catalog.jsonb_build_object(
                  'source_kind', v_row #>> '{artifact,source_kind}',
                  'evidence_ref', v_row ->> 'evidence_ref'
                ),
                'proof_ref', v_row ->> 'proof_ref',
                'evidence_ref', v_row ->> 'evidence_ref'
              )
            )
          )
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_expected_exact_proof_ref := 'ops_proof:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(
          v_exact_context || pg_catalog.jsonb_build_object(
            'proof_kind', 'artifact_exact_entity',
            'source_identity', pg_catalog.jsonb_build_object(
              'source_kind', v_exact #>> '{artifact,source_kind}',
              'source_id', v_exact ->> 'source_id'
            ),
            'artifact', v_exact -> 'artifact',
            'content', v_exact -> 'content'
          )
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if v_list ->> 'ranking_revision' is distinct from
       'artifact-ranking:2026-08-22.v1'
     or v_list -> 'granted_scope_ceiling' is distinct from
       '["ops.files.read"]'::jsonb
     or v_row ->> 'evidence_ref' is distinct from v_expected_evidence_ref
     or v_row ->> 'proof_ref' is distinct from v_expected_item_proof_ref
     or v_list ->> 'collection_proof_ref' is distinct from
       v_expected_collection_proof_ref
     or v_exact ->> 'source_id' is distinct from v_row ->> 'source_id'
     or v_exact #>> '{artifact,evidence_ref}' is distinct from
       v_expected_evidence_ref
     or v_exact ->> 'proof_ref' is distinct from v_expected_exact_proof_ref then
    raise exception
      'agent_artifact_runtime_failed: canonical proof round trip failed';
  end if;
end;
$proof_round_trip_contract$;

create function pg_temp.assert_artifact_authority_rejected(p_case text)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
begin
  begin
    perform public.read_agent_job_artifacts_as_system(
      pg_catalog.format('agent-artifact-runtime-%s-list', p_case),
      '8d100000-0000-4000-8000-000000000001',
      '8d000000-0000-4000-8000-000000000001',
      '8d130000-0000-4000-8000-000000000001',
      '8d120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-artifact-runtime-grant'),
      array['ops.files.read']::text[],
      (
        select permission_snapshot_revision
        from pg_temp.agent_artifact_runtime_project_authority
      ),
      array['projects.view']::text[],
      'list_job_artifacts',
      'list_job_artifacts:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.files.read']::text[],
      '{"projects.view":"all"}'::jsonb,
      'project',
      '8d400000-0000-4000-8000-000000000001',
      array['project_note']::text[],
      1, 2, 501,
      null, '[]'::jsonb, null, null, null
    );
    raise exception
      'agent_artifact_runtime_failed: % accepted by list', p_case;
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'agent_artifact_read_unauthorized' then raise; end if;
  end;

  begin
    perform public.read_agent_job_artifact_evidence_as_system(
      pg_catalog.format('agent-artifact-runtime-%s-exact', p_case),
      '8d100000-0000-4000-8000-000000000001',
      '8d000000-0000-4000-8000-000000000001',
      '8d130000-0000-4000-8000-000000000001',
      '8d120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-artifact-runtime-grant'),
      array['ops.files.read']::text[],
      (
        select permission_snapshot_revision
        from pg_temp.agent_artifact_runtime_project_authority
      ),
      array['projects.view']::text[],
      'get_job_artifact_evidence',
      'get_job_artifact_evidence:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.files.read']::text[],
      '{"projects.view":"all"}'::jsonb,
      'project',
      '8d400000-0000-4000-8000-000000000001',
      array['project_note']::text[],
      'project_note',
      (
        select result #>> '{rows,0,evidence_ref}'
        from pg_temp.agent_artifact_runtime_list
      ),
      501
    );
    raise exception
      'agent_artifact_runtime_failed: % accepted by exact', p_case;
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'agent_artifact_read_unauthorized' then raise; end if;
  end;
end;
$function$;

do $revoked_grant_contract$
begin
  update private.mcp_oauth_grants
     set revoked_at = pg_catalog.statement_timestamp()
   where id = '8d130000-0000-4000-8000-000000000001';
  begin
    perform public.read_agent_job_artifacts_as_system(
      'agent-artifact-runtime-revoked',
      '8d100000-0000-4000-8000-000000000001',
      '8d000000-0000-4000-8000-000000000001',
      '8d130000-0000-4000-8000-000000000001',
      '8d120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-artifact-runtime-grant'),
      array['ops.files.read']::text[],
      (select permission_snapshot_revision
       from agent_artifact_runtime_project_authority),
      array['projects.view']::text[],
      'list_job_artifacts',
      'list_job_artifacts:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.files.read']::text[],
      '{"projects.view":"all"}'::jsonb,
      'project',
      '8d400000-0000-4000-8000-000000000001',
      array['project_note']::text[],
      1, 2, 501,
      null, '[]'::jsonb, null, null, null
    );
    raise exception 'agent_artifact_runtime_failed: revoked grant accepted';
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'agent_artifact_read_unauthorized' then raise; end if;
  end;
  update private.mcp_oauth_grants
     set revoked_at = null
   where id = '8d130000-0000-4000-8000-000000000001';
end;
$revoked_grant_contract$;

do $disabled_client_contract$
begin
  update private.mcp_oauth_clients
     set disabled_at = pg_catalog.statement_timestamp()
   where client_id = '8d120000-0000-4000-8000-000000000001';

  perform pg_temp.assert_artifact_authority_rejected('disabled_client');

  update private.mcp_oauth_clients
     set disabled_at = null
   where client_id = '8d120000-0000-4000-8000-000000000001';
end;
$disabled_client_contract$;

set local session_replication_role = replica;
update private.mcp_oauth_clients
   set scope = 'ops.jobs.read',
       scope_ceiling = array['ops.jobs.read']::text[]
 where client_id = '8d120000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

do $client_ceiling_contract$
begin
  perform pg_temp.assert_artifact_authority_rejected('stale_client_ceiling');
end;
$client_ceiling_contract$;

set local session_replication_role = replica;
update private.mcp_oauth_clients
   set scope = 'ops.files.read',
       scope_ceiling = array['ops.files.read']::text[]
 where client_id = '8d120000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

set local session_replication_role = replica;
update private.mcp_oauth_grants
   set exposure_revision = '2026-08-22.mcp-exposure.v2'
 where id = '8d130000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

do $exposure_revision_contract$
begin
  perform pg_temp.assert_artifact_authority_rejected('stale_exposure_revision');
end;
$exposure_revision_contract$;

set local session_replication_role = replica;
update private.mcp_oauth_grants
   set exposure_revision = '2026-08-22.mcp-exposure.v1'
 where id = '8d130000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

alter table private.mcp_oauth_clients
  drop constraint mcp_oauth_clients_scope_ceiling_valid;
set local session_replication_role = replica;
update private.mcp_oauth_clients
   set consent_catalog_revision = '2026-08-22.mcp-consent-catalog.v2'
 where client_id = '8d120000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

do $consent_revision_contract$
begin
  perform pg_temp.assert_artifact_authority_rejected('stale_consent_revision');
end;
$consent_revision_contract$;

set local session_replication_role = replica;
update private.mcp_oauth_clients
   set consent_catalog_revision = '2026-08-22.mcp-consent-catalog.v1'
 where client_id = '8d120000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

alter table private.mcp_oauth_grants
  drop constraint mcp_oauth_grants_consent_snapshot_valid;
set local session_replication_role = replica;
update private.mcp_oauth_grants
   set accepted_labels = array['tampered consent']::text[]
 where id = '8d130000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

do $accepted_labels_contract$
begin
  perform pg_temp.assert_artifact_authority_rejected('invalid_accepted_labels');
end;
$accepted_labels_contract$;

set local session_replication_role = replica;
update private.mcp_oauth_grants
   set accepted_labels = private.mcp_oauth_labels_for_scopes(
         scopes,
         consent_catalog_revision
       )
 where id = '8d130000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

do $artifact_revision_trigger_contract$
declare
  v_before bigint;
  v_after bigint;
begin
  select source_revision into strict v_before
  from private.agent_read_domain_revisions
  where company_id = '8d000000-0000-4000-8000-000000000001'
    and domain = 'artifacts';

  update public.project_notes
     set content = 'First safe note updated'
   where id = '8d500000-0000-4000-8000-000000000001';

  select source_revision into strict v_after
  from private.agent_read_domain_revisions
  where company_id = '8d000000-0000-4000-8000-000000000001'
    and domain = 'artifacts';
  if v_after <= v_before then
    raise exception
      'agent_artifact_runtime_failed: artifact revision did not advance';
  end if;
end;
$artifact_revision_trigger_contract$;

do $stale_cursor_contract$
declare
  v_list jsonb;
begin
  select result into strict v_list from agent_artifact_runtime_list;
  begin
    perform public.read_agent_job_artifacts_as_system(
      'agent-artifact-runtime-stale',
      '8d100000-0000-4000-8000-000000000001',
      '8d000000-0000-4000-8000-000000000001',
      '8d130000-0000-4000-8000-000000000001',
      '8d120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-artifact-runtime-grant'),
      array['ops.files.read']::text[],
      (select permission_snapshot_revision
       from agent_artifact_runtime_project_authority),
      array['projects.view']::text[],
      'list_job_artifacts',
      'list_job_artifacts:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.files.read']::text[],
      '{"projects.view":"all"}'::jsonb,
      'project',
      '8d400000-0000-4000-8000-000000000001',
      array['project_note']::text[],
      1, 2, 501,
      (v_list ->> 'read_at')::timestamptz,
      v_list -> 'source_revisions',
      (v_list #>> '{rows,0,predecessor,order,0}')::timestamptz,
      v_list #>> '{rows,0,predecessor,order,1}',
      v_list #>> '{rows,0,predecessor,tie_breaker}'
    );
    raise exception 'agent_artifact_runtime_failed: stale cursor accepted';
  exception
    when sqlstate '40001' then
      if sqlerrm <> 'agent_artifact_read_stale' then raise; end if;
  end;
end;
$stale_cursor_contract$;

insert into public.opportunities (
  id, company_id, client_ref, title
) values (
  '8d300000-0000-4000-8000-000000000003',
  '8d000000-0000-4000-8000-000000000001',
  '8d200000-0000-4000-8000-000000000001',
  'Mismatched same-company opportunity'
);

update public.projects
   set opportunity_ref = '8d300000-0000-4000-8000-000000000001'
 where id = '8d400000-0000-4000-8000-000000000001';

insert into public.site_visits (
  id, company_id, opportunity_id, client_id, client_ref, project_ref,
  scheduled_at, created_by, assignee_ids
) values
  (
    '8d600000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000001',
    '8d200000-0000-4000-8000-000000000001',
    '8d200000-0000-4000-8000-000000000001',
    '8d400000-0000-4000-8000-000000000001',
    pg_catalog.statement_timestamp(),
    '8d100000-0000-4000-8000-000000000001',
    array['8d100000-0000-4000-8000-000000000001']::text[]
  ),
  (
    '8d600000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    null, null, null, null,
    pg_catalog.statement_timestamp(),
    '8d100000-0000-4000-8000-000000000001',
    array[]::text[]
  );

insert into public.deck_designs (
  id, company_id, opportunity_id, project_id, title, created_at, deleted_at
) values
  (
    '8d620000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000001',
    '8d400000-0000-4000-8000-000000000001',
    'Matching linked design', pg_catalog.statement_timestamp(), null
  ),
  (
    '8d620000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000001',
    '8d400000-0000-4000-8000-000000000001',
    'Deleted linked design', pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  ),
  (
    '8d620000-0000-4000-8000-000000000003',
    '8d000000-0000-4000-8000-000000000002',
    '8d300000-0000-4000-8000-000000000002',
    null, 'Cross-company design', pg_catalog.statement_timestamp(), null
  ),
  (
    '8d620000-0000-4000-8000-000000000004',
    '8d000000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000003',
    null, 'Lagging-parent linked design', pg_catalog.statement_timestamp(),
    null
  ),
  (
    '8d620000-0000-4000-8000-000000000005',
    '8d000000-0000-4000-8000-000000000001',
    null, null, 'Matching unlinked design', pg_catalog.statement_timestamp(),
    null
  ),
  (
    '8d620000-0000-4000-8000-000000000006',
    '8d000000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000001',
    null, 'Parented unlinked design', pg_catalog.statement_timestamp(), null
  );

insert into public.site_visit_artifacts (
  id, site_visit_id, company_id, opportunity_id, deck_design_id, kind, source,
  title, body, captured_at, created_by
) values
  (
    '8d610000-0000-4000-8000-000000000001',
    '8d600000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000001',
    null,
    'measurement', 'laser', 'Back railing', '42 linear feet',
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    '8d100000-0000-4000-8000-000000000001'
  ),
  (
    '8d610000-0000-4000-8000-000000000002',
    '8d600000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    null, null,
    'note', 'manual', 'Unlinked visit note', 'Unlinked evidence',
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    '8d100000-0000-4000-8000-000000000001'
  ),
  (
    '8d610000-0000-4000-8000-000000000003',
    '8d600000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000001',
    '8d620000-0000-4000-8000-000000000001',
    'deck_design', 'manual', 'Matching linked deck', null,
    pg_catalog.statement_timestamp(),
    '8d100000-0000-4000-8000-000000000001'
  ),
  (
    '8d610000-0000-4000-8000-000000000004',
    '8d600000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000001',
    '8d620000-0000-4000-8000-000000000002',
    'deck_design', 'manual', 'Deleted linked deck', null,
    pg_catalog.statement_timestamp(),
    '8d100000-0000-4000-8000-000000000001'
  ),
  (
    '8d610000-0000-4000-8000-000000000005',
    '8d600000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000001',
    '8d620000-0000-4000-8000-000000000003',
    'deck_design', 'manual', 'Cross-company linked deck', null,
    pg_catalog.statement_timestamp(),
    '8d100000-0000-4000-8000-000000000001'
  ),
  (
    '8d610000-0000-4000-8000-000000000006',
    '8d600000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d300000-0000-4000-8000-000000000001',
    '8d620000-0000-4000-8000-000000000004',
    'deck_design', 'manual', 'Lagging-parent linked deck', null,
    pg_catalog.statement_timestamp(),
    '8d100000-0000-4000-8000-000000000001'
  ),
  (
    '8d610000-0000-4000-8000-000000000007',
    '8d600000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001', null,
    '8d620000-0000-4000-8000-000000000005',
    'deck_design', 'manual', 'Matching unlinked deck', null,
    pg_catalog.statement_timestamp(),
    '8d100000-0000-4000-8000-000000000001'
  ),
  (
    '8d610000-0000-4000-8000-000000000008',
    '8d600000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001', null,
    '8d620000-0000-4000-8000-000000000006',
    'deck_design', 'manual', 'Parented unlinked deck', null,
    pg_catalog.statement_timestamp(),
    '8d100000-0000-4000-8000-000000000001'
  );

create temporary table agent_artifact_runtime_linked_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8d100000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  array[
    'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
  ]::text[]
) authority;

create temporary table agent_artifact_runtime_unlinked_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8d100000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  array['photos.view', 'pipeline.view']::text[]
) authority;

create temporary table agent_artifact_runtime_linked_deck_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8d100000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  array[
    'calendar.view', 'clients.view', 'deck_builder.view', 'photos.view',
    'pipeline.view'
  ]::text[]
) authority;

create temporary table agent_artifact_runtime_unlinked_deck_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8d100000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  array['deck_builder.view', 'photos.view', 'pipeline.view']::text[]
) authority;

create temporary table agent_artifact_runtime_site_visit_project_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8d100000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  array[
    'calendar.view', 'clients.view', 'photos.view', 'pipeline.view',
    'projects.view'
  ]::text[]
) authority;

create temporary table agent_artifact_runtime_historical_lead_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8d100000-0000-4000-8000-000000000002',
  '8d000000-0000-4000-8000-000000000001',
  array[
    'calendar.view', 'clients.view', 'deck_builder.view', 'photos.view',
    'pipeline.view'
  ]::text[]
) authority;

do $dual_parent_deck_current_project_authority$
declare
  v_direct_hidden_count integer;
  v_direct_visible_control_count integer;
  v_visit_bridge_hidden_count integer;
begin
  if not private.agent_user_can_access_entity(
       '8d100000-0000-4000-8000-000000000002',
       '8d000000-0000-4000-8000-000000000001',
       'opportunity',
       '8d300000-0000-4000-8000-000000000001',
       'view'
     )
     or private.agent_user_can_access_entity(
       '8d100000-0000-4000-8000-000000000002',
       '8d000000-0000-4000-8000-000000000001',
       'project',
       '8d400000-0000-4000-8000-000000000001',
       'view'
     ) then
    raise exception
      'agent_artifact_runtime_failed: dual-parent authority fixture invalid';
  end if;

  select pg_catalog.count(*)
    into strict v_direct_hidden_count
  from private.agent_p2_artifact_private_evidence_v1(
    '8d100000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_artifact_runtime_historical_lead_authority),
    array[
      'calendar.view', 'clients.view', 'deck_builder.view', 'photos.view',
      'pipeline.view'
    ]::text[],
    '{"deck_builder.view":"assigned","pipeline.view":"all"}'::jsonb,
    'opportunity',
    '8d300000-0000-4000-8000-000000000001',
    array['deck_design']::text[],
    501
  ) source
  where source.source_kind = 'deck_design'
    and source.source_id = '8d620000-0000-4000-8000-000000000001';

  if v_direct_hidden_count <> 0 then
    raise exception
      'agent_artifact_runtime_failed: direct deck leaked through historical opportunity';
  end if;

  select pg_catalog.count(*)
    into strict v_direct_visible_control_count
  from private.agent_p2_artifact_private_evidence_v1(
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_artifact_runtime_linked_deck_authority),
    array[
      'calendar.view', 'clients.view', 'deck_builder.view', 'photos.view',
      'pipeline.view'
    ]::text[],
    '{"deck_builder.view":"all","pipeline.view":"all"}'::jsonb,
    'opportunity',
    '8d300000-0000-4000-8000-000000000001',
    array['deck_design']::text[],
    501
  ) source
  where source.source_kind = 'deck_design'
    and source.source_id = '8d620000-0000-4000-8000-000000000001';

  if v_direct_visible_control_count <> 1 then
    raise exception
      'agent_artifact_runtime_failed: valid converted deck provenance hidden';
  end if;

  select pg_catalog.count(*)
    into strict v_visit_bridge_hidden_count
  from private.agent_p2_artifact_private_evidence_v1(
    '8d100000-0000-4000-8000-000000000002',
    '8d000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_artifact_runtime_historical_lead_authority),
    array[
      'calendar.view', 'clients.view', 'deck_builder.view', 'photos.view',
      'pipeline.view'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","deck_builder.view":"assigned","photos.view":"all","pipeline.view":"all"}'::jsonb,
    'opportunity',
    '8d300000-0000-4000-8000-000000000001',
    array['deck_design', 'site_visit_artifact']::text[],
    501
  ) source
  where source.source_kind = 'site_visit_artifact'
    and source.source_id = '8d610000-0000-4000-8000-000000000003';

  if v_visit_bridge_hidden_count <> 0 then
    raise exception
      'agent_artifact_runtime_failed: visit deck leaked through historical opportunity';
  end if;
end;
$dual_parent_deck_current_project_authority$;

update private.mcp_oauth_clients
   set scope = 'ops.customers.read ops.files.read ops.schedule.read ops.site_visits.read',
       scope_ceiling = array[
         'ops.customers.read', 'ops.files.read', 'ops.schedule.read',
         'ops.site_visits.read'
       ]::text[]
 where client_id = '8d120000-0000-4000-8000-000000000001';
update private.mcp_oauth_grants
   set scopes = array[
         'ops.customers.read', 'ops.files.read', 'ops.schedule.read',
         'ops.site_visits.read'
       ]::text[],
       accepted_labels = private.mcp_oauth_labels_for_scopes(
         array[
           'ops.customers.read', 'ops.files.read', 'ops.schedule.read',
           'ops.site_visits.read'
         ]::text[],
         consent_catalog_revision
       )
 where id = '8d130000-0000-4000-8000-000000000001';

do $site_visit_anchor_contract$
declare
  v_linked_count integer;
  v_unlinked_count integer;
  v_linked_unauthorized_deck_count integer;
  v_unlinked_unauthorized_deck_count integer;
  v_linked_deck_count integer;
  v_unlinked_deck_count integer;
  v_linked_deck_safe boolean;
  v_unlinked_deck_safe boolean;
  v_linked_deck_sources text[];
  v_unlinked_deck_sources text[];
  v_public_project jsonb;
begin
  select pg_catalog.count(*),
         pg_catalog.count(*) filter (
           where source.artifact_kind = 'deck_design'
              or source.deck_design_ref is not null
         )
    into strict v_linked_count, v_linked_unauthorized_deck_count
  from private.agent_p2_artifact_private_evidence_v1(
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_artifact_runtime_linked_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","photos.view":"all","pipeline.view":"all"}'::jsonb,
    'site_visit_linked',
    '8d600000-0000-4000-8000-000000000001',
    array['site_visit_artifact']::text[],
    501
  ) source;

  select pg_catalog.count(*),
         pg_catalog.count(*) filter (
           where source.artifact_kind = 'deck_design'
              or source.deck_design_ref is not null
         )
    into strict v_unlinked_count, v_unlinked_unauthorized_deck_count
  from private.agent_p2_artifact_private_evidence_v1(
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_artifact_runtime_unlinked_authority),
    array['photos.view', 'pipeline.view']::text[],
    '{"photos.view":"all","pipeline.view":"all"}'::jsonb,
    'site_visit_unlinked',
    '8d600000-0000-4000-8000-000000000002',
    array['site_visit_artifact']::text[],
    501
  ) source;

  if v_linked_count <> 1
     or v_unlinked_count <> 1
     or v_linked_unauthorized_deck_count <> 0
     or v_unlinked_unauthorized_deck_count <> 0 then
    raise exception
      'agent_artifact_runtime_failed: site visit nominal anchor failed';
  end if;

  select pg_catalog.count(*),
         pg_catalog.bool_and(
           source.deck_design_ref ~ '^ops_deck_design:v1:[0-9a-f]{64}$'
           and source.deck_design_ref not like '%8d620000%'
         ),
         pg_catalog.array_agg(source.source_id order by source.source_id)
    into strict v_linked_deck_count,
                v_linked_deck_safe,
                v_linked_deck_sources
  from private.agent_p2_artifact_private_evidence_v1(
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_artifact_runtime_linked_deck_authority),
    array[
      'calendar.view', 'clients.view', 'deck_builder.view', 'photos.view',
      'pipeline.view'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","deck_builder.view":"all","photos.view":"all","pipeline.view":"all"}'::jsonb,
    'site_visit_linked',
    '8d600000-0000-4000-8000-000000000001',
    array['site_visit_artifact']::text[],
    501
  ) source
  where source.artifact_kind = 'deck_design';

  select pg_catalog.count(*),
         pg_catalog.bool_and(
           source.deck_design_ref ~ '^ops_deck_design:v1:[0-9a-f]{64}$'
           and source.deck_design_ref not like '%8d620000%'
         ),
         pg_catalog.array_agg(source.source_id order by source.source_id)
    into strict v_unlinked_deck_count,
                v_unlinked_deck_safe,
                v_unlinked_deck_sources
  from private.agent_p2_artifact_private_evidence_v1(
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_artifact_runtime_unlinked_deck_authority),
    array['deck_builder.view', 'photos.view', 'pipeline.view']::text[],
    '{"deck_builder.view":"all","photos.view":"all","pipeline.view":"all"}'::jsonb,
    'site_visit_unlinked',
    '8d600000-0000-4000-8000-000000000002',
    array['site_visit_artifact']::text[],
    501
  ) source
  where source.artifact_kind = 'deck_design';

  if v_linked_deck_count <> 2
     or v_unlinked_deck_count <> 1
     or v_linked_deck_safe is not true
     or v_unlinked_deck_safe is not true
     or v_linked_deck_sources is distinct from array[
       '8d610000-0000-4000-8000-000000000003',
       '8d610000-0000-4000-8000-000000000006'
     ]::text[]
     or v_unlinked_deck_sources is distinct from array[
       '8d610000-0000-4000-8000-000000000007'
     ]::text[] then
    raise exception
      'agent_artifact_runtime_failed: unsafe or invalid visit deck bridge';
  end if;

  select public.read_agent_job_artifacts_as_system(
    'agent-artifact-runtime-visit-deck-public',
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    '8d130000-0000-4000-8000-000000000001',
    '8d120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-artifact-runtime-grant'),
    array[
      'ops.customers.read', 'ops.files.read', 'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    (select permission_snapshot_revision
     from agent_artifact_runtime_site_visit_project_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view',
      'projects.view'
    ]::text[],
    'list_job_artifacts',
    'list_job_artifacts:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array[
      'ops.customers.read', 'ops.files.read', 'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","photos.view":"all","pipeline.view":"all","projects.view":"all"}'::jsonb,
    'project',
    '8d400000-0000-4000-8000-000000000001',
    array['site_visit_artifact']::text[],
    25, 26, 501,
    null, '[]'::jsonb, null, null, null
  ) into strict v_public_project;

  if v_public_project::text like '%ops_deck_design:%'
     or v_public_project::text like '%"artifact_kind": "deck_design"%'
     or v_public_project::text not like '%"artifact_kind": "measurement"%' then
    raise exception
      'agent_artifact_runtime_failed: public visit bridge manufactured deck authority';
  end if;

  begin
    perform 1
    from private.agent_p2_artifact_private_evidence_v1(
      '8d100000-0000-4000-8000-000000000001',
      '8d000000-0000-4000-8000-000000000001',
      (select permission_snapshot_revision
       from agent_artifact_runtime_unlinked_authority),
      array['photos.view', 'pipeline.view']::text[],
      '{"photos.view":"assigned","pipeline.view":"all"}'::jsonb,
      'site_visit_unlinked',
      '8d600000-0000-4000-8000-000000000002',
      array['site_visit_artifact']::text[],
      501
    );
    raise exception
      'agent_artifact_runtime_failed: unlinked assigned photos accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'invalid_agent_artifact_private_evidence_request' then
        raise;
      end if;
  end;
end;
$site_visit_anchor_contract$;

update private.mcp_oauth_clients
   set scope = 'ops.files.read',
       scope_ceiling = array['ops.files.read']::text[]
 where client_id = '8d120000-0000-4000-8000-000000000001';
update private.mcp_oauth_grants
   set scopes = array['ops.files.read']::text[],
       accepted_labels = private.mcp_oauth_labels_for_scopes(
         array['ops.files.read']::text[],
         consent_catalog_revision
       )
 where id = '8d130000-0000-4000-8000-000000000001';

-- Production-shaped hostile planner corpus. Every family has one requested
-- row behind 20,000 same-company rows for a different job. Trigger side
-- effects are suppressed only for this synthetic EXPLAIN population.
set local session_replication_role = replica;

insert into public.projects (
  id, company_id, client_id, title, status, opportunity_ref
) values (
  '8d4f0000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d200000-0000-4000-8000-000000000001',
  'Artifact planner noise project', 'in_progress',
  '8d300000-0000-4000-8000-000000000003'
);

insert into public.projects (
  id, company_id, client_id, title, status, opportunity_ref
)
select (
         '8d4f0001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       '8d200000-0000-4000-8000-000000000001',
       'Artifact planner noise project ' || series.value::text,
       'in_progress',
       '8d300000-0000-4000-8000-000000000003'
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.site_visits (
  id, company_id, opportunity_id, client_id, client_ref, project_ref,
  scheduled_at, created_by, assignee_ids
) values (
  '8d6e0000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d300000-0000-4000-8000-000000000003',
  '8d200000-0000-4000-8000-000000000001',
  '8d200000-0000-4000-8000-000000000001',
  '8d4f0000-0000-4000-8000-000000000001',
  timestamptz '2027-01-01 00:00:00+00',
  '8d100000-0000-4000-8000-000000000001',
  array['8d100000-0000-4000-8000-000000000001']::text[]
);

insert into public.site_visits (
  id, company_id, opportunity_id, client_id, client_ref, project_ref,
  scheduled_at, created_by, assignee_ids
)
select (
         '8d6e0001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       '8d300000-0000-4000-8000-000000000003',
       '8d200000-0000-4000-8000-000000000001',
       '8d200000-0000-4000-8000-000000000001',
       '8d4f0000-0000-4000-8000-000000000001',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second',
       '8d100000-0000-4000-8000-000000000001',
       array['8d100000-0000-4000-8000-000000000001']::text[]
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.project_photos (
  id, company_id, project_id, source, caption, taken_at, created_at,
  is_client_visible, url
) values (
  '8d710000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d400000-0000-4000-8000-000000000001',
  'other', 'Requested planner photo',
  timestamptz '2027-01-01 00:00:00+00',
  timestamptz '2027-01-01 00:00:00+00', true,
  'https://planner.invalid/photo/requested'
);
insert into public.project_photos (
  id, company_id, project_id, source, caption, taken_at, created_at,
  is_client_visible, url
)
select (
         '8d710001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       '8d4f0000-0000-4000-8000-000000000001',
       'other', 'Planner photo ' || series.value::text,
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second',
       timestamptz '2027-01-01 00:00:00+00', false,
       'https://planner.invalid/photo/' || series.value::text
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.project_photo_annotations (
  id, company_id, project_id, photo_url, annotation_url, note,
  created_at, updated_at
) values (
  '8d720000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d400000-0000-4000-8000-000000000001',
  'https://planner.invalid/photo/requested',
  'https://planner.invalid/annotation/requested', 'Requested annotation',
  timestamptz '2027-01-01 00:00:00+00',
  timestamptz '2027-01-01 00:00:00+00'
);
insert into public.project_photo_annotations (
  id, company_id, project_id, photo_url, annotation_url, note,
  created_at, updated_at
)
select (
         '8d720001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       '8d4f0000-0000-4000-8000-000000000001',
       'https://planner.invalid/photo/' || series.value::text,
       'https://planner.invalid/annotation/' || series.value::text,
       'Planner annotation ' || series.value::text,
       timestamptz '2027-01-01 00:00:00+00',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second'
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.project_notes (
  id, project_id, company_id, author_id, content, created_at
)
select (
         '8d730001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d4f0000-0000-4000-8000-000000000001',
       '8d000000-0000-4000-8000-000000000001',
       '8d100000-0000-4000-8000-000000000001',
       'Planner note ' || series.value::text,
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second'
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.site_visit_artifacts (
  id, site_visit_id, company_id, opportunity_id, kind, source, title, body,
  captured_at, created_by
)
select (
         '8d740001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d6e0000-0000-4000-8000-000000000001',
       '8d000000-0000-4000-8000-000000000001',
       '8d300000-0000-4000-8000-000000000003',
       'note', 'manual', 'Planner visit artifact ' || series.value::text,
       'Same-company job noise',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second',
       '8d100000-0000-4000-8000-000000000001'
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.deck_designs (
  id, company_id, opportunity_id, project_id, title, created_at
)
select (
         '8d750001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       '8d300000-0000-4000-8000-000000000003',
       '8d4f0000-0000-4000-8000-000000000001',
       'Planner deck ' || series.value::text,
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second'
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.email_attachments (
  id, company_id, connection_id, opportunity_id, attribution_status,
  ingest_status, occurred_at, created_at, filename
) values (
  '8d760000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d7d0000-0000-4000-8000-000000000001',
  '8d300000-0000-4000-8000-000000000001',
  'attributed', 'discovered', timestamptz '2027-01-01 00:00:00+00',
  timestamptz '2027-01-01 00:00:00+00', 'requested.pdf'
);
insert into public.email_attachments (
  id, company_id, connection_id, opportunity_id, attribution_status,
  ingest_status, occurred_at, created_at, filename
)
select (
         '8d760001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       '8d7d0000-0000-4000-8000-000000000001',
       '8d300000-0000-4000-8000-000000000003',
       'attributed', 'discovered',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second',
       timestamptz '2027-01-01 00:00:00+00',
       'planner-' || series.value::text || '.pdf'
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.email_attachment_inspection_jobs (
  id, company_id, email_attachment_id, status
) values (
  '8d770000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d760000-0000-4000-8000-000000000001', 'pending'
);
insert into public.email_attachment_inspection_jobs (
  id, company_id, email_attachment_id, status
)
select (
         '8d770001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       (
         '8d760001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       'pending'
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.attachment_inspections (
  id, company_id, connection_id, email_attachment_id
) values (
  '8d780000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d7d0000-0000-4000-8000-000000000001',
  '8d760000-0000-4000-8000-000000000001'
);
insert into public.attachment_inspections (
  id, company_id, connection_id, email_attachment_id
)
select (
         '8d780001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       '8d7d0000-0000-4000-8000-000000000001',
       (
         '8d760001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.estimates (
  id, company_id, opportunity_id, project_ref, title, estimate_number,
  pdf_storage_path, created_at, updated_at
) values (
  '8d790000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d300000-0000-4000-8000-000000000001',
  '8d400000-0000-4000-8000-000000000001',
  'Requested estimate', 'EST-PLAN-REQUESTED', 'planner/requested-estimate.pdf',
  timestamptz '2027-01-01 00:00:00+00',
  timestamptz '2027-01-01 00:00:00+00'
);
insert into public.estimates (
  id, company_id, opportunity_id, project_ref, title, estimate_number,
  pdf_storage_path, created_at, updated_at
)
select (
         '8d790001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       '8d300000-0000-4000-8000-000000000003',
       '8d4f0000-0000-4000-8000-000000000001',
       'Planner estimate ' || series.value::text,
       'EST-PLAN-' || series.value::text,
       'planner/estimate-' || series.value::text || '.pdf',
       timestamptz '2027-01-01 00:00:00+00',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second'
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.invoices (
  id, company_id, opportunity_id, project_ref, subject, invoice_number,
  pdf_storage_path, created_at, updated_at
) values (
  '8d7a0000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d300000-0000-4000-8000-000000000001',
  '8d400000-0000-4000-8000-000000000001',
  'Requested invoice', 'INV-PLAN-REQUESTED', 'planner/requested-invoice.pdf',
  timestamptz '2027-01-01 00:00:00+00',
  timestamptz '2027-01-01 00:00:00+00'
);
insert into public.invoices (
  id, company_id, opportunity_id, project_ref, subject, invoice_number,
  pdf_storage_path, created_at, updated_at
)
select (
         '8d7a0001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       '8d300000-0000-4000-8000-000000000003',
       '8d4f0000-0000-4000-8000-000000000001',
       'Planner invoice ' || series.value::text,
       'INV-PLAN-' || series.value::text,
       'planner/invoice-' || series.value::text || '.pdf',
       timestamptz '2027-01-01 00:00:00+00',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second'
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.expenses (
  id, company_id, submitted_by, receipt_image_url, created_at, updated_at
) values (
  '8d7b0000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  '8d100000-0000-4000-8000-000000000001',
  'https://planner.invalid/receipt/requested.jpg',
  timestamptz '2027-01-01 00:00:00+00',
  timestamptz '2027-01-01 00:00:00+00'
);
insert into public.expenses (
  id, company_id, submitted_by, receipt_image_url, created_at, updated_at
)
select (
         '8d7b0001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d000000-0000-4000-8000-000000000001',
       '8d100000-0000-4000-8000-000000000001',
       'https://planner.invalid/receipt/' || series.value::text || '.jpg',
       timestamptz '2027-01-01 00:00:00+00',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second'
from pg_catalog.generate_series(1, 20000) series(value);

insert into public.expense_project_allocations (
  id, expense_id, project_id
) values (
  '8d7c0000-0000-4000-8000-000000000001',
  '8d7b0000-0000-4000-8000-000000000001',
  '8d400000-0000-4000-8000-000000000001'
);
insert into public.expense_project_allocations (
  id, expense_id, project_id
)
select (
         '8d7c0001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       (
         '8d7b0001-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d4f0000-0000-4000-8000-000000000001'
from pg_catalog.generate_series(1, 20000) series(value);

set local session_replication_role = origin;

analyze public.projects;
analyze public.site_visits;
analyze public.project_photos;
analyze public.project_photo_annotations;
analyze public.project_notes;
analyze public.site_visit_artifacts;
analyze public.deck_designs;
analyze public.email_attachments;
analyze public.email_attachment_inspection_jobs;
analyze public.attachment_inspections;
analyze public.estimates;
analyze public.invoices;
analyze public.expenses;
analyze public.expense_project_allocations;

create function pg_temp.assert_artifact_source_plan(
  p_source_kind text,
  p_case_name text,
  p_plan jsonb,
  p_required_indexes text[],
  p_relations text[]
) returns void
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_missing_index text;
  v_seq_scan boolean;
  v_relation_count integer;
  v_max_work bigint;
  v_max_loops bigint;
  v_max_heap_fetches bigint;
  v_max_buffers bigint;
  v_max_sort_rows bigint;
  v_limit_rows bigint;
begin
  with recursive plan_nodes(node) as (
    select p_plan #> '{0,Plan}'
    union all
    select child.value
    from plan_nodes parent
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(parent.node -> 'Plans', '[]'::jsonb)
    ) child(value)
  )
  select expected.index_name
    into v_missing_index
  from pg_catalog.unnest(p_required_indexes) expected(index_name)
  where not exists (
    select 1
    from plan_nodes node
    where node.node ->> 'Index Name' = expected.index_name
      and coalesce((node.node ->> 'Actual Loops')::bigint, 0) > 0
  )
  limit 1;

  if v_missing_index is not null then
    raise exception
      'agent_artifact_runtime_failed: artifact source plan did not use required index: %, %, %',
      p_source_kind, p_case_name, v_missing_index;
  end if;

  with recursive plan_nodes(node) as (
    select p_plan #> '{0,Plan}'
    union all
    select child.value
    from plan_nodes parent
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(parent.node -> 'Plans', '[]'::jsonb)
    ) child(value)
  )
  select pg_catalog.count(distinct node ->> 'Relation Name')::integer,
         coalesce(pg_catalog.bool_or(
           node ->> 'Node Type' = 'Seq Scan'
           and coalesce((node ->> 'Actual Loops')::bigint, 0) > 0
         ), false),
         pg_catalog.max(
           (
             coalesce((node ->> 'Actual Rows')::bigint, 0) +
             coalesce((node ->> 'Rows Removed by Filter')::bigint, 0) +
             coalesce((node ->> 'Rows Removed by Join Filter')::bigint, 0) +
             coalesce((node ->> 'Rows Removed by Index Recheck')::bigint, 0)
           ) * coalesce((node ->> 'Actual Loops')::bigint, 0)
         ),
         pg_catalog.max(
           coalesce((node ->> 'Actual Loops')::bigint, 0)
         ),
         pg_catalog.max(
           coalesce((node ->> 'Heap Fetches')::bigint, 0)
         ),
         pg_catalog.max(
           coalesce((node ->> 'Shared Hit Blocks')::bigint, 0) +
           coalesce((node ->> 'Shared Read Blocks')::bigint, 0)
         )
    into v_relation_count, v_seq_scan, v_max_work, v_max_loops,
         v_max_heap_fetches, v_max_buffers
  from plan_nodes
  where node ->> 'Relation Name' = any(p_relations);

  if v_relation_count is distinct from pg_catalog.cardinality(p_relations)
     or v_seq_scan then
    raise exception
      'agent_artifact_runtime_failed: artifact source plan executed a sequential scan: %, %',
      p_source_kind, p_case_name;
  end if;
  if v_max_work is null or v_max_work > 501
     or v_max_loops is null or v_max_loops > 501
     or coalesce(v_max_heap_fetches, 0) > 501 then
    raise exception
      'agent_artifact_runtime_failed: artifact source plan exceeded physical work bound: %, %, %, %, %',
      p_source_kind, p_case_name, v_max_work, v_max_loops,
      v_max_heap_fetches;
  end if;
  if v_max_buffers is null or v_max_buffers > 512 then
    raise exception
      'agent_artifact_runtime_failed: artifact source plan exceeded buffer bound: %, %, %',
      p_source_kind, p_case_name, v_max_buffers;
  end if;

  with recursive plan_nodes(node) as (
    select p_plan #> '{0,Plan}'
    union all
    select child.value
    from plan_nodes parent
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(parent.node -> 'Plans', '[]'::jsonb)
    ) child(value)
  )
  select pg_catalog.max((node ->> 'Actual Rows')::bigint) filter (
           where node ->> 'Node Type' in ('Sort', 'Incremental Sort')
         ),
         pg_catalog.max((node ->> 'Actual Rows')::bigint) filter (
           where node ->> 'Node Type' = 'Limit'
         )
    into v_max_sort_rows, v_limit_rows
  from plan_nodes;

  if coalesce(v_max_sort_rows, 0) > 501
     or v_limit_rows is null or v_limit_rows > 501 then
    raise exception
      'agent_artifact_runtime_failed: artifact source plan exceeded physical work bound: %, %, %, %',
      p_source_kind, p_case_name, v_max_sort_rows, v_limit_rows;
  end if;
end;
$function$;

do $artifact_source_plan_contract$
declare
  v_case record;
  v_plan jsonb;
begin
  for v_case in
    select scenario.*
    from (values
      (
        'project_photo'::text,
        'project'::text,
        $plan$explain (analyze, buffers, format json)
          select photo.id, annotation.id
          from public.project_photos photo
          left join lateral (
            select annotation_row.id
            from public.project_photo_annotations annotation_row
            where annotation_row.company_id = photo.company_id
              and annotation_row.project_id = photo.project_id
              and pg_catalog.md5(annotation_row.photo_url) =
                pg_catalog.md5(photo.url)
              and annotation_row.photo_url = photo.url
              and annotation_row.deleted_at is null
            order by coalesce(
              annotation_row.updated_at, annotation_row.created_at
            ) desc, annotation_row.id desc
            limit 1
          ) annotation on true
          where pg_catalog.lower(photo.company_id) =
                  '8d000000-0000-4000-8000-000000000001'
            and private.agent_p2_artifact_uuid_from_text(photo.company_id) =
                  '8d000000-0000-4000-8000-000000000001'
            and pg_catalog.lower(photo.project_id) =
                  '8d400000-0000-4000-8000-000000000001'
            and private.agent_p2_artifact_uuid_from_text(photo.project_id) =
                  '8d400000-0000-4000-8000-000000000001'
            and photo.deleted_at is null
          order by photo.id
          limit 501$plan$::text,
        array[
          'idx_project_photos_agent_artifact_project_v1',
          'idx_project_photo_annotations_agent_artifact_latest_v1'
        ]::text[],
        array['project_photos', 'project_photo_annotations']::text[]
      ),
      (
        'project_note', 'project',
        $plan$explain (analyze, buffers, format json)
          select note.id
          from public.project_notes note
          where pg_catalog.lower(note.company_id) =
                  '8d000000-0000-4000-8000-000000000001'
            and private.agent_p2_artifact_uuid_from_text(note.company_id) =
                  '8d000000-0000-4000-8000-000000000001'
            and pg_catalog.lower(note.project_id) =
                  '8d400000-0000-4000-8000-000000000001'
            and private.agent_p2_artifact_uuid_from_text(note.project_id) =
                  '8d400000-0000-4000-8000-000000000001'
            and note.deleted_at is null
            and note.event_kind is null
          order by note.id
          limit 501$plan$,
        array['idx_project_notes_agent_artifact_project_v1']::text[],
        array['project_notes']::text[]
      ),
      (
        'project_note', 'opportunity',
        $plan$explain (analyze, buffers, format json)
          select note.id
          from (
            select note_project.id
            from public.projects note_project
            where note_project.company_id =
                    '8d000000-0000-4000-8000-000000000001'
              and coalesce(
                    note_project.opportunity_ref::text,
                    pg_catalog.lower(note_project.opportunity_id)
                  ) = '8d300000-0000-4000-8000-000000000001'
              and coalesce(
                    note_project.opportunity_ref,
                    private.agent_p2_artifact_uuid_from_text(
                      note_project.opportunity_id
                    )
                  ) = '8d300000-0000-4000-8000-000000000001'
              and note_project.deleted_at is null
            order by note_project.id
            limit 501
          ) note_project
          cross join lateral (
            select note_row.id
            from public.project_notes note_row
            where pg_catalog.lower(note_row.company_id) =
                    '8d000000-0000-4000-8000-000000000001'
              and private.agent_p2_artifact_uuid_from_text(
                    note_row.company_id
                  ) = '8d000000-0000-4000-8000-000000000001'
              and pg_catalog.lower(note_row.project_id) =
                    note_project.id::text
              and private.agent_p2_artifact_uuid_from_text(
                    note_row.project_id
                  ) = note_project.id
              and note_row.deleted_at is null
              and note_row.event_kind is null
            order by note_row.id
            limit 501
          ) note
          limit 501$plan$,
        array[
          'idx_projects_agent_artifact_opportunity_v1',
          'idx_project_notes_agent_artifact_project_v1'
        ]::text[],
        array['projects', 'project_notes']::text[]
      ),
      (
        'site_visit_artifact', 'site_visit',
        $plan$explain (analyze, buffers, format json)
          select artifact.id
          from public.site_visit_artifacts artifact
          join public.site_visits visit
            on visit.id = artifact.site_visit_id
           and pg_catalog.lower(visit.company_id) =
                 '8d000000-0000-4000-8000-000000000001'
           and private.agent_p2_artifact_uuid_from_text(visit.company_id) =
                 '8d000000-0000-4000-8000-000000000001'
           and visit.deleted_at is null
          where pg_catalog.lower(artifact.company_id) =
                  '8d000000-0000-4000-8000-000000000001'
            and private.agent_p2_artifact_uuid_from_text(artifact.company_id) =
                  '8d000000-0000-4000-8000-000000000001'
            and artifact.site_visit_id =
                  '8d600000-0000-4000-8000-000000000001'
            and artifact.deleted_at is null
          order by artifact.captured_at, artifact.id
          limit 501$plan$,
        array['idx_site_visit_artifacts_agent_context_v1']::text[],
        array['site_visit_artifacts']::text[]
      ),
      (
        'site_visit_artifact', 'opportunity',
        $plan$explain (analyze, buffers, format json)
          select artifact.id
          from (
            select visit.id
            from public.site_visits visit
            where pg_catalog.lower(visit.company_id) =
                    '8d000000-0000-4000-8000-000000000001'
              and private.agent_p2_artifact_uuid_from_text(
                    visit.company_id
                  ) = '8d000000-0000-4000-8000-000000000001'
              and visit.opportunity_id =
                    '8d300000-0000-4000-8000-000000000001'
              and visit.deleted_at is null
            order by visit.id
            limit 501
          ) visit
          cross join lateral (
            select artifact_row.id
            from public.site_visit_artifacts artifact_row
            where pg_catalog.lower(artifact_row.company_id) =
                    '8d000000-0000-4000-8000-000000000001'
              and private.agent_p2_artifact_uuid_from_text(
                    artifact_row.company_id
                  ) = '8d000000-0000-4000-8000-000000000001'
              and artifact_row.site_visit_id = visit.id
              and artifact_row.deleted_at is null
            order by artifact_row.captured_at, artifact_row.id
            limit 501
          ) artifact
          limit 501$plan$,
        array[
          'idx_site_visits_agent_artifact_opportunity_v1',
          'idx_site_visit_artifacts_agent_context_v1'
        ]::text[],
        array['site_visits', 'site_visit_artifacts']::text[]
      ),
      (
        'site_visit_artifact', 'project',
        $plan$explain (analyze, buffers, format json)
          select artifact.id
          from (
            select visit.id
            from public.site_visits visit
            where pg_catalog.lower(visit.company_id) =
                    '8d000000-0000-4000-8000-000000000001'
              and private.agent_p2_artifact_uuid_from_text(
                    visit.company_id
                  ) = '8d000000-0000-4000-8000-000000000001'
              and coalesce(
                    visit.project_ref::text,
                    pg_catalog.lower(visit.project_id)
                  ) = '8d400000-0000-4000-8000-000000000001'
              and coalesce(
                    visit.project_ref,
                    private.agent_p2_artifact_uuid_from_text(visit.project_id)
                  ) = '8d400000-0000-4000-8000-000000000001'
              and visit.deleted_at is null
            order by visit.id
            limit 501
          ) visit
          cross join lateral (
            select artifact_row.id
            from public.site_visit_artifacts artifact_row
            where pg_catalog.lower(artifact_row.company_id) =
                    '8d000000-0000-4000-8000-000000000001'
              and private.agent_p2_artifact_uuid_from_text(
                    artifact_row.company_id
                  ) = '8d000000-0000-4000-8000-000000000001'
              and artifact_row.site_visit_id = visit.id
              and artifact_row.deleted_at is null
            order by artifact_row.captured_at, artifact_row.id
            limit 501
          ) artifact
          limit 501$plan$,
        array[
          'idx_site_visits_agent_artifact_project_v1',
          'idx_site_visit_artifacts_agent_context_v1'
        ]::text[],
        array['site_visits', 'site_visit_artifacts']::text[]
      ),
      (
        'deck_design', 'opportunity',
        $plan$explain (analyze, buffers, format json)
          select design.id
          from public.deck_designs design
          where design.company_id =
                  '8d000000-0000-4000-8000-000000000001'
            and design.opportunity_id =
                  '8d300000-0000-4000-8000-000000000001'
            and design.deleted_at is null
          order by design.id
          limit 501$plan$,
        array['idx_deck_designs_agent_artifact_opportunity_v1']::text[],
        array['deck_designs']::text[]
      ),
      (
        'deck_design', 'project',
        $plan$explain (analyze, buffers, format json)
          select design.id
          from public.deck_designs design
          where design.company_id =
                  '8d000000-0000-4000-8000-000000000001'
            and design.project_id =
                  '8d400000-0000-4000-8000-000000000001'
            and design.deleted_at is null
          order by design.id
          limit 501$plan$,
        array['idx_deck_designs_agent_artifact_project_v1']::text[],
        array['deck_designs']::text[]
      ),
      (
        'email_attachment', 'opportunity',
        $plan$explain (analyze, buffers, format json)
          select attachment.id, inspection_job.status, inspection.id
          from public.email_attachments attachment
          left join public.email_attachment_inspection_jobs inspection_job
            on inspection_job.email_attachment_id = attachment.id
           and inspection_job.company_id =
                 '8d000000-0000-4000-8000-000000000001'
          left join public.attachment_inspections inspection
            on inspection.email_attachment_id = attachment.id
           and inspection.company_id =
                 '8d000000-0000-4000-8000-000000000001'
           and inspection.connection_id = attachment.connection_id
          where attachment.company_id =
                  '8d000000-0000-4000-8000-000000000001'
            and attachment.opportunity_id =
                  '8d300000-0000-4000-8000-000000000001'
            and attachment.attribution_status = 'attributed'
          order by attachment.id
          limit 501$plan$,
        array[
          'idx_email_attachments_agent_artifact_opportunity_v1',
          'idx_email_attachment_inspection_jobs_agent_artifact_v1',
          'idx_attachment_inspections_agent_artifact_v1'
        ]::text[],
        array[
          'email_attachments', 'email_attachment_inspection_jobs',
          'attachment_inspections'
        ]::text[]
      ),
      (
        'generated_estimate', 'opportunity',
        $plan$explain (analyze, buffers, format json)
          select estimate.id
          from public.estimates estimate
          where estimate.company_id =
                  '8d000000-0000-4000-8000-000000000001'
            and estimate.opportunity_id =
                  '8d300000-0000-4000-8000-000000000001'
            and estimate.deleted_at is null
            and nullif(pg_catalog.btrim(estimate.pdf_storage_path), '')
                  is not null
          order by estimate.id
          limit 501$plan$,
        array['idx_estimates_agent_artifact_opportunity_v1']::text[],
        array['estimates']::text[]
      ),
      (
        'generated_estimate', 'project',
        $plan$explain (analyze, buffers, format json)
          select estimate.id
          from public.estimates estimate
          where estimate.company_id =
                  '8d000000-0000-4000-8000-000000000001'
            and coalesce(
                  estimate.project_ref::text,
                  pg_catalog.lower(estimate.project_id)
                ) = '8d400000-0000-4000-8000-000000000001'
            and coalesce(
                  estimate.project_ref,
                  private.agent_p2_artifact_uuid_from_text(estimate.project_id)
                ) = '8d400000-0000-4000-8000-000000000001'
            and estimate.deleted_at is null
            and nullif(pg_catalog.btrim(estimate.pdf_storage_path), '')
                  is not null
          order by estimate.id
          limit 501$plan$,
        array['idx_estimates_agent_artifact_project_v1']::text[],
        array['estimates']::text[]
      ),
      (
        'generated_invoice', 'opportunity',
        $plan$explain (analyze, buffers, format json)
          select invoice.id
          from public.invoices invoice
          where invoice.company_id =
                  '8d000000-0000-4000-8000-000000000001'
            and invoice.opportunity_id =
                  '8d300000-0000-4000-8000-000000000001'
            and invoice.deleted_at is null
            and nullif(pg_catalog.btrim(invoice.pdf_storage_path), '')
                  is not null
          order by invoice.id
          limit 501$plan$,
        array['idx_invoices_agent_artifact_opportunity_v1']::text[],
        array['invoices']::text[]
      ),
      (
        'generated_invoice', 'project',
        $plan$explain (analyze, buffers, format json)
          select invoice.id
          from public.invoices invoice
          where invoice.company_id =
                  '8d000000-0000-4000-8000-000000000001'
            and coalesce(
                  invoice.project_ref,
                  invoice.project_id
                ) = '8d400000-0000-4000-8000-000000000001'
            and invoice.deleted_at is null
            and nullif(pg_catalog.btrim(invoice.pdf_storage_path), '')
                  is not null
          order by invoice.id
          limit 501$plan$,
        array['idx_invoices_agent_artifact_project_v1']::text[],
        array['invoices']::text[]
      ),
      (
        'expense_receipt', 'project',
        $plan$explain (analyze, buffers, format json)
          select expense.id, allocation.id
          from public.expense_project_allocations allocation
          join public.expenses expense on expense.id = allocation.expense_id
          where pg_catalog.lower(allocation.project_id) =
                  '8d400000-0000-4000-8000-000000000001'
            and private.agent_p2_artifact_uuid_from_text(
                  allocation.project_id
                ) = '8d400000-0000-4000-8000-000000000001'
            and expense.company_id =
                  '8d000000-0000-4000-8000-000000000001'
            and expense.deleted_at is null
            and nullif(pg_catalog.btrim(expense.receipt_image_url), '')
                  is not null
          order by allocation.expense_id
          limit 501$plan$,
        array[
          'idx_expense_project_allocations_agent_artifact_project_v1'
        ]::text[],
        array['expense_project_allocations', 'expenses']::text[]
      )
    ) scenario(
      source_kind, case_name, plan_sql, required_indexes, relations
    )
  loop
    execute v_case.plan_sql into strict v_plan;
    perform pg_temp.assert_artifact_source_plan(
      v_case.source_kind,
      v_case.case_name,
      v_plan,
      v_case.required_indexes,
      v_case.relations
    );
  end loop;
end;
$artifact_source_plan_contract$;

set local session_replication_role = replica;
delete from public.project_photo_annotations
where id = '8d720000-0000-4000-8000-000000000001'
   or id between '8d720001-0000-4000-8000-000000000001'
             and '8d720001-0000-4000-8000-000000004e20';
delete from public.project_photos
where id = '8d710000-0000-4000-8000-000000000001'
   or id between '8d710001-0000-4000-8000-000000000001'
             and '8d710001-0000-4000-8000-000000004e20';
delete from public.project_notes
where id between '8d730001-0000-4000-8000-000000000001'
             and '8d730001-0000-4000-8000-000000004e20';
delete from public.site_visit_artifacts
where id between '8d740001-0000-4000-8000-000000000001'
             and '8d740001-0000-4000-8000-000000004e20';
delete from public.deck_designs
where id between '8d750001-0000-4000-8000-000000000001'
             and '8d750001-0000-4000-8000-000000004e20';
delete from public.email_attachment_inspection_jobs
where id = '8d770000-0000-4000-8000-000000000001'
   or id between '8d770001-0000-4000-8000-000000000001'
             and '8d770001-0000-4000-8000-000000004e20';
delete from public.attachment_inspections
where id = '8d780000-0000-4000-8000-000000000001'
   or id between '8d780001-0000-4000-8000-000000000001'
             and '8d780001-0000-4000-8000-000000004e20';
delete from public.email_attachments
where id = '8d760000-0000-4000-8000-000000000001'
   or id between '8d760001-0000-4000-8000-000000000001'
             and '8d760001-0000-4000-8000-000000004e20';
delete from public.estimates
where id = '8d790000-0000-4000-8000-000000000001'
   or id between '8d790001-0000-4000-8000-000000000001'
             and '8d790001-0000-4000-8000-000000004e20';
delete from public.invoices
where id = '8d7a0000-0000-4000-8000-000000000001'
   or id between '8d7a0001-0000-4000-8000-000000000001'
             and '8d7a0001-0000-4000-8000-000000004e20';
delete from public.expense_project_allocations
where id = '8d7c0000-0000-4000-8000-000000000001'
   or id between '8d7c0001-0000-4000-8000-000000000001'
             and '8d7c0001-0000-4000-8000-000000004e20';
delete from public.expenses
where id = '8d7b0000-0000-4000-8000-000000000001'
   or id between '8d7b0001-0000-4000-8000-000000000001'
             and '8d7b0001-0000-4000-8000-000000004e20';
delete from public.site_visits
where id = '8d6e0000-0000-4000-8000-000000000001'
   or id between '8d6e0001-0000-4000-8000-000000000001'
             and '8d6e0001-0000-4000-8000-000000004e20';
delete from public.projects
where id = '8d4f0000-0000-4000-8000-000000000001'
   or id between '8d4f0001-0000-4000-8000-000000000001'
             and '8d4f0001-0000-4000-8000-000000004e20';
set local session_replication_role = origin;

analyze public.projects;
analyze public.site_visits;
analyze public.project_photos;
analyze public.project_photo_annotations;
analyze public.project_notes;
analyze public.site_visit_artifacts;
analyze public.deck_designs;
analyze public.email_attachments;
analyze public.email_attachment_inspection_jobs;
analyze public.attachment_inspections;
analyze public.estimates;
analyze public.invoices;
analyze public.expenses;
analyze public.expense_project_allocations;

-- Complete the physical source cap only after the authority/cursor assertions.
insert into public.project_notes (
  id, project_id, company_id, author_id, content, created_at
)
select (
         '8d5f0000-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d400000-0000-4000-8000-000000000001',
       '8d000000-0000-4000-8000-000000000001',
       '8d100000-0000-4000-8000-000000000001',
       'Bounded note ' || series.value::text,
       pg_catalog.date_trunc(
         'milliseconds',
         pg_catalog.statement_timestamp() - series.value * interval '1 second'
       )
from pg_catalog.generate_series(1, 499) series(value);

do $source_bound_contract$
begin
  begin
    perform public.read_agent_job_artifacts_as_system(
      'agent-artifact-runtime-bound',
      '8d100000-0000-4000-8000-000000000001',
      '8d000000-0000-4000-8000-000000000001',
      '8d130000-0000-4000-8000-000000000001',
      '8d120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-artifact-runtime-grant'),
      array['ops.files.read']::text[],
      (select permission_snapshot_revision
       from agent_artifact_runtime_project_authority),
      array['projects.view']::text[],
      'list_job_artifacts',
      'list_job_artifacts:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.files.read']::text[],
      '{"projects.view":"all"}'::jsonb,
      'project',
      '8d400000-0000-4000-8000-000000000001',
      array['project_note']::text[],
      25, 26, 501,
      null, '[]'::jsonb, null, null, null
    );
    raise exception 'agent_artifact_runtime_failed: source bound accepted';
  exception
    when sqlstate '54000' then
      if sqlerrm <> 'agent_artifact_source_query_bound' then raise; end if;
  end;
end;
$source_bound_contract$;

update public.user_permission_overrides
   set scope = 'own'
 where user_id = '8d100000-0000-4000-8000-000000000001'
   and company_id = '8d000000-0000-4000-8000-000000000001'
   and permission = 'calendar.view';

insert into public.projects (
  id, company_id, client_id, title, status, opportunity_ref
) values (
  '8d400000-0000-4000-8000-000000000003',
  '8d000000-0000-4000-8000-000000000001',
  '8d200000-0000-4000-8000-000000000001',
  'Hidden-overflow project', 'in_progress',
  '8d300000-0000-4000-8000-000000000001'
);

insert into public.site_visits (
  id, company_id, opportunity_id, client_id, client_ref, project_ref,
  scheduled_at, created_by, assignee_ids
) values (
  '8d600000-0000-4000-8000-000000000003',
  '8d000000-0000-4000-8000-000000000001',
  '8d300000-0000-4000-8000-000000000001',
  '8d200000-0000-4000-8000-000000000001',
  '8d200000-0000-4000-8000-000000000001',
  '8d400000-0000-4000-8000-000000000003',
  pg_catalog.statement_timestamp(),
  '8d100000-0000-4000-8000-000000000099',
  array['8d100000-0000-4000-8000-000000000099']::text[]
);

create temporary table agent_artifact_runtime_hidden_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8d100000-0000-4000-8000-000000000001',
  '8d000000-0000-4000-8000-000000000001',
  array[
    'calendar.view', 'clients.view', 'photos.view', 'pipeline.view',
    'projects.view'
  ]::text[]
) authority;

insert into public.site_visit_artifacts (
  id, site_visit_id, company_id, opportunity_id, kind, source, title, body,
  captured_at, created_by
)
select (
         '8d6f0000-0000-4000-8000-' ||
         pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       '8d600000-0000-4000-8000-000000000003',
       '8d000000-0000-4000-8000-000000000001',
       '8d300000-0000-4000-8000-000000000001',
       'note', 'manual', 'Hidden note ' || series.value::text,
       'Calendar-own must hide this row',
       pg_catalog.date_trunc(
         'milliseconds',
         pg_catalog.statement_timestamp() - series.value * interval '1 second'
       ),
       '8d100000-0000-4000-8000-000000000099'
from pg_catalog.generate_series(1, 500) series(value);

do $hidden_source_explain_contract$
declare
  v_visible_count integer;
  v_plan jsonb;
  v_actual_rows integer;
  v_raw_plan jsonb;
  v_raw_limit_rows integer;
  v_raw_relation_rows integer;
begin
  select pg_catalog.count(*) into strict v_visible_count
  from private.agent_p2_artifact_private_evidence_v1(
    '8d100000-0000-4000-8000-000000000001',
    '8d000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_artifact_runtime_hidden_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view',
      'projects.view'
    ]::text[],
    '{"calendar.view":"own","clients.view":"all","photos.view":"all","pipeline.view":"all","projects.view":"all"}'::jsonb,
    'project',
    '8d400000-0000-4000-8000-000000000003',
    array['site_visit_artifact']::text[],
    501
  );
  if v_visible_count <> 0 then
    raise exception
      'agent_artifact_runtime_failed: hidden source authorization leaked';
  end if;

  execute $explain$
    explain (analyze, buffers, format json)
    select *
    from private.agent_p2_artifact_private_evidence_v1(
      $1, $2, $3, $4, $5, 'project', $6,
      array['site_visit_artifact']::text[], 501
    )
  $explain$
  into strict v_plan
  using
    '8d100000-0000-4000-8000-000000000001'::uuid,
    '8d000000-0000-4000-8000-000000000001'::uuid,
    (select permission_snapshot_revision
     from agent_artifact_runtime_hidden_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view',
      'projects.view'
    ]::text[],
    '{"calendar.view":"own","clients.view":"all","photos.view":"all","pipeline.view":"all","projects.view":"all"}'::jsonb,
    '8d400000-0000-4000-8000-000000000003'::uuid;

  v_actual_rows := (v_plan #>> '{0,Plan,Actual Rows}')::integer;
  if v_actual_rows <> 0
     or v_plan::text not like
       '%agent_p2_artifact_private_evidence_v1%' then
    raise exception
      'agent_artifact_runtime_failed: hidden source explain gate failed';
  end if;

  execute $raw_explain$
    explain (analyze, buffers, format json)
    select artifact.id
    from public.site_visit_artifacts artifact
    join public.site_visits visit
      on visit.id = artifact.site_visit_id
     and private.agent_p2_artifact_uuid_from_text(visit.company_id) = $1
     and visit.deleted_at is null
    where private.agent_p2_artifact_uuid_from_text(artifact.company_id) = $1
      and artifact.deleted_at is null
      and artifact.site_visit_id = $3
      and coalesce(
        visit.project_ref,
        private.agent_p2_artifact_uuid_from_text(visit.project_id)
      ) = $2
    order by coalesce(
               private.agent_p2_artifact_safe_timestamp(artifact.captured_at),
               private.agent_p2_artifact_safe_timestamp(artifact.created_at),
               timestamptz '1970-01-01 00:00:00+00'
             ) desc,
             artifact.id
    limit 501
  $raw_explain$
  into strict v_raw_plan
  using
    '8d000000-0000-4000-8000-000000000001'::uuid,
    '8d400000-0000-4000-8000-000000000003'::uuid,
    '8d600000-0000-4000-8000-000000000003'::uuid;

  with recursive plan_nodes(node) as (
    select v_raw_plan #> '{0,Plan}'
    union all
    select child.value
    from plan_nodes parent
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(parent.node -> 'Plans', '[]'::jsonb)
    ) child(value)
  )
  select pg_catalog.max((node ->> 'Actual Rows')::integer) filter (
           where node ->> 'Node Type' = 'Limit'
         ),
         pg_catalog.max((node ->> 'Actual Rows')::integer) filter (
           where node ->> 'Relation Name' = 'site_visit_artifacts'
         )
    into strict v_raw_limit_rows, v_raw_relation_rows
  from plan_nodes;

  if v_raw_limit_rows is null
     or v_raw_relation_rows is null
     or v_raw_limit_rows <> 500
     or v_raw_relation_rows > 501 then
    raise exception
      'agent_artifact_runtime_failed: raw candidate explain bound failed';
  end if;
end;
$hidden_source_explain_contract$;

insert into public.site_visit_artifacts (
  id, site_visit_id, company_id, opportunity_id, kind, source, title, body,
  captured_at, created_by
) values (
  '8d6f0000-0000-4000-8000-000000000501',
  '8d600000-0000-4000-8000-000000000003',
  '8d000000-0000-4000-8000-000000000001',
  '8d300000-0000-4000-8000-000000000001',
  'note', 'manual', 'Hidden note 501',
  'The raw sentinel must fail before calendar-own authorization',
  pg_catalog.statement_timestamp(),
  '8d100000-0000-4000-8000-000000000099'
);

do $hidden_source_bound_contract$
begin
  begin
    perform 1
    from private.agent_p2_artifact_private_evidence_v1(
      '8d100000-0000-4000-8000-000000000001',
      '8d000000-0000-4000-8000-000000000001',
      (select permission_snapshot_revision
       from agent_artifact_runtime_hidden_authority),
      array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view',
        'projects.view'
      ]::text[],
      '{"calendar.view":"own","clients.view":"all","photos.view":"all","pipeline.view":"all","projects.view":"all"}'::jsonb,
      'project',
      '8d400000-0000-4000-8000-000000000003',
      array['site_visit_artifact']::text[],
      501
    );
    raise exception
      'agent_artifact_runtime_failed: invisible source bound accepted';
  exception
    when sqlstate '54000' then
      if sqlerrm <> 'agent_artifact_source_query_bound' then raise; end if;
  end;
end;
$hidden_source_bound_contract$;

rollback;
