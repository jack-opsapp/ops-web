-- Runtime contract for ChatGPT's exact RFC 9207 stable OAuth callback.
--
-- Run only against an isolated PostgreSQL 17 fixture after the full migration
-- wave. Every data mutation is rolled back. Reapplying the migration here is
-- the idempotence proof.

\set ON_ERROR_STOP on

\ir ../../supabase/migrations/20260830113800_mcp_oauth_chatgpt_rfc9207_callback.sql

begin;

set local request.jwt.claim.role = 'service_role';

insert into public.companies (id, name) values (
  'cf000000-0000-4000-8000-000000000001',
  'ChatGPT OAuth runtime company'
);
insert into public.users (id, company_id, first_name, last_name, email) values (
  'cf000000-0000-4000-8000-000000000002',
  'cf000000-0000-4000-8000-000000000001',
  'ChatGPT',
  'Operator',
  'chatgpt-oauth@example.test'
);

create temporary table runtime_chatgpt_client on commit drop as
select *
from public.register_mcp_oauth_client_as_system(
  'ChatGPT',
  array['https://chatgpt.com/connector_platform_oauth_redirect'],
  'ops.jobs.read',
  array['ops.jobs.read'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-29.mcp-exposure.v2',
  null,
  null
);

create temporary table runtime_chatgpt_family_regressions on commit drop as
select *
from public.register_mcp_oauth_client_as_system(
  'Claude regression',
  array[
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback'
  ],
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
  'Codex regression',
  array['http://127.0.0.1:51759/callback/lwaKvnR9ZEom'],
  'ops.jobs.read',
  array['ops.jobs.read'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  null,
  null
);

do $chatgpt_registration_assert$
begin
  if (select count(*) from runtime_chatgpt_client) <> 1
     or (
       select redirect_uris
       from runtime_chatgpt_client
     ) is distinct from array[
       'https://chatgpt.com/connector_platform_oauth_redirect'
     ]::text[]
     or (select count(*) from runtime_chatgpt_family_regressions) <> 2 then
    raise exception 'chatgpt_callback_registration_or_storage_mismatch';
  end if;
end;
$chatgpt_registration_assert$;

do $chatgpt_registration_rejections$
declare
  v_uri text;
begin
  foreach v_uri in array array[
    'https://chatgpt.com/connector/oauth/callback-id',
    'https://chatgpt.com/connector/oauth/*',
    'https://chatgpt.com/connector/oauth/{callback_id}',
    'https://chatgpt.com/connector_platform_oauth_redirect/',
    'https://chatgpt.com/connector_platform_oauth_redirect?next=evil',
    'https://chatgpt.com/connector_platform_oauth_redirect#fragment',
    'https://CHATGPT.COM/connector_platform_oauth_redirect',
    'https://chatgpt.com:443/connector_platform_oauth_redirect',
    'https://user@chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com.evil.example/connector_platform_oauth_redirect',
    'https://chatgpt.com/%63onnector_platform_oauth_redirect'
  ]::text[] loop
    begin
      perform public.register_mcp_oauth_client_as_system(
        'Rejected ChatGPT callback',
        array[v_uri],
        'ops.jobs.read',
        array['ops.jobs.read'],
        '2026-08-22.mcp-consent-catalog.v1',
        '2026-08-29.mcp-exposure.v2',
        null,
        null
      );
      raise exception 'unsafe_chatgpt_callback_unexpectedly_registered:%',
        v_uri;
    exception
      when sqlstate '22023' then
        if sqlerrm is distinct from 'mcp_oauth_redirect_uri_invalid' then
          raise exception 'unsafe_chatgpt_callback_wrong_error:%:%',
            v_uri,
            sqlerrm;
        end if;
    end;
  end loop;

  begin
    perform public.register_mcp_oauth_client_as_system(
      'Mixed Claude and ChatGPT callbacks',
      array[
        'https://claude.ai/api/mcp/auth_callback',
        'https://chatgpt.com/connector_platform_oauth_redirect'
      ],
      'ops.jobs.read',
      array['ops.jobs.read'],
      '2026-08-22.mcp-consent-catalog.v1',
      '2026-08-29.mcp-exposure.v2',
      null,
      null
    );
    raise exception 'mixed_chatgpt_callback_family_unexpectedly_registered';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'mcp_oauth_redirect_uri_invalid' then
        raise exception 'mixed_chatgpt_callback_family_wrong_error:%', sqlerrm;
      end if;
  end;

  begin
    perform public.register_mcp_oauth_client_as_system(
      'Mixed ChatGPT and Codex callbacks',
      array[
        'https://chatgpt.com/connector_platform_oauth_redirect',
        'http://127.0.0.1:51759/callback/lwaKvnR9ZEom'
      ],
      'ops.jobs.read',
      array['ops.jobs.read'],
      '2026-08-22.mcp-consent-catalog.v1',
      '2026-08-29.mcp-exposure.v2',
      null,
      null
    );
    raise exception 'mixed_chatgpt_callback_family_unexpectedly_registered';
  exception
    when sqlstate '22023' then
      if sqlerrm is distinct from 'mcp_oauth_redirect_uri_invalid' then
        raise exception 'mixed_chatgpt_callback_family_wrong_error:%', sqlerrm;
      end if;
  end;
end;
$chatgpt_registration_rejections$;

create temporary table runtime_chatgpt_preview on commit drop as
select *
from public.issue_mcp_oauth_consent_preview_as_system(
  repeat('e', 64),
  (select client_id from runtime_chatgpt_client),
  'cf000000-0000-4000-8000-000000000002',
  'cf000000-0000-4000-8000-000000000001',
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'code',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-29.mcp-exposure.v2',
  'chatgpt-state',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'S256',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '4 minutes'
);

create temporary table runtime_chatgpt_wrong_preview on commit drop as
select *
from public.issue_mcp_oauth_consent_preview_as_system(
  repeat('f', 64),
  (select client_id from runtime_chatgpt_client),
  'cf000000-0000-4000-8000-000000000002',
  'cf000000-0000-4000-8000-000000000001',
  'https://chatgpt.com/connector/oauth/callback-id',
  'code',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-29.mcp-exposure.v2',
  'chatgpt-state',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'S256',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '4 minutes'
);

do $chatgpt_preview_assert$
begin
  if (select count(*) from runtime_chatgpt_preview) <> 1
     or (select count(*) from runtime_chatgpt_wrong_preview) <> 0 then
    raise exception 'chatgpt_preview_exact_redirect_binding_failed';
  end if;
end;
$chatgpt_preview_assert$;

select public.create_mcp_oauth_authorization_code_as_system(
  repeat('1', 64),
  (select client_id from runtime_chatgpt_client),
  'cf000000-0000-4000-8000-000000000002',
  'cf000000-0000-4000-8000-000000000001',
  array['ops.jobs.read'],
  array['See your jobs and their status'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-29.mcp-exposure.v2',
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'https://app.opsapp.co/api/mcp',
  statement_timestamp() + interval '5 minutes'
);

create temporary table runtime_chatgpt_wrong_consume on commit drop as
select *
from public.consume_mcp_oauth_authorization_code_as_system(
  repeat('1', 64),
  (select client_id from runtime_chatgpt_client),
  'https://chatgpt.com/connector/oauth/callback-id'
);

create temporary table runtime_chatgpt_exact_consume on commit drop as
select *
from public.consume_mcp_oauth_authorization_code_as_system(
  repeat('1', 64),
  (select client_id from runtime_chatgpt_client),
  'https://chatgpt.com/connector_platform_oauth_redirect'
);

do $chatgpt_code_consume_assert$
begin
  if (select count(*) from runtime_chatgpt_wrong_consume) <> 0
     or (select count(*) from runtime_chatgpt_exact_consume) <> 1 then
    raise exception 'chatgpt_code_exact_redirect_binding_failed';
  end if;
end;
$chatgpt_code_consume_assert$;

do $chatgpt_registration_function_contract_assert$
declare
  v_function regprocedure := to_regprocedure(
    'public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)'
  );
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
begin
  if v_function is null then
    raise exception 'chatgpt_registration_function_missing';
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
    raise exception 'chatgpt_registration_function_metadata_changed';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
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
    raise exception 'chatgpt_registration_function_privileges_changed';
  end if;
end;
$chatgpt_registration_function_contract_assert$;

rollback;
