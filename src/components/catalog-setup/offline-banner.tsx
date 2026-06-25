"use client";

/**
 * OfflineBanner — the wizard-level offline signal (spec §16 "Offline"). When the
 * browser drops connectivity, the build is HELD (staged cards are safe
 * client-side) — this bar states that plainly so the operator knows nothing is
 * lost and the build will go through once they're back.
 *
 * Tokens: border-only `tan` (attention, not error — this isn't a failure, it's a
 * wait); radius `bar` (2px); `WifiOff` lucide 16px; NO accent (accent is BUILD IT
 * only). Entrance is a 250ms y-slide on EASE_SMOOTH; reduced motion → opacity
 * only. Copy in OPS voice (no exclamation), via useDictionary("catalog-setup").
 */

import { motion, useReducedMotion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";

export interface OfflineBannerProps {
  online: boolean;
  className?: string;
}

export function OfflineBanner({ online, className }: OfflineBannerProps) {
  const { t } = useDictionary("catalog-setup");
  const reduced = useReducedMotion();
  if (online) return null;

  return (
    <motion.div
      role="status"
      data-testid="catalog-setup-offline-banner"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.25, ease: EASE_SMOOTH }}
      className={cn(
        "flex items-center gap-3 rounded-bar border border-tan-line bg-tan-soft px-4 py-2",
        className,
      )}
    >
      <WifiOff aria-hidden className="h-[16px] w-[16px] shrink-0 text-tan" />
      <span className="font-cakemono text-[14px] font-light uppercase tracking-wide text-text-2">
        {t("offline.title", "Offline")}
      </span>
      <span className="font-mono text-micro tracking-wide text-text-3">
        {t("offline.detail", "[ build holds until you're back — nothing's lost ]")}
      </span>
    </motion.div>
  );
}

export default OfflineBanner;
