/**
 * OPS Web — Analytics Identity Bridge
 *
 * Subscribes to the auth store and keeps the AnalyticsService identity
 * in sync. Mount this inside the dashboard layout (after AuthProvider).
 *
 * When the user logs in, identity fields (user_id, company_id, role, plan)
 * are pushed to the analytics singleton. On logout, they are cleared.
 */
"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { analyticsService } from "@/lib/analytics/analytics-service";

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const company = useAuthStore((s) => s.company);
  const role = useAuthStore((s) => s.role);

  useEffect(() => {
    if (!analyticsService) return;

    if (currentUser) {
      analyticsService.setIdentity({
        userId: currentUser.id,
        companyId: company?.id ?? null,
        role: role ?? null,
        plan: company?.subscriptionPlan ?? null,
      });
    } else {
      analyticsService.clearIdentity();
    }
  }, [currentUser, company, role]);

  return <>{children}</>;
}
