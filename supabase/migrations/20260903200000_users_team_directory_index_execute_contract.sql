-- Cluster M — repair the execution contract of public.idx_users_agent_team_directory_v1.
--
-- 20260829063450_agent_team_sources.sql created a partial expression index on public.users
-- whose key expression calls private.agent_p2_optional_canonical_text(...). That function is
-- SECURITY INVOKER and was granted EXECUTE only to postgres, as was its nested callee
-- private.agent_prompt_text_is_safe(...). Postgres evaluates index expressions with the
-- privileges of the writing role, so every non-postgres INSERT into public.users, and every
-- UPDATE that could not be applied HOT, failed with 42501 from 2026-08-29 onward.
--
-- The two sibling helpers in the same family (agent_trim_discovery_display_text,
-- agent_discovery_unicode15_text_is_supported) were already granted to these three roles.
-- Both functions granted here are IMMUTABLE, STRICT, PARALLEL SAFE, have a pinned search_path,
-- and read no table data — they are deterministic text validators. Granting EXECUTE discloses
-- nothing a caller could not compute locally, and is the minimum that makes the index
-- maintainable. Marking them SECURITY DEFINER is NOT an alternative: Postgres checks EXECUTE
-- before honouring SECURITY DEFINER, so it would fail identically, and a SECURITY DEFINER
-- function inside an index expression is a privilege-escalation hazard.
begin;

do $preflight$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_prompt_text_is_safe(text,boolean)'),
      ('table',    'public.users')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'cluster_m_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  -- The grant is only safe because these are SECURITY INVOKER, side-effect-free validators.
  -- If either ever becomes SECURITY DEFINER or VOLATILE, stop and re-reason before granting.
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('agent_p2_optional_canonical_text', 'agent_prompt_text_is_safe')
      and (p.prosecdef or p.provolatile <> 'i')
  ) then
    raise exception 'cluster_m_helper_contract_changed' using errcode = '55000';
  end if;

  -- The index that forces caller-side evaluation must still exist and still call the helper.
  if not exists (
    select 1
    from pg_catalog.pg_index x
    join pg_catalog.pg_class i on i.oid = x.indexrelid
    join pg_catalog.pg_class c on c.oid = x.indrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'users'
      and i.relname = 'idx_users_agent_team_directory_v1'
      and pg_catalog.pg_get_indexdef(x.indexrelid)
            like '%private.agent_p2_optional_canonical_text%'
  ) then
    raise exception 'cluster_m_target_index_missing' using errcode = '55000';
  end if;
end;
$preflight$;

grant execute on function
  private.agent_p2_optional_canonical_text(text, integer, integer, boolean)
  to anon, authenticated, service_role;

grant execute on function
  private.agent_prompt_text_is_safe(text, boolean)
  to anon, authenticated, service_role;

do $postflight$
declare
  v_ungranted text[];
begin
  -- Generalised invariant: every private function reachable from a public index expression must
  -- be executable by all three API roles. Descend only through SECURITY INVOKER functions — a
  -- SECURITY DEFINER boundary switches execution to the owner, so its callees are out of scope
  -- (this is why private.canonicalize_address_text and private.normalize_property_address, which
  -- are reached only via the SECURITY DEFINER private.normalize_address, correctly do not appear).
  with recursive idx as (
    select pg_catalog.pg_get_indexdef(x.indexrelid) as def
    from pg_catalog.pg_index x
    join pg_catalog.pg_class c on c.oid = x.indrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and pg_catalog.pg_get_indexdef(x.indexrelid) like '%private.%'
  ),
  pf as (
    select p.oid, p.proname, p.prosrc, p.prosecdef
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
  ),
  reach as (
    select distinct f.oid, f.proname, f.prosecdef
    from idx, pf f
    where idx.def like '%private.' || f.proname || '(%'
    union
    select f2.oid, f2.proname, f2.prosecdef
    from reach r
    join pf f1 on f1.oid = r.oid and f1.prosecdef = false
    join pf f2 on f1.prosrc like '%private.' || f2.proname || '(%' and f2.oid <> f1.oid
  )
  select pg_catalog.array_agg(
           r.proname || '(' || pg_catalog.pg_get_function_identity_arguments(r.oid) || ')'
           order by r.proname
         )
    into v_ungranted
  from reach r
  where not (
        pg_catalog.has_function_privilege('service_role',  r.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('anon',          r.oid, 'EXECUTE')
  );

  if v_ungranted is not null then
    raise exception 'cluster_m_index_execute_contract_incomplete: %',
      pg_catalog.array_to_string(v_ungranted, ',')
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
