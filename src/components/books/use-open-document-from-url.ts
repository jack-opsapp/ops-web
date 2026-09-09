"use client";

/**
 * Books — open a document from a link.
 *
 * Universal search (⌘K) sends the operator to
 * `/books?segment=invoices&invoice=<id>` or
 * `/books?segment=estimates&estimate=<id>`. This hook is the whole door: read
 * the id, fetch it with the segment's own detail query, hand it to the state
 * the row click already sets, then strip the id from the URL so closing the
 * modal doesn't reopen it and Back behaves. A document the operator cannot see
 * says so once and clears the param the same way.
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
}

export function useOpenDocumentFromUrl<T>({
  param,
  useDocument,
  onOpen,
  notFoundMessage,
}: UseOpenDocumentFromUrlOptions<T>): void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id = searchParams.get(param);

  const { data, isError, isLoading } = useDocument(id ?? undefined);

  // An id opens once. The latch releases the moment the param leaves the URL,
  // so searching the same document a second time opens it again.
  const handledRef = useRef<string | null>(null);

  const clearParam = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(param);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [param, pathname, router, searchParams]);

  useEffect(() => {
    if (!id) {
      handledRef.current = null;
      return;
    }
    if (handledRef.current === id) return;
    if (isLoading) return;

    if (isError) {
      handledRef.current = id;
      toast.error(notFoundMessage);
      clearParam();
      return;
    }

    // `undefined` is the query layer's "not settled yet", never an answer.
    if (data === undefined) return;

    if (data === null) {
      handledRef.current = id;
      toast.error(notFoundMessage);
      clearParam();
      return;
    }

    handledRef.current = id;
    onOpen(data);
    clearParam();
  }, [id, data, isError, isLoading, onOpen, notFoundMessage, clearParam]);
}
