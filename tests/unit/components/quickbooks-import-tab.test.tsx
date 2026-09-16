import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
// Default: QuickBooks connected. Toggle `connected`/`hasConnectionRow` to drive
// the connected / reconnect / never-connected paths. `applyImport.isPending` is
// always false in this suite.
let connected = true;
let hasConnectionRow = true;
const initiateMutate = vi.fn();
vi.mock("@/lib/hooks/use-accounting", () => ({
  useAccountingConnections: () => ({
    data: hasConnectionRow
      ? [{ provider: "quickbooks", isConnected: connected }]
      : [],
  }),
  useInitiateOAuth: () => ({ mutate: initiateMutate, isPending: false }),
}));
// Every company client — the Link picker searches all of them.
vi.mock("@/lib/hooks/use-clients", () => ({
  useClients: () => ({
    data: {
      clients: [
        { id: "c-1", name: "Acme", email: "office@acme.ca", phoneNumber: null, deletedAt: null },
        { id: "c-2", name: "Rowan Pike", email: null, phoneNumber: null, deletedAt: null },
        { id: "c-gone", name: "Deleted Client", email: null, phoneNumber: null, deletedAt: new Date("2026-04-26") },
      ],
      remaining: 0,
      count: 3,
    },
    isLoading: false,
  }),
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

// A review whose single customer match is still flagged needs_review (the
// operator has not yet resolved it to link/create/skip). Drives the I7 gate.
const reviewNeedsReview = {
  ...review,
  matches: [
    {
      id: "m2",
      runId: "run-1",
      companyId: "co",
      customerQbId: "QB2",
      proposedAction: "needs_review",
      matchedClientId: null,
      matchBasis: "name_fuzzy",
      confidence: "low",
      candidates: [{ clientId: "c-9", name: "Maybe Co", basis: "name_fuzzy", score: 0.6 }],
      decidedAction: null,
      decidedClientId: null,
    },
  ],
  matchCounts: { link: 0, create: 0, skip: 0, needs_review: 1 },
};

describe("QuickBooksImportTab", () => {
  beforeEach(() => {
    connected = true;
    hasConnectionRow = true;
    reviewData = undefined;
    initiateMutate.mockClear();
  });

  it("shows the empty state with a pull CTA when there is no run", () => {
    reviewData = undefined;
    render(<QuickBooksImportTab />);
    expect(screen.getByText("qbo.empty.noRun")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qbo.pull/ })).toBeInTheDocument();
  });

  it("shows the never-connected state and disables pull when no connection exists", () => {
    connected = false;
    hasConnectionRow = false; // no connection row at all → never connected
    reviewData = undefined;
    render(<QuickBooksImportTab />);
    expect(screen.getByText("qbo.notConnected")).toBeInTheDocument();
    expect(screen.getByText("qbo.connectFirst")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qbo.pull/ })).toBeDisabled();
    expect(screen.queryByTestId("qbo-reconnect-prompt")).not.toBeInTheDocument();
  });

  it("shows the Reconnect prompt when a connection exists but is_connected is false", () => {
    connected = false;
    hasConnectionRow = true; // connection row present, but disconnected
    reviewData = undefined;
    render(<QuickBooksImportTab />);
    expect(screen.getByTestId("qbo-reconnect-prompt")).toBeInTheDocument();
    expect(screen.getByText("qbo.reconnectTitle")).toBeInTheDocument();
    // Pull is disabled; the never-connected prompt is NOT shown.
    expect(screen.getByRole("button", { name: /qbo.pull/ })).toBeDisabled();
    expect(screen.queryByText("qbo.connectFirst")).not.toBeInTheDocument();
    // Reconnect CTA kicks off OAuth re-initiation.
    fireEvent.click(screen.getByRole("button", { name: /qbo.reconnect/ }));
    expect(initiateMutate).toHaveBeenCalledWith({
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      provider: "quickbooks",
    });
  });

  it("renders connection status + last-pulled in the run header", () => {
    reviewData = review;
    render(<QuickBooksImportTab />);
    expect(screen.getByTestId("qbo-connection-status").textContent).toContain(
      "integrations.connected"
    );
    expect(screen.getByText("qbo.lastPulled")).toBeInTheDocument();
    expect(screen.getByText("qbo.never")).toBeInTheDocument();
  });

  it("disables APPLY while a customer is still needs_review, then enables it once resolved", async () => {
    const user = userEvent.setup();
    reviewData = reviewNeedsReview;
    render(<QuickBooksImportTab />);
    // Unresolved needs_review → APPLY blocked + hint shown.
    expect(screen.getByRole("button", { name: /qbo.apply.all/ })).toBeDisabled();
    expect(screen.getByTestId("qbo-needs-review-hint")).toBeInTheDocument();
    // Operator resolves the row to skip → APPLY enabled, hint gone.
    await user.click(screen.getByTestId("match-action-QB2"));
    await user.click(screen.getByRole("option", { name: "qbo.action.skip" }));
    expect(screen.getByRole("button", { name: /qbo.apply.all/ })).toBeEnabled();
    expect(screen.queryByTestId("qbo-needs-review-hint")).not.toBeInTheDocument();
  });

  it("disables APPLY while a Link row has no client, then enables it once a client is picked", async () => {
    const user = userEvent.setup();
    reviewData = review;
    render(<QuickBooksImportTab />);
    expect(screen.getByRole("button", { name: /qbo.apply.all/ })).toBeEnabled();

    // Clear the suggested client off the Link row → APPLY blocked + hint shown.
    await user.click(screen.getByTestId("match-candidate-QB1"));
    await user.click(await screen.findByRole("option", { name: /qbo.candidate.none/ }));
    expect(screen.getByRole("button", { name: /qbo.apply.all/ })).toBeDisabled();
    expect(screen.getByTestId("qbo-link-missing-client-hint")).toHaveTextContent(
      "qbo.linkMissingClientBlock"
    );
    expect(screen.getByTestId("match-row-QB1")).toHaveAttribute("data-blocking", "true");

    // Pick a client the importer never suggested → APPLY enabled, hint gone.
    await user.click(screen.getByTestId("match-candidate-QB1"));
    await user.click(await screen.findByRole("option", { name: /Rowan Pike/ }));
    expect(screen.getByRole("button", { name: /qbo.apply.all/ })).toBeEnabled();
    expect(screen.queryByTestId("qbo-link-missing-client-hint")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /qbo.apply.all/ }));
    await waitFor(() =>
      expect(applyMutate).toHaveBeenCalledWith({
        runId: "run-1",
        decisions: [{ customer_qb_id: "QB1", action: "link", client_id: "c-2" }],
      })
    );
  });

  it("never offers a deleted client in the Link picker", async () => {
    const user = userEvent.setup();
    reviewData = review;
    render(<QuickBooksImportTab />);
    await user.click(screen.getByTestId("match-candidate-QB1"));
    await screen.findByRole("option", { name: /Rowan Pike/ });
    expect(screen.queryByRole("option", { name: /Deleted Client/ })).not.toBeInTheDocument();
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
    // Candidate option renders "Acme · 100%" (name + score), so match on substring.
    expect(screen.getByText(/Acme/)).toBeInTheDocument();
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
