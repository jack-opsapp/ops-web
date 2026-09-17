#!/usr/bin/env bash
# Account closure with expense accounting data, on a fresh disposable
# socket-only PostgreSQL 17 cluster. Never connects to OPS.
#
#   1. fidelity    — the released expense chain, the recurring reimbursement
#                    migration, the closure fixture and the live account-closure
#                    migrations; every closure-path function, trigger, foreign
#                    key and service_role privilege matches production.
#   2. migrations  — both repairs install exactly and reapply safely, and each
#                    refuses to install over drift without changing anything.
#   3. closure     — tests/integration/company-data-purge-expense-postgres-runtime.test.ts
#                    reproduces today's failure, shows what each missing piece
#                    leaves behind, and proves the repaired closure complete.
#   4. regression  — the accounting, correction and recurring reimbursement
#                    assertions and the correction concurrency graphs give the
#                    same results with the authority repair installed.
set -euo pipefail
export LC_ALL=C
task_pg=${OPS_TEST_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
task_root=$(cd "$(dirname "$0")/.." && pwd)
task_scratch=$(mktemp -d /private/tmp/ops-closure-pg.XXXXXX)
task_logs=$(mktemp -d /private/tmp/ops-closure-proof.XXXXXX)
# The correction concurrency graphs address this port name on the socket below.
task_port=55494
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
  -o "-k $task_scratch/socket -p $task_port -c listen_addresses='' -c max_connections=24 -c shared_buffers=32MB" \
  -w start > "$task_logs/start.log" 2>&1

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
recurring=supabase/migrations/20260917030000_expense_recurring_reimbursements.sql
authority=supabase/migrations/20260917050651_expense_authority_account_closure.sql
ledgers=supabase/migrations/20260917050826_expense_accounting_company_data_lifecycle.sql
closure_chain=(
  "${released_chain[@]}"
  "$recurring"
  tests/sql/company-data-purge-expense-fixture.sql
  supabase/migrations/20260731161122_transactional_company_data_purge.sql
  supabase/migrations/20260904190000_supplier_bill_company_data_lifecycle.sql
)

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
    echo "Expected $file to refuse drift in $database"; exit 1
  fi
  if ! grep -q "$message" "$task_logs/$log"; then
    echo "Unexpected rejection for $file in $database:"; tail -n 20 "$task_logs/$log"; exit 1
  fi
}

# 1. Fidelity: the template carries production's closure path exactly.
"${task_psql[@]}" -d template1 -c "create database closure_base" >> "$task_logs/databases.log" 2>&1
run_files closure_base fidelity.log "${closure_chain[@]}" tests/sql/company-data-purge-expense-fidelity.sql
grep 'match production' "$task_logs/fidelity.log"

# 2. Migrations install exactly (each carries its own postcondition) and reapply safely.
copy_database migrations closure_base
run_files migrations migrations.log "$authority" "$authority" "$ledgers" "$ledgers"
echo '2 account-closure migrations installed exactly and reapplied safely'

copy_database drift_authority closure_base
"${task_psql[@]}" -d drift_authority -c "alter function private.enforce_expense_accounting_related_authority() set lock_timeout = '1s'" >> "$task_logs/drift.log" 2>&1
expect_rejection drift_authority "$authority" 'Expense authority changed after 2026-09-17' drift-authority.log
[[ $(function_md5 drift_authority 'private.enforce_expense_accounting_authority()') == 15919972aa7bced567a0ae3dfff5a807 ]] \
  || { echo 'A rejected authority repair changed a function'; exit 1; }

copy_database drift_helper closure_base
run_files drift_helper drift.log "$authority"
"${task_psql[@]}" -d drift_helper -c "alter function public.purge_company_rows(text, uuid) set work_mem = '8MB'" >> "$task_logs/drift.log" 2>&1
expect_rejection drift_helper "$ledgers" 'public.purge_company_rows changed after 2026-09-17' drift-helper.log

copy_database drift_ledger closure_base
run_files drift_ledger drift.log "$authority"
"${task_psql[@]}" -d drift_ledger -c "grant delete on public.expense_accounting_events to service_role" >> "$task_logs/drift.log" 2>&1
expect_rejection drift_ledger "$ledgers" 'Expense accounting ledgers changed after 2026-09-17' drift-ledger.log
[[ $(function_md5 drift_ledger 'public.purge_company_rows(text,uuid)') == b549970fec8be3a60c85f3a5987cac72 ]] \
  || { echo 'A rejected ledger migration changed the closure helper'; exit 1; }
echo '3 migration drift rejection checks passed (nothing installed)'

# 3. Closure: the manifest's own plan, run the way the delete-account route runs it.
copy_database closure_seeded closure_base
run_files closure_seeded seed.log tests/sql/company-data-purge-expense-seed.sql
grep 'closure seed ready' "$task_logs/seed.log"
task_node=${OPS_TEST_NODE_BIN:-node}
(
  cd "$task_root"
  OPS_RUN_COMPANY_PURGE_POSTGRES=1 OPS_PSQL_BIN="$task_pg/psql" OPS_PGHOST="$task_scratch/socket" \
    OPS_PGPORT="$task_port" OPS_PURGE_TEMPLATE_DB=closure_seeded \
    "$task_node" node_modules/vitest/vitest.mjs run tests/integration/company-data-purge-expense-postgres-runtime.test.ts
) > "$task_logs/closure.log" 2>&1 || { tail -n 60 "$task_logs/closure.log"; exit 1; }
grep -E 'Tests +[0-9]+ passed' "$task_logs/closure.log"

# 4. Regression: identical assertion results without and with the authority repair.
for variant in released repaired; do
  repair=()
  [[ $variant == repaired ]] && repair=("$authority")
  copy_database "accounting_$variant" template0
  run_files "accounting_$variant" "accounting-$variant.log" "${released_chain[@]}" "$recurring" ${repair[@]+"${repair[@]}"} \
    tests/sql/expense-accounting-runtime.sql
  copy_database "recurring_$variant" template0
  run_files "recurring_$variant" "recurring-$variant.log" "${released_chain[@]}" "$recurring" "$recurring" ${repair[@]+"${repair[@]}"} \
    tests/sql/expense-recurring-reimbursements-runtime.sql
  echo "$variant: $(grep 'runtime assertions passed' "$task_logs/accounting-$variant.log"); $(grep 'recurring reimbursement assertions passed' "$task_logs/recurring-$variant.log")"
done
copy_database correction_released template0
run_files correction_released correction-released.log "${released_chain[@]}" "$recurring" \
  tests/sql/expense-correction-runtime.sql
echo "released: $(grep 'expense correction assertions passed' "$task_logs/correction-released.log")"

# The correction assertions and concurrency graphs address database postgres.
run_files postgres correction-repaired.log "${released_chain[@]}" "$recurring" "$authority" \
  tests/sql/expense-correction-runtime.sql
echo "repaired: $(grep 'expense correction assertions passed' "$task_logs/correction-repaired.log")"
python3 "$task_root/tests/runtime/expense-correction-concurrency.py" "$task_pg/psql" "$task_scratch/socket" \
  > "$task_logs/concurrency.log" 2>&1 || { cat "$task_logs/concurrency.log"; exit 1; }
echo "repaired: $(tail -n 1 "$task_logs/concurrency.log")"
printf 'Verification logs: %s\n' "$task_logs"
