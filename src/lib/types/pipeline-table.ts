/**
 * OPS Web — Pipeline Table View column model & row types
 *
 * The pipeline-optimized hybrid table is a third pipeline mode alongside the
 * board and list. This module is the single source of truth for its column
 * registry, cell kinds, inline-editable column set, the flattened row shape the
 * adapter produces, and sort/default-visibility primitives.
 *
 * Mirrors the structure of `./project-table.ts` so both tables share patterns
 * (frozen-column rails, editable guards, the `table.column.<id>` labelKey
 * convention). It deliberately omits per-column permission gating: pipeline
 * money is visible to anyone with `pipeline.view`, so there is no
 * `requiresPermission` field here.
 *
 * Conventions:
 *   - Column ids are stable string slugs (snake_case where multi-word).
 *   - Row fields are camelCase; dates are ISO strings for stable rendering and
 *     sorting (the adapter converts `Date | null` from `Opportunity`).
 *   - Stage is NOT inline-editable — stage changes route through the existing
 *     Won/Lost dialogs, wired in a later phase.
 */

import type { Database, Json } from "@/lib/types/database.types";
import type { ProjectTableDensity } from "@/lib/types/project-table";
import type { OpportunityStage } from "@/lib/types/pipeline";

// ─── Column Ids ───────────────────────────────────────────────────────────────

export type PipelineTableColumnId =
  | "select"
  | "deal"
  | "stage"
  | "client"
  | "value"
  | "age_in_stage"
  | "last_activity"
  | "next_follow_up"
  | "expected_close"
  | "assignee"
  | "source"
  | "priority"
  | "correspondence";

/** All column ids in display order. */
export const PIPELINE_TABLE_COLUMN_IDS = [
  "select",
  "deal",
  "stage",
  "client",
  "value",
  "age_in_stage",
  "last_activity",
  "next_follow_up",
  "expected_close",
  "assignee",
  "source",
  "priority",
  "correspondence",
] as const satisfies readonly PipelineTableColumnId[];

// ─── Cell Kinds ───────────────────────────────────────────────────────────────

export type PipelineTableCellKind =
  | "select"
  | "text"
  | "stage"
  | "relation"
  | "currency"
  | "number"
  | "date"
  | "assignee"
  | "priority";

// ─── Editable Columns ─────────────────────────────────────────────────────────

/**
 * Columns the user can edit inline. Stage is intentionally excluded — it routes
 * through the Won/Lost dialogs (handled in a later phase), not the cell editor.
 */
export type PipelineTableEditableColumnId =
  | "value"
  | "client"
  | "next_follow_up"
  | "expected_close";

export const PIPELINE_TABLE_EDITABLE_COLUMN_IDS = [
  "value",
  "client",
  "next_follow_up",
  "expected_close",
] as const satisfies readonly PipelineTableEditableColumnId[];

/** Narrow a column id to the inline-editable subset. */
export function isPipelineTableEditableColumn(
  id: PipelineTableColumnId
): id is PipelineTableEditableColumnId {
  return (PIPELINE_TABLE_EDITABLE_COLUMN_IDS as readonly string[]).includes(id);
}

/** Union of inline-editable cell value shapes: value=number|null, dates=string|null, client=string|null (id). */
export type PipelineTableEditValue = string | number | null;

// ─── Column Config & Registry ─────────────────────────────────────────────────

export interface PipelineTableColumnConfig {
  id: PipelineTableColumnId;
  labelKey: string;
  kind: PipelineTableCellKind;
  frozen?: boolean;
  sortable?: boolean;
  editable?: boolean;
  minWidth: number;
  width: number;
  maxWidth: number;
  align?: "left" | "right";
}

export const PIPELINE_TABLE_COLUMNS: PipelineTableColumnConfig[] = [
  {
    id: "select",
    labelKey: "table.column.select",
    kind: "select",
    frozen: true,
    minWidth: 36,
    width: 36,
    maxWidth: 36,
  },
  {
    id: "deal",
    labelKey: "table.column.deal",
    kind: "text",
    frozen: true,
    sortable: true,
    minWidth: 200,
    width: 280,
    maxWidth: 480,
  },
  {
    id: "stage",
    labelKey: "table.column.stage",
    kind: "stage",
    frozen: true,
    sortable: true,
    minWidth: 124,
    width: 136,
    maxWidth: 168,
  },
  {
    id: "client",
    labelKey: "table.column.client",
    kind: "relation",
    sortable: true,
    editable: true,
    minWidth: 140,
    width: 180,
    maxWidth: 320,
  },
  {
    id: "value",
    labelKey: "table.column.value",
    kind: "currency",
    sortable: true,
    editable: true,
    minWidth: 110,
    width: 130,
    maxWidth: 180,
    align: "right",
  },
  {
    id: "age_in_stage",
    labelKey: "table.column.age_in_stage",
    kind: "number",
    sortable: true,
    minWidth: 90,
    width: 110,
    maxWidth: 140,
    align: "right",
  },
  {
    id: "last_activity",
    labelKey: "table.column.last_activity",
    kind: "date",
    sortable: true,
    minWidth: 110,
    width: 130,
    maxWidth: 160,
  },
  {
    id: "next_follow_up",
    labelKey: "table.column.next_follow_up",
    kind: "date",
    sortable: true,
    editable: true,
    minWidth: 110,
    width: 130,
    maxWidth: 160,
  },
  {
    id: "expected_close",
    labelKey: "table.column.expected_close",
    kind: "date",
    sortable: true,
    editable: true,
    minWidth: 110,
    width: 130,
    maxWidth: 160,
  },
  {
    id: "assignee",
    labelKey: "table.column.assignee",
    kind: "assignee",
    sortable: true,
    minWidth: 120,
    width: 150,
    maxWidth: 240,
  },
  {
    id: "source",
    labelKey: "table.column.source",
    kind: "text",
    sortable: true,
    minWidth: 100,
    width: 120,
    maxWidth: 180,
  },
  {
    id: "priority",
    labelKey: "table.column.priority",
    kind: "priority",
    sortable: true,
    minWidth: 90,
    width: 100,
    maxWidth: 130,
  },
  {
    id: "correspondence",
    labelKey: "table.column.correspondence",
    kind: "number",
    sortable: true,
    minWidth: 80,
    width: 90,
    maxWidth: 120,
    align: "right",
  },
];

// ─── Row Shape ────────────────────────────────────────────────────────────────

/**
 * Flattened row the adapter (next task) produces from an `Opportunity` plus
 * joined client/assignee/stage-config data. Dates are ISO strings so rendering
 * and column sorting stay stable and timezone-free at the table layer.
 */
export interface PipelineTableRow {
  id: string;
  companyId: string;
  title: string;
  stage: OpportunityStage;
  clientId: string | null;
  clientName: string | null;
  estimatedValue: number | null;
  winProbability: number | null;
  weightedValue: number | null;
  ageInStageDays: number | null;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
  expectedCloseDate: string | null;
  assignedTo: string | null;
  assignmentVersion: number;
  assigneeName: string | null;
  source: string | null;
  priority: string | null;
  correspondenceCount: number;
  lastInboundAt: string | null;
  lastMessageDirection: "in" | "out" | null;
  handledAt: string | null;
  stageEnteredAt: string | null;
  projectId: string | null;
  updatedAt: string | null;
  staleThresholdDays: number | null;
  winProbabilityIsFallback: boolean;
}

// ─── Sort & Default Visibility ────────────────────────────────────────────────

export interface PipelineTableSort {
  field: PipelineTableColumnId;
  direction: "asc" | "desc";
}

/** Lean default-visible column set for a fresh pipeline table. */
export const DEFAULT_PIPELINE_TABLE_COLUMNS: PipelineTableColumnId[] = [
  "select",
  "deal",
  "stage",
  "client",
  "value",
  "age_in_stage",
  "next_follow_up",
  "assignee",
];

// ─── Saved Views ────────────────────────────────────────────────────────────

/**
 * Persisted saved-view types for the pipeline table, backed by the
 * `opportunity_views` table + its SECURITY DEFINER RPCs. Mirrors the projects
 * equivalents in `./project-table.ts` 1:1 (project → opportunity), so both
 * tables share the same view-management surface (company vs personal ownership,
 * archive/reset/share lifecycle, partial definition updates).
 */

/** Raw `opportunity_views` row as returned by Supabase. */
export type OpportunityViewDbRow =
  Database["public"]["Tables"]["opportunity_views"]["Row"];

/**
 * Density reuses the projects density type — pipeline rows share the same
 * compact/comfortable/spacious row-height scale, so there is no pipeline-only
 * density variant.
 */
export type OpportunityViewDensity = ProjectTableDensity;

/** Whether a view is owned by the company (shared) or a single user (personal). */
export type OpportunityViewOwnerType = "company" | "user";

/** Error codes surfaced by the opportunity-view mutation RPCs. */
export type OpportunityViewMutationErrorCode =
  | "DUPLICATE_NAME"
  | "PERMISSION_DENIED"
  | "INVALID_INPUT"
  | "UNKNOWN";

/**
 * Fully-resolved saved view used by the table UI. `columns`/`sort` are narrowed
 * to the pipeline column-id space; `filters` stays opaque `Json` (validated at
 * the query layer, not here).
 */
export interface OpportunityViewDefinition {
  id: string;
  name: string;
  icon: string | null;
  permissionKey: string | null;
  ownerType?: OpportunityViewOwnerType;
  ownerId?: string;
  columns: PipelineTableColumnId[];
  filters: Json;
  sort: PipelineTableSort[];
  density: OpportunityViewDensity;
  zoomLevel: number;
  isDefault: boolean;
  isArchived?: boolean;
  sortPosition: number;
  updatedAt: string;
}

/**
 * Partial definition the UI passes when creating or updating a view. Any field
 * omitted falls back to the source view (on create) or is left unchanged (on
 * partial update).
 */
export interface OpportunityViewDefinitionInput {
  columns?: PipelineTableColumnId[];
  filters?: Json;
  sort?: PipelineTableSort[];
  density?: OpportunityViewDensity;
  zoomLevel?: number;
}

/** Input for creating a personal view (optionally seeded from a source view). */
export interface OpportunityViewCreateInput {
  name: string;
  sourceView?: OpportunityViewDefinition | null;
  definition?: OpportunityViewDefinitionInput | null;
}

/** Input for mutating an existing view (rename / archive / reset / share / update). */
export interface OpportunityViewUpdateInput {
  viewId: string;
  name?: string;
  sourceView?: OpportunityViewDefinition | null;
  definition?: OpportunityViewDefinitionInput | null;
  canManageViews?: boolean;
}
