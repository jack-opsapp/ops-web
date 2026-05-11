"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useAuthStore, selectIsAdminOrOwner } from "@/lib/store/auth-store";
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
  const isAdmin = useAuthStore(selectIsAdminOrOwner);
  const prefersReducedMotion = useReducedMotion();

  useRealtimeCompany(company?.id);

  const rawReason = useMemo(
    () => getLockoutReason(company ?? null, currentUser?.id ?? null),
    [company, currentUser]
  );

  const isExemptRoute = LOCKOUT_EXEMPT_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  const isOnTeamPage = pathname === "/team" || pathname.startsWith("/team/");
  const reason = useMemo(() => {
    if (!rawReason) return null;
    if (isExemptRoute && isAdmin && rawReason === "subscription_expired") return null;
    if (isOnTeamPage && isAdmin && rawReason === "unseated") return null;
    return rawReason;
  }, [rawReason, isExemptRoute, isOnTeamPage, isAdmin]);

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
