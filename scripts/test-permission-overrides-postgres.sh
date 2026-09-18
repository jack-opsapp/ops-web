#!/usr/bin/env bash
# Individual permission saves (PUT /api/users/[id]/permission-overrides), end
# to end, on a fresh disposable socket-only PostgreSQL 17 cluster with a real
# PostgREST in front of it. Never connects to OPS.
#
#   1. fidelity   — every function and trigger on the save path, the save's
#                   grants, the PostgREST identities, the collation and the
#                   reference data match production, with the save at the
#                   definition production ran from 2026-07-15.
#   2. migration  — 20260918022722 installs production's live save exactly,
#                   refuses a second run and refuses drift, changing nothing
#                   either time.
#   3. route      — tests/integration/permission-overrides-postgres-runtime.test.ts
#                   drives the real route through supabase-js and PostgREST:
#                   it reproduces the outage, installs the repair under the
#                   running API the way production did, then proves every
#                   outcome the editor can meet, each one committed.
#   4. coverage   — every function on the save path ran during step 3.
#
# When a migration changes anything on this path, add it after `repair`
# (here and in the runtime test's install step) and extend the scenarios.
# Re-baseline the fixture with scripts/capture-permission-overrides-fixture.py.
set -euo pipefail
export LC_ALL=C
task_pg=${OPS_TEST_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
task_postgrest=${OPS_TEST_POSTGREST_BIN:-/opt/homebrew/bin/postgrest}
task_node=${OPS_TEST_NODE_BIN:-node}
task_root=$(cd "$(dirname "$0")/.." && pwd)
task_scratch=$(mktemp -d /private/tmp/ops-overrides-pg.XXXXXX)
task_logs=$(mktemp -d /private/tmp/ops-overrides-proof.XXXXXX)
# The cluster listens on its own socket directory only; the port just names the socket.
task_port=55621
rest_port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
rest_secret=$(openssl rand -hex 32)
rest_pid=
mkdir -p "$task_scratch/socket"
stop_postgrest() {
  if [[ -n $rest_pid ]]; then
    kill "$rest_pid" 2>/dev/null || true
    wait "$rest_pid" 2>/dev/null || true
    rest_pid=
  fi
}
cleanup() {
  stop_postgrest
  "$task_pg/pg_ctl" -D "$task_scratch/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$task_scratch"
}
trap cleanup EXIT
# Do not inherit database service configuration or credentials.
unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE PGOPTIONS
# Production sorts with ICU en-US (the save's canonical-order checks depend on
# it) and runs in UTC. track_functions feeds the coverage step.
"$task_pg/initdb" -D "$task_scratch/data" -A trust -E UTF8 -U postgres \
  --locale-provider=icu --icu-locale=en-US --locale=en_US.UTF-8 > "$task_logs/init.log" 2>&1
"$task_pg/pg_ctl" -D "$task_scratch/data" -l "$task_logs/server.log" \
  -o "-k $task_scratch/socket -p $task_port -c listen_addresses='' -c max_connections=40 -c shared_buffers=32MB -c timezone=UTC -c track_functions=all" \
  -w start > "$task_logs/start.log" 2>&1

fixture=tests/sql/permission-overrides-fixture.sql
repair=supabase/migrations/20260918022722_permission_overrides_clear_alias.sql
save='public.apply_user_permission_overrides_as_system(uuid,uuid,jsonb,jsonb,text[],jsonb)'
production_md5=8e1cb41e52232d3217024a68baed4e27

task_psql=("$task_pg/psql" -h "$task_scratch/socket" -p "$task_port" -U postgres -X -q -At -v ON_ERROR_STOP=1)

run_files() {
  local database=$1 log=$2
  shift 2
  for file in "$@"; do
    if ! "${task_psql[@]}" -d "$database" -f "$task_root/$file" >> "$task_logs/$log" 2>&1; then
      tail -n 30 "$task_logs/$log"
      exit 1
    fi
  done
}
copy_database() {
  "${task_psql[@]}" -d template1 -c "create database $1 template $2" >> "$task_logs/databases.log" 2>&1
}
function_md5() {
  "${task_psql[@]}" -d "$1" -c "select md5(pg_get_functiondef('$2'::regprocedure))"
}
expect_rejection() {
  local database=$1 file=$2 message=$3 log=$4
  if "${task_psql[@]}" -d "$database" -f "$task_root/$file" > "$task_logs/$log" 2>&1; then
    echo "Expected $file to refuse to install in $database"; exit 1
  fi
  if ! grep -q "$message" "$task_logs/$log"; then
    echo "Unexpected rejection for $file in $database:"; tail -n 20 "$task_logs/$log"; exit 1
  fi
}

# 1. Fidelity: the template carries production's save path exactly.
"${task_psql[@]}" -d template1 -c "create database overrides_base" >> "$task_logs/databases.log" 2>&1
run_files overrides_base fidelity.log "$fixture" tests/sql/permission-overrides-fidelity.sql
grep 'match production' "$task_logs/fidelity.log"
copy_database overrides_seeded overrides_base
run_files overrides_seeded seed.log tests/sql/permission-overrides-seed.sql
grep 'permission override seed ready' "$task_logs/seed.log"

# 2. The repair installs production's live save, and refuses anything else.
copy_database migration overrides_seeded
run_files migration migration.log "$repair"
[[ $(function_md5 migration "$save") == "$production_md5" ]] \
  || { echo "The repair did not install production's live save"; exit 1; }
expect_rejection migration "$repair" 'drifted from the reviewed definition' rerun.log
[[ $(function_md5 migration "$save") == "$production_md5" ]] \
  || { echo 'A refused second run changed the save'; exit 1; }
copy_database drift overrides_seeded
"${task_psql[@]}" -d drift -c "alter function $save set work_mem = '8MB'" >> "$task_logs/drift.log" 2>&1
drift_md5=$(function_md5 drift "$save")
expect_rejection drift "$repair" 'drifted from the reviewed definition' drift-rejection.log
[[ $(function_md5 drift "$save") == "$drift_md5" ]] \
  || { echo 'A refused repair changed a drifted save'; exit 1; }
echo "repair installs production's live save exactly; refuses a second run and drift (nothing installed)"

# 3. The route, through supabase-js and PostgREST, one commit per save.
copy_database overrides_runtime overrides_seeded
cat > "$task_scratch/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@/overrides_runtime?host=$task_scratch/socket&port=$task_port"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 4
jwt-secret = "$rest_secret"
server-host = "127.0.0.1"
server-port = $rest_port
log-level = "error"
CONF
"$task_postgrest" "$task_scratch/postgrest.conf" > "$task_logs/postgrest.log" 2>&1 &
rest_pid=$!
for _ in $(seq 1 100); do
  if curl -fs -o /dev/null "http://127.0.0.1:$rest_port/"; then break; fi
  kill -0 "$rest_pid" 2>/dev/null || { cat "$task_logs/postgrest.log"; exit 1; }
  sleep 0.1
done
curl -fsS -o /dev/null "http://127.0.0.1:$rest_port/" || { echo 'PostgREST did not start'; cat "$task_logs/postgrest.log"; exit 1; }
(
  cd "$task_root"
  OPS_RUN_PERMISSION_OVERRIDES_POSTGRES=1 OPS_PSQL_BIN="$task_pg/psql" OPS_PGHOST="$task_scratch/socket" \
    OPS_PGPORT="$task_port" OPS_PERMISSION_OVERRIDES_DB=overrides_runtime \
    OPS_POSTGREST_URL="http://127.0.0.1:$rest_port" OPS_POSTGREST_JWT_SECRET="$rest_secret" \
    "$task_node" node_modules/vitest/vitest.mjs run --reporter=verbose tests/integration/permission-overrides-postgres-runtime.test.ts
) > "$task_logs/route.log" 2>&1 || { tail -n 80 "$task_logs/route.log"; exit 1; }
grep -E 'Tests +[0-9]+ passed' "$task_logs/route.log"

# 4. Coverage: PostgREST's sessions report their function counts as they end.
stop_postgrest
for _ in $(seq 1 100); do
  [[ $("${task_psql[@]}" -d overrides_runtime -c "select count(*) from pg_stat_activity where usename = 'authenticator'") == 0 ]] && break
  sleep 0.1
done
run_files overrides_runtime coverage.log tests/sql/permission-overrides-coverage.sql
grep -E 'coverage:|ran during the route suite' "$task_logs/coverage.log"
printf 'Verification logs: %s\n' "$task_logs"
