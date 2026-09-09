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

/**
 * One retry, not the global two. The app-wide policy only declines a retry when
 * the error carries `status`, and a PostgREST failure does not — a hard fault
 * (denied RPC, function not deployed) would cost three requests per typing
 * pause. One retry still absorbs a dropped connection.
 */
const RETRY_COUNT = 1;

export interface UseWorkspaceSearchResult {
  /**
   * The envelope on screen, or `null` when there is nothing legitimate to
   * show — no settled result yet, a failed query, or the search switched off.
   */
  result: WorkspaceSearchResult | null;
  /**
   * The query the caller asked for: trimmed and lower-cased. This is the
   * *requested* text, not necessarily the one `result` answers — while the
   * next query is in flight the previous envelope is kept on screen, so pair
   * this with `isPlaceholderData` before labelling a result.
   */
  activeQuery: string;
  /**
   * True while `result` is the previous query's envelope, held to stop the list
   * blinking empty mid-word. False once the request for `activeQuery` settles,
   * successfully or not.
   */
  isPlaceholderData: boolean;
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
    // The request text is the key text — one cache entry, one request string.
    queryFn: () => WorkspaceSearchService.search(normalized, limitPerKind),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIME_MS,
    retry: RETRY_COUNT,
  });

  return {
    // `keepPreviousData` is not gated on `enabled`: a disabled query still sits
    // in `pending`, so TanStack keeps substituting the last envelope. Without
    // this guard the previous results survive a backspace below the minimum
    // length and a palette close — presented as the answer to a query that is
    // not running.
    result: enabled ? (query.data ?? null) : null,
    activeQuery: normalized,
    isPlaceholderData: query.isPlaceholderData,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    enabled,
  };
}
