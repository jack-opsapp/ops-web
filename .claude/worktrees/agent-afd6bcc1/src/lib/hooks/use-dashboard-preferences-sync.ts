/**
 * OPS Web - Dashboard Preferences Sync Hook
 *
 * Bridges the Zustand preferences store ↔ Supabase.
 * - On mount: fetches server preferences and hydrates Zustand (server wins on first load)
 * - On Zustand changes: debounce-saves to Supabase (2s)
 *
 * All existing consumers keep reading from Zustand — this hook is transparent.
 * Mount once in the authenticated layout.
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import {
  DashboardPreferencesService,
  type UpdateDashboardPreferences,
} from "@/lib/api/services/dashboard-preferences-service";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useAuthStore } from "@/lib/store/auth-store";

const DEBOUNCE_MS = 2000;

export function useDashboardPreferencesSync() {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);
  const savingRef = useRef(false);

  // ── Fetch server preferences ──────────────────────────────────────────
  const { data: serverPrefs } = useQuery({
    queryKey: queryKeys.dashboardPreferences.detail(userId, companyId),
    queryFn: () => DashboardPreferencesService.getPreferences(userId, companyId),
    enabled: !!userId && !!companyId,
    staleTime: 10 * 60 * 1000, // 10 min — rarely changes from another device
  });

  // ── Hydrate Zustand from server (once per session) ────────────────────
  useEffect(() => {
    if (!serverPrefs || hydratedRef.current) return;
    hydratedRef.current = true;

    const store = usePreferencesStore.getState();

    // If server has widget instances, use them (server is source of truth).
    // If server has empty array, this is a new row — push local to server.
    if (serverPrefs.widgetInstances.length > 0) {
      store.applyWidgetInstances(serverPrefs.widgetInstances);
      store.setDashboardLayout(serverPrefs.dashboardLayout);
      store.setSchedulingType(serverPrefs.schedulingType);
      store.setMapDefaultZoom(serverPrefs.mapDefaultZoom);
      store.setMapDefaultCenter(serverPrefs.mapDefaultCenter);
      store.setMapShowTraffic(serverPrefs.mapShowTraffic);
      store.setMapShowCrewLabels(serverPrefs.mapShowCrewLabels);
    } else {
      // New server row — seed it with current local state
      saveToServer(userId, companyId);
    }
  }, [serverPrefs, userId, companyId]);

  // ── Save helper ───────────────────────────────────────────────────────
  const saveToServer = useCallback(
    async (uid: string, cid: string) => {
      if (!uid || !cid || savingRef.current) return;
      savingRef.current = true;
      try {
        const s = usePreferencesStore.getState();
        const updates: UpdateDashboardPreferences = {
          widgetInstances: s.widgetInstances,
          dashboardLayout: s.dashboardLayout,
          schedulingType: s.schedulingType,
          mapDefaultZoom: s.mapDefaultZoom,
          mapDefaultCenter: s.mapDefaultCenter,
          mapShowTraffic: s.mapShowTraffic,
          mapShowCrewLabels: s.mapShowCrewLabels,
        };
        await DashboardPreferencesService.updatePreferences(uid, cid, updates);
        queryClient.invalidateQueries({
          queryKey: queryKeys.dashboardPreferences.detail(uid, cid),
        });
      } catch {
        // Silently fail — localStorage still has the data, will retry on next change
      } finally {
        savingRef.current = false;
      }
    },
    [queryClient]
  );

  // ── Subscribe to Zustand changes and debounce save ────────────────────
  useEffect(() => {
    if (!userId || !companyId) return;

    // Wait until hydration is complete before listening for changes
    if (!hydratedRef.current) return;

    const unsub = usePreferencesStore.subscribe(
      (state, prevState) => {
        // Only save if dashboard-related fields changed
        const changed =
          state.widgetInstances !== prevState.widgetInstances ||
          state.dashboardLayout !== prevState.dashboardLayout ||
          state.schedulingType !== prevState.schedulingType ||
          state.mapDefaultZoom !== prevState.mapDefaultZoom ||
          state.mapDefaultCenter !== prevState.mapDefaultCenter ||
          state.mapShowTraffic !== prevState.mapShowTraffic ||
          state.mapShowCrewLabels !== prevState.mapShowCrewLabels;

        if (!changed) return;

        // Debounce
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          saveToServer(userId, companyId);
        }, DEBOUNCE_MS);
      }
    );

    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [userId, companyId, saveToServer]);
}
