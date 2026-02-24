"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type WidgetTypeId,
  type WidgetInstance,
  type WidgetSize,
  WIDGET_TYPE_REGISTRY,
  createWidgetInstance,
} from "@/lib/types/dashboard-widgets";

export type AccentColorId = "steel-blue" | "amber-gold" | "emerald" | "violet" | "rose" | "cyan";
export type FontSizeId = "small" | "default" | "large";
export type DashboardLayoutId = "default" | "compact" | "data-dense";
export type SchedulingTypeId = "all-day" | "time-slots" | "both";

export const ACCENT_COLOR_VALUES: Record<AccentColorId, string> = {
  "steel-blue": "#417394",
  "amber-gold": "#C4A868",
  "emerald": "#10B981",
  "violet": "#8B5CF6",
  "rose": "#F43F5E",
  "cyan": "#06B6D4",
};

export const FONT_SIZE_SCALES: Record<FontSizeId, number> = {
  small: 0.9,
  default: 1,
  large: 1.1,
};

export const DEFAULT_NOTIFICATION_PREFS: Record<string, boolean> = {
  "Task assignments": true,
  "Project updates": true,
  "Team activity": true,
  "Sync alerts": false,
  "Client messages": true,
  "Schedule changes": true,
  "Invoice reminders": false,
  "Pipeline movement": true,
};

// ---------------------------------------------------------------------------
// Default widget instances — shown for new users / reset
// ---------------------------------------------------------------------------
const DEFAULT_WIDGET_INSTANCES: WidgetInstance[] = [
  createWidgetInstance("stat-projects", { statusFilter: "all" }),
  createWidgetInstance("stat-tasks", { filter: "due-today" }),
  createWidgetInstance("stat-events", { range: "this-week" }),
  createWidgetInstance("stat-clients", { filter: "all" }),
  createWidgetInstance("stat-team", { filter: "active" }),
  createWidgetInstance("stat-revenue", { metric: "mtd-invoiced" }),
  createWidgetInstance("calendar"),
  createWidgetInstance("task-list", { filter: "upcoming" }),
  createWidgetInstance("crew-status"),
  createWidgetInstance("pipeline-funnel"),
  createWidgetInstance("revenue-chart", { period: "6mo" }),
  createWidgetInstance("activity-feed", { entityFilter: "all" }),
  createWidgetInstance("action-bar"),
];

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------
interface PreferencesState {
  // Keyboard shortcuts
  showShortcutHints: boolean;
  setShowShortcutHints: (show: boolean) => void;
  toggleShortcutHints: () => void;

  // Appearance
  accentColor: AccentColorId;
  fontSize: FontSizeId;
  compactMode: boolean;
  setAccentColor: (color: AccentColorId) => void;
  setFontSize: (size: FontSizeId) => void;
  setCompactMode: (compact: boolean) => void;

  // Dashboard
  dashboardLayout: DashboardLayoutId;
  setDashboardLayout: (layout: DashboardLayoutId) => void;

  // Widget instances (v5 — multi-instance system)
  widgetInstances: WidgetInstance[];
  addWidgetInstance: (typeId: WidgetTypeId, config?: Record<string, unknown>) => void;
  removeWidgetInstance: (instanceId: string) => void;
  updateWidgetInstance: (instanceId: string, updates: Partial<Pick<WidgetInstance, "size" | "visible" | "config">>) => void;
  reorderWidgetInstances: (newOrder: string[]) => void;
  resetWidgetInstances: () => void;
  applyWidgetInstances: (instances: WidgetInstance[]) => void;

  // Scheduling
  schedulingType: SchedulingTypeId;
  setSchedulingType: (type: SchedulingTypeId) => void;

  // Notifications
  notificationPrefs: Record<string, boolean>;
  setNotificationPref: (key: string, enabled: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      showShortcutHints: false,
      setShowShortcutHints: (show) => set({ showShortcutHints: show }),
      toggleShortcutHints: () =>
        set((state) => ({ showShortcutHints: !state.showShortcutHints })),

      accentColor: "steel-blue",
      fontSize: "default",
      compactMode: false,
      setAccentColor: (color) => set({ accentColor: color }),
      setFontSize: (size) => set({ fontSize: size }),
      setCompactMode: (compact) => set({ compactMode: compact }),

      dashboardLayout: "default",
      setDashboardLayout: (layout) => set({ dashboardLayout: layout }),

      // Widget instances
      widgetInstances: DEFAULT_WIDGET_INSTANCES.map((inst) => ({ ...inst })),

      addWidgetInstance: (typeId, config) =>
        set((state) => {
          const entry = WIDGET_TYPE_REGISTRY[typeId];
          if (!entry) return state;

          // Check if single-instance and already exists
          if (!entry.allowMultiple) {
            const existing = state.widgetInstances.find((i) => i.typeId === typeId);
            if (existing) return state;
          }

          const instance = createWidgetInstance(typeId, config);
          return { widgetInstances: [...state.widgetInstances, instance] };
        }),

      removeWidgetInstance: (instanceId) =>
        set((state) => ({
          widgetInstances: state.widgetInstances.filter((i) => i.id !== instanceId),
        })),

      updateWidgetInstance: (instanceId, updates) =>
        set((state) => {
          const idx = state.widgetInstances.findIndex((i) => i.id === instanceId);
          if (idx === -1) return state;

          const instance = state.widgetInstances[idx];
          const entry = WIDGET_TYPE_REGISTRY[instance.typeId];

          // Validate size if being updated
          if (updates.size && entry && !entry.supportedSizes.includes(updates.size)) {
            return state;
          }

          const updated = [...state.widgetInstances];
          updated[idx] = {
            ...instance,
            ...updates,
            config: updates.config
              ? { ...instance.config, ...updates.config }
              : instance.config,
          };
          return { widgetInstances: updated };
        }),

      reorderWidgetInstances: (newOrder) =>
        set((state) => {
          const idMap = new Map(state.widgetInstances.map((i) => [i.id, i]));
          const reordered: WidgetInstance[] = [];
          for (const id of newOrder) {
            const inst = idMap.get(id);
            if (inst) reordered.push(inst);
          }
          // Append any instances not in newOrder (shouldn't happen, but safe)
          for (const inst of state.widgetInstances) {
            if (!newOrder.includes(inst.id)) reordered.push(inst);
          }
          return { widgetInstances: reordered };
        }),

      resetWidgetInstances: () =>
        set({ widgetInstances: DEFAULT_WIDGET_INSTANCES.map((inst) => ({ ...inst, id: createWidgetInstance(inst.typeId, inst.config).id })) }),

      applyWidgetInstances: (instances) => set({ widgetInstances: instances }),

      schedulingType: "both",
      setSchedulingType: (type) => set({ schedulingType: type }),

      notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
      setNotificationPref: (key, enabled) =>
        set((state) => ({
          notificationPrefs: { ...state.notificationPrefs, [key]: enabled },
        })),
    }),
    {
      name: "ops-preferences",
      version: 5,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown> | null;
        if (!state) return {} as Record<string, unknown>;

        // ── v1-v4 → v5: Convert old widgetConfigs/widgetOrder to widgetInstances ──
        if (version < 5) {
          // Old v4 schema had widgetConfigs (Record<string, {size, visible}>) + widgetOrder (string[])
          const oldConfigs = state.widgetConfigs as Record<string, { size: WidgetSize; visible: boolean }> | undefined;
          const oldOrder = state.widgetOrder as string[] | undefined;

          if (oldConfigs && oldOrder) {
            // Map old fixed IDs to new type IDs
            const OLD_TO_NEW: Record<string, { typeId: WidgetTypeId; config?: Record<string, unknown> }> = {
              "stat-active-projects": { typeId: "stat-projects", config: { statusFilter: "all" } },
              "stat-weekly-events": { typeId: "stat-events", config: { range: "this-week" } },
              "stat-total-clients": { typeId: "stat-clients", config: { filter: "all" } },
              "stat-revenue-mtd": { typeId: "stat-revenue", config: { metric: "mtd-invoiced" } },
              "stat-team-active": { typeId: "stat-team", config: { filter: "active" } },
              "stat-tasks-due": { typeId: "stat-tasks", config: { filter: "due-today" } },
              calendar: { typeId: "calendar" },
              tasks: { typeId: "task-list", config: { filter: "upcoming" } },
              crew: { typeId: "crew-status" },
              pipeline: { typeId: "pipeline-funnel" },
              revenue: { typeId: "revenue-chart", config: { period: "6mo" } },
              activity: { typeId: "activity-feed", config: { entityFilter: "all" } },
              alerts: { typeId: "action-bar" },
            };

            const instances: WidgetInstance[] = [];
            for (const oldId of oldOrder) {
              const mapping = OLD_TO_NEW[oldId];
              const oldCfg = oldConfigs[oldId];
              if (!mapping || !oldCfg) continue;

              instances.push({
                ...createWidgetInstance(mapping.typeId, mapping.config),
                size: oldCfg.size,
                visible: oldCfg.visible,
              });
            }

            // Clean up old keys
            delete state.widgetConfigs;
            delete state.widgetOrder;

            (state as Record<string, unknown>).widgetInstances = instances;
          } else {
            // No old data — use defaults
            (state as Record<string, unknown>).widgetInstances =
              DEFAULT_WIDGET_INSTANCES.map((inst) => ({ ...inst }));
          }
        }

        return state as Record<string, unknown>;
      },
    }
  )
);
