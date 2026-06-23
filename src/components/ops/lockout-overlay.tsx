"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  usePermissionStore,
  selectPermissionsReady,
} from "@/lib/store/permissions-store";
import { getLockoutReason } from "@/lib/subscription";
import { LockoutResolver } from "@/components/lockout/lockout-resolver";
import { useRealtimeCompany } from "@/components/lockout/hooks/use-realtime-company";
import {
  lockoutBackdropVariants,
  lockoutBackdropVariantsReduced,
  lockoutCardVariants,
  lockoutCardVariantsReduced,
} from "@/lib/utils/motion";

const LOCKOUT_EXEMPT_ROUTES = ["/settings"];

export function LockoutOverlay() {
  const pathname = usePathname();
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);
  // See lockout-resolver: gate on billing-settings management, not a role name;
  // fail-safe until the (async, non-persisted) permission store hydrates.
  const permsReady = usePermissionStore(selectPermissionsReady);
  const canManageBilling = usePermissionStore((s) => s.can("settings.billing"));
  const canResolveLockout = !permsReady || canManageBilling;
  const prefersReducedMotion = useReducedMotion();

  useRealtimeCompany(company?.id);

  const rawReason = useMemo(
    () => getLockoutReason(company ?? null, currentUser?.id ?? null),
    [company, currentUser]
  );

  const isExemptRoute = LOCKOUT_EXEMPT_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  // Team management was absorbed into Settings (P3.4): /team → /settings?section=team.
  // The `?section=` query isn't in pathname, so exempt the whole /settings surface —
  // an unseated admin reaches the seat controls only by coming here to fix it.
  const isOnTeamPage = pathname === "/settings";
  const reason = useMemo(() => {
    if (!rawReason) return null;
    if (isExemptRoute && canResolveLockout && rawReason === "subscription_expired") return null;
    if (isOnTeamPage && canResolveLockout && rawReason === "unseated") return null;
    return rawReason;
  }, [rawReason, isExemptRoute, isOnTeamPage, canResolveLockout]);

  const backdropVariants = prefersReducedMotion
    ? lockoutBackdropVariantsReduced
    : lockoutBackdropVariants;
  const cardVariants = prefersReducedMotion
    ? lockoutCardVariantsReduced
    : lockoutCardVariants;

  return (
    <AnimatePresence>
      {reason && (
        <motion.div
          key="lockout-backdrop"
          className="fixed inset-0 z-emergency flex items-center justify-center bg-black/60 backdrop-blur-xl backdrop-saturate-150"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="lockout-heading"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <motion.div
            key="lockout-card"
            className="mx-4 my-4 w-full max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain"
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <LockoutResolver variant="overlay" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
