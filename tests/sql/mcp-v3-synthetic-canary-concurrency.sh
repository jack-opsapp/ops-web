#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIRECTORY="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd -P
)"
readonly PSQL_BIN="${OPS_PSQL_BIN:-$(command -v psql)}"
readonly CREATEDB_BIN="${OPS_CREATEDB_BIN:-$(command -v createdb)}"
readonly DROPDB_BIN="${OPS_DROPDB_BIN:-$(command -v dropdb)}"
readonly DATABASE_NAME="ops_mcp_v3_canary_concurrency_$$"
readonly SCRATCH_ROOT="${TMPDIR:-/tmp}"

scratch_directory=""
holder_pid=""
disable_pid=""
database_created=false

fail() {
  echo "MCP v3 canary concurrency proof failed: $*" >&2
  exit 1
}

cleanup() {
  local exit_status=$?

  for process_id in "$holder_pid" "$disable_pid"; do
    if [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null; then
      kill "$process_id" 2>/dev/null || true
      wait "$process_id" 2>/dev/null || true
    fi
  done

  if [[ "$database_created" == true ]] &&
     [[ "$DATABASE_NAME" =~ ^ops_mcp_v3_canary_concurrency_[0-9]+$ ]]; then
    "$DROPDB_BIN" --if-exists "$DATABASE_NAME" >/dev/null 2>&1 || true
  fi

  if [[ -n "$scratch_directory" ]]; then
    case "$scratch_directory" in
      "${SCRATCH_ROOT%/}"/ops-mcp-v3-canary-concurrency.*)
        rm -rf -- "$scratch_directory"
        ;;
      *)
        echo "Refusing to remove unexpected concurrency scratch path" >&2
        ;;
    esac
  fi

  return "$exit_status"
}

trap cleanup EXIT
trap 'exit 130' INT TERM

[[ -x "$PSQL_BIN" ]] || fail "psql was not found"
[[ -x "$CREATEDB_BIN" ]] || fail "createdb was not found"
[[ -x "$DROPDB_BIN" ]] || fail "dropdb was not found"
[[ "$DATABASE_NAME" =~ ^ops_mcp_v3_canary_concurrency_[0-9]+$ ]] ||
  fail "disposable database identity is invalid"

scratch_directory="$(
  mktemp -d "${SCRATCH_ROOT%/}/ops-mcp-v3-canary-concurrency.XXXXXX"
)"

"$CREATEDB_BIN" "$DATABASE_NAME"
database_created=true

readonly -a PSQL=(
  "$PSQL_BIN" -X -q -v ON_ERROR_STOP=1 -d "$DATABASE_NAME"
)

"${PSQL[@]}" -v keep_fixture=1 \
  -f "$SCRIPT_DIRECTORY/mcp-v3-synthetic-canary-runtime.sql" >/dev/null

"${PSQL[@]}" >/dev/null <<'SQL'
set request.jwt.claim.role = 'service_role';

insert into private.mcp_oauth_clients (
  client_id, client_name, scope_ceiling, consent_catalog_revision,
  exposure_revision
)
select
  client_id,
  client_name,
  array[
    'ops.correspondence.read',
    'ops.financial_documents.read',
    'ops.jobs.read',
    'ops.operations.prepare',
    'ops.operations.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ],
  '2026-08-30.mcp-consent-catalog.v2',
  '2026-08-30.mcp-exposure.v3'
from (values
  ('ca000000-0000-4000-8000-000000000024'::uuid, 'Provision race'),
  ('ca000000-0000-4000-8000-000000000025'::uuid, 'Refresh race'),
  ('ca000000-0000-4000-8000-000000000026'::uuid, 'Routine race'),
  ('ca000000-0000-4000-8000-000000000027'::uuid, 'Durable write race')
) clients(client_id, client_name);

select public.provision_mcp_oauth_canary_as_system(
  client_id,
  'ca000000-0000-4000-8000-000000000011',
  'ca000000-0000-4000-8000-000000000001',
  '2026-08-30.mcp-exposure.v3',
  '2026-08-30.mcp-consent-catalog.v2',
  statement_timestamp() + interval '1 hour'
)
from (values
  ('ca000000-0000-4000-8000-000000000025'::uuid),
  ('ca000000-0000-4000-8000-000000000026'::uuid),
  ('ca000000-0000-4000-8000-000000000027'::uuid)
) provisioned(client_id);

insert into private.mcp_oauth_grants (
  id, client_id, user_id, company_id, exposure_revision
) values
  (
    'ca000000-0000-4000-8000-000000000035',
    'ca000000-0000-4000-8000-000000000025',
    'ca000000-0000-4000-8000-000000000011',
    'ca000000-0000-4000-8000-000000000001',
    '2026-08-30.mcp-exposure.v3'
  ),
  (
    'ca000000-0000-4000-8000-000000000036',
    'ca000000-0000-4000-8000-000000000026',
    'ca000000-0000-4000-8000-000000000011',
    'ca000000-0000-4000-8000-000000000001',
    '2026-08-30.mcp-exposure.v3'
  );

insert into private.mcp_oauth_tokens (
  token_hash, grant_id, family_id, kind
) values (
  repeat('9', 64),
  'ca000000-0000-4000-8000-000000000035',
  'ca000000-0000-4000-8000-000000000055',
  'refresh'
);
SQL

wait_for_activity() {
  local application_name=$1
  local wait_event=$2
  local attempt
  local observed

  for attempt in $(seq 1 250); do
    observed="$("${PSQL[@]}" -At -c "
        select count(*)
        from pg_catalog.pg_stat_activity activity
        where activity.datname = current_database()
          and activity.application_name = '${application_name}'
          and activity.wait_event = '${wait_event}';
      ")"
    if [[ "$observed" == "1" ]]; then
      return 0
    fi
    sleep 0.02
  done
  return 1
}

assert_cleanup() {
  local client_id=$1
  local safe

  [[ "$client_id" =~ ^[0-9a-f-]{36}$ ]] || fail "invalid cleanup client"
  safe="$("${PSQL[@]}" -At -c "
    set request.jwt.claim.role = 'service_role';
    select
      binding_inactive
      and client_disabled
      and grants_inactive
      and tokens_inactive
    and routines_safe
    from public.verify_mcp_oauth_canary_cleanup_as_system(
      '${client_id}'::uuid,
      'ca000000-0000-4000-8000-000000000011',
      'ca000000-0000-4000-8000-000000000001'
    );
  ")"
  [[ "$safe" == "SET"$'\n'"t" || "$safe" == "t" ]] ||
    fail "final authority was not safely disabled for $client_id"
}

run_serialized_shutdown() {
  local scenario=$1
  local client_id=$2
  local holder_sql=$3
  local holder_app="mcp_canary_holder_${scenario}_$$"
  local disable_app="mcp_canary_disable_${scenario}_$$"
  local holder_log="$scratch_directory/${scenario}-holder.log"
  local disable_log="$scratch_directory/${scenario}-disable.log"

  PGAPPNAME="$holder_app" "${PSQL[@]}" -c "
    begin;
    set local request.jwt.claim.role = 'service_role';
    set local lock_timeout = '5s';
    set local deadlock_timeout = '100ms';
    ${holder_sql}
    select pg_catalog.pg_sleep(1);
    commit;
  " >"$holder_log" 2>&1 &
  holder_pid=$!

  wait_for_activity "$holder_app" "PgSleep" ||
    fail "$scenario holder never reached its post-mutation barrier"

  PGAPPNAME="$disable_app" "${PSQL[@]}" -c "
    begin;
    set local request.jwt.claim.role = 'service_role';
    set local lock_timeout = '5s';
    set local deadlock_timeout = '100ms';
    select public.disable_mcp_oauth_canary_as_system(
      '${client_id}',
      'ca000000-0000-4000-8000-000000000011',
      'ca000000-0000-4000-8000-000000000001'
    );
    commit;
  " >"$disable_log" 2>&1 &
  disable_pid=$!

  wait_for_activity "$disable_app" "advisory" ||
    fail "$scenario shutdown did not wait on the common canary lock"

  wait "$holder_pid" || fail "$scenario mutation failed"
  holder_pid=""
  wait "$disable_pid" || fail "$scenario shutdown failed"
  disable_pid=""
  assert_cleanup "$client_id"
}

run_serialized_shutdown \
  "provision" \
  "ca000000-0000-4000-8000-000000000024" \
  "select public.provision_mcp_oauth_canary_as_system(
    'ca000000-0000-4000-8000-000000000024',
    'ca000000-0000-4000-8000-000000000011',
    'ca000000-0000-4000-8000-000000000001',
    '2026-08-30.mcp-exposure.v3',
    '2026-08-30.mcp-consent-catalog.v2',
    statement_timestamp() + interval '1 hour'
  );"

run_serialized_shutdown \
  "refresh" \
  "ca000000-0000-4000-8000-000000000025" \
  "select * from public.rotate_mcp_oauth_refresh_token_as_system(
    repeat('9', 64),
    'ca000000-0000-4000-8000-000000000025',
    array[
      'ops.correspondence.read', 'ops.financial_documents.read',
      'ops.jobs.read', 'ops.operations.prepare', 'ops.operations.read',
      'ops.schedule.read', 'ops.tasks.read'
    ],
    repeat('7', 64),
    repeat('8', 64),
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '2 hours'
  );"

run_serialized_shutdown \
  "routine" \
  "ca000000-0000-4000-8000-000000000026" \
  "select * from public.upsert_agent_day_closeout_routine_config_as_system(
    'ca000000-0000-4000-8000-000000000011',
    'ca000000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000036',
    true,
    '17:00'::time
  );"

run_serialized_shutdown \
  "durable_write" \
  "ca000000-0000-4000-8000-000000000027" \
  "insert into private.mcp_oauth_grants (
    id, client_id, user_id, company_id, exposure_revision
  ) values (
    'ca000000-0000-4000-8000-000000000037',
    'ca000000-0000-4000-8000-000000000027',
    'ca000000-0000-4000-8000-000000000011',
    'ca000000-0000-4000-8000-000000000001',
    '2026-08-30.mcp-exposure.v3'
  );"

echo "MCP v3 canary concurrency proof passed"
