export interface ExpenseAccountingIssue {
  queueId: string;
  provider: "quickbooks" | "sage";
  kind: "accrual" | "purchase" | "settlement" | "reversal" | "review";
  merchantName: string | null;
  amount: number | null;
  currency: string | null;
  expenseDate: string | null;
  reason:
    | "accounts"
    | "tax"
    | "crew"
    | "project"
    | "currency"
    | "details"
    | "unknown";
  recovery: "retry" | "connection" | "reconcile";
}

export interface ExpenseAccountingIssuePage {
  connectionId: string;
  issues: ExpenseAccountingIssue[];
  nextOffset: number | null;
}
