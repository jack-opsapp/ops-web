/**
 * OPS Web — universal search service.
 *
 * One PostgREST call to `public.search_workspace`, a SECURITY INVOKER function:
 * the caller's RLS decides what comes back, so this service never adds a
 * company filter of its own. A PostgREST error is rethrown with its message and
 * its code intact — a swallowed error here would render as "no matches" and
 * hide a permission or deployment fault.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import {
  parseWorkspaceSearchResult,
  type WorkspaceSearchResult,
} from "@/lib/types/workspace-search";

/** Matches the function's own default; the database clamps to [1, 25]. */
export const DEFAULT_WORKSPACE_SEARCH_LIMIT = 8;

export const WorkspaceSearchService = {
  async search(
    query: string,
    limitPerKind: number = DEFAULT_WORKSPACE_SEARCH_LIMIT,
  ): Promise<WorkspaceSearchResult> {
    const { data, error } = await requireSupabase().rpc("search_workspace", {
      p_query: query,
      p_limit_per_kind: limitPerKind,
    });

    // The PostgREST `code` rides along on the thrown error (42501 for a denied
    // RPC, 42883 for a function that never deployed), so logs and callers can
    // tell a permission fault from a dropped connection without parsing prose.
    if (error) throw Object.assign(new Error(error.message), { code: error.code });

    return parseWorkspaceSearchResult(data);
  },
};
