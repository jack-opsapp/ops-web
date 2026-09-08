#!/bin/bash
set -euo pipefail
bin=$1
socket=$2
logs=$3
psql=("$bin/psql" -X -h "$socket" -p 55485 -d postgres -v ON_ERROR_STOP=1)
"${psql[@]}" > "$logs/concurrency-prepare.log" 2>&1 <<'SQL'
set request.jwt.claim.role='service_role';
create table financial_test.concurrent_proposal as select financial_test.prepare(financial_test.request('financial-concurrent-001')) p;
create table financial_test.concurrent_before as select (select count(*) from public.estimates) documents,(select sum(last_number) from public.document_sequences) numbers;
SQL
"${psql[@]}" > "$logs/concurrency-winner.log" 2>&1 <<'SQL' &
set request.jwt.claim.role='service_role';
begin;
select financial_test.commit(p,'financial-concurrent-save') from financial_test.concurrent_proposal;
\echo WINNER_SAVED
select pg_sleep(2);
commit;
SQL
winner_pid=$!
for attempt in {1..100}; do
  if rg -q WINNER_SAVED "$logs/concurrency-winner.log"; then break; fi
  sleep 0.02
done
rg -q WINNER_SAVED "$logs/concurrency-winner.log"
"${psql[@]}" > "$logs/concurrency-contender.log" 2>&1 <<'SQL'
set request.jwt.claim.role='service_role';
select financial_test.rejects('select financial_test.commit(p,''financial-concurrent-save'') from financial_test.concurrent_proposal','FINANCIAL_DOCUMENT_BUSY','simultaneous commit refuses while winning transaction owns the document lock');
SQL
wait "$winner_pid"
"${psql[@]}" > "$logs/concurrency-readback.log" 2>&1 <<'SQL'
set request.jwt.claim.role='service_role';
select financial_test.assert((financial_test.commit(p,'financial-concurrent-save')->>'replayed')::boolean,'same key reconciles to winner after concurrent commit') from financial_test.concurrent_proposal;
select financial_test.assert((select count(*) from public.estimates)=documents+1 and (select sum(last_number) from public.document_sequences)=numbers+1,'concurrent requests allocate exactly one document and number') from financial_test.concurrent_before;
SQL
rg 'PASS:' "$logs/concurrency-contender.log" "$logs/concurrency-readback.log"
