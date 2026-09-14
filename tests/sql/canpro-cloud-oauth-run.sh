#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
pg=${OPS_PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}
cluster=$(mktemp -d /private/tmp/canpro-cloud-oauth-pg17.XXXXXX)
logs="$root/docs/artifacts/canpro-oauth"
mkdir -p "$logs"
cleanup() {
  "$pg/pg_ctl" -D "$cluster/data" -m fast stop > "$logs/sql-stop.log" 2>&1 || true
  # Only the random directory created by this script is removed.
  rm -rf "$cluster"
}
trap cleanup EXIT
"$pg/initdb" -D "$cluster/data" -A trust --no-locale -E UTF8 > "$logs/sql-init.log" 2>&1
"$pg/pg_ctl" -D "$cluster/data" -l "$logs/sql-server.log" -o "-p 55488 -k $cluster -h ''" start > "$logs/sql-start.log" 2>&1
psql=("$pg/psql" -X -h "$cluster" -p 55488 -d postgres -v ON_ERROR_STOP=1)
"${psql[@]}" -f "$root/tests/sql/agent-customer-update-oauth-setup.sql" > "$logs/sql-setup.log" 2>&1
"${psql[@]}" -f "$root/supabase/migrations/20260905033621_agent_customer_update_oauth_activation.sql" > "$logs/sql-active.log" 2>&1
"${psql[@]}" -f "$root/supabase/migrations/20260910180330_mcp_oauth_canpro_cloud_callback.sql" > "$logs/sql-migration.log" 2>&1
"${psql[@]}" -Atc "select md5(pg_get_functiondef('public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)'::regprocedure))" > "$logs/sql-registration-md5.txt"
"${psql[@]}" -f "$root/tests/sql/agent-customer-update-oauth-runtime.sql" > "$logs/sql-regression.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/canpro-cloud-oauth-runtime.sql" > "$logs/sql-canpro.log" 2>&1
python3 - "$logs" <<'PY'
from pathlib import Path
import json, sys
p = Path(sys.argv[1])
print(json.dumps({"postgres": 17, "regression_assertions": (p/'sql-regression.log').read_text().count('PASS:'), "canpro_assertions": (p/'sql-canpro.log').read_text().count('PASS:')}))
PY
