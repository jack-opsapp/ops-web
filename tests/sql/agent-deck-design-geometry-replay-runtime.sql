begin;

\set ON_ERROR_STOP on

grant execute on function private.enforce_agent_deck_bridge_company_integrity()
  to pg_monitor with grant option;
grant execute on function private.bump_agent_deck_design_source_revisions()
  to pg_monitor with grant option;
grant execute on function private.agent_p2_deck_geometry_canonical_json(jsonb)
  to pg_monitor with grant option;
grant execute on function private.agent_p2_deck_design_ref(uuid,uuid)
  to pg_monitor with grant option;
grant execute on function private.agent_p2_deck_design_geometry_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,
  uuid,uuid,text,integer
) to pg_monitor with grant option;
grant execute on function public.read_agent_deck_design_geometry_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,
  uuid,uuid,text,integer
) to pg_monitor with grant option;

\ir ../../supabase/migrations/20260829011311_agent_deck_design_sources.sql
\ir ../../supabase/migrations/20260829011319_agent_deck_design_geometry_read.sql

begin;

do $replay_contract$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'private.enforce_agent_deck_bridge_company_integrity()',
    'private.bump_agent_deck_design_source_revisions()',
    'private.agent_p2_deck_geometry_canonical_json(jsonb)',
    'private.agent_p2_deck_design_ref(uuid,uuid)',
    'private.agent_p2_deck_design_geometry_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)',
    'public.read_agent_deck_design_geometry_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)'
  ]::text[] loop
    if exists (
      select 1
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      where function_row.oid = pg_catalog.to_regprocedure(v_signature)
        and acl.grantee = 'pg_monitor'::regrole::oid
    ) then
      raise exception 'migration replay acl mismatch: %', v_signature;
    end if;
  end loop;

  if pg_catalog.has_function_privilege(
       'service_role',
       'private.agent_p2_deck_design_geometry_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.agent_p2_deck_geometry_canonical_json(jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.agent_p2_deck_design_ref(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.enforce_agent_deck_bridge_company_integrity()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.bump_agent_deck_design_source_revisions()',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_deck_design_geometry_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)',
       'EXECUTE'
     ) then
    raise exception 'migration replay acl mismatch';
  end if;
end;
$replay_contract$;

rollback;
