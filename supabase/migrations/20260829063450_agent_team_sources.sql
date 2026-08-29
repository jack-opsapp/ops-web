begin;

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
      ('function', 'private.bump_agent_read_domain_revision()'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('table', 'public.users')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_team_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'team'
  ) then
    raise exception 'agent_team_domain_missing' using errcode = '55000';
  end if;
end;
$prerequisites$;

do $source_shape$
declare
  v_invalid text[];
begin
  with expected(column_name, data_type) as (
    values
      ('id', 'uuid'),
      ('company_id', 'uuid'),
      ('first_name', 'text'),
      ('last_name', 'text'),
      ('profile_image_url', 'text'),
      ('user_color', 'text'),
      ('role', 'text'),
      ('is_active', 'boolean'),
      ('deleted_at', 'timestamp with time zone')
  )
  select pg_catalog.array_agg(expected.column_name order by expected.column_name)
    into v_invalid
  from expected
  left join information_schema.columns column_row
    on column_row.table_schema = 'public'
   and column_row.table_name = 'users'
   and column_row.column_name = expected.column_name
  where column_row.column_name is null
     or column_row.data_type is distinct from expected.data_type;

  if v_invalid is not null then
    raise exception 'agent_team_source_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',')
      using errcode = '55000';
  end if;
end;
$source_shape$;

create index if not exists idx_users_agent_team_directory_v1
  on public.users (
    company_id,
    (
      private.agent_p2_optional_canonical_text(
        pg_catalog.btrim(first_name) || ' ' || pg_catalog.btrim(last_name),
        256,
        1024,
        false
      )
    ) collate "C",
    id
  )
  where deleted_at is null
    and is_active is true;

drop trigger if exists users_bump_agent_team_revision
  on public.users;
create trigger users_bump_agent_team_revision
after insert or update or delete on public.users
for each row execute function private.bump_agent_read_domain_revision(
  'team',
  'company_id'
);

do $postflight$
declare
  v_index_valid boolean;
  v_index_definition text;
  v_index_predicate text;
  v_trigger_valid boolean;
begin
  select index_row.indisvalid
           and index_row.indisready
           and index_row.indislive
           and not index_row.indisunique
           and not index_row.indisprimary
           and index_row.indnkeyatts = 3
           and index_row.indnatts = 3
           and relation.relpersistence = 'p'
           and index_relation.relpersistence = 'p'
           and relation.relowner = current_user::regrole
           and index_relation.relowner = current_user::regrole,
         pg_catalog.lower(pg_catalog.pg_get_indexdef(index_row.indexrelid)),
         pg_catalog.lower(pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
           '[[:space:]]+',
           ' ',
           'g'
         ))
    into v_index_valid, v_index_definition, v_index_predicate
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class relation
    on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  where namespace.nspname = 'public'
    and relation.relname = 'users'
    and index_relation.relname = 'idx_users_agent_team_directory_v1';

  if not coalesce(v_index_valid, false)
     or v_index_definition not like '%(company_id,%agent_p2_optional_canonical_text%'
     or v_index_definition not like '%collate "c"%'
     or v_index_definition not like '%, id)%'
     or v_index_predicate is distinct from
       '((deleted_at is null) and (is_active is true))' then
    raise exception 'agent_team_source_index_shape_failed'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and trigger_row.tgtype = 29
         and procedure_namespace.nspname = 'private'
         and procedure.proname = 'bump_agent_read_domain_revision'
         and pg_catalog.encode(trigger_row.tgargs, 'escape') =
           E'team\\000company_id\\000'
       )
    into v_trigger_valid
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class relation
    on relation.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_proc procedure
    on procedure.oid = trigger_row.tgfoid
  join pg_catalog.pg_namespace procedure_namespace
    on procedure_namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and relation.relname = 'users'
    and trigger_row.tgname = 'users_bump_agent_team_revision';

  if not coalesce(v_trigger_valid, false) then
    raise exception 'agent_team_source_trigger_invalid'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
