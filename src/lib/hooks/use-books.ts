/**
 * OPS Web - Books Hooks
 *
 * TanStack Query hooks for the /books ledger instrument strip.
 */

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { BooksService, type BooksPeriod } from "../api/services/books-service";
import { useAuthStore } from "../store/auth-store";

export function useBooksLedger(period: BooksPeriod) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useQuery({
    queryKey: queryKeys.books.ledger(companyId, period),
    queryFn: () => BooksService.fetchLedger(companyId, period),
    enabled: !!companyId,
    staleTime: 2 * 60 * 1000,
  });
}
