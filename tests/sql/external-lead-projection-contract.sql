\set ON_ERROR_STOP on

begin;

do $contract$
declare
  v_missing integer;
begin
  select count(*)
  into v_missing
  from (
    values
      ('private.external_lead_handles'),
      ('private.external_lead_projection_versions'),
      ('private.external_lead_projection_baselines'),
      ('private.external_lead_source_projections'),
      ('private.external_lead_projection_backfill_runs')
  ) required(relation_name)
  where to_regclass(required.relation_name) is null;

  if v_missing <> 0 then
    raise exception 'stable_public_handle foundation missing';
  end if;

  if to_regprocedure(
    'public.refresh_external_lead_projection_as_system(uuid,uuid,text)'
  ) is null then
    raise exception 'projection_dependency_refresh command missing';
  end if;

  if to_regprocedure(
    'public.verify_external_lead_projection_backfill_as_system(uuid)'
  ) is null then
    raise exception 'backfill verification command missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like '%external_lead_projection%'
      and has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
  ) then
    raise exception 'authenticated projection privilege must be denied';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
      'private.external_lead_projection_versions'::regclass
      and constraint_row.conname =
        'external_lead_projection_versions_company_sequence_key'
  ) then
    raise exception 'company_monotonic_sequence constraint missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.opportunities'::regclass
      and trigger_row.tgname =
        'external_lead_projection_on_opportunity_update'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'projection_dependency_refresh trigger missing';
  end if;
end;
$contract$;

select 'OPS_EXTERNAL_API_SQL_CONTRACT_PASS' as result;

rollback;
