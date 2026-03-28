/**
 * OPS Web - Dashboard Preferences Service
 *
 * Per-user dashboard widget layout and preferences using Supabase.
 * Uses upsert-read pattern: getPreferences creates defaults if row doesn't exist.
 */

import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";
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

// ─── Service ──────────────────────────────────────────────────────────────────

export const DashboardPreferencesService = {
  /**
   * Get dashboard preferences for a user+company. Creates defaults if missing.
   */
  async getPreferences(userId: string, companyId: string): Promise<DashboardPreferences> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("user_dashboard_preferences")
      .upsert(
        { user_id: userId, company_id: companyId },
        { onConflict: "user_id,company_id", ignoreDuplicates: true }
      )
      .select()
      .single();

    if (error) {
      // Upsert may fail due to RLS — fallback to a direct read
      const { data: fetched, error: fetchError } = await supabase
        .from("user_dashboard_preferences")
        .select("*")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .single();

      if (fetchError) throw new Error(`Failed to get dashboard preferences: ${fetchError.message}`);
      return mapFromDb(fetched);
    }

    return mapFromDb(data);
  },

  /**
   * Update dashboard preferences. Partial updates supported.
   */
  async updatePreferences(
    userId: string,
    companyId: string,
    updates: UpdateDashboardPreferences
  ): Promise<DashboardPreferences> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.widgetInstances !== undefined) row.widget_instances = updates.widgetInstances;
    if (updates.dashboardLayout !== undefined) row.dashboard_layout = updates.dashboardLayout;
    if (updates.schedulingType !== undefined) row.scheduling_type = updates.schedulingType;
    if (updates.mapDefaultZoom !== undefined) row.map_default_zoom = updates.mapDefaultZoom;
    if (updates.mapDefaultCenter !== undefined) row.map_default_center = updates.mapDefaultCenter;
    if (updates.mapShowTraffic !== undefined) row.map_show_traffic = updates.mapShowTraffic;
    if (updates.mapShowCrewLabels !== undefined) row.map_show_crew_labels = updates.mapShowCrewLabels;

    const { data, error } = await supabase
      .from("user_dashboard_preferences")
      .update(row)
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update dashboard preferences: ${error.message}`);
    return mapFromDb(data);
  },
};
