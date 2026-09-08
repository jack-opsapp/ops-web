-- Canonical limiter functions verified against live definitions on 2026-09-07.
create table private.agent_mcp_rate_limit_keys(key_id text primary key,key_material bytea not null);
insert into private.agent_mcp_rate_limit_keys values('mcp-rate-limit-hmac:2026-08-23.v1',decode(repeat('12',32),'hex'));
alter table private.agent_mcp_rate_limit_buckets add primary key(bucket_digest);
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

