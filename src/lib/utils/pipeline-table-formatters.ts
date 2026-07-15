/**
 * OPS Web — Pipeline Table View cell formatters
 *
 * Pure value → display-string formatters for the pipeline table's cells. Three
 * formatters (`formatCurrency`, `formatNumber`, `formatDate`) are byte-for-byte
 * identical to the projects table's, so they are re-exported rather than
 * duplicated. `formatAgeDays` is the one pipeline-specific formatter: compact
 * day-count rendering ("9d", "0d") for the age-in-stage column.
 *
 * The empty/null sentinel ("—") is kept identical to the projects formatters so
 * blank cells read the same across both tables.
 */

import {
  PIPELINE_TABLE_COLUMN_IDS,
  type OpportunityViewDefinition,
  type OpportunityViewDensity,
  type OpportunityViewDbRow,
  type PipelineTableColumnId,
} from "@/lib/types/pipeline-table";

export {
  formatCurrency,
  formatNumber,
  formatDate,
} from "./project-table-formatters";

const EMPTY = "—";

/**
 * Format a day count as a compact age label. Rendering as mono/tabular is the
 * cell's responsibility — this only produces the string.
 *
 *   formatAgeDays(9)    ⇒ "9d"
 *   formatAgeDays(0)    ⇒ "0d"
 *   formatAgeDays(null) ⇒ "—"
 */
export function formatAgeDays(days: number | null): string {
  if (days == null) return EMPTY;
  return `${days}d`;
}

// ─── Saved-View Mapper ────────────────────────────────────────────────────────

function isPipelineColumnId(value: unknown): value is PipelineTableColumnId {
  return (
    typeof value === "string" &&
    (PIPELINE_TABLE_COLUMN_IDS as readonly string[]).includes(value)
  );
}

function normalizePipelineViewDensity(value: string): OpportunityViewDensity {
  return value === "compact" || value === "spacious" ? value : "comfortable";
}

/**
 * Map a raw `opportunity_views` row into a resolved `OpportunityViewDefinition`.
 *
 * Mirrors `mapProjectView` for the projects table: `columns` is parsed from its
 * jsonb form (accepting both bare string ids and `{ id }` objects) and filtered
 * to known pipeline column ids; `sort` entries are validated field+direction
 * pairs; density falls back to "comfortable"; zoom defaults to 1 when the stored
 * value is non-numeric. `filters` is passed through opaquely.
 */
export function mapOpportunityView(
  row: OpportunityViewDbRow
): OpportunityViewDefinition {
  const columns = Array.isArray(row.columns)
    ? row.columns
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "id" in item) {
            return (item as { id?: unknown }).id;
          }
          return null;
        })
        .filter(isPipelineColumnId)
    : [];

  const sort = Array.isArray(row.sort)
    ? row.sort.filter(
        (
          item
        ): item is {
          field: PipelineTableColumnId;
          direction: "asc" | "desc";
        } => {
          if (!item || typeof item !== "object") return false;
          const candidate = item as { field?: unknown; direction?: unknown };
          return (
            isPipelineColumnId(candidate.field) &&
            (candidate.direction === "asc" || candidate.direction === "desc")
          );
        }
      )
    : [];

  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    permissionKey: row.permission_key,
    columns,
    filters: row.filters,
    sort,
    density: normalizePipelineViewDensity(row.density),
    zoomLevel: Number(row.zoom_level) || 1,
    isDefault: row.is_default,
    sortPosition: row.sort_position,
    updatedAt: row.updated_at,
  };
}
