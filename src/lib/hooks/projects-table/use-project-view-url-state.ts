"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";

export const PROJECT_VIEW_STORAGE_KEY = "ops_projects_table_v2_view_id";
const DEFAULT_PROJECT_VIEW_NAME = "My Active Work";

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

function findDefaultView(views: ProjectTableViewDefinition[]) {
  return (
    views.find((view) => view.name === DEFAULT_PROJECT_VIEW_NAME) ??
    views.find((view) => view.isDefault) ??
    views[0] ??
    null
  );
}

function findAccessibleView(views: ProjectTableViewDefinition[], viewId: string | null) {
  if (!viewId) return null;
  return views.find((view) => view.id === viewId && view.isArchived !== true) ?? null;
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

export function useProjectViewUrlState(views: ProjectTableViewDefinition[] | undefined) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [storedViewId, setStoredViewId] = useState<string | null>(() => readStoredViewId());

  const availableViews = useMemo(
    () => (views ?? []).filter((view) => view.isArchived !== true),
    [views],
  );
  const urlViewId = searchParams.get("view");
  const urlView = findAccessibleView(availableViews, urlViewId);
  const storedView = findAccessibleView(availableViews, storedViewId);
  const defaultView = findDefaultView(availableViews);

  const activeView = useMemo(() => {
    if (urlViewId) return urlView ?? defaultView;
    return storedView ?? defaultView;
  }, [defaultView, storedView, urlView, urlViewId]);

  const unavailableView = useMemo<UnavailableProjectViewState | null>(() => {
    if (!urlViewId || availableViews.length === 0 || urlView) return null;
    return { viewId: urlViewId };
  }, [availableViews.length, urlView, urlViewId]);

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
