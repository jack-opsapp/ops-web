#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=${OPS_PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}
cluster=$(mktemp -d /private/tmp/ops-maverick-repair-pg17.XXXXXX)
logs="$root/docs/artifacts/maverick-repair/runtime"
mkdir -p "$logs"
cleanup() {
  "$bin/pg_ctl" -D "$cluster/data" -m fast stop > "$logs/stop.log" 2>&1 || true
  # This runner owns this exact disposable cluster, never a shared database.
  rm -rf "$cluster"
}
trap cleanup EXIT
"$bin/initdb" -D "$cluster/data" -A trust --no-locale -E UTF8 > "$logs/init.log" 2>&1
"$bin/pg_ctl" -D "$cluster/data" -l "$logs/server.log" -o "-p 55490 -k $cluster -h ''" start > "$logs/start.log" 2>&1
psql=("$bin/psql" -X -h "$cluster" -p 55490 -d postgres -v ON_ERROR_STOP=1)
for file in setup fixtures; do
  "${psql[@]}" -f "$root/tests/sql/agent-maverick-repair-$file.sql" > "$logs/$file.log" 2>&1
done
"${psql[@]}" -f "$root/tests/sql/agent-maverick-task-fixtures.sql" > "$logs/task-fixtures.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-maverick-repair-invariants.sql" > "$logs/invariants.log" 2>&1
# Red proof: the frozen live compatibility chain must reproduce the incident.
if "${psql[@]}" -f "$root/tests/sql/agent-maverick-conversation-runtime.sql" > "$logs/conversation-before.log" 2>&1; then
  echo 'Expected the pre-repair conversation reader to fail.' >&2; exit 1
fi
rg -q 'column .*source_connection_id does not exist' "$logs/conversation-before.log"
if "${psql[@]}" -f "$root/tests/sql/agent-maverick-task-runtime.sql" > "$logs/task-before.log" 2>&1; then
  echo 'Expected the pre-repair all-day task reader to fail.' >&2; exit 1
fi
rg -q 'FAIL: multi-day task context instants' "$logs/task-before.log"
migration="$root/supabase/migrations/20260905184652_agent_maverick_read_repairs.sql"
"${psql[@]}" -f "$migration" > "$logs/migration.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-maverick-conversation-runtime.sql" > "$logs/conversation-after.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-maverick-task-runtime.sql" > "$logs/task-after.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-maverick-repair-readback.sql" > "$logs/readback.log" 2>&1
"${psql[@]}" -f "$migration" > "$logs/replay.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-maverick-repair-readback.sql" > "$logs/replay-readback.log" 2>&1
# An unexpected security attribute change must block the entire migration.
"${psql[@]}" -Atc "select format('alter function %s volatile',oid::regprocedure) from pg_proc where proname='read_agent_job_conversation_context_v3_impl'" > "$cluster/drift.sql"
"${psql[@]}" -f "$cluster/drift.sql" > "$logs/drift-setup.log" 2>&1
if "${psql[@]}" -f "$migration" > "$logs/drift-rejection.log" 2>&1; then
  echo 'Unexpected source drift was accepted.' >&2; exit 1
fi
rg -q 'agent_maverick_read_repair_source_drift: read_agent_job_conversation_context_v3_impl' "$logs/drift-rejection.log"
python3 - "$logs" "$migration" <<'PY'
import hashlib,json,pathlib,sys
logs=pathlib.Path(sys.argv[1]); migration=pathlib.Path(sys.argv[2])
result={"postgres":"17","conversation_checks":(logs/'conversation-after.log').read_text().count('PASS:'),"task_checks":(logs/'task-after.log').read_text().count('PASS:'),"invariant_checks":(logs/'readback.log').read_text().count('PASS:'),"red_reproductions":2,"migration_replay":"passed","unexpected_source_drift":"rejected","migration_sha256":hashlib.sha256(migration.read_bytes()).hexdigest(),"limits":"Disposable synthetic fixtures with live function snapshots and real authority checks. Unrelated production FKs, write triggers and workers are not replicated. No production writes. Civil time follows each runtime's installed IANA timezone data."}
(logs/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
PY
