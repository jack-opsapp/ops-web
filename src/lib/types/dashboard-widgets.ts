// ---------------------------------------------------------------------------
// Dashboard Widget System — Type Definitions & Registry (v4 — Consolidated)
// ---------------------------------------------------------------------------

export type WidgetSize = "xs" | "sm" | "md" | "lg" | "xl";

// ---------------------------------------------------------------------------
// Categories & Tags
// ---------------------------------------------------------------------------

export type WidgetCategory =
  | "layout"
  | "money"
  | "pipeline"
  | "operations"
  | "clients"
  | "alerts";

export type WidgetTag =
  | "essential"
  | "scheduling"
  | "finance"
  | "field-ops"
  | "office"
  | "pipeline"
  | "clients"
  | "estimates";

// ---------------------------------------------------------------------------
// Widget Type IDs — one per unique widget template
// ---------------------------------------------------------------------------

export type WidgetTypeId =
  // Layout
  | "spacer"
  // Money (7)
  | "revenue-pulse"
  | "receivables-aging"
  | "profit-gauge"
  | "expense-tracker"
  | "cash-position"
  | "invoice-list"
  | "payments-recent"
  // Pipeline (5)
  | "pipeline-funnel"
  | "win-rate"
  | "backlog-depth"
  | "booking-rate"
  | "estimates-overview"
  // Operations (6)
  | "task-pulse"
  | "todays-schedule"
  | "task-list"
  | "crew-board"
  | "crew-locations"
  | "site-visits"
  // Clients (3)
  | "top-clients"
  | "client-attention"
  | "client-list"
  // Alerts & Activity (3)
  | "action-required"
  | "activity-feed"
  | "notifications"
  // Pipeline Detail (2)
  | "pipeline-list"
  | "lead-sources";

// ---------------------------------------------------------------------------
// Config field definition — drives per-instance sidebar config UI
// ---------------------------------------------------------------------------

export interface WidgetConfigField {
  key: string;
  label: string;
  type: "select" | "multi-select" | "toggle";
  options?: { value: string; label: string }[];
  defaultValue: unknown;
}

// ---------------------------------------------------------------------------
// Widget Type Entry — template definition (immutable)
// ---------------------------------------------------------------------------

export interface WidgetTypeEntry {
  label: string;
  description: string;
  category: WidgetCategory;
  tags: WidgetTag[];
  icon: string;
  supportedSizes: WidgetSize[];
  defaultSize: WidgetSize;
  configSchema: WidgetConfigField[];
  allowMultiple: boolean;
  requiredPermission?: string;
}

// ---------------------------------------------------------------------------
// Widget Instance — a placed widget on the dashboard (user state)
// ---------------------------------------------------------------------------

export interface WidgetInstance {
  id: string;
  typeId: WidgetTypeId;
  size: WidgetSize;
  visible: boolean;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Size → grid spans
// ---------------------------------------------------------------------------

export const WIDGET_SIZE_GRID_SPANS: Record<
  WidgetSize,
  { colSpan: number; rowSpan: number }
> = {
  xs: { colSpan: 1, rowSpan: 1 },
  sm: { colSpan: 2, rowSpan: 1 },
  md: { colSpan: 6, rowSpan: 2 },
  lg: { colSpan: 6, rowSpan: 4 },
  xl: { colSpan: 6, rowSpan: 6 },
};

export const WIDGET_SIZE_LABELS: Record<WidgetSize, string> = {
  xs: "XS",
  sm: "S",
  md: "M",
  lg: "L",
  xl: "XL",
};

export const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  layout: "Layout",
  money: "Money",
  pipeline: "Pipeline",
  operations: "Operations",
  clients: "Clients",
  alerts: "Alerts & Activity",
};

// ---------------------------------------------------------------------------
// Category display order for sidebar
// ---------------------------------------------------------------------------
export const CATEGORY_ORDER: WidgetCategory[] = [
  "layout",
  "money",
  "pipeline",
  "operations",
  "clients",
  "alerts",
];

// ---------------------------------------------------------------------------
// Full Widget Type Registry — 27 widget types
// ---------------------------------------------------------------------------

export const WIDGET_TYPE_REGISTRY: Record<WidgetTypeId, WidgetTypeEntry> = {
  // ── LAYOUT ─────────────────────────────────────────────────────────────
  spacer: {
    label: "Spacer",
    description: "Empty space between widgets",
    category: "layout",
    tags: [],
    icon: "Maximize2",
    supportedSizes: ["xs"],
    defaultSize: "xs",
    allowMultiple: true,
    configSchema: [],
  },

  // ── MONEY (7) ──────────────────────────────────────────────────────────
  "revenue-pulse": {
    label: "Revenue",
    description: "Monthly revenue collected with trend",
    category: "money",
    tags: ["essential", "finance"],
    icon: "DollarSign",
    supportedSizes: ["xs", "sm", "md", "lg"],
    defaultSize: "md",
    configSchema: [
      {
        key: "period",
        label: "Period",
        type: "select",
        options: [
          { value: "6mo", label: "6 Months" },
          { value: "12mo", label: "12 Months" },
          { value: "ytd", label: "Year to Date" },
        ],
        defaultValue: "ytd",
      },
    ],
    allowMultiple: false,
    requiredPermission: "invoices.view",
  },
  "receivables-aging": {
    label: "Receivables",
    description: "Outstanding invoices by aging bucket",
    category: "money",
    tags: ["essential", "finance"],
    icon: "Clock",
    supportedSizes: ["xs", "sm", "md", "lg"],
    defaultSize: "md",
    configSchema: [],
    allowMultiple: false,
    requiredPermission: "invoices.view",
  },
  "profit-gauge": {
    label: "Profit",
    description: "Gross margin — revenue vs expenses",
    category: "money",
    tags: ["finance"],
    icon: "TrendingUp",
    supportedSizes: ["xs", "sm", "md"],
    defaultSize: "sm",
    configSchema: [
      {
        key: "period",
        label: "Period",
        type: "select",
        options: [
          { value: "mtd", label: "Month to Date" },
          { value: "qtd", label: "Quarter to Date" },
          { value: "ytd", label: "Year to Date" },
        ],
        defaultValue: "mtd",
      },
    ],
    allowMultiple: false,
    requiredPermission: "invoices.view",
  },
  "expense-tracker": {
    label: "Expenses",
    description: "Expense breakdown by category",
    category: "money",
    tags: ["finance"],
    icon: "Receipt",
    supportedSizes: ["xs", "sm", "md", "lg"],
    defaultSize: "md",
    configSchema: [
      {
        key: "period",
        label: "Period",
        type: "select",
        options: [
          { value: "this-month", label: "This Month" },
          { value: "last-month", label: "Last Month" },
          { value: "ytd", label: "Year to Date" },
        ],
        defaultValue: "this-month",
      },
    ],
    allowMultiple: false,
    requiredPermission: "expenses.view",
  },
  "cash-position": {
    label: "Cash Flow",
    description: "Net cash flow — collected vs spent",
    category: "money",
    tags: ["finance"],
    icon: "ArrowUpDown",
    supportedSizes: ["xs", "sm", "md"],
    defaultSize: "sm",
    configSchema: [
      {
        key: "period",
        label: "Period",
        type: "select",
        options: [
          { value: "this-month", label: "This Month" },
          { value: "last-month", label: "Last Month" },
        ],
        defaultValue: "this-month",
      },
    ],
    allowMultiple: false,
    requiredPermission: "invoices.view",
  },
  "invoice-list": {
    label: "Invoice List",
    description: "Invoices with one-click send",
    category: "money",
    tags: ["finance"],
    icon: "FileText",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
    allowMultiple: true,
    configSchema: [
      {
        key: "statusFilter",
        label: "Status",
        type: "select",
        options: [
          { value: "all-open", label: "All Open" },
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent" },
          { value: "viewed", label: "Viewed" },
          { value: "past_due", label: "Past Due" },
        ],
        defaultValue: "all-open",
      },
    ],
    requiredPermission: "invoices.view",
  },
  "payments-recent": {
    label: "Recent Payments",
    description: "Recently received payments",
    category: "money",
    tags: ["finance"],
    icon: "CreditCard",
    supportedSizes: ["sm", "md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
    requiredPermission: "invoices.record_payment",
  },

  // ── PIPELINE (5) ──────────────────────────────────────────────────────
  "pipeline-funnel": {
    label: "Pipeline",
    description: "Project pipeline by stage",
    category: "pipeline",
    tags: ["essential", "pipeline"],
    icon: "Filter",
    supportedSizes: ["xs", "sm", "md", "lg"],
    defaultSize: "md",
    configSchema: [],
    allowMultiple: false,
    requiredPermission: "projects.view",
  },
  "win-rate": {
    label: "Win Rate",
    description: "Estimate conversion rate",
    category: "pipeline",
    tags: ["pipeline", "estimates"],
    icon: "Target",
    supportedSizes: ["xs", "sm", "md"],
    defaultSize: "sm",
    configSchema: [
      {
        key: "period",
        label: "Period",
        type: "select",
        options: [
          { value: "90d", label: "Last 90 Days" },
          { value: "ytd", label: "Year to Date" },
          { value: "all", label: "All Time" },
        ],
        defaultValue: "90d",
      },
    ],
    allowMultiple: false,
    requiredPermission: "estimates.view",
  },
  "backlog-depth": {
    label: "Backlog",
    description: "Weeks of signed work ahead",
    category: "pipeline",
    tags: ["essential", "pipeline"],
    icon: "Layers",
    supportedSizes: ["xs", "sm", "md"],
    defaultSize: "sm",
    configSchema: [],
    allowMultiple: false,
    requiredPermission: "projects.view",
  },
  "booking-rate": {
    label: "Bookings",
    description: "New projects per month",
    category: "pipeline",
    tags: ["pipeline"],
    icon: "CalendarPlus",
    supportedSizes: ["xs", "sm", "md"],
    defaultSize: "sm",
    configSchema: [],
    allowMultiple: false,
    requiredPermission: "projects.view",
  },
  "estimates-overview": {
    label: "Estimates Overview",
    description: "Estimates list with one-click send",
    category: "pipeline",
    tags: ["estimates", "office"],
    icon: "Calculator",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
    allowMultiple: true,
    configSchema: [
      {
        key: "statusFilter",
        label: "Status",
        type: "select",
        options: [
          { value: "all", label: "All" },
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent" },
          { value: "viewed", label: "Viewed" },
          { value: "approved", label: "Approved" },
          { value: "expired", label: "Expired" },
        ],
        defaultValue: "all",
      },
    ],
    requiredPermission: "estimates.view",
  },

  // ── OPERATIONS (6) ────────────────────────────────────────────────────
  "task-pulse": {
    label: "Tasks",
    description: "Task status overview with urgency",
    category: "operations",
    tags: ["essential", "scheduling"],
    icon: "CheckSquare",
    supportedSizes: ["xs", "sm", "md"],
    defaultSize: "sm",
    configSchema: [],
    allowMultiple: false,
    requiredPermission: "tasks.view",
  },
  "todays-schedule": {
    label: "Schedule",
    description: "Today's timeline",
    category: "operations",
    tags: ["essential", "scheduling"],
    icon: "Calendar",
    supportedSizes: ["xs", "sm", "md", "lg"],
    defaultSize: "md",
    configSchema: [
      {
        key: "scope",
        label: "Scope",
        type: "select",
        options: [
          { value: "personal", label: "My Schedule" },
          { value: "team", label: "Team Schedule" },
        ],
        defaultValue: "team",
      },
    ],
    allowMultiple: false,
    requiredPermission: "calendar.view",
  },
  "task-list": {
    label: "Task List",
    description: "Tasks with one-click complete",
    category: "operations",
    tags: ["essential", "scheduling"],
    icon: "ListTodo",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [
      {
        key: "filter",
        label: "Filter",
        type: "select",
        options: [
          { value: "upcoming", label: "Upcoming" },
          { value: "today", label: "Today" },
          { value: "overdue", label: "Overdue" },
          { value: "by-project", label: "By Project" },
        ],
        defaultValue: "upcoming",
      },
    ],
    requiredPermission: "tasks.view",
  },
  "crew-board": {
    label: "Crew",
    description: "Team status and workload",
    category: "operations",
    tags: ["essential", "field-ops"],
    icon: "Users",
    supportedSizes: ["xs", "sm", "md", "lg"],
    defaultSize: "md",
    configSchema: [],
    allowMultiple: false,
    requiredPermission: "team.view",
  },
  "crew-locations": {
    label: "Crew Locations",
    description: "Team member locations and assignments",
    category: "operations",
    tags: ["field-ops"],
    icon: "MapPin",
    supportedSizes: ["md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
    requiredPermission: "map.view_crew_locations",
  },
  "site-visits": {
    label: "Site Visits",
    description: "Upcoming and recent site visits",
    category: "operations",
    tags: ["scheduling", "field-ops"],
    icon: "MapPin",
    supportedSizes: ["sm", "md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [
      {
        key: "filter",
        label: "Filter",
        type: "select",
        options: [
          { value: "upcoming", label: "Upcoming" },
          { value: "recent", label: "Recent" },
        ],
        defaultValue: "upcoming",
      },
    ],
    requiredPermission: "projects.view",
  },

  // ── CLIENTS (3) ───────────────────────────────────────────────────────
  "top-clients": {
    label: "Top Clients",
    description: "Clients ranked by revenue",
    category: "clients",
    tags: ["clients"],
    icon: "Award",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
    configSchema: [
      {
        key: "metric",
        label: "Rank By",
        type: "select",
        options: [
          { value: "revenue", label: "Revenue" },
          { value: "outstanding", label: "Outstanding" },
          { value: "projects", label: "Project Count" },
        ],
        defaultValue: "revenue",
      },
      {
        key: "period",
        label: "Period",
        type: "select",
        options: [
          { value: "ytd", label: "Year to Date" },
          { value: "all", label: "All Time" },
        ],
        defaultValue: "ytd",
      },
    ],
    allowMultiple: false,
    requiredPermission: "clients.view",
  },
  "client-attention": {
    label: "Clients Needing Attention",
    description: "Clients with overdue items",
    category: "clients",
    tags: ["clients", "office"],
    icon: "AlertCircle",
    supportedSizes: ["sm", "md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
    requiredPermission: "clients.view",
  },
  "client-list": {
    label: "Client Directory",
    description: "Client list with search",
    category: "clients",
    tags: ["clients", "office"],
    icon: "Contact",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
    allowMultiple: true,
    configSchema: [
      {
        key: "sortBy",
        label: "Sort",
        type: "select",
        options: [
          { value: "name", label: "Name" },
          { value: "recent", label: "Recent" },
          { value: "project-count", label: "Project Count" },
        ],
        defaultValue: "name",
      },
    ],
    requiredPermission: "clients.view",
  },

  // ── ALERTS & ACTIVITY (3) ─────────────────────────────────────────────
  "action-required": {
    label: "Action Required",
    description: "Unified priority alerts",
    category: "alerts",
    tags: ["essential"],
    icon: "AlertCircle",
    supportedSizes: ["xs", "sm", "md", "lg"],
    defaultSize: "md",
    configSchema: [],
    allowMultiple: false,
    requiredPermission: "tasks.view",
  },
  "activity-feed": {
    label: "Activity Feed",
    description: "Recent activity across entities",
    category: "alerts",
    tags: ["office"],
    icon: "Activity",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [
      {
        key: "entityFilter",
        label: "Filter",
        type: "select",
        options: [
          { value: "all", label: "All" },
          { value: "projects", label: "Projects" },
          { value: "opportunities", label: "Opportunities" },
          { value: "invoices", label: "Invoices" },
        ],
        defaultValue: "all",
      },
    ],
  },
  notifications: {
    label: "Notifications",
    description: "System event notifications",
    category: "alerts",
    tags: ["essential"],
    icon: "Bell",
    supportedSizes: ["md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [
      {
        key: "sortBy",
        label: "Sort",
        type: "select",
        options: [
          { value: "recent", label: "Recent" },
          { value: "priority", label: "Priority" },
          { value: "type", label: "Type" },
        ],
        defaultValue: "recent",
      },
    ],
  },

  // ── PIPELINE DETAIL (2) ───────────────────────────────────────────────
  "pipeline-list": {
    label: "Pipeline List",
    description: "Opportunities list by stage",
    category: "pipeline",
    tags: ["pipeline"],
    icon: "List",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
    allowMultiple: true,
    configSchema: [
      {
        key: "stageFilter",
        label: "Stage",
        type: "select",
        options: [
          { value: "all-active", label: "All Active" },
          { value: "new_lead", label: "New Lead" },
          { value: "contacted", label: "Contacted" },
          { value: "qualified", label: "Qualified" },
          { value: "proposal_sent", label: "Proposal Sent" },
          { value: "negotiation", label: "Negotiation" },
        ],
        defaultValue: "all-active",
      },
    ],
    requiredPermission: "pipeline.view",
  },
  "lead-sources": {
    label: "Lead Sources",
    description: "Lead source distribution",
    category: "pipeline",
    tags: ["pipeline"],
    icon: "Radio",
    supportedSizes: ["xs", "sm", "md", "lg"],
    defaultSize: "md",
    configSchema: [],
    allowMultiple: false,
    requiredPermission: "pipeline.view",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All widget type IDs in a display-friendly order */
export const ALL_WIDGET_TYPE_IDS: WidgetTypeId[] = Object.keys(
  WIDGET_TYPE_REGISTRY
) as WidgetTypeId[];

/** Generate a unique instance ID */
export function generateInstanceId(): string {
  return `wi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Get the default config for a widget type based on its schema */
export function getDefaultConfig(typeId: WidgetTypeId): Record<string, unknown> {
  const entry = WIDGET_TYPE_REGISTRY[typeId];
  if (!entry) return {};
  const config: Record<string, unknown> = {};
  for (const field of entry.configSchema) {
    config[field.key] = field.defaultValue;
  }
  return config;
}

/** Create a new WidgetInstance from a type ID with optional config overrides */
export function createWidgetInstance(
  typeId: WidgetTypeId,
  configOverrides?: Record<string, unknown>,
  sizeOverride?: WidgetSize
): WidgetInstance {
  const entry = WIDGET_TYPE_REGISTRY[typeId];
  return {
    id: generateInstanceId(),
    typeId,
    size: sizeOverride ?? entry.defaultSize,
    visible: true,
    config: { ...getDefaultConfig(typeId), ...configOverrides },
  };
}
