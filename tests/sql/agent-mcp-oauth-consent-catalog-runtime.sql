-- Runtime contract for immutable MCP OAuth consent snapshots and DCR ceilings.
--
-- Run only against an isolated PostgreSQL 17 fixture after the OAuth
-- authorization-server migration, one pre-versioning client/code/grant seed,
-- and 20260823072837_mcp_oauth_consent_catalog_versioning.sql have been
-- applied. Every mutation below is rolled back.

\set ON_ERROR_STOP on

-- Replay is part of the contract. A second apply must preserve existing
-- scope bytes and recreate only the reviewed function/trigger definitions.
\ir ../../supabase/migrations/20260823072837_mcp_oauth_consent_catalog_versioning.sql

begin;

do $assert$
declare
  v_role text;
  v_signature text;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'runtime_requires_postgresql_17';
  end if;

  if (
    select client.scope
    from private.mcp_oauth_clients client
    where client.client_id = '11111111-1111-4111-8111-111111111111'
  ) is distinct from 'ops.jobs.read ops.schedule.read' then
    raise exception 'existing_client_scope_bytes_changed';
  end if;

  if (
    select client.scope_ceiling
    from private.mcp_oauth_clients client
    where client.client_id = '11111111-1111-4111-8111-111111111111'
  ) is distinct from array['ops.jobs.read', 'ops.schedule.read']::text[] then
    raise exception 'existing_client_ceiling_backfill_mismatch';
  end if;

  if exists (
    select 1
    from private.mcp_oauth_clients client
    where client.client_id = '11111111-1111-4111-8111-111111111111'
      and (
        client.consent_catalog_revision is distinct from
          '2026-08-22.mcp-consent-catalog.v1'
        or client.exposure_revision is distinct from
          '2026-08-22.mcp-exposure.v1'
      )
  ) then
    raise exception 'existing_client_revision_backfill_mismatch';
  end if;

  if exists (
    select 1
    from private.mcp_oauth_authorization_codes code
    where code.code_hash = repeat('a', 64)
      and (
        code.scopes is distinct from array['ops.jobs.read']::text[]
        or code.accepted_labels is distinct from
          array['See your jobs and their status']::text[]
        or code.consent_catalog_revision is distinct from
          '2026-08-22.mcp-consent-catalog.v1'
        or code.exposure_revision is distinct from
          '2026-08-22.mcp-exposure.v1'
      )
  ) then
    raise exception 'existing_code_consent_backfill_mismatch';
  end if;

  if exists (
    select 1
    from private.mcp_oauth_grants grant_row
    where grant_row.id = '44444444-4444-4444-8444-444444444444'
      and (
        grant_row.scopes is distinct from
          array['ops.jobs.read', 'ops.schedule.read']::text[]
        or grant_row.accepted_labels is distinct from array[
          'See your jobs and their status',
          'See your schedule and who''s assigned'
        ]::text[]
        or grant_row.revision is distinct from
          '0123456789abcdef0123456789abcdef'
        or grant_row.consent_catalog_revision is distinct from
          '2026-08-22.mcp-consent-catalog.v1'
        or grant_row.exposure_revision is distinct from
          '2026-08-22.mcp-exposure.v1'
      )
  ) then
    raise exception 'existing_grant_consent_backfill_mismatch';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(
      v_role,
      'private.mcp_oauth_clients',
      'select,insert,update,delete'
    ) or has_table_privilege(
      v_role,
      'private.mcp_oauth_authorization_codes',
      'select,insert,update,delete'
    ) or has_table_privilege(
      v_role,
      'private.mcp_oauth_grants',
      'select,insert,update,delete'
    ) or has_table_privilege(
      v_role,
      'private.mcp_oauth_tokens',
      'select,insert,update,delete'
    ) or has_table_privilege(
      v_role,
      'private.mcp_oauth_consent_previews',
      'select,insert,update,delete'
    ) then
      raise exception 'application_role_has_oauth_table_access:%', v_role;
    end if;

    foreach v_signature in array array[
      'private.mcp_oauth_scope_array(text)',
      'private.mcp_oauth_scope_array_is_valid(text[])',
      'private.mcp_oauth_labels_for_scopes(text[],text)',
      'private.enforce_mcp_oauth_consent_immutability()'
    ] loop
      if has_function_privilege(v_role, v_signature, 'execute') then
        raise exception 'application_role_has_oauth_helper_access:%:%',
          v_role,
          v_signature;
      end if;
    end loop;
  end loop;

  foreach v_signature in array array[
    'public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)',
    'public.get_mcp_oauth_client_as_system(uuid)',
    'public.issue_mcp_oauth_consent_preview_as_system(text,uuid,uuid,uuid,text,text,text[],text[],text,text,text,text,text,text,timestamp with time zone)',
    'public.consume_mcp_oauth_consent_preview_as_system(text,uuid,uuid)',
    'public.create_mcp_oauth_authorization_code_as_system(text,uuid,uuid,uuid,text[],text[],text,text,text,text,text,timestamp with time zone)',
    'public.consume_mcp_oauth_authorization_code_as_system(text,uuid,text)',
    'public.mint_mcp_oauth_grant_as_system(text,uuid,uuid,uuid,text,text[],text,text,text,text,timestamp with time zone,timestamp with time zone)',
    'public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)',
    'public.resolve_mcp_oauth_access_token_as_system(text)'
  ] loop
    if not has_function_privilege('service_role', v_signature, 'execute')
       or has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'oauth_rpc_acl_mismatch:%', v_signature;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.register_mcp_oauth_client_as_system(text,text[],text,text,text)',
    'public.create_mcp_oauth_authorization_code_as_system(text,uuid,uuid,uuid,text[],text,text,text,timestamp with time zone)',
    'public.mint_mcp_oauth_grant_as_system(text,uuid,uuid,uuid,text[],text,text,text,text,timestamp with time zone,timestamp with time zone)',
    'public.rotate_mcp_oauth_refresh_token_as_system(text,text,text,timestamp with time zone,timestamp with time zone)'
  ] loop
    if to_regprocedure(v_signature) is not null then
      raise exception 'obsolete_oauth_rpc_signature_survived:%', v_signature;
    end if;
  end loop;

  -- PostgreSQL 17 marks ordinary PK, UNIQUE, and FK constraints as
  -- non-inheritable, while an ordinary CHECK remains inheritable. This clean
  -- catalogue assertion keeps the static postflight snapshot source-backed.
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = any (array[
      'private.mcp_oauth_clients'::regclass,
      'private.mcp_oauth_authorization_codes'::regclass,
      'private.mcp_oauth_grants'::regclass,
      'private.mcp_oauth_tokens'::regclass,
      'private.mcp_oauth_consent_previews'::regclass
    ]::oid[])
      and constraint_row.connoinherit is distinct from case
        when constraint_row.contype in (
          'p'::"char",
          'u'::"char",
          'f'::"char"
        ) then true
        when constraint_row.contype = 'c'::"char" then false
        else null
      end
  ) then
    raise exception 'postgresql17_connoinherit_clean_catalog_mismatch';
  end if;
end;
$assert$;

set local request.jwt.claim.role = 'service_role';

-- Adversarial catalogue mutations prove the closed-world replay predicates
-- notice both extra/missing triggers and same-name IF NOT EXISTS / CREATE OR
-- REPLACE drift. Every object is restored before behavior tests continue.
create trigger mcp_oauth_runtime_unexpected_trigger
before update on private.mcp_oauth_tokens
for each row execute function private.enforce_mcp_oauth_consent_immutability();

do $unexpected_trigger_collision$
begin
  if (
    select coalesce(
      array_agg(trigger_row.tgname order by trigger_row.tgname),
      array[]::text[]
    )
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
        'private.mcp_oauth_tokens'::regclass
      and not trigger_row.tgisinternal
  ) is not distinct from array[]::text[] then
    raise exception 'unexpected_oauth_trigger_collision_survived';
  end if;
end;
$unexpected_trigger_collision$;

drop trigger mcp_oauth_runtime_unexpected_trigger
  on private.mcp_oauth_tokens;

drop trigger mcp_oauth_clients_immutable_ceiling
  on private.mcp_oauth_clients;

do $missing_trigger_collision$
begin
  if (
    select coalesce(
      array_agg(trigger_row.tgname order by trigger_row.tgname),
      array[]::text[]
    )
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
        'private.mcp_oauth_clients'::regclass
      and not trigger_row.tgisinternal
  ) is not distinct from
      array['mcp_oauth_clients_immutable_ceiling']::text[] then
    raise exception 'missing_oauth_trigger_collision_survived';
  end if;
end;
$missing_trigger_collision$;

create trigger mcp_oauth_clients_immutable_ceiling
before update on private.mcp_oauth_clients
for each row execute function private.enforce_mcp_oauth_consent_immutability();

drop index private.mcp_oauth_consent_previews_binding_expiry_idx;
create index mcp_oauth_consent_previews_binding_expiry_idx
  on private.mcp_oauth_consent_previews (company_id, expires_at);

do $if_not_exists_collision$
begin
  if (
    select array(
      select pg_catalog.pg_get_indexdef(
        index_row.indexrelid,
        key_number,
        true
      )
      from pg_catalog.generate_series(
        1,
        index_row.indnkeyatts::integer
      ) key_number
      order by key_number
    )
    from pg_catalog.pg_index index_row
    where index_row.indexrelid =
        'private.mcp_oauth_consent_previews_binding_expiry_idx'::regclass
  ) is not distinct from
      array['user_id', 'company_id', 'expires_at', 'preview_hash']::text[] then
    raise exception 'legacy_if_not_exists_collision_detected';
  end if;
end;
$if_not_exists_collision$;

drop index private.mcp_oauth_consent_previews_binding_expiry_idx;
create index mcp_oauth_consent_previews_binding_expiry_idx
  on private.mcp_oauth_consent_previews (
    user_id,
    company_id,
    expires_at,
    preview_hash
  );

alter function private.mcp_oauth_scope_array(text) parallel safe;
do $create_or_replace_collision$
begin
  if (
    select function_row.proparallel
    from pg_catalog.pg_proc function_row
    where function_row.oid =
        'private.mcp_oauth_scope_array(text)'::regprocedure
  ) is not distinct from 'u'::"char" then
    raise exception 'legacy_create_or_replace_collision_detected';
  end if;
end;
$create_or_replace_collision$;
alter function private.mcp_oauth_scope_array(text) parallel unsafe;

grant select (client_name)
  on private.mcp_oauth_clients to authenticated;
do $column_acl_collision$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    cross join lateral pg_catalog.aclexplode(
      coalesce(attribute.attacl, array[]::aclitem[])
    ) acl
    where attribute.attrelid = 'private.mcp_oauth_clients'::regclass
      and attribute.attname = 'client_name'
      and acl.grantee = 'authenticated'::regrole
      and acl.privilege_type = 'SELECT'
  ) then
    raise exception 'legacy_column_acl_collision_survived';
  end if;
end;
$column_acl_collision$;
revoke all privileges (client_name)
  on private.mcp_oauth_clients from authenticated;

create table private.mcp_oauth_runtime_inheritance_child ()
inherits (private.mcp_oauth_clients);
do $inheritance_parent_collision$
begin
  if not exists (
    select 1
    from pg_catalog.pg_inherits inheritance_row
    where inheritance_row.inhparent =
        'private.mcp_oauth_clients'::regclass
      and inheritance_row.inhrelid =
        'private.mcp_oauth_runtime_inheritance_child'::regclass
  ) then
    raise exception 'oauth_inheritance_parent_collision_survived';
  end if;
end;
$inheritance_parent_collision$;
drop table private.mcp_oauth_runtime_inheritance_child;

create table private.mcp_oauth_runtime_inheritance_parent (
  kind text,
  constraint mcp_oauth_runtime_inherited_kind check (kind <> '')
);
alter table private.mcp_oauth_tokens
  add constraint mcp_oauth_runtime_inherited_kind check (kind <> '');
alter table private.mcp_oauth_tokens
  inherit private.mcp_oauth_runtime_inheritance_parent;
do $inheritance_child_collision$
begin
  if not exists (
    select 1
    from pg_catalog.pg_inherits inheritance_row
    where inheritance_row.inhrelid = 'private.mcp_oauth_tokens'::regclass
      and inheritance_row.inhparent =
        'private.mcp_oauth_runtime_inheritance_parent'::regclass
  ) then
    raise exception 'oauth_inheritance_child_collision_survived';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'private.mcp_oauth_tokens'::regclass
      and constraint_row.conname = 'mcp_oauth_runtime_inherited_kind'
      and (
        not constraint_row.conislocal
        or constraint_row.coninhcount <> 0
      )
  ) then
    raise exception 'inherited_constraint_collision_survived';
  end if;
end;
$inheritance_child_collision$;
alter table private.mcp_oauth_tokens
  no inherit private.mcp_oauth_runtime_inheritance_parent;
alter table private.mcp_oauth_tokens
  drop constraint mcp_oauth_runtime_inherited_kind;
drop table private.mcp_oauth_runtime_inheritance_parent;

alter table private.mcp_oauth_tokens
  drop constraint mcp_oauth_tokens_kind;
alter table private.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_kind check (
    kind in ('access', 'refresh')
  ) not valid;
do $not_valid_constraint_collision$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'private.mcp_oauth_tokens'::regclass
      and constraint_row.conname = 'mcp_oauth_tokens_kind'
      and not constraint_row.convalidated
  ) then
    raise exception 'not_valid_constraint_collision_survived';
  end if;
end;
$not_valid_constraint_collision$;
alter table private.mcp_oauth_tokens
  drop constraint mcp_oauth_tokens_kind;
alter table private.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_kind check (
    kind in ('access', 'refresh')
  );

alter table private.mcp_oauth_tokens
  drop constraint mcp_oauth_tokens_grant_id_fkey;
alter table private.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_grant_id_fkey foreign key (grant_id)
  references private.mcp_oauth_grants (id)
  deferrable initially deferred;
do $deferrable_constraint_collision$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'private.mcp_oauth_tokens'::regclass
      and constraint_row.conname = 'mcp_oauth_tokens_grant_id_fkey'
      and constraint_row.condeferrable
      and constraint_row.condeferred
  ) then
    raise exception 'deferrable_constraint_collision_survived';
  end if;
end;
$deferrable_constraint_collision$;
alter table private.mcp_oauth_tokens
  drop constraint mcp_oauth_tokens_grant_id_fkey;
alter table private.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_grant_id_fkey foreign key (grant_id)
  references private.mcp_oauth_grants (id);

alter table private.mcp_oauth_tokens
  drop constraint mcp_oauth_tokens_kind;
alter table private.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_kind check (
    kind in ('access', 'refresh')
  ) no inherit;
do $no_inherit_constraint_collision$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'private.mcp_oauth_tokens'::regclass
      and constraint_row.conname = 'mcp_oauth_tokens_kind'
      and constraint_row.connoinherit
  ) then
    raise exception 'no_inherit_constraint_collision_survived';
  end if;
end;
$no_inherit_constraint_collision$;
alter table private.mcp_oauth_tokens
  drop constraint mcp_oauth_tokens_kind;
alter table private.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_kind check (
    kind in ('access', 'refresh')
  );

create table private.mcp_oauth_runtime_incoming_fk (
  id uuid primary key,
  client_id uuid,
  grant_id uuid,
  constraint mcp_oauth_runtime_client_fk foreign key (client_id)
    references private.mcp_oauth_clients (client_id) on delete cascade,
  constraint mcp_oauth_runtime_grant_fk foreign key (grant_id)
    references private.mcp_oauth_grants (id) on delete restrict
);
do $incoming_fk_collision$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'mcp_oauth_runtime_client_fk'
      and constraint_row.confrelid = 'private.mcp_oauth_clients'::regclass
      and constraint_row.confdeltype = 'c'::"char"
  ) then
    raise exception 'incoming_fk_cascade_collision_survived';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'mcp_oauth_runtime_grant_fk'
      and constraint_row.confrelid = 'private.mcp_oauth_grants'::regclass
      and constraint_row.confdeltype = 'r'::"char"
  ) then
    raise exception 'incoming_fk_restrict_collision_survived';
  end if;
end;
$incoming_fk_collision$;
drop table private.mcp_oauth_runtime_incoming_fk;

-- SQL recognizes the registered read vocabulary, while the caller-provided
-- exposure revision remains the authority for whether it may be registered.
create temporary table runtime_future_client on commit drop as
select *
from public.register_mcp_oauth_client_as_system(
  'Runtime future client',
  array['https://claude.ai/api/mcp/auth_callback'],
  'ops.tasks.read',
  array['ops.tasks.read'],
  '2026-08-22.mcp-consent-catalog.v1',
  'test.mcp-exposure.v2',
  null,
  null
);

create temporary table runtime_v1_client on commit drop as
select *
from public.register_mcp_oauth_client_as_system(
  'Runtime v1 client',
  array['https://claude.ai/api/mcp/auth_callback'],
  'ops.jobs.read',
  array['ops.jobs.read'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  null,
  null
);

-- Seed 513 expired rows, then prove request-path cleanup catches up through
-- exactly eight ordered 64-row batches while remaining bounded. Consumed
-- rows are retained only until expiry and never need an unindexed predicate.
insert into private.mcp_oauth_consent_previews (
  preview_hash,
  client_id,
  user_id,
  company_id,
  client_name,
  company_name,
  redirect_uri,
  response_type,
  scopes,
  accepted_labels,
  consent_catalog_revision,
  exposure_revision,
  state,
  code_challenge,
  code_challenge_method,
  resource,
  expires_at,
  created_at
)
select lpad(to_hex(source.ordinality), 64, '0'),
       (select client_id from runtime_v1_client),
       '22222222-2222-4222-8222-222222222222'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid,
       'Runtime v1 client',
       'Runtime company',
       'https://claude.ai/api/mcp/auth_callback',
       'code',
       array['ops.jobs.read'],
       array['See your jobs and their status'],
       '2026-08-22.mcp-consent-catalog.v1',
       '2026-08-22.mcp-exposure.v1',
       null,
       'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
       'S256',
       'https://app.opsapp.co/api/mcp',
       statement_timestamp() - interval '5 minutes',
       statement_timestamp() - interval '10 minutes'
from generate_series(1, 513) source(ordinality);

create temporary table runtime_issued_preview on commit drop as
select *
from public.issue_mcp_oauth_consent_preview_as_system(
  repeat('7', 64),
  (select client_id from runtime_v1_client),
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'https://claude.ai/api/mcp/auth_callback',
  'code',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  'runtime-state',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'S256',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '4 minutes'
);

create temporary table runtime_stale_preview on commit drop as
select *
from public.issue_mcp_oauth_consent_preview_as_system(
  repeat('8', 64),
  (select client_id from runtime_v1_client),
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'https://claude.ai/api/mcp/auth_callback',
  'code',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  'test.mcp-exposure.v2',
  'runtime-state',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'S256',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '4 minutes'
);

do $preview_assert$
begin
  if (select count(*) from runtime_issued_preview) <> 1
     or (
       select issued.rate_limited
       from runtime_issued_preview issued
     ) is distinct from false
     or (select count(*) from runtime_stale_preview) <> 0
     or (
       select count(*)
       from private.mcp_oauth_consent_previews preview
       where preview.expires_at <= statement_timestamp()
     ) <> 1 then
    raise exception 'consent_preview_issue_or_bounded_cleanup_mismatch';
  end if;

  begin
    update private.mcp_oauth_consent_previews
    set state = 'tampered'
    where preview_hash = repeat('7', 64);
    raise exception 'consent_preview_snapshot_update_unexpectedly_allowed';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'mcp_oauth_consent_preview_immutable' then
        raise exception 'consent_preview_snapshot_update_wrong_error:%',
          sqlerrm;
      end if;
  end;
end;
$preview_assert$;

-- Fill the actor/company binding to its durable live ceiling. The next issue
-- returns a rate-limited row and must not insert the presented preview hash.
insert into private.mcp_oauth_consent_previews (
  preview_hash,
  client_id,
  user_id,
  company_id,
  client_name,
  company_name,
  redirect_uri,
  response_type,
  scopes,
  accepted_labels,
  consent_catalog_revision,
  exposure_revision,
  state,
  code_challenge,
  code_challenge_method,
  resource,
  expires_at
)
select lpad(to_hex(100000 + source.ordinality), 64, '0'),
       (select client_id from runtime_v1_client),
       '22222222-2222-4222-8222-222222222222'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid,
       'Runtime v1 client',
       'Runtime company',
       'https://claude.ai/api/mcp/auth_callback',
       'code',
       array['ops.jobs.read'],
       array['See your jobs and their status'],
       '2026-08-22.mcp-consent-catalog.v1',
       '2026-08-22.mcp-exposure.v1',
       null,
       'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
       'S256',
       'https://app.opsapp.co/api/mcp',
       statement_timestamp() + interval '4 minutes'
from generate_series(1, 29) source(ordinality);

create temporary table runtime_binding_rate_limited on commit drop as
select *
from public.issue_mcp_oauth_consent_preview_as_system(
  repeat('9', 64),
  (select client_id from runtime_v1_client),
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'https://claude.ai/api/mcp/auth_callback',
  'code',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  null,
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'S256',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '4 minutes'
);

do $binding_ceiling_assert$
begin
  if (select count(*) from runtime_binding_rate_limited) <> 1
     or (
       select limited.rate_limited
       from runtime_binding_rate_limited limited
     ) is distinct from true
     or exists (
       select 1
       from private.mcp_oauth_consent_previews preview
       where preview.preview_hash = repeat('9', 64)
     ) then
    raise exception 'durable_binding_preview_ceiling_failed';
  end if;
end;
$binding_ceiling_assert$;

delete from private.mcp_oauth_consent_previews preview
where preview.preview_hash in (
  select lpad(to_hex(100000 + source.ordinality), 64, '0')
  from generate_series(1, 29) source(ordinality)
);

-- The same fixed advisory-lock boundary also enforces a hard global live-row
-- cap, independent of binding. This is the cardinality backstop that makes
-- concurrent request floods unable to grow the table without bound.
insert into private.mcp_oauth_consent_previews (
  preview_hash,
  client_id,
  user_id,
  company_id,
  client_name,
  company_name,
  redirect_uri,
  response_type,
  scopes,
  accepted_labels,
  consent_catalog_revision,
  exposure_revision,
  state,
  code_challenge,
  code_challenge_method,
  resource,
  expires_at
)
select lpad(to_hex(200000 + source.ordinality), 64, '0'),
       (select client_id from runtime_v1_client),
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
       'Runtime v1 client',
       'Runtime company',
       'https://claude.ai/api/mcp/auth_callback',
       'code',
       array['ops.jobs.read'],
       array['See your jobs and their status'],
       '2026-08-22.mcp-consent-catalog.v1',
       '2026-08-22.mcp-exposure.v1',
       null,
       'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
       'S256',
       'https://app.opsapp.co/api/mcp',
       statement_timestamp() + interval '4 minutes'
from generate_series(1, 4095) source(ordinality);

create temporary table runtime_global_rate_limited on commit drop as
select *
from public.issue_mcp_oauth_consent_preview_as_system(
  repeat('6', 64),
  (select client_id from runtime_v1_client),
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'https://claude.ai/api/mcp/auth_callback',
  'code',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  null,
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'S256',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '4 minutes'
);

do $global_ceiling_assert$
begin
  if (select count(*) from runtime_global_rate_limited) <> 1
     or (
       select limited.rate_limited
       from runtime_global_rate_limited limited
     ) is distinct from true
     or exists (
       select 1
       from private.mcp_oauth_consent_previews preview
       where preview.preview_hash = repeat('6', 64)
     ) then
    raise exception 'durable_global_preview_ceiling_failed';
  end if;
end;
$global_ceiling_assert$;

delete from private.mcp_oauth_consent_previews preview
where preview.preview_hash in (
  select lpad(to_hex(200000 + source.ordinality), 64, '0')
  from generate_series(1, 4095) source(ordinality)
);

create temporary table runtime_consumed_preview on commit drop as
select *
from public.consume_mcp_oauth_consent_preview_as_system(
  repeat('7', 64),
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
);

create temporary table runtime_replayed_preview on commit drop as
select *
from public.consume_mcp_oauth_consent_preview_as_system(
  repeat('7', 64),
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
);

do $preview_consume_assert$
begin
  if (select count(*) from runtime_consumed_preview) <> 1
     or (select count(*) from runtime_replayed_preview) <> 0
     or (
       select consumed.scopes
       from runtime_consumed_preview consumed
     ) is distinct from array['ops.jobs.read']::text[]
     or (
       select consumed.state
       from runtime_consumed_preview consumed
     ) is distinct from 'runtime-state' then
    raise exception 'consent_preview_one_time_snapshot_mismatch';
  end if;
end;
$preview_consume_assert$;

do $assert$
begin
  if (
    select future.scope_ceiling
    from runtime_future_client future
  ) is distinct from array['ops.tasks.read']::text[] then
    raise exception 'fresh_dcr_ceiling_mismatch';
  end if;

  if (
    select future.exposure_revision
    from runtime_future_client future
  ) is distinct from 'test.mcp-exposure.v2' then
    raise exception 'fresh_dcr_exposure_revision_mismatch';
  end if;

  begin
    perform public.create_mcp_oauth_authorization_code_as_system(
      repeat('c', 64),
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      array['ops.tasks.read'],
      array['See tasks and work that needs attention'],
      '2026-08-22.mcp-consent-catalog.v1',
      'test.mcp-exposure.v2',
      'https://claude.ai/api/mcp/auth_callback',
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      'https://app.opsapp.co/api/mcp',
      statement_timestamp() + interval '5 minutes'
    );
    raise exception 'old_client_new_scope_unexpectedly_allowed';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'mcp_oauth_client_unavailable' then
        raise exception 'old_client_new_scope_wrong_error:%', sqlerrm;
      end if;
  end;

  begin
    update private.mcp_oauth_clients
    set scope = 'ops.jobs.read ops.schedule.read',
        scope_ceiling = array['ops.jobs.read', 'ops.schedule.read']
    where client_id = (select client_id from runtime_v1_client);
    raise exception 'client_ceiling_update_unexpectedly_allowed';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'mcp_oauth_client_authority_immutable' then
        raise exception 'client_ceiling_update_wrong_error:%', sqlerrm;
      end if;
  end;
end;
$assert$;

select public.create_mcp_oauth_authorization_code_as_system(
  repeat('d', 64),
  (select client_id from runtime_v1_client),
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  'https://claude.ai/api/mcp/auth_callback',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '5 minutes'
);

do $assert$
begin
  begin
    update private.mcp_oauth_authorization_codes
    set accepted_labels = array['See your schedule and who''s assigned']
    where code_hash = repeat('d', 64);
    raise exception 'code_consent_update_unexpectedly_allowed';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'mcp_oauth_code_consent_immutable' then
        raise exception 'code_consent_update_wrong_error:%', sqlerrm;
      end if;
  end;
end;
$assert$;

create temporary table runtime_consumed_code on commit drop as
select *
from public.consume_mcp_oauth_authorization_code_as_system(
  repeat('d', 64),
  (select client_id from runtime_v1_client),
  'https://claude.ai/api/mcp/auth_callback'
);

do $assert$
begin
  if (select count(*) from runtime_consumed_code) <> 1
     or (
       select consumed.scopes
       from runtime_consumed_code consumed
     ) is distinct from array['ops.jobs.read']::text[]
     or (
       select consumed.accepted_labels
       from runtime_consumed_code consumed
     ) is distinct from array['See your jobs and their status']::text[] then
    raise exception 'consumed_code_snapshot_mismatch';
  end if;
end;
$assert$;

create temporary table runtime_minted_grant on commit drop as
select *
from public.mint_mcp_oauth_grant_as_system(
  repeat('d', 64),
  (select client_id from runtime_v1_client),
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '2026-08-22.mcp-exposure.v1',
  array[
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.customers.read',
    'ops.customer_contacts.read',
    'ops.photos.read',
    'ops.correspondence.read',
    'ops.financials.read'
  ],
  repeat('e', 64),
  repeat('f', 64),
  'https://app.opsapp.co',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '30 days'
);

do $assert$
declare
  v_grant_id uuid := (select grant_id from runtime_minted_grant);
begin
  if (select count(*) from runtime_minted_grant) <> 1 then
    raise exception 'grant_mint_result_missing';
  end if;

  if exists (
    select 1
    from private.mcp_oauth_grants grant_row
    where grant_row.id = v_grant_id
      and (
        grant_row.scopes is distinct from array['ops.jobs.read']::text[]
        or grant_row.accepted_labels is distinct from
          array['See your jobs and their status']::text[]
        or grant_row.consent_catalog_revision is distinct from
          '2026-08-22.mcp-consent-catalog.v1'
        or grant_row.exposure_revision is distinct from
          '2026-08-22.mcp-exposure.v1'
      )
  ) then
    raise exception 'grant_did_not_copy_code_snapshot';
  end if;

  if (
    select code.minted_grant_id
    from private.mcp_oauth_authorization_codes code
    where code.code_hash = repeat('d', 64)
  ) is distinct from v_grant_id then
    raise exception 'code_minted_grant_link_mismatch';
  end if;

  begin
    update private.mcp_oauth_grants
    set scopes = array['ops.schedule.read'],
        accepted_labels = array['See your schedule and who''s assigned']
    where id = v_grant_id;
    raise exception 'grant_consent_update_unexpectedly_allowed';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'mcp_oauth_grant_consent_immutable' then
        raise exception 'grant_consent_update_wrong_error:%', sqlerrm;
      end if;
  end;

  if exists (
    select 1
    from private.mcp_oauth_grants existing_grant
    where existing_grant.id = '44444444-4444-4444-8444-444444444444'
      and (
        existing_grant.scopes is distinct from
          array['ops.jobs.read', 'ops.schedule.read']::text[]
        or existing_grant.revision is distinct from
          '0123456789abcdef0123456789abcdef'
        or existing_grant.revoked_at is not null
      )
  ) then
    raise exception 'existing_grant_changed_during_new_client_mint';
  end if;
end;
$assert$;

create temporary table runtime_rotated_grant on commit drop as
select *
from public.rotate_mcp_oauth_refresh_token_as_system(
  repeat('f', 64),
  (select client_id from runtime_v1_client),
  array[
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.customers.read',
    'ops.customer_contacts.read',
    'ops.photos.read',
    'ops.correspondence.read',
    'ops.financials.read'
  ],
  repeat('1', 64),
  repeat('2', 64),
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '30 days'
);

do $assert$
begin
  if (select count(*) from runtime_rotated_grant) <> 1
     or (
       select rotated.scopes
       from runtime_rotated_grant rotated
     ) is distinct from array['ops.jobs.read']::text[]
     or (
       select rotated.accepted_labels
       from runtime_rotated_grant rotated
     ) is distinct from array['See your jobs and their status']::text[]
     or (
       select rotated.reuse_detected
       from runtime_rotated_grant rotated
     ) is distinct from false then
    raise exception 'refresh_rotation_snapshot_mismatch';
  end if;
end;
$assert$;

-- Removing the grant's only scope from the active exposure returns no row and
-- leaves the presented refresh token untouched. Refresh can never widen or
-- silently narrow an existing grant.
create temporary table runtime_rejected_rotation on commit drop as
select *
from public.rotate_mcp_oauth_refresh_token_as_system(
  repeat('2', 64),
  (select client_id from runtime_v1_client),
  array['ops.schedule.read'],
  repeat('3', 64),
  repeat('4', 64),
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '30 days'
);

do $assert$
begin
  if (select count(*) from runtime_rejected_rotation) <> 0 then
    raise exception 'refresh_outside_active_exposure_unexpectedly_rotated';
  end if;

  if exists (
    select 1
    from private.mcp_oauth_tokens token
    where token.token_hash = repeat('2', 64)
      and (token.used_at is not null or token.rotated_to_hash is not null)
  ) then
    raise exception 'rejected_refresh_token_was_mutated';
  end if;
end;
$assert$;

create temporary table runtime_resolved_access on commit drop as
select *
from public.resolve_mcp_oauth_access_token_as_system(repeat('1', 64));

do $assert$
begin
  if (select count(*) from runtime_resolved_access) <> 1
     or (
       select resolved.scopes
       from runtime_resolved_access resolved
     ) is distinct from array['ops.jobs.read']::text[]
     or (
       select resolved.accepted_labels
       from runtime_resolved_access resolved
     ) is distinct from array['See your jobs and their status']::text[] then
    raise exception 'access_resolution_snapshot_mismatch';
  end if;
end;
$assert$;

rollback;
