#!/usr/bin/env bash
# Runs only against a newly initialized, disposable local cluster; never production.
set -euo pipefail
task_pg=${OPS_TEST_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
task_root=$(cd "$(dirname "$0")/.." && pwd)
task_scratch=$(mktemp -d /private/tmp/ops-expense-accounting-pg.XXXXXX)
task_logs=$(mktemp -d /private/tmp/ops-expense-accounting-proof.XXXXXX)
mkdir -p "$task_scratch/socket"
cleanup() {
  "$task_pg/pg_ctl" -D "$task_scratch/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$task_scratch"
}
trap cleanup EXIT
# Do not inherit database service configuration or credentials.
unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE PGOPTIONS
"$task_pg/initdb" -D "$task_scratch/data" -A trust --no-locale -E UTF8 -U postgres > "$task_logs/init.log" 2>&1
"$task_pg/pg_ctl" -D "$task_scratch/data" -l "$task_logs/server.log" \
  -o "-k $task_scratch/socket -p 55491 -c listen_addresses='' -c max_connections=16 -c shared_buffers=32MB" \
  -w start > "$task_logs/start.log" 2>&1
for file in \
  tests/sql/expense-decision-authority-baseline.sql \
  tests/sql/expense-accounting-fixture.sql \
  docs/artifacts/expense-release/constituents/20260912012607_expense_decision_company_authority.sql \
  docs/artifacts/expense-release/constituents/20260912203328_expense_accounting_lifecycle.sql \
  docs/artifacts/expense-release/constituents/20260912203328_expense_accounting_lifecycle.sql \
  tests/sql/expense-accounting-runtime.sql; do
  if ! "$task_pg/psql" -h "$task_scratch/socket" -p 55491 -U postgres -d postgres \
    -X -v ON_ERROR_STOP=1 -f "$task_root/$file" >> "$task_logs/psql.log" 2>&1; then
    tail -n 30 "$task_logs/psql.log"
    exit 1
  fi
done
tail -n 5 "$task_logs/psql.log"
if [[ ${OPS_TEST_EXPENSE_CONCURRENCY:-0} == 1 ]]; then
  task_node=${OPS_TEST_NODE_BIN:-node}
  (
    cd "$task_root"
    OPS_RUN_EXPENSE_AUTHORITY_POSTGRES=1 OPS_RUN_EXPENSE_ACCOUNTING_POSTGRES=1 \
      OPS_PSQL_BIN="$task_pg/psql" OPS_PGHOST="$task_scratch/socket" OPS_PGPORT=55491 OPS_PGUSER=postgres \
      "$task_node" node_modules/vitest/vitest.mjs run tests/integration/expense-decision-authority-postgres-runtime.test.ts
  ) > "$task_logs/concurrency.log" 2>&1 || { tail -n 40 "$task_logs/concurrency.log"; exit 1; }
  tail -n 12 "$task_logs/concurrency.log"
fi
printf 'Verification logs: %s\n' "$task_logs"
