#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIRECTORY="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd -P
)"
readonly PSQL_BIN="${OPS_PSQL_BIN:-/opt/homebrew/opt/postgresql@17/bin/psql}"
readonly PGBENCH_BIN="${OPS_PGBENCH_BIN:-/opt/homebrew/opt/postgresql@17/bin/pgbench}"
readonly SAME_BUCKET_BARRIER=7284301
readonly SHARED_COMPANY_BARRIER=7284302
readonly SCRATCH_ROOT="${TMPDIR:-/tmp}"

scratch_directory=""
race_window=""
holder_pid=""
race_pid=""
setup_complete=false

fail() {
  echo "Task 7 concurrency harness failed: $*" >&2
  exit 1
}

cleanup() {
  local exit_status=$?

  if [[ -n "$holder_pid" ]] && kill -0 "$holder_pid" 2>/dev/null; then
    kill "$holder_pid" 2>/dev/null || true
    wait "$holder_pid" 2>/dev/null || true
  fi
  if [[ -n "$race_pid" ]] && kill -0 "$race_pid" 2>/dev/null; then
    kill "$race_pid" 2>/dev/null || true
    wait "$race_pid" 2>/dev/null || true
  fi

  if [[ "$setup_complete" == true && -n "$race_window" ]]; then
    "$PSQL_BIN" -X -q -v ON_ERROR_STOP=1 \
      -v race_window="$race_window" \
      -f "$SCRIPT_DIRECTORY/agent-mcp-rate-limiter-concurrency-cleanup.sql" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "$scratch_directory" ]]; then
    case "$scratch_directory" in
      "${SCRATCH_ROOT%/}"/ops-mcp-rate-limit.*)
        rm -rf -- "$scratch_directory"
        ;;
      *)
        echo "Refusing to remove unexpected scratch path" >&2
        ;;
    esac
  fi

  return "$exit_status"
}

trap cleanup EXIT
trap 'exit 130' INT TERM

[[ "${OPS_MCP_RATE_LIMIT_TEST_CONFIRM:-}" == "YES" ]] ||
  fail "set OPS_MCP_RATE_LIMIT_TEST_CONFIRM=YES for the disposable database"
[[ -n "${PGDATABASE:-}" ]] || fail "PGDATABASE is required"
[[ "$PGDATABASE" =~ ^ops_mcp_rate_limit_test_[a-z0-9_]+$ ]] ||
  fail "PGDATABASE must begin with ops_mcp_rate_limit_test_"
[[ -x "$PSQL_BIN" ]] || fail "PostgreSQL 17 psql was not found"
[[ -x "$PGBENCH_BIN" ]] || fail "PostgreSQL 17 pgbench was not found"

scratch_directory="$(
  mktemp -d "${SCRATCH_ROOT%/}/ops-mcp-rate-limit.XXXXXX"
)"

readonly -a PSQL=("$PSQL_BIN" -X -q -v ON_ERROR_STOP=1)
readonly -a PGBENCH=(
  "$PGBENCH_BIN"
  -n
  -s 1
  -M simple
  -t 1
  --max-tries=1
  --exit-on-abort
  --failures-detailed
  --verbose-errors
)

preflight="$("${PSQL[@]}" -At -F '|' -c "
  select
    current_database(),
    current_setting('server_version_num'),
    current_setting('transaction_read_only'),
    pg_catalog.to_regprocedure(
      'public.consume_agent_mcp_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text)'
    ) is not null,
    pg_catalog.to_regclass('private.agent_mcp_rate_limit_buckets') is not null,
    pg_catalog.to_regclass('private.mcp_oauth_grants') is not null;
")"
IFS='|' read -r actual_database version_number read_only \
  consume_ready buckets_ready grants_ready <<<"$preflight"

[[ "$actual_database" == "$PGDATABASE" ]] || fail "database identity mismatch"
((version_number >= 170000 && version_number < 180000)) ||
  fail "PostgreSQL 17 is required"
[[ "$read_only" == "off" ]] || fail "scratch database is read-only"
[[ "$consume_ready" == "t" && "$buckets_ready" == "t" && "$grants_ready" == "t" ]] ||
  fail "OAuth and durable-rate-limit migrations must be applied first"

assert_trigger_collision() {
  local trigger_key=$1
  local expected_marker=$2
  local output_file="$scratch_directory/trigger-${trigger_key}.log"

  if "${PSQL[@]}" -v trigger_key="$trigger_key" \
    -f "$SCRIPT_DIRECTORY/agent-mcp-rate-limiter-trigger-collision.sql" \
    >"$output_file" 2>&1; then
    fail "migration accepted the ${trigger_key} trigger collision"
  fi
  grep -F "$expected_marker" "$output_file" >/dev/null ||
    fail "${trigger_key} trigger collision failed for the wrong reason"
}

assert_trigger_collision true \
  "agent_mcp_rate_limit_catalog_key_table_invalid"
assert_trigger_collision false \
  "agent_mcp_rate_limit_catalog_bucket_table_invalid"

second_in_minute="$("${PSQL[@]}" -At -c \
  "select floor(extract(second from clock_timestamp()))::integer")"
if ((second_in_minute > 20)); then
  sleep "$((61 - second_in_minute))"
fi
race_window="$("${PSQL[@]}" -At -c \
  "select to_char(date_trunc('minute', clock_timestamp()), 'YYYY-MM-DD HH24:MI:SSOF')")"

"${PSQL[@]}" -v race_window="$race_window" \
  -f "$SCRIPT_DIRECTORY/agent-mcp-rate-limiter-concurrency-setup.sql"
setup_complete=true

advisory_lock_count() {
  local barrier_key=$1
  local granted=$2
  local mode=$3

  "${PSQL[@]}" -At -v barrier_key="$barrier_key" \
    -v expected_granted="$granted" -v expected_mode="$mode" -c "
      select count(*)
      from pg_catalog.pg_locks lock_row
      where lock_row.locktype = 'advisory'
        and lock_row.database = (
          select database_row.oid
          from pg_catalog.pg_database database_row
          where database_row.datname = current_database()
        )
        and lock_row.classid = 0
        and lock_row.objid = :barrier_key
        and lock_row.objsubid = 1
        and lock_row.granted = :'expected_granted'::boolean
        and lock_row.mode = :'expected_mode';
    "
}

wait_for_lock_count() {
  local barrier_key=$1
  local granted=$2
  local mode=$3
  local expected_count=$4
  local attempt
  local observed_count

  for attempt in $(seq 1 200); do
    observed_count="$(advisory_lock_count \
      "$barrier_key" "$granted" "$mode")"
    if [[ "$observed_count" == "$expected_count" ]]; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

run_pgbench_race() {
  local clients=$1
  local jobs=$2
  local barrier_key=$3
  local workload=$4
  local label=$5
  local holder_log="$scratch_directory/${label}-holder.log"
  local race_log="$scratch_directory/${label}-pgbench.log"
  local terminated_holder

  "$PSQL_BIN" -X -q -v ON_ERROR_STOP=1 -v barrier_key="$barrier_key" -c "
    set statement_timeout = 0;
    select pg_advisory_lock(:barrier_key);
    select pg_sleep(30);
  " >"$holder_log" 2>&1 &
  holder_pid=$!

  wait_for_lock_count "$barrier_key" true ExclusiveLock 1 ||
    fail "$label barrier holder did not acquire its lock"

  "${PGBENCH[@]}" -c "$clients" -j "$jobs" \
    -D barrier_key="$barrier_key" -f "$workload" \
    >"$race_log" 2>&1 &
  race_pid=$!

  wait_for_lock_count "$barrier_key" false ShareLock "$clients" ||
    fail "$label did not place every client behind the barrier"

  terminated_holder="$("${PSQL[@]}" -At -v barrier_key="$barrier_key" -c "
    select pg_catalog.pg_terminate_backend(lock_row.pid)
    from pg_catalog.pg_locks lock_row
    where lock_row.locktype = 'advisory'
      and lock_row.database = (
        select database_row.oid
        from pg_catalog.pg_database database_row
        where database_row.datname = current_database()
      )
      and lock_row.classid = 0
      and lock_row.objid = :barrier_key
      and lock_row.objsubid = 1
      and lock_row.granted
      and lock_row.mode = 'ExclusiveLock';
  ")"
  [[ "$terminated_holder" == "t" ]] ||
    fail "$label barrier holder could not be released"
  wait "$holder_pid" 2>/dev/null || true
  holder_pid=""

  if ! wait "$race_pid"; then
    cat "$race_log" >&2
    fail "$label pgbench process failed"
  fi
  race_pid=""
}

run_pgbench_race 31 31 "$SAME_BUCKET_BARRIER" \
  "$SCRIPT_DIRECTORY/agent-mcp-rate-limiter-same-bucket.pgbench.sql" \
  same-bucket
run_pgbench_race 2 2 "$SHARED_COMPANY_BARRIER" \
  "$SCRIPT_DIRECTORY/agent-mcp-rate-limiter-shared-company.pgbench.sql" \
  shared-company

"${PSQL[@]}" -v race_window="$race_window" \
  -f "$SCRIPT_DIRECTORY/agent-mcp-rate-limiter-concurrency-verify.sql"

echo "Task 7 durable MCP rate-limit concurrency proof passed"
