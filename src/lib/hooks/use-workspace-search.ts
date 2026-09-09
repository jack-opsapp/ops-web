"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  DEFAULT_WORKSPACE_SEARCH_LIMIT,
  WorkspaceSearchService,
} from "@/lib/api/services/workspace-search-service";
import type { WorkspaceSearchResult } from "@/lib/types/workspace-search";

/** Below two characters every workspace matches — that is noise, not a search. */
const MIN_QUERY_LENGTH = 2;

/** One request per typing pause, not per keystroke. */
const DEBOUNCE_MS = 150;

/** A settled result stays usable for half a minute of continued typing. */
const STALE_TIME_MS = 30_000;

export interface UseWorkspaceSearchResult {
  /** The envelope on screen — the previous one while the next is in flight. */
  result: WorkspaceSearchResult | null;
  /** The query the visible result belongs to: trimmed and lower-cased. */
  activeQuery: string;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** Whether the search is actually running (open, scoped, long enough). */
  enabled: boolean;
}

/**
 * Debounced, company-scoped universal search.
 *
 * The query text is part of the cache key, so a slow response for an older
 * query can never overwrite a newer one; `keepPreviousData` keeps the last
 * good result on screen while the next one loads, so the list never blinks
 * empty mid-word.
 */
export function useWorkspaceSearch(
  rawQuery: string,
  opts: { enabled: boolean; limitPerKind?: number },
): UseWorkspaceSearchResult {
  const companyId = useAuthStore((s) => s.company?.id ?? "");
  const debounced = useDebouncedValue(rawQuery.trim(), DEBOUNCE_MS);
  const normalized = debounced.toLowerCase();
  const limitPerKind = opts.limitPerKind ?? DEFAULT_WORKSPACE_SEARCH_LIMIT;
  const enabled =
    opts.enabled && !!companyId && normalized.length >= MIN_QUERY_LENGTH;

  const query = useQuery({
    queryKey: queryKeys.search.workspace(companyId, normalized),
    queryFn: () => WorkspaceSearchService.search(debounced, limitPerKind),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIME_MS,
  });

  return {
    result: query.data ?? null,
    activeQuery: normalized,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    enabled,
  };
}
