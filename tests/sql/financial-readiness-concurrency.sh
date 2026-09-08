#!/bin/bash
set -euo pipefail
bin=$1
socket=$2
port=$3
database=$4
logs=$5
[[ "$database" =~ ^ops_p16_[0-9]+_[0-9]+$ ]] || exit 1
psql=("$bin/psql" -X -h "$socket" -p "$port" -d "$database" -v ON_ERROR_STOP=1)
"${psql[@]}" > "$logs/concurrency-prepare.log" 2>&1 <<'SQL'
set request.jwt.claim.role='service_role';
set timezone='UTC';
update public.project_notes set deleted_at=null where id='40000000-0000-4000-8000-000000000001';
create table financial_test.concurrent_policies as select financial_test.policy_preview(financial_test.policy_request('concurrent-owner-1')) winner_preview,financial_test.policy_preview(financial_test.policy_request('concurrent-owner-2')) competing_preview;
create table financial_test.policy_counts as select (select count(*) from private.financial_document_policies) policies,(select count(*) from public.notifications) notifications;
SQL
"${psql[@]}" > "$logs/concurrency-winner.log" 2>&1 <<'SQL' &
set request.jwt.claim.role='service_role';
set timezone='UTC';
begin;
select financial_test.policy_enroll(winner_preview) from financial_test.concurrent_policies;
\echo WINNER_ENROLLED
select pg_sleep(2);
commit;
SQL
winner_pid=$!
for attempt in {1..100}; do
  if rg -q WINNER_ENROLLED "$logs/concurrency-winner.log"; then break; fi
  sleep 0.02
done
rg -q WINNER_ENROLLED "$logs/concurrency-winner.log"
"${psql[@]}" > "$logs/concurrency-contender.log" 2>&1 <<'SQL'
set request.jwt.claim.role='service_role';
set timezone='UTC';
select financial_test.rejects('select financial_test.policy_enroll(winner_preview) from financial_test.concurrent_policies','FINANCIAL_DOCUMENT_BUSY','concurrent owner enrollment fails closed while winner holds company lock');
SQL
wait "$winner_pid"
"${psql[@]}" > "$logs/concurrency-readback.log" 2>&1 <<'SQL'
set request.jwt.claim.role='service_role';
set timezone='UTC';
select financial_test.assert((financial_test.policy_enroll(winner_preview)->>'replayed')::boolean,'exact owner request reconciles to winning receipt') from financial_test.concurrent_policies;
select financial_test.rejects('select financial_test.policy_enroll(competing_preview) from financial_test.concurrent_policies','PRIOR_STALE','competing policy preview cannot supersede unseen winner');
select financial_test.assert((select count(*) from private.financial_document_policies)=policies+1 and (select count(*) from public.notifications)=notifications+1,'concurrent enrollment creates exactly one policy and notification') from financial_test.policy_counts;
SQL
rg 'PASS:' "$logs/concurrency-contender.log" "$logs/concurrency-readback.log"
