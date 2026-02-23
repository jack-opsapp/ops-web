"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type DashboardWidgetId,
  type WidgetConfig,
  type WidgetSize,
  DEFAULT_WIDGET_CONFIGS,
  WIDGET_REGISTRY,
} from "@/lib/types/dashboard-widgets";

// Re-export for consumers that imported from here
export type { DashboardWidgetId } from "@/lib/types/dashboard-widgets";

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

  // Widget configs (v2 — replaces visibleWidgets)
  widgetConfigs: Record<DashboardWidgetId, WidgetConfig>;
  setWidgetSize: (id: DashboardWidgetId, size: WidgetSize) => void;
  setWidgetVisible: (id: DashboardWidgetId, visible: boolean) => void;
  resetWidgetConfigs: () => void;

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

      // Widget configs
      widgetConfigs: { ...DEFAULT_WIDGET_CONFIGS },
      setWidgetSize: (id, size) =>
        set((state) => {
          const entry = WIDGET_REGISTRY[id];
          if (!entry || !entry.supportedSizes.includes(size)) return state;
          return {
            widgetConfigs: {
              ...state.widgetConfigs,
              [id]: { ...state.widgetConfigs[id], size },
            },
          };
        }),
      setWidgetVisible: (id, visible) =>
        set((state) => ({
          widgetConfigs: {
            ...state.widgetConfigs,
            [id]: { ...state.widgetConfigs[id], visible },
          },
        })),
      resetWidgetConfigs: () => set({ widgetConfigs: { ...DEFAULT_WIDGET_CONFIGS } }),

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
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown> | null;

        // Migrate v1 (visibleWidgets array) → v2 (widgetConfigs map)
        if (version < 2 && state && "visibleWidgets" in state) {
          const oldVisible = state.visibleWidgets as string[];
          const configs = { ...DEFAULT_WIDGET_CONFIGS };

          // Preserve visibility from old format
          for (const id of Object.keys(configs) as DashboardWidgetId[]) {
            configs[id] = {
              ...configs[id],
              visible: oldVisible.includes(id),
            };
          }

          // Remove old keys
          const { visibleWidgets: _, ...rest } = state;
          return { ...rest, widgetConfigs: configs };
        }

        return state as Record<string, unknown>;
      },
    }
  )
);
