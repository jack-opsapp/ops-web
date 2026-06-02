/**
 * OPS Web — Pipeline (opportunity) saved-view definition payload builder
 *
 * Mirrors `./project-view-defaults.ts` 1:1 (project → opportunity). Produces the
 * snake_case `{ columns?, filters?, sort?, density?, zoom_level? }` shape the
 * `create_opportunity_table_view` / `update_opportunity_table_view_definition`
 * RPCs expect for their `p_definition` jsonb argument, sanitizing every field
 * client-side before it reaches the database sanitizer.
 *
 * The default column/filter/sort set matches the canonical lean default seeded
 * by the migration's `private.opportunity_table_view_default_definition`
 * fallback, so a client-built "new view from scratch" payload and a server-side
 * reset converge on the same shape.
 */

import type { Json } from "@/lib/types/database.types";
import {
  PIPELINE_TABLE_COLUMN_IDS,
  type OpportunityViewDefinition,
  type OpportunityViewDefinitionInput,
  type OpportunityViewDensity,
  type PipelineTableColumnId,
  type PipelineTableSort,
} from "@/lib/types/pipeline-table";

export const OPPORTUNITY_VIEW_DEFAULT_DENSITY: OpportunityViewDensity = "comfortable";
export const OPPORTUNITY_VIEW_DEFAULT_ZOOM_LEVEL = 1;
export const OPPORTUNITY_VIEW_MIN_ZOOM_LEVEL = 0.75;
export const OPPORTUNITY_VIEW_MAX_ZOOM_LEVEL = 1.5;

export const OPPORTUNITY_VIEW_DEFAULT_COLUMNS = [
  "deal",
  "stage",
  "client",
  "value",
  "weighted",
  "age_in_stage",
  "next_follow_up",
  "assignee",
] as const satisfies readonly PipelineTableColumnId[];

export const OPPORTUNITY_VIEW_DEFAULT_FILTERS: Json = {
  field: "stage",
  op: "in",
  value: ["new_lead", "qualifying", "quoting", "quoted", "follow_up", "negotiation"],
};

export const OPPORTUNITY_VIEW_DEFAULT_SORT = [
  { field: "next_follow_up", direction: "asc" },
] as const satisfies readonly PipelineTableSort[];

export interface OpportunityViewDefinitionPayload {
  columns?: Array<{ id: PipelineTableColumnId }>;
  filters?: Json;
  sort?: PipelineTableSort[];
  density?: OpportunityViewDensity;
  zoom_level?: number;
}

function isColumnId(value: unknown): value is PipelineTableColumnId {
  return (
    typeof value === "string" &&
    (PIPELINE_TABLE_COLUMN_IDS as readonly string[]).includes(value)
  );
}

function sanitizeColumns(columns: readonly PipelineTableColumnId[] | undefined) {
  if (!columns) return undefined;
  const seen = new Set<PipelineTableColumnId>();
  const safeColumns: PipelineTableColumnId[] = [];

  for (const column of columns) {
    if (!isColumnId(column) || seen.has(column)) continue;
    seen.add(column);
    safeColumns.push(column);
  }

  return safeColumns.map((id) => ({ id }));
}

function sanitizeSort(sort: readonly PipelineTableSort[] | undefined) {
  if (!sort) return undefined;
  return sort
    .filter((item): item is PipelineTableSort => (
      item !== null &&
      typeof item === "object" &&
      typeof item.field === "string" &&
      isColumnId(item.field) &&
      (item.direction === "asc" || item.direction === "desc")
    ))
    .map((item) => ({ field: item.field, direction: item.direction }));
}

function sanitizeDensity(density: OpportunityViewDensity | undefined) {
  return density === "compact" || density === "spacious" || density === "comfortable"
    ? density
    : undefined;
}

function sanitizeZoomLevel(zoomLevel: number | undefined) {
  if (typeof zoomLevel !== "number" || !Number.isFinite(zoomLevel)) return undefined;
  const clamped = Math.min(
    OPPORTUNITY_VIEW_MAX_ZOOM_LEVEL,
    Math.max(OPPORTUNITY_VIEW_MIN_ZOOM_LEVEL, zoomLevel),
  );
  return Math.round(clamped * 100) / 100;
}

function definitionInputFromView(
  input: OpportunityViewDefinitionInput | OpportunityViewDefinition | null | undefined,
): OpportunityViewDefinitionInput {
  if (!input) return {};
  return {
    columns: input.columns,
    filters: input.filters,
    sort: input.sort,
    density: input.density,
    zoomLevel: input.zoomLevel,
  };
}

export function createDefaultOpportunityViewDefinitionInput(): Required<OpportunityViewDefinitionInput> {
  return {
    columns: [...OPPORTUNITY_VIEW_DEFAULT_COLUMNS],
    filters: OPPORTUNITY_VIEW_DEFAULT_FILTERS,
    sort: [...OPPORTUNITY_VIEW_DEFAULT_SORT],
    density: OPPORTUNITY_VIEW_DEFAULT_DENSITY,
    zoomLevel: OPPORTUNITY_VIEW_DEFAULT_ZOOM_LEVEL,
  };
}

export function buildOpportunityViewDefinitionPayload(
  input: OpportunityViewDefinitionInput | OpportunityViewDefinition | null | undefined,
  options: { partial?: boolean } = {},
): OpportunityViewDefinitionPayload {
  const definition = definitionInputFromView(input);
  const fallback: Partial<OpportunityViewDefinitionInput> = options.partial
    ? {}
    : createDefaultOpportunityViewDefinitionInput();
  const payload: OpportunityViewDefinitionPayload = {};

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
