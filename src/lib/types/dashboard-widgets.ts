// ---------------------------------------------------------------------------
// Dashboard Widget System — Type Definitions & Registry (v3 — Multi-Instance)
// ---------------------------------------------------------------------------

export type WidgetSize = "xs" | "sm" | "md" | "lg" | "full";

// ---------------------------------------------------------------------------
// Categories & Tags
// ---------------------------------------------------------------------------

export type WidgetCategory =
  | "stats"
  | "schedule"
  | "financial"
  | "pipeline"
  | "team"
  | "clients"
  | "estimates"
  | "alerts"
  | "activity";

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
  // Stats — generic (9)
  | "stat-projects"
  | "stat-tasks"
  | "stat-events"
  | "stat-clients"
  | "stat-team"
  | "stat-revenue"
  | "stat-invoices"
  | "stat-estimates"
  | "stat-opportunities"
  // Stats — per-status projects (5)
  | "stat-projects-rfq"
  | "stat-projects-estimated"
  | "stat-projects-accepted"
  | "stat-projects-in-progress"
  | "stat-projects-completed"
  // Stats — per-status tasks (4)
  | "stat-tasks-booked"
  | "stat-tasks-in-progress"
  | "stat-tasks-completed"
  | "stat-tasks-overdue"
  // Stats — client segment (1)
  | "stat-clients-active"
  // Stats — financial (4)
  | "stat-receivables"
  | "stat-collect"
  | "stat-profit-mtd"
  | "stat-projected-profit"
  // Stats — ranking (2)
  | "stat-client-ranking"
  | "stat-project-ranking"
  // Schedule (2)
  | "calendar"
  | "task-list"
  // Financial (5)
  | "revenue-chart"
  | "invoice-list"
  | "invoice-aging"
  | "payments-recent"
  | "expense-summary"
  // Pipeline (5)
  | "pipeline-funnel"
  | "pipeline-list"
  | "pipeline-value"
  | "pipeline-velocity"
  | "pipeline-sources"
  // Team (2)
  | "crew-status"
  | "crew-locations"
  // Estimates (2)
  | "estimates-overview"
  | "estimates-funnel"
  // Clients (4)
  | "client-list"
  | "client-revenue"
  | "client-activity"
  | "client-attention"
  // Activity (3)
  | "activity-feed"
  | "follow-ups-due"
  | "site-visits"
  // Alerts (4)
  | "action-bar"
  | "overdue-tasks"
  | "past-due-invoices"
  | "notifications";

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
  md: { colSpan: 4, rowSpan: 1 },
  lg: { colSpan: 4, rowSpan: 2 },
  full: { colSpan: 8, rowSpan: 1 },
};

export const WIDGET_SIZE_LABELS: Record<WidgetSize, string> = {
  xs: "XS",
  sm: "S",
  md: "M",
  lg: "L",
  full: "XL",
};

export const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  stats: "Statistics",
  schedule: "Schedule",
  financial: "Financial",
  pipeline: "Pipeline",
  team: "Team / Crew",
  clients: "Clients",
  estimates: "Estimates",
  alerts: "Alerts",
  activity: "Activity",
};

// ---------------------------------------------------------------------------
// Category display order for sidebar
// ---------------------------------------------------------------------------
export const CATEGORY_ORDER: WidgetCategory[] = [
  "stats",
  "schedule",
  "financial",
  "pipeline",
  "team",
  "estimates",
  "clients",
  "activity",
  "alerts",
];

// ---------------------------------------------------------------------------
// Full Widget Type Registry — 36 widget types
// ---------------------------------------------------------------------------

export const WIDGET_TYPE_REGISTRY: Record<WidgetTypeId, WidgetTypeEntry> = {
  // ── STATISTICS (9) ──────────────────────────────────────────────────────
  "stat-projects": {
    label: "Active Projects",
    description: "Count of active projects",
    category: "stats",
    tags: ["essential", "office"],
    icon: "FolderKanban",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: true,
    configSchema: [
      {
        key: "statusFilter",
        label: "Status",
        type: "select",
        options: [
          { value: "all", label: "All Active" },
          { value: "rfq", label: "RFQ" },
          { value: "estimated", label: "Estimated" },
          { value: "accepted", label: "Accepted" },
          { value: "in_progress", label: "In Progress" },
          { value: "completed", label: "Completed" },
        ],
        defaultValue: "all",
      },
    ],
  },
  "stat-tasks": {
    label: "Task Count",
    description: "Count of tasks by filter",
    category: "stats",
    tags: ["essential", "scheduling"],
    icon: "ClipboardCheck",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: true,
    configSchema: [
      {
        key: "filter",
        label: "Filter",
        type: "select",
        options: [
          { value: "due-today", label: "Due Today" },
          { value: "due-this-week", label: "Due This Week" },
          { value: "overdue", label: "Overdue" },
          { value: "in-progress", label: "In Progress" },
          { value: "all-open", label: "All Open" },
        ],
        defaultValue: "due-today",
      },
    ],
  },
  "stat-events": {
    label: "Event Count",
    description: "Count of calendar events",
    category: "stats",
    tags: ["essential", "scheduling"],
    icon: "CalendarDays",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: true,
    configSchema: [
      {
        key: "range",
        label: "Range",
        type: "select",
        options: [
          { value: "today", label: "Today" },
          { value: "this-week", label: "This Week" },
          { value: "this-month", label: "This Month" },
        ],
        defaultValue: "this-week",
      },
    ],
  },
  "stat-clients": {
    label: "Client Count",
    description: "Total client count",
    category: "stats",
    tags: ["essential", "clients"],
    icon: "Users",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: true,
    configSchema: [
      {
        key: "filter",
        label: "Filter",
        type: "select",
        options: [
          { value: "all", label: "All Clients" },
          { value: "active", label: "Active (has project)" },
        ],
        defaultValue: "all",
      },
    ],
  },
  "stat-team": {
    label: "Team Count",
    description: "Number of team members",
    category: "stats",
    tags: ["essential", "field-ops"],
    icon: "UserCheck",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: true,
    configSchema: [
      {
        key: "filter",
        label: "Filter",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "all", label: "All" },
        ],
        defaultValue: "active",
      },
    ],
  },
  "stat-revenue": {
    label: "Revenue",
    description: "Revenue metric",
    category: "stats",
    tags: ["finance"],
    icon: "DollarSign",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: true,
    configSchema: [
      {
        key: "metric",
        label: "Metric",
        type: "select",
        options: [
          { value: "mtd-invoiced", label: "MTD Invoiced" },
          { value: "mtd-collected", label: "MTD Collected" },
          { value: "outstanding", label: "Outstanding" },
          { value: "ytd", label: "Year to Date" },
        ],
        defaultValue: "mtd-invoiced",
      },
    ],
  },
  "stat-invoices": {
    label: "Invoice Count",
    description: "Count of invoices by status",
    category: "stats",
    tags: ["finance"],
    icon: "FileText",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
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
  },
  "stat-estimates": {
    label: "Estimate Count",
    description: "Count of estimates by status",
    category: "stats",
    tags: ["estimates"],
    icon: "Calculator",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
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
          { value: "approved", label: "Approved" },
        ],
        defaultValue: "all-open",
      },
    ],
  },
  "stat-opportunities": {
    label: "Opportunity Count",
    description: "Count of opportunities by stage",
    category: "stats",
    tags: ["pipeline"],
    icon: "Target",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
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
      {
        key: "metric",
        label: "Show",
        type: "select",
        options: [
          { value: "count", label: "Count" },
          { value: "value", label: "Total Value" },
        ],
        defaultValue: "count",
      },
    ],
  },

  // ── STATISTICS — Per-Status Projects (5) ────────────────────────────────
  "stat-projects-rfq": {
    label: "RFQ Projects",
    description: "Projects in RFQ status",
    category: "stats",
    tags: ["essential", "office"],
    icon: "FolderKanban",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },
  "stat-projects-estimated": {
    label: "Estimated Projects",
    description: "Projects in Estimated status",
    category: "stats",
    tags: ["essential", "office"],
    icon: "FolderKanban",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },
  "stat-projects-accepted": {
    label: "Accepted Projects",
    description: "Projects in Accepted status",
    category: "stats",
    tags: ["essential", "office"],
    icon: "FolderKanban",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },
  "stat-projects-in-progress": {
    label: "In Progress Projects",
    description: "Projects currently in progress",
    category: "stats",
    tags: ["essential", "office"],
    icon: "FolderKanban",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },
  "stat-projects-completed": {
    label: "Completed Projects",
    description: "Projects that are completed",
    category: "stats",
    tags: ["essential", "office"],
    icon: "FolderKanban",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },

  // ── STATISTICS — Per-Status Tasks (4) ──────────────────────────────────
  "stat-tasks-booked": {
    label: "Booked Tasks",
    description: "Tasks in Booked status",
    category: "stats",
    tags: ["essential", "scheduling"],
    icon: "ClipboardCheck",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },
  "stat-tasks-in-progress": {
    label: "In Progress Tasks",
    description: "Tasks currently in progress",
    category: "stats",
    tags: ["essential", "scheduling"],
    icon: "ClipboardCheck",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },
  "stat-tasks-completed": {
    label: "Completed Tasks",
    description: "Tasks that are completed",
    category: "stats",
    tags: ["essential", "scheduling"],
    icon: "ClipboardCheck",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },
  "stat-tasks-overdue": {
    label: "Overdue Tasks",
    description: "Tasks past their due date",
    category: "stats",
    tags: ["essential", "scheduling"],
    icon: "ClipboardCheck",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },

  // ── STATISTICS — Client Segment (1) ────────────────────────────────────
  "stat-clients-active": {
    label: "Active Clients",
    description: "Clients with active projects",
    category: "stats",
    tags: ["essential", "clients"],
    icon: "Users",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },

  // ── STATISTICS — Financial (2) ─────────────────────────────────────────
  "stat-receivables": {
    label: "Receivables",
    description: "Total outstanding balance due",
    category: "stats",
    tags: ["finance"],
    icon: "DollarSign",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },
  "stat-collect": {
    label: "To Collect",
    description: "Balance due on completed projects",
    category: "stats",
    tags: ["finance"],
    icon: "DollarSign",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },
  "stat-profit-mtd": {
    label: "Profit MTD",
    description: "Month-to-date profit (revenue minus costs)",
    category: "financial",
    tags: ["finance"],
    icon: "DollarSign",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },
  "stat-projected-profit": {
    label: "Projected Profit",
    description: "Expected profit on open invoices",
    category: "financial",
    tags: ["finance"],
    icon: "DollarSign",
    supportedSizes: ["xs", "sm"],
    defaultSize: "xs",
    allowMultiple: false,
    configSchema: [],
  },

  // ── STATISTICS — Ranking (2) ───────────────────────────────────────────
  "stat-client-ranking": {
    label: "Client Ranking",
    description: "Top clients by invoice metric",
    category: "stats",
    tags: ["clients", "finance"],
    icon: "Trophy",
    supportedSizes: ["xs", "sm", "md"],
    defaultSize: "sm",
    allowMultiple: false,
    configSchema: [
      {
        key: "metric",
        label: "Metric",
        type: "select",
        options: [
          { value: "outstanding", label: "Outstanding" },
          { value: "collected", label: "Collected" },
          { value: "invoiced", label: "Invoiced" },
        ],
        defaultValue: "outstanding",
      },
    ],
  },
  "stat-project-ranking": {
    label: "Project Ranking",
    description: "Top projects by invoice metric",
    category: "stats",
    tags: ["essential", "finance"],
    icon: "Trophy",
    supportedSizes: ["xs", "sm", "md"],
    defaultSize: "sm",
    allowMultiple: false,
    configSchema: [
      {
        key: "metric",
        label: "Metric",
        type: "select",
        options: [
          { value: "outstanding", label: "Outstanding" },
          { value: "collected", label: "Collected" },
          { value: "invoiced", label: "Invoiced" },
        ],
        defaultValue: "outstanding",
      },
    ],
  },

  // ── SCHEDULE (2) ────────────────────────────────────────────────────────
  calendar: {
    label: "Calendar",
    description: "Calendar overview with events",
    category: "schedule",
    tags: ["essential", "scheduling"],
    icon: "CalendarDays",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },
  "task-list": {
    label: "Task List",
    description: "Tasks with one-click complete",
    category: "schedule",
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
  },

  // ── FINANCIAL (5) ───────────────────────────────────────────────────────
  "revenue-chart": {
    label: "Revenue Chart",
    description: "Monthly revenue bar chart",
    category: "financial",
    tags: ["finance", "office"],
    icon: "TrendingUp",
    supportedSizes: ["md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
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
        defaultValue: "6mo",
      },
    ],
  },
  "invoice-list": {
    label: "Invoice List",
    description: "Invoices with one-click send",
    category: "financial",
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
  },
  "invoice-aging": {
    label: "Invoice Aging",
    description: "Invoices grouped by days overdue",
    category: "financial",
    tags: ["finance"],
    icon: "Clock",
    supportedSizes: ["md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },
  "payments-recent": {
    label: "Recent Payments",
    description: "Recently received payments",
    category: "financial",
    tags: ["finance"],
    icon: "CreditCard",
    supportedSizes: ["sm", "md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },
  "expense-summary": {
    label: "Expense Summary",
    description: "Expense breakdown by category",
    category: "financial",
    tags: ["finance"],
    icon: "Receipt",
    supportedSizes: ["md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
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
  },

  // ── PIPELINE (5) ────────────────────────────────────────────────────────
  "pipeline-funnel": {
    label: "Pipeline Funnel",
    description: "Visual funnel of opportunity stages",
    category: "pipeline",
    tags: ["pipeline", "office"],
    icon: "GitBranch",
    supportedSizes: ["md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },
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
  },
  "pipeline-value": {
    label: "Pipeline Value",
    description: "Weighted values by stage",
    category: "pipeline",
    tags: ["pipeline", "office"],
    icon: "BarChart3",
    supportedSizes: ["md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },
  "pipeline-velocity": {
    label: "Pipeline Velocity",
    description: "Avg days per stage, conversion rates",
    category: "pipeline",
    tags: ["pipeline"],
    icon: "Gauge",
    supportedSizes: ["md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },
  "pipeline-sources": {
    label: "Lead Sources",
    description: "Where opportunities come from",
    category: "pipeline",
    tags: ["pipeline"],
    icon: "PieChart",
    supportedSizes: ["md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },

  // ── TEAM / CREW (2) ────────────────────────────────────────────────────
  "crew-status": {
    label: "Crew Status",
    description: "Team member status and availability",
    category: "team",
    tags: ["essential", "field-ops"],
    icon: "Users",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },
  "crew-locations": {
    label: "Crew Locations",
    description: "Team member locations and assignments",
    category: "team",
    tags: ["field-ops"],
    icon: "MapPin",
    supportedSizes: ["md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },

  // ── ESTIMATES (2) ───────────────────────────────────────────────────────
  "estimates-overview": {
    label: "Estimates Overview",
    description: "Estimates list with one-click send",
    category: "estimates",
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
  },
  "estimates-funnel": {
    label: "Estimate Conversion",
    description: "Estimate status flow funnel",
    category: "estimates",
    tags: ["estimates", "pipeline"],
    icon: "Filter",
    supportedSizes: ["md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },

  // ── CLIENTS (4) ─────────────────────────────────────────────────────────
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
  },
  "client-revenue": {
    label: "Client Revenue",
    description: "Top clients by revenue",
    category: "clients",
    tags: ["clients", "finance"],
    icon: "TrendingUp",
    supportedSizes: ["md", "lg"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [
      {
        key: "period",
        label: "Period",
        type: "select",
        options: [
          { value: "all-time", label: "All Time" },
          { value: "ytd", label: "Year to Date" },
          { value: "this-month", label: "This Month" },
        ],
        defaultValue: "all-time",
      },
    ],
  },
  "client-activity": {
    label: "Client Activity",
    description: "Recent client interactions",
    category: "clients",
    tags: ["clients"],
    icon: "MessageSquare",
    supportedSizes: ["sm", "md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
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
  },

  // ── ACTIVITY & FOLLOW-UPS (3) ──────────────────────────────────────────
  "activity-feed": {
    label: "Activity Feed",
    description: "Recent activity across entities",
    category: "activity",
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
  "follow-ups-due": {
    label: "Follow-ups Due",
    description: "Overdue and upcoming follow-ups",
    category: "activity",
    tags: ["pipeline", "office"],
    icon: "Bell",
    supportedSizes: ["sm", "md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },
  "site-visits": {
    label: "Site Visits",
    description: "Upcoming and recent site visits",
    category: "activity",
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
  },

  // ── ALERTS & NOTIFICATIONS (4) ─────────────────────────────────────────
  "action-bar": {
    label: "Action Items",
    description: "Aggregated action items banner",
    category: "alerts",
    tags: ["essential"],
    icon: "AlertTriangle",
    supportedSizes: ["full"],
    defaultSize: "full",
    allowMultiple: false,
    configSchema: [],
  },
  "overdue-tasks": {
    label: "Overdue Tasks",
    description: "Tasks past due with one-click complete",
    category: "alerts",
    tags: ["essential", "scheduling"],
    icon: "AlertCircle",
    supportedSizes: ["sm", "md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
  },
  "past-due-invoices": {
    label: "Past Due Invoices",
    description: "Overdue invoices with send reminder",
    category: "alerts",
    tags: ["finance"],
    icon: "AlertTriangle",
    supportedSizes: ["sm", "md"],
    defaultSize: "md",
    allowMultiple: false,
    configSchema: [],
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
