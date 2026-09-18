\set ON_ERROR_STOP on
-- Runs after the route suite (scripts/test-permission-overrides-postgres.sh,
-- step 4) on the database the suite drove, with track_functions = all.
--
-- Every function on the save path must have run, except the ones listed
-- below, each of which cannot run during a save. The check is exact in both
-- directions: a function that should have run and did not fails it, and so
-- does a listed function that starts running (update the list and its
-- reason when the path changes).

do $permission_overrides_coverage$
declare
  v_unexpected text;
  v_ran integer;
  v_total integer;
begin
  create temp table not_run on commit drop as
  select n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    left join pg_catalog.pg_stat_user_functions s on s.funcid = p.oid
   where n.nspname in ('public', 'private', 'auth')
     and not exists (
       select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
     )
     and coalesce(s.calls, 0) = 0;

  create temp table cannot_run (signature text primary key, reason text not null) on commit drop;
  insert into cannot_run (signature, reason) values
    -- Inlined: single-statement SQL functions without SECURITY DEFINER or SET
    -- run inside the calling query and are never counted as calls. Every save
    -- evaluates auth.role() first (a non-service caller is refused by it).
    ('auth.role()', 'inlined into the calling query'),
    ('auth.jwt()', 'inlined, and only called from the manual-reassignment branch below'),
    -- change_opportunity_assignment_core serves both manual reassignment and
    -- system moves. A save's lead handoff always takes the system branch
    -- (p_is_system true), so the caller's own scope is never looked up.
    ('private.current_user_scope_for(p_permission text)', 'manual-reassignment branch only'),
    ('private.effective_permission_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)', 'manual-reassignment branch only'),
    ('private.effective_inbox_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)', 'manual-reassignment branch only'),
    ('private.should_use_inbox_view_company_compat(p_actor_user_id uuid, p_actor_company_id uuid)', 'manual-reassignment branch only'),
    ('private.get_current_user_id()', 'manual-reassignment branch only'),
    ('private.get_user_company_id()', 'manual-reassignment branch only'),
    -- Needed to build indexes on tables a save reads but never writes
    -- (clients, projects, users), so never evaluated during a save.
    ('private.agent_discovery_project_source_is_invalid(p_opportunity_id text, p_opportunity_ref uuid, p_title text, p_address text, p_status text, p_created_at timestamp with time zone, p_updated_at timestamp with time zone, p_start_date timestamp with time zone, p_end_date timestamp with time zone)', 'index on projects'),
    ('private.agent_uuid_from_legacy_text(p_value text)', 'index on projects (via agent_discovery_project_source_is_invalid)'),
    ('private.normalize_address(p text)', 'index on projects'),
    ('private.normalize_property_address(p_address text, p_include_unit boolean)', 'index on projects (via normalize_address)'),
    ('private.canonicalize_address_text(p_address text)', 'index on projects (via normalize_property_address)'),
    ('private.agent_normalize_discovery_email(p_value text)', 'index on clients'),
    ('private.agent_normalize_discovery_phone(p_value text)', 'index on clients'),
    ('private.agent_p2_optional_canonical_text(p_value text, p_maximum_scalars integer, p_maximum_utf8_bytes integer, p_allow_text_whitespace boolean)', 'index on users'),
    ('private.agent_prompt_text_is_safe(p_value text, p_allow_text_whitespace boolean)', 'index on users (via agent_p2_optional_canonical_text)');

  select string_agg(signature, E'\n  ' order by signature) into v_unexpected
    from (select signature from not_run except select signature from cannot_run) missed;
  if v_unexpected is not null then
    raise exception E'permission override coverage: these save-path functions never ran:\n  %', v_unexpected;
  end if;

  select string_agg(signature || ' (' || reason || ')', E'\n  ' order by signature) into v_unexpected
    from cannot_run where signature not in (select signature from not_run);
  if v_unexpected is not null then
    raise exception E'permission override coverage: listed as unable to run, but ran (update the list):\n  %', v_unexpected;
  end if;

  select count(*) into v_total
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'auth')
     and not exists (
       select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
     );
  v_ran := v_total - (select count(*) from not_run);
  raise notice 'coverage: % of % save-path functions ran during the route suite; the other % cannot run during a save',
    v_ran, v_total, v_total - v_ran;
end
$permission_overrides_coverage$;

select 'every save-path function that can run ran during the route suite';
