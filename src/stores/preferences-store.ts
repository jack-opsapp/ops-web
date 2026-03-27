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
import {
  type AccentColorId,
  ACCENT_COLOR_VALUES,
  ACCENT_ID_MIGRATION,
} from "@/lib/data/curated-colors";

// Re-export so existing consumers don't break
export type { AccentColorId };
export { ACCENT_COLOR_VALUES };

export type FontSizeId = "small" | "default" | "large";
export type DashboardLayoutId = "default" | "compact" | "data-dense";
export type SchedulingTypeId = "all-day" | "time-slots" | "both";
export type WidgetGapId = "none" | "tight" | "normal" | "relaxed";

export const FONT_SIZE_SCALES: Record<FontSizeId, number> = {
  small: 0.9,
  default: 1,
  large: 1.1,
};

/** Pixel values for each widget gap level */
export const WIDGET_GAP_VALUES: Record<WidgetGapId, number> = {
  none: 0,
  tight: 4,
  normal: 8,
  relaxed: 16,
};

// ---------------------------------------------------------------------------
// Default widget instances — shown for new users / reset
// ---------------------------------------------------------------------------
const DEFAULT_WIDGET_INSTANCES: WidgetInstance[] = [
  createWidgetInstance("revenue-pulse", { period: "ytd" }, "sm"),
  createWidgetInstance("profit-gauge", { period: "mtd" }, "xs"),
  createWidgetInstance("win-rate", { period: "90d" }, "xs"),
  createWidgetInstance("backlog-depth", {}, "xs"),
  createWidgetInstance("pipeline-funnel", {}, "md"),
  createWidgetInstance("receivables-aging", {}, "md"),
  createWidgetInstance("task-pulse", {}, "sm"),
  createWidgetInstance("crew-board", {}, "md"),
  createWidgetInstance("action-required", {}, "md"),
  createWidgetInstance("activity-feed", { entityFilter: "all" }, "sm"),
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
  widgetGap: WidgetGapId;
  setWidgetGap: (gap: WidgetGapId) => void;

  // Widget instances (v5 — multi-instance system)
  widgetInstances: WidgetInstance[];
  addWidgetInstance: (typeId: WidgetTypeId, config?: Record<string, unknown>) => void;
  addWidgetInstanceAt: (typeId: WidgetTypeId, beforeInstanceId: string, config?: Record<string, unknown>) => void;
  removeWidgetInstance: (instanceId: string) => void;
  updateWidgetInstance: (instanceId: string, updates: Partial<Pick<WidgetInstance, "size" | "visible" | "config">>) => void;
  reorderWidgetInstances: (newOrder: string[]) => void;
  resetWidgetInstances: () => void;
  applyWidgetInstances: (instances: WidgetInstance[]) => void;

  // Scheduling
  schedulingType: SchedulingTypeId;
  setSchedulingType: (type: SchedulingTypeId) => void;

  // Map
  mapDefaultZoom: number;
  mapDefaultCenter: { lat: number; lng: number } | null;
  mapShowTraffic: boolean;
  mapShowCrewLabels: boolean;
  setMapDefaultZoom: (zoom: number) => void;
  setMapDefaultCenter: (center: { lat: number; lng: number } | null) => void;
  setMapShowTraffic: (show: boolean) => void;
  setMapShowCrewLabels: (show: boolean) => void;
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
      widgetGap: "normal",
      setWidgetGap: (gap) => set({ widgetGap: gap }),

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

      addWidgetInstanceAt: (typeId, beforeInstanceId, config) =>
        set((state) => {
          const entry = WIDGET_TYPE_REGISTRY[typeId];
          if (!entry) return state;

          if (!entry.allowMultiple) {
            const existing = state.widgetInstances.find((i) => i.typeId === typeId);
            if (existing) return state;
          }

          const instance = createWidgetInstance(typeId, config);
          const idx = state.widgetInstances.findIndex((i) => i.id === beforeInstanceId);
          if (idx === -1) {
            return { widgetInstances: [...state.widgetInstances, instance] };
          }
          const updated = [...state.widgetInstances];
          updated.splice(idx, 0, instance);
          return { widgetInstances: updated };
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

      mapDefaultZoom: 12,
      mapDefaultCenter: null,
      mapShowTraffic: false,
      mapShowCrewLabels: true,
      setMapDefaultZoom: (zoom) => set({ mapDefaultZoom: zoom }),
      setMapDefaultCenter: (center) => set({ mapDefaultCenter: center }),
      setMapShowTraffic: (show) => set({ mapShowTraffic: show }),
      setMapShowCrewLabels: (show) => set({ mapShowCrewLabels: show }),
    }),
    {
      name: "ops-preferences",
      version: 14,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown> | null;
        if (!state) return {} as Record<string, unknown>;

        // ── Dashboard widget consolidation (unconditional) ────────────
        // Runs on EVERY migration regardless of version. Idempotent:
        // already-migrated widgets pass through unchanged.
        {
          const instances = state.widgetInstances as WidgetInstance[] | undefined;
          if (instances && Array.isArray(instances)) {
            // 1. Map renamed widget type IDs
            const RENAME_MAP: Record<string, string> = {
              "revenue-chart": "revenue-pulse",
              "invoice-aging": "receivables-aging",
              "expense-summary": "expense-tracker",
              "calendar": "todays-schedule",
              "crew-status": "crew-board",
              "pipeline-sources": "lead-sources",
            };

            // 2. Widget IDs that are removed entirely
            const REMOVED_IDS = new Set([
              "stat-projects", "stat-tasks", "stat-events", "stat-clients",
              "stat-team", "stat-revenue", "stat-invoices", "stat-estimates",
              "stat-opportunities", "stat-projects-rfq", "stat-projects-estimated",
              "stat-projects-accepted", "stat-projects-in-progress",
              "stat-projects-completed", "stat-tasks-booked",
              "stat-tasks-in-progress", "stat-tasks-completed",
              "stat-tasks-overdue", "stat-clients-active", "stat-receivables",
              "stat-collect", "stat-profit-mtd", "stat-projected-profit",
              "stat-client-ranking", "stat-project-ranking",
              "project-status-chart", "task-status-chart",
              "pipeline-value", "pipeline-velocity", "estimates-funnel",
              "client-revenue", "client-activity",
              "follow-ups-due", "overdue-tasks", "past-due-invoices",
            ]);

            // 3. Replacement widgets to inject if removed widgets were present
            const REPLACEMENT_MAP: Record<string, string> = {
              // Project stats → pipeline funnel
              "stat-projects": "pipeline-funnel",
              "stat-projects-rfq": "pipeline-funnel",
              "stat-projects-estimated": "pipeline-funnel",
              "stat-projects-accepted": "pipeline-funnel",
              "stat-projects-in-progress": "pipeline-funnel",
              "project-status-chart": "pipeline-funnel",
              // Task stats → task pulse
              "stat-tasks": "task-pulse",
              "stat-tasks-booked": "task-pulse",
              "stat-tasks-in-progress": "task-pulse",
              "stat-tasks-completed": "task-pulse",
              "stat-tasks-overdue": "task-pulse",
              "task-status-chart": "task-pulse",
              // Alert-type → action required
              "overdue-tasks": "action-required",
              "past-due-invoices": "action-required",
              "follow-ups-due": "action-required",
              // Financial stats → their visual replacements
              "stat-revenue": "revenue-pulse",
              "stat-invoices": "receivables-aging",
              "stat-receivables": "receivables-aging",
              "stat-collect": "receivables-aging",
              "stat-profit-mtd": "profit-gauge",
              "stat-projected-profit": "profit-gauge",
              // Client stats → top clients
              "stat-clients": "top-clients",
              "stat-clients-active": "top-clients",
              "stat-client-ranking": "top-clients",
              "stat-project-ranking": "top-clients",
              "client-revenue": "top-clients",
              "client-activity": "top-clients",
              // Schedule stats → today's schedule
              "stat-events": "todays-schedule",
              // Team stats → crew board
              "stat-team": "crew-board",
              // Estimates → win rate
              "stat-estimates": "win-rate",
              "stat-opportunities": "win-rate",
              "estimates-funnel": "win-rate",
              // Pipeline detail → pipeline funnel
              "pipeline-value": "pipeline-funnel",
              "pipeline-velocity": "pipeline-funnel",
            };

            // Process: rename, remove, inject replacements
            const replacementsToInject = new Set<string>();
            const migrated: WidgetInstance[] = [];

            for (const inst of instances) {
              // Rename
              if (inst.typeId in RENAME_MAP) {
                migrated.push({ ...inst, typeId: RENAME_MAP[inst.typeId] as WidgetTypeId });
                continue;
              }
              // Remove + track replacement
              if (REMOVED_IDS.has(inst.typeId)) {
                const replacement = REPLACEMENT_MAP[inst.typeId];
                if (replacement) replacementsToInject.add(replacement);
                continue;
              }
              // Keep
              migrated.push(inst);
            }

            // Inject replacement widgets (only if not already present)
            const presentTypeIds = new Set<string>(migrated.map(i => i.typeId));
            for (const typeId of replacementsToInject) {
              if (!presentTypeIds.has(typeId)) {
                migrated.push(createWidgetInstance(typeId as WidgetTypeId));
                presentTypeIds.add(typeId);
              }
            }

            state.widgetInstances = migrated;
          }
        }

        // ── v10 → v11: Add widgetGap preference — no migration needed, default applies ──

        // ── v9 → v10: Centralized color palette — rename accent IDs ──
        if (version < 10) {
          const old = state.accentColor as string | undefined;
          if (old && old in ACCENT_ID_MIGRATION) {
            state.accentColor = ACCENT_ID_MIGRATION[old];
          }
        }

        // ── v8 → v9: Accent color palette expanded to 16 muted earth tones ──
        if (version < 9) {
          const old = state.accentColor as string | undefined;
          const removed = ["emerald", "violet", "rose", "cyan"];
          if (old && removed.includes(old)) {
            state.accentColor = "steel-blue";
          }
        }

        // ── v7 → v8: Remove dead notificationPrefs (moved to server-persisted notification_preferences) ──
        if (version < 8) {
          delete state.notificationPrefs;
        }

        // ── v6 → v7: Add map preferences — no data migration needed, defaults apply ──

        // ── v5 → v6: Grid & stat widget overhaul — existing instances are valid, just bump ──
        // No data migration needed: new widget types are additive.
        // Existing widgetInstances array carries forward as-is.

        // ── v1-v4 → v5: Convert old widgetConfigs/widgetOrder to widgetInstances ──
        if (version < 5) {
          // Old v4 schema had widgetConfigs (Record<string, {size, visible}>) + widgetOrder (string[])
          const oldConfigs = state.widgetConfigs as Record<string, { size: WidgetSize; visible: boolean }> | undefined;
          const oldOrder = state.widgetOrder as string[] | undefined;

          if (oldConfigs && oldOrder) {
            // Map old v4 fixed IDs → v5 type IDs (v12 migration will then transform these)
            const OLD_TO_NEW: Record<string, { typeId: string; config?: Record<string, unknown> }> = {
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
            };

            const instances: WidgetInstance[] = [];
            for (const oldId of oldOrder) {
              const mapping = OLD_TO_NEW[oldId];
              const oldCfg = oldConfigs[oldId];
              if (!mapping || !oldCfg) continue;

              instances.push({
                ...createWidgetInstance(mapping.typeId as WidgetTypeId, mapping.config),
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
