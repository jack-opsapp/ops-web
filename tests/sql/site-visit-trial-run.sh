#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=/opt/homebrew/opt/postgresql@17/bin
node=/Users/jacksonsweet/.nvm/versions/node/v22.23.2/bin/node
mode="${1:-green}"
[[ "$mode" == red || "$mode" == green ]] || exit 2
scratch=$(mktemp -d /private/tmp/ops-site-visit-trial.XXXXXX)
logs="$root/docs/artifacts/phase19/trial-$mode"
mkdir -p "$scratch/socket" "$logs"
cleanup() { "$bin/pg_ctl" -D "$scratch/data" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$bin/initdb" -D "$scratch/data" -A trust --no-locale -E UTF8 -U postgres > "$logs/init.log" 2>&1
"$bin/pg_ctl" -D "$scratch/data" -l "$logs/server.log" -o "-k $scratch/socket -p 55473 -c listen_addresses='' -c max_connections=16 -c shared_buffers=32MB" -w start > "$logs/start.log" 2>&1
psql_local() { "$bin/psql" -X -h "$scratch/socket" -p 55473 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
python3 "$root/tests/sql/build-site-visit-booking-fixture.py" --workflow > "$scratch/schema.sql"
psql_local -f "$scratch/schema.sql" > "$logs/schema.log" 2>&1
for migration in 20260910190020_site_visit_concurrency_protocol.sql 20260910191043_site_visit_durable_writes.sql 20260910204942_site_visit_canonical_actor_booking.sql 20260911011000_site_visit_packet_discard.sql 20260910205717_agent_site_visit_workflow.sql 20260912004121_site_visit_single_choice_v2.sql 20260912203552_site_visit_mcp_choice_coexistence.sql; do
  psql_local -f "$root/supabase/migrations/$migration" >> "$logs/migrations.log" 2>&1
done
"$node" "$root/tests/sql/build-site-visit-trial-fixture.mjs" > "$scratch/oauth.sql"
psql_local -f "$scratch/oauth.sql" > "$logs/oauth.log" 2>&1
if [[ "$mode" == green ]]; then
  psql_local -f "$root/supabase/migrations/20260914200524_site_visit_oauth_trial.sql" >> "$logs/migrations.log" 2>&1
fi
psql_local -f "$root/tests/sql/site-visit-trial-runtime.sql" > "$logs/runtime.log" 2>&1
rg 'PASS:' "$logs/runtime.log"
printf 'Fixture retained for bounded debugging: %s\n' "$scratch"
