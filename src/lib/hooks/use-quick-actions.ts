"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  ALL_ACTIONS,
  DEFAULT_ACTION_IDS,
  type FABAction,
} from "@/lib/constants/fab-actions";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";
import { getSlugForRoute } from "@/lib/feature-flags/feature-flag-definitions";
import { useDashboardCustomizeStore } from "@/stores/dashboard-customize-store";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";

/**
 * Returns the Quick Actions visible to the current user, in user-preference order.
 *
 * Filters applied (in order):
 *   1. User preference: `currentUser.fabActions` (defaults to ALL_ACTIONS order).
 *   2. Permission: `usePermissionStore.can(action.requiredPermission)`.
 *   3. Feature flag: `canAccessFeature(getSlugForRoute(action.target))` for route handlers.
 *
 * Lifted from `floating-action-button.tsx` (deleted 2026-04-25) so the same
 * filtering logic is shared between the QuickActionsDrawer and any other
 * surface that needs to enumerate the user's allowed actions.
 */
export function useQuickActions(): FABAction[] {
  const fabActions = useAuthStore((s) => s.currentUser?.fabActions);
  const can = usePermissionStore((s) => s.can);
  const canAccessFeature = useFeatureFlagsStore((s) => s.canAccessFeature);

  return useMemo(() => {
    const userActionIds = fabActions ?? DEFAULT_ACTION_IDS;
    return userActionIds
      .map((id) => ALL_ACTIONS.find((a) => a.id === id))
      .filter((action): action is FABAction => !!action)
      .filter(
        (action) =>
          !action.requiredPermission || can(action.requiredPermission),
      )
      .filter((action) => {
        const route =
          typeof action.target === "string" && action.target.startsWith("/")
            ? action.target.split("?")[0]
            : null;
        if (!route) return true;
        const slug = getSlugForRoute(route);
        if (!slug) return true;
        return canAccessFeature(slug);
      });
  }, [fabActions, can, canAccessFeature]);
}

/**
 * Returns whether the Quick Actions edge tab + drawer should be visible.
 *
 * Hidden when:
 *   - The current route is /intel (full-bleed canvas)
 *   - The dashboard is in customize mode
 *   - A wizard is currently open
 *   - The duplicate-review sheet is open
 *
 * Mirrors the hide rules from the deleted FloatingActionButton (2026-04-25).
 */
export function useQuickActionsVisible(): boolean {
  const pathname = usePathname();
  const dashboardCustomizing = useDashboardCustomizeStore(
    (s) => s.isCustomizing,
  );
  const wizardOpen = useDashboardCustomizeStore((s) => s.wizardOpen);
  const duplicateSheetOpen = useDuplicateReviewStore((s) => s.open);

  if (pathname === "/intel") return false;
  if (dashboardCustomizing || wizardOpen || duplicateSheetOpen) return false;
  return true;
}
