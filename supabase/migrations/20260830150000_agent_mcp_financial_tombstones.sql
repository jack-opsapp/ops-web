begin;

-- Current financial reads must ignore documents whose required parent was
-- deliberately tombstoned. Missing and cross-company parents remain visible
-- to the validation layer and therefore continue to fail closed.
create temporary table agent_mcp_financial_tombstone_expected (
  function_signature text primary key,
  pre_repair_sha256 text not null,
  repaired_sha256 text not null
) on commit drop;

insert into agent_mcp_financial_tombstone_expected values
  ('private.agent_p2_payment_source_v1(uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,timestamp with time zone,integer)', '3ba40f78d0448acd44482132bdfc15c2bd4c56eb10247a2722c5eda8c7559ac3', '7cb67a5c9e5e4bcebd396283aeff28c50e2659c511e1035e9c235f69526dfa71'),
  ('private.agent_p2_sales_document_header_source_v1(uuid,text[],uuid,text,uuid,uuid,text,integer)', '56103a36fd0382172856521b4b109a09757de71bfb4ed65dc4c4fca5ca9884e1', '2df0fad50f58bd3a803703a46058f7474a7bdbdc148fd50d2350366b65b6ad05');

create temporary table agent_mcp_financial_tombstone_replacements (
  function_signature text not null references
    agent_mcp_financial_tombstone_expected(function_signature),
  replacement_ordinal integer not null,
  old_fragment text not null,
  new_fragment text not null,
  expected_replacement_count integer not null,
  primary key(function_signature, replacement_ordinal)
) on commit drop;

insert into agent_mcp_financial_tombstone_replacements values
  (
    'private.agent_p2_sales_document_header_source_v1(uuid,text[],uuid,text,uuid,uuid,text,integer)',
    1,
$old_estimate$      and estimate.deleted_at is null
      and (p_document_id is null or estimate.id = p_document_id)$old_estimate$,
$new_estimate$      and estimate.deleted_at is null
      and not exists (
        select 1
        from public.clients parent_client
        where parent_client.id = coalesce(
                estimate.client_ref,
                estimate.client_id
              )
          and parent_client.company_id = p_company_id
          and (
            parent_client.deleted_at is not null
               and parent_client.merged_into_client_id is null
            or parent_client.merged_into_client_id is not null
               and exists (
                 select 1
                 from public.clients merge_target
                 where merge_target.id =
                       parent_client.merged_into_client_id
                   and merge_target.id is distinct from parent_client.id
                   and merge_target.company_id = p_company_id
                   and merge_target.deleted_at is null
                   and merge_target.merged_into_client_id is null
               )
          )
          and (
            estimate.client_ref is null
            or estimate.client_id is null
            or estimate.client_ref = estimate.client_id
          )
      )
      and (p_document_id is null or estimate.id = p_document_id)$new_estimate$,
    1
  ),
  (
    'private.agent_p2_sales_document_header_source_v1(uuid,text[],uuid,text,uuid,uuid,text,integer)',
    2,
$old_invoice$      and invoice.deleted_at is null
      and (p_document_id is null or invoice.id = p_document_id)$old_invoice$,
$new_invoice$      and invoice.deleted_at is null
      and not exists (
        select 1
        from public.clients parent_client
        where parent_client.id = coalesce(
                invoice.client_ref,
                invoice.client_id
              )
          and parent_client.company_id = p_company_id
          and (
            parent_client.deleted_at is not null
               and parent_client.merged_into_client_id is null
            or parent_client.merged_into_client_id is not null
               and exists (
                 select 1
                 from public.clients merge_target
                 where merge_target.id =
                       parent_client.merged_into_client_id
                   and merge_target.id is distinct from parent_client.id
                   and merge_target.company_id = p_company_id
                   and merge_target.deleted_at is null
                   and merge_target.merged_into_client_id is null
               )
          )
          and (
            invoice.client_ref is null
            or invoice.client_id is null
            or invoice.client_ref = invoice.client_id
          )
      )
      and (p_document_id is null or invoice.id = p_document_id)$new_invoice$,
    1
  ),
  (
    'private.agent_p2_payment_source_v1(uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,timestamp with time zone,integer)',
    1,
$old_payment$    where source.company_id = p_company_id
      and (p_invoice_id is null or source.invoice_id = p_invoice_id)$old_payment$,
$new_payment$    where source.company_id = p_company_id
      and not exists (
        select 1
        from public.invoices parent_invoice
        where parent_invoice.id = source.invoice_id
          and parent_invoice.company_id = p_company_id
          and parent_invoice.deleted_at is not null
          and coalesce(
                parent_invoice.client_ref,
                parent_invoice.client_id
              ) = source.client_id
          and (
            parent_invoice.client_ref is null
            or parent_invoice.client_id is null
            or parent_invoice.client_ref = parent_invoice.client_id
          )
          and exists (
            select 1
            from public.clients parent_client
            where parent_client.id = source.client_id
              and parent_client.company_id = p_company_id
              and (
                parent_client.merged_into_client_id is null
                or exists (
                  select 1
                  from public.clients merge_target
                  where merge_target.id =
                        parent_client.merged_into_client_id
                    and merge_target.id is distinct from parent_client.id
                    and merge_target.company_id = p_company_id
                    and merge_target.deleted_at is null
                    and merge_target.merged_into_client_id is null
                )
              )
          )
      )
      and (p_invoice_id is null or source.invoice_id = p_invoice_id)$new_payment$,
    1
  );

create temporary table agent_mcp_financial_tombstone_before
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
from agent_mcp_financial_tombstone_expected expected
join pg_catalog.pg_proc procedure
  on procedure.oid = pg_catalog.to_regprocedure(
    expected.function_signature
  )::oid;

do $repair_agent_mcp_financial_tombstones$
declare
  v_expected_owner oid := (
    select role.oid
    from pg_catalog.pg_roles role
    where role.rolname = current_user
  );
  v_function record;
  v_replacement record;
  v_function_oid oid;
  v_source_sha256 text;
  v_definition text;
  v_repaired_definition text;
  v_old_count integer;
  v_new_count integer;
begin
  if (select pg_catalog.count(*) from
        agent_mcp_financial_tombstone_expected) is distinct from 2::bigint
     or (select pg_catalog.count(*) from
        agent_mcp_financial_tombstone_replacements) is distinct from 3::bigint
     or (select pg_catalog.count(*) from
        agent_mcp_financial_tombstone_before) is distinct from 2::bigint
     or exists (
       select 1
       from agent_mcp_financial_tombstone_expected expected
       where expected.pre_repair_sha256 !~ '^[0-9a-f]{64}$'
          or expected.repaired_sha256 !~ '^[0-9a-f]{64}$'
          or expected.pre_repair_sha256 = expected.repaired_sha256
     )
     or exists (
       select 1
       from agent_mcp_financial_tombstone_replacements replacement
       where replacement.old_fragment = replacement.new_fragment
          or replacement.expected_replacement_count is distinct from 1
     ) then
    raise exception 'agent_mcp_financial_tombstone_registry_invalid'
      using errcode = '55000';
  end if;

  for v_function in
    select *
    from agent_mcp_financial_tombstone_expected
    order by function_signature collate "C"
  loop
    v_function_oid := pg_catalog.to_regprocedure(
      v_function.function_signature
    )::oid;
    select pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
             ),
             'hex'
           ),
           pg_catalog.pg_get_functiondef(procedure.oid)
      into strict v_source_sha256, v_definition
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_language language
      on language.oid = procedure.prolang
    where procedure.oid = v_function_oid
      and namespace.nspname = 'private'
      and language.lanname = 'plpgsql'
      and not procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proparallel = 'u'
      and procedure.proconfig is not distinct from
            array['search_path=""']::text[]
      and procedure.proowner = v_expected_owner
      and not pg_catalog.has_function_privilege(
        'anon', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      );

    if v_source_sha256 = v_function.pre_repair_sha256 then
      v_repaired_definition := v_definition;
      for v_replacement in
        select *
        from agent_mcp_financial_tombstone_replacements replacement
        where replacement.function_signature =
              v_function.function_signature
        order by replacement.replacement_ordinal
      loop
        v_old_count := (
          pg_catalog.length(v_repaired_definition) - pg_catalog.length(
            pg_catalog.replace(
              v_repaired_definition, v_replacement.old_fragment, ''
            )
          )
        ) / pg_catalog.length(v_replacement.old_fragment);
        v_new_count := (
          pg_catalog.length(v_repaired_definition) - pg_catalog.length(
            pg_catalog.replace(
              v_repaired_definition, v_replacement.new_fragment, ''
            )
          )
        ) / pg_catalog.length(v_replacement.new_fragment);
        if v_old_count is distinct from
             v_replacement.expected_replacement_count
           or v_new_count is distinct from 0 then
          raise exception
            'agent_mcp_financial_tombstone_replacement_count: %:% old=% new=%',
            v_function.function_signature,
            v_replacement.replacement_ordinal,
            v_old_count,
            v_new_count using errcode = '55000';
        end if;
        v_repaired_definition := pg_catalog.replace(
          v_repaired_definition,
          v_replacement.old_fragment,
          v_replacement.new_fragment
        );
      end loop;
      if v_repaired_definition is not distinct from v_definition then
        raise exception 'agent_mcp_financial_tombstone_rewrite_failed: %',
          v_function.function_signature using errcode = '55000';
      end if;
      execute v_repaired_definition;
    elsif v_source_sha256 = v_function.repaired_sha256 then
      null;
    else
      raise exception 'agent_mcp_financial_tombstone_source_drift: % %',
        v_function.function_signature, v_source_sha256
        using errcode = '55000';
    end if;
  end loop;
end;
$repair_agent_mcp_financial_tombstones$;

do $agent_mcp_financial_tombstone_postcondition$
declare
  v_repaired_count integer;
  v_metadata_count integer;
  v_fragment_count integer;
begin
  select pg_catalog.count(*)::integer
    into v_repaired_count
  from agent_mcp_financial_tombstone_expected expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(
      expected.function_signature
    )::oid
  where pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
          ),
          'hex'
        ) = expected.repaired_sha256;

  select pg_catalog.count(*)::integer
    into v_metadata_count
  from agent_mcp_financial_tombstone_before before_row
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

  select pg_catalog.count(*)::integer
    into v_fragment_count
  from agent_mcp_financial_tombstone_replacements replacement
  join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(
      replacement.function_signature
    )::oid
  where procedure.prosrc like '%' || replacement.new_fragment || '%'
    and procedure.prosrc not like '%' || replacement.old_fragment || '%';

  if v_repaired_count is distinct from 2
     or v_metadata_count is distinct from 2
     or v_fragment_count is distinct from 3 then
    raise exception
      'agent_mcp_financial_tombstone_postcondition_failed: repaired=% metadata=% fragments=%',
      v_repaired_count, v_metadata_count, v_fragment_count
      using errcode = '55000';
  end if;
end;
$agent_mcp_financial_tombstone_postcondition$;

commit;
