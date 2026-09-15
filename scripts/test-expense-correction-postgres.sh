#!/usr/bin/env bash
# Fresh disposable socket-only PostgreSQL cluster. Never connects to OPS.
set -euo pipefail
task_pg=${OPS_TEST_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
task_root=$(cd "$(dirname "$0")/.." && pwd)
task_scratch=$(mktemp -d /private/tmp/ops-expense-correction-pg.XXXXXX)
task_logs=$(mktemp -d /private/tmp/ops-expense-correction-proof.XXXXXX)
mkdir -p "$task_scratch/socket"
cleanup() {
  "$task_pg/pg_ctl" -D "$task_scratch/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$task_scratch"
}
trap cleanup EXIT
unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE PGOPTIONS
"$task_pg/initdb" -D "$task_scratch/data" -A trust --no-locale -E UTF8 -U postgres > "$task_logs/init.log" 2>&1
"$task_pg/pg_ctl" -D "$task_scratch/data" -l "$task_logs/server.log" \
  -o "-k $task_scratch/socket -p 55494 -c listen_addresses='' -c max_connections=8 -c shared_buffers=32MB" \
  -w start > "$task_logs/start.log" 2>&1
for file in \
  tests/sql/expense-decision-authority-baseline.sql \
  tests/sql/expense-accounting-fixture.sql \
  tests/sql/expense-correction-fixture.sql \
  supabase/migrations/20260720024121_expense_atomic_save.sql \
  supabase/migrations/20260720024623_fix_expense_batch_recalculation_alias.sql \
  supabase/migrations/20260912012607_expense_decision_company_authority.sql \
  supabase/migrations/20260912203328_expense_accounting_lifecycle.sql \
  tests/sql/expense-payroll-projection-live-baseline.sql \
  supabase/migrations/20260914200910_expense_payroll_reimbursement_projection.sql \
  tests/sql/expense-correction-baseline.sql \
  supabase/migrations/20260914214748_expense_admin_correction_review.sql \
  supabase/migrations/20260914214748_expense_admin_correction_review.sql \
  tests/sql/expense-correction-runtime.sql; do
  if ! "$task_pg/psql" -h "$task_scratch/socket" -p 55494 -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
    -f "$task_root/$file" >> "$task_logs/psql.log" 2>&1; then
    tail -n 30 "$task_logs/psql.log"
    exit 1
  fi
done
tail -n 5 "$task_logs/psql.log"
python3 "$task_root/tests/runtime/expense-correction-concurrency.py" "$task_pg/psql" "$task_scratch/socket" > "$task_logs/concurrency.log" 2>&1 || { cat "$task_logs/concurrency.log"; exit 1; }
cat "$task_logs/concurrency.log"
"$task_pg/psql" -h "$task_scratch/socket" -p 55494 -U postgres -d postgres -X -At -c "select n.nspname||'.'||p.proname,md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname) in (('public','place_expense'),('public','tg_place_expense'),('private','enforce_expense_edit_authority'));" > "$task_logs/function-hashes.txt"
# Re-run the existing P5 accounting vertical with P7 installed in a clean DB.
"$task_pg/createdb" -h "$task_scratch/socket" -p 55494 -U postgres expense_p5
for file in \
  tests/sql/expense-decision-authority-baseline.sql \
  tests/sql/expense-accounting-fixture.sql \
  tests/sql/expense-correction-fixture.sql \
  supabase/migrations/20260720024121_expense_atomic_save.sql \
  supabase/migrations/20260720024623_fix_expense_batch_recalculation_alias.sql \
  supabase/migrations/20260912012607_expense_decision_company_authority.sql \
  supabase/migrations/20260912203328_expense_accounting_lifecycle.sql \
  tests/sql/expense-payroll-projection-live-baseline.sql \
  supabase/migrations/20260914200910_expense_payroll_reimbursement_projection.sql \
  supabase/migrations/20260914214748_expense_admin_correction_review.sql \
  tests/sql/expense-accounting-runtime.sql; do
  if ! "$task_pg/psql" -h "$task_scratch/socket" -p 55494 -U postgres -d expense_p5 -X -v ON_ERROR_STOP=1 \
    -f "$task_root/$file" >> "$task_logs/p5-accounting.log" 2>&1; then
    tail -n 30 "$task_logs/p5-accounting.log"
    exit 1
  fi
done
tail -n 5 "$task_logs/p5-accounting.log"
# A changed source body must require a fresh review instead of being overwritten.
"$task_pg/psql" -h "$task_scratch/socket" -p 55494 -U postgres -d expense_p5 -X -v ON_ERROR_STOP=1 \
  -c "alter function public.tg_place_expense() set search_path='public';" >> "$task_logs/p5-accounting.log" 2>&1
if "$task_pg/psql" -h "$task_scratch/socket" -p 55494 -U postgres -d expense_p5 -X -v ON_ERROR_STOP=1 \
  -f "$task_root/supabase/migrations/20260914214748_expense_admin_correction_review.sql" > "$task_logs/drift-rejection.log" 2>&1; then
  echo 'Expected source drift rejection did not occur'; exit 1
fi
rg -q 'Expense authority or placement changed' "$task_logs/drift-rejection.log"
"$task_pg/psql" -h "$task_scratch/socket" -p 55494 -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -c "alter function private.lock_expense_approver_context() rename to test_missing_expense_context;" >> "$task_logs/psql.log" 2>&1
if "$task_pg/psql" -h "$task_scratch/socket" -p 55494 -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -f "$task_root/supabase/migrations/20260914214748_expense_admin_correction_review.sql" > "$task_logs/prerequisite-rejection.log" 2>&1; then
  echo 'Expected prerequisite rejection did not occur'; exit 1
fi
rg -q 'Install the P5 expense decision and accounting migrations first' "$task_logs/prerequisite-rejection.log"
echo '2 migration safety rejection checks passed'
printf 'Verification logs: %s\n' "$task_logs"
