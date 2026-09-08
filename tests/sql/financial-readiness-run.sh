#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=${OPS_PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}
# Existing disposable local server only. Never accept remote or production URLs.
socket=/private/tmp/ops-editorial-pg/socket
port=55439
database=ops_p16_$(date +%s)_$$
[[ "$database" =~ ^ops_p16_[0-9]+_[0-9]+$ ]] || exit 1
logs="$root/docs/artifacts/phase16"
mkdir -p "$logs"
"$bin/createdb" -h "$socket" -p "$port" "$database"
cleanup() { "$bin/dropdb" -h "$socket" -p "$port" "$database"; }
trap cleanup EXIT
"$bin/psql" -X -h "$socket" -p "$port" -d "$database" -v ON_ERROR_STOP=1 -f "$root/tests/sql/financial-document-setup.sql" > "$logs/runtime-setup.log" 2>&1
"$bin/psql" -X -h "$socket" -p "$port" -d "$database" -v ON_ERROR_STOP=1 -f "$root/tests/sql/financial-document-runtime.sql" > "$logs/runtime-tests.log" 2>&1
"$bin/psql" -X -h "$socket" -p "$port" -d "$database" -v ON_ERROR_STOP=1 -f "$root/tests/sql/financial-document-adversarial.sql" >> "$logs/runtime-tests.log" 2>&1
if [[ ${OPS_P16_APPLY:-0} = 1 ]]; then
 for migration in "$root"/supabase/migrations/*_financial_policy_readiness.sql; do
 "$bin/psql" -X -h "$socket" -p "$port" -d "$database" -v ON_ERROR_STOP=1 -f "$migration" > "$logs/policy-migration.log" 2>&1
 done
fi
"$bin/psql" -X -h "$socket" -p "$port" -d "$database" -v ON_ERROR_STOP=1 -f "$root/tests/sql/financial-readiness-runtime.sql" >> "$logs/runtime-tests.log" 2>&1
rg 'PASS:' "$logs/runtime-tests.log"
bash "$root/tests/sql/financial-readiness-concurrency.sh" "$bin" "$socket" "$port" "$database" "$logs"
