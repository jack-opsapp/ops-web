import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// NOTE: the fixture below is reconciled to the A0-owned `QboImportReview` type
// (the plan's A4.5 draft predates the canonical type and referenced a
// non-existent `counts`/`displayName`/`opsOpenAr`/`qbCollected24mo` shape). The
// real review carries `run` (full QboImportRun), `matchCounts`, `stagedCounts`,
// and a `reconciliation` of { qbOpenAr, opsToBeOpenAr, openInvoiceCount,
// collectedInWindow, customerCount, arMatched }. The recon strip + match table
// render for real (not mocked), so the fixture must satisfy their prop types.

const startMutate = vi.fn().mockResolvedValue({ runId: "run-1" });
const applyMutate = vi.fn().mockResolvedValue({
  applied: { customers: 2, estimates: 0, invoices: 3, payments: 1, lineItems: 7 },
});
let reviewData: unknown = undefined;

vi.mock("@/lib/hooks/use-qbo-import", () => ({
  useStartImport: () => ({ mutateAsync: startMutate, isPending: false }),
  useImportReview: () => ({ data: reviewData, isLoading: false, isError: false }),
  useApplyImport: () => ({ mutateAsync: applyMutate, isPending: false }),
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "a612edc0-5c18-4c4d-af97-55b9410dd077" } }),
}));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (k: string, vars?: Record<string, string | number>) =>
      vars
        ? Object.entries(vars).reduce((s, [kk, v]) => s.replace(`{${kk}}`, String(v)), k)
        : k,
  }),
  useLocale: () => ({ locale: "en" }),
}));

import { QuickBooksImportTab } from "@/components/accounting/qbo/quickbooks-import-tab";

const review = {
  run: {
    id: "run-1",
    companyId: "co",
    provider: "quickbooks",
    status: "staged",
    historyCutoff: null,
    qbWriteCalls: 0,
    totals: {},
    error: null,
    createdBy: null,
    createdAt: null,
    finishedAt: null,
  },
  matches: [
    {
      id: "m1",
      runId: "run-1",
      companyId: "co",
      customerQbId: "QB1",
      proposedAction: "link",
      matchedClientId: "c-1",
      matchBasis: "email",
      confidence: "high",
      candidates: [{ clientId: "c-1", name: "Acme", basis: "email", score: 1 }],
      decidedAction: null,
      decidedClientId: null,
    },
  ],
  matchCounts: { link: 1, create: 0, skip: 0, needs_review: 0 },
  stagedCounts: {
    customers: 1,
    estimates: 0,
    invoices: 3,
    lineItems: 7,
    payments: 1,
    orphanPayments: 0,
    skippedInvoices: 0,
  },
  reconciliation: {
    qbOpenAr: 100,
    opsToBeOpenAr: 100,
    openInvoiceCount: 3,
    collectedInWindow: 50,
    customerCount: 1,
    arMatched: true,
  },
};

describe("QuickBooksImportTab", () => {
  it("shows the empty state with a pull CTA when there is no run", () => {
    reviewData = undefined;
    render(<QuickBooksImportTab />);
    expect(screen.getByText("qbo.empty.noRun")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qbo.pull/ })).toBeInTheDocument();
  });

  it("starts a pull when the CTA is clicked", async () => {
    reviewData = undefined;
    render(<QuickBooksImportTab />);
    fireEvent.click(screen.getByRole("button", { name: /qbo.pull/ }));
    await waitFor(() =>
      expect(startMutate).toHaveBeenCalledWith({
        companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      })
    );
  });

  it("renders recon + matches + records and applies decisions", async () => {
    reviewData = review;
    render(<QuickBooksImportTab />);
    expect(screen.getByTestId("recon-row-openAr")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByTestId("match-action-QB1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /qbo.apply.all/ }));
    await waitFor(() =>
      expect(applyMutate).toHaveBeenCalledWith({
        runId: "run-1",
        decisions: [{ customer_qb_id: "QB1", action: "link", client_id: "c-1" }],
      })
    );
  });

  it("shows the read-only write-call badge as OK at zero", () => {
    reviewData = review;
    render(<QuickBooksImportTab />);
    expect(screen.getByTestId("qbo-write-calls").textContent).toContain(
      "qbo.writeCallsOk"
    );
  });
});
