"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogoLoader } from "@/components/brand";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  usePermissionStore,
  selectPermissionsReady,
} from "@/lib/store/permissions-store";
import { getLockoutReason } from "@/lib/subscription";
import { useRealtimeCompany } from "./hooks/use-realtime-company";
import { ExpiredAdminState } from "./states/expired-admin";
import { ExpiredMemberState } from "./states/expired-member";
import { UnseatedAdminState } from "./states/unseated-admin";
import { UnseatedMemberState } from "./states/unseated-member";

const LOCKOUT_EXEMPT_ROUTES = ["/settings"];

export interface LockoutResolverProps {
  variant: "page" | "overlay";
}

export function LockoutResolver({ variant }: LockoutResolverProps) {
  const router = useRouter();
  const pathname = usePathname();
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);
  // "Can resolve a billing / seat lockout" = holds billing-settings management,
  // not a role NAME. Fail-safe: the permission store is fetched async (not
  // persisted), so until it hydrates treat the user as able to resolve — an
  // admin must never lose the /settings recovery path during the load flash.
  const permsReady = usePermissionStore(selectPermissionsReady);
  const canManageBilling = usePermissionStore((s) => s.can("settings.billing"));
  const canResolveLockout = !permsReady || canManageBilling;

  useRealtimeCompany(company?.id);

  const userId = currentUser?.id ?? null;

  const rawReason = useMemo(
    () => getLockoutReason(company ?? null, userId),
    [company, userId]
  );

  // Route-based exemptions (overlay only — page is /locked itself).
  const isExemptRoute = LOCKOUT_EXEMPT_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  // Team management was absorbed into Settings (P3.4): /team → /settings?section=team.
  // The `?section=` query isn't in pathname, so exempt the whole /settings surface —
  // an unseated admin reaches the seat controls only by coming here to fix it.
  const isOnTeamPage = pathname === "/settings";
  const reason = useMemo(() => {
    if (variant === "page") return rawReason;
    if (!rawReason) return null;
    if (isExemptRoute && canResolveLockout && rawReason === "subscription_expired") return null;
    if (isOnTeamPage && canResolveLockout && rawReason === "unseated") return null;
    return rawReason;
  }, [variant, rawReason, isExemptRoute, isOnTeamPage, canResolveLockout]);

  // Page-only: if user has full access, send them to the dashboard.
  useEffect(() => {
    if (variant !== "page") return;
    if (!company || !currentUser) return; // still loading
    if (reason === null) router.replace("/dashboard");
  }, [variant, company, currentUser, reason, router]);

  // Loading state on the page (overlay just doesn't render).
  if (variant === "page" && (!company || !currentUser)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LogoLoader size={120} />
      </div>
    );
  }

  if (!reason) return null;

  if (reason === "subscription_expired" && canResolveLockout) return <ExpiredAdminState variant={variant} />;
  if (reason === "subscription_expired") return <ExpiredMemberState variant={variant} />;
  if (reason === "unseated" && canResolveLockout) return <UnseatedAdminState variant={variant} />;
  return <UnseatedMemberState variant={variant} />;
}
