begin;

do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('function', 'private.resolve_agent_actor_authority(uuid,uuid,text[])'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'extensions.digest(bytea,text)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.companies'),
      ('table', 'public.company_inventory_settings'),
      ('table', 'public.company_settings')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_company_context_read_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

drop function if exists public.read_agent_company_context_as_system(
  text, uuid, uuid, uuid, uuid, text, text[], text, text[], text, text,
  text, text[], text
);
drop function if exists private.agent_p2_company_summary_v1(
  uuid, uuid, uuid, uuid, text, text[], text[], text, text[], text,
  timestamp with time zone
);

create or replace function private.agent_p2_company_summary_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_required_oauth_scopes text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_settings_company_scope text,
  p_read_at timestamp with time zone
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_source record;
  v_name text;
  v_description text;
  v_industries text[];
  v_industry_invalid boolean;
  v_locale text;
  v_timezone text;
  v_currency_code text;
  v_inventory_mode text;
  v_logo_url text;
  v_website_url text;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_granted_scope_ceiling is null
     or pg_catalog.cardinality(p_granted_scope_ceiling) not between 1 and 32
     or p_required_oauth_scopes is distinct from
       array['ops.company.read']::text[]
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_settings_company_scope is distinct from 'all'
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds',
       p_read_at
     )
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds',
       pg_catalog.statement_timestamp()
     ) then
    raise exception 'invalid_agent_company_summary_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_granted_scope_ceiling) granted(scope)
    where granted.scope is null
       or granted.scope is distinct from pg_catalog.btrim(granted.scope)
       or pg_catalog.octet_length(granted.scope) not between 1 and 128
  ) or p_granted_scope_ceiling is distinct from (
    select pg_catalog.array_agg(
      granted.scope order by granted.scope collate "C"
    )
    from (
      select distinct source.scope
      from pg_catalog.unnest(p_granted_scope_ceiling) source(scope)
    ) granted
  ) or p_required_oauth_scopes <@ p_granted_scope_ceiling is not true then
    raise exception 'invalid_agent_company_summary_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_registered_permission_keys)
      registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from
         pg_catalog.btrim(registry.permission_key)
       or pg_catalog.octet_length(registry.permission_key) not between 1 and 128
  ) or (
    select pg_catalog.count(distinct registry.permission_key)
    from pg_catalog.unnest(p_registered_permission_keys)
      registry(permission_key)
  ) <> pg_catalog.cardinality(p_registered_permission_keys)
  or p_registered_permission_keys is distinct from coalesce((
    select pg_catalog.array_agg(
      registry.permission_key order by registry.permission_key
    )
    from pg_catalog.unnest(p_registered_permission_keys)
      registry(permission_key)
  ), array[]::text[])
  or not ('settings.company' = any(p_registered_permission_keys)) then
    raise exception 'invalid_agent_company_summary_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'settings.company'
           ) as settings_company_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral pg_catalog.jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  )
  select company.name,
         company.description,
         company.industries,
         company.industry,
         company.locale,
         company.timezone,
         company.currency_code,
         company.default_work_start,
         company.default_work_end,
         company.skip_weekends_in_auto_schedule,
         company.precise_scheduling_enabled,
         company.logo_url,
         company.website,
         inventory.inventory_mode,
         settings.catalog_setup_completed_at,
         company_revision.source_revision,
         case when inventory.company_id is null then 0 else 1 end
           as inventory_settings_count,
         case when settings.company_id is null then 0 else 1 end
           as company_settings_count
    into v_source
  from current_authority authority
  join public.companies company
    on company.id = p_company_id
   and company.deleted_at is null
  join private.mcp_oauth_grants oauth_grant
    on oauth_grant.id = p_oauth_grant_id
   and oauth_grant.user_id = p_actor_user_id
   and oauth_grant.company_id = p_company_id
   and oauth_grant.client_id = p_oauth_client_id
   and oauth_grant.revision = p_grant_revision
   and oauth_grant.scopes = p_granted_scope_ceiling
   and oauth_grant.revoked_at is null
   and p_required_oauth_scopes <@ oauth_grant.scopes
   and oauth_grant.accepted_labels =
     private.mcp_oauth_labels_for_scopes(
       oauth_grant.scopes,
       oauth_grant.consent_catalog_revision
     )
  join private.mcp_oauth_clients oauth_client
    on oauth_client.client_id = oauth_grant.client_id
   and oauth_client.disabled_at is null
   and oauth_grant.scopes <@ oauth_client.scope_ceiling
   and oauth_grant.consent_catalog_revision =
     oauth_client.consent_catalog_revision
   and oauth_grant.exposure_revision = oauth_client.exposure_revision
  join private.agent_read_domain_revisions company_revision
    on company_revision.company_id = p_company_id
   and company_revision.domain = 'company'
   and company_revision.source_revision between 0 and 9007199254740991
  left join public.company_inventory_settings inventory
    on inventory.company_id = p_company_id
  left join public.company_settings settings
    on settings.company_id = p_company_id::text
  where authority.permission_snapshot_revision =
          p_permission_snapshot_revision
    and authority.settings_company_scope = p_settings_company_scope;

  if not found then
    return null;
  end if;

  v_name := private.agent_p2_optional_canonical_text(
    v_source.name,
    256,
    1024,
    false
  );
  v_description := case when v_source.description is null then null
    else private.agent_p2_optional_canonical_text(
      v_source.description,
      2000,
      8000,
      true
    ) end;
  if pg_catalog.cardinality(
       coalesce(v_source.industries, array[]::text[])
     ) > 16 then
    raise exception 'agent_company_context_source_invalid'
      using errcode = '22000';
  end if;
  select coalesce(
           pg_catalog.array_agg(
             distinct projected.value collate "C"
             order by projected.value collate "C"
           ),
           array[]::text[]
         ),
         coalesce(pg_catalog.bool_or(projected.value is null), false)
    into v_industries, v_industry_invalid
  from (
    select private.agent_p2_optional_canonical_text(
             source.value,
             64,
             256,
             false
           ) as value
    from pg_catalog.unnest(case
      when pg_catalog.cardinality(
        coalesce(v_source.industries, array[]::text[])
      ) > 0 then v_source.industries
      else array[v_source.industry]::text[]
    end) source(value)
  ) projected;
  v_locale := private.agent_p2_optional_canonical_text(
    v_source.locale,
    35,
    140,
    false
  );
  v_timezone := private.agent_p2_optional_canonical_text(
    v_source.timezone,
    64,
    256,
    false
  );
  v_currency_code := pg_catalog.btrim(v_source.currency_code);
  v_inventory_mode := coalesce(v_source.inventory_mode, 'off');
  v_logo_url := case when v_source.logo_url is null then null
    else private.agent_p2_optional_canonical_text(
      v_source.logo_url,
      2048,
      8192,
      false
    ) end;
  v_website_url := case when v_source.website is null then null
    else private.agent_p2_optional_canonical_text(
      v_source.website,
      2048,
      8192,
      false
    ) end;

  if v_name is null
     or v_industry_invalid
     or pg_catalog.cardinality(v_industries) = 0
     or pg_catalog.cardinality(v_industries) > 16
     or v_locale is null
     or v_locale !~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$'
     or v_timezone is null
     or (
       v_timezone <> 'UTC'
       and pg_catalog.strpos(v_timezone, '/') = 0
     )
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = v_timezone
     )
     or v_currency_code is null
     or v_currency_code !~ '^[A-Z]{3}$'
     or v_source.default_work_start is null
     or v_source.default_work_end is null
     or v_source.default_work_start = time '24:00:00'
     or v_source.default_work_end = time '24:00:00'
     or v_source.default_work_start >= v_source.default_work_end
     or v_inventory_mode not in ('off', 'tracked')
     or v_source.catalog_setup_completed_at is not null
        and not pg_catalog.isfinite(v_source.catalog_setup_completed_at) then
    raise exception 'agent_company_context_source_invalid'
      using errcode = '22000';
  end if;

  if v_logo_url !~ '^https://[^/@[:space:]]+(/[^#[:space:]]*)?$' then
    v_logo_url := null;
  end if;
  if v_website_url !~ '^https://[^/@[:space:]]+(/[^#[:space:]]*)?$' then
    v_website_url := null;
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'company_ref', pg_catalog.jsonb_build_object(
      'kind', 'company',
      'id', p_company_id
    ),
    'profile', pg_catalog.jsonb_build_object(
      'display_name', v_name,
      'description', v_description,
      'industries', pg_catalog.to_jsonb(v_industries),
      'content_kind', 'untrusted_business_data'
    ),
    'regional', pg_catalog.jsonb_build_object(
      'locale', v_locale,
      'timezone', v_timezone,
      'currency_code', v_currency_code
    ),
    'working_window', pg_catalog.jsonb_build_object(
      'start_local', pg_catalog.to_char(
        v_source.default_work_start,
        'HH24:MI:SS'
      ),
      'end_local', pg_catalog.to_char(
        v_source.default_work_end,
        'HH24:MI:SS'
      ),
      'weekend_policy', case
        when coalesce(v_source.skip_weekends_in_auto_schedule, true)
          then 'skip'
        else 'include'
      end,
      'precise_scheduling_enabled',
        coalesce(v_source.precise_scheduling_enabled, false)
    ),
    'catalog', pg_catalog.jsonb_build_object(
      'inventory_mode', v_inventory_mode,
      'setup_state', case
        when v_source.catalog_setup_completed_at is null then 'not_complete'
        else 'complete'
      end
    ),
    'public_assets', pg_catalog.jsonb_build_object(
      'logo', case when v_logo_url is null
        then pg_catalog.jsonb_build_object('state', 'unavailable')
        else pg_catalog.jsonb_build_object(
          'state', 'available',
          'url', v_logo_url
        )
      end,
      'website', case when v_website_url is null
        then pg_catalog.jsonb_build_object('state', 'unavailable')
        else pg_catalog.jsonb_build_object(
          'state', 'available',
          'url', v_website_url
        )
      end,
      'content_kind', 'untrusted_business_data'
    )
  );

  return pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc(p_read_at),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'domain', 'company',
        'source_revision', v_source.source_revision
      )
    ),
    'source_inspected', pg_catalog.jsonb_build_object(
      'companies', 1,
      'inventory_settings', v_source.inventory_settings_count,
      'company_settings', v_source.company_settings_count
    ),
    'result', v_result
  );
end;
$function$;

revoke all on function private.agent_p2_company_summary_v1(
  uuid, uuid, uuid, uuid, text, text[], text[], text, text[], text,
  timestamp with time zone
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_company_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_settings_company_scope text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_read_at timestamp with time zone;
  v_summary jsonb;
  v_envelope jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_granted_scope_ceiling is null
     or pg_catalog.cardinality(p_granted_scope_ceiling) not between 1 and 32
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_capability_id is distinct from 'get_company_context'
     or p_capability_revision is distinct from
       'get_company_context:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_required_oauth_scopes is distinct from
       array['ops.company.read']::text[]
     or p_settings_company_scope is distinct from 'all' then
    raise exception 'invalid_agent_company_context_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_granted_scope_ceiling) granted(scope)
    where granted.scope is null
       or granted.scope is distinct from pg_catalog.btrim(granted.scope)
       or pg_catalog.octet_length(granted.scope) not between 1 and 128
  ) or p_granted_scope_ceiling is distinct from (
    select pg_catalog.array_agg(
      granted.scope order by granted.scope collate "C"
    )
    from (
      select distinct source.scope
      from pg_catalog.unnest(p_granted_scope_ceiling) source(scope)
    ) granted
  ) or p_required_oauth_scopes <@ p_granted_scope_ceiling is not true then
    raise exception 'invalid_agent_company_context_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_registered_permission_keys)
      registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from
         pg_catalog.btrim(registry.permission_key)
       or pg_catalog.octet_length(registry.permission_key) not between 1 and 128
  ) or (
    select pg_catalog.count(distinct registry.permission_key)
    from pg_catalog.unnest(p_registered_permission_keys)
      registry(permission_key)
  ) <> pg_catalog.cardinality(p_registered_permission_keys)
  or p_registered_permission_keys is distinct from coalesce((
    select pg_catalog.array_agg(
      registry.permission_key order by registry.permission_key
    )
    from pg_catalog.unnest(p_registered_permission_keys)
      registry(permission_key)
  ), array[]::text[])
  or not ('settings.company' = any(p_registered_permission_keys)) then
    raise exception 'invalid_agent_company_context_request'
      using errcode = '22023';
  end if;

  v_read_at := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.statement_timestamp()
  );
  v_summary := private.agent_p2_company_summary_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_required_oauth_scopes,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_settings_company_scope,
    v_read_at
  );
  if v_summary is null then
    raise exception 'agent_company_context_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;

  v_envelope := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'required_oauth_scopes', pg_catalog.to_jsonb(p_required_oauth_scopes),
    'settings_company_scope', p_settings_company_scope,
    'query', '{}'::jsonb
  ) || v_summary;

  return v_envelope || pg_catalog.jsonb_build_object(
    'proof_ref', 'ops_proof:v1:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          private.canonical_agent_projection_json(v_envelope),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  );
end;
$function$;

revoke all on function public.read_agent_company_context_as_system(
  text, uuid, uuid, uuid, uuid, text, text[], text, text[], text, text,
  text, text[], text
) from public, anon, authenticated, service_role;

alter function private.agent_p2_company_summary_v1(
  uuid, uuid, uuid, uuid, text, text[], text[], text, text[], text,
  timestamp with time zone
) owner to current_user;
alter function public.read_agent_company_context_as_system(
  text, uuid, uuid, uuid, uuid, text, text[], text, text[], text, text,
  text, text[], text
) owner to current_user;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_company_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,timestamp with time zone)',
    'public.read_agent_company_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_company_context_acl_function_missing:%',
        v_signature;
    end if;

    for v_acl in
      select distinct acl.grantee,
             case when acl.grantee = 0 then 'public'
               else role_row.rolname end as role_name
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row
        on role_row.oid = acl.grantee
      where function_row.oid = v_function_oid
        and acl.grantee <> function_row.proowner
    loop
      if v_acl.role_name is null then
        raise exception 'agent_company_context_acl_role_missing:%',
          v_signature;
      end if;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',
        v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name) end
      );
    end loop;
  end loop;
end;
$canonical_acl$;

grant execute on function public.read_agent_company_context_as_system(
  text, uuid, uuid, uuid, uuid, text, text[], text, text[], text, text,
  text, text[], text
) to service_role;

do $postflight$
declare
  v_expected record;
  v_function_oid oid;
  v_actual_result text;
  v_function_acl aclitem[];
  v_function_owner oid;
  v_acl_entries text[];
  v_expected_acl text[];
  v_actual_signatures text[];
begin
  select coalesce(
           pg_catalog.array_agg(
             namespace.nspname || '.' || function_row.proname || '(' ||
             pg_catalog.replace(
               pg_catalog.oidvectortypes(function_row.proargtypes),
               ', ',
               ','
             ) || ')'
             order by namespace.nspname, function_row.proname,
               function_row.oid
           ),
           array[]::text[]
         )
    into v_actual_signatures
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = function_row.pronamespace
  where (
    namespace.nspname = 'private'
    and function_row.proname = 'agent_p2_company_summary_v1'
  ) or (
    namespace.nspname = 'public'
    and function_row.proname = 'read_agent_company_context_as_system'
  );
  if v_actual_signatures is distinct from array[
    'private.agent_p2_company_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,timestamp with time zone)',
    'public.read_agent_company_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text)'
  ]::text[] then
    raise exception 'agent_company_context_function_signature_set_failed';
  end if;

  for v_expected in
    select *
    from (values
      (
        'private.agent_p2_company_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,timestamp with time zone)',
        false,
        false
      ),
      (
        'public.read_agent_company_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text)',
        true,
        true
      )
    ) shape(signature, security_definer, service_execute)
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_expected.signature)::oid;
    select pg_catalog.regexp_replace(
             pg_catalog.pg_get_function_result(function_row.oid),
             '[[:space:]]+',
             ' ',
             'g'
           ),
           function_row.proacl,
           function_row.proowner
      into v_actual_result, v_function_acl, v_function_owner
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_row.oid = v_function_oid
      and function_row.proowner = current_user::regrole
      and language_row.lanname = 'plpgsql'
      and function_row.prokind = 'f'::"char"
      and not function_row.proisstrict
      and function_row.proparallel = 'u'::"char"
      and function_row.prosecdef = v_expected.security_definer
      and function_row.provolatile = 's'::"char"
      and pg_catalog.cardinality(function_row.proconfig) = 1
      and pg_catalog.replace(
        pg_catalog.regexp_replace(
          function_row.proconfig[1],
          '[[:space:]]+',
          '',
          'g'
        ),
        '""',
        ''
      ) = 'search_path=';
    if not found or v_actual_result is distinct from 'jsonb' then
      raise exception 'agent_company_context_function_shape_failed:%',
        v_expected.signature;
    end if;

    select coalesce(
             pg_catalog.array_agg(entry.value order by entry.value),
             array[]::text[]
           )
      into v_acl_entries
    from (
      select distinct
        case when acl.grantee = 0 then 'PUBLIC'
          else coalesce(
            role_row.rolname,
            'OID:' || acl.grantee::text
          ) end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text as value
      from pg_catalog.aclexplode(
        coalesce(
          v_function_acl,
          pg_catalog.acldefault('f', v_function_owner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row
        on role_row.oid = acl.grantee
      where acl.grantee <> v_function_owner
    ) entry;
    v_expected_acl := case when v_expected.service_execute then
      array['service_role:EXECUTE:false']::text[]
    else array[]::text[] end;
    if v_acl_entries is distinct from v_expected_acl then
      raise exception 'agent_company_context_function_acl_failed:%',
        v_expected.signature;
    end if;
  end loop;
end;
$postflight$;

commit;
