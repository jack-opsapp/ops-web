// ---------------------------------------------------------------------------
// Dashboard Widget System — Type Definitions & Registry
// ---------------------------------------------------------------------------

export type WidgetSize = "sm" | "md" | "lg" | "full";

export interface WidgetConfig {
  size: WidgetSize;
  visible: boolean;
}

export type DashboardWidgetId =
  | "stats"
  | "calendar"
  | "crew"
  | "tasks"
  | "activity"
  | "pipeline"
  | "revenue"
  | "alerts";

export interface WidgetRegistryEntry {
  label: string;
  supportedSizes: WidgetSize[];
  defaultSize: WidgetSize;
}

export const WIDGET_REGISTRY: Record<DashboardWidgetId, WidgetRegistryEntry> = {
  stats: {
    label: "Stats Overview",
    supportedSizes: ["md", "full"],
    defaultSize: "full",
  },
  calendar: {
    label: "Calendar",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
  },
  crew: {
    label: "Crew Status",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
  },
  tasks: {
    label: "Upcoming Tasks",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
  },
  activity: {
    label: "Recent Activity",
    supportedSizes: ["md"],
    defaultSize: "md",
  },
  pipeline: {
    label: "Pipeline",
    supportedSizes: ["sm", "md", "lg"],
    defaultSize: "md",
  },
  revenue: {
    label: "Revenue Chart",
    supportedSizes: ["sm", "md"],
    defaultSize: "md",
  },
  alerts: {
    label: "System Alerts",
    supportedSizes: ["full"],
    defaultSize: "full",
  },
};

/** Controls the auto-flow order of widgets in the grid */
export const WIDGET_RENDER_ORDER: DashboardWidgetId[] = [
  "stats",
  "calendar",
  "crew",
  "tasks",
  "activity",
  "pipeline",
  "revenue",
  "alerts",
];

/** Maps widget sizes to CSS grid col/row spans */
export const WIDGET_SIZE_GRID_SPANS: Record<
  WidgetSize,
  { colSpan: number; rowSpan: number }
> = {
  sm: { colSpan: 1, rowSpan: 1 },
  md: { colSpan: 2, rowSpan: 1 },
  lg: { colSpan: 2, rowSpan: 2 },
  full: { colSpan: 4, rowSpan: 1 },
};

export const WIDGET_SIZE_LABELS: Record<WidgetSize, string> = {
  sm: "S",
  md: "M",
  lg: "L",
  full: "XL",
};

export const DEFAULT_WIDGET_CONFIGS: Record<DashboardWidgetId, WidgetConfig> =
  Object.fromEntries(
    Object.entries(WIDGET_REGISTRY).map(([id, entry]) => [
      id,
      { size: entry.defaultSize, visible: true },
    ])
  ) as Record<DashboardWidgetId, WidgetConfig>;
