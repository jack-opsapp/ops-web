import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import { StrictMode } from "react";
import { useOpenDocumentFromUrl } from "@/components/books/use-open-document-from-url";

/**
 * Universal search sends the operator to `/books?segment=invoices&invoice=<id>`
 * (or `…&segment=estimates&estimate=<id>`). This suite pins the whole contract
 * of that door: open the detail exactly once, keep every other param, drop the
 * id param, and — the part that decides whether the link survives — tell a
 * document that is not there apart from a fetch that simply failed.
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
  error: unknown;
}

const LOADING: QueryLike = {
  data: undefined,
  isError: false,
  isLoading: true,
  error: null,
};
/** A fetcher that reports absence as a null document rather than throwing. */
const NULL_DOCUMENT: QueryLike = {
  data: null,
  isError: false,
  isLoading: false,
  error: null,
};
/** PostgREST's answer for a row the operator cannot see: PGRST116 at 406. */
const NOT_VISIBLE: QueryLike = {
  data: undefined,
  isError: true,
  isLoading: false,
  error: Object.assign(new Error("Failed to fetch invoice: no rows"), {
    status: 406,
    code: "PGRST116",
  }),
};
/** The query is offline/paused: settled on nothing, which is not an answer. */
const PAUSED: QueryLike = {
  data: undefined,
  isError: false,
  isLoading: false,
  error: null,
};
const failedWith = (error: unknown): QueryLike => ({
  data: undefined,
  isError: true,
  isLoading: false,
  error,
});
const found = (doc: Doc): QueryLike => ({
  data: doc,
  isError: false,
  isLoading: false,
  error: null,
});

const INVOICE: Doc = { id: "i1", number: "INV-104" };

const NOT_FOUND_LINE = "// INVOICE NOT FOUND";
const OPEN_FAILED_LINE = "// COULDN'T OPEN INVOICE";

function Harness({
  result,
  onOpen,
  useDocumentSpy,
  param = "invoice",
  message = NOT_FOUND_LINE,
  openFailed = OPEN_FAILED_LINE,
}: {
  result: QueryLike;
  onOpen: (doc: Doc) => void;
  useDocumentSpy?: (id?: string) => void;
  param?: "invoice" | "estimate";
  message?: string;
  openFailed?: string;
}) {
  useOpenDocumentFromUrl<Doc>({
    param,
    useDocument: (id?: string) => {
      useDocumentSpy?.(id);
      return result;
    },
    onOpen,
    notFoundMessage: message,
    openFailedMessage: openFailed,
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

  it("opens exactly once under StrictMode's double-invoked effects", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=i1");
    const onOpen = vi.fn();

    render(
      <StrictMode>
        <Harness result={found(INVOICE)} onOpen={onOpen} />
      </StrictMode>,
    );

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(INVOICE);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("treats a paused offline query as unsettled, not as an answer", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=i1");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={PAUSED} onOpen={onOpen} />);

    expect(onOpen).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    // Connectivity returns and the document lands — the link still opens, once.
    rerender(<Harness result={found(INVOICE)} onOpen={onOpen} />);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(INVOICE);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("reports a document that resolves to nothing and still clears the param", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=gone");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={LOADING} onOpen={onOpen} />);
    rerender(<Harness result={NULL_DOCUMENT} onOpen={onOpen} />);

    expect(onOpen).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(NOT_FOUND_LINE);
    expect(mockReplace).toHaveBeenCalledWith("/books?segment=invoices", { scroll: false });
  });

  it("reports a document the operator cannot see and clears the param", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=gone");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={LOADING} onOpen={onOpen} />);
    rerender(<Harness result={NOT_VISIBLE} onOpen={onOpen} />);

    expect(onOpen).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(NOT_FOUND_LINE);
    expect(mockReplace).toHaveBeenCalledWith("/books?segment=invoices", { scroll: false });
  });

  it("treats a bare 404 as not found too", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=gone");
    const onOpen = vi.fn();

    render(<Harness result={failedWith({ status: 404 })} onOpen={onOpen} />);

    expect(mockToastError).toHaveBeenCalledWith(NOT_FOUND_LINE);
    expect(mockReplace).toHaveBeenCalledWith("/books?segment=invoices", { scroll: false });
  });

  it("keeps the link when the fetch fails for any other reason", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=i1");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={LOADING} onOpen={onOpen} />);
    rerender(<Harness result={failedWith({ status: 500 })} onOpen={onOpen} />);

    expect(onOpen).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(OPEN_FAILED_LINE);
    // The param survives so a reload retries the fetch.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("keeps the link when the failure carries no status at all", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=i1");
    const onOpen = vi.fn();

    render(<Harness result={failedWith(new Error("network"))} onOpen={onOpen} />);

    expect(onOpen).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(OPEN_FAILED_LINE);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("says the open failed once, not once per render", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=i1");
    const onOpen = vi.fn();
    const failure = failedWith(new Error("network"));

    const { rerender } = render(<Harness result={failure} onOpen={onOpen} />);
    rerender(<Harness result={failure} onOpen={onOpen} />);
    rerender(<Harness result={failedWith(new Error("network"))} onOpen={onOpen} />);

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("still opens the document when a kept link's refetch finally lands", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=i1");
    const onOpen = vi.fn();

    const { rerender } = render(
      <Harness result={failedWith(new Error("network"))} onOpen={onOpen} />,
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);

    rerender(<Harness result={found(INVOICE)} onOpen={onOpen} />);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(INVOICE);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("reports the not-found line only once for one id", () => {
    currentParams = new URLSearchParams("segment=invoices&invoice=gone");
    const onOpen = vi.fn();

    const { rerender } = render(<Harness result={NULL_DOCUMENT} onOpen={onOpen} />);
    rerender(<Harness result={NULL_DOCUMENT} onOpen={onOpen} />);

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
        openFailed="// COULDN'T OPEN ESTIMATE"
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
        result={NOT_VISIBLE}
        onOpen={onOpen}
        param="estimate"
        message="// ESTIMATE NOT FOUND"
        openFailed="// COULDN'T OPEN ESTIMATE"
      />,
    );

    expect(mockToastError).toHaveBeenCalledWith("// ESTIMATE NOT FOUND");
    expect(mockReplace).toHaveBeenCalledWith("/books?segment=estimates", { scroll: false });
  });

  it("uses the estimate line when the estimate fetch simply fails", () => {
    currentParams = new URLSearchParams("segment=estimates&estimate=e9");
    const onOpen = vi.fn();

    render(
      <Harness
        result={failedWith({ status: 503 })}
        onOpen={onOpen}
        param="estimate"
        message="// ESTIMATE NOT FOUND"
        openFailed="// COULDN'T OPEN ESTIMATE"
      />,
    );

    expect(mockToastError).toHaveBeenCalledWith("// COULDN'T OPEN ESTIMATE");
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
