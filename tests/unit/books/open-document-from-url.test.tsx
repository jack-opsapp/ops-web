import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import { useOpenDocumentFromUrl } from "@/components/books/use-open-document-from-url";

/**
 * Universal search sends the operator to `/books?segment=invoices&invoice=<id>`
 * (or `…&segment=estimates&estimate=<id>`). This suite pins the whole contract
 * of that door: open the detail exactly once, keep every other param, drop the
 * id param, and say so plainly when the document is not visible.
 */

const mockReplace = vi.fn();
const mockToastError = vi.fn();
let currentParams = new URLSearchParams("");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/books",
  // The real hook returns a ReadonlyURLSearchParams; URLSearchParams carries
  // the same `get`/`toString` surface the hook uses.
  useSearchParams: () => currentParams,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

interface Doc {
  id: string;
  number: string;
}

interface QueryLike {
  data: Doc | null | undefined;
  isError: boolean;
  isLoading: boolean;
}

const LOADING: QueryLike = { data: undefined, isError: false, isLoading: true };
const NOT_FOUND: QueryLike = { data: null, isError: false, isLoading: false };
const FAILED: QueryLike = { data: undefined, isError: true, isLoading: false };
const found = (doc: Doc): QueryLike => ({ data: doc, isError: false, isLoading: false });

const INVOICE: Doc = { id: "i1", number: "INV-104" };

function Harness({
  result,
  onOpen,
  useDocumentSpy,
  param = "invoice",
  message = "// INVOICE NOT FOUND",
}: {
  result: QueryLike;
  onOpen: (doc: Doc) => void;
  useDocumentSpy?: (id?: string) => void;
  param?: "invoice" | "estimate";
  message?: string;
}) {
  useOpenDocumentFromUrl<Doc>({
    param,
    useDocument: (id?: string) => {
      useDocumentSpy?.(id);
      return result;
    },
    onOpen,
    notFoundMessage: message,
  });
  return null;
}

describe("useOpenDocumentFromUrl", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockToastError.mockReset();
    currentParams = new URLSearchParams("");
  });

  it("stays out of the way when the param is absent", () => {
    currentParams = new URLSearchParams("segment=invoices");
    const onOpen = vi.fn();
    const useDocumentSpy = vi.fn();

    render(<Harness result={LOADING} onOpen={onOpen} useDocumentSpy={useDocumentSpy} />);

    expect(useDocumentSpy).toHaveBeenCalledWith(undefined);
    expect(onOpen).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("waits while the document is still loading", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=i1");
    const onOpen = vi.fn();
    const useDocumentSpy = vi.fn();

    render(<Harness result={LOADING} onOpen={onOpen} useDocumentSpy={useDocumentSpy} />);

    expect(useDocumentSpy).toHaveBeenCalledWith("i1");
    expect(onOpen).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("opens the document once it resolves and keeps every other param", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=i1&status=sent");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={LOADING} onOpen={onOpen} />);
    expect(onOpen).not.toHaveBeenCalled();

    rerender(<Harness result={found(INVOICE)} onOpen={onOpen} />);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(INVOICE);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/books?segment=invoices&status=sent", {
      scroll: false,
    });
  });

  it("drops the query string entirely when the id was the only param", () => {
    currentParams = new URLSearchParams("invoice=i1");
    const onOpen = vi.fn();

    render(<Harness result={found(INVOICE)} onOpen={onOpen} />);

    expect(mockReplace).toHaveBeenCalledWith("/books", { scroll: false });
  });

  it("does not reopen the document on re-render", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=i1");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={found(INVOICE)} onOpen={onOpen} />);
    rerender(<Harness result={found(INVOICE)} onOpen={onOpen} />);
    rerender(<Harness result={{ ...found(INVOICE) }} onOpen={onOpen} />);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("reports a document that resolves to nothing and still clears the param", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=gone");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={LOADING} onOpen={onOpen} />);
    rerender(<Harness result={NOT_FOUND} onOpen={onOpen} />);

    expect(onOpen).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith("// INVOICE NOT FOUND");
    expect(mockReplace).toHaveBeenCalledWith("/books?segment=invoices", { scroll: false });
  });

  it("reports a failed fetch and still clears the param", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=gone");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={LOADING} onOpen={onOpen} />);
    rerender(<Harness result={FAILED} onOpen={onOpen} />);

    expect(onOpen).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith("// INVOICE NOT FOUND");
    expect(mockReplace).toHaveBeenCalledWith("/books?segment=invoices", { scroll: false });
  });

  it("reports the not-found line only once for one id", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=gone");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={NOT_FOUND} onOpen={onOpen} />);
    rerender(<Harness result={NOT_FOUND} onOpen={onOpen} />);

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("opens the same document again when a second link arrives for it", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=i1");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={found(INVOICE)} onOpen={onOpen} />);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // The replace lands: the param is gone.
    currentParams = new URLSearchParams("segment=invoices");
    rerender(<Harness result={found(INVOICE)} onOpen={onOpen} />);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // The operator searches the same invoice again.
    currentParams = new URLSearchParams("segment=invoices&invoice=i1");
    rerender(<Harness result={found(INVOICE)} onOpen={onOpen} />);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("carries the estimate half of the contract", () => {
    currentParams = new URLSearchParams("segment=estimates&estimate=e9");
    const onOpen = vi.fn();
    const useDocumentSpy = vi.fn();
    const estimate: Doc = { id: "e9", number: "EST-011" };

    render(
      <Harness
        result={found(estimate)}
        onOpen={onOpen}
        useDocumentSpy={useDocumentSpy}
        param="estimate"
        message="// ESTIMATE NOT FOUND"
      />,
    );

    expect(useDocumentSpy).toHaveBeenCalledWith("e9");
    expect(onOpen).toHaveBeenCalledWith(estimate);
    expect(mockReplace).toHaveBeenCalledWith("/books?segment=estimates", { scroll: false });
  });

  it("uses the estimate line when the estimate is not visible", () => {
    currentParams = new URLSearchParams("segment=estimates&estimate=gone");
    const onOpen = vi.fn();

    render(
      <Harness
        result={FAILED}
        onOpen={onOpen}
        param="estimate"
        message="// ESTIMATE NOT FOUND"
      />,
    );

    expect(mockToastError).toHaveBeenCalledWith("// ESTIMATE NOT FOUND");
    expect(mockReplace).toHaveBeenCalledWith("/books?segment=estimates", { scroll: false });
  });
});
