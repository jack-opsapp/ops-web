#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=/opt/homebrew/opt/postgresql@17/bin
scratch=$(mktemp -d /private/tmp/ops-p19-rate.XXXXXX)
trap '"$bin/pg_ctl" -D "$scratch/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$scratch"' EXIT
mkdir "$scratch/socket"
"$bin/initdb" -D "$scratch/data" -A trust --no-locale -U postgres >/dev/null
"$bin/pg_ctl" -D "$scratch/data" -l "$scratch/server.log" -o "-k $scratch/socket -p 55471 -c listen_addresses=''" -w start >/dev/null
psql_local(){ "$bin/psql" -X -h "$scratch/socket" -p 55471 -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_local -f "$root/tests/sql/site-visit-rate-schema.sql" >/dev/null
psql_local -f "$root/supabase/migrations/20260911010000_site_visit_workflow_rate_limit.sql" >/dev/null
psql_local -f "$root/tests/sql/site-visit-rate-runtime.sql"
pids=()
for i in {1..10}; do psql_local -c "select set_config('request.role','service_role',false);insert into public.rate_race select public.rate_call();" > "$scratch/race-$i.log" 2>&1 & pids+=("$!"); done
for pid in "${pids[@]}"; do wait "$pid"; done
psql_local -c "select public.rate_assert((select count(*) filter(where allowed)=6 and count(*)=10 from public.rate_race),'ten simultaneous requests have exactly six winners');select public.rate_assert((select units_used=2 from private.agent_mcp_rate_limit_buckets where policy_id='mcp-lightweight-read:2026-08-23.v1'),'existing policy bucket unchanged');"
