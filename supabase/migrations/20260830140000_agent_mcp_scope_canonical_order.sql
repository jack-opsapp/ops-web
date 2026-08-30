begin;

-- P2 proof vectors are canonical machine data. JavaScript relational order
-- and PostgreSQL COLLATE "C" agree for their bounded ASCII tokens; the
-- database's ICU/default collation does not (notably catalog vs
-- catalog_costs). Repair only the exact readers whose ceiling validator still
-- used the database default, with closed pre/post source hashes.
create temporary table agent_mcp_scope_canonical_order_expected (
  function_signature text primary key,
  pre_repair_sha256 text not null,
  repaired_sha256 text not null,
  old_fragment text not null,
  new_fragment text not null,
  expected_replacement_count integer not null
) on commit drop;

insert into agent_mcp_scope_canonical_order_expected values
  ('private.agent_p2_availability_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)', 'ad7c52040377f35115e55a36be2ac0aa55e7c17476961fcaf54eab8e378e458e', 'c8727c652590dea4cb92855140a78baae74ed18c626cb9ceb94f1f7e125c7b04', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1),
  ('private.agent_p2_catalog_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean)', '6c4342a8fe2857a06e221780cb3e70951d06c405fea95b08bf137a5d85e5e6b8', '5f1f3a8f487c7f493d0d69cc4fa352377b9aee22f21a7060ff38ce3a0a0cfce5', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1),
  ('private.agent_p2_company_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,timestamp with time zone)', 'f240d1668b1b4d81d6818166f164d9f1551e1ba0387eef8ed8c329dc92e325c3', '568c207d96ffd694e72c37eab454c15adc9e4da082f0e0fd93351ed064f4fd44', 'granted.scope order by granted.scope', 'granted.scope order by granted.scope collate "C"', 1),
  ('public.read_agent_company_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text)', '7d57781f0434324534f71e1e13c7d86c4da60776803c468774fa365ab9096983', 'bbbcd111c3ed0fe9d6ba82fb735cf01df957d23c77960b474e715c9efc0891fa', 'granted.scope order by granted.scope', 'granted.scope order by granted.scope collate "C"', 1),
  ('private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)', '372e086748b2cd0f4f804919614a9d2ab6c28f8ca4ba13599f5c23bc93538508', '772c58d21d62dca9f88d3d4985e5121290857f0db63538453ef21cb577732f03', 'granted.scope order by granted.scope', 'granted.scope order by granted.scope collate "C"', 1),
  ('public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)', '626e12305303ff6ef317c70e662119e5dc2f7d33fa89f5dbc8da3132e1a4caa9', '3a9fba1f68279a32bd148aebc74a44c237780aa914d1102e432d8ab662c53ecb', 'granted.scope order by granted.scope', 'granted.scope order by granted.scope collate "C"', 1),
  ('private.agent_p2_deck_design_geometry_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)', 'a2c22d04bedb3653b625aa8630e98017433b73a733bd2c46560674bd54c46cbe', 'ec771b706e39dc0445af448f06a3bfd91a6fe22da79aa935d0aa3404f81cf392', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1),
  ('private.agent_p2_expense_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text)', '3348591d23530ed1e5ad5c55d9306e0183384f004706d45a89fa2eacb936a252', '6d1287228d4ae8c85f5b847d3fb9936c35f736f6f5acbc7020d7ec6c27318fe6', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 2),
  ('private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)', '770f3cfec5044e04cc22c0c5ae4cfc48f29e7281ebd33a1a185e3b614f692d38', '86526189cfaf71651b50d6674e39349fe352ee9e07b0a07e74977ca63f09d56b', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1),
  ('private.agent_p2_payment_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb)', 'e7871e4930ba73aa2a6896e5f4bb1eff32e455aa781f3cfb8aa09a1933893cdf', '4341ef74619729b4c0e3c374509e788bd2d4271fabb57c9ec9fbbf043bb43a1a', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1),
  ('private.agent_p2_sales_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[])', '0a0d8c07c0b3719793bcc730af0b59bc12bfc03a9a96ba188954f3f374be8ad6', 'b133397e1b7a033062498337aa3b34c7724ea78c19b043a08195328c8993587f', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1),
  ('private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)', 'c212adb9931a6840d7c79cc7f78ebe2fe64b9b8de20eb7408773823dc7c69625', '2459fd55d792a79dfbf6648402486586d5eed730cf00cae24d7b797cb0108b9e', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1),
  ('private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)', '79c26414a2a5ef76c29af521d71643181efa0cdd0fe252eb6387d1669160f573', '43bde004cd4a44b3b67d94ace66bfd2708660c6019f2f1706d226e284ef01416', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1),
  ('private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)', '8c52f37aace9e1d9d5fa9b5298ed5fefd540561b6a02fbaf1652adf1d11b8cad', '14030ad081001e06bf3fa5a9779fa8afd3bdd29870643d90e90ba587adf82cc7', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1),
  ('private.agent_p2_task_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)', '75ac95438e52d6e33f0bd2b1a92d964f63e30d3c59c5bad3f8e231d8f50b1d29', 'b40553ea5fd03f9dce24f5b0fd41a8b3587311e5cd7a5bb5c772ffe8235cbeba', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1),
  ('private.agent_p2_team_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)', '743e4a42dfbb93da06f6cecc31fbefdb3300415d59d763d4e5a54feab8249ad4', 'f7f32fca89f0e128f45c2de47dadbb626c04ade94edce6519cb313afd815bca2', 'scope.value order by scope.value', 'scope.value order by scope.value collate "C"', 1);

create temporary table agent_mcp_scope_canonical_order_before
on commit drop
as
select
  expected.function_signature,
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
  procedure.proargnames
from agent_mcp_scope_canonical_order_expected expected
join pg_catalog.pg_proc procedure
  on procedure.oid = pg_catalog.to_regprocedure(
    expected.function_signature
  )::oid;

do $repair_agent_mcp_scope_canonical_order$
declare
  v_expected_function_count constant integer := 16;
  v_expected_owner oid := (
    select role.oid
    from pg_catalog.pg_roles role
    where role.rolname = current_user
  );
  v_row record;
  v_function_oid oid;
  v_schema_name text;
  v_language_name text;
  v_security_definer boolean;
  v_volatility text;
  v_parallel text;
  v_settings text[];
  v_source_sha256 text;
  v_definition text;
  v_repaired_definition text;
  v_old_count integer;
  v_new_count integer;
begin
  if (
       select pg_catalog.count(*)
       from agent_mcp_scope_canonical_order_expected
     ) is distinct from v_expected_function_count::bigint
     or (
       select pg_catalog.count(distinct function_signature)
       from agent_mcp_scope_canonical_order_expected
     ) is distinct from v_expected_function_count::bigint
     or (
       select pg_catalog.count(*)
       from agent_mcp_scope_canonical_order_before
     ) is distinct from v_expected_function_count::bigint
     or exists (
       select 1
       from agent_mcp_scope_canonical_order_expected expected
       where expected.pre_repair_sha256 !~ '^[0-9a-f]{64}$'
          or expected.repaired_sha256 !~ '^[0-9a-f]{64}$'
          or expected.pre_repair_sha256 = expected.repaired_sha256
          or expected.old_fragment = expected.new_fragment
          or expected.expected_replacement_count not between 1 and 4
     ) then
    raise exception 'agent_mcp_scope_canonical_order_registry_invalid'
      using errcode = '55000';
  end if;

  for v_row in
    select *
    from agent_mcp_scope_canonical_order_expected
    order by function_signature collate "C"
  loop
    v_function_oid := pg_catalog.to_regprocedure(
      v_row.function_signature
    )::oid;

    select namespace.nspname,
           language.lanname,
           procedure.prosecdef,
           procedure.provolatile::text,
           procedure.proparallel::text,
           procedure.proconfig,
           pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
               'sha256'
             ),
             'hex'
           ),
           pg_catalog.pg_get_functiondef(procedure.oid)
      into strict v_schema_name,
                  v_language_name,
                  v_security_definer,
                  v_volatility,
                  v_parallel,
                  v_settings,
                  v_source_sha256,
                  v_definition
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_language language
      on language.oid = procedure.prolang
    where procedure.oid = v_function_oid;

    if v_language_name is distinct from 'plpgsql'
       or v_volatility is distinct from 's'
       or v_parallel is distinct from 'u'
       or v_settings is distinct from array['search_path=""']::text[]
       or (
         select procedure.proowner
         from pg_catalog.pg_proc procedure
         where procedure.oid = v_function_oid
       ) is distinct from v_expected_owner then
      raise exception 'agent_mcp_scope_canonical_order_shape_drift: %',
        v_row.function_signature using errcode = '55000';
    end if;

    if v_schema_name = 'private' then
      if v_security_definer
         or pg_catalog.has_function_privilege(
           'anon', v_function_oid, 'EXECUTE'
         )
         or pg_catalog.has_function_privilege(
           'authenticated', v_function_oid, 'EXECUTE'
         )
         or pg_catalog.has_function_privilege(
           'service_role', v_function_oid, 'EXECUTE'
         ) then
        raise exception 'agent_mcp_scope_canonical_order_private_acl_drift: %',
          v_row.function_signature using errcode = '55000';
      end if;
    elsif v_schema_name = 'public' then
      if not v_security_definer
         or pg_catalog.has_function_privilege(
           'anon', v_function_oid, 'EXECUTE'
         )
         or pg_catalog.has_function_privilege(
           'authenticated', v_function_oid, 'EXECUTE'
         )
         or not pg_catalog.has_function_privilege(
           'service_role', v_function_oid, 'EXECUTE'
         ) then
        raise exception 'agent_mcp_scope_canonical_order_public_acl_drift: %',
          v_row.function_signature using errcode = '55000';
      end if;
    else
      raise exception 'agent_mcp_scope_canonical_order_schema_drift: %',
        v_row.function_signature using errcode = '55000';
    end if;

    if v_source_sha256 = v_row.pre_repair_sha256 then
      v_old_count := (
        pg_catalog.length(v_definition) - pg_catalog.length(
          pg_catalog.replace(v_definition, v_row.old_fragment, '')
        )
      ) / pg_catalog.length(v_row.old_fragment);
      v_new_count := (
        pg_catalog.length(v_definition) - pg_catalog.length(
          pg_catalog.replace(v_definition, v_row.new_fragment, '')
        )
      ) / pg_catalog.length(v_row.new_fragment);
      if v_old_count is distinct from v_row.expected_replacement_count
         or v_new_count is distinct from 0 then
        raise exception
          'agent_mcp_scope_canonical_order_replacement_count: % old=% new=%',
          v_row.function_signature, v_old_count, v_new_count
          using errcode = '55000';
      end if;
      v_repaired_definition := pg_catalog.replace(
        v_definition,
        v_row.old_fragment,
        v_row.new_fragment
      );
      if v_repaired_definition is not distinct from v_definition then
        raise exception 'agent_mcp_scope_canonical_order_rewrite_failed: %',
          v_row.function_signature using errcode = '55000';
      end if;
      execute v_repaired_definition;
    elsif v_source_sha256 = v_row.repaired_sha256 then
      -- Exact replay: the closed function body is already repaired.
      null;
    else
      raise exception 'agent_mcp_scope_canonical_order_source_drift: % %',
        v_row.function_signature, v_source_sha256
        using errcode = '55000';
    end if;
  end loop;
end;
$repair_agent_mcp_scope_canonical_order$;

do $agent_mcp_scope_canonical_order_postcondition$
declare
  v_expected_function_count constant integer := 16;
  v_repaired_count integer;
  v_metadata_count integer;
begin
  select pg_catalog.count(*)::integer
    into v_repaired_count
  from agent_mcp_scope_canonical_order_expected expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(
      expected.function_signature
    )::oid
  where pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
            'sha256'
          ),
          'hex'
        ) = expected.repaired_sha256
    and procedure.prosrc like '%' || expected.new_fragment || '%';

  select pg_catalog.count(*)::integer
    into v_metadata_count
  from agent_mcp_scope_canonical_order_before before_row
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
   and procedure.proargnames is not distinct from before_row.proargnames;

  if v_repaired_count is distinct from v_expected_function_count
     or v_metadata_count is distinct from v_expected_function_count then
    raise exception
      'agent_mcp_scope_canonical_order_postcondition_failed: repaired=% metadata=%',
      v_repaired_count, v_metadata_count using errcode = '55000';
  end if;
end;
$agent_mcp_scope_canonical_order_postcondition$;

commit;
