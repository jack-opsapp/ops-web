import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260901190000_agent_payroll_readiness.sql"
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("payroll readiness SQL contract", () => {
  it("pins v14/v8 authority, exact finance permissions, and least privilege", () => {
    const sql = migration();

    expect(sql).toContain("'2026-09-01.capability-manifest.v14'");
    expect(sql).toContain("'2026-09-01.mcp-exposure.v8'");
    expect(sql).toContain("'check_payroll_readiness:2026-09-01.v1'");
    for (const scope of [
      "ops.company.read",
      "ops.expenses.read",
      "ops.financial_documents.read",
      "ops.financials.read",
      "ops.payments.read",
    ]) {
      expect(sql).toContain(`'${scope}'`);
    }
    for (const permission of [
      "expenses.view",
      "invoices.view",
      "reports.view",
      "settings.company",
    ]) {
      expect(sql).toContain(`'${permission}'`);
    }
    expect(sql.match(/set search_path = ''/gu)).toHaveLength(2);
    expect(sql).toMatch(
      /revoke all on function public\.read_agent_payroll_readiness_as_system[\s\S]*from public, anon, authenticated;/u
    );
    expect(sql).toMatch(
      /grant execute on function public\.read_agent_payroll_readiness_as_system[\s\S]*to service_role;/u
    );
  });

  it("adds only nullable structured metadata with safe checks and exact access paths", () => {
    const sql = migration();

    expect(sql).toContain("obligation_kind text");
    expect(sql).toContain("due_time_local time without time zone");
    expect(sql).toContain("forecast_obligations_confirmed_through date");
    expect(sql).toContain("forecast_obligations_confirmed_at timestamptz");
    expect(sql).toContain("obligation_kind in ('payroll', 'other')");
    expect(sql).toContain("column_row.column_default is not null");
    expect(sql).toContain("column_row.is_identity is distinct from 'NO'");
    expect(sql).toContain("column_row.is_generated is distinct from 'NEVER'");
    expect(sql).toContain("column_row.datetime_precision is distinct from");
    for (const index of [
      "recurring_expenses_agent_payroll_due_v1_idx",
      "expense_batches_agent_payroll_due_v1_idx",
      "invoices_agent_payroll_open_v1_idx",
      "payments_agent_payroll_history_v1_idx",
    ]) {
      expect(sql).toContain(index);
    }
  });

  it("uses exact live sources and derives settlement from cumulative non-void payments", () => {
    const sql = migration();

    for (const source of [
      "public.companies",
      "public.expense_settings",
      "public.recurring_expenses",
      "public.expense_batches",
      "public.expenses",
      "public.invoices",
      "public.payments",
    ]) {
      expect(sql).toContain(source);
    }
    expect(sql).toContain("sum(invoice_payment_source.amount)");
    expect(sql.match(/SS\.US"Z"/gu)).toHaveLength(5);
    expect(sql).not.toContain('SS.MS"Z"');
    expect(sql).toContain("else '__invalid__'");
    expect(sql).toContain("else '__mismatch__'");
    expect(sql).toContain("least(count(*), 10000::bigint)");
    expect(sql).toContain("sum(payment_daily.daily_amount) over");
    expect(sql).toContain("future_minimum_amount");
    expect(sql).toContain("payment.voided_at is null");
    expect(
      sql.match(/payment\.payment_date <= v_business_date/gu)
    ).toHaveLength(4);
    expect(sql).toContain("same_payment.payment_date <= v_business_date");
    expect(sql).toContain("duplicate.payment_date <= v_business_date");
    expect(sql).not.toContain("payment.amount > 0");
    expect(sql).toMatch(
      /future_minimum_amount\s*>=\s*payment_sustained\.invoice_total/u
    );
    expect(sql).not.toMatch(/invoice\.paid_at/u);
    expect(sql).toContain("settlement.settled_on - settlement.due_date");
    expect(sql).toContain(
      "status in ('sent', 'awaiting_payment', 'partially_paid', 'past_due')"
    );
  });

  it("pins input bounds, source revisions, revision triggers, and a read-only function body", () => {
    const sql = migration();

    expect(sql).toContain("p_recurring_obligation_limit is distinct from 40");
    expect(sql).toContain("p_reimbursement_batch_limit is distinct from 50");
    expect(sql).toContain("p_receivable_limit is distinct from 100");
    expect(sql).toContain("p_payer_history_limit is distinct from 500");
    expect(sql).toContain("p_target_date > v_business_date + 93");
    expect(sql).toContain("'company', v_company_revision");
    expect(sql).toContain("'payroll_readiness', v_payroll_revision");
    for (const table of [
      "expense_settings",
      "recurring_expenses",
      "expense_batches",
      "expenses",
      "invoices",
      "payments",
    ]) {
      expect(sql).toContain(
        `create trigger ${table}_agent_payroll_source_revision_v1`
      );
    }
    const readBody = sql.slice(
      sql.indexOf(
        "create or replace function public.read_agent_payroll_readiness_as_system"
      ),
      sql.indexOf(
        "revoke all on function public.read_agent_payroll_readiness_as_system"
      )
    );
    expect(readBody).not.toMatch(/\b(?:insert|update|delete|merge|notify)\b/iu);
  });
});
