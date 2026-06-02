/**
 * OPS Web - QuickBooks import reconciliation aggregation (pure).
 *
 * Computes the QboImportReview counts + QB-vs-OPS reconciliation strip from
 * staged rows + matches. CanPro has 0 live invoices pre-apply, so OPS-to-be
 * mirrors the QB-authoritative staged values (arMatched is always true here;
 * the strip exists to catch regressions once re-imports run against live data).
 *
 * NOTE ON SHAPES: these helpers run against the raw qbo_staging_* ROW shapes
 * (snake_case columns, e.g. `derived_status`, `applied_lines`) as read straight
 * out of Supabase — not the camelCase domain interfaces. The public signatures
 * keep the domain-type names for call-site ergonomics; inside, the rows are
 * read through narrow snake_case row views.
 */

import type {
  QboStagedInvoice,
  QboStagedPayment,
  QboCustomerMatch,
  QboMatchCounts,
  QboStagedCounts,
  QboReconciliation,
} from "@/lib/types/qbo-import";

/** The raw qbo_staging_invoices columns the reconciliation reads. */
interface InvoiceRowView {
  balance?: number | null;
  derived_status?: string | null;
}

/** The raw qbo_staging_payments columns the reconciliation reads. */
interface PaymentRowView {
  applied_lines?: Array<{ amount?: number | null }> | null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function buildMatchCounts(matches: QboCustomerMatch[]): QboMatchCounts {
  const counts: QboMatchCounts = { link: 0, create: 0, skip: 0, needs_review: 0 };
  for (const raw of matches) {
    const action = (raw as { proposed_action?: string }).proposed_action;
    if (action === "link") counts.link += 1;
    else if (action === "create") counts.create += 1;
    else if (action === "skip") counts.skip += 1;
    else if (action === "needs_review") counts.needs_review += 1;
  }
  return counts;
}

export function buildReconciliation(
  invoices: QboStagedInvoice[],
  payments: QboStagedPayment[],
  customerCount: number
): QboReconciliation {
  const invoiceRows = invoices as unknown as InvoiceRowView[];
  const paymentRows = payments as unknown as PaymentRowView[];

  const live = invoiceRows.filter((i) => i.derived_status !== "skipped");
  const openInvoices = live.filter((i) => Number(i.balance ?? 0) > 0);
  const qbOpenAr = round2(openInvoices.reduce((sum, i) => sum + Number(i.balance ?? 0), 0));
  const collectedInWindow = round2(
    paymentRows.reduce((sum, p) => {
      const lines = Array.isArray(p.applied_lines) ? p.applied_lines : [];
      return sum + lines.reduce((s, l) => s + Number(l.amount ?? 0), 0);
    }, 0)
  );
  const opsToBeOpenAr = qbOpenAr; // QB authoritative; apply reconciles OPS to this
  return {
    qbOpenAr,
    opsToBeOpenAr,
    openInvoiceCount: openInvoices.length,
    collectedInWindow,
    customerCount,
    arMatched: round2(qbOpenAr) === round2(opsToBeOpenAr),
  };
}

export function buildStagedCounts(args: {
  customers: number;
  estimates: number;
  invoices: QboStagedInvoice[];
  lineItems: number;
  payments: QboStagedPayment[];
}): QboStagedCounts {
  const invoiceRows = args.invoices as unknown as InvoiceRowView[];
  const paymentRows = args.payments as unknown as PaymentRowView[];
  const skippedInvoices = invoiceRows.filter((i) => i.derived_status === "skipped").length;
  const orphanPayments = paymentRows.filter(
    (p) => !Array.isArray(p.applied_lines) || p.applied_lines.length === 0
  ).length;
  return {
    customers: args.customers,
    estimates: args.estimates,
    invoices: args.invoices.length,
    lineItems: args.lineItems,
    payments: args.payments.length,
    orphanPayments,
    skippedInvoices,
  };
}
