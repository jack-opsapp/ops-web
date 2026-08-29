begin;

-- Task 11 private replay ledger. It deliberately retains only irreversible
-- digests, bounded timestamps, and a privacy-safe outcome. The signed token,
-- OAuth bearer, authority identifiers, object locator, name, MIME and payload
-- never enter this relation.
do $prerequisites$
begin
  if pg_catalog.to_regnamespace('private') is null
     or pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'agent_mcp_evidence_ledger_prerequisite_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create table if not exists private.agent_mcp_evidence_redemptions (
  nonce_digest bytea not null,
  authority_binding_digest bytea not null,
  source_revision_digest bytea not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  redeemed_at timestamptz not null,
  outcome_code text not null,
  constraint agent_mcp_evidence_redemptions_pkey
    primary key (nonce_digest),
  constraint agent_mcp_evidence_redemptions_nonce_digest_shape
    check (pg_catalog.octet_length(nonce_digest) = 32),
  constraint agent_mcp_evidence_redemptions_binding_digest_shape
    check (pg_catalog.octet_length(authority_binding_digest) = 32),
  constraint agent_mcp_evidence_redemptions_revision_digest_shape
    check (pg_catalog.octet_length(source_revision_digest) = 32),
  constraint agent_mcp_evidence_redemptions_lifetime
    check (
      pg_catalog.isfinite(issued_at)
      and pg_catalog.isfinite(expires_at)
      and expires_at > issued_at
      and expires_at <= issued_at + interval '5 minutes'
      and pg_catalog.isfinite(redeemed_at)
      and redeemed_at >= issued_at - interval '5 seconds'
    ),
  constraint agent_mcp_evidence_redemptions_outcome
    check (outcome_code in ('pending', 'delivered', 'denied', 'expired'))
);

create index if not exists agent_mcp_evidence_redemptions_expiry_idx
  on private.agent_mcp_evidence_redemptions (expires_at, nonce_digest);

revoke all on table private.agent_mcp_evidence_redemptions
  from public, anon, authenticated, service_role;

create or replace function private.prune_agent_mcp_evidence_redemptions(
  p_limit integer
) returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_deleted integer;
begin
  if p_limit is null or not p_limit between 1 and 64 then
    raise exception 'agent_mcp_evidence_prune_limit_invalid'
      using errcode = '22023';
  end if;

  with victims as materialized (
    select ledger.nonce_digest
    from private.agent_mcp_evidence_redemptions ledger
    where ledger.expires_at < pg_catalog.statement_timestamp() - interval '1 day'
    order by ledger.expires_at, ledger.nonce_digest
    limit p_limit
    for update skip locked
  ), removed as (
    delete from private.agent_mcp_evidence_redemptions ledger
    using victims
    where ledger.nonce_digest = victims.nonce_digest
    returning 1
  )
  select pg_catalog.count(*)::integer into v_deleted from removed;

  return v_deleted;
end;
$function$;

alter table private.agent_mcp_evidence_redemptions owner to current_user;
alter function private.prune_agent_mcp_evidence_redemptions(integer)
  owner to current_user;

revoke all on function private.prune_agent_mcp_evidence_redemptions(integer)
  from public, anon, authenticated, service_role;

-- CREATE IF NOT EXISTS / CREATE OR REPLACE preserve grants made after the
-- first application. Canonicalize every non-owner ACL entry so replay cannot
-- leave a newly introduced role with ledger or cleanup access.
do $canonicalize_acl$
declare
  v_relation_oid oid := pg_catalog.to_regclass(
    'private.agent_mcp_evidence_redemptions'
  )::oid;
  v_function_oid oid := pg_catalog.to_regprocedure(
    'private.prune_agent_mcp_evidence_redemptions(integer)'
  )::oid;
  v_grantee oid;
  v_role_name name;
begin
  for v_grantee in
    select distinct acl.grantee
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) acl
    where relation.oid = v_relation_oid
      and acl.grantee <> relation.relowner
  loop
    if v_grantee = 0 then
      execute
        'revoke all privileges on table ' ||
        'private.agent_mcp_evidence_redemptions from public cascade';
    else
      select role_row.rolname
        into strict v_role_name
      from pg_catalog.pg_roles role_row
      where role_row.oid = v_grantee;
      execute pg_catalog.format(
        'revoke all privileges on table ' ||
        'private.agent_mcp_evidence_redemptions from %I cascade',
        v_role_name
      );
    end if;
  end loop;

  for v_grantee in
    select distinct acl.grantee
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    where function_row.oid = v_function_oid
      and acl.grantee <> function_row.proowner
  loop
    if v_grantee = 0 then
      execute
        'revoke all privileges on function ' ||
        'private.prune_agent_mcp_evidence_redemptions(integer) ' ||
        'from public cascade';
    else
      select role_row.rolname
        into strict v_role_name
      from pg_catalog.pg_roles role_row
      where role_row.oid = v_grantee;
      execute pg_catalog.format(
        'revoke all privileges on function ' ||
        'private.prune_agent_mcp_evidence_redemptions(integer) ' ||
        'from %I cascade',
        v_role_name
      );
    end if;
  end loop;
end;
$canonicalize_acl$;

-- Fail a replay against any relation that merely shares the reserved name.
do $postflight$
declare
  v_relation_oid oid;
  v_columns text[];
  v_constraints text[];
  v_acl_entries text[];
  v_index_definition text;
  v_function_oid oid;
begin
  select relation.oid
    into v_relation_oid
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and relation.relname = 'agent_mcp_evidence_redemptions'
    and relation.relkind = 'r'
    and relation.relpersistence = 'p'
    and not relation.relrowsecurity
    and not relation.relforcerowsecurity
    and not relation.relhastriggers;

  if v_relation_oid is null then
    raise exception 'agent_mcp_evidence_ledger_shape_failed';
  end if;

  select pg_catalog.array_agg(
           attribute.attname || ':' ||
           pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' ||
           attribute.attnotnull::text || ':' ||
           (attribute.attidentity = '')::text || ':' ||
           (attribute.attgenerated = '')::text || ':' ||
           (default_value.oid is null)::text
           order by attribute.attnum
         )
    into v_columns
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attrelid = v_relation_oid
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_columns is distinct from array[
    'nonce_digest:bytea:true:true:true:true',
    'authority_binding_digest:bytea:true:true:true:true',
    'source_revision_digest:bytea:true:true:true:true',
    'issued_at:timestamp with time zone:true:true:true:true',
    'expires_at:timestamp with time zone:true:true:true:true',
    'redeemed_at:timestamp with time zone:true:true:true:true',
    'outcome_code:text:true:true:true:true'
  ]::text[] then
    raise exception 'agent_mcp_evidence_ledger_columns_failed';
  end if;

  select pg_catalog.array_agg(
           constraint_row.conname || ':' ||
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
           order by constraint_row.conname
         )
    into v_constraints
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_relation_oid;

  if pg_catalog.cardinality(v_constraints) is distinct from 6
     or not exists (
       select 1 from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_relation_oid
         and constraint_row.contype = 'p'
         and constraint_row.conkey = array[1]::smallint[]
     )
     or not exists (
       select 1 from pg_catalog.unnest(v_constraints) definition
       where definition like '%octet_length(nonce_digest) = 32%'
     )
     or not exists (
       select 1 from pg_catalog.unnest(v_constraints) definition
       where definition like '%octet_length(authority_binding_digest) = 32%'
     )
     or not exists (
       select 1 from pg_catalog.unnest(v_constraints) definition
       where definition like '%octet_length(source_revision_digest) = 32%'
     )
     or not exists (
       select 1 from pg_catalog.unnest(v_constraints) definition
       where definition ~
         'expires_at.*issued_at.*00:05:00'
     )
     or not exists (
       select 1 from pg_catalog.unnest(v_constraints) definition
       where definition like '%outcome_code = ANY%pending%delivered%denied%expired%'
     ) then
    raise exception 'agent_mcp_evidence_ledger_constraints_failed';
  end if;

  select pg_catalog.pg_get_indexdef(index_row.indexrelid)
    into v_index_definition
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  where index_row.indrelid = v_relation_oid
    and index_relation.relname = 'agent_mcp_evidence_redemptions_expiry_idx';
  if v_index_definition is null
     or v_index_definition not like
       '% USING btree (expires_at, nonce_digest)' then
    raise exception 'agent_mcp_evidence_ledger_index_failed';
  end if;

  select coalesce(pg_catalog.array_agg(
           coalesce(role_row.rolname, 'PUBLIC') || ':' ||
           acl.privilege_type || ':' || acl.is_grantable::text
           order by acl.grantee, acl.privilege_type
         ), array[]::text[])
    into v_acl_entries
  from pg_catalog.pg_class relation
  cross join lateral pg_catalog.aclexplode(
    coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
  ) acl
  left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
  where relation.oid = v_relation_oid
    and acl.grantee <> relation.relowner;
  if v_acl_entries is distinct from array[]::text[] then
    raise exception 'agent_mcp_evidence_ledger_acl_failed';
  end if;

  v_function_oid := pg_catalog.to_regprocedure(
    'private.prune_agent_mcp_evidence_redemptions(integer)'
  )::oid;
  if v_function_oid is null or not exists (
    select 1
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_row.oid = v_function_oid
      and function_row.proowner = current_user::regrole
      and language_row.lanname = 'plpgsql'
      and function_row.provolatile = 'v'
      and function_row.prosecdef
      and pg_catalog.cardinality(function_row.proconfig) = 1
      and pg_catalog.replace(pg_catalog.regexp_replace(
            function_row.proconfig[1], '[[:space:]]+', '', 'g'
          ), '""', '') = 'search_path='
  ) then
    raise exception 'agent_mcp_evidence_prune_shape_failed';
  end if;

  select coalesce(pg_catalog.array_agg(
           coalesce(role_row.rolname, 'PUBLIC') || ':' ||
           acl.privilege_type || ':' || acl.is_grantable::text
           order by acl.grantee, acl.privilege_type
         ), array[]::text[])
    into v_acl_entries
  from pg_catalog.pg_proc function_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      function_row.proacl,
      pg_catalog.acldefault('f', function_row.proowner)
    )
  ) acl
  left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
  where function_row.oid = v_function_oid
    and acl.grantee <> function_row.proowner;
  if v_acl_entries is distinct from array[]::text[] then
    raise exception 'agent_mcp_evidence_prune_acl_failed';
  end if;
end;
$postflight$;

commit;
