import type { ColumnDef } from "@tanstack/react-table";
import type { Database, Json } from "@/lib/types/database.types";
import { ProjectStatus } from "@/lib/types/models";

export type ProjectTableDbRow = Database["public"]["Views"]["project_table_rows"]["Row"];
export type ProjectViewDbRow = Database["public"]["Tables"]["project_views"]["Row"];

export type ProjectTableColumnId =
  | "select"
  | "name"
  | "status"
  | "client"
  | "client_email"
  | "client_phone"
  | "address"
  | "team"
  | "start_date"
  | "end_date"
  | "duration"
  | "progress"
  | "next_task"
  | "task_count"
  | "days_in_status"
  | "estimate_total"
  | "invoice_total"
  | "paid_total"
  | "value"
  | "project_cost"
  | "margin"
  | "photos"
  | "updated_at";

export const PROJECT_TABLE_COLUMN_IDS = [
  "select",
  "name",
  "status",
  "client",
  "client_email",
  "client_phone",
  "address",
  "team",
  "start_date",
  "end_date",
  "duration",
  "progress",
  "next_task",
  "task_count",
  "days_in_status",
  "estimate_total",
  "invoice_total",
  "paid_total",
  "value",
  "project_cost",
  "margin",
  "photos",
  "updated_at",
] as const satisfies readonly ProjectTableColumnId[];

export type ProjectTableEditableColumnId =
  | "name"
  | "status"
  | "client"
  | "address"
  | "start_date"
  | "end_date";

export const PROJECT_TABLE_EDITABLE_COLUMN_IDS = [
  "name",
  "status",
  "client",
  "address",
  "start_date",
  "end_date",
] as const satisfies readonly ProjectTableEditableColumnId[];

export interface ProjectTableClientEditValue {
  clientId: string | null;
  clientName: string | null;
}

export type ProjectTableEditValue = string | null | ProjectStatus | ProjectTableClientEditValue;

export type ProjectTableDirectEditColumnId = Exclude<ProjectTableEditableColumnId, "status">;

export const PROJECT_TABLE_DIRECT_EDIT_FIELD_MAP = {
  name: "title",
  client: "client_id",
  address: "address",
  start_date: "start_date",
  end_date: "end_date",
} as const satisfies Record<
  ProjectTableDirectEditColumnId,
  keyof Database["public"]["Tables"]["projects"]["Update"]
>;

export function isProjectTableEditableColumn(
  columnId: ProjectTableColumnId,
): columnId is ProjectTableEditableColumnId {
  return (PROJECT_TABLE_EDITABLE_COLUMN_IDS as readonly string[]).includes(columnId);
}

export type ProjectTableCellKind =
  | "select"
  | "text"
  | "team"
  | "status"
  | "relation"
  | "number"
  | "percent"
  | "currency"
  | "date"
  | "progress";

export interface ProjectTableColumnConfig {
  id: ProjectTableColumnId;
  labelKey: string;
  dbField?: keyof ProjectTableDbRow;
  kind: ProjectTableCellKind;
  frozen?: boolean;
  sortable?: boolean;
  editable?: boolean;
  minWidth: number;
  width: number;
  maxWidth: number;
  align?: "left" | "right";
  requiresPermission?: "projects.view_financials";
}

export const PROJECT_TABLE_COLUMNS: ProjectTableColumnConfig[] = [
  { id: "select", labelKey: "table.column.select", kind: "select", frozen: true, minWidth: 36, width: 36, maxWidth: 36 },
  { id: "name", labelKey: "table.column.name", dbField: "title", kind: "text", frozen: true, sortable: true, editable: true, minWidth: 200, width: 280, maxWidth: 480 },
  { id: "status", labelKey: "table.column.status", dbField: "status", kind: "status", frozen: true, sortable: true, editable: true, minWidth: 124, width: 136, maxWidth: 168 },
  { id: "client", labelKey: "table.column.client", dbField: "client_name", kind: "relation", sortable: true, editable: true, minWidth: 140, width: 180, maxWidth: 320 },
  { id: "client_email", labelKey: "table.column.clientEmail", dbField: "client_email", kind: "text", sortable: true, minWidth: 160, width: 220, maxWidth: 320 },
  { id: "client_phone", labelKey: "table.column.clientPhone", dbField: "client_phone", kind: "text", sortable: true, minWidth: 130, width: 150, maxWidth: 200 },
  { id: "address", labelKey: "table.column.address", dbField: "address", kind: "text", sortable: true, editable: true, minWidth: 180, width: 260, maxWidth: 420 },
  { id: "team", labelKey: "table.column.team", dbField: "team_member_ids", kind: "team", minWidth: 120, width: 160, maxWidth: 240 },
  { id: "start_date", labelKey: "table.column.startDate", dbField: "start_date", kind: "date", sortable: true, editable: true, minWidth: 110, width: 130, maxWidth: 160 },
  { id: "end_date", labelKey: "table.column.endDate", dbField: "end_date", kind: "date", sortable: true, editable: true, minWidth: 110, width: 130, maxWidth: 160 },
  { id: "duration", labelKey: "table.column.duration", dbField: "duration", kind: "number", sortable: true, minWidth: 90, width: 110, maxWidth: 140, align: "right" },
  { id: "progress", labelKey: "table.column.progress", dbField: "progress", kind: "progress", sortable: true, minWidth: 100, width: 140, maxWidth: 200 },
  { id: "next_task", labelKey: "table.column.nextTask", dbField: "next_task", kind: "text", sortable: true, minWidth: 160, width: 220, maxWidth: 320 },
  { id: "task_count", labelKey: "table.column.tasks", dbField: "task_count", kind: "number", sortable: true, minWidth: 80, width: 90, maxWidth: 120, align: "right" },
  { id: "days_in_status", labelKey: "table.column.days", dbField: "days_in_status", kind: "number", sortable: true, minWidth: 100, width: 130, maxWidth: 160, align: "right" },
  { id: "estimate_total", labelKey: "table.column.estimate", dbField: "estimate_total", kind: "currency", sortable: true, minWidth: 110, width: 130, maxWidth: 180, align: "right", requiresPermission: "projects.view_financials" },
  { id: "invoice_total", labelKey: "table.column.invoiced", dbField: "invoice_total", kind: "currency", sortable: true, minWidth: 110, width: 130, maxWidth: 180, align: "right", requiresPermission: "projects.view_financials" },
  { id: "paid_total", labelKey: "table.column.paid", dbField: "paid_total", kind: "currency", sortable: true, minWidth: 110, width: 130, maxWidth: 180, align: "right", requiresPermission: "projects.view_financials" },
  { id: "value", labelKey: "table.column.value", dbField: "value", kind: "currency", sortable: true, minWidth: 110, width: 130, maxWidth: 180, align: "right", requiresPermission: "projects.view_financials" },
  { id: "project_cost", labelKey: "table.column.cost", dbField: "project_cost", kind: "currency", sortable: true, minWidth: 110, width: 130, maxWidth: 180, align: "right", requiresPermission: "projects.view_financials" },
  { id: "margin", labelKey: "table.column.margin", dbField: "margin", kind: "percent", sortable: true, minWidth: 90, width: 110, maxWidth: 140, align: "right", requiresPermission: "projects.view_financials" },
  { id: "photos", labelKey: "table.column.photos", dbField: "photo_count", kind: "number", sortable: true, minWidth: 80, width: 100, maxWidth: 140, align: "right" },
  { id: "updated_at", labelKey: "table.column.updated", dbField: "updated_at", kind: "date", sortable: true, minWidth: 120, width: 150, maxWidth: 190 },
];

export interface ProjectTableRow {
  id: string;
  companyId: string;
  title: string;
  status: ProjectStatus;
  rawStatus: string;
  clientId: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  address: string | null;
  teamMemberIds: string[];
  startDate: string | null;
  endDate: string | null;
  duration: number | null;
  progress: number | null;
  nextTask: string | null;
  taskCount: number;
  taskCompletedCount: number;
  daysInStatus: number | null;
  estimateTotal: number | null;
  invoiceTotal: number | null;
  paidTotal: number | null;
  value: number | null;
  projectCost: number | null;
  margin: number | null;
  photoCount: number;
  updatedAt: string | null;
  statusVersion?: number;
}

export function getProjectTableEditValue(
  row: ProjectTableRow,
  columnId: ProjectTableEditableColumnId,
): ProjectTableEditValue {
  switch (columnId) {
    case "name":
      return row.title;
    case "status":
      return row.status;
    case "client":
      return { clientId: row.clientId, clientName: row.clientName };
    case "address":
      return row.address;
    case "start_date":
      return row.startDate;
    case "end_date":
      return row.endDate;
  }
}

export type ProjectTableDensity = "compact" | "comfortable" | "spacious";
export type ProjectTableViewOwnerType = "company" | "user";
export type ProjectTableViewMutationErrorCode =
  | "DUPLICATE_NAME"
  | "PERMISSION_DENIED"
  | "INVALID_INPUT"
  | "UNKNOWN";

export interface ProjectTableViewDensityInput {
  density: ProjectTableDensity;
  zoomLevel: number;
}

export interface ProjectTableViewDefinitionInput {
  columns?: ProjectTableColumnId[];
  filters?: Json;
  sort?: ProjectTableSort[];
  density?: ProjectTableDensity;
  zoomLevel?: number;
}

export interface ProjectTableViewCreateInput {
  name: string;
  sourceView?: ProjectTableViewDefinition | null;
  definition?: ProjectTableViewDefinitionInput | null;
}

export interface ProjectTableViewUpdateInput {
  viewId: string;
  name?: string;
  sourceView?: ProjectTableViewDefinition | null;
  definition?: ProjectTableViewDefinitionInput | null;
  canManageViews?: boolean;
}

export interface ProjectTableViewDefinition {
  id: string;
  name: string;
  icon: string | null;
  permissionKey: string | null;
  ownerType?: ProjectTableViewOwnerType;
  ownerId?: string;
  columns: ProjectTableColumnId[];
  filters: Json;
  sort: ProjectTableSort[];
  density: ProjectTableDensity;
  zoomLevel: number;
  isDefault: boolean;
  isArchived?: boolean;
  sortPosition: number;
  updatedAt: string;
}

export interface ProjectTableSort {
  field: ProjectTableColumnId | keyof ProjectTableDbRow;
  direction: "asc" | "desc";
}

export interface ProjectTableDataParams {
  companyId: string;
  userId: string;
  view: ProjectTableViewDefinition;
  search: string;
  sorting: ProjectTableSort[];
  pageSize: number;
}

export type ProjectTableBulkAction = "status" | "date" | "assign_team" | "remove_team";

interface ProjectTableBulkOperationBase {
  projectId: string;
  expectedUpdatedAt: string;
}

export type ProjectTableBulkOperation =
  | (ProjectTableBulkOperationBase & {
      action: "status";
      status: ProjectStatus;
      expectedStatusVersion: number;
    })
  | (ProjectTableBulkOperationBase & {
      action: "date";
      field: "start_date" | "end_date";
      value: string | null;
    })
  | (ProjectTableBulkOperationBase & {
      action: "assign_team";
      userId: string;
      taskIds: string[];
    })
  | (ProjectTableBulkOperationBase & {
      action: "remove_team";
      userId: string;
      taskIds: string[] | null;
    });

export interface ProjectTableBulkSuccess {
  projectId: string;
  action: ProjectTableBulkAction | string;
  updatedAt: string | null;
  statusVersion?: number | null;
}

export interface ProjectTableBulkFailure {
  projectId: string;
  action: ProjectTableBulkAction | string;
  code: string;
  message: string;
}

export interface ProjectTableBulkResult {
  success: ProjectTableBulkSuccess[];
  failed: ProjectTableBulkFailure[];
  successCount: number;
  failedCount: number;
}

export type ProjectTableColumnDef = ColumnDef<ProjectTableRow>;
