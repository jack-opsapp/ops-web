#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=${OPS_PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}
cluster=$(mktemp -d /private/tmp/ops-customer-update-pg17.XXXXXX)
logs="$root/docs/artifacts/phase12"
mkdir -p "$logs"
cleanup() {
  "$bin/pg_ctl" -D "$cluster/data" -m fast stop > "$logs/runtime-stop.log" 2>&1 || true
  # This exact directory was created by this runner and contains only its test cluster.
  rm -rf "$cluster"
}
trap cleanup EXIT
"$bin/initdb" -D "$cluster/data" -A trust --no-locale -E UTF8 > "$logs/runtime-init.log" 2>&1
"$bin/pg_ctl" -D "$cluster/data" -l "$logs/runtime-server.log" -o "-p 55479 -k $cluster -h ''" start > "$logs/runtime-start.log" 2>&1
psql=("$bin/psql" -X -h "$cluster" -p 55479 -d postgres -v ON_ERROR_STOP=1)
"${psql[@]}" -f "$root/tests/sql/agent-customer-update-setup.sql" > "$logs/runtime-setup.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-customer-update-runtime.sql" > "$logs/runtime-tests.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-customer-update-privacy.sql" > "$logs/runtime-privacy.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-customer-update-concurrency.sql" > "$logs/runtime-concurrency-setup.log" 2>&1
"${psql[@]}" -v worker=a -f "$root/tests/sql/agent-customer-update-concurrency-worker.sql" > "$logs/runtime-concurrent-a.log" 2>&1 &
a_pid=$!
"${psql[@]}" -v worker=b -f "$root/tests/sql/agent-customer-update-concurrency-worker.sql" > "$logs/runtime-concurrent-b.log" 2>&1 &
b_pid=$!
monitor_pid=""
if [[ "${OPS_P12_DIAGNOSTICS:-0}" = "1" ]]; then
  (
    for sample in {1..70}; do
      "${psql[@]}" -Atc "select jsonb_build_object('at',clock_timestamp(),'pid',pid,'state',state,'wait_type',wait_event_type,'wait',wait_event,'blockers',pg_blocking_pids(pid),'query',left(query,600),'query_age',clock_timestamp()-query_start) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and backend_type='client backend'; select jsonb_build_object('locks_at',clock_timestamp(),'pid',pid,'relation',relation::regclass::text,'mode',mode,'granted',granted,'transactionid',transactionid) from pg_locks where not granted;" >> "$logs/runtime-lock-graph.jsonl" 2>&1
      sleep 0.5
    done
  ) &
  monitor_pid=$!
fi
set +e
wait "$a_pid"
a_status=$?
wait "$b_pid"
b_status=$?
set -e
if [[ -n "$monitor_pid" ]]; then kill "$monitor_pid" 2>/dev/null || true;wait "$monitor_pid" 2>/dev/null || true;fi
if [[ "$a_status" != "0" || "$b_status" != "0" ]]; then exit 1;fi
"${psql[@]}" -c "select runtime.assert((select count(*)=2 from runtime.concurrent_previews c join private.agent_customer_updates u on u.id=(c.preview->>'change_set_id')::uuid where u.committed_at is not null),'overlapping cross-company assignments both commit');" > "$logs/runtime-concurrency-result.log" 2>&1
python3 - "$root" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); log=root/'docs/artifacts/phase12/runtime-tests.log'
paths=['supabase/migrations/20260904233000_agent_customer_opportunity_update.sql']+[str(p.relative_to(root)) for p in sorted((root/'tests/sql').glob('agent-customer-update-*'))]
result={'postgres':'17','checks_passed':log.read_text().count('PASS:')+(root/'docs/artifacts/phase12/runtime-privacy.log').read_text().count('PASS:')+1,'concurrency':'two companies overlapped; both committed','sha256':{p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths},'limits':'Live-derived columns/defaults/NOT NULL and real authority, assignment core, token guard, enqueue functions/triggers. Unrelated FKs/RLS policies, production notification/accounting/work-queue trigger graph and provider workers are not replicated. No production mutations.'}
(root/'docs/artifacts/phase12/runtime-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
PY
