begin;

-- A cost-authorized catalogue detail with no supplier profiles must expose
-- an empty collection and an inspected count of zero. The original aggregate
-- returned no row, which replaced the initialized 0 / [] / false state with
-- NULL. Patch only the affected detail reader so later authority hardening on
-- the rest of the catalogue surface remains intact.
do $prerequisites$
begin
  if pg_catalog.to_regprocedure(
       'private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
     ) is null
     or pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'agent_catalog_empty_supplier_costs_prerequisite_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create temporary table agent_catalog_empty_supplier_costs_before
on commit drop
as
select procedure.oid,
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
       pg_catalog.encode(
         extensions.digest(
           pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
         ),
         'hex'
       ) as source_sha256
from pg_catalog.pg_proc procedure
where procedure.oid = pg_catalog.to_regprocedure(
  'private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
)::oid;

do $repair$
declare
  v_signature constant text :=
    'private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)';
  v_expected_owner oid := (
    select role.oid
    from pg_catalog.pg_roles role
    where role.rolname = current_user
  );
  v_pre_repair_sha256 constant text :=
    '8f0765db5ded1e534950a05d0e27bae77ef70f104a6ab5aa43b0974c79f9efd4';
  v_repaired_sha256 constant text :=
    '8cd62292b72bb7dab9baa3b4db1eac406127c85ee8e7e0d694ef834589d6019d';
  v_old_fragment constant text := $old$
    select pg_catalog.count(*)::integer,
           coalesce(
             pg_catalog.jsonb_agg(
               projection.cost_item
               order by projection.catalog_variant_id,
                        projection.is_default desc,
                        projection.effective_at desc,
                        projection.safe_label collate "C",
                        projection.currency_code,
                        projection.amount_minor
             ),
             '[]'::jsonb
           ),
           coalesce(
             pg_catalog.bool_or(projection.source_invalid), false
           ) or duplicate.has_duplicate
      into v_supplier_cost_count, v_supplier_costs,
           v_supplier_cost_invalid
    from cost_projection projection
    cross join duplicate_state duplicate
    group by duplicate.has_duplicate;$old$;
  v_new_fragment constant text := $new$
    select pg_catalog.count(projection.id)::integer,
           coalesce(
             pg_catalog.jsonb_agg(
               projection.cost_item
               order by projection.catalog_variant_id,
                        projection.is_default desc,
                        projection.effective_at desc,
                        projection.safe_label collate "C",
                        projection.currency_code,
                        projection.amount_minor
             ) filter (where projection.id is not null),
             '[]'::jsonb
           ),
           coalesce(
             pg_catalog.bool_or(projection.source_invalid), false
           ) or duplicate.has_duplicate
      into v_supplier_cost_count, v_supplier_costs,
           v_supplier_cost_invalid
    from duplicate_state duplicate
    left join cost_projection projection on true
    group by duplicate.has_duplicate;$new$;
  v_function_oid oid;
  v_source_sha256 text;
  v_definition text;
  v_repaired_definition text;
  v_old_count integer;
  v_new_count integer;
  v_security_identity_valid boolean;
begin
  if (select pg_catalog.count(*)
      from agent_catalog_empty_supplier_costs_before) is distinct from 1::bigint
     or v_pre_repair_sha256 !~ '^[0-9a-f]{64}$'
     or v_repaired_sha256 !~ '^[0-9a-f]{64}$'
     or v_pre_repair_sha256 = v_repaired_sha256
     or v_old_fragment = v_new_fragment then
    raise exception 'agent_catalog_empty_supplier_costs_registry_invalid'
      using errcode = '55000';
  end if;

  v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
  select exists (
           select 1
           from pg_catalog.pg_proc procedure
           join pg_catalog.pg_namespace namespace
             on namespace.oid = procedure.pronamespace
           join pg_catalog.pg_language language
             on language.oid = procedure.prolang
           where procedure.oid = v_function_oid
             and namespace.nspname = 'private'
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
         )
    into v_security_identity_valid;

  if not coalesce(v_security_identity_valid, false) then
    raise exception
      'agent_catalog_empty_supplier_costs_security_identity_drift'
      using errcode = '55000';
  end if;

  select pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
           ),
           'hex'
         ),
         pg_catalog.pg_get_functiondef(procedure.oid)
    into strict v_source_sha256, v_definition
  from pg_catalog.pg_proc procedure
  where procedure.oid = v_function_oid;

  v_old_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_old_fragment, '')
    )
  ) / pg_catalog.length(v_old_fragment);
  v_new_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_new_fragment, '')
    )
  ) / pg_catalog.length(v_new_fragment);

  if v_source_sha256 = v_pre_repair_sha256 then
    if v_old_count is distinct from 1 or v_new_count is distinct from 0 then
      raise exception
        'agent_catalog_empty_supplier_costs_replacement_count: % %',
        v_old_count, v_new_count using errcode = '55000';
    end if;
    v_repaired_definition := pg_catalog.replace(
      v_definition, v_old_fragment, v_new_fragment
    );
    if v_repaired_definition is not distinct from v_definition then
      raise exception 'agent_catalog_empty_supplier_costs_rewrite_failed'
        using errcode = '55000';
    end if;
    execute v_repaired_definition;
  elsif v_source_sha256 = v_repaired_sha256 then
    if v_old_count is distinct from 0 or v_new_count is distinct from 1 then
      raise exception 'agent_catalog_empty_supplier_costs_replay_invalid'
        using errcode = '55000';
    end if;
  else
    raise exception 'agent_catalog_empty_supplier_costs_source_drift: %',
      v_source_sha256 using errcode = '55000';
  end if;
end;
$repair$;

do $postflight$
declare
  v_expected_sha256 constant text :=
    '8cd62292b72bb7dab9baa3b4db1eac406127c85ee8e7e0d694ef834589d6019d';
  v_expected_owner oid := (
    select role.oid
    from pg_catalog.pg_roles role
    where role.rolname = current_user
  );
  v_before agent_catalog_empty_supplier_costs_before%rowtype;
  v_after agent_catalog_empty_supplier_costs_before%rowtype;
  v_security_identity_valid boolean;
begin
  select * into strict v_before
  from agent_catalog_empty_supplier_costs_before;

  select procedure.oid,
         procedure.proowner,
         procedure.proacl,
         procedure.proconfig,
         procedure.prosecdef,
         procedure.provolatile,
         procedure.proparallel,
         procedure.proisstrict,
         procedure.pronargdefaults,
         procedure.proargdefaults::text,
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
         pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
           ),
           'hex'
         )
    into strict v_after
  from pg_catalog.pg_proc procedure
  where procedure.oid = v_before.oid;

  select exists (
           select 1
           from pg_catalog.pg_proc procedure
           join pg_catalog.pg_namespace namespace
             on namespace.oid = procedure.pronamespace
           join pg_catalog.pg_language language
             on language.oid = procedure.prolang
           where procedure.oid = v_before.oid
             and namespace.nspname = 'private'
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
         )
    into v_security_identity_valid;

  if v_after.source_sha256 is distinct from v_expected_sha256
     or not coalesce(v_security_identity_valid, false)
     or v_after.oid is distinct from v_before.oid
     or v_after.proowner is distinct from v_before.proowner
     or v_after.proacl is distinct from v_before.proacl
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.provolatile is distinct from v_before.provolatile
     or v_after.proparallel is distinct from v_before.proparallel
     or v_after.proisstrict is distinct from v_before.proisstrict
     or v_after.pronargdefaults is distinct from v_before.pronargdefaults
     or v_after.proargdefaults is distinct from v_before.proargdefaults
     or v_after.prorettype is distinct from v_before.prorettype
     or v_after.proretset is distinct from v_before.proretset
     or v_after.prolang is distinct from v_before.prolang
     or v_after.prokind is distinct from v_before.prokind
     or v_after.proleakproof is distinct from v_before.proleakproof
     or v_after.procost is distinct from v_before.procost
     or v_after.prorows is distinct from v_before.prorows
     or v_after.proargtypes is distinct from v_before.proargtypes
     or v_after.proallargtypes is distinct from v_before.proallargtypes
     or v_after.proargmodes is distinct from v_before.proargmodes
     or v_after.proargnames is distinct from v_before.proargnames then
    raise exception 'agent_catalog_empty_supplier_costs_metadata_drift'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
