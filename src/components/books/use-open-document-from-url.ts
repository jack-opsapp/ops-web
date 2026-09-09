"use client";

/**
 * Books — open a document from a link.
 *
 * Universal search (⌘K) sends the operator to
 * `/books?segment=invoices&invoice=<id>` or
 * `/books?segment=estimates&estimate=<id>`. This hook is the whole door: read
 * the id, fetch it with the segment's own detail query, hand it to the state
 * the row click already sets, then strip the id from the URL so closing the
 * modal doesn't reopen it and Back behaves.
 *
 * Failure has two outcomes, and which one decides whether the link survives:
 * a document that is not there (or not visible) is answered and the param
 * cleared — there is nothing to retry. A fetch that simply failed (network,
 * 5xx) says so and KEEPS the param, so a reload — or a refetch that lands —
 * still opens the document.
 */

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/components/ui/toast";

/** The two documents Books opens by link. */
export type OpenDocumentParam = "invoice" | "estimate";

/** The slice of a TanStack query result this door reads. */
export interface OpenDocumentQuery<T> {
  data: T | null | undefined;
  isError: boolean;
  isLoading: boolean;
  /** The thrown fetch error — its status is what separates the two outcomes. */
  error: unknown;
}

export interface UseOpenDocumentFromUrlOptions<T> {
  /** URL param carrying the document id. */
  param: OpenDocumentParam;
  /** The segment's existing detail query — `useInvoice` / `useEstimate`. */
  useDocument: (id?: string) => OpenDocumentQuery<T>;
  /** Sets the segment's editing state, exactly as a row click does. */
  onOpen: (doc: T) => void;
  /** Shown when the id resolves to nothing the operator can see. */
  notFoundMessage: string;
  /** Shown when the fetch failed for any other reason; the link is kept. */
  openFailedMessage: string;
}

/**
 * Is this error the document saying "I am not here"?
 *
 * The invoice and estimate services fetch with `.single()`, so PostgREST
 * answers an absent or RLS-invisible row with `PGRST116` at status 406; a plain
 * REST 404 says the same thing. Everything else — a network drop, a 5xx, a
 * gateway — is a failure to ask, not an answer, and the link is worth keeping.
 */
function isDocumentAbsent(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return code === "PGRST116" || status === 404 || status === 406;
}

export function useOpenDocumentFromUrl<T>({
  param,
  useDocument,
  onOpen,
  notFoundMessage,
  openFailedMessage,
}: UseOpenDocumentFromUrlOptions<T>): void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id = searchParams.get(param);

  const { data, isError, isLoading, error } = useDocument(id ?? undefined);

  // An id is answered once. The latch releases the moment the param leaves the
  // URL, so searching the same document a second time opens it again.
  const handledRef = useRef<string | null>(null);
  // A kept link is NOT answered — the fetch may still land — so the "couldn't
  // open" line gets its own latch: said once per id, never once per render.
  const reportedRef = useRef<string | null>(null);

  const clearParam = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(param);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [param, pathname, router, searchParams]);

  useEffect(() => {
    if (!id) {
      handledRef.current = null;
      reportedRef.current = null;
      return;
    }
    if (handledRef.current === id) return;
    if (isLoading) return;

    if (isError) {
      if (isDocumentAbsent(error)) {
        handledRef.current = id;
        toast.error(notFoundMessage);
        clearParam();
        return;
      }
      // Any other failure. Say so once and leave the id in the URL: a reload
      // retries, and a refetch that lands still falls through to the open
      // below, because this path never sets the handled latch.
      if (reportedRef.current !== id) {
        reportedRef.current = id;
        toast.error(openFailedMessage);
      }
      return;
    }

    // `undefined` is the query layer's "not settled yet" — a paused offline
    // query looks exactly like this — never an answer.
    if (data === undefined) return;

    // Both real callers fetch with `.single()` and throw on an absent row, so
    // this branch is for a fetcher that reports absence as a null document.
    if (data === null) {
      handledRef.current = id;
      toast.error(notFoundMessage);
      clearParam();
      return;
    }

    handledRef.current = id;
    onOpen(data);
    clearParam();
  }, [
    id,
    data,
    isError,
    error,
    isLoading,
    onOpen,
    notFoundMessage,
    openFailedMessage,
    clearParam,
  ]);
}
