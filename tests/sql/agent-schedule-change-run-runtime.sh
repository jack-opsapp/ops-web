#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=${OPS_PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}
cluster=$(mktemp -d /private/tmp/ops-schedule-change-pg17.XXXXXX)
logs="$root/docs/artifacts/phase14"
mkdir -p "$logs"
rm -f "$logs/concurrency-result.json" "$logs/runtime-tests.log" "$logs/runtime-negative.log" "$logs/runtime-positive.log" "$logs/runtime-concurrency.log"
cleanup() {
  "$bin/pg_ctl" -D "$cluster/data" -m fast stop > "$logs/runtime-stop.log" 2>&1 || true
  rm -rf "$cluster"
}
trap cleanup EXIT
"$bin/initdb" -D "$cluster/data" -A trust --no-locale -E UTF8 > "$logs/runtime-init.log" 2>&1
"$bin/pg_ctl" -D "$cluster/data" -l "$logs/runtime-server.log" -o "-p 55484 -k $cluster -h ''" start > "$logs/runtime-start.log" 2>&1
psql=("$bin/psql" -X -h "$cluster" -p 55484 -d postgres -v ON_ERROR_STOP=1)
"${psql[@]}" -f "$root/tests/sql/agent-schedule-change-setup.sql" > "$logs/runtime-setup.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-schedule-change-runtime.sql" > "$logs/runtime-tests.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-schedule-change-negative.sql" > "$logs/runtime-negative.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-schedule-change-positive.sql" > "$logs/runtime-positive.log" 2>&1
python3 "$root/tests/sql/agent-schedule-change-concurrency.py" "$bin/psql" "$cluster" "$root" > "$logs/runtime-concurrency.log" 2>&1
rg 'PASS:' "$logs/runtime-tests.log" "$logs/runtime-negative.log" "$logs/runtime-positive.log"
