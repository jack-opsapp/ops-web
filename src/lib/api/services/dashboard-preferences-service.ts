/**
 * OPS Web - Dashboard Preferences Service
 *
 * Per-user dashboard widget layout and preferences.
 * Routes through /api/dashboard-preferences (server-side, service-role)
 * because client-side Supabase RLS doesn't work with Firebase JWTs.
 */

import { parseDateRequired } from "@/lib/supabase/helpers";
import type { WidgetInstance } from "@/lib/types/dashboard-widgets";
import type { DashboardLayoutId, SchedulingTypeId } from "@/stores/preferences-store";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DashboardPreferences {
  id: string;
  userId: string;
  companyId: string;
  widgetInstances: WidgetInstance[];
  dashboardLayout: DashboardLayoutId;
  schedulingType: SchedulingTypeId;
  mapDefaultZoom: number;
  mapDefaultCenter: { lat: number; lng: number } | null;
  mapShowTraffic: boolean;
  mapShowCrewLabels: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateDashboardPreferences {
  widgetInstances?: WidgetInstance[];
  dashboardLayout?: DashboardLayoutId;
  schedulingType?: SchedulingTypeId;
  mapDefaultZoom?: number;
  mapDefaultCenter?: { lat: number; lng: number } | null;
  mapShowTraffic?: boolean;
  mapShowCrewLabels?: boolean;
}

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): DashboardPreferences {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    companyId: row.company_id as string,
    widgetInstances: (row.widget_instances as WidgetInstance[]) ?? [],
    dashboardLayout: (row.dashboard_layout as DashboardLayoutId) ?? "default",
    schedulingType: (row.scheduling_type as SchedulingTypeId) ?? "both",
    mapDefaultZoom: (row.map_default_zoom as number) ?? 12,
    mapDefaultCenter: (row.map_default_center as { lat: number; lng: number }) ?? null,
    mapShowTraffic: (row.map_show_traffic as boolean) ?? false,
    mapShowCrewLabels: (row.map_show_crew_labels as boolean) ?? true,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
  };
}

/** Get the Firebase auth token from cookie for API route auth */
function getAuthToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/ops-auth-token=([^;]+)/);
  return match?.[1] ?? null;
}

// ─── Defaults (returned when API call fails) ────────────────────────────────

function makeDefaults(userId: string, companyId: string): DashboardPreferences {
  return {
    id: "",
    userId,
    companyId,
    widgetInstances: [],
    dashboardLayout: "default" as DashboardLayoutId,
    schedulingType: "both" as SchedulingTypeId,
    mapDefaultZoom: 12,
    mapDefaultCenter: null,
    mapShowTraffic: false,
    mapShowCrewLabels: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const DashboardPreferencesService = {
  /**
   * Get dashboard preferences for a user+company. Creates defaults if missing.
   */
  async getPreferences(userId: string, companyId: string): Promise<DashboardPreferences> {
    const token = getAuthToken();
    if (!token) {
      console.warn("[DashboardPreferences] No auth token available, using defaults.");
      return makeDefaults(userId, companyId);
    }

    try {
      const res = await fetch(
        `/api/dashboard-preferences?user_id=${encodeURIComponent(userId)}&company_id=${encodeURIComponent(companyId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        const body = await res.text();
        console.warn(`[DashboardPreferences] GET failed (${res.status}): ${body}. Using defaults.`);
        return makeDefaults(userId, companyId);
      }

      return mapFromDb(await res.json());
    } catch (err) {
      console.warn("[DashboardPreferences] GET error:", err);
      return makeDefaults(userId, companyId);
    }
  },

  /**
   * Update dashboard preferences. Partial updates supported.
   */
  async updatePreferences(
    userId: string,
    companyId: string,
    updates: UpdateDashboardPreferences
  ): Promise<DashboardPreferences> {
    const token = getAuthToken();
    if (!token) throw new Error("No auth token available");

    const row: Record<string, unknown> = { user_id: userId, company_id: companyId };
    if (updates.widgetInstances !== undefined) row.widget_instances = updates.widgetInstances;
    if (updates.dashboardLayout !== undefined) row.dashboard_layout = updates.dashboardLayout;
    if (updates.schedulingType !== undefined) row.scheduling_type = updates.schedulingType;
    if (updates.mapDefaultZoom !== undefined) row.map_default_zoom = updates.mapDefaultZoom;
    if (updates.mapDefaultCenter !== undefined) row.map_default_center = updates.mapDefaultCenter;
    if (updates.mapShowTraffic !== undefined) row.map_show_traffic = updates.mapShowTraffic;
    if (updates.mapShowCrewLabels !== undefined) row.map_show_crew_labels = updates.mapShowCrewLabels;

    const res = await fetch("/api/dashboard-preferences", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(row),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to update dashboard preferences: ${body}`);
    }

    return mapFromDb(await res.json());
  },
};
