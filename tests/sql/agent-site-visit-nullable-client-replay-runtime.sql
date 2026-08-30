\set ON_ERROR_STOP on

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

create temporary table agent_site_visit_nullable_client_replay_before
on commit preserve rows as
with protected_function(function_signature) as (values
  ('private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)'),
  ('private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)'),
  ('private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)')
)
select
  protected_function.function_signature,
  procedure.oid,
  procedure.proowner,
  procedure.proacl,
  procedure.proconfig,
  procedure.prosecdef,
  procedure.provolatile,
  procedure.proparallel,
  procedure.proisstrict,
  procedure.pronargdefaults,
  procedure.proargdefaults::text as proargdefaults,
  procedure.prorettype,
  procedure.proretset,
  procedure.prolang,
  procedure.prokind,
  procedure.proleakproof,
  procedure.procost,
  procedure.prorows,
  procedure.proargtypes,
  procedure.proallargtypes,
  procedure.proargmodes,
  procedure.proargnames,
  extensions.digest(
    pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
  ) as source_digest
from protected_function
join pg_catalog.pg_proc procedure
  on procedure.oid = pg_catalog.to_regprocedure(
    protected_function.function_signature
  )::oid;

commit;

\ir ../../supabase/migrations/20260830170000_agent_site_visit_nullable_client_visibility.sql

begin;

do $agent_site_visit_nullable_client_replay$
declare
  v_before_count integer;
  v_preserved_count integer;
  v_nullable_client_gate_count integer;
begin
  select pg_catalog.count(*)::integer into v_before_count
  from agent_site_visit_nullable_client_replay_before;

  select pg_catalog.count(*)::integer into v_preserved_count
  from agent_site_visit_nullable_client_replay_before before_row
  join pg_catalog.pg_proc procedure
    on procedure.oid = before_row.oid
   and procedure.proowner is not distinct from before_row.proowner
   and procedure.proacl is not distinct from before_row.proacl
   and procedure.proconfig is not distinct from before_row.proconfig
   and procedure.prosecdef is not distinct from before_row.prosecdef
   and procedure.provolatile is not distinct from before_row.provolatile
   and procedure.proparallel is not distinct from before_row.proparallel
   and procedure.proisstrict is not distinct from before_row.proisstrict
   and procedure.pronargdefaults is not distinct from
       before_row.pronargdefaults
   and procedure.proargdefaults::text is not distinct from
       before_row.proargdefaults
   and procedure.prorettype is not distinct from before_row.prorettype
   and procedure.proretset is not distinct from before_row.proretset
   and procedure.prolang is not distinct from before_row.prolang
   and procedure.prokind is not distinct from before_row.prokind
   and procedure.proleakproof is not distinct from before_row.proleakproof
   and procedure.procost is not distinct from before_row.procost
   and procedure.prorows is not distinct from before_row.prorows
   and procedure.proargtypes is not distinct from before_row.proargtypes
   and procedure.proallargtypes is not distinct from before_row.proallargtypes
   and procedure.proargmodes is not distinct from before_row.proargmodes
   and procedure.proargnames is not distinct from before_row.proargnames
   and extensions.digest(
     pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
   ) = before_row.source_digest;

  select pg_catalog.count(*)::integer into v_nullable_client_gate_count
  from agent_site_visit_nullable_client_replay_before before_row
  join pg_catalog.pg_proc procedure on procedure.oid = before_row.oid
  where procedure.prosrc like '%client_id is null%'
     or procedure.prosrc like '%resolved_client_id is null%';

  if v_before_count is distinct from 3
     or v_preserved_count is distinct from v_before_count
     or v_nullable_client_gate_count is distinct from 3
     or exists (
       select 1
       from agent_site_visit_nullable_client_replay_before before_row
       join pg_catalog.pg_proc procedure on procedure.oid = before_row.oid
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure.proacl,
           pg_catalog.acldefault('f', procedure.proowner)
         )
       ) acl
       where acl.grantee <> procedure.proowner
     )
     or exists (
       select 1
       from agent_site_visit_nullable_client_replay_before before_row
       where pg_catalog.has_function_privilege(
               'anon', before_row.oid, 'EXECUTE'
             )
          or pg_catalog.has_function_privilege(
               'authenticated', before_row.oid, 'EXECUTE'
             )
          or pg_catalog.has_function_privilege(
               'service_role', before_row.oid, 'EXECUTE'
             )
     ) then
    raise exception
      'agent_site_visit_nullable_client_replay_failed: before=% preserved=% gates=%',
      v_before_count,
      v_preserved_count,
      v_nullable_client_gate_count;
  end if;
end;
$agent_site_visit_nullable_client_replay$;

drop table agent_site_visit_nullable_client_replay_before;

rollback;
