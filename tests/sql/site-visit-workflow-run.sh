#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=/opt/homebrew/opt/postgresql@17/bin
[[ -x "$bin/initdb" ]] || bin=/opt/homebrew/bin
scratch=$(mktemp -d /private/tmp/ops-phase19-pg.XXXXXX)
logs="$root/docs/artifacts/phase19"
mkdir -p "$scratch/socket" "$logs"
cleanup() { "$bin/pg_ctl" -D "$scratch/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$scratch"; }
trap cleanup EXIT
"$bin/initdb" -D "$scratch/data" -A trust --no-locale -E UTF8 -U postgres > "$logs/pg-init.log" 2>&1
"$bin/pg_ctl" -D "$scratch/data" -l "$logs/pg-server.log" -o "-k $scratch/socket -p 55469 -c listen_addresses='' -c max_connections=16 -c shared_buffers=32MB" -w start > "$logs/pg-start.log" 2>&1
psql_local() { "$bin/psql" -X -h "$scratch/socket" -p 55469 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_local -f "$root/tests/sql/site-visit-workflow-schema.sql" > "$logs/pg-schema.log" 2>&1
if [[ ${1:-} = baseline ]]; then
 psql_local -f "$root/tests/sql/site-visit-workflow-legacy-race.sql" > "$logs/legacy-race-red.log" 2>&1
else
 psql_local -f "$root/supabase/migrations/20260910190020_site_visit_concurrency_protocol.sql" > "$logs/protocol-migration.log" 2>&1
 psql_local -f "$root/tests/sql/site-visit-workflow-legacy-race.sql" > "$logs/protocol-tests.log" 2>&1
 if [[ -f "$root/tests/sql/site-visit-workflow-protocol.sql" ]]; then psql_local -f "$root/tests/sql/site-visit-workflow-protocol.sql" >> "$logs/protocol-tests.log" 2>&1;fi
 psql_local -f "$root/tests/sql/site-visit-workflow-phone-auth.sql" >> "$logs/protocol-migration.log" 2>&1
 psql_local -f "$root/supabase/migrations/20260910191043_site_visit_durable_writes.sql" >> "$logs/protocol-migration.log" 2>&1
 psql_local -f "$root/tests/sql/site-visit-workflow-durable.sql" >> "$logs/protocol-tests.log" 2>&1
 psql_local -f "$root/tests/sql/site-visit-workflow-phone.sql" >> "$logs/protocol-tests.log" 2>&1
 psql_local -f "$root/supabase/migrations/20260911011000_site_visit_packet_discard.sql" >> "$logs/protocol-migration.log" 2>&1
 psql_local -f "$root/tests/sql/site-visit-workflow-discard.sql" >> "$logs/protocol-tests.log" 2>&1
 psql_local -c "select set_config('request.jwt.claims','{\"sub\":\"phone-a\"}',false);begin;update phone_fixture_races set result=public.apply_site_visit_write('20000000-0000-4000-8000-000000000001',command,'10000000-0000-4000-8000-000000000003') where id='one';select pg_sleep(0.2);commit;" > "$logs/phone-race-one.log" 2>&1 &
 race_pid=$!
 psql_local -c "select set_config('request.jwt.claims','{\"sub\":\"phone-a\"}',false);update phone_fixture_races set result=public.apply_site_visit_write('20000000-0000-4000-8000-000000000002',command,'10000000-0000-4000-8000-000000000003') where id='two';" > "$logs/phone-race-two.log" 2>&1
 wait "$race_pid"
 psql_local -c "select public.phone_assert((select count(*)=1 from phone_fixture_races where result->>'outcome'='saved') and (select count(*)=1 from phone_fixture_races where result->>'outcome'='conflict'),'simultaneous sessions save one winner and one preserved conflict');" >> "$logs/protocol-tests.log" 2>&1
 rg 'PASS:'  "$logs/protocol-tests.log"
fi
