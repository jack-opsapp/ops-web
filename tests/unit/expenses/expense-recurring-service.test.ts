// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state: {
  tables: Record<string, Row[]>;
  rpcResult: { data: unknown; error: { message: string; code?: string } | null };
  calls: { kind: string; name: string; args: unknown }[];
} = { tables: {}, rpcResult: { data: null, error: null }, calls: [] };

function query(table: string) {
  let rows = [...(state.tables[table] ?? [])];
  const builder = {
    select(columns: string) {
      state.calls.push({ kind: "select", name: table, args: columns });
      return builder;
    },
    eq(column: string, value: unknown) {
      rows = rows.filter((r) => r[column] === value);
      return builder;
    },
    is(column: string, value: unknown) {
      rows = rows.filter((r) => (r[column] ?? null) === value);
      return builder;
    },
    in(column: string, values: unknown[]) {
      rows = rows.filter((r) => values.includes(r[column]));
      return builder;
    },
    order() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(resolve: (value: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: string) => query(table),
    rpc: (name: string, args: unknown) => {
      state.calls.push({ kind: "rpc", name, args });
      return Promise.resolve(state.rpcResult);
    },
  }),
}));

import {
  ExpenseRecurringReimbursementService,
  RecurringReimbursementError,
} from "@/lib/api/services/expense-recurring-reimbursement-service";

const setupRow = {
  id: "setup-1",
  company_id: "co-1",
  user_id: "matt",
  name: "Vehicle advertising",
  amount: 350,
  currency: "CAD",
  category_id: "cat-1",
  first_period: "2026-08-01",
  last_period: null,
  next_period: "2026-10-01",
  created_by: "jackson",
  updated_by: "jackson",
  created_at: "2026-09-17T02:41:12.123456+00:00",
  updated_at: "2026-09-17T02:41:12.123456+00:00",
  deleted_at: null,
  deleted_by: null,
};

beforeEach(() => {
  state.calls = [];
  state.rpcResult = { data: null, error: null };
  state.tables = {
    companies: [{ id: "co-1", currency_code: "CAD", timezone: "America/Vancouver" }],
    expense_recurring_reimbursements: [
      setupRow,
      { ...setupRow, id: "setup-gone", deleted_at: "2026-09-17T03:00:00Z", deleted_by: "jackson" },
      { ...setupRow, id: "setup-other-co", company_id: "co-2" },
    ],
    expenses: [
      { id: "line-sep", recurring_reimbursement_id: "setup-1", recurring_period: "2026-09-01", batch_id: "b-9", status: "approved", amount: "350", deleted_at: null },
      { id: "line-aug", recurring_reimbursement_id: "setup-1", recurring_period: "2026-08-01", batch_id: "b-8", status: "approved", amount: "350", deleted_at: null },
      { id: "line-jul", recurring_reimbursement_id: "setup-1", recurring_period: "2026-07-01", batch_id: "b-7", status: "approved", amount: "350", deleted_at: "2026-09-17T04:00:00Z" },
    ],
    users: [
      { id: "matt", first_name: "Dana", last_name: "Kerr", email: "m@example.test", profile_image_url: null },
    ],
    expense_categories: [{ id: "cat-1", name: "Advertising" }],
  };
});

describe("ExpenseRecurringReimbursementService.fetchCompany", () => {
  it("returns live setups with their months, person, category and company calendar", async () => {
    const snapshot = await ExpenseRecurringReimbursementService.fetchCompany("co-1");

    expect(snapshot.currency).toBe("CAD");
    expect(snapshot.timeZone).toBe("America/Vancouver");
    expect(snapshot.setups.map((s) => s.id)).toEqual(["setup-1"]);

    const [setup] = snapshot.setups;
    expect(setup).toMatchObject({
      userId: "matt",
      name: "Vehicle advertising",
      amount: 350,
      currency: "CAD",
      firstPeriod: "2026-08-01",
      lastPeriod: null,
      nextPeriod: "2026-10-01",
      updatedAt: "2026-09-17T02:41:12.123456+00:00",
      categoryName: "Advertising",
    });
    expect(setup.person).toMatchObject({ firstName: "Dana", lastName: "Kerr" });
    expect(setup.lines).toEqual([
      { expenseId: "line-jul", period: "2026-07-01", batchId: "b-7", status: "approved", amount: 350, deleted: true },
      { expenseId: "line-aug", period: "2026-08-01", batchId: "b-8", status: "approved", amount: 350, deleted: false },
      { expenseId: "line-sep", period: "2026-09-01", batchId: "b-9", status: "approved", amount: 350, deleted: false },
    ]);
  });

  it("skips the follow-up reads when nothing is set up", async () => {
    state.tables.expense_recurring_reimbursements = [];
    const snapshot = await ExpenseRecurringReimbursementService.fetchCompany("co-1");
    expect(snapshot.setups).toEqual([]);
    expect(state.calls.some((c) => c.name === "expenses")).toBe(false);
  });
});

describe("ExpenseRecurringReimbursementService commands", () => {
  const receipt = {
    ...setupRow,
    lines: [
      { expense_id: "line-aug", period: "2026-08-01", batch_id: "b-8", status: "approved", amount: 350, deleted: false },
    ],
  };

  it("creates with the exact RPC contract and maps the receipt", async () => {
    state.rpcResult = { data: receipt, error: null };
    const result = await ExpenseRecurringReimbursementService.create({
      userId: "matt",
      name: "Vehicle advertising",
      amount: 350,
      firstPeriod: "2026-08-01",
      categoryId: null,
    });
    expect(state.calls.at(-1)).toEqual({
      kind: "rpc",
      name: "create_expense_recurring_reimbursement",
      args: {
        p_user_id: "matt",
        p_name: "Vehicle advertising",
        p_amount: 350,
        p_first_period: "2026-08-01",
        p_category_id: null,
      },
    });
    expect(result.lines).toEqual([
      { expenseId: "line-aug", period: "2026-08-01", batchId: "b-8", status: "approved", amount: 350, deleted: false },
    ]);
  });

  it("sends the optimistic-concurrency token on every change", async () => {
    state.rpcResult = { data: receipt, error: null };
    const token = setupRow.updated_at;
    await ExpenseRecurringReimbursementService.update({
      id: "setup-1",
      name: "Vehicle advertising",
      amount: 400,
      categoryId: "cat-1",
      expectedUpdatedAt: token,
    });
    await ExpenseRecurringReimbursementService.end("setup-1", "2026-12-01", token);
    await ExpenseRecurringReimbursementService.end("setup-1", null, token);
    await ExpenseRecurringReimbursementService.remove("setup-1", token);
    await ExpenseRecurringReimbursementService.skipLine("line-aug");
    await ExpenseRecurringReimbursementService.restoreLine("line-aug");

    expect(state.calls.filter((c) => c.kind === "rpc")).toEqual([
      { kind: "rpc", name: "update_expense_recurring_reimbursement", args: { p_id: "setup-1", p_name: "Vehicle advertising", p_amount: 400, p_category_id: "cat-1", p_expected_updated_at: token } },
      { kind: "rpc", name: "end_expense_recurring_reimbursement", args: { p_id: "setup-1", p_last_period: "2026-12-01", p_expected_updated_at: token } },
      { kind: "rpc", name: "end_expense_recurring_reimbursement", args: { p_id: "setup-1", p_last_period: null, p_expected_updated_at: token } },
      { kind: "rpc", name: "delete_expense_recurring_reimbursement", args: { p_id: "setup-1", p_expected_updated_at: token } },
      { kind: "rpc", name: "skip_expense_recurring_reimbursement_line", args: { p_expense_id: "line-aug" } },
      { kind: "rpc", name: "restore_expense_recurring_reimbursement_line", args: { p_expense_id: "line-aug" } },
    ]);
  });

  it("keeps the server's message and SQLSTATE on failure", async () => {
    state.rpcResult = {
      data: null,
      error: { message: "This person already has a recurring reimbursement with that name.", code: "23505" },
    };
    const attempt = ExpenseRecurringReimbursementService.create({
      userId: "matt",
      name: "Vehicle advertising",
      amount: 350,
      firstPeriod: "2026-08-01",
      categoryId: null,
    });
    await expect(attempt).rejects.toBeInstanceOf(RecurringReimbursementError);
    await expect(attempt).rejects.toMatchObject({
      message: "This person already has a recurring reimbursement with that name.",
      code: "23505",
    });
  });
});
