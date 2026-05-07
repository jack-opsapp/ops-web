/**
 * useProjectLedger — unified ledger for the workspace ACCOUNTING tab.
 *
 * Fans four parallel queries and merges the rows into a single sorted timeline:
 *   - approved estimates           → source: 'estimate'      tone neutral
 *   - non-void / non-draft         → source: 'invoice' or 'change_order'
 *     invoices                       (subsequent invoices linked to an
 *                                     estimate become change orders)
 *   - non-voided payments          → source: 'payment'       NEGATIVE amount,
 *                                                            tone olive
 *   - approved expense allocations → source: 'expense'       NEGATIVE amount,
 *                                                            tone rose
 *
 * estimates.project_id and expense_project_allocations.project_id are TEXT;
 * invoices.project_id is uuid. Each branch passes the projectId string to
 * supabase-js which serializes it consistently — no cast needed wire-side.
 */

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { queryKeys } from "@/lib/api/query-client";

export type LedgerSource =
  | "estimate"
  | "invoice"
  | "change_order"
  | "payment"
  | "expense";

export type LedgerStatusTone = "neutral" | "olive" | "tan" | "rose" | "accent";
export type LedgerAmountTone = "text" | "olive" | "rose";

export interface LedgerRow {
  recordId: string;
  description: string;
  status: string;
  statusTone: LedgerStatusTone;
  date: string; // YYYY-MM-DD
  amount: number; // positive = quoted/billed; negative = received/expense
  amountTone: LedgerAmountTone;
  source: LedgerSource;
}

interface EstimateRow {
  id: string;
  estimate_number: string;
  status: string;
  total: number | string;
  issue_date: string | null;
  created_at: string;
  title: string | null;
  client_message: string | null;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  total: number | string;
  issue_date: string | null;
  due_date: string | null;
  created_at: string;
  client_message: string | null;
  estimate_id: string | null;
}

interface PaymentRow {
  id: string;
  invoice_id: string;
  reference_number: string | null;
  amount: number | string;
  payment_date: string;
  created_at: string;
  invoices: { project_id: string; invoice_number: string } | null;
}

interface ExpenseAllocationRow {
  expense: {
    id: string;
    amount: number | string;
    description: string | null;
    expense_date: string | null;
    status: string;
    created_at: string;
  };
  amount: number | string | null;
  percentage: number | string;
}

const ESTIMATE_TONE: Record<string, LedgerStatusTone> = {
  draft: "neutral",
  sent: "tan",
  approved: "olive",
  declined: "rose",
  expired: "rose",
};

const INVOICE_TONE: Record<string, LedgerStatusTone> = {
  draft: "neutral",
  sent: "tan",
  partial: "tan",
  paid: "olive",
  past_due: "rose",
  void: "neutral",
};

const EXPENSE_TONE: Record<string, LedgerStatusTone> = {
  pending: "tan",
  approved: "olive",
  rejected: "rose",
  flagged: "rose",
};

function num(value: number | string | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value);
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return "";
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function deriveAllocationAmount(row: ExpenseAllocationRow): number {
  if (row.amount != null) return num(row.amount);
  const pct = num(row.percentage);
  if (pct === 0) return 0;
  return (num(row.expense.amount) * pct) / 100;
}

export function useProjectLedger(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.projectWorkspace.ledger(projectId),
    queryFn: async (): Promise<LedgerRow[]> => {
      if (!projectId) return [];
      const supabase = requireSupabase();

      const [estimatesRes, invoicesRes, paymentsRes, allocationsRes] =
        await Promise.all([
          supabase
            .from("estimates")
            .select(
              "id, estimate_number, status, total, issue_date, created_at, title, client_message"
            )
            .eq("project_id", projectId)
            .is("deleted_at", null),
          supabase
            .from("invoices")
            .select(
              "id, invoice_number, status, total, issue_date, due_date, created_at, client_message, estimate_id"
            )
            .eq("project_id", projectId)
            .is("deleted_at", null),
          supabase
            .from("payments")
            .select(
              "id, invoice_id, reference_number, amount, payment_date, created_at, invoices!inner(project_id, invoice_number)"
            )
            .eq("invoices.project_id", projectId)
            .is("voided_at", null),
          supabase
            .from("expense_project_allocations")
            .select(
              "amount, percentage, expense:expenses!inner(id, amount, description, expense_date, status, created_at, deleted_at)"
            )
            .eq("project_id", projectId),
        ]);

      const errors = [
        estimatesRes.error,
        invoicesRes.error,
        paymentsRes.error,
        allocationsRes.error,
      ].filter(Boolean);
      if (errors.length > 0) throw errors[0];

      const estimateRows = (estimatesRes.data ?? []) as EstimateRow[];
      const invoiceRows = (invoicesRes.data ?? []) as InvoiceRow[];
      const paymentRows = (paymentsRes.data ?? []) as unknown as PaymentRow[];
      const allocationRows = (allocationsRes.data ?? []) as unknown as ExpenseAllocationRow[];

      const ledger: LedgerRow[] = [];

      // Estimates — every status enters the ledger; tone communicates state.
      for (const e of estimateRows) {
        ledger.push({
          recordId: e.estimate_number,
          description: e.title ?? e.client_message ?? "Estimate",
          status: e.status,
          statusTone: ESTIMATE_TONE[e.status] ?? "neutral",
          date: dateOnly(e.issue_date ?? e.created_at),
          amount: num(e.total),
          amountTone: "text",
          source: "estimate",
        });
      }

      // Invoices — void invoices are reversed entries and excluded; drafts stay
      // so the user can see in-flight work. First invoice (by created_at) is
      // always 'invoice'; subsequent invoices linked to an estimate become
      // 'change_order'.
      const sortedInvoices = [...invoiceRows].sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
      );
      sortedInvoices.forEach((inv, idx) => {
        if (inv.status === "void") return;
        const isChangeOrder = idx > 0 && !!inv.estimate_id;
        ledger.push({
          recordId: inv.invoice_number,
          description: inv.client_message ?? (isChangeOrder ? "Change order" : "Invoice"),
          status: inv.status,
          statusTone: INVOICE_TONE[inv.status] ?? "neutral",
          date: dateOnly(inv.issue_date ?? inv.created_at),
          amount: num(inv.total),
          amountTone: "text",
          source: isChangeOrder ? "change_order" : "invoice",
        });
      });

      // Payments — voided already filtered. Render as negative (money in lowers AR).
      for (const p of paymentRows) {
        const recordId =
          p.reference_number ??
          (p.invoices?.invoice_number ? `${p.invoices.invoice_number} payment` : "Payment");
        ledger.push({
          recordId,
          description: p.invoices?.invoice_number
            ? `Payment for ${p.invoices.invoice_number}`
            : "Payment received",
          status: "received",
          statusTone: "olive",
          date: dateOnly(p.payment_date),
          amount: -num(p.amount),
          amountTone: "olive",
          source: "payment",
        });
      }

      // Expenses — allocation row carries the project-share amount.
      for (const a of allocationRows) {
        const allocated = deriveAllocationAmount(a);
        if (allocated === 0) continue;
        ledger.push({
          recordId: a.expense.id,
          description: a.expense.description ?? "Expense",
          status: a.expense.status,
          statusTone: EXPENSE_TONE[a.expense.status] ?? "neutral",
          date: dateOnly(a.expense.expense_date ?? a.expense.created_at),
          amount: -allocated,
          amountTone: "rose",
          source: "expense",
        });
      }

      ledger.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
      return ledger;
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
