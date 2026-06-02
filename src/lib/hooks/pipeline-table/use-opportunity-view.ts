"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { OpportunityViewDefinition } from "@/lib/types/pipeline-table";

/**
 * OPS Web — Pipeline active-view selection hook.
 *
 * Deliberately LEAN compared to `projects-table/use-project-view.ts`. The
 * projects hook layers `?sort=` / `?filter=` URL overrides on top of the saved
 * view because the projects table filters + sorts SERVER-SIDE off the view's
 * `filters`/`sort` JSON. The pipeline table filters in-memory in the shell and
 * does NOT consume the view's `filters`/`sort` from the server (the shell owns
 * its own sort/grouping/density state), so all of that override machinery would
 * be dead weight here and is intentionally omitted.
 *
 * What remains is the genuinely-reused part: pick the active view from the list
 * and persist the choice. Resolution order:
 *   1. `?view=<id>` URL param, if it points at an available (non-archived) view.
 *   2. The localStorage-persisted last choice, if still available.
 *   3. The default view (`isDefault`), else the first available view.
 *
 * The chosen id is written back to both localStorage (so it survives reloads)
 * and the URL (so it is shareable / survives back-forward), mirroring the
 * projects URL-state hook's persistence without its override layer.
 */

export const OPPORTUNITY_VIEW_STORAGE_KEY = "ops_pipeline_table_active_view_id";

export interface UnavailableOpportunityViewState {
  viewId: string;
}

function readStoredViewId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(OPPORTUNITY_VIEW_STORAGE_KEY);
}

function writeStoredViewId(viewId: string | null) {
  if (typeof window === "undefined") return;
  if (viewId) window.localStorage.setItem(OPPORTUNITY_VIEW_STORAGE_KEY, viewId);
  else window.localStorage.removeItem(OPPORTUNITY_VIEW_STORAGE_KEY);
}

/** A view is selectable only when it exists and is not archived. */
function findAccessibleView(
  views: OpportunityViewDefinition[],
  viewId: string | null,
) {
  if (!viewId) return null;
  return views.find((view) => view.id === viewId && view.isArchived !== true) ?? null;
}

function findDefaultView(views: OpportunityViewDefinition[]) {
  return views.find((view) => view.isDefault) ?? views[0] ?? null;
}

/**
 * Pure active-view resolver — pick the active view from a candidate id pair.
 * URL id wins over the stored id; either falls back to the default view when it
 * does not resolve to an available view. Extracted (and unit-tested) so the
 * selection precedence is verifiable without mounting the hook.
 */
export function resolveActiveOpportunityView(
  availableViews: OpportunityViewDefinition[],
  urlViewId: string | null,
  storedViewId: string | null,
): OpportunityViewDefinition | null {
  const defaultView = findDefaultView(availableViews);
  if (urlViewId) {
    return findAccessibleView(availableViews, urlViewId) ?? defaultView;
  }
  return findAccessibleView(availableViews, storedViewId) ?? defaultView;
}

function buildViewUrl(
  pathname: string,
  searchParams: URLSearchParams | { toString: () => string },
  viewId: string | null,
) {
  const next = new URLSearchParams(searchParams.toString());
  if (viewId) next.set("view", viewId);
  else next.delete("view");
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function useOpportunityView(views: OpportunityViewDefinition[] | undefined) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [storedViewId, setStoredViewId] = useState<string | null>(() => readStoredViewId());

  const availableViews = useMemo(
    () => (views ?? []).filter((view) => view.isArchived !== true),
    [views],
  );
  const urlViewId = searchParams.get("view");

  const activeView = useMemo(
    () => resolveActiveOpportunityView(availableViews, urlViewId, storedViewId),
    [availableViews, storedViewId, urlViewId],
  );

  // A `?view=` id that points at no available view (deleted/archived/foreign):
  // surface it so the shell can warn, then the effect below repairs the URL.
  const unavailableView = useMemo<UnavailableOpportunityViewState | null>(() => {
    if (!urlViewId || availableViews.length === 0) return null;
    if (findAccessibleView(availableViews, urlViewId)) return null;
    return { viewId: urlViewId };
  }, [availableViews, urlViewId]);

  // Keep localStorage in lockstep with the resolved active view, and repair a
  // stale `?view=` param to the view we actually fell back to.
  useEffect(() => {
    if (!activeView) {
      if (storedViewId) {
        setStoredViewId(null);
        writeStoredViewId(null);
      }
      return;
    }

    if (storedViewId !== activeView.id) {
      setStoredViewId(activeView.id);
      writeStoredViewId(activeView.id);
    }

    if (unavailableView) {
      router.replace(buildViewUrl(pathname, searchParams, activeView.id));
    }
  }, [activeView, pathname, router, searchParams, storedViewId, unavailableView]);

  const setActiveViewId = useCallback(
    (viewId: string) => {
      const nextView = findAccessibleView(availableViews, viewId);
      if (!nextView) return;
      setStoredViewId(nextView.id);
      writeStoredViewId(nextView.id);
      router.push(buildViewUrl(pathname, searchParams, nextView.id));
    },
    [availableViews, pathname, router, searchParams],
  );

  return {
    activeView,
    activeViewId: activeView?.id ?? null,
    setActiveViewId,
    unavailableView,
  };
}
