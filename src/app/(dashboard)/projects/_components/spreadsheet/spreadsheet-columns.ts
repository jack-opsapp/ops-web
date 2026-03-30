export type SpreadsheetSortDirection = "asc" | "desc" | null;

export interface SpreadsheetColumnDef {
  id: string;
  header: string;
  width: string;
  sortable: boolean;
  editable: false | "text" | "status" | "date" | "number" | "textarea";
  defaultVisible: boolean;
  permission?: string;
  mono?: boolean;
}

export const SPREADSHEET_COLUMNS: SpreadsheetColumnDef[] = [
  { id: "actions",       header: "",              width: "40px",    sortable: false, editable: false,      defaultVisible: true },
  { id: "status",        header: "status",        width: "120px",   sortable: true,  editable: "status",   defaultVisible: true },
  { id: "title",         header: "title",         width: "200px",   sortable: true,  editable: "text",     defaultVisible: true },
  { id: "client",        header: "client",        width: "150px",   sortable: true,  editable: false,      defaultVisible: true },
  { id: "address",       header: "address",       width: "180px",   sortable: true,  editable: "text",     defaultVisible: true },
  { id: "startDate",     header: "startDate",     width: "100px",   sortable: true,  editable: "date",     defaultVisible: true },
  { id: "endDate",       header: "endDate",       width: "100px",   sortable: true,  editable: "date",     defaultVisible: true },
  { id: "progress",      header: "progress",      width: "120px",   sortable: true,  editable: false,      defaultVisible: true },
  { id: "estimateTotal", header: "estimateTotal", width: "100px",   sortable: true,  editable: false,      defaultVisible: true,  permission: "accounting.view", mono: true },
  { id: "invoiceTotal",  header: "invoiceTotal",  width: "100px",   sortable: true,  editable: false,      defaultVisible: false, permission: "accounting.view", mono: true },
  { id: "duration",      header: "duration",      width: "80px",    sortable: true,  editable: "number",   defaultVisible: false, mono: true },
  { id: "team",          header: "team",          width: "140px",   sortable: false, editable: false,      defaultVisible: false },
  { id: "clientEmail",   header: "clientEmail",   width: "160px",   sortable: false, editable: false,      defaultVisible: false },
  { id: "clientPhone",   header: "clientPhone",   width: "120px",   sortable: false, editable: false,      defaultVisible: false, mono: true },
  { id: "photos",        header: "photos",        width: "70px",    sortable: true,  editable: false,      defaultVisible: false, mono: true },
  { id: "notes",         header: "notes",         width: "200px",   sortable: false, editable: "textarea", defaultVisible: false },
  { id: "description",   header: "description",   width: "200px",   sortable: false, editable: "textarea", defaultVisible: false },
  { id: "pipeline",      header: "pipeline",      width: "80px",    sortable: false, editable: false,      defaultVisible: false },
  { id: "daysInStatus",  header: "daysInStatus",  width: "90px",    sortable: true,  editable: false,      defaultVisible: false, mono: true },
  { id: "created",       header: "created",       width: "100px",   sortable: true,  editable: false,      defaultVisible: false, mono: true },
];

export function getDefaultColumnVisibility(): Record<string, boolean> {
  const vis: Record<string, boolean> = {};
  for (const col of SPREADSHEET_COLUMNS) {
    vis[col.id] = col.defaultVisible;
  }
  return vis;
}

export function loadColumnVisibility(): Record<string, boolean> {
  if (typeof window === "undefined") return getDefaultColumnVisibility();
  try {
    const stored = localStorage.getItem("ops_projects_spreadsheet_columns");
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return getDefaultColumnVisibility();
}

export function saveColumnVisibility(vis: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("ops_projects_spreadsheet_columns", JSON.stringify(vis));
}
