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
      ('table', 'public.companies'),
      ('table', 'public.company_inventory_settings'),
      ('table', 'public.company_settings')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_company_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'company'
  ) then
    raise exception 'agent_company_domain_missing' using errcode = '55000';
  end if;
end;
$prerequisites$;

do $source_shape$
declare
  v_invalid text[];
begin
  with expected(table_name, column_name, data_type) as (
    values
      ('companies', 'id', 'uuid'),
      ('companies', 'deleted_at', 'timestamp with time zone'),
      ('companies', 'name', 'text'),
      ('companies', 'description', 'text'),
      ('companies', 'industries', 'ARRAY'),
      ('companies', 'industry', 'text'),
      ('companies', 'locale', 'text'),
      ('companies', 'timezone', 'text'),
      ('companies', 'currency_code', 'text'),
      ('companies', 'default_work_start', 'time without time zone'),
      ('companies', 'default_work_end', 'time without time zone'),
      ('companies', 'skip_weekends_in_auto_schedule', 'boolean'),
      ('companies', 'precise_scheduling_enabled', 'boolean'),
      ('companies', 'logo_url', 'text'),
      ('companies', 'website', 'text'),
      ('company_inventory_settings', 'company_id', 'uuid'),
      ('company_inventory_settings', 'inventory_mode', 'text'),
      ('company_settings', 'company_id', 'text'),
      ('company_settings', 'catalog_setup_completed_at', 'timestamp with time zone')
  )
  select pg_catalog.array_agg(
           expected.table_name || '.' || expected.column_name
           order by expected.table_name, expected.column_name
         )
    into v_invalid
  from expected
  left join information_schema.columns column_row
    on column_row.table_schema = 'public'
   and column_row.table_name = expected.table_name
   and column_row.column_name = expected.column_name
  where column_row.column_name is null
     or column_row.data_type is distinct from expected.data_type;

  if v_invalid is not null then
    raise exception 'agent_company_source_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',')
      using errcode = '55000';
  end if;
end;
$source_shape$;

drop trigger if exists companies_bump_agent_company_revision
  on public.companies;
create trigger companies_bump_agent_company_revision
after insert or update or delete on public.companies
for each row execute function private.bump_agent_read_domain_revision(
  'company',
  'id'
);

drop trigger if exists company_inventory_settings_bump_agent_company_revision
  on public.company_inventory_settings;
create trigger company_inventory_settings_bump_agent_company_revision
after insert or update or delete on public.company_inventory_settings
for each row execute function private.bump_agent_read_domain_revision(
  'company',
  'company_id'
);

drop trigger if exists company_settings_bump_agent_company_revision
  on public.company_settings;
create trigger company_settings_bump_agent_company_revision
after insert or update or delete on public.company_settings
for each row execute function private.bump_agent_read_domain_revision(
  'company',
  'company_id'
);

do $postflight$
declare
  v_expected record;
  v_valid boolean;
begin
  for v_expected in
    select *
    from (
      values
        (
          'companies',
          'companies_bump_agent_company_revision',
          E'company\\000id\\000'
        ),
        (
          'company_inventory_settings',
          'company_inventory_settings_bump_agent_company_revision',
          E'company\\000company_id\\000'
        ),
        (
          'company_settings',
          'company_settings_bump_agent_company_revision',
          E'company\\000company_id\\000'
        )
    ) expected(table_name, trigger_name, trigger_arguments)
  loop
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and trigger_row.tgtype = 29
         and procedure_namespace.nspname = 'private'
         and procedure.proname = 'bump_agent_read_domain_revision'
         and pg_catalog.encode(trigger_row.tgargs, 'escape') =
           v_expected.trigger_arguments
       )
      into v_valid
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
      and relation.relname = v_expected.table_name
      and trigger_row.tgname = v_expected.trigger_name;

    if not coalesce(v_valid, false) then
      raise exception 'agent_company_source_trigger_invalid: %',
        v_expected.trigger_name
        using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
