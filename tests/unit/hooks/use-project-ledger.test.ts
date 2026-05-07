/**
 * useProjectLedger — unified accounting ledger across:
 *   - approved estimates (source: 'estimate', positive amount, tone neutral)
 *   - non-void/draft invoices (source: 'invoice' or 'change_order', positive amount, tone neutral)
 *   - non-voided payments (source: 'payment', NEGATIVE amount, tone olive)
 *   - non-deleted expenses allocated to the project via expense_project_allocations
 *     (source: 'expense', NEGATIVE amount, tone rose)
 *
 * Result is sorted descending by `date`. Status tones map to the OPS earth-tone
 * semantic palette (olive / tan / rose / neutral / accent).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface EstimateRow {
  id: string;
  estimate_number: string;
  status: string;
  total: number | string;
  issue_date: string;
  created_at: string;
  title: string | null;
  client_message: string | null;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  total: number | string;
  issue_date: string;
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
  invoices: { project_id: string; invoice_number: string };
}

interface ExpenseAllocationRow {
  expense: {
    id: string;
    amount: number | string;
    description: string | null;
    expense_date: string;
    status: string;
    created_at: string;
  };
  amount: number | string | null;
  percentage: number | string;
}

let estimates: EstimateRow[] = [];
let invoices: InvoiceRow[] = [];
let payments: PaymentRow[] = [];
let allocations: ExpenseAllocationRow[] = [];

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      if (table === "estimates") {
        return {
          select: () => ({
            eq: () => ({
              is: () => Promise.resolve({ data: estimates, error: null }),
            }),
          }),
        };
      }
      if (table === "invoices") {
        return {
          select: () => ({
            eq: () => ({
              is: () => Promise.resolve({ data: invoices, error: null }),
            }),
          }),
        };
      }
      if (table === "payments") {
        return {
          select: () => ({
            eq: () => ({
              is: () => Promise.resolve({ data: payments, error: null }),
            }),
          }),
        };
      }
      if (table === "expense_project_allocations") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: allocations, error: null }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { useProjectLedger } from "@/lib/hooks/use-project-ledger";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  estimates = [];
  invoices = [];
  payments = [];
  allocations = [];
});

describe("useProjectLedger", () => {
  it("merges all four sources and sorts descending by date", async () => {
    estimates = [
      {
        id: "e1",
        estimate_number: "EST-00128",
        status: "approved",
        total: "12500",
        issue_date: "2026-04-01",
        created_at: "2026-04-01T09:00:00Z",
        title: "Driveway sealing — Phase 1",
        client_message: null,
      },
    ];
    invoices = [
      {
        id: "i1",
        invoice_number: "INV-00280",
        status: "paid",
        total: "12500",
        issue_date: "2026-04-15",
        due_date: "2026-05-15",
        created_at: "2026-04-15T09:00:00Z",
        client_message: null,
        estimate_id: "e1",
      },
    ];
    payments = [
      {
        id: "p1",
        invoice_id: "i1",
        reference_number: "PAY-00193",
        amount: "12500",
        payment_date: "2026-04-20",
        created_at: "2026-04-20T09:00:00Z",
        invoices: { project_id: "proj-1", invoice_number: "INV-00280" },
      },
    ];
    allocations = [
      {
        expense: {
          id: "x1",
          amount: "240",
          description: "Asphalt sealer",
          expense_date: "2026-04-10",
          status: "approved",
          created_at: "2026-04-10T09:00:00Z",
        },
        amount: "240",
        percentage: "100",
      },
    ];

    const { result } = renderHook(() => useProjectLedger("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const rows = result.current.data!;

    expect(rows).toHaveLength(4);
    // Descending by date: payment 2026-04-20 → invoice 2026-04-15 → expense 2026-04-10 → estimate 2026-04-01
    expect(rows.map((r) => r.source)).toEqual(["payment", "invoice", "expense", "estimate"]);
  });

  it("flags subsequent invoices linked to an estimate as change_order", async () => {
    invoices = [
      // first invoice on the project — always 'invoice' regardless of estimate_id
      {
        id: "i1",
        invoice_number: "INV-00280",
        status: "paid",
        total: "10000",
        issue_date: "2026-03-01",
        due_date: "2026-04-01",
        created_at: "2026-03-01T09:00:00Z",
        client_message: null,
        estimate_id: "e1",
      },
      // second invoice with estimate_id → change_order
      {
        id: "i2",
        invoice_number: "INV-00285",
        status: "sent",
        total: "2500",
        issue_date: "2026-04-15",
        due_date: "2026-05-15",
        created_at: "2026-04-15T09:00:00Z",
        client_message: null,
        estimate_id: "e1",
      },
      // third invoice without estimate_id → still 'invoice'
      {
        id: "i3",
        invoice_number: "INV-00290",
        status: "draft",
        total: "1000",
        issue_date: "2026-04-20",
        due_date: "2026-05-20",
        created_at: "2026-04-20T09:00:00Z",
        client_message: null,
        estimate_id: null,
      },
    ];

    const { result } = renderHook(() => useProjectLedger("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const byId = new Map(result.current.data!.map((r) => [r.recordId, r]));
    expect(byId.get("INV-00280")!.source).toBe("invoice");
    expect(byId.get("INV-00285")!.source).toBe("change_order");
    expect(byId.get("INV-00290")!.source).toBe("invoice");
  });

  it("renders payments and expenses as negative amounts with their tones", async () => {
    payments = [
      {
        id: "p1",
        invoice_id: "i1",
        reference_number: "PAY-00193",
        amount: "5000",
        payment_date: "2026-04-20",
        created_at: "2026-04-20T09:00:00Z",
        invoices: { project_id: "proj-1", invoice_number: "INV-00280" },
      },
    ];
    allocations = [
      {
        expense: {
          id: "x1",
          amount: "240",
          description: "Asphalt sealer",
          expense_date: "2026-04-10",
          status: "approved",
          created_at: "2026-04-10T09:00:00Z",
        },
        amount: "240",
        percentage: "100",
      },
    ];

    const { result } = renderHook(() => useProjectLedger("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const payment = result.current.data!.find((r) => r.source === "payment")!;
    expect(payment.amount).toBe(-5000);
    expect(payment.amountTone).toBe("olive");

    const expense = result.current.data!.find((r) => r.source === "expense")!;
    expect(expense.amount).toBe(-240);
    expect(expense.amountTone).toBe("rose");
  });

  it("falls back to allocated amount derived from percentage when amount is null", async () => {
    allocations = [
      {
        expense: {
          id: "x1",
          amount: "1000",
          description: "Shared materials",
          expense_date: "2026-04-10",
          status: "approved",
          created_at: "2026-04-10T09:00:00Z",
        },
        amount: null,
        percentage: "25",
      },
    ];

    const { result } = renderHook(() => useProjectLedger("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const expense = result.current.data!.find((r) => r.source === "expense")!;
    expect(expense.amount).toBe(-250); // 25% of 1000 = 250
  });

  it("maps estimate / invoice / expense statuses to OPS tones", async () => {
    estimates = [
      {
        id: "e1",
        estimate_number: "EST-A",
        status: "approved",
        total: "100",
        issue_date: "2026-04-01",
        created_at: "2026-04-01T09:00:00Z",
        title: null,
        client_message: null,
      },
      {
        id: "e2",
        estimate_number: "EST-B",
        status: "declined",
        total: "100",
        issue_date: "2026-04-02",
        created_at: "2026-04-02T09:00:00Z",
        title: null,
        client_message: null,
      },
    ];
    invoices = [
      {
        id: "i1",
        invoice_number: "INV-A",
        status: "paid",
        total: "100",
        issue_date: "2026-04-03",
        due_date: null,
        created_at: "2026-04-03T09:00:00Z",
        client_message: null,
        estimate_id: null,
      },
      {
        id: "i2",
        invoice_number: "INV-B",
        status: "past_due",
        total: "100",
        issue_date: "2026-04-04",
        due_date: null,
        created_at: "2026-04-04T09:00:00Z",
        client_message: null,
        estimate_id: null,
      },
    ];

    const { result } = renderHook(() => useProjectLedger("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const byId = new Map(result.current.data!.map((r) => [r.recordId, r]));
    expect(byId.get("EST-A")!.statusTone).toBe("olive");
    expect(byId.get("EST-B")!.statusTone).toBe("rose");
    expect(byId.get("INV-A")!.statusTone).toBe("olive");
    expect(byId.get("INV-B")!.statusTone).toBe("rose");
  });

  it("does not fetch when projectId is null", async () => {
    const { result } = renderHook(() => useProjectLedger(null), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isFetching).toBe(false);
  });
});
