"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore, selectPermissionsReady } from "@/lib/store/permissions-store";
import { useFeatureFlagsStore, selectFlagsReady } from "@/lib/store/feature-flags-store";
import { AuthProvider } from "@/components/providers/auth-provider";
import { AnalyticsProvider } from "@/components/providers/analytics-provider";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { LogoLoader } from "@/components/brand";
import { LockoutOverlay } from "@/components/ops/lockout-overlay";
import { useDictionary } from "@/i18n/client";
import { getAnyOfPermissionsForPath } from "@/lib/navigation/route-registry";

// ─── Route → Permission mapping ──────────────────────────────────────────────
//
// Derived from the route registry (single source of truth). Routes without
// a registry entry or permission are always allowed; testing-grounds runs a
// per-user special permission check on the page itself. The retired /intel
// entry is gone — middleware 308s /intel → /calibration before this gate
// ever sees it. Hub entries (BOOKS) gate on ANY of their listed
// permissions; single-permission entries normalize to a one-element list.
const getRequiredPermissions = getAnyOfPermissionsForPath;

// ─── Auth + Permission Gate ──────────────────────────────────────────────────

function DashboardAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuthStore();
  const can = usePermissionStore((s) => s.can);
  const permissionsReady = usePermissionStore(selectPermissionsReady);
  const isRouteUnlocked = useFeatureFlagsStore((s) => s.isRouteUnlocked);
  const flagsReady = useFeatureFlagsStore(selectFlagsReady);
  const { t } = useDictionary("common");

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <LogoLoader size={120} />
          <span className="font-mono text-caption-sm text-text-mute uppercase tracking-widest">
            [preparing your dashboard]
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // Block render while feature flags are loading — prevents flash of gated content.
  if (!flagsReady) return null;

  // Block while permissions load for a gated route
  const requiredPermissions = getRequiredPermissions(pathname);
  if (requiredPermissions && !permissionsReady) return null;

  // If route is gated by feature flag or permission, show 404 — don't redirect.
  // The user should not know the route exists.
  const routeDenied =
    !isRouteUnlocked(pathname) ||
    (requiredPermissions && !requiredPermissions.some((p) => can(p)));

  if (routeDenied) {
    return (
      <>
        <DashboardLayout>
          <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] gap-3">
            <span className="font-mohave text-[64px] text-text-mute leading-none">404</span>
            <p className="font-mono text-caption-sm text-text-3 uppercase tracking-wider">
              {t("pageNotFound")}
            </p>
          </div>
        </DashboardLayout>
        <LockoutOverlay />
      </>
    );
  }

  return (
    <>
      <DashboardLayout>{children}</DashboardLayout>
      <LockoutOverlay />
    </>
  );
}

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <AnalyticsProvider>
        <DashboardAuthGate>{children}</DashboardAuthGate>
      </AnalyticsProvider>
    </AuthProvider>
  );
}
