begin;

-- OAuth grants preserve the exposure catalogue's consent-display order.
-- P2 read proofs intentionally carry a sorted scope ceiling so their
-- canonical JSON is stable. Scope authority is the closed set of members,
-- not either presentation order.
create or replace function private.agent_mcp_oauth_scope_sets_equal(
  p_left text[],
  p_right text[]
) returns boolean
language sql
immutable
strict
parallel safe
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select pg_catalog.cardinality(p_left) = pg_catalog.cardinality(p_right)
     and p_left <@ p_right
     and p_right <@ p_left;
$function$;

revoke all on function private.agent_mcp_oauth_scope_sets_equal(text[], text[])
  from public, anon, authenticated, service_role;

alter function private.agent_mcp_oauth_scope_sets_equal(text[], text[])
  owner to current_user;

do $repair_scope_bindings$
declare
  v_signatures constant text[] := array[
    'private.agent_p2_artifact_evidence_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)',
    'private.agent_p2_artifact_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)',
    'private.agent_p2_availability_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'private.agent_p2_catalog_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean)',
    'private.agent_p2_company_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,timestamp with time zone)',
    'private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)',
    'private.agent_p2_deck_design_geometry_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)',
    'private.agent_p2_expense_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text)',
    'private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)',
    'private.agent_p2_operational_overview_summary_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)',
    'private.agent_p2_payment_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb)',
    'private.agent_p2_purchase_order_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean)',
    'private.agent_p2_sales_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[])',
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)',
    'private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
    'private.agent_p2_task_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'private.agent_p2_team_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'private.agent_p2_work_queue_read_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)',
    'public.redeem_agent_mcp_evidence_as_system(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone)'
  ]::text[];
  v_pre_repair_sha256 constant text[] := array[
    '464e35154e02007cad8ead273408c0fb2430e17798a3c0702656bc56bc8f7ee2',
    'cdc50fc673d060062d3faadcb121cc4dabcf2d2ac1c9b3570a1d115d930a3aa0',
    'bf256238ab40b0ec158fb6ba2dafbb032f35066e3a39bd4aec7bf35bd19b4099',
    'ce521da68582f9ffeacc132b832f3d68cdbd3592df7c1abdec45ed3228adad75',
    '6847a723cdd0aa72342f46626c5788f5ca35da6f778f4a19ba02ad67940bf6b4',
    '7cea6d90b6e3e9d707b089a0ba9ef2e8e3c907b5d30e15c106839a896a0dca76',
    '7923f5873e559cd4930808077bb0db87d436bf25321c539a6a24e12a269c37bb',
    'bb3a13c6ceadcf57d7acc1ffee92b13ad54bf87704f09b13368a8ebbfd10defc',
    '800db5222a32c06f5734e9477cd8ac33ad15cadd1014ba2aa37616182617d0be',
    'dff1f1d70f6964e8c0291da00dd78db987170ee86570c99b107055518242122c',
    'a608b9e8ab3b541ba92e3708ba08cde26696d2b947faade4d931e36b29c1b86a',
    '50d181990e939261219ef9f14e40ad5e85b1f27c139a9fc2e123fa0679caef66',
    '601ff96620d6aa75d6dcc13185895645ce228474b9f1674c2e181b60674693f7',
    'abbbbfdac2b9d3a21c731c6cb7c67907a7588538f6366f70349b1332ec064289',
    'cd8157bd451f629baf96a74ff6d73f992c06fce451e69459a0f51f5e0916fc48',
    '4f0adc67400fbae6f63fcc4a29f4d581902ca516849d8ecb68846ef064fdf5e9',
    '5ba5b4eafabc6f3c2af0951fea544135db38b3f89d0c11a10356b1bddaa17637',
    '77b01bd46ed2c0142b83f6b40b646bbce1efb568512643f3a856d3b1fb85f8f7',
    '78fd72725efe849cd6f698fb9cfeb4d0b6578c6eca5542bc2c6512bede00fe2d',
    'bf47844f509d48e90e6742194695e861130d8be35f608acaa8c38b15756e9547'
  ]::text[];
  v_repaired_sha256 constant text[] := array[
    'eead05b5ed36bfc01fc7f2ee5f18297c1c585a9b0f8710e5f14ba1e7e5dcaba8',
    '5e2a70fa8ff7e631af6ebb9a78968120f8e44e1a4d4109fe9d5d73065617f908',
    'ad7c52040377f35115e55a36be2ac0aa55e7c17476961fcaf54eab8e378e458e',
    '6c4342a8fe2857a06e221780cb3e70951d06c405fea95b08bf137a5d85e5e6b8',
    'f240d1668b1b4d81d6818166f164d9f1551e1ba0387eef8ed8c329dc92e325c3',
    '372e086748b2cd0f4f804919614a9d2ab6c28f8ca4ba13599f5c23bc93538508',
    'a2c22d04bedb3653b625aa8630e98017433b73a733bd2c46560674bd54c46cbe',
    '3348591d23530ed1e5ad5c55d9306e0183384f004706d45a89fa2eacb936a252',
    '770f3cfec5044e04cc22c0c5ae4cfc48f29e7281ebd33a1a185e3b614f692d38',
    '11761e47817e3d00306e7c5f9f0ad072adeee3e6f4194cbf4266b05926fa5011',
    'e7871e4930ba73aa2a6896e5f4bb1eff32e455aa781f3cfb8aa09a1933893cdf',
    '281feae9894272958b7dedab8a04c634acfd729233dd1e0edbcbf184a6ae7aeb',
    '0a0d8c07c0b3719793bcc730af0b59bc12bfc03a9a96ba188954f3f374be8ad6',
    'c212adb9931a6840d7c79cc7f78ebe2fe64b9b8de20eb7408773823dc7c69625',
    '79c26414a2a5ef76c29af521d71643181efa0cdd0fe252eb6387d1669160f573',
    '8c52f37aace9e1d9d5fa9b5298ed5fefd540561b6a02fbaf1652adf1d11b8cad',
    '75ac95438e52d6e33f0bd2b1a92d964f63e30d3c59c5bad3f8e231d8f50b1d29',
    '743e4a42dfbb93da06f6cecc31fbefdb3300415d59d763d4e5a54feab8249ad4',
    '3908fe8e53d5c6032cbb1365d8237bba83324cad7bef524258ca807c7c952082',
    '8315a02ac7a00c6710ba9cd630ba124fc406d5b00ebb9f7021fcfe2c0cb7d1c8'
  ]::text[];
  v_expected_function_count constant integer := 20;
  v_index integer;
  v_signature text;
  v_function_oid oid;
  v_source_sha256 text;
  v_definition text;
  v_repaired_definition text;
  v_old_gate_count integer;
  v_new_gate_count integer;
  v_schema_name text;
  v_language_name text;
  v_security_definer boolean;
  v_volatility text;
  v_parallel text;
  v_settings text[];
  v_acl aclitem[];
  v_owner oid;
  v_after_oid oid;
  v_after_security_definer boolean;
  v_after_volatility text;
  v_after_parallel text;
  v_after_settings text[];
  v_after_acl aclitem[];
  v_after_owner oid;
  v_after_source_sha256 text;
  v_repaired_count integer;
begin
  if pg_catalog.cardinality(v_signatures) is distinct from
       v_expected_function_count
     or pg_catalog.cardinality(v_pre_repair_sha256) is distinct from
       v_expected_function_count
     or pg_catalog.cardinality(v_repaired_sha256) is distinct from
       v_expected_function_count
     or (
       select pg_catalog.count(distinct signature)
       from pg_catalog.unnest(v_signatures) signature
     ) is distinct from v_expected_function_count::bigint
     or exists (
       select 1
       from pg_catalog.unnest(
         v_pre_repair_sha256 || v_repaired_sha256
       ) digest
       where digest !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'agent_mcp_scope_set_binding_signature_registry_invalid'
      using errcode = '55000';
  end if;

  for v_index in 1..v_expected_function_count loop
    v_signature := v_signatures[v_index];
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_mcp_scope_set_binding_function_missing: %',
        v_signature using errcode = '55000';
    end if;

    select namespace.nspname,
           language.lanname,
           procedure.prosecdef,
           procedure.provolatile::text,
           procedure.proparallel::text,
           procedure.proconfig,
           procedure.proacl,
           procedure.proowner,
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
                  v_acl,
                  v_owner,
                  v_source_sha256,
                  v_definition
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_language language
      on language.oid = procedure.prolang
    where procedure.oid = v_function_oid;

    if v_language_name is distinct from 'plpgsql'
       or v_parallel is distinct from 'u'
       or not exists (
         select 1
         from pg_catalog.unnest(
           coalesce(v_settings, array[]::text[])
         ) setting
         where setting in ('search_path=', 'search_path=""')
       ) then
      raise exception 'agent_mcp_scope_set_binding_function_shape_drift: %',
        v_signature using errcode = '55000';
    end if;

    if v_schema_name = 'private' then
      if v_security_definer
         or v_volatility is distinct from 's'
         or pg_catalog.has_function_privilege(
           'anon', v_function_oid, 'EXECUTE'
         )
         or pg_catalog.has_function_privilege(
           'authenticated', v_function_oid, 'EXECUTE'
         )
         or pg_catalog.has_function_privilege(
           'service_role', v_function_oid, 'EXECUTE'
         ) then
        raise exception 'agent_mcp_scope_set_binding_private_acl_drift: %',
          v_signature using errcode = '55000';
      end if;
    elsif v_schema_name = 'public'
          and v_signature =
            'public.redeem_agent_mcp_evidence_as_system(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone)' then
      if not v_security_definer
         or v_volatility is distinct from 'v'
         or pg_catalog.has_function_privilege(
           'anon', v_function_oid, 'EXECUTE'
         )
         or pg_catalog.has_function_privilege(
           'authenticated', v_function_oid, 'EXECUTE'
         )
         or not pg_catalog.has_function_privilege(
           'service_role', v_function_oid, 'EXECUTE'
         ) then
        raise exception 'agent_mcp_scope_set_binding_public_acl_drift: %',
          v_signature using errcode = '55000';
      end if;
    else
      raise exception 'agent_mcp_scope_set_binding_unexpected_function: %',
        v_signature using errcode = '55000';
    end if;

    v_old_gate_count := (
      pg_catalog.length(v_definition) - pg_catalog.length(
        pg_catalog.replace(
          v_definition,
          'scopes = p_granted_scope_ceiling',
          ''
        )
      )
    ) / pg_catalog.length('scopes = p_granted_scope_ceiling');
    v_new_gate_count := (
      pg_catalog.length(v_definition) - pg_catalog.length(
        pg_catalog.replace(
          v_definition,
          'private.agent_mcp_oauth_scope_sets_equal(',
          ''
        )
      )
    ) / pg_catalog.length('private.agent_mcp_oauth_scope_sets_equal(');

    if v_source_sha256 = v_pre_repair_sha256[v_index] then
      if v_old_gate_count <> 1 or v_new_gate_count <> 0 then
        raise exception
          'agent_mcp_scope_set_binding_gate_count: % old=% new=%',
          v_signature, v_old_gate_count, v_new_gate_count
          using errcode = '55000';
      end if;
      v_repaired_definition := pg_catalog.regexp_replace(
        v_definition,
        '([a-z_][a-z0-9_]*[.]scopes)[[:space:]]*=[[:space:]]*p_granted_scope_ceiling',
        'private.agent_mcp_oauth_scope_sets_equal(\1, p_granted_scope_ceiling)',
        'g'
      );
      if v_repaired_definition is not distinct from v_definition
         or v_repaired_definition like
           '%scopes = p_granted_scope_ceiling%'
         or (
           pg_catalog.length(v_repaired_definition) - pg_catalog.length(
             pg_catalog.replace(
               v_repaired_definition,
               'private.agent_mcp_oauth_scope_sets_equal(',
               ''
             )
           )
         ) / pg_catalog.length(
           'private.agent_mcp_oauth_scope_sets_equal('
         ) <> 1 then
        raise exception 'agent_mcp_scope_set_binding_rewrite_failed: %',
          v_signature using errcode = '55000';
      end if;
      execute v_repaired_definition;
    elsif v_source_sha256 = v_repaired_sha256[v_index] then
      if v_old_gate_count <> 0 or v_new_gate_count <> 1 then
        raise exception
          'agent_mcp_scope_set_binding_gate_count: % old=% new=%',
          v_signature, v_old_gate_count, v_new_gate_count
          using errcode = '55000';
      end if;
      -- Replay-safe: the exact function is already repaired.
      null;
    else
      raise exception 'agent_mcp_scope_set_binding_source_drift: % %',
        v_signature, v_source_sha256
        using errcode = '55000';
    end if;

    v_after_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    select procedure.prosecdef,
           procedure.provolatile::text,
           procedure.proparallel::text,
           procedure.proconfig,
           procedure.proacl,
           procedure.proowner,
           pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
               'sha256'
             ),
             'hex'
           )
      into strict v_after_security_definer,
                  v_after_volatility,
                  v_after_parallel,
                  v_after_settings,
                  v_after_acl,
                  v_after_owner,
                  v_after_source_sha256
    from pg_catalog.pg_proc procedure
    where procedure.oid = v_after_oid;

    if v_after_oid is distinct from v_function_oid
       or v_after_security_definer is distinct from v_security_definer
       or v_after_volatility is distinct from v_volatility
       or v_after_parallel is distinct from v_parallel
       or v_after_settings is distinct from v_settings
       or v_after_acl is distinct from v_acl
       or v_after_owner is distinct from v_owner
       or v_after_source_sha256 is distinct from
         v_repaired_sha256[v_index] then
      raise exception 'agent_mcp_scope_set_binding_metadata_drift: %',
        v_signature using errcode = '55000';
    end if;
  end loop;

  select pg_catalog.count(*)::integer
    into v_repaired_count
  from pg_catalog.unnest(v_signatures) with ordinality
    registered(signature, position)
  join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(registered.signature)::oid
  where procedure.prosrc not like '%scopes = p_granted_scope_ceiling%'
    and (
      pg_catalog.length(procedure.prosrc) - pg_catalog.length(
        pg_catalog.replace(
          procedure.prosrc,
          'private.agent_mcp_oauth_scope_sets_equal(',
          ''
        )
      )
    ) / pg_catalog.length(
      'private.agent_mcp_oauth_scope_sets_equal('
    ) = 1
    and pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) = v_repaired_sha256[registered.position::integer];

  if v_repaired_count is distinct from v_expected_function_count then
    raise exception 'agent_mcp_scope_set_binding_postcondition_failed: %',
      v_repaired_count using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('private', 'public')
      and procedure.prosrc like '%scopes = p_granted_scope_ceiling%'
  ) then
    raise exception 'agent_mcp_scope_set_binding_unrepaired_gate'
      using errcode = '55000';
  end if;
end;
$repair_scope_bindings$;

do $helper_contract$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'private.agent_mcp_oauth_scope_sets_equal(text[],text[])'
  )::oid;
  v_expected_owner oid := (
    select role.oid
    from pg_catalog.pg_roles role
    where role.rolname = current_user
  );
begin
  if v_function_oid is null
     or exists (
       select 1
       from pg_catalog.pg_proc procedure
       join pg_catalog.pg_language language
         on language.oid = procedure.prolang
       where procedure.oid = v_function_oid
         and (
           language.lanname is distinct from 'sql'
           or procedure.prosecdef
           or procedure.provolatile is distinct from 'i'
           or not procedure.proisstrict
           or procedure.proparallel is distinct from 's'
           or procedure.proowner is distinct from v_expected_owner
           or procedure.proconfig is distinct from
             array['search_path=pg_catalog, pg_temp']::text[]
         )
     )
     or pg_catalog.has_function_privilege(
       'anon', v_function_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', v_function_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', v_function_oid, 'EXECUTE'
     ) then
    raise exception 'agent_mcp_scope_set_binding_helper_contract_failed'
      using errcode = '55000';
  end if;
end;
$helper_contract$;

commit;
