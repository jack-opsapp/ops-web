#!/usr/bin/env bash
# Recurring reimbursement verification on a fresh disposable socket-only
# PostgreSQL cluster. Never connects to OPS.
#
#   1. recurring   — the released expense chain + this migration (applied twice)
#                    + the recurring reimbursement assertions.
#   2. postgres    — the same chain + this migration, then the existing
#                    correction assertions and concurrency graphs (regression).
#   3. accounting  — the same chain + this migration, then the existing
#                    accounting lifecycle assertions (regression).
#   4. drift       — the migration refuses to install over changed expense
#                    placement or a missing prerequisite.
set -euo pipefail
export LC_ALL=C
task_pg=${OPS_TEST_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
task_root=$(cd "$(dirname "$0")/.." && pwd)
task_scratch=$(mktemp -d /private/tmp/ops-recurring-pg.XXXXXX)
task_logs=$(mktemp -d /private/tmp/ops-recurring-proof.XXXXXX)
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
  -o "-k $task_scratch/socket -p 55494 -c listen_addresses='' -c max_connections=12 -c shared_buffers=32MB" \
  -w start > "$task_logs/start.log" 2>&1

migration=supabase/migrations/20260917030000_expense_recurring_reimbursements.sql
released_chain=(
  tests/sql/expense-decision-authority-baseline.sql
  tests/sql/expense-accounting-fixture.sql
  tests/sql/expense-correction-fixture.sql
  supabase/migrations/20260720024121_expense_atomic_save.sql
  supabase/migrations/20260720024623_fix_expense_batch_recalculation_alias.sql
  docs/artifacts/expense-release/constituents/20260912012607_expense_decision_company_authority.sql
  docs/artifacts/expense-release/constituents/20260912203328_expense_accounting_lifecycle.sql
  tests/sql/expense-payroll-projection-live-baseline.sql
  docs/artifacts/expense-release/constituents/20260914200910_expense_payroll_reimbursement_projection.sql
  docs/artifacts/expense-release/constituents/20260914214748_expense_admin_correction_review.sql
  tests/sql/expense-recurring-reimbursements-fixture.sql
)

run_files() {
  local database=$1 log=$2
  shift 2
  for file in "$@"; do
    if ! "$task_pg/psql" -h "$task_scratch/socket" -p 55494 -U postgres -d "$database" -X -q \
      -v ON_ERROR_STOP=1 -f "$task_root/$file" >> "$task_logs/$log" 2>&1; then
      tail -n 30 "$task_logs/$log"
      exit 1
    fi
  done
}

for database in recurring accounting drift; do
  "$task_pg/createdb" -h "$task_scratch/socket" -p 55494 -U postgres "$database"
done

# 1. The vertical, with a safe reapplication before the assertions run.
run_files recurring recurring.log "${released_chain[@]}" "$migration" "$migration" \
  tests/sql/expense-recurring-reimbursements-runtime.sql
rg 'recurring reimbursement assertions passed' "$task_logs/recurring.log"

# 2. Correction assertions and concurrency graphs still hold with the vertical installed.
run_files postgres correction.log "${released_chain[@]}" "$migration" tests/sql/expense-correction-runtime.sql
rg 'passed' "$task_logs/correction.log" | tail -n 1
python3 "$task_root/tests/runtime/expense-correction-concurrency.py" "$task_pg/psql" "$task_scratch/socket" \
  > "$task_logs/concurrency.log" 2>&1 || { cat "$task_logs/concurrency.log"; exit 1; }
tail -n 3 "$task_logs/concurrency.log"

# 3. Accounting lifecycle assertions still hold with the vertical installed.
run_files accounting accounting.log "${released_chain[@]}" "$migration" tests/sql/expense-accounting-runtime.sql
tail -n 3 "$task_logs/accounting.log"

# 4. Changed placement or missing prerequisites stop the migration.
run_files drift drift.log "${released_chain[@]}"
task_psql=("$task_pg/psql" -h "$task_scratch/socket" -p 55494 -U postgres -d drift -X -v ON_ERROR_STOP=1)
"${task_psql[@]}" -c "alter function public.place_expense(uuid) set search_path='public';" >> "$task_logs/drift.log" 2>&1
if "${task_psql[@]}" -f "$task_root/$migration" > "$task_logs/drift-rejection.log" 2>&1; then
  echo 'Expected placement drift rejection did not occur'; exit 1
fi
rg -q 'review the recurring reimbursement migration before applying' "$task_logs/drift-rejection.log"
"${task_psql[@]}" -c "alter function private.lock_expense_approver_context() rename to test_missing_expense_context;" >> "$task_logs/drift.log" 2>&1
if "${task_psql[@]}" -f "$task_root/$migration" > "$task_logs/prerequisite-rejection.log" 2>&1; then
  echo 'Expected prerequisite rejection did not occur'; exit 1
fi
rg -q 'Install the expense release' "$task_logs/prerequisite-rejection.log"
if "${task_psql[@]}" -At -c "select to_regclass('public.expense_recurring_reimbursements') is null" | rg -q '^t$'; then
  echo '2 migration safety rejection checks passed (nothing installed)'
else
  echo 'A rejected migration left objects behind'; exit 1
fi
printf 'Verification logs: %s\n' "$task_logs"
