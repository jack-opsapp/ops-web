"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { Json } from "@/lib/types/database.types";
import {
  PROJECT_TABLE_COLUMN_IDS,
  type ProjectTableColumnId,
  type ProjectTableSort,
  type ProjectTableViewDefinition,
} from "@/lib/types/project-table";
import { useProjectViewUrlState } from "@/lib/hooks/projects-table/use-project-view-url-state";
import { buildAllProjectsView } from "@/lib/utils/project-view-defaults";

export {
  PROJECT_VIEW_STORAGE_KEY,
  type UnavailableProjectViewState,
} from "@/lib/hooks/projects-table/use-project-view-url-state";

const PROJECT_STATUS_FILTER_PRESETS: Record<string, Json> = {
  active: { field: "status", op: "not_in", value: ["closed", "archived"] },
  open: { field: "status", op: "not_in", value: ["closed", "archived"] },
};

function isColumnId(value: unknown): value is ProjectTableColumnId {
  return (
    typeof value === "string" &&
    (PROJECT_TABLE_COLUMN_IDS as readonly string[]).includes(value)
  );
}

function sanitizeColumns(columns: readonly unknown[] | undefined): ProjectTableColumnId[] {
  if (!columns) return [];
  const seen = new Set<ProjectTableColumnId>();
  const safeColumns: ProjectTableColumnId[] = [];

  for (const column of columns) {
    if (!isColumnId(column) || column === "select" || seen.has(column)) continue;
    seen.add(column);
    safeColumns.push(column);
  }

  return safeColumns;
}

function normalizeSortItem(value: unknown): ProjectTableSort | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { field?: unknown; direction?: unknown };
  if (!isColumnId(candidate.field) || candidate.field === "select") return null;
  if (candidate.direction !== "asc" && candidate.direction !== "desc") return null;
  return { field: candidate.field, direction: candidate.direction };
}

function normalizeSort(value: unknown): ProjectTableSort[] {
  if (Array.isArray(value)) {
    return value
      .map(normalizeSortItem)
      .filter((item): item is ProjectTableSort => item !== null);
  }

  const sortItem = normalizeSortItem(value);
  return sortItem ? [sortItem] : [];
}

function parseDelimitedSort(value: string): ProjectTableSort[] {
  const sort: ProjectTableSort[] = [];

  for (const token of value.split(",")) {
    const [field, direction = "asc"] = token.split(":");
    const candidate = normalizeSortItem({ field, direction });
    if (candidate) sort.push(candidate);
  }

  return sort;
}

function parseSortOverride(value: string | null): ProjectTableSort[] | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const sort = normalizeSort(parsed);
      return sort.length > 0 ? sort : null;
    } catch {
      return null;
    }
  }

  const sort = parseDelimitedSort(trimmed);
  return sort.length > 0 ? sort : null;
}

function parseFilterOverride(value: string | null): Json | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as Json;
    } catch {
      return null;
    }
  }

  return PROJECT_STATUS_FILTER_PRESETS[trimmed.toLowerCase()] ?? null;
}

function isEmptyFilter(value: Json | null | undefined) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function filtersEqual(left: Json, right: Json) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function layerFilters(savedFilter: Json, overrideFilter: Json | null): Json {
  if (isEmptyFilter(overrideFilter)) return savedFilter;
  if (isEmptyFilter(savedFilter)) return overrideFilter as Json;
  if (filtersEqual(savedFilter, overrideFilter as Json)) return savedFilter;

  if (
    savedFilter &&
    typeof savedFilter === "object" &&
    !Array.isArray(savedFilter) &&
    Array.isArray((savedFilter as { and?: unknown }).and) &&
    (savedFilter as { and: Json[] }).and.some((child) => filtersEqual(child, overrideFilter as Json))
  ) {
    return savedFilter;
  }

  return { and: [savedFilter, overrideFilter as Json] };
}

export function useProjectView(views: ProjectTableViewDefinition[] | undefined) {
  const searchParams = useSearchParams();
  const viewState = useProjectViewUrlState(views);
  const sortOverride = useMemo(
    () => parseSortOverride(searchParams.get("sort")),
    [searchParams],
  );
  const filterOverride = useMemo(
    () => parseFilterOverride(searchParams.get("filter") ?? searchParams.get("filters")),
    [searchParams],
  );

  // A null underlying view means ALL — synthesize the ALL definition so the
  // data hook + table stay dumb (they always receive a real view shape). URL
  // sort/filter overrides still layer on top of ALL (`?view=all&sort=…`).
  const activeView = useMemo<ProjectTableViewDefinition>(() => {
    const base = viewState.activeView ?? buildAllProjectsView();

    return {
      ...base,
      columns: sanitizeColumns(base.columns),
      filters: layerFilters(base.filters, filterOverride),
      sort: sortOverride ?? normalizeSort(base.sort),
    };
  }, [filterOverride, sortOverride, viewState.activeView]);

  return {
    ...viewState,
    activeView,
    activeViewId: activeView.id,
    savedView: viewState.activeView,
    urlOverrides: {
      filters: filterOverride,
      sort: sortOverride,
      hasOverrides: Boolean(filterOverride || sortOverride),
    },
  };
}
