-- Current read-only production function definitions and empty local schema.
create table private.agent_read_domain_revisions (
 "company_id" uuid not null,
 "domain" text not null,
 "source_revision" bigint default 0 not null,
 "updated_at" timestamp with time zone default statement_timestamp() not null
);
create table public.company_inventory_settings (
 "company_id" uuid not null,
 "inventory_mode" text default 'off'::text not null,
 "enabled_at" timestamp with time zone,
 "disabled_at" timestamp with time zone,
 "updated_by" uuid,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
create table public.company_settings (
 "company_id" text not null,
 "auto_generate_tasks" boolean default false not null,
 "follow_up_reminder_days" integer default 3 not null,
 "gmail_auto_log_enabled" boolean default true not null,
 "created_at" timestamp with time zone default now(),
 "updated_at" timestamp with time zone default now(),
 "catalog_setup_completed_at" timestamp with time zone
);
CREATE OR REPLACE FUNCTION public.consume_agent_mcp_rate_limit_as_system(p_request_id text, p_grant_id uuid, p_actor_user_id uuid, p_company_id uuid, p_capability_id text, p_policy_id text, p_requested_units integer, p_protocol_era text)
 RETURNS TABLE(allowed boolean, remaining_units integer, reset_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
AS $function$
declare
  v_client_id uuid;
  v_actor_limit integer;
  v_grant_limit integer;
  v_company_limit integer;
  v_window_seconds constant integer := 60;
  v_window_start timestamptz;
  v_reset_at timestamptz;
  v_expiry timestamptz;
  v_actor_digest bytea;
  v_grant_digest bytea;
  v_company_digest bytea;
  v_locked_count integer;
  v_allowed boolean;
  v_remaining integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or p_grant_id is null
     or p_actor_user_id is null
     or p_company_id is null
     or p_capability_id is null
     or p_capability_id !~ '^[a-z][a-z0-9_]{0,127}$'
     or p_capability_id ~ '(^|_)(raw|sql|record|database|table|crud)(_|$)'
     or p_capability_id in ('execute_action', 'fetch_url')
     or p_protocol_era is null
     or p_protocol_era not in ('legacy', 'modern') then
    raise exception 'agent_mcp_rate_limit_request_invalid'
      using errcode = '22023';
  end if;

  if p_requested_units is distinct from 1 then
    raise exception 'agent_mcp_rate_limit_units_invalid'
      using errcode = '22023';
  end if;

  case p_policy_id
    when 'mcp-lightweight-read:2026-08-23.v1' then
      v_actor_limit := 120;
      v_grant_limit := 120;
      v_company_limit := 600;
    when 'mcp-evidence-search:2026-08-23.v1' then
      v_actor_limit := 30;
      v_grant_limit := 30;
      v_company_limit := 120;
    else
      raise exception 'agent_mcp_rate_limit_policy_invalid'
        using errcode = '22023';
  end case;

  select clients.client_id
    into v_client_id
  from private.mcp_oauth_grants grants
  join private.mcp_oauth_clients clients
    on clients.client_id = grants.client_id
  where grants.id = p_grant_id
    and grants.user_id = p_actor_user_id
    and grants.company_id = p_company_id
    and grants.revoked_at is null
    and clients.disabled_at is null;

  if not found then
    raise exception 'agent_mcp_rate_limit_binding_invalid'
      using errcode = '42501';
  end if;

  v_window_start := pg_catalog.to_timestamp(
    floor(extract(epoch from statement_timestamp()) /
      v_window_seconds) * v_window_seconds
  );
  v_reset_at := v_window_start + pg_catalog.make_interval(
    secs => v_window_seconds
  );
  v_expiry := v_reset_at + interval '5 minutes';

  -- Cleanup is intentionally part of the request statement but cannot scan
  -- or delete more than 64 already-expired rows.
  perform private.prune_agent_mcp_rate_limit_buckets(64);

  v_actor_digest := private.agent_mcp_rate_limit_bucket_digest(
    'actor', p_company_id, p_actor_user_id, null,
    p_capability_id, p_policy_id, v_window_start
  );
  v_grant_digest := private.agent_mcp_rate_limit_bucket_digest(
    'grant', p_company_id, p_actor_user_id, p_grant_id,
    p_capability_id, p_policy_id, v_window_start
  );
  v_company_digest := private.agent_mcp_rate_limit_bucket_digest(
    'company', p_company_id, null, null,
    p_capability_id, p_policy_id, v_window_start
  );

  insert into private.agent_mcp_rate_limit_buckets (
    bucket_digest,
    bucket_kind,
    policy_id,
    window_start,
    units_used,
    expires_at
  ) values
    (v_actor_digest, 'actor', p_policy_id, v_window_start, 0, v_expiry),
    (v_grant_digest, 'grant', p_policy_id, v_window_start, 0, v_expiry),
    (v_company_digest, 'company', p_policy_id, v_window_start, 0, v_expiry)
  on conflict (bucket_digest) do nothing;

  -- Every instance acquires the same full-digest ordering. Missing rows were
  -- inserted above, so there is no check-then-insert race.
  perform 1
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest in (
    v_actor_digest,
    v_grant_digest,
    v_company_digest
  )
  order by bucket.bucket_digest
  for update;
  get diagnostics v_locked_count = row_count;

  if v_locked_count is distinct from 3 then
    raise exception 'agent_mcp_rate_limit_bucket_collision'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from private.agent_mcp_rate_limit_buckets bucket
    where (
      bucket.bucket_digest = v_actor_digest
      and (
        bucket.bucket_kind is distinct from 'actor'
        or bucket.policy_id is distinct from p_policy_id
        or bucket.window_start is distinct from v_window_start
        or bucket.expires_at is distinct from v_expiry
      )
    ) or (
      bucket.bucket_digest = v_grant_digest
      and (
        bucket.bucket_kind is distinct from 'grant'
        or bucket.policy_id is distinct from p_policy_id
        or bucket.window_start is distinct from v_window_start
        or bucket.expires_at is distinct from v_expiry
      )
    ) or (
      bucket.bucket_digest = v_company_digest
      and (
        bucket.bucket_kind is distinct from 'company'
        or bucket.policy_id is distinct from p_policy_id
        or bucket.window_start is distinct from v_window_start
        or bucket.expires_at is distinct from v_expiry
      )
    )
  ) then
    raise exception 'agent_mcp_rate_limit_bucket_collision'
      using errcode = '55000';
  end if;

  select bool_and(
      bucket.units_used + p_requested_units <= case bucket.bucket_kind
        when 'actor' then v_actor_limit
        when 'grant' then v_grant_limit
        when 'company' then v_company_limit
      end
    )
    into v_allowed
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest in (
    v_actor_digest,
    v_grant_digest,
    v_company_digest
  );

  if v_allowed then
    update private.agent_mcp_rate_limit_buckets as bucket
    set units_used = bucket.units_used + p_requested_units
    where bucket.bucket_digest in (
      v_actor_digest,
      v_grant_digest,
      v_company_digest
    );

    select min(case bucket.bucket_kind
        when 'actor' then v_actor_limit
        when 'grant' then v_grant_limit
        when 'company' then v_company_limit
      end - bucket.units_used)::integer
      into v_remaining
    from private.agent_mcp_rate_limit_buckets bucket
    where bucket.bucket_digest in (
      v_actor_digest,
      v_grant_digest,
      v_company_digest
    );
  else
    v_remaining := 0;

    -- A durable denial and its privacy-safe operator record commit together.
    -- Allowed calls are audited later with their final result and latency.
    insert into private.mcp_request_audit (
      request_id,
      grant_id,
      client_id,
      actor_user_id,
      company_id,
      tool,
      protocol_era,
      outcome,
      error_code,
      input_sha256,
      result_bytes,
      latency_ms
    ) values (
      p_request_id,
      p_grant_id,
      v_client_id,
      p_actor_user_id,
      p_company_id,
      p_capability_id,
      p_protocol_era,
      'rate_limited',
      'RATE_LIMITED',
      null,
      null,
      null
    );
  end if;

  return query select v_allowed, v_remaining, v_reset_at;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.agent_p2_optional_canonical_text(p_value text, p_maximum_scalars integer, p_maximum_utf8_bytes integer, p_allow_text_whitespace boolean)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO ''
AS $function$
declare
  v_value text;
begin
  if p_maximum_scalars < 1 or p_maximum_utf8_bytes < 1 then
    return null;
  end if;

  v_value := normalize(
    private.agent_trim_discovery_display_text(p_value),
    NFC
  );
  if v_value = ''
     or pg_catalog.char_length(v_value) > p_maximum_scalars
     or pg_catalog.octet_length(v_value) > p_maximum_utf8_bytes
     or not private.agent_discovery_unicode15_text_is_supported(v_value)
     or not private.agent_prompt_text_is_safe(
       v_value,
       p_allow_text_whitespace
     ) then
    return null;
  end if;
  return v_value;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.agent_p2_company_summary_v1(p_actor_user_id uuid, p_company_id uuid, p_oauth_grant_id uuid, p_oauth_client_id uuid, p_grant_revision text, p_granted_scope_ceiling text[], p_required_oauth_scopes text[], p_permission_snapshot_revision text, p_registered_permission_keys text[], p_settings_company_scope text, p_read_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
    select pg_catalog.array_agg(granted.scope order by granted.scope collate "C")
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
   and private.agent_mcp_oauth_scope_sets_equal(oauth_grant.scopes, p_granted_scope_ceiling)
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
$function$
;
CREATE OR REPLACE FUNCTION public.read_agent_company_context_as_system(p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_oauth_grant_id uuid, p_oauth_client_id uuid, p_grant_revision text, p_granted_scope_ceiling text[], p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_settings_company_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    select pg_catalog.array_agg(granted.scope order by granted.scope collate "C")
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
$function$
;
CREATE OR REPLACE FUNCTION private.canonical_agent_projection_json(p_value jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
declare
  v_kind text := jsonb_typeof(p_value);
  v_result text;
begin
  if v_kind = 'array' then
    select '[' || coalesce(
      string_agg(
        private.canonical_agent_projection_json(element.value),
        ',' order by element.ordinality
      ),
      ''
    ) || ']'
    into v_result
    from jsonb_array_elements(p_value) with ordinality
      as element(value, ordinality);
    return v_result;
  end if;

  if v_kind = 'object' then
    select '{' || coalesce(
      string_agg(
        to_jsonb(member.key)::text || ':' ||
          private.canonical_agent_projection_json(member.value),
        ',' order by member.key collate "C"
      ),
      ''
    ) || '}'
    into v_result
    from jsonb_each(p_value) as member(key, value);
    return v_result;
  end if;

  if v_kind = 'number' and (
    trunc(p_value::text::numeric) is distinct from p_value::text::numeric
    or abs(p_value::text::numeric) > 9007199254740991::numeric
  ) then
    raise exception 'agent_projection_number_not_safe_integer'
      using errcode = '22023';
  end if;

  return p_value::text;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.agent_rfc3339_utc(p_value timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select to_char(
    p_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.append_mcp_request_audit_as_system(p_request_id text, p_grant_id uuid, p_client_id uuid, p_actor_user_id uuid, p_company_id uuid, p_tool text, p_protocol_era text, p_outcome text, p_error_code text, p_input_sha256 text, p_result_bytes integer, p_latency_ms integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_request_id is null or btrim(p_request_id) = ''
     or length(p_request_id) > 128 then
    raise exception 'mcp_audit_request_id_invalid' using errcode = '22023';
  end if;

  insert into private.mcp_request_audit (
    request_id,
    grant_id,
    client_id,
    actor_user_id,
    company_id,
    tool,
    protocol_era,
    outcome,
    error_code,
    input_sha256,
    result_bytes,
    latency_ms
  ) values (
    btrim(p_request_id),
    p_grant_id,
    p_client_id,
    p_actor_user_id,
    p_company_id,
    nullif(left(coalesce(p_tool, ''), 128), ''),
    nullif(left(coalesce(p_protocol_era, ''), 32), ''),
    p_outcome,
    nullif(left(coalesce(p_error_code, ''), 64), ''),
    p_input_sha256,
    p_result_bytes,
    p_latency_ms
  );
end;
$function$
;
insert into private.agent_read_domain_revisions(company_id,domain,source_revision) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','company',0);
