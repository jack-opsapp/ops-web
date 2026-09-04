begin;

do $verification$
begin
  if to_regclass(
    'private.external_lead_intake_concurrency_fixture'
  ) is not null
    or to_regclass(
      'private.external_lead_intake_concurrency_results'
    ) is not null
    or to_regprocedure(
      'private.external_lead_intake_concurrency_submit(text,uuid,bytea,bytea,text,text)'
    ) is not null
  then
    raise exception 'external lead intake concurrency cleanup failed';
  end if;
end;
$verification$;

select 'OPS_EXTERNAL_API_SQL_CONTRACT_PASS';

rollback;
