#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
pgbin=${OPS_PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}
cluster=$(mktemp -d /private/tmp/ops-email-work-pg17.XXXXXX)
logs="$root/docs/artifacts/email-work-correspondence"
mkdir -p "$logs"
cleanup() {
  "$pgbin/pg_ctl" -D "$cluster/data" -m fast stop > "$logs/stop.log" 2>&1 || true
  rm -rf "$cluster"
}
trap cleanup EXIT
"$pgbin/initdb" -D "$cluster/data" -A trust --no-locale -E UTF8 > "$logs/init.log" 2>&1
"$pgbin/pg_ctl" -D "$cluster/data" -l "$logs/server.log" -o "-p 55483 -k $cluster -h ''" start > "$logs/start.log" 2>&1
psql=("$pgbin/psql" -X -h "$cluster" -p 55483 -d postgres -v ON_ERROR_STOP=1)
"${psql[@]}" -f "$root/tests/sql/email-work-correspondence-runtime.sql" > "$logs/checks.log" 2>&1
call="set role service_role; select route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000053','msg-3','thread-3',null,null,true);"
"${psql[@]}" -c "begin; $call select pg_sleep(0.3); commit;" > "$logs/concurrent-a.log" 2>&1 &
a_pid=$!
"${psql[@]}" -c "$call" > "$logs/concurrent-b.log" 2>&1 &
b_pid=$!
wait "$a_pid"
wait "$b_pid"
"${psql[@]}" -c "select runtime.assert((select count(*)=1 from notifications where dedupe_key='email-work-routing:00000000-0000-0000-0000-000000000053'),'concurrent routing notifies exactly once');" > "$logs/concurrency.log" 2>&1
python3 - "$logs" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); n=sum(x.read_text().count('PASS:') for x in [p/'checks.log',p/'concurrency.log'])
print(f'PASS: {n} PostgreSQL correspondence checks, including concurrent replay. Isolated live-derived schema fixture; unrelated production triggers and RLS are not replicated.')
PY
