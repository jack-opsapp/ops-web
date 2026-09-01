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
import { usePathname } from "next/navigation";
import { analyticsService } from "@/lib/analytics/analytics-service";
import { templateAnalyticsPathname } from "@/lib/analytics/event-sanitizer";

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    analyticsService?.track("screen_view", "route_viewed", {
      route_template: templateAnalyticsPathname(pathname),
    });
  }, [pathname]);

  return <>{children}</>;
}
