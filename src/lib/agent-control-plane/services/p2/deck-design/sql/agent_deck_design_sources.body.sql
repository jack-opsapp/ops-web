begin;

-- Task 13 canonical deck-design source body. It replaces the broad Task 10
-- and Task 12 triggers on the three shared source tables with one literal
-- field matrix, adds the bounded canonical bridge lookup, and rejects every
-- cross-tenant design/artifact link on both write paths.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_read_domains'),
      ('function', 'private.agent_read_domain_uuid_from_text(text)'),
      ('function', 'private.advance_agent_read_domain_revisions(uuid[],text)'),
      ('table', 'public.deck_designs'),
      ('table', 'public.site_visit_artifacts'),
      ('table', 'public.site_visits')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_deck_design_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not array['artifacts', 'deck_designs', 'site_visits']::text[] <@ (
    select pg_catalog.array_agg(domain.domain order by domain.domain)
    from private.agent_read_domains domain
  ) then
    raise exception 'agent_deck_design_source_domains_missing'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.site_visit_artifacts artifact
    join public.deck_designs design on design.id = artifact.deck_design_id
    where artifact.deck_design_id is not null
      and private.agent_read_domain_uuid_from_text(artifact.company_id)
            is distinct from design.company_id
  ) then
    raise exception 'agent_deck_bridge_existing_company_integrity_violation'
      using errcode = '23514';
  end if;
end;
$prerequisites$;

create index if not exists idx_site_visit_artifacts_agent_deck_bridge_v1
  on public.site_visit_artifacts (
    pg_catalog.lower(company_id),
    site_visit_id,
    deck_design_id,
    id
  )
  where deleted_at is null
    and kind = 'deck_design'
    and source = 'deck_builder'
    and deck_design_id is not null;

create or replace function private.enforce_agent_deck_bridge_company_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_artifact_company_id uuid;
  v_design_company_id uuid;
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_nargs is distinct from 0
     or tg_table_schema is distinct from 'public'
     or tg_table_name not in ('deck_designs', 'site_visit_artifacts') then
    raise exception 'agent_deck_bridge_integrity_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_table_name = 'site_visit_artifacts' then
    if tg_op not in ('INSERT', 'UPDATE') then
      raise exception 'agent_deck_bridge_integrity_trigger_misconfigured'
        using errcode = '55000';
    end if;
    if new.deck_design_id is null then
      return null;
    end if;

    v_artifact_company_id := private.agent_read_domain_uuid_from_text(
      new.company_id
    );
    select design.company_id
      into v_design_company_id
    from public.deck_designs design
    where design.id = new.deck_design_id;

    if v_artifact_company_id is null
       or v_design_company_id is null
       or v_artifact_company_id is distinct from v_design_company_id then
      raise exception 'agent_deck_bridge_company_integrity_violation'
        using errcode = '23514';
    end if;
    return null;
  end if;

  if tg_op is distinct from 'UPDATE' then
    raise exception 'agent_deck_bridge_integrity_trigger_misconfigured'
      using errcode = '55000';
  end if;
  if old.company_id is not distinct from new.company_id then
    return null;
  end if;

  if exists (
    select 1
    from public.site_visit_artifacts artifact
    where artifact.deck_design_id = new.id
      and private.agent_read_domain_uuid_from_text(artifact.company_id)
            is distinct from new.company_id
  ) then
    raise exception 'agent_deck_bridge_company_integrity_violation'
      using errcode = '23514';
  end if;
  return null;
end;
$function$;

revoke all on function private.enforce_agent_deck_bridge_company_integrity()
  from public, anon, authenticated, service_role;

drop trigger if exists site_visit_artifacts_enforce_agent_deck_bridge_company
  on public.site_visit_artifacts;
create constraint trigger site_visit_artifacts_enforce_agent_deck_bridge_company
after insert or update on public.site_visit_artifacts
deferrable initially immediate
for each row execute function
  private.enforce_agent_deck_bridge_company_integrity();

drop trigger if exists deck_designs_enforce_agent_deck_bridge_company
  on public.deck_designs;
create constraint trigger deck_designs_enforce_agent_deck_bridge_company
after update on public.deck_designs
deferrable initially immediate
for each row execute function
  private.enforce_agent_deck_bridge_company_integrity();

create or replace function private.bump_agent_deck_design_source_revisions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_row jsonb;
  v_new_row jsonb;
  v_old_company_id uuid;
  v_new_company_id uuid;
  v_artifact_changed boolean := false;
  v_deck_changed boolean := false;
  v_site_visit_changed boolean := false;
  v_old_canonical_bridge boolean := false;
  v_new_canonical_bridge boolean := false;
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_nargs is distinct from 0
     or tg_table_schema is distinct from 'public'
     or tg_table_name not in (
       'deck_designs', 'site_visit_artifacts', 'site_visits'
     )
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_deck_design_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_row := pg_catalog.to_jsonb(old);
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      v_old_row ->> 'company_id'
    );
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_row := pg_catalog.to_jsonb(new);
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      v_new_row ->> 'company_id'
    );
  end if;

  if tg_op <> 'UPDATE' then
    v_artifact_changed := true;
    v_deck_changed := tg_table_name <> 'site_visits';
    v_site_visit_changed := tg_table_name <> 'deck_designs';
  elsif tg_table_name = 'deck_designs' then
    select coalesce(pg_catalog.bool_or(
             v_old_row -> field.value is distinct from
               v_new_row -> field.value
           ), false)
      into v_artifact_changed
    from pg_catalog.unnest(array[
      'company_id', 'id', 'project_id', 'opportunity_id', 'title',
      'created_at', 'updated_at', 'deleted_at'
    ]::text[]) field(value);

    select coalesce(pg_catalog.bool_or(
             v_old_row -> field.value is distinct from
               v_new_row -> field.value
           ), false)
      into v_deck_changed
    from pg_catalog.unnest(array[
      'company_id', 'project_id', 'opportunity_id', 'title',
      'drawing_data', 'version', 'created_at', 'updated_at', 'deleted_at'
    ]::text[]) field(value);
  elsif tg_table_name = 'site_visit_artifacts' then
    v_old_canonical_bridge :=
      v_old_row ->> 'kind' = 'deck_design'
      and v_old_row ->> 'source' = 'deck_builder'
      and v_old_row ->> 'deck_design_id' is not null;
    v_new_canonical_bridge :=
      v_new_row ->> 'kind' = 'deck_design'
      and v_new_row ->> 'source' = 'deck_builder'
      and v_new_row ->> 'deck_design_id' is not null;

    select coalesce(pg_catalog.bool_or(
             v_old_row -> field.value is distinct from
               v_new_row -> field.value
           ), false)
      into v_artifact_changed
    from pg_catalog.unnest(array[
      'company_id', 'id', 'site_visit_id', 'deck_design_id',
      'opportunity_id', 'kind', 'source', 'title', 'body', 'asset_url',
      'rendered_asset_url', 'captured_at', 'included_in_project_review',
      'created_at', 'updated_at', 'deleted_at'
    ]::text[]) field(value);
    v_site_visit_changed := v_artifact_changed;

    if v_old_canonical_bridge or v_new_canonical_bridge then
      select coalesce(pg_catalog.bool_or(
               v_old_row -> field.value is distinct from
                 v_new_row -> field.value
             ), false)
        into v_deck_changed
      from pg_catalog.unnest(array[
        'company_id', 'site_visit_id', 'deck_design_id', 'opportunity_id',
        'kind', 'source', 'captured_at', 'included_in_project_review',
        'updated_at', 'deleted_at'
      ]::text[]) field(value);
    end if;
  else
    select coalesce(pg_catalog.bool_or(
             v_old_row -> field.value is distinct from
               v_new_row -> field.value
           ), false)
      into v_artifact_changed
    from pg_catalog.unnest(array[
      'company_id', 'id', 'opportunity_id', 'project_id', 'project_ref',
      'client_id', 'client_ref', 'created_by', 'assignee_ids', 'deleted_at'
    ]::text[]) field(value);

    select coalesce(pg_catalog.bool_or(
             v_old_row -> field.value is distinct from
               v_new_row -> field.value
           ), false)
      into v_site_visit_changed
    from pg_catalog.unnest(array[
      'company_id', 'id', 'opportunity_id', 'project_id', 'project_ref',
      'client_id', 'client_ref', 'scheduled_at', 'duration_minutes',
      'assignee_ids', 'status', 'completed_at', 'notes', 'measurements',
      'created_by', 'created_at', 'updated_at', 'deleted_at', 'booked_at'
    ]::text[]) field(value);
  end if;

  if tg_table_name = 'site_visit_artifacts' and tg_op <> 'UPDATE' then
    v_old_canonical_bridge := tg_op = 'DELETE'
      and v_old_row ->> 'kind' = 'deck_design'
      and v_old_row ->> 'source' = 'deck_builder'
      and v_old_row ->> 'deck_design_id' is not null;
    v_new_canonical_bridge := tg_op = 'INSERT'
      and v_new_row ->> 'kind' = 'deck_design'
      and v_new_row ->> 'source' = 'deck_builder'
      and v_new_row ->> 'deck_design_id' is not null;
    v_deck_changed := v_old_canonical_bridge or v_new_canonical_bridge;
  end if;

  if v_artifact_changed then
    perform private.advance_agent_read_domain_revisions(
      array[v_old_company_id, v_new_company_id],
      'artifacts'
    );
  end if;
  if v_deck_changed then
    perform private.advance_agent_read_domain_revisions(
      array[v_old_company_id, v_new_company_id],
      'deck_designs'
    );
  end if;
  if v_site_visit_changed then
    perform private.advance_agent_read_domain_revisions(
      array[v_old_company_id, v_new_company_id],
      'site_visits'
    );
  end if;
  return null;
end;
$function$;

revoke all on function private.bump_agent_deck_design_source_revisions()
  from public, anon, authenticated, service_role;

-- Replace the broad earlier-domain triggers. The previous migrations' own
-- postflights still prove their state at their ledger position; this later
-- migration is the final exact field-selection authority for shared tables.
drop trigger if exists deck_designs_bump_agent_artifact_revision
  on public.deck_designs;
drop trigger if exists site_visit_artifacts_bump_agent_artifact_revision
  on public.site_visit_artifacts;
drop trigger if exists site_visit_artifacts_bump_agent_site_visit_revision
  on public.site_visit_artifacts;
drop trigger if exists site_visits_bump_agent_artifact_revision
  on public.site_visits;
drop trigger if exists site_visits_bump_agent_site_visit_revision
  on public.site_visits;

drop trigger if exists deck_designs_bump_agent_deck_design_revisions
  on public.deck_designs;
create trigger deck_designs_bump_agent_deck_design_revisions
after insert or delete or update of
  company_id,
  id,
  project_id,
  opportunity_id,
  title,
  drawing_data,
  version,
  created_at,
  updated_at,
  deleted_at
on public.deck_designs
for each row execute function private.bump_agent_deck_design_source_revisions();

drop trigger if exists site_visit_artifacts_bump_agent_deck_design_revisions
  on public.site_visit_artifacts;
create trigger site_visit_artifacts_bump_agent_deck_design_revisions
after insert or delete or update of
  company_id,
  id,
  site_visit_id,
  deck_design_id,
  opportunity_id,
  kind,
  source,
  title,
  body,
  asset_url,
  rendered_asset_url,
  captured_at,
  included_in_project_review,
  created_at,
  updated_at,
  deleted_at
on public.site_visit_artifacts
for each row execute function private.bump_agent_deck_design_source_revisions();

drop trigger if exists site_visits_bump_agent_deck_design_revisions
  on public.site_visits;
create trigger site_visits_bump_agent_deck_design_revisions
after insert or delete or update of
  company_id,
  id,
  opportunity_id,
  project_id,
  project_ref,
  client_id,
  client_ref,
  scheduled_at,
  duration_minutes,
  assignee_ids,
  status,
  completed_at,
  notes,
  measurements,
  created_by,
  created_at,
  updated_at,
  deleted_at,
  booked_at
on public.site_visits
for each row execute function private.bump_agent_deck_design_source_revisions();

alter function private.enforce_agent_deck_bridge_company_integrity()
  owner to current_user;
alter function private.bump_agent_deck_design_source_revisions()
  owner to current_user;

-- CREATE OR REPLACE preserves arbitrary historical grants. Canonicalize the
-- private trigger-helper ACLs on every replay instead of revoking only the
-- three application roles known today.
do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.enforce_agent_deck_bridge_company_integrity()',
    'private.bump_agent_deck_design_source_revisions()'
  ] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    select function_row.proowner
      into v_function_owner
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_function_oid;

    for v_acl in
      select distinct acl.grantee,
             case when acl.grantee = 0 then 'public'
               else role_row.rolname end as role_name
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where function_row.oid = v_function_oid
        and acl.grantee <> v_function_owner
    loop
      if v_acl.role_name is null then
        raise exception 'agent_deck_design_source_acl_role_missing'
          using errcode = '55000';
      end if;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',
        v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name)
        end
      );
    end loop;
  end loop;
end;
$canonical_acl$;

do $postflight$
declare
  v_index_oid oid;
  v_actual_keys text[];
  v_actual_predicate text;
  v_valid boolean;
  v_signature text;
  v_trigger_name text;
  v_table_name text;
  v_expected_fields text[];
  v_actual_fields text[];
  v_expected_trigger_type smallint;
begin
  select index_row.indexrelid,
         index_row.indisvalid
           and index_row.indisready
           and index_row.indislive
           and not index_row.indisunique
           and not index_row.indisprimary
           and index_row.indnkeyatts = 4
           and index_row.indnatts = 4
           and index_row.indoption::text = '0 0 0 0'
    into v_index_oid, v_valid
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  where namespace.nspname = 'public'
    and relation.relname = 'site_visit_artifacts'
    and index_relation.relname =
      'idx_site_visit_artifacts_agent_deck_bridge_v1';

  select pg_catalog.array_agg(
           pg_catalog.lower(pg_catalog.regexp_replace(
             pg_catalog.pg_get_indexdef(v_index_oid, position.value, true),
             '[[:space:]]+', ' ', 'g'
           ))
           order by position.value
         )
    into v_actual_keys
  from pg_catalog.generate_series(1, 4) position(value);

  select pg_catalog.lower(pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
           '[[:space:]]+', ' ', 'g'
         ))
    into v_actual_predicate
  from pg_catalog.pg_index index_row
  where index_row.indexrelid = v_index_oid;

  if v_index_oid is null
     or not coalesce(v_valid, false)
     or v_actual_keys is distinct from array[
       'lower(company_id)', 'site_visit_id', 'deck_design_id', 'id'
     ]::text[]
     or v_actual_predicate is distinct from
       '((deleted_at is null) and (kind = ''deck_design''::text) and (source = ''deck_builder''::text) and (deck_design_id is not null))' then
    raise exception 'agent_deck_design_index_shape_failed'
      using errcode = '55000';
  end if;

  foreach v_signature in array array[
    'private.enforce_agent_deck_bridge_company_integrity()',
    'private.bump_agent_deck_design_source_revisions()'
  ] loop
    select procedure.prosecdef
       and procedure.provolatile = 'v'
       and procedure.proparallel = 'u'
       and not procedure.proisstrict
       and procedure.prorettype = 'pg_catalog.trigger'::regtype::oid
       and language_row.lanname = 'plpgsql'
       and procedure.proowner = current_user::regrole::oid
       and procedure.proconfig = array['search_path=""']::text[]
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
      into v_valid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language_row
      on language_row.oid = procedure.prolang
    where procedure.oid = pg_catalog.to_regprocedure(v_signature);
    if not coalesce(v_valid, false) then
      raise exception 'agent_deck_design_source_function_invalid: %',
        v_signature using errcode = '55000';
    end if;
  end loop;

  for v_trigger_name, v_table_name, v_expected_fields in
    values
      (
        'deck_designs_bump_agent_deck_design_revisions',
        'deck_designs',
        array[
          'company_id', 'id', 'project_id', 'opportunity_id', 'title',
          'drawing_data', 'version', 'created_at', 'updated_at', 'deleted_at'
        ]::text[]
      ),
      (
        'site_visit_artifacts_bump_agent_deck_design_revisions',
        'site_visit_artifacts',
        array[
          'company_id', 'id', 'site_visit_id', 'deck_design_id',
          'opportunity_id', 'kind', 'source', 'title', 'body', 'asset_url',
          'rendered_asset_url', 'captured_at', 'included_in_project_review',
          'created_at', 'updated_at', 'deleted_at'
        ]::text[]
      ),
      (
        'site_visits_bump_agent_deck_design_revisions',
        'site_visits',
        array[
          'company_id', 'id', 'opportunity_id', 'project_id', 'project_ref',
          'client_id', 'client_ref', 'scheduled_at', 'duration_minutes',
          'assignee_ids', 'status', 'completed_at', 'notes', 'measurements',
          'created_by', 'created_at', 'updated_at', 'deleted_at', 'booked_at'
        ]::text[]
      )
  loop
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and trigger_row.tgtype = 29
         and procedure.proname = 'bump_agent_deck_design_source_revisions'
         and procedure_namespace.nspname = 'private'
         and trigger_row.tgargs = ''::bytea
       )
      into v_valid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc procedure on procedure.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and relation.relname = v_table_name
      and trigger_row.tgname = v_trigger_name;
    if not coalesce(v_valid, false) then
      raise exception 'agent_deck_design_source_trigger_invalid: %',
        v_trigger_name using errcode = '55000';
    end if;

    select pg_catalog.array_agg(
             attribute.attname order by selected.ordinality
           )
      into v_actual_fields
    from pg_catalog.pg_trigger trigger_row
    cross join lateral pg_catalog.unnest(
      trigger_row.tgattr::smallint[]
    ) with ordinality selected(attribute_number, ordinality)
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = trigger_row.tgrelid
     and attribute.attnum = selected.attribute_number
    join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = v_table_name
      and trigger_row.tgname = v_trigger_name;
    if v_actual_fields is distinct from v_expected_fields then
      raise exception 'agent_deck_design_source_trigger_invalid: %',
        v_trigger_name using errcode = '55000';
    end if;
  end loop;

  for v_trigger_name, v_table_name, v_expected_trigger_type in
    values
      (
        'deck_designs_enforce_agent_deck_bridge_company',
        'deck_designs',
        17::smallint
      ),
      (
        'site_visit_artifacts_enforce_agent_deck_bridge_company',
        'site_visit_artifacts',
        21::smallint
      )
  loop
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and trigger_row.tgtype = v_expected_trigger_type
         and trigger_row.tgdeferrable
         and not trigger_row.tginitdeferred
         and trigger_row.tgconstraint <> 0
         and trigger_row.tgconstrrelid = 0
         and pg_catalog.cardinality(
           trigger_row.tgattr::smallint[]
         ) = 0
         and procedure.proname =
           'enforce_agent_deck_bridge_company_integrity'
         and procedure_namespace.nspname = 'private'
       )
      into v_valid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc procedure on procedure.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and relation.relname = v_table_name
      and trigger_row.tgname = v_trigger_name;
    if not coalesce(v_valid, false) then
      raise exception 'agent_deck_design_source_trigger_invalid: %',
        v_trigger_name using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
