"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore, selectPermissionsReady } from "@/lib/store/permissions-store";
import { useFeatureFlagsStore, selectFlagsReady } from "@/lib/store/feature-flags-store";
import { AuthProvider } from "@/components/providers/auth-provider";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { useDictionary } from "@/i18n/client";

// ─── Route → Permission mapping ──────────────────────────────────────────────

/** Routes that require a specific permission to access. Omitted = always allowed. */
const ROUTE_PERMISSIONS: Record<string, string> = {
  "/projects": "projects.view",
  "/calendar": "calendar.view",
  "/clients": "clients.view",
  "/job-board": "job_board.view",
  "/team": "team.view",
  "/map": "map.view",
  "/pipeline": "pipeline.view",
  "/estimates": "estimates.view",
  "/invoices": "invoices.view",
  "/products": "products.view",
  "/inventory": "inventory.view",
  "/accounting": "accounting.view",
  "/portal-inbox": "portal.view",
};

/** Check if the current pathname requires a permission the user doesn't have. */
function getRequiredPermission(pathname: string): string | null {
  for (const [route, permission] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      return permission;
    }
  }
  return null;
}

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
        <div className="flex flex-col items-center gap-2">
          <span className="font-bebas text-[48px] tracking-[0.2em] text-ops-accent leading-none animate-pulse-live">
            OPS
          </span>
          <span className="font-kosugi text-caption-sm text-text-disabled uppercase tracking-widest">
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
  const requiredPermission = getRequiredPermission(pathname);
  if (requiredPermission && !permissionsReady) return null;

  // If route is gated by feature flag or permission, show 404 — don't redirect.
  // The user should not know the route exists.
  const routeDenied =
    !isRouteUnlocked(pathname) ||
    (requiredPermission && !can(requiredPermission));

  if (routeDenied) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] gap-3">
          <span className="font-mohave text-[64px] text-text-disabled leading-none">404</span>
          <p className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-wider">
            {t("pageNotFound")}
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <DashboardAuthGate>{children}</DashboardAuthGate>
    </AuthProvider>
  );
}
