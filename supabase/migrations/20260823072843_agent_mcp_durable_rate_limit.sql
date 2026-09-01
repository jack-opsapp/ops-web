-- Durable, privacy-minimized MCP capability rate limiting.
--
-- One service-only statement re-proves the live OAuth binding, locks the
-- actor/grant/company buckets in a deterministic order, and either advances
-- all three or none. Bucket identities are HMAC digests; the counter table
-- never stores actor, company, grant, capability, request, query, or token
-- identifiers. The existing process/KV limiter remains a burst guard only.

do $prerequisite$
begin
  if pg_catalog.to_regnamespace('private') is null
     or pg_catalog.to_regclass('private.mcp_oauth_grants') is null
     or pg_catalog.to_regclass('private.mcp_oauth_clients') is null
     or pg_catalog.to_regclass('private.mcp_request_audit') is null
     or pg_catalog.to_regprocedure(
       'extensions.hmac(bytea,bytea,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'extensions.gen_random_bytes(integer)'
     ) is null then
    raise exception 'agent_mcp_rate_limit_prerequisite_missing'
      using errcode = '55000';
  end if;
end;
$prerequisite$;

create table if not exists private.agent_mcp_rate_limit_keys (
  key_id text not null,
  key_material bytea not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint agent_mcp_rate_limit_keys_pkey primary key (key_id),
  constraint agent_mcp_rate_limit_keys_id_closed check (
    key_id = 'mcp-rate-limit-hmac:2026-08-23.v1'
  ),
  constraint agent_mcp_rate_limit_keys_material_shape check (
    octet_length(key_material) = 32
  )
);

revoke all on table private.agent_mcp_rate_limit_keys
  from public, anon, authenticated, service_role;

insert into private.agent_mcp_rate_limit_keys (key_id, key_material)
values (
  'mcp-rate-limit-hmac:2026-08-23.v1',
  extensions.gen_random_bytes(32)
)
on conflict (key_id) do nothing;

create table if not exists private.agent_mcp_rate_limit_buckets (
  bucket_digest bytea not null,
  bucket_kind text not null,
  policy_id text not null,
  window_start timestamptz not null,
  units_used integer not null default 0,
  expires_at timestamptz not null,
  constraint agent_mcp_rate_limit_buckets_pkey primary key (bucket_digest),
  constraint agent_mcp_rate_limit_buckets_digest_shape check (
    octet_length(bucket_digest) = 32
  ),
  constraint agent_mcp_rate_limit_buckets_kind_closed check (
    bucket_kind in ('actor', 'grant', 'company')
  ),
  constraint agent_mcp_rate_limit_buckets_policy_closed check (
    policy_id in (
      'mcp-lightweight-read:2026-08-23.v1',
      'mcp-evidence-search:2026-08-23.v1'
    )
  ),
  constraint agent_mcp_rate_limit_buckets_units_bounded check (
    units_used between 0 and 600
  ),
  constraint agent_mcp_rate_limit_buckets_expiry_ordered check (
    expires_at > window_start
  )
);

revoke all on table private.agent_mcp_rate_limit_buckets
  from public, anon, authenticated, service_role;

create index if not exists agent_mcp_rate_limit_buckets_expiry_idx
  on private.agent_mcp_rate_limit_buckets (expires_at, bucket_digest);

create or replace function private.agent_mcp_rate_limit_bucket_digest(
  p_bucket_kind text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_grant_id uuid,
  p_capability_id text,
  p_policy_id text,
  p_window_start timestamptz
) returns bytea
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_key bytea;
  v_canonical text;
begin
  if p_bucket_kind is null
     or p_bucket_kind not in ('actor', 'grant', 'company')
     or p_company_id is null
     or p_capability_id is null
     or p_policy_id is null
     or p_window_start is null
     or (p_bucket_kind = 'actor' and (
       p_actor_user_id is null or p_grant_id is not null
     ))
     or (p_bucket_kind = 'grant' and (
       p_actor_user_id is null or p_grant_id is null
     ))
     or (p_bucket_kind = 'company' and (
       p_actor_user_id is not null or p_grant_id is not null
     )) then
    raise exception 'agent_mcp_rate_limit_digest_input_invalid'
      using errcode = '22023';
  end if;

  select key_row.key_material
    into strict v_key
  from private.agent_mcp_rate_limit_keys key_row
  where key_row.key_id = 'mcp-rate-limit-hmac:2026-08-23.v1';

  v_canonical := pg_catalog.jsonb_build_array(
    'agent-mcp-rate-limit-bucket:2026-08-23.v1',
    p_bucket_kind,
    p_company_id::text,
    coalesce(p_actor_user_id::text, ''),
    coalesce(p_grant_id::text, ''),
    p_capability_id,
    p_policy_id,
    floor(extract(epoch from p_window_start))::bigint
  )::text;

  return extensions.hmac(
    pg_catalog.convert_to(v_canonical, 'UTF8'),
    v_key,
    'sha256'
  );
end;
$function$;

revoke all on function private.agent_mcp_rate_limit_bucket_digest(
  text, uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;

create or replace function private.prune_agent_mcp_rate_limit_buckets(
  p_limit integer
) returns integer
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_deleted integer;
begin
  if p_limit is null or not (p_limit between 1 and 64) then
    raise exception 'agent_mcp_rate_limit_cleanup_bound_invalid'
      using errcode = '22023';
  end if;

  with expired as materialized (
    select bucket.bucket_digest
    from private.agent_mcp_rate_limit_buckets bucket
    where bucket.expires_at <= statement_timestamp()
    order by bucket.expires_at, bucket.bucket_digest
    limit p_limit
    for update skip locked
  ), deleted as (
    delete from private.agent_mcp_rate_limit_buckets bucket
    using expired
    where bucket.bucket_digest = expired.bucket_digest
    returning 1
  )
  select count(*)::integer
    into v_deleted
  from deleted;

  return v_deleted;
end;
$function$;

revoke all on function private.prune_agent_mcp_rate_limit_buckets(integer)
  from public, anon, authenticated, service_role;

create or replace function public.consume_agent_mcp_rate_limit_as_system(
  p_request_id text,
  p_grant_id uuid,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_capability_id text,
  p_policy_id text,
  p_requested_units integer,
  p_protocol_era text
) returns table (
  allowed boolean,
  remaining_units integer,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $function$
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
$function$;

revoke all on function public.consume_agent_mcp_rate_limit_as_system(
  text, uuid, uuid, uuid, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.consume_agent_mcp_rate_limit_as_system(
  text, uuid, uuid, uuid, text, text, integer, text
) to service_role;

-- CREATE OR REPLACE and IF NOT EXISTS preserve prior ACLs. Canonicalize every
-- nonowner grantee before proving the exact least-privilege contract below.
do $canonical_acl$
declare
  v_role record;
begin
  revoke all privileges on table private.agent_mcp_rate_limit_keys
    from public;
  revoke all privileges on table private.agent_mcp_rate_limit_buckets
    from public;
  revoke all privileges on function private.agent_mcp_rate_limit_bucket_digest(
    text, uuid, uuid, uuid, text, text, timestamptz
  ) from public;
  revoke all privileges on function private.prune_agent_mcp_rate_limit_buckets(
    integer
  ) from public;
  revoke all privileges on function public.consume_agent_mcp_rate_limit_as_system(
    text, uuid, uuid, uuid, text, text, integer, text
  ) from public;

  for v_role in
    select roles.rolname
    from pg_catalog.pg_roles roles
    where roles.oid <> (current_user::regrole)::oid
    order by roles.oid
  loop
    execute pg_catalog.format(
      'revoke all privileges on table private.agent_mcp_rate_limit_keys from %I',
      v_role.rolname
    );
    execute pg_catalog.format(
      'revoke all privileges on table private.agent_mcp_rate_limit_buckets from %I',
      v_role.rolname
    );
    execute pg_catalog.format(
      'revoke all privileges on function private.agent_mcp_rate_limit_bucket_digest(text,uuid,uuid,uuid,text,text,timestamptz) from %I',
      v_role.rolname
    );
    execute pg_catalog.format(
      'revoke all privileges on function private.prune_agent_mcp_rate_limit_buckets(integer) from %I',
      v_role.rolname
    );
    execute pg_catalog.format(
      'revoke all privileges on function public.consume_agent_mcp_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text) from %I',
      v_role.rolname
    );
  end loop;

  grant execute on function public.consume_agent_mcp_rate_limit_as_system(
    text, uuid, uuid, uuid, text, text, integer, text
  ) to service_role;
end;
$canonical_acl$;

-- IF NOT EXISTS is safe only when a prior object has the exact reviewed
-- shape. Replay validates the full catalog and fails closed on collisions or
-- manual drift rather than accepting a look-alike table/function.
do $postflight$
declare
  v_key_table oid;
  v_bucket_table oid;
  v_expected_owner oid := (current_user::regrole)::oid;
  v_service_role oid;
  v_valid boolean;
  v_function record;
  v_role text;
begin
  select roles.oid
    into strict v_service_role
  from pg_catalog.pg_roles roles
  where roles.rolname = 'service_role';

  select relation.oid
    into v_key_table
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and relation.relname = 'agent_mcp_rate_limit_keys'
    and relation.relkind = 'r'
    and relation.relpersistence = 'p'
    and relation.relowner = v_expected_owner
    and not relation.relrowsecurity
    and not relation.relforcerowsecurity
    and not relation.relhasrules
    and not relation.relhastriggers;

  if v_key_table is null then
    raise exception 'agent_mcp_rate_limit_catalog_key_table_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 3
     and count(*) filter (
       where attribute.attname = 'key_id'
         and attribute.attnum = 1
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'text'
         and attribute.attnotnull
         and default_value.oid is null
     ) = 1
     and count(*) filter (
       where attribute.attname = 'key_material'
         and attribute.attnum = 2
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'bytea'
         and attribute.attnotnull
         and default_value.oid is null
     ) = 1
     and count(*) filter (
       where attribute.attname = 'created_at'
         and attribute.attnum = 3
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'timestamp with time zone'
         and attribute.attnotnull
         and pg_catalog.pg_get_expr(
           default_value.adbin,
           default_value.adrelid
         ) = 'statement_timestamp()'
     ) = 1
     and bool_and(
       attribute.attidentity = '' and attribute.attgenerated = ''
     )
    into v_valid
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attrelid = v_key_table
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if not coalesce(v_valid, false) then
    raise exception 'agent_mcp_rate_limit_catalog_key_table_invalid'
      using errcode = '55000';
  end if;

  select relation.oid
    into v_bucket_table
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and relation.relname = 'agent_mcp_rate_limit_buckets'
    and relation.relkind = 'r'
    and relation.relpersistence = 'p'
    and relation.relowner = v_expected_owner
    and not relation.relrowsecurity
    and not relation.relforcerowsecurity
    and not relation.relhasrules
    and not relation.relhastriggers;

  if v_bucket_table is null then
    raise exception 'agent_mcp_rate_limit_catalog_bucket_table_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 6
     and count(*) filter (
       where attribute.attname = 'bucket_digest'
         and attribute.attnum = 1
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'bytea'
         and attribute.attnotnull
         and default_value.oid is null
     ) = 1
     and count(*) filter (
       where (
           (attribute.attname = 'bucket_kind' and attribute.attnum = 2)
           or (attribute.attname = 'policy_id' and attribute.attnum = 3)
         )
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'text'
         and attribute.attnotnull
         and default_value.oid is null
     ) = 2
     and count(*) filter (
       where (
           (attribute.attname = 'window_start' and attribute.attnum = 4)
           or (attribute.attname = 'expires_at' and attribute.attnum = 6)
         )
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'timestamp with time zone'
         and attribute.attnotnull
         and default_value.oid is null
     ) = 2
     and count(*) filter (
       where attribute.attname = 'units_used'
         and attribute.attnum = 5
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'integer'
         and attribute.attnotnull
         and pg_catalog.pg_get_expr(
           default_value.adbin,
           default_value.adrelid
         ) = '0'
     ) = 1
     and bool_and(
       attribute.attidentity = '' and attribute.attgenerated = ''
     )
    into v_valid
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attrelid = v_bucket_table
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if not coalesce(v_valid, false) then
    raise exception 'agent_mcp_rate_limit_catalog_bucket_table_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 3
     and count(*) filter (
       where constraint_row.conname = 'agent_mcp_rate_limit_keys_pkey'
         and constraint_row.contype = 'p'
         and constraint_row.conkey = array[1]::smallint[]
         and constraint_row.convalidated
         and not constraint_row.condeferrable
         and not constraint_row.condeferred
     ) = 1
     and count(*) filter (
       where constraint_row.conname = 'agent_mcp_rate_limit_keys_id_closed'
         and constraint_row.contype = 'c'
         and constraint_row.conkey = array[1]::smallint[]
         and constraint_row.convalidated
         and not constraint_row.connoinherit
         and pg_catalog.pg_get_constraintdef(
           constraint_row.oid,
           true
         ) =
           'CHECK (key_id = ''mcp-rate-limit-hmac:2026-08-23.v1''::text)'
     ) = 1
     and count(*) filter (
       where constraint_row.conname =
         'agent_mcp_rate_limit_keys_material_shape'
         and constraint_row.contype = 'c'
         and constraint_row.conkey = array[2]::smallint[]
         and constraint_row.convalidated
         and not constraint_row.connoinherit
         and pg_catalog.pg_get_constraintdef(
           constraint_row.oid,
           true
         ) = 'CHECK (octet_length(key_material) = 32)'
     ) = 1
    into v_valid
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_key_table;

  if not coalesce(v_valid, false) then
    raise exception 'agent_mcp_rate_limit_catalog_constraint_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 6
     and count(*) filter (
       where constraint_row.conname = 'agent_mcp_rate_limit_buckets_pkey'
         and constraint_row.contype = 'p'
         and constraint_row.conkey = array[1]::smallint[]
         and constraint_row.convalidated
         and not constraint_row.condeferrable
         and not constraint_row.condeferred
     ) = 1
     and count(*) filter (
       where constraint_row.conname =
         'agent_mcp_rate_limit_buckets_digest_shape'
         and constraint_row.contype = 'c'
         and constraint_row.conkey = array[1]::smallint[]
         and constraint_row.convalidated
         and not constraint_row.connoinherit
         and pg_catalog.pg_get_constraintdef(
           constraint_row.oid,
           true
         ) = 'CHECK (octet_length(bucket_digest) = 32)'
     ) = 1
     and count(*) filter (
       where constraint_row.conname =
         'agent_mcp_rate_limit_buckets_kind_closed'
         and constraint_row.contype = 'c'
         and constraint_row.conkey = array[2]::smallint[]
         and constraint_row.convalidated
         and not constraint_row.connoinherit
         and pg_catalog.pg_get_constraintdef(
           constraint_row.oid,
           true
         ) =
           'CHECK (bucket_kind = ANY (ARRAY[''actor''::text, ''grant''::text, ''company''::text]))'
     ) = 1
     and count(*) filter (
       where constraint_row.conname =
         'agent_mcp_rate_limit_buckets_policy_closed'
         and constraint_row.contype = 'c'
         and constraint_row.conkey = array[3]::smallint[]
         and constraint_row.convalidated
         and not constraint_row.connoinherit
         and pg_catalog.pg_get_constraintdef(
           constraint_row.oid,
           true
         ) =
           'CHECK (policy_id = ANY (ARRAY[''mcp-lightweight-read:2026-08-23.v1''::text, ''mcp-evidence-search:2026-08-23.v1''::text]))'
     ) = 1
     and count(*) filter (
       where constraint_row.conname =
         'agent_mcp_rate_limit_buckets_units_bounded'
         and constraint_row.contype = 'c'
         and constraint_row.conkey = array[5]::smallint[]
         and constraint_row.convalidated
         and not constraint_row.connoinherit
         and pg_catalog.pg_get_constraintdef(
           constraint_row.oid,
           true
         ) = 'CHECK (units_used >= 0 AND units_used <= 600)'
     ) = 1
     and count(*) filter (
       where constraint_row.conname =
         'agent_mcp_rate_limit_buckets_expiry_ordered'
         and constraint_row.contype = 'c'
         and constraint_row.convalidated
         and not constraint_row.connoinherit
         and pg_catalog.pg_get_constraintdef(
           constraint_row.oid,
           true
         ) = 'CHECK (expires_at > window_start)'
     ) = 1
    into v_valid
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_bucket_table;

  if not coalesce(v_valid, false) then
    raise exception 'agent_mcp_rate_limit_catalog_constraint_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 2
     and count(*) filter (
       where index_class.relname =
         'agent_mcp_rate_limit_buckets_expiry_idx'
         and not index_row.indisprimary
         and not index_row.indisunique
         and index_row.indisvalid
         and index_row.indisready
         and index_row.indnkeyatts = 2
         and index_row.indnatts = 2
         and index_row.indkey::text = '6 1'
         and index_row.indexprs is null
         and index_row.indpred is null
     ) = 1
    into v_valid
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_class
    on index_class.oid = index_row.indexrelid
  where index_row.indrelid = v_bucket_table;

  if not coalesce(v_valid, false) then
    raise exception 'agent_mcp_rate_limit_catalog_index_invalid'
      using errcode = '55000';
  end if;

  for v_function in
    select *
    from (values
      (
        'private.agent_mcp_rate_limit_bucket_digest(text,uuid,uuid,uuid,text,text,timestamp with time zone)',
        's'::"char",
        array[
          'search_path=pg_catalog, private, extensions, pg_temp'
        ]::text[],
        false
      ),
      (
        'private.prune_agent_mcp_rate_limit_buckets(integer)',
        'v'::"char",
        array['search_path=pg_catalog, private, pg_temp']::text[],
        false
      ),
      (
        'public.consume_agent_mcp_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text)',
        'v'::"char",
        array[
          'search_path=pg_catalog, public, private, extensions, pg_temp'
        ]::text[],
        true
      )
    ) expected(signature, volatility, configuration, service_executable)
  loop
    select count(*) = 1
       and bool_and(
         procedure.prosecdef
         and procedure.provolatile = v_function.volatility
         and language.lanname = 'plpgsql'
         and not procedure.proisstrict
         and procedure.proparallel = 'u'
         and procedure.proconfig is not distinct from
           v_function.configuration
         and procedure.prokind = 'f'
         and procedure.proowner = v_expected_owner
       )
      into v_valid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language
      on language.oid = procedure.prolang
    where procedure.oid = pg_catalog.to_regprocedure(v_function.signature);

    if not coalesce(v_valid, false) then
      raise exception 'agent_mcp_rate_limit_catalog_function_invalid:%',
        v_function.signature
        using errcode = '55000';
    end if;

    foreach v_role in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(
        v_role,
        v_function.signature,
        'execute'
      ) then
        raise exception 'agent_mcp_rate_limit_catalog_acl_invalid:%:%',
          v_role,
          v_function.signature
          using errcode = '55000';
      end if;
    end loop;

    if pg_catalog.has_function_privilege(
      'service_role',
      v_function.signature,
      'execute'
    ) is distinct from v_function.service_executable then
      raise exception 'agent_mcp_rate_limit_catalog_acl_invalid:%',
        v_function.signature
        using errcode = '55000';
    end if;

    select count(*) filter (
          where acl_entry.grantee <> procedure.proowner
        ) = case when v_function.service_executable then 1 else 0 end
       and count(*) filter (
          where acl_entry.grantee = v_service_role
            and acl_entry.grantor = procedure.proowner
            and acl_entry.privilege_type = 'EXECUTE'
            and not acl_entry.is_grantable
        ) = case when v_function.service_executable then 1 else 0 end
       and count(*) filter (
          where acl_entry.grantee <> procedure.proowner
            and not (
              v_function.service_executable
              and acl_entry.grantee = v_service_role
              and acl_entry.grantor = procedure.proowner
              and acl_entry.privilege_type = 'EXECUTE'
              and not acl_entry.is_grantable
            )
        ) = 0
      into v_valid
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) acl_entry
    where procedure.oid = pg_catalog.to_regprocedure(v_function.signature);

    if not coalesce(v_valid, false) then
      raise exception 'agent_mcp_rate_limit_catalog_acl_invalid:%',
        v_function.signature
        using errcode = '55000';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) acl_entry
    where relation.oid in (v_key_table, v_bucket_table)
      and acl_entry.grantee <> relation.relowner
  ) then
    raise exception 'agent_mcp_rate_limit_catalog_acl_invalid:table'
      using errcode = '55000';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_table_privilege(
      v_role,
      v_key_table,
      'select,insert,update,delete,truncate,references,trigger'
    ) or pg_catalog.has_table_privilege(
      v_role,
      v_bucket_table,
      'select,insert,update,delete,truncate,references,trigger'
    ) then
      raise exception 'agent_mcp_rate_limit_catalog_acl_invalid:%', v_role
        using errcode = '55000';
    end if;
  end loop;

  if (
    select count(*)
    from private.agent_mcp_rate_limit_keys key_row
    where key_row.key_id = 'mcp-rate-limit-hmac:2026-08-23.v1'
      and octet_length(key_row.key_material) = 32
  ) <> 1 then
    raise exception 'agent_mcp_rate_limit_catalog_key_table_invalid'
      using errcode = '55000';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
