"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore, selectPermissionsReady } from "@/lib/store/permissions-store";
import { AuthProvider } from "@/components/providers/auth-provider";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Loader2 } from "lucide-react";
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
  const { t } = useDictionary("common");

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  // Redirect to dashboard if user lacks permission for this route
  useEffect(() => {
    if (!permissionsReady) return;
    const required = getRequiredPermission(pathname);
    if (required && !can(required)) {
      router.replace("/dashboard");
    }
  }, [pathname, permissionsReady, can, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-[32px] h-[32px] text-ops-accent animate-spin" />
          <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
            {t("loading")}
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // Block render while permissions are loading for a gated route
  const requiredPermission = getRequiredPermission(pathname);
  if (requiredPermission) {
    if (!permissionsReady) return null;
    if (!can(requiredPermission)) return null;
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
