#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=${OPS_PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}
cluster=$(mktemp -d /private/tmp/ops-customer-precision-pg17.XXXXXX)
logs="$root/docs/artifacts/maverick-repair/precision-runtime"
mkdir -p "$logs"
cleanup() {
  "$bin/pg_ctl" -D "$cluster/data" -m fast stop > "$logs/stop.log" 2>&1 || true
  rm -rf "$cluster"
}
trap cleanup EXIT
"$bin/initdb" -D "$cluster/data" -A trust --no-locale -E UTF8 > "$logs/init.log" 2>&1
"$bin/pg_ctl" -D "$cluster/data" -l "$logs/server.log" -o "-p 55491 -k $cluster -h ''" start > "$logs/start.log" 2>&1
psql=("$bin/psql" -X -h "$cluster" -p 55491 -d postgres -v ON_ERROR_STOP=1)
"${psql[@]}" -f "$root/tests/sql/agent-customer-update-setup.sql" > "$logs/setup.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-customer-update-precision-fixtures.sql" > "$logs/fixtures.log" 2>&1
runtime="$root/tests/sql/agent-customer-update-precision-runtime.sql"
if "${psql[@]}" -f "$runtime" > "$logs/before.log" 2>&1; then
  echo 'Expected the live millisecond version projection to fail.' >&2; exit 1
fi
rg -q 'FAIL: identity preserves the exact microsecond version' "$logs/before.log"
"${psql[@]}" -c "set request.jwt.claim.role='service_role'; select runtime.rejects(format('select runtime.prepare(%L::jsonb)',jsonb_set(runtime.request('{\"title\":\"Fixture lead\"}', 'precision-red-001'),'{expected_updated_at}',to_jsonb(runtime.read_version()))),'AGENT_CUSTOMER_UPDATE_SOURCE_STALE','live projection reproduces stale source');" > "$logs/source-stale-before.log" 2>&1
if [[ ${1:-} == --before-only ]]; then cat "$logs/before.log" "$logs/source-stale-before.log"; exit 0; fi
migration="$root/supabase/migrations/20260905192721_agent_customer_update_source_precision.sql"
"${psql[@]}" -f "$migration" > "$logs/migration.log" 2>&1
"${psql[@]}" -f "$runtime" > "$logs/after.log" 2>&1
"${psql[@]}" -f "$migration" > "$logs/replay.log" 2>&1
"${psql[@]}" -f "$runtime" > "$logs/replay-after.log" 2>&1
"${psql[@]}" -Atc "select format('alter function %s volatile',oid::regprocedure) from runtime.invariants" > "$cluster/drift.sql"
"${psql[@]}" -f "$cluster/drift.sql" > "$logs/drift-setup.log" 2>&1
if "${psql[@]}" -f "$migration" > "$logs/drift-rejected.log" 2>&1; then
  echo 'Unexpected source drift was accepted.' >&2; exit 1
fi
rg -q 'agent_customer_update_source_precision_drift' "$logs/drift-rejected.log"
python3 - "$logs" "$migration" <<'RESULT'
import hashlib,json,pathlib,sys
logs=pathlib.Path(sys.argv[1]); migration=pathlib.Path(sys.argv[2])
result={"assertions":(logs/'after.log').read_text().count('PASS:'),"red_projection":"reproduced", "real_preparation_source_stale":"reproduced", "replay":"passed", "source_drift":"rejected", "migration_sha256":hashlib.sha256(migration.read_bytes()).hexdigest(), "limits":"Exact frozen live identity expression plus real preparation RPC, authority and mutation guards on disposable fixtures. Does not execute the complete job summary RPC or production writes."}
(logs/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
RESULT
