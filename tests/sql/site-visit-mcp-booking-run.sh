#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=/opt/homebrew/opt/postgresql@17/bin
scratch=$(mktemp -d /private/tmp/ops-phase19-booking-pg.XXXXXX)
logs="$root/docs/artifacts/phase19"
mkdir -p "$scratch/socket" "$logs"
cleanup() { "$bin/pg_ctl" -D "$scratch/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$scratch"; }
trap cleanup EXIT
"$bin/initdb" -D "$scratch/data" -A trust --no-locale -E UTF8 -U postgres > "$logs/booking-pg-init.log" 2>&1
"$bin/pg_ctl" -D "$scratch/data" -l "$logs/booking-pg-server.log" -o "-k $scratch/socket -p 55471 -c listen_addresses='' -c max_connections=16 -c shared_buffers=32MB" -w start > "$logs/booking-pg-start.log" 2>&1
psql_local() { "$bin/psql" -X -h "$scratch/socket" -p 55471 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
python3 "$root/tests/sql/build-site-visit-booking-fixture.py" > "$scratch/schema.sql"
psql_local -f "$scratch/schema.sql" > "$logs/booking-pg-schema.log" 2>&1
if [[ ${1:-} != baseline ]]; then
 python3 "$root/tests/sql/build-site-visit-booking-fixture.py" --actor > "$scratch/actor.sql"
 psql_local -f "$scratch/actor.sql" > "$logs/booking-pg-migration.log" 2>&1
 psql_local -f "$root/supabase/migrations/20260910204942_site_visit_canonical_actor_booking.sql" >> "$logs/booking-pg-migration.log" 2>&1
fi
psql_local -f "$root/tests/sql/site-visit-mcp-booking.sql" > "$logs/booking-${1:-tests}.log" 2>&1
rg 'PASS:' "$logs/booking-${1:-tests}.log"
