#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=${OPS_PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}
cluster=$(mktemp -d /private/tmp/ops-financial-document-pg17.XXXXXX)
logs="$root/docs/artifacts/phase15"
mkdir -p "$logs"
cleanup() { "$bin/pg_ctl" -D "$cluster/data" -m fast stop > "$logs/runtime-stop.log" 2>&1 || true; rm -rf "$cluster"; }
trap cleanup EXIT
"$bin/initdb" -D "$cluster/data" -A trust --no-locale -E UTF8 > "$logs/runtime-init.log" 2>&1
"$bin/pg_ctl" -D "$cluster/data" -l "$logs/runtime-server.log" -o "-p 55485 -k $cluster -h ''" start > "$logs/runtime-start.log" 2>&1
"$bin/psql" -X -h "$cluster" -p 55485 -d postgres -v ON_ERROR_STOP=1 -f "$root/tests/sql/financial-document-setup.sql" > "$logs/runtime-setup.log" 2>&1
"$bin/psql" -X -h "$cluster" -p 55485 -d postgres -v ON_ERROR_STOP=1 -f "$root/tests/sql/financial-document-runtime.sql" > "$logs/runtime-tests.log" 2>&1
"$bin/psql" -X -h "$cluster" -p 55485 -d postgres -v ON_ERROR_STOP=1 -f "$root/tests/sql/financial-document-adversarial.sql" >> "$logs/runtime-tests.log" 2>&1
rg 'PASS:' "$logs/runtime-tests.log"

bash "$root/tests/sql/financial-document-concurrency.sh" "$bin" "$cluster" "$logs"
