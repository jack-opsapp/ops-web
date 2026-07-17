import { ProjectStatus } from "@/lib/types/models";
import { PROJECT_TABLE_COLUMN_IDS } from "@/lib/types/project-table";
import type {
  ProjectTableDbRow,
  ProjectTableRow,
  ProjectViewDbRow,
  ProjectTableColumnId,
  ProjectTableViewDefinition,
  ProjectTableDensity,
} from "@/lib/types/project-table";

const EMPTY = "—";
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseProjectTableStatus(raw: string | null): ProjectStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "rfq":
      return ProjectStatus.RFQ;
    case "estimated":
      return ProjectStatus.Estimated;
    case "accepted":
      return ProjectStatus.Accepted;
    case "in_progress":
      return ProjectStatus.InProgress;
    case "completed":
      return ProjectStatus.Completed;
    case "closed":
      return ProjectStatus.Closed;
    case "archived":
      return ProjectStatus.Archived;
    default:
      return ProjectStatus.RFQ;
  }
}

export function serializeProjectTableStatus(status: ProjectStatus): string {
  switch (status) {
    case ProjectStatus.RFQ:
      return "rfq";
    case ProjectStatus.Estimated:
      return "estimated";
    case ProjectStatus.Accepted:
      return "accepted";
    case ProjectStatus.InProgress:
      return "in_progress";
    case ProjectStatus.Completed:
      return "completed";
    case ProjectStatus.Closed:
      return "closed";
    case ProjectStatus.Archived:
      return "archived";
  }
}

export function formatProjectStatusLabel(status: ProjectStatus): string {
  return status === ProjectStatus.InProgress ? "In Progress" : status;
}

export function formatCurrency(value: number | null): string {
  if (value == null) return EMPTY;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null): string {
  if (value == null) return EMPTY;
  return `${Math.round(value * 100)}%`;
}

export function formatNumber(value: number | null): string {
  if (value == null) return EMPTY;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatDate(value: string | null): string {
  if (!value) return EMPTY;
  const match = DATE_ONLY_PATTERN.exec(value);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

export function mapProjectTableRow(row: ProjectTableDbRow): ProjectTableRow | null {
  if (!row.id || !row.company_id) return null;
  const rawStatus = row.status ?? "rfq";
  return {
    id: row.id,
    companyId: row.company_id,
    title: row.title ?? EMPTY,
    status: parseProjectTableStatus(rawStatus),
    rawStatus,
    clientId: row.client_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    address: row.address,
    teamMemberIds: row.team_member_ids ?? [],
    startDate: row.start_date,
    endDate: row.end_date,
    duration: row.duration,
    progress: row.progress,
    nextTask: row.next_task,
    taskCount: row.task_count ?? 0,
    taskCompletedCount: row.task_completed_count ?? 0,
    daysInStatus: row.days_in_status,
    estimateTotal: row.estimate_total,
    invoiceTotal: row.invoice_total,
    paidTotal: row.paid_total,
    value: row.value,
    projectCost: row.project_cost,
    margin: row.margin,
    photoCount: row.photo_count ?? 0,
    updatedAt: row.updated_at,
    // The table view predates the monotonic status token. fetchRows hydrates
    // this from canonical projects before exposing rows to mutation hooks.
    statusVersion: 0,
  };
}

function isColumnId(value: unknown): value is ProjectTableColumnId {
  return (
    typeof value === "string" &&
    (PROJECT_TABLE_COLUMN_IDS as readonly string[]).includes(value)
  );
}

function normalizeDensity(value: string): ProjectTableDensity {
  return value === "compact" || value === "spacious" ? value : "comfortable";
}

export function mapProjectView(row: ProjectViewDbRow): ProjectTableViewDefinition {
  const columns = Array.isArray(row.columns)
    ? row.columns
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "id" in item) {
            return (item as { id?: unknown }).id;
          }
          return null;
        })
        .filter(isColumnId)
    : [];

  const sort = Array.isArray(row.sort)
    ? row.sort.filter((item): item is { field: ProjectTableColumnId; direction: "asc" | "desc" } => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as { field?: unknown; direction?: unknown };
        return isColumnId(candidate.field) && (candidate.direction === "asc" || candidate.direction === "desc");
      })
    : [];

  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    permissionKey: row.permission_key,
    columns,
    filters: row.filters,
    sort,
    density: normalizeDensity(row.density),
    zoomLevel: Number(row.zoom_level) || 1,
    isDefault: row.is_default,
    sortPosition: row.sort_position,
    updatedAt: row.updated_at,
  };
}
