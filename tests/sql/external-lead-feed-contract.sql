\set ON_ERROR_STOP on

begin;

do $contract$
begin
  if to_regprocedure(
    'public.authorize_external_lead_feed_as_system(uuid,uuid,uuid,uuid,smallint,bytea,text,bigint,boolean,text,text,timestamp with time zone)'
  ) is null then
    raise exception 'lead feed authorization command missing';
  end if;

  if to_regprocedure(
    'public.read_external_lead_feed_page_as_system(uuid,uuid,uuid,smallint,bytea,text,bigint,boolean,text,bigint,uuid,bigint,integer,jsonb)'
  ) is null then
    raise exception 'lead feed page command missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'authorize_external_lead_feed_as_system',
        'read_external_lead_feed_page_as_system'
      )
      and has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
  ) then
    raise exception 'app roles must not read the external lead feed';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'external_lead_projection_state'
      and column_name = 'retained_from_sequence'
  ) then
    raise exception 'incremental retention floor missing';
  end if;
end;
$contract$;

select 'OPS_EXTERNAL_API_SQL_CONTRACT_PASS' as result;

rollback;
