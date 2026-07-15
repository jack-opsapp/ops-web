"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";
import { usePreferencesStore } from "@/stores/preferences-store";
import {
  ALL_PROJECTS_VIEW_ID,
  ALL_PROJECTS_VIEW_URL_VALUE,
} from "@/lib/utils/project-view-defaults";

export const PROJECT_VIEW_STORAGE_KEY = "ops_projects_table_v2_view_id";

export interface UnavailableProjectViewState {
  viewId: string;
}

function readStoredViewId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PROJECT_VIEW_STORAGE_KEY);
}

function writeStoredViewId(viewId: string | null) {
  if (typeof window === "undefined") return;
  if (viewId) window.localStorage.setItem(PROJECT_VIEW_STORAGE_KEY, viewId);
  else window.localStorage.removeItem(PROJECT_VIEW_STORAGE_KEY);
}

function findAccessibleView(views: ProjectTableViewDefinition[], viewId: string | null) {
  if (!viewId) return null;
  return views.find((view) => view.id === viewId && view.isArchived !== true) ?? null;
}

function buildViewUrl(
  pathname: string,
  searchParams: URLSearchParams | { toString: () => string },
  viewParam: string | null,
) {
  const next = new URLSearchParams(searchParams.toString());
  if (viewParam) next.set("view", viewParam);
  else next.delete("view");
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Resolves the active project-table saved view from URL → localStorage → the
 * user's default-view preference → ALL.
 *
 * `activeView === null` MEANS "all projects" — the unfiltered company-scoped
 * baseline — never "nothing to show". The URL expresses ALL as `?view=all`;
 * localStorage stores a concrete view id OR the `__all__` sentinel.
 *
 * There is no name-based "My Active Work" auto-default anymore: with no URL and
 * no stored value, the landing state is the user's chosen default view (if it
 * still exists and is unarchived), else ALL.
 */
export function useProjectViewUrlState(views: ProjectTableViewDefinition[] | undefined) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const defaultViewId = usePreferencesStore((s) => s.projectsDefaultViewId);
  const [storedViewId, setStoredViewId] = useState<string | null>(() => readStoredViewId());

  const availableViews = useMemo(
    () => (views ?? []).filter((view) => view.isArchived !== true),
    [views],
  );

  const urlViewParam = searchParams.get("view");
  const urlIsAll = urlViewParam === ALL_PROJECTS_VIEW_URL_VALUE;
  const urlView = urlIsAll ? null : findAccessibleView(availableViews, urlViewParam);
  const preferenceView = findAccessibleView(availableViews, defaultViewId);
  const storedIsAll = storedViewId === ALL_PROJECTS_VIEW_ID;
  const storedView = storedIsAll ? null : findAccessibleView(availableViews, storedViewId);

  const activeView = useMemo<ProjectTableViewDefinition | null>(() => {
    // URL is authoritative when present.
    if (urlViewParam !== null) {
      if (urlIsAll) return null;
      if (urlView) return urlView;
      // URL points at a view that no longer resolves → user default → ALL.
      return preferenceView;
    }
    // No URL param → stored selection → user default → ALL.
    if (storedViewId !== null) {
      if (storedIsAll) return null;
      if (storedView) return storedView;
      return preferenceView;
    }
    return preferenceView;
  }, [preferenceView, storedIsAll, storedView, storedViewId, urlIsAll, urlView, urlViewParam]);

  const unavailableView = useMemo<UnavailableProjectViewState | null>(() => {
    if (!urlViewParam || urlIsAll || availableViews.length === 0 || urlView) return null;
    return { viewId: urlViewParam };
  }, [availableViews.length, urlIsAll, urlView, urlViewParam]);

  useEffect(() => {
    // Reconcile storage + URL only once the saved views have resolved. During
    // the loading window `availableViews` is empty and a real stored/URL id
    // can't resolve yet — reconciling then would clobber the user's selection.
    if (availableViews.length === 0) return;

    if (activeView) {
      if (storedViewId !== activeView.id) {
        setStoredViewId(activeView.id);
        writeStoredViewId(activeView.id);
      }
      if (unavailableView) {
        router.replace(buildViewUrl(pathname, searchParams, activeView.id));
      }
      return;
    }

    // activeView is ALL.
    if (unavailableView) {
      router.replace(buildViewUrl(pathname, searchParams, ALL_PROJECTS_VIEW_URL_VALUE));
    }
    if (storedViewId !== null && storedViewId !== ALL_PROJECTS_VIEW_ID) {
      // A stored real-view id that no longer resolves collapses to the ALL
      // sentinel so a later no-param load stays on ALL.
      setStoredViewId(ALL_PROJECTS_VIEW_ID);
      writeStoredViewId(ALL_PROJECTS_VIEW_ID);
    }
  }, [activeView, availableViews.length, pathname, router, searchParams, storedViewId, unavailableView]);

  const setActiveViewId = useCallback(
    (viewId: string | null) => {
      // null or the ALL token → deselect to ALL: write the sentinel + `?view=all`.
      if (viewId === null || viewId === ALL_PROJECTS_VIEW_ID) {
        setStoredViewId(ALL_PROJECTS_VIEW_ID);
        writeStoredViewId(ALL_PROJECTS_VIEW_ID);
        router.push(buildViewUrl(pathname, searchParams, ALL_PROJECTS_VIEW_URL_VALUE));
        return;
      }
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
