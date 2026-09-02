\set ON_ERROR_STOP on

begin;

do $contract$
declare
  v_spring jsonb;
  v_fall jsonb;
  v_direct uuid := '11111111-1111-4111-8111-111111111111';
  v_project uuid := '22222222-2222-4222-8222-222222222222';
begin
  if to_regprocedure(
    'public.authorize_external_lead_metrics_as_system(uuid,uuid,uuid,uuid,smallint,bytea,text,bigint,boolean,boolean,text,text,text,text,text,text,text,timestamp with time zone)'
  ) is null then
    raise exception 'metrics authorization command missing';
  end if;

  if to_regprocedure(
    'public.read_external_lead_metrics_v1_as_system(uuid,uuid,uuid,smallint,bytea,text,bigint,boolean,bigint,timestamp with time zone,timestamp with time zone,date,date,text,text,text[],text[],text,text,text,timestamp with time zone,timestamp with time zone)'
  ) is null then
    raise exception 'metrics read command missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'authorize_external_lead_metrics_as_system',
        'read_external_lead_metrics_v1_as_system'
      )
      and has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
  ) then
    raise exception 'app roles must not read external metrics';
  end if;

  v_spring := private.resolve_external_metric_range(
    'America/Vancouver',
    '2026-03-08T19:00:00Z'::timestamptz,
    '7d',
    null,
    null,
    false
  );
  if v_spring ->> 'from' <> '2026-03-02T08:00:00+00:00'
    or v_spring ->> 'to' <> '2026-03-09T07:00:00+00:00'
  then
    raise exception 'spring DST range is not company-local';
  end if;

  v_fall := private.resolve_external_metric_range(
    'America/Vancouver',
    '2026-11-01T20:00:00Z'::timestamptz,
    '7d',
    null,
    null,
    false
  );
  if v_fall ->> 'from' <> '2026-10-26T07:00:00+00:00'
    or v_fall ->> 'to' <> '2026-11-02T08:00:00+00:00'
  then
    raise exception 'fall DST range is not company-local';
  end if;

  if private.resolve_external_financial_opportunity(v_direct, v_project)
      <> v_direct
  then
    raise exception 'direct invoice opportunity must win';
  end if;

  begin
    perform private.resolve_external_metric_range(
      'America/Vancouver',
      '2026-07-27T12:00:00Z'::timestamptz,
      'custom',
      '2026-07-01T07:30:00Z',
      '2026-07-08T07:00:00Z',
      true
    );
    raise exception 'financial timestamp alignment was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'external_metric_date_alignment_required' then
        raise;
      end if;
  end;
end;
$contract$;

select 'OPS_EXTERNAL_API_SQL_CONTRACT_PASS' as result;

rollback;
