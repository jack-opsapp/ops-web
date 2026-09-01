begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

-- An opportunity can exist before OPS resolves a customer record. Repair the
-- three live site-visit projections so that a NULL client does not erase an
-- otherwise visible opportunity-linked visit. Any client edge on the visit or
-- linked opportunity must resolve consistently to one active, same-company,
-- actor-visible client; the unlinked variant has no client edge at all.
create temporary table agent_site_visit_nullable_client_expected (
  function_signature text primary key,
  pre_repair_sha256 text not null,
  repaired_sha256 text not null,
  expected_language text not null,
  expected_volatility text not null,
  expected_parallel text not null,
  expected_strict boolean not null,
  expected_security_definer boolean not null
) on commit drop;

insert into agent_site_visit_nullable_client_expected values
  (
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)',
    '43bde004cd4a44b3b67d94ace66bfd2708660c6019f2f1706d226e284ef01416',
    '5d5d360bfdb238bc0c930f84b9d1c4b10813e4f62361c5ebc30e1d7af5d2193e',
    'plpgsql', 's', 'u', false, false
  ),
  (
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    '2459fd55d792a79dfbf6648402486586d5eed730cf00cae24d7b797cb0108b9e',
    'b1e99528351b7b90c332bae60b101003b94bff3d33f089fe4b57def0298e7cbe',
    'plpgsql', 's', 'u', false, false
  ),
  (
    'private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)',
    'cc27147a5e58ae386522b0e6e67d96743532739acb30abd8f058e4a66f9cdfbd',
    '05e16807368b3ce462483ea3016c697b4c501d17c8b8086e3383785b9708f267',
    'plpgsql', 's', 'u', false, false
  );

create temporary table agent_site_visit_nullable_client_replacements (
  function_signature text not null references
    agent_site_visit_nullable_client_expected(function_signature),
  replacement_ordinal integer not null,
  old_fragment text not null,
  new_fragment text not null,
  expected_replacement_count integer not null,
  primary key (function_signature, replacement_ordinal)
) on commit drop;

insert into agent_site_visit_nullable_client_replacements values
  (
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)',
    1,
$old_list_link$
        raw.opportunity_id is not null
        and raw.client_id is not null
$old_list_link$,
$new_list_link$
        raw.opportunity_id is not null
$new_list_link$,
    2
  ),
  (
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)',
    2,
$old_list_client_row$
        and client.id is not null$old_list_client_row$,
    '',
    1
  ),
  (
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)',
    3,
$old_list_client_reference$
               visit.opportunity_id,
               coalesce(
                 visit.client_ref,$old_list_client_reference$,
$new_list_client_reference$
               visit.opportunity_id,
               (
                 visit.client_ref is not null
                 or visit.client_id is not null
               ) as has_client_reference,
               (
                 visit.client_id is not null
                 and private.agent_p2_site_visit_uuid_from_text(
                   visit.client_id
                 ) is null
                 or visit.client_ref is not null
                    and visit.client_id is not null
                    and visit.client_ref is distinct from
                      private.agent_p2_site_visit_uuid_from_text(
                        visit.client_id
                      )
               ) as client_reference_invalid,
               coalesce(
                 visit.client_ref,$new_list_client_reference$,
    2
  ),
  (
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)',
    4,
$old_list_client_acl$        and private.agent_user_can_access_entity(
          p_actor_user_id,
          p_company_id,
          'client',
          raw.client_id,
          'view'
        )$old_list_client_acl$,
$new_list_client_acl$        and (
          not raw.has_client_reference
          and opportunity.client_ref is null
          and opportunity.client_id is null
          or not raw.client_reference_invalid
             and (
               opportunity.client_ref is null
               or opportunity.client_id is null
               or opportunity.client_ref = opportunity.client_id
             )
             and (
               raw.client_id is null
               or coalesce(
                    opportunity.client_ref,
                    opportunity.client_id
                  ) is null
               or raw.client_id = coalesce(
                    opportunity.client_ref,
                    opportunity.client_id
                  )
             )
             and coalesce(
               raw.client_id,
               opportunity.client_ref,
               opportunity.client_id
             ) is not null
             and client.id is not null
             and private.agent_user_can_access_entity(
               p_actor_user_id,
               p_company_id,
               'client',
               coalesce(
                 raw.client_id,
                 opportunity.client_ref,
                 opportunity.client_id
               ),
               'view'
             )
        )$new_list_client_acl$,
    1
  ),
  (
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)',
    5,
$old_list_effective_client_join$    left join public.clients client
      on client.id = raw.client_id$old_list_effective_client_join$,
$new_list_effective_client_join$    left join public.clients client
      on client.id = coalesce(
        raw.client_id,
        opportunity.client_ref,
        opportunity.client_id
      )$new_list_effective_client_join$,
    1
  ),
  (
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)',
    6,
$old_list_unlinked$        or raw.opportunity_id is null
           and raw.project_ref is null
           and raw.project_id is null
           and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'$old_list_unlinked$,
$new_list_unlinked$        or raw.opportunity_id is null
           and raw.project_ref is null
           and raw.project_id is null
           and not raw.has_client_reference
           and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'$new_list_unlinked$,
    1
  ),
  (
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    1,
$old_context_client_row$
      and source.resolved_client_id is not null
      and client.id is not null$old_context_client_row$,
    '',
    1
  ),
  (
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    2,
$old_context_client_reference$    select visit.*,
           coalesce(
             visit.client_ref,$old_context_client_reference$,
$new_context_client_reference$    select visit.*,
           (
             visit.client_ref is not null
             or visit.client_id is not null
           ) as has_client_reference,
           (
             visit.client_id is not null
             and private.agent_p2_site_visit_uuid_from_text(
               visit.client_id
             ) is null
             or visit.client_ref is not null
                and visit.client_id is not null
                and visit.client_ref is distinct from
                  private.agent_p2_site_visit_uuid_from_text(
                    visit.client_id
                  )
           ) as client_reference_invalid,
           coalesce(
             visit.client_ref,$new_context_client_reference$,
    1
  ),
  (
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    3,
$old_context_client_acl$      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'client',
        source.resolved_client_id,
        'view'
      )$old_context_client_acl$,
$new_context_client_acl$      and (
        not source.has_client_reference
        and opportunity.client_ref is null
        and opportunity.client_id is null
        or not source.client_reference_invalid
           and (
             opportunity.client_ref is null
             or opportunity.client_id is null
             or opportunity.client_ref = opportunity.client_id
           )
           and (
             source.resolved_client_id is null
             or coalesce(
                  opportunity.client_ref,
                  opportunity.client_id
                ) is null
             or source.resolved_client_id = coalesce(
                  opportunity.client_ref,
                  opportunity.client_id
                )
           )
           and coalesce(
             source.resolved_client_id,
             opportunity.client_ref,
             opportunity.client_id
           ) is not null
           and client.id is not null
           and private.agent_user_can_access_entity(
             p_actor_user_id,
             p_company_id,
             'client',
             coalesce(
               source.resolved_client_id,
               opportunity.client_ref,
               opportunity.client_id
             ),
             'view'
           )
      )$new_context_client_acl$,
    1
  ),
  (
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    4,
$old_context_effective_client$  ), selected_visit as materialized (
    select source.*
    from visit_source_gate source$old_context_effective_client$,
$new_context_effective_client$  ), selected_visit as materialized (
    select source.*,
           coalesce(
             source.resolved_client_id,
             opportunity.client_ref,
             opportunity.client_id
           ) as effective_client_id
    from visit_source_gate source$new_context_effective_client$,
    1
  ),
  (
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    5,
$old_context_effective_client_join$    left join public.clients client
      on client.id = source.resolved_client_id$old_context_effective_client_join$,
$new_context_effective_client_join$    left join public.clients client
      on client.id = coalesce(
        source.resolved_client_id,
        opportunity.client_ref,
        opportunity.client_id
      )$new_context_effective_client_join$,
    1
  ),
  (
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    6,
$old_context_unlinked$      or p_expected_anchor = 'unlinked'
         and source.opportunity_id is null
         and source.project_ref is null
         and source.project_id is null
         and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'$old_context_unlinked$,
$new_context_unlinked$      or p_expected_anchor = 'unlinked'
         and source.opportunity_id is null
         and source.project_ref is null
         and source.project_id is null
         and not source.has_client_reference
         and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'$new_context_unlinked$,
    1
  ),
  (
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    7,
$old_context_effective_projection$           selected.resolved_client_id,
           selected.site_visit_revision,$old_context_effective_projection$,
$new_context_effective_projection$           selected.effective_client_id as resolved_client_id,
           selected.site_visit_revision,$new_context_effective_projection$,
    1
  ),
  (
    'private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)',
    1,
$old_attention_link$
        raw.opportunity_id is not null
        and raw.client_id is not null
$old_attention_link$,
$new_attention_link$
        raw.opportunity_id is not null
$new_attention_link$,
    2
  ),
  (
    'private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)',
    2,
$old_attention_client_row$
        and client.id is not null$old_attention_client_row$,
    '',
    1
  ),
  (
    'private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)',
    3,
$old_attention_client_reference$
               visit.opportunity_id,
               coalesce(
                 visit.client_ref,$old_attention_client_reference$,
$new_attention_client_reference$
               visit.opportunity_id,
               (
                 visit.client_ref is not null
                 or visit.client_id is not null
               ) as has_client_reference,
               (
                 visit.client_id is not null
                 and private.agent_p2_site_visit_uuid_from_text(
                   visit.client_id
                 ) is null
                 or visit.client_ref is not null
                    and visit.client_id is not null
                    and visit.client_ref is distinct from
                      private.agent_p2_site_visit_uuid_from_text(
                        visit.client_id
                      )
               ) as client_reference_invalid,
               coalesce(
                 visit.client_ref,$new_attention_client_reference$,
    2
  ),
  (
    'private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)',
    4,
$old_attention_client_acl$        and private.agent_user_can_access_entity(
          p_actor_user_id,
          p_company_id,
          'client',
          raw.client_id,
          'view'
        )$old_attention_client_acl$,
$new_attention_client_acl$        and (
          not raw.has_client_reference
          and opportunity.client_ref is null
          and opportunity.client_id is null
          or not raw.client_reference_invalid
             and (
               opportunity.client_ref is null
               or opportunity.client_id is null
               or opportunity.client_ref = opportunity.client_id
             )
             and (
               raw.client_id is null
               or coalesce(
                    opportunity.client_ref,
                    opportunity.client_id
                  ) is null
               or raw.client_id = coalesce(
                    opportunity.client_ref,
                    opportunity.client_id
                  )
             )
             and coalesce(
               raw.client_id,
               opportunity.client_ref,
               opportunity.client_id
             ) is not null
             and client.id is not null
             and private.agent_user_can_access_entity(
               p_actor_user_id,
               p_company_id,
               'client',
               coalesce(
                 raw.client_id,
                 opportunity.client_ref,
                 opportunity.client_id
               ),
               'view'
             )
        )$new_attention_client_acl$,
    1
  ),
  (
    'private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)',
    5,
$old_attention_effective_client_join$    left join public.clients client
      on client.id = raw.client_id$old_attention_effective_client_join$,
$new_attention_effective_client_join$    left join public.clients client
      on client.id = coalesce(
        raw.client_id,
        opportunity.client_ref,
        opportunity.client_id
      )$new_attention_effective_client_join$,
    1
  ),
  (
    'private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)',
    6,
$old_attention_unlinked$        or raw.opportunity_id is null
           and raw.project_ref is null
           and raw.project_id is null
           and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'$old_attention_unlinked$,
$new_attention_unlinked$        or raw.opportunity_id is null
           and raw.project_ref is null
           and raw.project_id is null
           and not raw.has_client_reference
           and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'$new_attention_unlinked$,
    1
  );

create temporary table agent_site_visit_nullable_client_before
on commit drop as
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
  procedure.proargnames,
  extensions.digest(
    pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
  ) as source_digest
from agent_site_visit_nullable_client_expected expected
join pg_catalog.pg_proc procedure
  on procedure.oid = pg_catalog.to_regprocedure(
    expected.function_signature
  )::oid;

do $repair_agent_site_visit_nullable_client$
declare
  v_expected_function_count constant integer := 3;
  v_expected_replacement_count constant integer := 19;
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
begin
  if (select pg_catalog.count(*)
      from agent_site_visit_nullable_client_expected) is distinct from
       v_expected_function_count::bigint
     or (select pg_catalog.count(*)
         from agent_site_visit_nullable_client_replacements) is distinct from
       v_expected_replacement_count::bigint
     or (select pg_catalog.count(*)
         from agent_site_visit_nullable_client_before) is distinct from
       v_expected_function_count::bigint
     or exists (
       select 1
       from agent_site_visit_nullable_client_expected expected
       where expected.pre_repair_sha256 !~ '^[0-9a-f]{64}$'
          or expected.repaired_sha256 !~ '^[0-9a-f]{64}$'
          or expected.pre_repair_sha256 = expected.repaired_sha256
          or expected.expected_language <> 'plpgsql'
          or expected.expected_volatility <> 's'
          or expected.expected_parallel <> 'u'
          or expected.expected_strict
          or expected.expected_security_definer
     )
     or exists (
       select 1
       from agent_site_visit_nullable_client_replacements replacement
       where replacement.old_fragment = ''
          or replacement.old_fragment = replacement.new_fragment
          or replacement.expected_replacement_count <= 0
     )
     or exists (
       select 1
       from agent_site_visit_nullable_client_before before_row
       join agent_site_visit_nullable_client_expected expected
         using (function_signature)
       join pg_catalog.pg_proc procedure on procedure.oid = before_row.oid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = procedure.pronamespace
       join pg_catalog.pg_language language
         on language.oid = procedure.prolang
       where namespace.nspname <> 'private'
          or language.lanname <> expected.expected_language
          or procedure.proowner <> v_expected_owner
          or procedure.prosecdef <> expected.expected_security_definer
          or procedure.provolatile::text <> expected.expected_volatility
          or procedure.proparallel::text <> expected.expected_parallel
          or procedure.proisstrict <> expected.expected_strict
          or procedure.proconfig is distinct from
               array['search_path=""']::text[]
     )
     or exists (
       select 1
       from agent_site_visit_nullable_client_before before_row
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
       from agent_site_visit_nullable_client_before before_row
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
    raise exception 'agent_site_visit_nullable_client_registry_invalid'
      using errcode = '55000';
  end if;

  for v_function in
    select *
    from agent_site_visit_nullable_client_expected
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
    where procedure.oid = v_function_oid;

    if v_source_sha256 = v_function.pre_repair_sha256 then
      v_repaired_definition := v_definition;
      for v_replacement in
        select *
        from agent_site_visit_nullable_client_replacements replacement
        where replacement.function_signature =
              v_function.function_signature
        order by replacement.replacement_ordinal
      loop
        v_old_count := (
          pg_catalog.length(v_repaired_definition) - pg_catalog.length(
            pg_catalog.replace(
              v_repaired_definition,
              v_replacement.old_fragment,
              ''
            )
          )
        ) / pg_catalog.length(v_replacement.old_fragment);
        if v_old_count is distinct from
             v_replacement.expected_replacement_count then
          raise exception
            'agent_site_visit_nullable_client_replacement_count: % ordinal=% count=%',
            v_function.function_signature,
            v_replacement.replacement_ordinal,
            v_old_count
            using errcode = '55000';
        end if;
        v_repaired_definition := pg_catalog.replace(
          v_repaired_definition,
          v_replacement.old_fragment,
          v_replacement.new_fragment
        );
      end loop;
      if v_repaired_definition is not distinct from v_definition then
        raise exception 'agent_site_visit_nullable_client_rewrite_failed: %',
          v_function.function_signature using errcode = '55000';
      end if;
      execute v_repaired_definition;
    elsif v_source_sha256 = v_function.repaired_sha256 then
      null;
    else
      raise exception 'agent_site_visit_nullable_client_source_drift: % %',
        v_function.function_signature,
        v_source_sha256
        using errcode = '55000';
    end if;
  end loop;
end;
$repair_agent_site_visit_nullable_client$;

do $agent_site_visit_nullable_client_postflight$
declare
  v_expected_function_count constant integer := 3;
  v_preserved_count integer;
  v_repaired_count integer;
begin
  select pg_catalog.count(*)::integer into v_preserved_count
  from agent_site_visit_nullable_client_before before_row
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

  select pg_catalog.count(*)::integer into v_repaired_count
  from agent_site_visit_nullable_client_expected expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(
      expected.function_signature
    )::oid
   and pg_catalog.encode(
         extensions.digest(
           pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
         ),
         'hex'
       ) = expected.repaired_sha256;

  if v_preserved_count is distinct from v_expected_function_count
     or v_repaired_count is distinct from v_expected_function_count
     or exists (
       select 1
       from agent_site_visit_nullable_client_before before_row
       join pg_catalog.pg_proc procedure on procedure.oid = before_row.oid
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure.proacl,
           pg_catalog.acldefault('f', procedure.proowner)
         )
       ) acl
       where acl.grantee <> procedure.proowner
     ) then
    raise exception
      'agent_site_visit_nullable_client_postflight_failed: preserved=% repaired=%',
      v_preserved_count,
      v_repaired_count
      using errcode = '55000';
  end if;
end;
$agent_site_visit_nullable_client_postflight$;

commit;
