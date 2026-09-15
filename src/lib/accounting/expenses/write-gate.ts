import "server-only";

export const EXPENSE_ACCOUNTING_PAUSED_MESSAGE = "Expense accounting sync is paused.";

/** Expense activation is independent of existing AR/AP and provider gates. */
export function expenseAccountingWritesEnabled(): boolean {
  return process.env.EXPENSE_ACCOUNTING_WRITE_ENABLED === "true";
}
