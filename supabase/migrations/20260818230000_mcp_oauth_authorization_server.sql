-- OPS remote MCP server: OAuth 2.1 authorization-server persistence.
--
-- This migration creates the storage and system RPCs for the Claude-first MCP
-- mount (P1): dynamically registered public OAuth clients, single-use PKCE
-- authorization codes, company-bound grants, opaque hashed access/refresh
-- tokens with rotation + reuse detection, and an append-only MCP request
-- audit. It creates no route, flips no capability exposure, and touches no
-- outbound email surface.
--
-- Security model:
--   * every table lives in the private schema with ALL table privileges
--     revoked from public, anon, authenticated, and service_role; the only
--     access paths are the owner-executed SECURITY DEFINER functions below;
--   * public *_as_system RPCs are callable only by service_role and repeat an
--     auth-role check as defense in depth (the shipped wave pattern);
--   * tokens and authorization codes are stored ONLY as SHA-256 hex digests —
--     no plaintext credential ever reaches a table;
--   * grant company scope is bound at consent time from the authenticated OPS
--     user's row and revalidated with private.user_is_active_company_member;
--     no tool argument can ever supply tenant identity;
--   * refresh-token replay revokes the whole token family and its grant;
--     authorization-code replay revokes the grant minted from that code
--     (RFC 6749 section 4.1.2 defense);
--   * the audit table is append-only: its single writer is the append RPC and
--     no role holds UPDATE or DELETE.

begin;

-- Fail closed if the primitives this migration composes with have drifted.
do $prerequisites$
declare
  v_signature text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'private') then
    raise exception 'mcp_oauth prerequisite missing: private schema';
  end if;

  foreach v_signature in array array[
    'private.user_is_active_company_member(uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'mcp_oauth prerequisite missing: %', v_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name in ('id', 'company_id', 'is_active')
    having count(distinct column_name) = 3
  ) then
    raise exception 'mcp_oauth prerequisite missing: public.users identity columns';
  end if;
end;
$prerequisites$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists private.mcp_oauth_clients (
  client_id uuid primary key default gen_random_uuid(),
  client_name text not null
    constraint mcp_oauth_clients_name_bounded check (
      length(client_name) between 1 and 256
    ),
  redirect_uris text[] not null
    constraint mcp_oauth_clients_redirect_uris_present check (
      cardinality(redirect_uris) between 1 and 8
    ),
  token_endpoint_auth_method text not null
    constraint mcp_oauth_clients_public_only check (
      token_endpoint_auth_method = 'none'
    ),
  grant_types text[] not null,
  response_types text[] not null,
  scope text not null,
  registration_source text not null
    constraint mcp_oauth_clients_registration_source check (
      registration_source in ('dynamic', 'manual')
    ),
  software_id text,
  software_version text,
  created_at timestamptz not null default statement_timestamp(),
  disabled_at timestamptz
);

revoke all on table private.mcp_oauth_clients
  from public, anon, authenticated, service_role;

create table if not exists private.mcp_oauth_authorization_codes (
  code_hash text primary key
    constraint mcp_oauth_codes_hash_shape check (code_hash ~ '^[0-9a-f]{64}$'),
  client_id uuid not null
    references private.mcp_oauth_clients (client_id),
  user_id uuid not null,
  company_id uuid not null,
  scopes text[] not null
    constraint mcp_oauth_codes_scopes_present check (
      cardinality(scopes) between 1 and 32
    ),
  redirect_uri text not null,
  code_challenge text not null
    constraint mcp_oauth_codes_challenge_shape check (
      code_challenge ~ '^[A-Za-z0-9._~-]{43,128}$'
    ),
  code_challenge_method text not null
    constraint mcp_oauth_codes_challenge_method check (
      code_challenge_method = 'S256'
    ),
  resource text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  consumed_at timestamptz,
  minted_grant_id uuid
);

revoke all on table private.mcp_oauth_authorization_codes
  from public, anon, authenticated, service_role;

create table if not exists private.mcp_oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid not null,
  client_id uuid not null
    references private.mcp_oauth_clients (client_id),
  scopes text[] not null
    constraint mcp_oauth_grants_scopes_present check (
      cardinality(scopes) between 1 and 32
    ),
  revision text not null
    constraint mcp_oauth_grants_revision_shape check (
      revision ~ '^[0-9a-f]{32}$'
    ),
  created_at timestamptz not null default statement_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists mcp_oauth_grants_one_live_per_binding
  on private.mcp_oauth_grants (user_id, company_id, client_id)
  where revoked_at is null;

revoke all on table private.mcp_oauth_grants
  from public, anon, authenticated, service_role;

create table if not exists private.mcp_oauth_tokens (
  token_hash text primary key
    constraint mcp_oauth_tokens_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  kind text not null
    constraint mcp_oauth_tokens_kind check (kind in ('access', 'refresh')),
  grant_id uuid not null
    references private.mcp_oauth_grants (id),
  family_id uuid not null,
  issuer text not null,
  audience text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  rotated_to_hash text,
  used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists mcp_oauth_tokens_by_grant
  on private.mcp_oauth_tokens (grant_id, kind);
create index if not exists mcp_oauth_tokens_by_family
  on private.mcp_oauth_tokens (family_id);

revoke all on table private.mcp_oauth_tokens
  from public, anon, authenticated, service_role;

create table if not exists private.mcp_request_audit (
  id bigint generated always as identity primary key,
  request_id text not null,
  occurred_at timestamptz not null default statement_timestamp(),
  grant_id uuid,
  client_id uuid,
  actor_user_id uuid,
  company_id uuid,
  tool text,
  protocol_era text,
  outcome text not null
    constraint mcp_request_audit_outcome check (
      outcome in (
        'ok',
        'domain_error',
        'unauthenticated',
        'forbidden',
        'rate_limited',
        'internal'
      )
    ),
  error_code text,
  input_sha256 text
    constraint mcp_request_audit_input_hash_shape check (
      input_sha256 is null or input_sha256 ~ '^[0-9a-f]{64}$'
    ),
  result_bytes integer
    constraint mcp_request_audit_result_bytes_bounded check (
      result_bytes is null or result_bytes between 0 and 2147483647
    ),
  latency_ms integer
    constraint mcp_request_audit_latency_bounded check (
      latency_ms is null or latency_ms between 0 and 2147483647
    )
);

revoke all on table private.mcp_request_audit
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Housekeeping helper (definer-internal; never exposed)
-- ---------------------------------------------------------------------------

create or replace function private.prune_expired_mcp_oauth_artifacts()
returns void
language sql
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
  with pruned_codes as (
    delete from private.mcp_oauth_authorization_codes
    where expires_at < statement_timestamp() - interval '1 day'
    returning 1
  )
  delete from private.mcp_oauth_tokens
  where expires_at < statement_timestamp() - interval '30 days';
$function$;

revoke all on function private.prune_expired_mcp_oauth_artifacts()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Client registration
-- ---------------------------------------------------------------------------

create or replace function public.register_mcp_oauth_client_as_system(
  p_client_name text,
  p_redirect_uris text[],
  p_scope text,
  p_software_id text,
  p_software_version text
) returns table (
  client_id uuid,
  client_name text,
  redirect_uris text[],
  token_endpoint_auth_method text,
  grant_types text[],
  response_types text[],
  scope text,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_uri text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_client_name is null or btrim(p_client_name) = ''
     or length(p_client_name) > 256 then
    raise exception 'mcp_oauth_client_name_invalid' using errcode = '22023';
  end if;
  if p_redirect_uris is null
     or cardinality(p_redirect_uris) not between 1 and 8 then
    raise exception 'mcp_oauth_redirect_uris_invalid' using errcode = '22023';
  end if;
  foreach v_uri in array p_redirect_uris loop
    -- The TypeScript policy layer enforces the exact-match allowlist; the
    -- database re-asserts the invariant every stored URI must satisfy.
    if v_uri is null or v_uri !~ '^https://[^[:space:]]+$' then
      raise exception 'mcp_oauth_redirect_uri_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_scope is null or btrim(p_scope) = '' or length(p_scope) > 1024 then
    raise exception 'mcp_oauth_scope_invalid' using errcode = '22023';
  end if;

  return query
  insert into private.mcp_oauth_clients (
    client_name,
    redirect_uris,
    token_endpoint_auth_method,
    grant_types,
    response_types,
    scope,
    registration_source,
    software_id,
    software_version
  ) values (
    btrim(p_client_name),
    p_redirect_uris,
    'none',
    array['authorization_code', 'refresh_token'],
    array['code'],
    btrim(p_scope),
    'dynamic',
    nullif(btrim(coalesce(p_software_id, '')), ''),
    nullif(btrim(coalesce(p_software_version, '')), '')
  )
  returning
    mcp_oauth_clients.client_id,
    mcp_oauth_clients.client_name,
    mcp_oauth_clients.redirect_uris,
    mcp_oauth_clients.token_endpoint_auth_method,
    mcp_oauth_clients.grant_types,
    mcp_oauth_clients.response_types,
    mcp_oauth_clients.scope,
    mcp_oauth_clients.created_at;
end;
$function$;

revoke all on function public.register_mcp_oauth_client_as_system(
  text, text[], text, text, text
) from public, anon, authenticated;
grant execute on function public.register_mcp_oauth_client_as_system(
  text, text[], text, text, text
) to service_role;

create or replace function public.get_mcp_oauth_client_as_system(
  p_client_id uuid
) returns table (
  client_id uuid,
  client_name text,
  redirect_uris text[],
  token_endpoint_auth_method text,
  scope text,
  disabled boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select
    client.client_id,
    client.client_name,
    client.redirect_uris,
    client.token_endpoint_auth_method,
    client.scope,
    client.disabled_at is not null
  from private.mcp_oauth_clients client
  where client.client_id = p_client_id;
end;
$function$;

revoke all on function public.get_mcp_oauth_client_as_system(uuid)
  from public, anon, authenticated;
grant execute on function public.get_mcp_oauth_client_as_system(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Authorization codes
-- ---------------------------------------------------------------------------

create or replace function public.create_mcp_oauth_authorization_code_as_system(
  p_code_hash text,
  p_client_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_scopes text[],
  p_redirect_uri text,
  p_code_challenge text,
  p_resource text,
  p_expires_at timestamptz
) returns void
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.mcp_oauth_clients client
    where client.client_id = p_client_id
      and client.disabled_at is null
      and p_redirect_uri = any (client.redirect_uris)
  ) then
    raise exception 'mcp_oauth_client_unavailable' using errcode = '22023';
  end if;
  if not private.user_is_active_company_member(p_user_id, p_company_id) then
    raise exception 'mcp_oauth_actor_unavailable' using errcode = '22023';
  end if;
  if p_expires_at is null
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '10 minutes' then
    raise exception 'mcp_oauth_code_expiry_invalid' using errcode = '22023';
  end if;

  perform private.prune_expired_mcp_oauth_artifacts();

  insert into private.mcp_oauth_authorization_codes (
    code_hash,
    client_id,
    user_id,
    company_id,
    scopes,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    resource,
    expires_at
  ) values (
    p_code_hash,
    p_client_id,
    p_user_id,
    p_company_id,
    p_scopes,
    p_redirect_uri,
    p_code_challenge,
    'S256',
    p_resource,
    p_expires_at
  );
end;
$function$;

revoke all on function public.create_mcp_oauth_authorization_code_as_system(
  text, uuid, uuid, uuid, text[], text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_mcp_oauth_authorization_code_as_system(
  text, uuid, uuid, uuid, text[], text, text, text, timestamptz
) to service_role;

create or replace function public.consume_mcp_oauth_authorization_code_as_system(
  p_code_hash text,
  p_client_id uuid,
  p_redirect_uri text
) returns table (
  user_id uuid,
  company_id uuid,
  scopes text[],
  code_challenge text,
  resource text
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_replayed_grant_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  -- RFC 6749 4.1.2: a second presentation of a consumed code revokes every
  -- credential minted from it. Checked before the consuming update so the
  -- replay path cannot race itself into a fresh mint.
  select code.minted_grant_id
  into v_replayed_grant_id
  from private.mcp_oauth_authorization_codes code
  where code.code_hash = p_code_hash
    and code.consumed_at is not null;
  if found then
    if v_replayed_grant_id is not null then
      update private.mcp_oauth_grants grants
      set revoked_at = coalesce(grants.revoked_at, statement_timestamp())
      where grants.id = v_replayed_grant_id;
      update private.mcp_oauth_tokens tokens
      set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
      where tokens.grant_id = v_replayed_grant_id;
    end if;
    return;
  end if;

  return query
  update private.mcp_oauth_authorization_codes code
  set consumed_at = statement_timestamp()
  where code.code_hash = p_code_hash
    and code.client_id = p_client_id
    and code.redirect_uri = p_redirect_uri
    and code.consumed_at is null
    and code.expires_at > statement_timestamp()
  returning
    code.user_id,
    code.company_id,
    code.scopes,
    code.code_challenge,
    code.resource;
end;
$function$;

revoke all on function public.consume_mcp_oauth_authorization_code_as_system(
  text, uuid, text
) from public, anon, authenticated;
grant execute on function public.consume_mcp_oauth_authorization_code_as_system(
  text, uuid, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Grant + token mint
-- ---------------------------------------------------------------------------

create or replace function public.mint_mcp_oauth_grant_as_system(
  p_code_hash text,
  p_client_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_scopes text[],
  p_access_hash text,
  p_refresh_hash text,
  p_issuer text,
  p_audience text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
) returns table (
  grant_id uuid,
  revision text
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_grant_id uuid;
  v_revision text;
  v_family_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if not private.user_is_active_company_member(p_user_id, p_company_id) then
    raise exception 'mcp_oauth_actor_unavailable' using errcode = '22023';
  end if;
  if p_access_hash is null or p_access_hash !~ '^[0-9a-f]{64}$'
     or p_refresh_hash is null or p_refresh_hash !~ '^[0-9a-f]{64}$'
     or p_access_hash = p_refresh_hash then
    raise exception 'mcp_oauth_token_hash_invalid' using errcode = '22023';
  end if;

  -- Re-consent rotates: exactly one live grant per (user, company, client).
  update private.mcp_oauth_grants grants
  set revoked_at = statement_timestamp()
  where grants.user_id = p_user_id
    and grants.company_id = p_company_id
    and grants.client_id = p_client_id
    and grants.revoked_at is null;
  update private.mcp_oauth_tokens tokens
  set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
  from private.mcp_oauth_grants grants
  where tokens.grant_id = grants.id
    and grants.user_id = p_user_id
    and grants.company_id = p_company_id
    and grants.client_id = p_client_id
    and grants.revoked_at is not null
    and tokens.revoked_at is null;

  v_revision := replace(gen_random_uuid()::text, '-', '');
  v_family_id := gen_random_uuid();

  insert into private.mcp_oauth_grants (
    user_id,
    company_id,
    client_id,
    scopes,
    revision
  ) values (
    p_user_id,
    p_company_id,
    p_client_id,
    p_scopes,
    v_revision
  )
  returning id into v_grant_id;

  insert into private.mcp_oauth_tokens (
    token_hash, kind, grant_id, family_id, issuer, audience, expires_at
  ) values
    (p_access_hash, 'access', v_grant_id, v_family_id, p_issuer, p_audience,
     p_access_expires_at),
    (p_refresh_hash, 'refresh', v_grant_id, v_family_id, p_issuer, p_audience,
     p_refresh_expires_at);

  update private.mcp_oauth_authorization_codes code
  set minted_grant_id = v_grant_id
  where code.code_hash = p_code_hash;

  return query select v_grant_id, v_revision;
end;
$function$;

revoke all on function public.mint_mcp_oauth_grant_as_system(
  text, uuid, uuid, uuid, text[], text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.mint_mcp_oauth_grant_as_system(
  text, uuid, uuid, uuid, text[], text, text, text, text, timestamptz, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- Refresh rotation with family reuse detection
-- ---------------------------------------------------------------------------

create or replace function public.rotate_mcp_oauth_refresh_token_as_system(
  p_presented_hash text,
  p_new_access_hash text,
  p_new_refresh_hash text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
) returns table (
  grant_id uuid,
  client_id uuid,
  user_id uuid,
  company_id uuid,
  scopes text[],
  revision text,
  issuer text,
  audience text,
  reuse_detected boolean
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_token record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select
    tokens.token_hash,
    tokens.grant_id,
    tokens.family_id,
    tokens.issuer,
    tokens.audience,
    tokens.expires_at,
    tokens.used_at,
    tokens.revoked_at,
    grants.user_id,
    grants.company_id,
    grants.client_id,
    grants.scopes,
    grants.revision,
    grants.revoked_at as grant_revoked_at,
    clients.disabled_at as client_disabled_at
  into v_token
  from private.mcp_oauth_tokens tokens
  join private.mcp_oauth_grants grants on grants.id = tokens.grant_id
  join private.mcp_oauth_clients clients on clients.client_id = grants.client_id
  where tokens.token_hash = p_presented_hash
    and tokens.kind = 'refresh'
  for update of tokens, grants;

  if not found then
    return;
  end if;

  -- A previously rotated or revoked refresh token presented again is family
  -- compromise evidence: kill the family and the grant, return the marker row.
  if v_token.used_at is not null or v_token.revoked_at is not null then
    update private.mcp_oauth_tokens tokens
    set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
    where tokens.family_id = v_token.family_id;
    update private.mcp_oauth_grants grants
    set revoked_at = coalesce(grants.revoked_at, statement_timestamp())
    where grants.id = v_token.grant_id;
    return query select
      v_token.grant_id, v_token.client_id, v_token.user_id, v_token.company_id,
      v_token.scopes, v_token.revision, v_token.issuer, v_token.audience, true;
    return;
  end if;

  if v_token.expires_at <= statement_timestamp()
     or v_token.grant_revoked_at is not null
     or v_token.client_disabled_at is not null then
    return;
  end if;

  if p_new_access_hash is null or p_new_access_hash !~ '^[0-9a-f]{64}$'
     or p_new_refresh_hash is null or p_new_refresh_hash !~ '^[0-9a-f]{64}$'
     or p_new_access_hash = p_new_refresh_hash then
    raise exception 'mcp_oauth_token_hash_invalid' using errcode = '22023';
  end if;

  update private.mcp_oauth_tokens tokens
  set used_at = statement_timestamp(),
      rotated_to_hash = p_new_refresh_hash
  where tokens.token_hash = v_token.token_hash;

  insert into private.mcp_oauth_tokens (
    token_hash, kind, grant_id, family_id, issuer, audience, expires_at
  ) values
    (p_new_access_hash, 'access', v_token.grant_id, v_token.family_id,
     v_token.issuer, v_token.audience, p_access_expires_at),
    (p_new_refresh_hash, 'refresh', v_token.grant_id, v_token.family_id,
     v_token.issuer, v_token.audience, p_refresh_expires_at);

  update private.mcp_oauth_grants grants
  set last_used_at = statement_timestamp()
  where grants.id = v_token.grant_id;

  perform private.prune_expired_mcp_oauth_artifacts();

  return query select
    v_token.grant_id, v_token.client_id, v_token.user_id, v_token.company_id,
    v_token.scopes, v_token.revision, v_token.issuer, v_token.audience, false;
end;
$function$;

revoke all on function public.rotate_mcp_oauth_refresh_token_as_system(
  text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.rotate_mcp_oauth_refresh_token_as_system(
  text, text, text, timestamptz, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- Access-token resolution (the per-call MCP bearer path)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_mcp_oauth_access_token_as_system(
  p_token_hash text
) returns table (
  grant_id uuid,
  client_id uuid,
  client_name text,
  user_id uuid,
  company_id uuid,
  scopes text[],
  revision text,
  issuer text,
  audience text,
  expires_at timestamptz,
  token_revoked boolean,
  grant_revoked boolean,
  client_disabled boolean
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  with resolved as (
    select
      grants.id as grant_id,
      grants.client_id,
      clients.client_name,
      grants.user_id,
      grants.company_id,
      grants.scopes,
      grants.revision,
      tokens.issuer,
      tokens.audience,
      tokens.expires_at,
      tokens.revoked_at is not null as token_revoked,
      grants.revoked_at is not null as grant_revoked,
      clients.disabled_at is not null as client_disabled,
      (tokens.revoked_at is null
        and grants.revoked_at is null
        and clients.disabled_at is null
        and tokens.expires_at > statement_timestamp()) as usable
    from private.mcp_oauth_tokens tokens
    join private.mcp_oauth_grants grants on grants.id = tokens.grant_id
    join private.mcp_oauth_clients clients
      on clients.client_id = grants.client_id
    where tokens.token_hash = p_token_hash
      and tokens.kind = 'access'
  ),
  touched as (
    update private.mcp_oauth_grants grants
    set last_used_at = statement_timestamp()
    from resolved
    where grants.id = resolved.grant_id
      and resolved.usable
    returning grants.id
  )
  select
    resolved.grant_id,
    resolved.client_id,
    resolved.client_name,
    resolved.user_id,
    resolved.company_id,
    resolved.scopes,
    resolved.revision,
    resolved.issuer,
    resolved.audience,
    resolved.expires_at,
    resolved.token_revoked,
    resolved.grant_revoked,
    resolved.client_disabled
  from resolved;
end;
$function$;

revoke all on function public.resolve_mcp_oauth_access_token_as_system(text)
  from public, anon, authenticated;
grant execute on function public.resolve_mcp_oauth_access_token_as_system(text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Revocation
-- ---------------------------------------------------------------------------

create or replace function public.revoke_mcp_oauth_grant_as_system(
  p_grant_id uuid,
  p_user_id uuid
) returns boolean
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_revoked boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  update private.mcp_oauth_grants grants
  set revoked_at = statement_timestamp()
  where grants.id = p_grant_id
    and grants.user_id = p_user_id
    and grants.revoked_at is null;
  v_revoked := found;

  if v_revoked then
    update private.mcp_oauth_tokens tokens
    set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
    where tokens.grant_id = p_grant_id;
  end if;

  return v_revoked;
end;
$function$;

revoke all on function public.revoke_mcp_oauth_grant_as_system(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_mcp_oauth_grant_as_system(uuid, uuid)
  to service_role;

create or replace function public.revoke_mcp_oauth_token_as_system(
  p_token_hash text
) returns boolean
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_grant_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  -- RFC 7009: revoking either token kind ends the connection's authority —
  -- the grant and every token in it. Unknown tokens still return true.
  select tokens.grant_id
  into v_grant_id
  from private.mcp_oauth_tokens tokens
  where tokens.token_hash = p_token_hash;

  if v_grant_id is not null then
    update private.mcp_oauth_grants grants
    set revoked_at = coalesce(grants.revoked_at, statement_timestamp())
    where grants.id = v_grant_id;
    update private.mcp_oauth_tokens tokens
    set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
    where tokens.grant_id = v_grant_id;
  end if;

  return true;
end;
$function$;

revoke all on function public.revoke_mcp_oauth_token_as_system(text)
  from public, anon, authenticated;
grant execute on function public.revoke_mcp_oauth_token_as_system(text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Grant listing (settings surface)
-- ---------------------------------------------------------------------------

create or replace function public.list_mcp_oauth_grants_for_user_as_system(
  p_user_id uuid,
  p_company_id uuid
) returns table (
  grant_id uuid,
  client_name text,
  scopes text[],
  created_at timestamptz,
  last_used_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select
    grants.id,
    clients.client_name,
    grants.scopes,
    grants.created_at,
    grants.last_used_at
  from private.mcp_oauth_grants grants
  join private.mcp_oauth_clients clients
    on clients.client_id = grants.client_id
  where grants.user_id = p_user_id
    and grants.company_id = p_company_id
    and grants.revoked_at is null
  order by grants.created_at desc;
end;
$function$;

revoke all on function public.list_mcp_oauth_grants_for_user_as_system(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_mcp_oauth_grants_for_user_as_system(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Request audit (append-only)
-- ---------------------------------------------------------------------------

create or replace function public.append_mcp_request_audit_as_system(
  p_request_id text,
  p_grant_id uuid,
  p_client_id uuid,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_tool text,
  p_protocol_era text,
  p_outcome text,
  p_error_code text,
  p_input_sha256 text,
  p_result_bytes integer,
  p_latency_ms integer
) returns void
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function public.append_mcp_request_audit_as_system(
  text, uuid, uuid, uuid, uuid, text, text, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.append_mcp_request_audit_as_system(
  text, uuid, uuid, uuid, uuid, text, text, text, text, text, integer, integer
) to service_role;

commit;
