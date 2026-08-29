-- Runtime contract for strict Codex native DCR loopback callbacks.
--
-- Run only against an isolated PostgreSQL 17 fixture after
-- 20260829192448_mcp_oauth_codex_dcr_callbacks.sql. Every data mutation is
-- rolled back. Reapplying the migration here is the idempotence proof.

\set ON_ERROR_STOP on

\ir ../../supabase/migrations/20260829192448_mcp_oauth_codex_dcr_callbacks.sql

begin;

set local request.jwt.claim.role = 'service_role';

insert into public.companies (id, name) values (
  'cd000000-0000-4000-8000-000000000001',
  'Codex OAuth runtime company'
);
insert into public.users (id, company_id, first_name, last_name, email) values (
  'cd000000-0000-4000-8000-000000000002',
  'cd000000-0000-4000-8000-000000000001',
  'Codex',
  'Operator',
  'codex-oauth@example.test'
);

create temporary table runtime_codex_client on commit drop as
select *
from public.register_mcp_oauth_client_as_system(
  'Codex',
  array['http://127.0.0.1:51759/callback/lwaKvnR9ZEom'],
  'ops.jobs.read',
  array['ops.jobs.read'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  null,
  null
);

create temporary table runtime_codex_port_boundaries on commit drop as
select *
from public.register_mcp_oauth_client_as_system(
  'Codex port one',
  array['http://127.0.0.1:1/callback/abcdefgh'],
  'ops.jobs.read',
  array['ops.jobs.read'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  null,
  null
)
union all
select *
from public.register_mcp_oauth_client_as_system(
  'Codex port max',
  array['http://127.0.0.1:65535/callback/abcdefgh'],
  'ops.jobs.read',
  array['ops.jobs.read'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  null,
  null
);

do $codex_registration_assert$
begin
  if (select count(*) from runtime_codex_client) <> 1
     or (
       select redirect_uris
       from runtime_codex_client
     ) is distinct from array[
       'http://127.0.0.1:51759/callback/lwaKvnR9ZEom'
     ]::text[]
     or (select count(*) from runtime_codex_port_boundaries) <> 2 then
    raise exception 'codex_callback_registration_or_storage_mismatch';
  end if;
end;
$codex_registration_assert$;

do $codex_registration_rejections$
declare
  v_uri text;
begin
  foreach v_uri in array array[
    'https://evil.example/callback',
    'https://127.0.0.1:51759/callback/lwaKvnR9ZEom',
    'http://localhost:51759/callback/lwaKvnR9ZEom',
    'http://127.1:51759/callback/lwaKvnR9ZEom',
    'http://2130706433:51759/callback/lwaKvnR9ZEom',
    'http://127.0.0.1:0/callback/lwaKvnR9ZEom',
    'http://127.0.0.1:65536/callback/lwaKvnR9ZEom',
    'http://127.0.0.1:05175/callback/lwaKvnR9ZEom',
    'http://127.0.0.1:51759/callback/short',
    'http://127.0.0.1:51759/callback/lwaKvnR9.ZEom',
    'http://127.0.0.1:51759/%63allback/lwaKvnR9ZEom',
    'http://%31%32%37.0.0.1:51759/callback/lwaKvnR9ZEom',
    'http://１２７.0.0.1:51759/callback/lwaKvnR9ZEom',
    'http://127。0。0。1:51759/callback/lwaKvnR9ZEom',
    'http://127.0.0.1:51759/callback/lwaKvnR9ZÉom',
    'http://127.0.0.1:51759/callback/lwaKvnR9ZEom?next=evil',
    'http://127.0.0.1:51759/callback/lwaKvnR9ZEom#fragment',
    'http://user@127.0.0.1:51759/callback/lwaKvnR9ZEom'
  ]::text[] loop
    begin
      perform public.register_mcp_oauth_client_as_system(
        'Rejected callback',
        array[v_uri],
        'ops.jobs.read',
        array['ops.jobs.read'],
        '2026-08-22.mcp-consent-catalog.v1',
        '2026-08-22.mcp-exposure.v1',
        null,
        null
      );
      raise exception 'unsafe_codex_callback_unexpectedly_registered:%',
        v_uri;
    exception
      when sqlstate '22023' then
        if sqlerrm is distinct from 'mcp_oauth_redirect_uri_invalid' then
          raise exception 'unsafe_codex_callback_wrong_error:%:%',
            v_uri,
            sqlerrm;
        end if;
    end;
  end loop;

  begin
    perform public.register_mcp_oauth_client_as_system(
      'Mixed callback families',
      array[
        'https://claude.ai/api/mcp/auth_callback',
        'http://127.0.0.1:51759/callback/lwaKvnR9ZEom'
      ],
      'ops.jobs.read',
      array['ops.jobs.read'],
      '2026-08-22.mcp-consent-catalog.v1',
      '2026-08-22.mcp-exposure.v1',
      null,
      null
    );
    raise exception 'mixed_callback_families_unexpectedly_registered';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'mcp_oauth_redirect_uri_invalid' then
        raise exception 'mixed_callback_families_wrong_error:%', sqlerrm;
      end if;
  end;

  begin
    perform public.register_mcp_oauth_client_as_system(
      'Multiple Codex callbacks',
      array[
        'http://127.0.0.1:51759/callback/lwaKvnR9ZEom',
        'http://127.0.0.1:51760/callback/anotherCodexId'
      ],
      'ops.jobs.read',
      array['ops.jobs.read'],
      '2026-08-22.mcp-consent-catalog.v1',
      '2026-08-22.mcp-exposure.v1',
      null,
      null
    );
    raise exception 'multiple_codex_callbacks_unexpectedly_registered';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'mcp_oauth_redirect_uri_invalid' then
        raise exception 'multiple_codex_callbacks_wrong_error:%', sqlerrm;
      end if;
  end;
end;
$codex_registration_rejections$;

create temporary table runtime_codex_preview on commit drop as
select *
from public.issue_mcp_oauth_consent_preview_as_system(
  repeat('a', 64),
  (select client_id from runtime_codex_client),
  'cd000000-0000-4000-8000-000000000002',
  'cd000000-0000-4000-8000-000000000001',
  'http://127.0.0.1:51759/callback/lwaKvnR9ZEom',
  'code',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  'codex-state',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'S256',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '4 minutes'
);

create temporary table runtime_codex_wrong_port_preview on commit drop as
select *
from public.issue_mcp_oauth_consent_preview_as_system(
  repeat('b', 64),
  (select client_id from runtime_codex_client),
  'cd000000-0000-4000-8000-000000000002',
  'cd000000-0000-4000-8000-000000000001',
  'http://127.0.0.1:51760/callback/lwaKvnR9ZEom',
  'code',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  'codex-state',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'S256',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '4 minutes'
);

do $codex_preview_assert$
begin
  if (select count(*) from runtime_codex_preview) <> 1
     or (select count(*) from runtime_codex_wrong_port_preview) <> 0 then
    raise exception 'codex_preview_exact_redirect_binding_failed';
  end if;
end;
$codex_preview_assert$;

do $codex_wrong_port_code_assert$
begin
  begin
    perform public.create_mcp_oauth_authorization_code_as_system(
      repeat('c', 64),
      (select client_id from runtime_codex_client),
      'cd000000-0000-4000-8000-000000000002',
      'cd000000-0000-4000-8000-000000000001',
      array['ops.jobs.read'],
      array['See your jobs and their status'],
      '2026-08-22.mcp-consent-catalog.v1',
      '2026-08-22.mcp-exposure.v1',
      'http://127.0.0.1:51760/callback/lwaKvnR9ZEom',
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      'https://app.opsapp.co/api/mcp',
      statement_timestamp() + interval '5 minutes'
    );
    raise exception 'wrong_port_code_unexpectedly_created';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'mcp_oauth_client_unavailable' then
        raise exception 'wrong_port_code_wrong_error:%', sqlerrm;
      end if;
  end;
end;
$codex_wrong_port_code_assert$;

select public.create_mcp_oauth_authorization_code_as_system(
  repeat('d', 64),
  (select client_id from runtime_codex_client),
  'cd000000-0000-4000-8000-000000000002',
  'cd000000-0000-4000-8000-000000000001',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  'http://127.0.0.1:51759/callback/lwaKvnR9ZEom',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '5 minutes'
);

create temporary table runtime_codex_wrong_port_consume on commit drop as
select *
from public.consume_mcp_oauth_authorization_code_as_system(
  repeat('d', 64),
  (select client_id from runtime_codex_client),
  'http://127.0.0.1:51760/callback/lwaKvnR9ZEom'
);

create temporary table runtime_codex_exact_consume on commit drop as
select *
from public.consume_mcp_oauth_authorization_code_as_system(
  repeat('d', 64),
  (select client_id from runtime_codex_client),
  'http://127.0.0.1:51759/callback/lwaKvnR9ZEom'
);

do $codex_code_consume_assert$
begin
  if (select count(*) from runtime_codex_wrong_port_consume) <> 0
     or (select count(*) from runtime_codex_exact_consume) <> 1 then
    raise exception 'codex_code_exact_redirect_binding_failed';
  end if;
end;
$codex_code_consume_assert$;

do $codex_registration_function_contract_assert$
declare
  v_function regprocedure := to_regprocedure(
    'public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)'
  );
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
begin
  if v_function is null then
    raise exception 'codex_registration_function_missing';
  end if;

  select
    procedure.prosecdef,
    procedure.provolatile,
    procedure.proconfig
  into
    v_security_definer,
    v_volatility,
    v_config
  from pg_catalog.pg_proc as procedure
  where procedure.oid = v_function;

  if v_security_definer is distinct from true
     or v_volatility is distinct from 'v'
     or not coalesce(
       v_config @> array[
         'search_path=pg_catalog, public, private, pg_temp'
       ]::text[],
       false
     ) then
    raise exception 'codex_registration_function_metadata_changed';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       v_function,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       v_function,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       v_function,
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_catalog.pg_proc as procedure,
       lateral pg_catalog.aclexplode(procedure.proacl) as privilege
       where procedure.oid = v_function
         and privilege.grantee = 0
         and privilege.privilege_type = 'EXECUTE'
     ) then
    raise exception 'codex_registration_function_privileges_changed';
  end if;
end;
$codex_registration_function_contract_assert$;

rollback;
