-- Atomic public MCP tool-request intake.
--
-- The browser never writes feature_requests directly. The trusted server sends
-- a normalized request plus domain-separated HMAC identities to this
-- service-role-only boundary. Replay is resolved before rate checks; a new
-- request consumes all three durable counters and inserts the fixed public row
-- in the same PostgreSQL statement.

do $prerequisite$
declare
  v_feature_request_columns_valid boolean;
begin
  if pg_catalog.to_regnamespace('private') is null
     or pg_catalog.to_regclass('public.feature_requests') is null
     or pg_catalog.to_regprocedure(
       'private.require_external_api_service_role()'
     ) is null
     or pg_catalog.to_regprocedure(
       'extensions.digest(bytea,text)'
     ) is null then
    raise exception 'public_mcp_tool_request_prerequisite_missing'
      using errcode = '55000';
  end if;

  select count(*) = 12
     and count(*) filter (
       where attribute.attname in (
         'id',
         'user_id',
         'company_id',
         'type',
         'title',
         'description',
         'source_screen',
         'status',
         'user_email',
         'user_name',
         'app_version',
         'platform'
       )
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'text'
     ) = 12
    into v_feature_request_columns_valid
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.feature_requests'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attname in (
      'id',
      'user_id',
      'company_id',
      'type',
      'title',
      'description',
      'source_screen',
      'status',
      'user_email',
      'user_name',
      'app_version',
      'platform'
    );

  if not coalesce(v_feature_request_columns_valid, false) then
    raise exception 'public_mcp_tool_request_feature_requests_shape_invalid'
      using errcode = '55000';
  end if;
end;
$prerequisite$;

create table if not exists private.mcp_tool_request_rate_limit_windows (
  identity_digest bytea not null,
  identity_kind text not null,
  window_kind text not null,
  policy_id text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  expires_at timestamptz not null,
  constraint mcp_tool_request_rate_limit_windows_pkey primary key (
    identity_digest,
    identity_kind,
    window_kind,
    window_started_at
  ),
  constraint mcp_tool_request_rate_limit_windows_digest_shape check (
    pg_catalog.octet_length(identity_digest) = 32
  ),
  constraint mcp_tool_request_rate_limit_windows_dimension_closed check (
    (identity_kind = 'network' and window_kind in ('hour', 'day'))
    or (identity_kind = 'email' and window_kind = 'day')
  ),
  constraint mcp_tool_request_rate_limit_windows_policy_closed check (
    policy_id = 'mcp-tool-request-public:2026-09-04.v1'
  ),
  constraint mcp_tool_request_rate_limit_windows_count_bounded check (
    (
      identity_kind = 'network'
      and window_kind = 'hour'
      and request_count between 1 and 5
    )
    or (
      identity_kind = 'network'
      and window_kind = 'day'
      and request_count between 1 and 20
    )
    or (
      identity_kind = 'email'
      and window_kind = 'day'
      and request_count between 1 and 3
    )
  ),
  constraint mcp_tool_request_rate_limit_windows_expiry_exact check (
    (
      window_kind = 'hour'
      and expires_at = window_started_at + interval '1 hour 5 minutes'
    )
    or (
      window_kind = 'day'
      and expires_at = window_started_at + interval '1 day 5 minutes'
    )
  )
);

alter table private.mcp_tool_request_rate_limit_windows
  enable row level security;
alter table private.mcp_tool_request_rate_limit_windows
  force row level security;

create index if not exists mcp_tool_request_rate_limit_windows_expiry_idx
  on private.mcp_tool_request_rate_limit_windows (
    expires_at,
    identity_digest,
    identity_kind,
    window_kind,
    window_started_at
  );

comment on table private.mcp_tool_request_rate_limit_windows is
  'Durable anonymous MCP tool-request rate windows. Stores only digests of server-generated HMAC identities; never raw IP or email values.';
comment on column private.mcp_tool_request_rate_limit_windows.identity_digest is
  'SHA-256 digest of one domain-separated HMAC identity supplied by the trusted server.';
comment on column private.mcp_tool_request_rate_limit_windows.identity_kind is
  'Closed identity dimension: network or email.';
comment on column private.mcp_tool_request_rate_limit_windows.window_kind is
  'Closed UTC epoch window: hour or day.';
comment on column private.mcp_tool_request_rate_limit_windows.policy_id is
  'Immutable policy revision for the public MCP tool-request form.';
comment on column private.mcp_tool_request_rate_limit_windows.window_started_at is
  'UTC epoch-aligned start of the fixed rate window.';
comment on column private.mcp_tool_request_rate_limit_windows.request_count is
  'Number of newly-created requests consumed in this window; denied attempts and replays do not increment it.';
comment on column private.mcp_tool_request_rate_limit_windows.expires_at is
  'Window reset plus a five-minute cleanup buffer.';

create or replace function public.submit_public_mcp_tool_request_as_system(
  p_submission_id uuid,
  p_requester_email text,
  p_details text,
  p_network_identity text,
  p_email_identity text,
  p_active_exposure_revision text
) returns table (
  outcome text,
  submission_id uuid,
  feature_request_id text,
  retry_after_seconds integer
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_now constant timestamptz := statement_timestamp();
  v_policy_id constant text :=
    'mcp-tool-request-public:2026-09-04.v1';
  v_public_identity constant text := 'public:mcp-tool-request';
  v_feature_request_id text;
  v_email text;
  v_details text;
  v_title_source text;
  v_title text;
  v_existing public.feature_requests%rowtype;
  v_network_digest bytea;
  v_email_digest bytea;
  v_hour_start timestamptz;
  v_day_start timestamptz;
  v_hour_reset timestamptz;
  v_day_reset timestamptz;
  v_network_hour_count integer;
  v_network_day_count integer;
  v_email_day_count integer;
  v_retry_after integer := 0;
  v_locked_identity record;
  v_consumed_rows integer;
begin
  perform private.require_external_api_service_role();

  if p_submission_id is null then
    raise exception 'mcp_tool_request_submission_id_invalid'
      using errcode = '22023';
  end if;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_requester_email));
  if p_requester_email is null
     or pg_catalog.char_length(v_email) not between 3 and 254
     or pg_catalog.octet_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'mcp_tool_request_email_invalid'
      using errcode = '22023';
  end if;

  v_details := pg_catalog.btrim(
    pg_catalog.replace(
      pg_catalog.replace(p_details, E'\r\n', E'\n'),
      E'\r',
      E'\n'
    )
  );
  if p_details is null
     or pg_catalog.char_length(v_details) not between 20 and 4000
     or pg_catalog.octet_length(v_details) > 16000 then
    raise exception 'mcp_tool_request_details_invalid'
      using errcode = '22023';
  end if;

  if p_network_identity is null
     or p_email_identity is null
     or p_network_identity !~ '^[A-Za-z0-9_-]{43}$'
     or p_email_identity !~ '^[A-Za-z0-9_-]{43}$'
     or p_network_identity = p_email_identity then
    raise exception 'mcp_tool_request_rate_identity_invalid'
      using errcode = '22023';
  end if;

  if p_active_exposure_revision is null
     or p_active_exposure_revision is distinct from
       pg_catalog.btrim(p_active_exposure_revision)
     or p_active_exposure_revision !~
       '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'mcp_tool_request_exposure_revision_invalid'
      using errcode = '22023';
  end if;

  v_feature_request_id := 'mcp-tool:' || p_submission_id::text;
  v_title_source := pg_catalog.regexp_replace(
    pg_catalog.split_part(v_details, E'\n', 1),
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_title := case
    when pg_catalog.char_length(v_title_source) <= 96 then v_title_source
    else pg_catalog.left(v_title_source, 93) || '...'
  end;

  -- The request identity is always locked first. Identical replays never
  -- consume a rate unit, even if a limiter window is now exhausted.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'mcp-tool-request-id:' || v_feature_request_id,
      9042026
    )
  );

  select request_row.*
    into v_existing
  from public.feature_requests request_row
  where request_row.id = v_feature_request_id;

  if found then
    if v_existing.user_id = v_public_identity
       and v_existing.company_id = v_public_identity
       and v_existing.type = 'mcp_tool_request'
       and v_existing.title = v_title
       and v_existing.description = v_details
       and v_existing.source_screen = '/developers/mcp'
       and v_existing.user_email = v_email
       and v_existing.user_name is null
       and v_existing.platform = 'web' then
      return query select
        'replayed'::text,
        p_submission_id,
        v_feature_request_id,
        null::integer;
      return;
    end if;

    raise exception 'mcp_tool_request_id_conflict'
      using errcode = '23505';
  end if;

  v_network_digest := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_array(
        'mcp-tool-request-rate-identity:2026-09-04.v1',
        'network',
        p_network_identity
      )::text,
      'UTF8'
    ),
    'sha256'
  );
  v_email_digest := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_array(
        'mcp-tool-request-rate-identity:2026-09-04.v1',
        'email',
        p_email_identity
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  v_hour_start := pg_catalog.to_timestamp(
    floor(extract(epoch from v_now) / 3600) * 3600
  );
  v_day_start := pg_catalog.to_timestamp(
    floor(extract(epoch from v_now) / 86400) * 86400
  );
  v_hour_reset := v_hour_start + interval '1 hour';
  v_day_reset := v_day_start + interval '1 day';

  -- Cleanup can never scan or remove more than 32 already-expired rows.
  with expired as materialized (
    select
      window_row.identity_digest,
      window_row.identity_kind,
      window_row.window_kind,
      window_row.window_started_at
    from private.mcp_tool_request_rate_limit_windows window_row
    where window_row.expires_at <= v_now
    order by
      window_row.expires_at,
      window_row.identity_digest,
      window_row.identity_kind,
      window_row.window_kind,
      window_row.window_started_at
    limit 32
    for update skip locked
  )
  delete from private.mcp_tool_request_rate_limit_windows window_row
  using expired
  where window_row.identity_digest = expired.identity_digest
    and window_row.identity_kind = expired.identity_kind
    and window_row.window_kind = expired.window_kind
    and window_row.window_started_at = expired.window_started_at;

  -- Different request IDs sharing a network or email lock both identities in
  -- the same numeric order, preventing races and cross-dimension deadlocks.
  for v_locked_identity in
    select lock_row.lock_key
    from (
      values
        (
          pg_catalog.hashtextextended(
            'mcp-tool-request-rate-lock:' ||
              pg_catalog.encode(v_network_digest, 'hex'),
            9042026
          )
        ),
        (
          pg_catalog.hashtextextended(
            'mcp-tool-request-rate-lock:' ||
              pg_catalog.encode(v_email_digest, 'hex'),
            9042026
          )
        )
    ) lock_row(lock_key)
    order by lock_row.lock_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(v_locked_identity.lock_key);
  end loop;

  select coalesce(max(window_row.request_count), 0)::integer
    into v_network_hour_count
  from private.mcp_tool_request_rate_limit_windows window_row
  where window_row.identity_digest = v_network_digest
    and window_row.identity_kind = 'network'
    and window_row.window_kind = 'hour'
    and window_row.policy_id = v_policy_id
    and window_row.window_started_at = v_hour_start;

  select coalesce(max(window_row.request_count), 0)::integer
    into v_network_day_count
  from private.mcp_tool_request_rate_limit_windows window_row
  where window_row.identity_digest = v_network_digest
    and window_row.identity_kind = 'network'
    and window_row.window_kind = 'day'
    and window_row.policy_id = v_policy_id
    and window_row.window_started_at = v_day_start;

  select coalesce(max(window_row.request_count), 0)::integer
    into v_email_day_count
  from private.mcp_tool_request_rate_limit_windows window_row
  where window_row.identity_digest = v_email_digest
    and window_row.identity_kind = 'email'
    and window_row.window_kind = 'day'
    and window_row.policy_id = v_policy_id
    and window_row.window_started_at = v_day_start;

  if v_network_hour_count >= 5 then
    v_retry_after := greatest(
      v_retry_after,
      greatest(
        1,
        ceil(extract(epoch from (v_hour_reset - v_now)))::integer
      )
    );
  end if;
  if v_network_day_count >= 20 or v_email_day_count >= 3 then
    v_retry_after := greatest(
      v_retry_after,
      greatest(
        1,
        ceil(extract(epoch from (v_day_reset - v_now)))::integer
      )
    );
  end if;

  if v_retry_after > 0 then
    return query select
      'rate_limited'::text,
      p_submission_id,
      null::text,
      v_retry_after;
    return;
  end if;

  insert into private.mcp_tool_request_rate_limit_windows as window_row (
    identity_digest,
    identity_kind,
    window_kind,
    policy_id,
    window_started_at,
    request_count,
    expires_at
  ) values
    (
      v_network_digest,
      'network',
      'hour',
      v_policy_id,
      v_hour_start,
      1,
      v_hour_reset + interval '5 minutes'
    ),
    (
      v_network_digest,
      'network',
      'day',
      v_policy_id,
      v_day_start,
      1,
      v_day_reset + interval '5 minutes'
    ),
    (
      v_email_digest,
      'email',
      'day',
      v_policy_id,
      v_day_start,
      1,
      v_day_reset + interval '5 minutes'
    )
  on conflict (
    identity_digest,
    identity_kind,
    window_kind,
    window_started_at
  ) do update
  set request_count = window_row.request_count + 1,
      expires_at = excluded.expires_at;
  get diagnostics v_consumed_rows = row_count;

  if v_consumed_rows is distinct from 3 then
    raise exception 'mcp_tool_request_rate_consumption_invalid'
      using errcode = '55000';
  end if;

  begin
    insert into public.feature_requests (
      id,
      user_id,
      company_id,
      type,
      title,
      description,
      source_screen,
      status,
      user_email,
      user_name,
      app_version,
      platform
    ) values (
      v_feature_request_id,
      v_public_identity,
      v_public_identity,
      'mcp_tool_request',
      v_title,
      v_details,
      '/developers/mcp',
      'new',
      v_email,
      null,
      p_active_exposure_revision,
      'web'
    );
  exception
    when unique_violation then
      raise exception 'mcp_tool_request_id_conflict'
        using errcode = '23505';
  end;

  return query select
    'created'::text,
    p_submission_id,
    v_feature_request_id,
    null::integer;
end;
$function$;

comment on function public.submit_public_mcp_tool_request_as_system(
  uuid,
  text,
  text,
  text,
  text,
  text
) is
  'Atomically creates or replays one public MCP tool request after durable network and email rate checks. Service role only; caller identities must already be domain-separated HMAC values.';

-- CREATE OR REPLACE and IF NOT EXISTS preserve prior ACLs. Canonicalize every
-- nonowner grantee so replay cannot retain broader historical privileges.
do $canonical_acl$
declare
  v_role record;
begin
  revoke all privileges
    on table private.mcp_tool_request_rate_limit_windows
    from public;
  revoke all privileges
    on function public.submit_public_mcp_tool_request_as_system(
      uuid,
      text,
      text,
      text,
      text,
      text
    )
    from public;

  for v_role in
    select role_row.rolname
    from pg_catalog.pg_roles role_row
    where role_row.oid <> (current_user::regrole)::oid
    order by role_row.oid
  loop
    execute pg_catalog.format(
      'revoke all privileges on table private.mcp_tool_request_rate_limit_windows from %I',
      v_role.rolname
    );
    execute pg_catalog.format(
      'revoke all privileges on function public.submit_public_mcp_tool_request_as_system(uuid,text,text,text,text,text) from %I',
      v_role.rolname
    );
  end loop;

  grant execute
    on function public.submit_public_mcp_tool_request_as_system(
      uuid,
      text,
      text,
      text,
      text,
      text
    )
    to service_role;
end;
$canonical_acl$;

do $postflight$
declare
  v_table oid;
  v_function oid;
  v_expected_owner oid := (current_user::regrole)::oid;
  v_service_role oid;
  v_valid boolean;
begin
  select role_row.oid
    into strict v_service_role
  from pg_catalog.pg_roles role_row
  where role_row.rolname = 'service_role';

  select relation.oid
    into v_table
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and relation.relname = 'mcp_tool_request_rate_limit_windows'
    and relation.relkind = 'r'
    and relation.relpersistence = 'p'
    and relation.relowner = v_expected_owner
    and relation.relrowsecurity
    and relation.relforcerowsecurity
    and not relation.relhasrules
    and not relation.relhastriggers;

  if v_table is null then
    raise exception 'public_mcp_tool_request_rate_table_invalid'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policy policy_row
    where policy_row.polrelid = v_table
  ) then
    raise exception 'public_mcp_tool_request_rate_table_policy_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 7
     and count(*) filter (
       where attribute.attname = 'identity_digest'
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'bytea'
         and attribute.attnotnull
     ) = 1
     and count(*) filter (
       where attribute.attname in (
         'identity_kind',
         'window_kind',
         'policy_id'
       )
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'text'
         and attribute.attnotnull
     ) = 3
     and count(*) filter (
       where attribute.attname in ('window_started_at', 'expires_at')
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'timestamp with time zone'
         and attribute.attnotnull
     ) = 2
     and count(*) filter (
       where attribute.attname = 'request_count'
         and pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) = 'integer'
         and attribute.attnotnull
     ) = 1
     and bool_and(default_value.oid is null)
     and bool_and(
       attribute.attidentity = ''
       and attribute.attgenerated = ''
     )
    into v_valid
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attrelid = v_table
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if not coalesce(v_valid, false) then
    raise exception 'public_mcp_tool_request_rate_table_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 6
     and count(*) filter (
       where constraint_row.conname =
         'mcp_tool_request_rate_limit_windows_pkey'
         and constraint_row.contype = 'p'
         and constraint_row.convalidated
         and not constraint_row.condeferrable
         and not constraint_row.condeferred
     ) = 1
     and count(*) filter (
       where constraint_row.contype = 'c'
         and constraint_row.convalidated
         and not constraint_row.connoinherit
     ) = 5
    into v_valid
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_table;

  if not coalesce(v_valid, false) then
    raise exception 'public_mcp_tool_request_rate_constraints_invalid'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes index_row
    where index_row.schemaname = 'private'
      and index_row.tablename = 'mcp_tool_request_rate_limit_windows'
      and index_row.indexname =
        'mcp_tool_request_rate_limit_windows_expiry_idx'
      and index_row.indexdef =
        'CREATE INDEX mcp_tool_request_rate_limit_windows_expiry_idx ON private.mcp_tool_request_rate_limit_windows USING btree (expires_at, identity_digest, identity_kind, window_kind, window_started_at)'
  ) then
    raise exception 'public_mcp_tool_request_rate_index_invalid'
      using errcode = '55000';
  end if;

  select procedure_row.oid
    into v_function
  from pg_catalog.pg_proc procedure_row
  where procedure_row.oid =
    'public.submit_public_mcp_tool_request_as_system(uuid,text,text,text,text,text)'::regprocedure
    and procedure_row.proowner = v_expected_owner
    and procedure_row.prosecdef
    and procedure_row.provolatile = 'v'
    and procedure_row.prokind = 'f'
    and procedure_row.proretset
    and procedure_row.proconfig = array[
      'search_path=pg_catalog, public, private, extensions, pg_temp'
    ]::text[];

  if v_function is null then
    raise exception 'public_mcp_tool_request_function_invalid'
      using errcode = '55000';
  end if;

  if pg_catalog.obj_description(v_table, 'pg_class') is distinct from
       'Durable anonymous MCP tool-request rate windows. Stores only digests of server-generated HMAC identities; never raw IP or email values.'
     or pg_catalog.obj_description(v_function, 'pg_proc') is distinct from
       'Atomically creates or replays one public MCP tool request after durable network and email rate checks. Service role only; caller identities must already be domain-separated HMAC values.' then
    raise exception 'public_mcp_tool_request_comments_invalid'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(
        (select relation.relacl
         from pg_catalog.pg_class relation
         where relation.oid = v_table),
        pg_catalog.acldefault('r', v_expected_owner)
      )
    ) acl_row
    where acl_row.grantee <> v_expected_owner
  ) then
    raise exception 'public_mcp_tool_request_rate_table_acl_invalid'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
       from pg_catalog.aclexplode(
         coalesce(
           (select procedure_row.proacl
            from pg_catalog.pg_proc procedure_row
            where procedure_row.oid = v_function),
           pg_catalog.acldefault('f', v_expected_owner)
         )
       ) acl_row
       where acl_row.grantee = v_service_role
         and acl_row.privilege_type = 'EXECUTE'
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(
         coalesce(
           (select procedure_row.proacl
            from pg_catalog.pg_proc procedure_row
            where procedure_row.oid = v_function),
           pg_catalog.acldefault('f', v_expected_owner)
         )
       ) acl_row
       where acl_row.grantee not in (v_expected_owner, v_service_role)
     ) then
    raise exception 'public_mcp_tool_request_function_acl_invalid'
      using errcode = '55000';
  end if;
end;
$postflight$;
