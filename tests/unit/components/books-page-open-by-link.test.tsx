/**
 * BooksPage — a document link into a segment the operator cannot see.
 *
 * Universal search hands Books `?segment=invoices&invoice=<id>` /
 * `?segment=estimates&estimate=<id>`, and the segment's own hook answers it.
 * But a segment the operator has no permission for never mounts, so nobody
 * downstream is listening: the link would sit in the URL doing nothing. The
 * page itself has to say the document is not there and strip the stray param.
 *
 * The gate waits for permissions: an uninitialized store grants nothing, and
 * stripping the link on that one frame would destroy a perfectly good deep
 * link before the operator's grants ever landed.
 */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

const h = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
  toastError: vi.fn(),
  granted: new Set<string>(),
  initialized: true,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace }),
  usePathname: () => "/books",
  useSearchParams: () => new URLSearchParams(h.search),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: { error: (...args: unknown[]) => h.toastError(...args) },
}));

vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: <T,>(
    selector: (s: {
      can: (key: string) => boolean;
      initialized: boolean;
    }) => T,
  ) =>
    selector({
      can: (key: string) => h.granted.has(key),
      initialized: h.initialized,
    }),
}));

// The real English dictionary, so the assertions pin the copy that ships.
vi.mock("@/i18n/client", async () => {
  const books = (await import("@/i18n/dictionaries/en/books.json"))
    .default as Record<string, string>;
  return {
    useDictionary: () => ({
      t: (key: string, fallbackOrParams?: unknown) =>
        books[key] ??
        (typeof fallbackOrParams === "string" ? fallbackOrParams : key),
    }),
    useLocale: () => ({ locale: "en" }),
  };
});

vi.mock("@/lib/hooks/use-page-title", () => ({ usePageTitle: () => {} }));

vi.mock("@/lib/hooks", () => ({
  useClients: () => ({ data: undefined }),
  useEstimates: () => ({ data: [] }),
  useExpenseBatches: () => ({ data: [] }),
  useInvoices: () => ({ data: [] }),
  useInvoiceMetrics: () => ({ data: [] }),
  useSupplierBillIntakes: () => ({ data: [] }),
}));

// The page's children are irrelevant to the URL contract; stub them so no
// segment mounts its own queries (or its own open-by-link door).
vi.mock("@/components/books/ledger-strip", () => ({
  LedgerStrip: () => null,
}));
vi.mock("@/components/books/segment-toolbar", () => ({
  BooksSegmentControl: () => null,
  FilterChips: () => null,
  DrillChip: () => null,
  SegmentStatLine: () => null,
  formatMetricValue: () => "",
}));
vi.mock("@/components/books/segments/invoices-segment", () => ({
  InvoicesSegment: () => <div data-testid="invoices-segment" />,
}));
vi.mock("@/components/books/segments/estimates-segment", () => ({
  EstimatesSegment: () => <div data-testid="estimates-segment" />,
}));
vi.mock("@/components/books/segments/expenses-segment", () => ({
  ExpensesSegment: () => null,
}));
vi.mock("@/components/books/segments/bills-segment", () => ({
  BillsSegment: () => null,
}));
vi.mock("@/components/books/segments/sync-segment", () => ({
  SyncSegment: () => null,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  motion: {
    div: ({
      children,
      className,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => <div className={className}>{children}</div>,
  },
  useReducedMotion: () => true,
}));

import { BooksPage } from "@/components/books/books-page";

beforeEach(() => {
  h.replace.mockReset();
  h.toastError.mockReset();
  h.granted = new Set<string>();
  h.initialized = true;
  h.search = "";
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BooksPage — stray document links", () => {
  it("leaves the invoice link alone when the invoices segment is visible", () => {
    h.granted = new Set(["invoices.view"]);
    h.search = "segment=invoices&invoice=i1";

    render(<BooksPage />);

    // The mounted segment owns the id; the page must not touch it.
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("reports an invoice link the operator cannot follow and strips it", () => {
    h.granted = new Set(["estimates.view"]);
    h.search = "segment=estimates&invoice=i1&status=sent";

    render(<BooksPage />);

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError).toHaveBeenCalledWith("// INVOICE NOT FOUND");
    expect(h.replace).toHaveBeenCalledWith("/books?segment=estimates&status=sent", {
      scroll: false,
    });
  });

  it("reports an estimate link the operator cannot follow and strips it", () => {
    h.granted = new Set(["invoices.view"]);
    h.search = "segment=invoices&estimate=e9";

    render(<BooksPage />);

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError).toHaveBeenCalledWith("// ESTIMATE NOT FOUND");
    expect(h.replace).toHaveBeenCalledWith("/books?segment=invoices", {
      scroll: false,
    });
  });

  it("drops the query string entirely when the stray id was the only param", () => {
    h.granted = new Set(["expenses.approve"]);
    h.search = "invoice=i1";

    render(<BooksPage />);

    expect(h.replace).toHaveBeenCalledWith("/books", { scroll: false });
  });

  it("says it once, not once per render", () => {
    h.granted = new Set(["estimates.view"]);
    h.search = "segment=estimates&invoice=i1";

    const { rerender } = render(<BooksPage />);
    rerender(<BooksPage />);
    rerender(<BooksPage />);

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.replace).toHaveBeenCalledTimes(1);
  });

  it("waits for permissions rather than stripping a link on the first frame", () => {
    h.granted = new Set<string>();
    h.initialized = false;
    h.search = "segment=invoices&invoice=i1";

    const { rerender } = render(<BooksPage />);

    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();

    // The operator's grants land — and they do cover invoices.
    h.granted = new Set(["invoices.view"]);
    h.initialized = true;
    rerender(<BooksPage />);

    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("reports the link once the grants land and they do not cover it", () => {
    h.granted = new Set<string>();
    h.initialized = false;
    h.search = "segment=invoices&invoice=i1";

    const { rerender } = render(<BooksPage />);
    expect(h.toastError).not.toHaveBeenCalled();

    h.granted = new Set(["expenses.approve"]);
    h.initialized = true;
    rerender(<BooksPage />);

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError).toHaveBeenCalledWith("// INVOICE NOT FOUND");
    expect(h.replace).toHaveBeenCalledWith("/books?segment=invoices", {
      scroll: false,
    });
  });
});
