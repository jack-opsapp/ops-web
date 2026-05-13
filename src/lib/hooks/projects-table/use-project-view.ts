import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";

const STORAGE_KEY = "ops_projects_table_v2_view_id";

function pickInitialView(
  views: ProjectTableViewDefinition[],
  storedId: string | null,
): ProjectTableViewDefinition | null {
  if (views.length === 0) return null;
  const stored = storedId ? views.find((view) => view.id === storedId) : null;
  if (stored) return stored;
  return views.find((view) => view.name === "My Active Work") ?? views[0];
}

export function useProjectView(views: ProjectTableViewDefinition[] | undefined) {
  const [activeViewId, setActiveViewIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  const activeView = useMemo(() => {
    return pickInitialView(views ?? [], activeViewId);
  }, [views, activeViewId]);

  useEffect(() => {
    if (!activeView || activeView.id === activeViewId) return;
    setActiveViewIdState(activeView.id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, activeView.id);
    }
  }, [activeView, activeViewId]);

  const setActiveViewId = useCallback((viewId: string) => {
    setActiveViewIdState(viewId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, viewId);
    }
  }, []);

  return { activeView, activeViewId: activeView?.id ?? null, setActiveViewId };
}
