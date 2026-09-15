#!/usr/bin/env bash
# Runs only against a newly initialized, disposable local cluster; never production.
set -euo pipefail
task_pg=${OPS_TEST_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
task_root=$(cd "$(dirname "$0")/.." && pwd)
task_scratch=$(mktemp -d /private/tmp/ops-expense-payroll-pg.XXXXXX)
task_logs=$(mktemp -d /private/tmp/ops-expense-payroll-proof.XXXXXX)
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
  tests/sql/agent-payroll-readiness-setup.sql \
  supabase/migrations/20260901190000_agent_payroll_readiness.sql \
  tests/sql/expense-payroll-projection-live-baseline.sql \
  tests/sql/agent-payroll-readiness-runtime.sql \
  tests/sql/expense-payroll-projection-fixture.sql \
  supabase/migrations/20260914200910_expense_payroll_reimbursement_projection.sql \
  supabase/migrations/20260914200910_expense_payroll_reimbursement_projection.sql \
  tests/sql/expense-payroll-projection-runtime.sql; do
  if ! "$task_pg/psql" -h "$task_scratch/socket" -p 55491 -U postgres -d postgres \
    -X -v ON_ERROR_STOP=1 -f "$task_root/$file" >> "$task_logs/psql.log" 2>&1; then
    tail -n 30 "$task_logs/psql.log"
    exit 1
  fi
done
tail -n 5 "$task_logs/psql.log"
task_signature='public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,integer,integer,integer,integer)'
task_psql=("$task_pg/psql" -h "$task_scratch/socket" -p 55491 -U postgres -d postgres -X -v ON_ERROR_STOP=1)
"${task_psql[@]}" -c "ALTER FUNCTION $task_signature VOLATILE" >> "$task_logs/psql.log" 2>&1
if "${task_psql[@]}" -f "$task_root/supabase/migrations/20260914200910_expense_payroll_reimbursement_projection.sql" > "$task_logs/drift-rejection.log" 2>&1; then
  echo 'Expected payroll source-drift rejection did not occur'
  exit 1
fi
rg -q 'Payroll readiness function changed' "$task_logs/drift-rejection.log"
"${task_psql[@]}" -c "ALTER FUNCTION $task_signature RENAME TO test_removed_payroll_read" >> "$task_logs/psql.log" 2>&1
if "${task_psql[@]}" -f "$task_root/supabase/migrations/20260914200910_expense_payroll_reimbursement_projection.sql" > "$task_logs/missing-rejection.log" 2>&1; then
  echo 'Expected missing payroll function rejection did not occur'
  exit 1
fi
rg -q 'Existing payroll readiness function must be installed first' "$task_logs/missing-rejection.log"
echo '2 migration safety rejection checks passed'
printf 'Verification logs: %s\n' "$task_logs"
