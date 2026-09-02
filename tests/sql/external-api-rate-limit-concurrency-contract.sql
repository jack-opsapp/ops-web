begin;

do $verification$
begin
  if to_regclass(
    'private.external_api_rate_limit_concurrency_results'
  ) is not null
  then
    raise exception 'external API rate limit concurrency cleanup failed';
  end if;
end;
$verification$;

select 'OPS_EXTERNAL_API_SQL_CONTRACT_PASS';

rollback;
