import type { Json } from "@/lib/types/database.types";
import {
  PROJECT_TABLE_COLUMN_IDS,
  type ProjectTableColumnId,
  type ProjectTableDensity,
  type ProjectTableSort,
  type ProjectTableViewDefinition,
  type ProjectTableViewDefinitionInput,
} from "@/lib/types/project-table";

export const PROJECT_TABLE_VIEW_DEFAULT_DENSITY: ProjectTableDensity = "comfortable";
export const PROJECT_TABLE_VIEW_DEFAULT_ZOOM_LEVEL = 1;
export const PROJECT_TABLE_VIEW_MIN_ZOOM_LEVEL = 0.75;
export const PROJECT_TABLE_VIEW_MAX_ZOOM_LEVEL = 1.5;

export const PROJECT_TABLE_VIEW_DEFAULT_COLUMNS = [
  "name",
  "status",
  "client",
  "team",
  "start_date",
  "end_date",
  "progress",
] as const satisfies readonly ProjectTableColumnId[];

export const PROJECT_TABLE_VIEW_DEFAULT_FILTERS: Json = {
  field: "status",
  op: "not_in",
  value: ["closed", "archived"],
};

export const PROJECT_TABLE_VIEW_DEFAULT_SORT = [
  { field: "updated_at", direction: "desc" },
] as const satisfies readonly ProjectTableSort[];

export interface ProjectTableViewDefinitionPayload {
  columns?: Array<{ id: ProjectTableColumnId }>;
  filters?: Json;
  sort?: ProjectTableSort[];
  density?: ProjectTableDensity;
  zoom_level?: number;
}

function isColumnId(value: unknown): value is ProjectTableColumnId {
  return (
    typeof value === "string" &&
    (PROJECT_TABLE_COLUMN_IDS as readonly string[]).includes(value)
  );
}

function sanitizeColumns(columns: readonly ProjectTableColumnId[] | undefined) {
  if (!columns) return undefined;
  const seen = new Set<ProjectTableColumnId>();
  const safeColumns: ProjectTableColumnId[] = [];

  for (const column of columns) {
    if (!isColumnId(column) || seen.has(column)) continue;
    seen.add(column);
    safeColumns.push(column);
  }

  return safeColumns.map((id) => ({ id }));
}

function sanitizeSort(sort: readonly ProjectTableSort[] | undefined) {
  if (!sort) return undefined;
  return sort
    .filter((item): item is ProjectTableSort => (
      item !== null &&
      typeof item === "object" &&
      typeof item.field === "string" &&
      isColumnId(item.field) &&
      (item.direction === "asc" || item.direction === "desc")
    ))
    .map((item) => ({ field: item.field, direction: item.direction }));
}

function sanitizeDensity(density: ProjectTableDensity | undefined) {
  return density === "compact" || density === "spacious" || density === "comfortable"
    ? density
    : undefined;
}

function sanitizeZoomLevel(zoomLevel: number | undefined) {
  if (typeof zoomLevel !== "number" || !Number.isFinite(zoomLevel)) return undefined;
  const clamped = Math.min(
    PROJECT_TABLE_VIEW_MAX_ZOOM_LEVEL,
    Math.max(PROJECT_TABLE_VIEW_MIN_ZOOM_LEVEL, zoomLevel),
  );
  return Math.round(clamped * 100) / 100;
}

function definitionInputFromView(
  input: ProjectTableViewDefinitionInput | ProjectTableViewDefinition | null | undefined,
): ProjectTableViewDefinitionInput {
  if (!input) return {};
  return {
    columns: input.columns,
    filters: input.filters,
    sort: input.sort,
    density: input.density,
    zoomLevel: input.zoomLevel,
  };
}

export function createDefaultProjectViewDefinitionInput(): Required<ProjectTableViewDefinitionInput> {
  return {
    columns: [...PROJECT_TABLE_VIEW_DEFAULT_COLUMNS],
    filters: PROJECT_TABLE_VIEW_DEFAULT_FILTERS,
    sort: [...PROJECT_TABLE_VIEW_DEFAULT_SORT],
    density: PROJECT_TABLE_VIEW_DEFAULT_DENSITY,
    zoomLevel: PROJECT_TABLE_VIEW_DEFAULT_ZOOM_LEVEL,
  };
}

export function buildProjectViewDefinitionPayload(
  input: ProjectTableViewDefinitionInput | ProjectTableViewDefinition | null | undefined,
  options: { partial?: boolean } = {},
): ProjectTableViewDefinitionPayload {
  const definition = definitionInputFromView(input);
  const fallback: Partial<ProjectTableViewDefinitionInput> = options.partial
    ? {}
    : createDefaultProjectViewDefinitionInput();
  const payload: ProjectTableViewDefinitionPayload = {};

  const columns = sanitizeColumns(definition.columns ?? fallback.columns);
  if (columns && columns.length > 0) payload.columns = columns;

  const filters = definition.filters ?? fallback.filters;
  if (filters !== undefined) payload.filters = filters;

  const sort = sanitizeSort(definition.sort ?? fallback.sort);
  if (sort && sort.length > 0) payload.sort = sort;

  const density = sanitizeDensity(definition.density ?? fallback.density);
  if (density) payload.density = density;

  const zoomLevel = sanitizeZoomLevel(definition.zoomLevel ?? fallback.zoomLevel);
  if (zoomLevel !== undefined) payload.zoom_level = zoomLevel;

  return payload;
}
