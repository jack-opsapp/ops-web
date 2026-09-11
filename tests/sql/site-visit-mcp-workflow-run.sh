#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=/opt/homebrew/opt/postgresql@17/bin
scratch=$(mktemp -d /private/tmp/ops-phase19-workflow-pg.XXXXXX)
logs="$root/docs/artifacts/phase19"
mkdir -p "$scratch/socket" "$logs"
cleanup() { "$bin/pg_ctl" -D "$scratch/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$scratch"; }
trap cleanup EXIT
"$bin/initdb" -D "$scratch/data" -A trust --no-locale -E UTF8 -U postgres > "$logs/workflow-pg-init.log" 2>&1
"$bin/pg_ctl" -D "$scratch/data" -l "$logs/workflow-pg-server.log" -o "-k $scratch/socket -p 55472 -c listen_addresses='' -c max_connections=16 -c shared_buffers=32MB" -w start > "$logs/workflow-pg-start.log" 2>&1
psql_local() { "$bin/psql" -X -h "$scratch/socket" -p 55472 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
python3 "$root/tests/sql/build-site-visit-booking-fixture.py" --workflow > "$scratch/schema.sql"
psql_local -f "$scratch/schema.sql" > "$logs/workflow-pg-schema.log" 2>&1
for migration in 20260910190020_site_visit_concurrency_protocol.sql 20260910191043_site_visit_durable_writes.sql 20260910204942_site_visit_canonical_actor_booking.sql 20260911011000_site_visit_packet_discard.sql; do
 psql_local -f "$root/supabase/migrations/$migration" >> "$logs/workflow-pg-migration.log" 2>&1
done
psql_local -f "$root/tests/sql/site-visit-mcp-booking.sql" > "$logs/workflow-booking-tests.log" 2>&1
if [[ ${1:-} != baseline ]]; then
 psql_local -f "$root/supabase/migrations/20260910205717_agent_site_visit_workflow.sql" >> "$logs/workflow-pg-migration.log" 2>&1
fi
psql_local -f "$root/tests/sql/site-visit-mcp-compiler.sql" -f "$root/tests/sql/site-visit-mcp-boundaries.sql" -f "$root/tests/sql/site-visit-mcp-timezones.sql" -f "$root/tests/sql/site-visit-mcp-discovery.sql" > "$logs/workflow-${1:-tests}.log" 2>&1
psql_local -Atc "select jsonb_build_object('kind','receipt','change_set_id',id,'payload',receipt)::text from private.agent_site_visit_workflow_proposals where receipt is not null union all select jsonb_build_object('kind','proposal','change_set_id',id,'payload',proposal)::text from private.agent_site_visit_workflow_proposals union all select jsonb_build_object('kind','timezone','payload',payload)::text from private.workflow_timezone_outputs;" > "$logs/workflow-outputs.jsonl"
rg 'PASS' "$logs/workflow-${1:-tests}.log"
# Hold an ordinary writer in another transaction. Workflow must fail promptly;
# it cannot inspect an incomplete graph while a task insertion is in flight.
psql_local -c "begin; lock table public.project_tasks in row exclusive mode;" -c "\\! touch $scratch/lock-ready" -c "select pg_sleep(2); commit;" > "$logs/workflow-race-writer.log" 2>&1 &
writer_pid=$!
for i in {1..100}; do [[ -f "$scratch/lock-ready" ]] && break; sleep 0.02; done
[[ -f "$scratch/lock-ready" ]] || { echo 'Concurrent writer did not acquire its lock'; exit 1; }
if psql_local -c "select private.agent_site_visit_workflow_lock('10000000-0000-4000-8000-000000000002');" > "$logs/workflow-race-lock.log" 2>&1; then
 echo 'Workflow did not reject the concurrent task writer'; exit 1
fi
rg -q 'could not obtain lock on relation "public.project_tasks"' "$logs/workflow-race-lock.log"
wait "$writer_pid"
echo 'PASS: an ordinary task writer prevents partial workflow source inspection'
