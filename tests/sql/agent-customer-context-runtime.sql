begin;

do $catalog_contract$
declare
  v_private_signature constant text :=
    'private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)';
  v_public_signature constant text :=
    'public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)';
  v_signature text;
  v_role text;
  v_volatility "char";
  v_security_definer boolean;
  v_config text[];
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception
      'agent_customer_context_runtime_failed: runtime_requires_postgresql_17';
  end if;

  foreach v_signature in array array[
    v_private_signature,
    v_public_signature
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_customer_context_runtime_failed: missing %',
        v_signature;
    end if;

    select procedure.provolatile,
           procedure.prosecdef,
           procedure.proconfig
    into strict v_volatility, v_security_definer, v_config
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(v_signature);

    if v_volatility is distinct from 's'
       or pg_catalog.cardinality(v_config) <> 1
       or pg_catalog.replace(
         pg_catalog.regexp_replace(
           v_config[1],
           '[[:space:]]+',
           '',
           'g'
         ),
         '""',
         ''
       ) is distinct from 'search_path='
       or v_signature = v_private_signature and v_security_definer
       or v_signature = v_public_signature and not v_security_definer then
      raise exception
        'agent_customer_context_runtime_failed: unsafe attributes %',
        v_signature;
    end if;
  end loop;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      v_role,
      v_private_signature,
      'EXECUTE'
    ) then
      raise exception
        'agent_customer_context_runtime_failed: private application execute %',
        v_role;
    end if;
  end loop;

  if pg_catalog.has_function_privilege(
       'anon', v_public_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', v_public_signature, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_public_signature, 'EXECUTE'
     ) then
    raise exception
      'agent_customer_context_runtime_failed: public acl mismatch';
  end if;
end;
$catalog_contract$;

set local role authenticated;

do $application_acl$
begin
  if pg_catalog.has_function_privilege(
       current_user,
       'private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       current_user,
       'public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)',
       'EXECUTE'
     ) then
    raise exception
      'agent_customer_context_runtime_failed: authenticated execute';
  end if;
end;
$application_acl$;

reset role;

select pg_catalog.set_config(
  'request.jwt.claim.role',
  'service_role',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

insert into public.companies (
  id,
  name
) values (
  '8a000000-0000-4000-8000-000000000001',
  'Customer context runtime company'
);

insert into public.users (
  id,
  company_id,
  first_name,
  last_name,
  is_active,
  is_company_admin
) values (
  '8a100000-0000-4000-8000-000000000001',
  '8a000000-0000-4000-8000-000000000001',
  'Runtime',
  'Reader',
  true,
  false
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
  '8ac00000-0000-4000-8000-000000000001',
  'Customer context runtime client',
  array['https://runtime.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.customer_contacts.read ops.customers.read ops.jobs.read',
  'manual',
  array[
    'ops.customer_contacts.read',
    'ops.customers.read',
    'ops.jobs.read'
  ]::text[],
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
  '8ab00000-0000-4000-8000-000000000001',
  '8a100000-0000-4000-8000-000000000001',
  '8a000000-0000-4000-8000-000000000001',
  '8ac00000-0000-4000-8000-000000000001',
  array[
    'ops.customer_contacts.read',
    'ops.customers.read',
    'ops.jobs.read'
  ]::text[],
  'dddddddddddddddddddddddddddddddd',
  private.mcp_oauth_labels_for_scopes(
    array[
      'ops.customer_contacts.read',
      'ops.customers.read',
      'ops.jobs.read'
    ]::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

insert into public.user_permission_overrides (
  id,
  user_id,
  company_id,
  permission,
  scope,
  granted
) values
  (
    '8a900000-0000-4000-8000-000000000001',
    '8a100000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    'clients.view',
    'all',
    true
  ),
  (
    '8a900000-0000-4000-8000-000000000002',
    '8a100000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    'pipeline.view',
    'all',
    true
  ),
  (
    '8a900000-0000-4000-8000-000000000003',
    '8a100000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    'projects.view',
    'assigned',
    true
  );

insert into public.clients (
  id,
  company_id,
  name,
  address,
  email,
  phone_number,
  notes
) values
  (
    '8a200000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    'Carly Hunter',
    '12 Cedar Road',
    'duplicate.customer@example.com',
    '+1 (250) 555-0100',
    'Glass on the back deck only.'
  ),
  (
    '8a200000-0000-4000-8000-000000000002',
    '8a000000-0000-4000-8000-000000000001',
    'Hunter Holdings',
    '14 Cedar Road',
    null,
    null,
    null
  ),
  (
    '8a200000-0000-4000-8000-000000000003',
    '8a000000-0000-4000-8000-000000000001',
    'Dismissed Hunter Duplicate',
    null,
    null,
    null,
    null
  );

insert into public.sub_clients (
  id,
  client_id,
  company_id,
  name,
  title,
  email,
  phone_number,
  deleted_at
) values
  (
    '8a300000-0000-4000-8000-000000000001',
    '8a200000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    'Carly duplicate address',
    'Owner',
    'duplicate.customer@example.com',
    '+1 (250) 555-0100',
    null
  ),
  (
    '8a300000-0000-4000-8000-000000000002',
    '8a200000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    'Carly suppressed address',
    'Billing',
    'suppressed.customer@example.com',
    '+1 (250) 555-0101',
    null
  ),
  (
    '8a300000-0000-4000-8000-000000000003',
    '8a200000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    'Carly current contact',
    'Site contact',
    'current.customer@example.com',
    '+1 (250) 555-0102',
    null
  ),
  (
    '8a300000-0000-4000-8000-000000000004',
    '8a200000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    'Deleted contact',
    'Deleted',
    'soft-deleted.customer@example.com',
    '+1 (250) 555-0103',
    pg_catalog.statement_timestamp()
  );

insert into public.email_suppressions (
  id,
  email,
  list,
  reason,
  source
) values (
  '8a800000-0000-4000-8000-000000000001',
  'suppressed.customer@example.com',
  'global',
  'manual',
  'manual'
);

insert into public.duplicate_reviews (
  id,
  company_id,
  entity_type,
  entity_a_id,
  entity_b_id,
  confidence,
  status
) values
  (
    '8a700000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    'client',
    '8a200000-0000-4000-8000-000000000001',
    '8a200000-0000-4000-8000-000000000002',
    'high',
    'pending'
  ),
  (
    '8a700000-0000-4000-8000-000000000002',
    '8a000000-0000-4000-8000-000000000001',
    'client',
    '8a200000-0000-4000-8000-000000000001',
    '8a200000-0000-4000-8000-000000000003',
    'medium',
    'dismissed'
  );

insert into public.opportunities (
  id,
  company_id,
  client_id,
  client_ref,
  title,
  stage,
  updated_at
) values
  (
    '8a400000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    '8a200000-0000-4000-8000-000000000001',
    '8a200000-0000-4000-8000-000000000001',
    'Converted opportunity',
    'won',
    pg_catalog.statement_timestamp()
  ),
  (
    '8a400000-0000-4000-8000-000000000002',
    '8a000000-0000-4000-8000-000000000001',
    '8a200000-0000-4000-8000-000000000001',
    '8a200000-0000-4000-8000-000000000001',
    'Standalone opportunity',
    'quoted',
    pg_catalog.statement_timestamp() - interval '1 minute'
  );

insert into public.projects (
  id,
  company_id,
  client_id,
  opportunity_id,
  opportunity_ref,
  title,
  status,
  updated_at
) values
  (
    '8a500000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    '8a200000-0000-4000-8000-000000000001',
    '8a400000-0000-4000-8000-000000000001',
    '8a400000-0000-4000-8000-000000000001',
    'Assigned converted project',
    'in_progress',
    pg_catalog.statement_timestamp()
  ),
  (
    '8a500000-0000-4000-8000-000000000002',
    '8a000000-0000-4000-8000-000000000001',
    '8a200000-0000-4000-8000-000000000001',
    null,
    null,
    'Unauthorized project',
    'completed',
    pg_catalog.statement_timestamp() - interval '2 minutes'
  );

update public.opportunities
set project_id = '8a500000-0000-4000-8000-000000000001',
    project_ref = '8a500000-0000-4000-8000-000000000001'
where id = '8a400000-0000-4000-8000-000000000001';

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  team_member_ids
) values (
  '8a600000-0000-4000-8000-000000000001',
  '8a000000-0000-4000-8000-000000000001',
  '8a500000-0000-4000-8000-000000000001',
  array['8a100000-0000-4000-8000-000000000001']::text[]
);

create temporary table agent_customer_context_runtime_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8a100000-0000-4000-8000-000000000001',
  '8a000000-0000-4000-8000-000000000001',
  array['clients.view', 'pipeline.view', 'projects.view']::text[]
) authority;

do $authority_fixture_contract$
begin
  if (
    select pg_catalog.count(*)
    from agent_customer_context_runtime_authority
    where permission_snapshot_revision ~ '^sha256:[0-9a-f]{64}$'
  ) <> 1 then
    raise exception
      'agent_customer_context_runtime_failed: authority fixture invalid';
  end if;
end;
$authority_fixture_contract$;

create temporary table agent_customer_context_runtime_result
on commit drop as
select public.read_agent_customer_context_as_system(
  'customer-context-runtime-happy',
  '8a100000-0000-4000-8000-000000000001',
  '8a000000-0000-4000-8000-000000000001',
  '8ab00000-0000-4000-8000-000000000001',
  '8ac00000-0000-4000-8000-000000000001',
  'dddddddddddddddddddddddddddddddd',
  array[
    'ops.customer_contacts.read',
    'ops.customers.read',
    'ops.jobs.read'
  ]::text[],
  (
    select permission_snapshot_revision
    from agent_customer_context_runtime_authority
  ),
  array['clients.view', 'pipeline.view', 'projects.view']::text[],
  'get_customer_context',
  'get_customer_context:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array[
    'ops.customer_contacts.read',
    'ops.customers.read',
    'ops.jobs.read'
  ]::text[],
  'all',
  'all',
  'assigned',
  'client',
  '8a200000-0000-4000-8000-000000000001',
  array[
    'business_address',
    'business_notes',
    'contacts',
    'duplicate_state',
    'job_rollup',
    'preferences',
    'profile'
  ]::text[],
  'communication',
  array['opportunity', 'project']::text[],
  501,
  25
) as payload;

do $projection_contract$
declare
  v_result jsonb;
  v_contact_emails jsonb;
  v_email_state_count integer;
begin
  select payload
  into strict v_result
  from agent_customer_context_runtime_result;

  if v_result #>> '{company_id}' is distinct from
       '8a000000-0000-4000-8000-000000000001'
     or v_result #>> '{actor_user_id}' is distinct from
       '8a100000-0000-4000-8000-000000000001'
     or v_result #>> '{oauth_grant_id}' is distinct from
       '8ab00000-0000-4000-8000-000000000001'
     or v_result #>> '{oauth_client_id}' is distinct from
       '8ac00000-0000-4000-8000-000000000001'
     or v_result #>> '{grant_revision}' is distinct from
       'dddddddddddddddddddddddddddddddd'
     or v_result #>> '{capability_id}' is distinct from
       'get_customer_context'
     or v_result #>> '{result,customer,requested_ref,kind}' is distinct from
       'client'
     or v_result #>> '{result,customer,canonical_ref,id}' is distinct from
       '8a200000-0000-4000-8000-000000000001'
     or v_result #>> '{result,customer,relationship}' is distinct from
       'primary_client' then
    raise exception
      'agent_customer_context_runtime_failed: customer identity mismatch';
  end if;

  if v_result -> 'selected_sections' is distinct from pg_catalog.to_jsonb(
       array[
         'business_address',
         'business_notes',
         'contacts',
         'duplicate_state',
         'job_rollup',
         'preferences',
         'profile'
       ]::text[]
     )
     or v_result -> 'required_oauth_scopes' is distinct from
       pg_catalog.to_jsonb(array[
         'ops.customer_contacts.read',
         'ops.customers.read',
         'ops.jobs.read'
       ]::text[])
     or v_result #>> '{contact_purpose}' is distinct from 'communication'
     or v_result -> 'job_kinds' is distinct from
       pg_catalog.to_jsonb(array['opportunity', 'project']::text[]) then
    raise exception
      'agent_customer_context_runtime_failed: selection ordering mismatch';
  end if;

  if v_result #>> '{result,sections,profile,display_name}' is distinct from
       'Carly Hunter'
     or v_result #>>
       '{result,sections,business_address,address}' is distinct from
       '12 Cedar Road'
     or v_result #>>
       '{result,sections,profile,content_kind}' is distinct from
       'untrusted_business_data'
     or v_result #>>
       '{result,sections,business_notes,notes}' is distinct from
       'Glass on the back deck only.'
     or v_result #>>
       '{result,sections,business_notes,truncated}' is distinct from 'false'
     or v_result #>>
       '{result,sections,business_notes,content_kind}' is distinct from
       'untrusted_business_data' then
    raise exception
      'agent_customer_context_runtime_failed: private summary mismatch';
  end if;

  if (v_result #>>
       '{result,sections,contacts,source_count}')::integer is distinct from 4
     or (v_result #>>
       '{result,sections,contacts,source_has_more}')::boolean
       is distinct from false
     or (v_result #>>
       '{result,sections,contacts,returned_count}')::integer is distinct from 4
     or (v_result #>>
       '{result,sections,contacts,result_budget_omitted_count}')::integer
       is distinct from 0
     or pg_catalog.jsonb_array_length(
       v_result #> '{result,sections,contacts,contacts}'
     ) is distinct from 4
     or v_result #>>
       '{result,sections,contacts,contacts,0,relationship}' is distinct from
       'primary_client'
     or v_result #>>
       '{result,sections,contacts,contacts,1,contact_ref,id}' is distinct from
       '8a300000-0000-4000-8000-000000000001'
     or v_result #>>
       '{result,sections,contacts,contacts,2,contact_ref,id}' is distinct from
       '8a300000-0000-4000-8000-000000000002'
     or v_result #>>
       '{result,sections,contacts,contacts,3,contact_ref,id}' is distinct from
       '8a300000-0000-4000-8000-000000000003' then
    raise exception
      'agent_customer_context_runtime_failed: contact ordering mismatch';
  end if;

  v_contact_emails := v_result #>
    '{result,sections,contacts,contacts}';
  select pg_catalog.count(*)::integer
  into v_email_state_count
  from pg_catalog.jsonb_array_elements(v_contact_emails) contact(value)
  where contact.value #>> '{email,state}' = 'ambiguous';
  if v_email_state_count is distinct from 2 then
    raise exception
      'agent_customer_context_runtime_failed: duplicate address leaked';
  end if;
  select pg_catalog.count(*)::integer
  into v_email_state_count
  from pg_catalog.jsonb_array_elements(v_contact_emails) contact(value)
  where contact.value #>> '{email,state}' = 'blocked';
  if v_email_state_count is distinct from 1 then
    raise exception
      'agent_customer_context_runtime_failed: suppressed address leaked';
  end if;
  select pg_catalog.count(*)::integer
  into v_email_state_count
  from pg_catalog.jsonb_array_elements(v_contact_emails) contact(value)
  where contact.value #>> '{email,state}' = 'contactable';
  if v_email_state_count is distinct from 1 then
    raise exception
      'agent_customer_context_runtime_failed: contactability state mismatch';
  end if;
  if v_result::text like '%duplicate.customer@example.com%'
     or v_result::text like '%suppressed.customer@example.com%' then
    raise exception
      'agent_customer_context_runtime_failed: duplicate address leaked';
  end if;
  if v_result::text like '%soft-deleted.customer@example.com%'
     or v_result::text like '%8a300000-0000-4000-8000-000000000004%' then
    raise exception
      'agent_customer_context_runtime_failed: soft-deleted contact leaked';
  end if;

  if v_result #>>
       '{result,sections,duplicate_state,state}' is distinct from
       'review_required'
     or (v_result #>>
       '{result,sections,duplicate_state,source_count}')::integer
       is distinct from 1
     or (v_result #>>
       '{result,sections,duplicate_state,source_has_more}')::boolean
       is distinct from false
     or pg_catalog.jsonb_array_length(
       v_result #> '{result,sections,duplicate_state,candidates}'
     ) is distinct from 1
     or v_result #>>
       '{result,sections,duplicate_state,candidates,0,customer_ref,id}'
       is distinct from '8a200000-0000-4000-8000-000000000002'
     or v_result::text like '%8a200000-0000-4000-8000-000000000003%' then
    raise exception
      'agent_customer_context_runtime_failed: duplicate state mismatch';
  end if;

  if v_result #>>
       '{result,sections,job_rollup,kinds,0,kind}' is distinct from
       'opportunity'
     or (v_result #>>
       '{result,sections,job_rollup,kinds,0,total_count}')::integer
       is distinct from 1
     or v_result #>>
       '{result,sections,job_rollup,kinds,0,status_counts,0,status}'
       is distinct from 'quoted'
     or v_result #>>
       '{result,sections,job_rollup,kinds,1,kind}' is distinct from 'project'
     or (v_result #>>
       '{result,sections,job_rollup,kinds,1,total_count}')::integer
       is distinct from 1
     or v_result #>>
       '{result,sections,job_rollup,kinds,1,status_counts,0,status}'
       is distinct from 'in_progress'
     or (v_result #>> '{source_inspected,projects}')::integer
       is distinct from 1
     or v_result::text like '%Unauthorized project%'
     or v_result::text like '%8a500000-0000-4000-8000-000000000002%' then
    raise exception
      'agent_customer_context_runtime_failed: unauthorized job count leaked';
  end if;

  if pg_catalog.jsonb_array_length(v_result -> 'source_revisions')
       is distinct from 3
     or v_result #>> '{source_revisions,0,domain}' is distinct from 'customer'
     or v_result #>> '{source_revisions,1,source_type}' is distinct from
       'operational_read_revision'
     or v_result #>> '{source_revisions,2,source_type}' is distinct from
       'contactability_revision'
     or v_result #>> '{proof_ref}' !~ '^ops_proof:v1:[0-9a-f]{64}$'
     or v_result #>> '{proof_ref}' is distinct from
       'ops_proof:v1:' || pg_catalog.encode(
         extensions.digest(
           pg_catalog.convert_to(
             private.canonical_agent_projection_json(
               v_result - 'proof_ref'
             ),
             'UTF8'
           ),
           'sha256'
         ),
         'hex'
       )
     or v_result #>> '{read_at}' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
     or v_result::text like '%"signals"%'
     or v_result::text like '%"winner_id"%'
     or v_result::text like '%"resolved_by"%'
     or v_result::text like '%"suppression_reason"%' then
    raise exception
      'agent_customer_context_runtime_failed: proof or privacy mismatch';
  end if;
end;
$projection_contract$;

select pg_catalog.set_config('enable_seqscan', 'off', true);

do $plan_contract$
declare
  v_plan json;
begin
  execute $plan$
    explain (analyze, buffers, format json)
    select sub_client.id
    from public.sub_clients sub_client
    where sub_client.company_id =
            '8a000000-0000-4000-8000-000000000001'::uuid
      and sub_client.client_id =
            '8a200000-0000-4000-8000-000000000001'::uuid
      and sub_client.deleted_at is null
    order by sub_client.id
    limit 501
  $plan$ into v_plan;
  if v_plan::text not like '%sub_clients_agent_current_client_id_idx%'
     or v_plan::text not like '%"Node Type": "Limit"%' then
    raise exception
      'agent_customer_context_runtime_failed: contact source plan mismatch';
  end if;

  execute $plan$
    explain (analyze, buffers, format json)
    select selector.id
    from (
      select sub_client.id
      from public.sub_clients sub_client
      where sub_client.company_id =
              '8a000000-0000-4000-8000-000000000001'::uuid
        and sub_client.client_id =
              '8a200000-0000-4000-8000-000000000001'::uuid
        and sub_client.deleted_at is null
      order by sub_client.id
      limit 26
    ) selector
    order by selector.id
    limit 25
  $plan$ into v_plan;
  if v_plan::text not like '%sub_clients_agent_current_client_id_idx%'
     or v_plan::text not like '%"Node Type": "Limit"%' then
    raise exception
      'agent_customer_context_runtime_failed: contact selector plan mismatch';
  end if;

  execute $plan$
    explain (analyze, buffers, format json)
    select opportunity.id
    from public.opportunities opportunity
    where opportunity.company_id =
            '8a000000-0000-4000-8000-000000000001'::uuid
      and opportunity.deleted_at is null
      and opportunity.merged_into_opportunity_id is null
      and pg_catalog.coalesce(
        opportunity.client_ref,
        opportunity.client_id
      ) = '8a200000-0000-4000-8000-000000000001'::uuid
    order by opportunity.updated_at desc, opportunity.id desc
    limit 501
  $plan$ into v_plan;
  if v_plan::text not like
       '%opportunities_agent_customer_jobs_updated_keyset_idx%'
     or v_plan::text not like '%"Node Type": "Limit"%' then
    raise exception
      'agent_customer_context_runtime_failed: opportunity source plan mismatch';
  end if;

  execute $plan$
    explain (analyze, buffers, format json)
    select project.id
    from public.projects project
    where project.company_id =
            '8a000000-0000-4000-8000-000000000001'::uuid
      and project.client_id =
            '8a200000-0000-4000-8000-000000000001'::uuid
      and project.deleted_at is null
    order by project.updated_at desc, project.id desc
    limit 501
  $plan$ into v_plan;
  if v_plan::text not like
       '%projects_agent_customer_jobs_updated_keyset_idx%'
     or v_plan::text not like '%"Node Type": "Limit"%' then
    raise exception
      'agent_customer_context_runtime_failed: project source plan mismatch';
  end if;

  execute $plan$
    explain (analyze, buffers, format json)
    select review.id
    from public.duplicate_reviews review
    where review.company_id =
            '8a000000-0000-4000-8000-000000000001'::uuid
      and review.entity_type = 'client'
      and review.status = 'pending'
      and '8a200000-0000-4000-8000-000000000001'::uuid in (
        review.entity_a_id,
        review.entity_b_id
      )
    order by review.id
    limit 501
  $plan$ into v_plan;
  if v_plan::text not like '%idx_duplicate_reviews_pending%'
     or v_plan::text not like '%"Node Type": "Limit"%' then
    raise exception
      'agent_customer_context_runtime_failed: duplicate source plan mismatch';
  end if;

  execute $plan$
    explain (analyze, buffers, format json)
    select selector.id
    from (
      select review.id
      from public.duplicate_reviews review
      where review.company_id =
              '8a000000-0000-4000-8000-000000000001'::uuid
        and review.entity_type = 'client'
        and review.status = 'pending'
        and '8a200000-0000-4000-8000-000000000001'::uuid in (
          review.entity_a_id,
          review.entity_b_id
        )
      order by review.id
      limit 26
    ) selector
    order by selector.id
    limit 25
  $plan$ into v_plan;
  if v_plan::text not like '%idx_duplicate_reviews_pending%'
     or v_plan::text not like '%"Node Type": "Limit"%' then
    raise exception
      'agent_customer_context_runtime_failed: duplicate selector plan mismatch';
  end if;
end;
$plan_contract$;

do $stale_authority_contract$
declare
  v_revision text;
  v_current_revision text;
begin
  select permission_snapshot_revision
  into strict v_revision
  from agent_customer_context_runtime_authority;

  update public.user_permission_overrides
  set scope = 'all'
  where id = '8a900000-0000-4000-8000-000000000003';

  begin
    perform public.read_agent_customer_context_as_system(
      'customer-context-runtime-stale-authority',
      '8a100000-0000-4000-8000-000000000001',
      '8a000000-0000-4000-8000-000000000001',
      '8ab00000-0000-4000-8000-000000000001',
      '8ac00000-0000-4000-8000-000000000001',
      'dddddddddddddddddddddddddddddddd',
      array[
        'ops.customer_contacts.read',
        'ops.customers.read',
        'ops.jobs.read'
      ]::text[],
      v_revision,
      array['clients.view', 'pipeline.view', 'projects.view']::text[],
      'get_customer_context',
      'get_customer_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.customers.read']::text[],
      'all',
      null,
      null,
      'client',
      '8a200000-0000-4000-8000-000000000001',
      array['profile']::text[],
      null,
      array[]::text[],
      501,
      25
    );
    raise exception
      'agent_customer_context_runtime_failed: stale authority allowed';
  exception when sqlstate 'P0002' then
    if sqlerrm is distinct from
       'agent_customer_context_not_found_or_not_visible' then
      raise;
    end if;
  end;

  update public.user_permission_overrides
  set scope = 'assigned'
  where id = '8a900000-0000-4000-8000-000000000003';

  select authority.permission_snapshot_revision
  into strict v_current_revision
  from private.resolve_agent_actor_authority(
    '8a100000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    array['clients.view', 'pipeline.view', 'projects.view']::text[]
  ) authority;
  if v_current_revision is distinct from v_revision then
    raise exception
      'agent_customer_context_runtime_failed: authority restore mismatch';
  end if;
end;
$stale_authority_contract$;

do $oauth_grant_contract$
declare
  v_revision text;
begin
  select permission_snapshot_revision
  into strict v_revision
  from agent_customer_context_runtime_authority;

  begin
    perform public.read_agent_customer_context_as_system(
      'customer-context-runtime-stale-oauth-grant',
      '8a100000-0000-4000-8000-000000000001',
      '8a000000-0000-4000-8000-000000000001',
      '8ab00000-0000-4000-8000-000000000001',
      '8ac00000-0000-4000-8000-000000000001',
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      array[
        'ops.customer_contacts.read',
        'ops.customers.read',
        'ops.jobs.read'
      ]::text[],
      v_revision,
      array['clients.view', 'pipeline.view', 'projects.view']::text[],
      'get_customer_context',
      'get_customer_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.customers.read']::text[],
      'all',
      null,
      null,
      'client',
      '8a200000-0000-4000-8000-000000000001',
      array['profile']::text[],
      null,
      array[]::text[],
      501,
      25
    );
    raise exception
      'agent_customer_context_runtime_failed: stale oauth grant allowed';
  exception when sqlstate 'P0002' then
    if sqlerrm is distinct from
       'agent_customer_context_not_found_or_not_visible' then
      raise;
    end if;
  end;

  update private.mcp_oauth_grants
  set revoked_at = pg_catalog.statement_timestamp()
  where id = '8ab00000-0000-4000-8000-000000000001';
  begin
    perform public.read_agent_customer_context_as_system(
      'customer-context-runtime-revoked-oauth-grant',
      '8a100000-0000-4000-8000-000000000001',
      '8a000000-0000-4000-8000-000000000001',
      '8ab00000-0000-4000-8000-000000000001',
      '8ac00000-0000-4000-8000-000000000001',
      'dddddddddddddddddddddddddddddddd',
      array[
        'ops.customer_contacts.read',
        'ops.customers.read',
        'ops.jobs.read'
      ]::text[],
      v_revision,
      array['clients.view', 'pipeline.view', 'projects.view']::text[],
      'get_customer_context',
      'get_customer_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.customers.read']::text[],
      'all',
      null,
      null,
      'client',
      '8a200000-0000-4000-8000-000000000001',
      array['profile']::text[],
      null,
      array[]::text[],
      501,
      25
    );
    raise exception
      'agent_customer_context_runtime_failed: revoked oauth grant allowed';
  exception when sqlstate 'P0002' then
    if sqlerrm is distinct from
       'agent_customer_context_not_found_or_not_visible' then
      raise;
    end if;
  end;
  update private.mcp_oauth_grants
  set revoked_at = null
  where id = '8ab00000-0000-4000-8000-000000000001';
end;
$oauth_grant_contract$;

do $request_contract$
declare
  v_revision text;
  v_profile jsonb;
begin
  select permission_snapshot_revision
  into strict v_revision
  from agent_customer_context_runtime_authority;

  v_profile := public.read_agent_customer_context_as_system(
    'customer-context-runtime-profile-only',
    '8a100000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    '8ab00000-0000-4000-8000-000000000001',
    '8ac00000-0000-4000-8000-000000000001',
    'dddddddddddddddddddddddddddddddd',
    array[
      'ops.customer_contacts.read',
      'ops.customers.read',
      'ops.jobs.read'
    ]::text[],
    v_revision,
    array['clients.view', 'pipeline.view', 'projects.view']::text[],
    'get_customer_context',
    'get_customer_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.customers.read']::text[],
    'all',
    null,
    null,
    'client',
    '8a200000-0000-4000-8000-000000000001',
    array['profile']::text[],
    null,
    array[]::text[],
    501,
    25
  );
  if (v_profile #> '{result,sections}') ? 'business_address'
     or v_profile::text like '%12 Cedar Road%'
     or (v_profile #> '{result,sections,profile}') ? 'address' then
    raise exception
      'agent_customer_context_runtime_failed: implicit business address leaked';
  end if;

  begin
    perform public.read_agent_customer_context_as_system(
      'customer-context-runtime-invalid-consent',
      '8a100000-0000-4000-8000-000000000001',
      '8a000000-0000-4000-8000-000000000001',
      '8ab00000-0000-4000-8000-000000000001',
      '8ac00000-0000-4000-8000-000000000001',
      'dddddddddddddddddddddddddddddddd',
      array[
        'ops.customer_contacts.read',
        'ops.customers.read',
        'ops.jobs.read'
      ]::text[],
      v_revision,
      array['clients.view', 'pipeline.view', 'projects.view']::text[],
      'get_customer_context',
      'get_customer_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.customers.read']::text[],
      'all',
      null,
      null,
      'client',
      '8a200000-0000-4000-8000-000000000001',
      array['contacts']::text[],
      null,
      array[]::text[],
      501,
      25
    );
    raise exception
      'agent_customer_context_runtime_failed: invalid contact consent allowed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from 'invalid_agent_customer_context_request' then
      raise;
    end if;
  end;

  begin
    perform public.read_agent_customer_context_as_system(
      'customer-context-runtime-not-found',
      '8a100000-0000-4000-8000-000000000001',
      '8a000000-0000-4000-8000-000000000001',
      '8ab00000-0000-4000-8000-000000000001',
      '8ac00000-0000-4000-8000-000000000001',
      'dddddddddddddddddddddddddddddddd',
      array[
        'ops.customer_contacts.read',
        'ops.customers.read',
        'ops.jobs.read'
      ]::text[],
      v_revision,
      array['clients.view', 'pipeline.view', 'projects.view']::text[],
      'get_customer_context',
      'get_customer_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.customers.read']::text[],
      'all',
      null,
      null,
      'client',
      '8affffff-ffff-4fff-8fff-ffffffffffff',
      array['profile']::text[],
      null,
      array[]::text[],
      501,
      25
    );
    raise exception
      'agent_customer_context_runtime_failed: invisible customer disclosed';
  exception when sqlstate 'P0002' then
    if sqlerrm is distinct from
       'agent_customer_context_not_found_or_not_visible' then
      raise;
    end if;
  end;
end;
$request_contract$;

create temporary table agent_customer_context_runtime_revision
on commit drop as
select revision.source_revision as revision_before
from private.agent_read_domain_revisions revision
where revision.company_id = '8a000000-0000-4000-8000-000000000001'
  and revision.domain = 'customer';

update public.clients
set notes = 'Glass on the back deck only. Customer revision proof.'
where id = '8a200000-0000-4000-8000-000000000001';

do $revision_contract$
begin
  if (
    select revision.source_revision
    from private.agent_read_domain_revisions revision
    where revision.company_id =
            '8a000000-0000-4000-8000-000000000001'
      and revision.domain = 'customer'
  ) <= (
    select revision_before
    from agent_customer_context_runtime_revision
  ) then
    raise exception
      'agent_customer_context_runtime_failed: customer revision did not advance';
  end if;
end;
$revision_contract$;

insert into public.sub_clients (
  id,
  client_id,
  company_id,
  name
)
select (
         '8ad00000-0000-4000-8000-' ||
         pg_catalog.lpad(source.ordinality::text, 12, '0')
       )::uuid,
       '8a200000-0000-4000-8000-000000000001'::uuid,
       '8a000000-0000-4000-8000-000000000001'::uuid,
       'Selector contact ' || source.ordinality::text
from pg_catalog.generate_series(1, 22) source(ordinality);

insert into public.clients (
  id,
  company_id,
  name
)
select (
         '8ae00000-0000-4000-8000-' ||
         pg_catalog.lpad(source.ordinality::text, 12, '0')
       )::uuid,
       '8a000000-0000-4000-8000-000000000001'::uuid,
       'Selector duplicate ' || source.ordinality::text
from pg_catalog.generate_series(1, 25) source(ordinality);

insert into public.duplicate_reviews (
  id,
  company_id,
  entity_type,
  entity_a_id,
  entity_b_id,
  confidence,
  status
)
select (
         '8af00000-0000-4000-8000-' ||
         pg_catalog.lpad(source.ordinality::text, 12, '0')
       )::uuid,
       '8a000000-0000-4000-8000-000000000001'::uuid,
       'client',
       '8a200000-0000-4000-8000-000000000001'::uuid,
       (
         '8ae00000-0000-4000-8000-' ||
         pg_catalog.lpad(source.ordinality::text, 12, '0')
       )::uuid,
       'high',
       'pending'
from pg_catalog.generate_series(1, 25) source(ordinality);

do $selector_bound_contract$
declare
  v_revision text;
  v_contacts jsonb;
  v_duplicates jsonb;
begin
  select authority.permission_snapshot_revision
  into strict v_revision
  from private.resolve_agent_actor_authority(
    '8a100000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    array['clients.view', 'pipeline.view', 'projects.view']::text[]
  ) authority;

  v_contacts := public.read_agent_customer_context_as_system(
    'customer-context-runtime-contact-selector',
    '8a100000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    '8ab00000-0000-4000-8000-000000000001',
    '8ac00000-0000-4000-8000-000000000001',
    'dddddddddddddddddddddddddddddddd',
    array[
      'ops.customer_contacts.read',
      'ops.customers.read',
      'ops.jobs.read'
    ]::text[],
    v_revision,
    array['clients.view', 'pipeline.view', 'projects.view']::text[],
    'get_customer_context',
    'get_customer_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array[
      'ops.customer_contacts.read',
      'ops.customers.read'
    ]::text[],
    'all',
    null,
    null,
    'client',
    '8a200000-0000-4000-8000-000000000001',
    array['contacts']::text[],
    'communication',
    array[]::text[],
    501,
    25
  );
  if (v_contacts #>>
       '{result,sections,contacts,source_count}')::integer is distinct from 25
     or (v_contacts #>>
       '{result,sections,contacts,returned_count}')::integer
       is distinct from 25
     or (v_contacts #>>
       '{result,sections,contacts,source_has_more}')::boolean
       is distinct from true
     or (v_contacts #>> '{source_inspected,contacts}')::integer
       is distinct from 26
     or pg_catalog.jsonb_array_length(
       v_contacts #> '{result,sections,contacts,contacts}'
     ) is distinct from 25 then
    raise exception
      'agent_customer_context_runtime_failed: contact selector did not retain 25';
  end if;

  v_duplicates := public.read_agent_customer_context_as_system(
    'customer-context-runtime-duplicate-selector',
    '8a100000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    '8ab00000-0000-4000-8000-000000000001',
    '8ac00000-0000-4000-8000-000000000001',
    'dddddddddddddddddddddddddddddddd',
    array[
      'ops.customer_contacts.read',
      'ops.customers.read',
      'ops.jobs.read'
    ]::text[],
    v_revision,
    array['clients.view', 'pipeline.view', 'projects.view']::text[],
    'get_customer_context',
    'get_customer_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.customers.read']::text[],
    'all',
    null,
    null,
    'client',
    '8a200000-0000-4000-8000-000000000001',
    array['duplicate_state']::text[],
    null,
    array[]::text[],
    501,
    25
  );
  if (v_duplicates #>>
       '{result,sections,duplicate_state,source_count}')::integer
       is distinct from 25
     or (v_duplicates #>>
       '{result,sections,duplicate_state,returned_count}')::integer
       is distinct from 25
     or (v_duplicates #>>
       '{result,sections,duplicate_state,source_has_more}')::boolean
       is distinct from true
     or (v_duplicates #>> '{source_inspected,duplicate_candidates}')::integer
       is distinct from 26
     or pg_catalog.jsonb_array_length(
       v_duplicates #> '{result,sections,duplicate_state,candidates}'
     ) is distinct from 25 then
    raise exception
      'agent_customer_context_runtime_failed: duplicate selector did not retain 25';
  end if;
end;
$selector_bound_contract$;

insert into public.sub_clients (
  id,
  client_id,
  company_id,
  name
)
select pg_catalog.md5(
         'agent-customer-context-bound-' || source.ordinality::text
       )::uuid,
       '8a200000-0000-4000-8000-000000000001'::uuid,
       '8a000000-0000-4000-8000-000000000001'::uuid,
       'Bound contact ' || source.ordinality::text
from pg_catalog.generate_series(1, 501) source(ordinality);

do $source_bound_contract$
declare
  v_revision text;
begin
  select authority.permission_snapshot_revision
  into strict v_revision
  from private.resolve_agent_actor_authority(
    '8a100000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    array['clients.view', 'pipeline.view', 'projects.view']::text[]
  ) authority;

  begin
    perform public.read_agent_customer_context_as_system(
      'customer-context-runtime-source-bound',
      '8a100000-0000-4000-8000-000000000001',
      '8a000000-0000-4000-8000-000000000001',
      '8ab00000-0000-4000-8000-000000000001',
      '8ac00000-0000-4000-8000-000000000001',
      'dddddddddddddddddddddddddddddddd',
      array[
        'ops.customer_contacts.read',
        'ops.customers.read',
        'ops.jobs.read'
      ]::text[],
      v_revision,
      array['clients.view', 'pipeline.view', 'projects.view']::text[],
      'get_customer_context',
      'get_customer_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array[
        'ops.customer_contacts.read',
        'ops.customers.read'
      ]::text[],
      'all',
      null,
      null,
      'client',
      '8a200000-0000-4000-8000-000000000001',
      array['contacts']::text[],
      'communication',
      array[]::text[],
      501,
      25
    );
    raise exception
      'agent_customer_context_runtime_failed: source bound not enforced';
  exception when sqlstate '54000' then
    if sqlerrm is distinct from
       'agent_customer_context_source_query_bound' then
      raise;
    end if;
  end;
end;
$source_bound_contract$;

rollback;
