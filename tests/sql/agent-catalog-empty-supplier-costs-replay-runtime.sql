\ir ../../supabase/migrations/20260830180000_agent_catalog_empty_supplier_costs.sql

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $replay_is_exact$
declare
  v_signature constant text :=
    'private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)';
  v_expected_owner oid := (
    select role.oid
    from pg_catalog.pg_roles role
    where role.rolname = current_user
  );
  v_source_sha256 text;
  v_security_identity_valid boolean;
begin
  select pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
           ),
           'hex'
         ),
         namespace.nspname = 'private'
           and language.lanname = 'plpgsql'
           and procedure.proowner = v_expected_owner
           and not procedure.prosecdef
           and procedure.provolatile = 's'
           and procedure.proparallel = 'u'
           and not procedure.proisstrict
           and procedure.proconfig is not distinct from
                 array['search_path=""']::text[]
           and not exists (
             select 1
             from pg_catalog.aclexplode(
               coalesce(
                 procedure.proacl,
                 pg_catalog.acldefault('f', procedure.proowner)
               )
             ) acl
             where acl.grantee <> procedure.proowner
           )
           and not pg_catalog.has_function_privilege(
             'anon', procedure.oid, 'EXECUTE'
           )
           and not pg_catalog.has_function_privilege(
             'authenticated', procedure.oid, 'EXECUTE'
           )
           and not pg_catalog.has_function_privilege(
             'service_role', procedure.oid, 'EXECUTE'
           )
    into strict v_source_sha256, v_security_identity_valid
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_language language
    on language.oid = procedure.prolang
  where procedure.oid = pg_catalog.to_regprocedure(v_signature)::oid;

  if not coalesce(v_security_identity_valid, false) then
    raise exception
      'agent_catalog_empty_supplier_costs_security_identity_drift'
      using errcode = '55000';
  end if;

  if v_source_sha256 is distinct from
       '8cd62292b72bb7dab9baa3b4db1eac406127c85ee8e7e0d694ef834589d6019d' then
    raise exception 'agent_catalog_empty_supplier_costs_replay_mismatch'
      using errcode = '55000';
  end if;
end;
$replay_is_exact$;

rollback;
