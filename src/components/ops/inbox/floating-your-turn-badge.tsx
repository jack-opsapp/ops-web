"use client";

/**
 * FloatingYourTurnBadge — top-center floating chip that surfaces the
 * "your turn" signal on YOUR_MOVE-classified threads. Replaces the
 * full-width <BallYoursBand> with an absolutely-positioned affordance
 * that does not displace the message list.
 *
 *   ┌───────────────────────────────┐
 *   │  //  YOUR TURN  ·  18H    ✓   │
 *   └───────────────────────────────┘
 *
 * - Glass-dense surface, accent-tinted slash label, JetBrains-mono wait
 *   clock. Owns the screen's single accent slot — the parent route is
 *   responsible for downgrading P4-1's header triage chip tone when this
 *   badge is mounted.
 * - Inline `✓` button is rendered only when `onAcknowledge` is supplied
 *   (i.e. the thread carries AWAITING_REPLY and the operator can dismiss
 *   the obligation without sending a reply).
 * - Mount/unmount via `<AnimatePresence>`. Honors `prefers-reduced-motion`.
 *
 * Positioning is owned by the consumer — wrap the badge in an absolute
 * container so the messages-wrapper layout decides the anchor point. See
 * <ThreadDetail>'s `floatingBadgeSlot` for the canonical mount.
 */

import { Check } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  floatingBadgeVariants,
  floatingBadgeVariantsReduced,
} from "@/lib/utils/motion";

export interface FloatingYourTurnBadgeProps {
  /**
   * Pre-formatted wait duration (`"18H"` / `"12D"` / `"MAR 4"`). When
   * omitted, the bullet + duration tail is dropped and only the slash
   * label renders. Most YOUR_MOVE threads have a meaningful wait clock;
   * the no-duration variant is reserved for commitment-driven /
   * blocking-question YOUR_MOVE states where wait time isn't the salient
   * dimension.
   */
  waitDuration?: string;
  /**
   * Clears AWAITING_REPLY on the thread without sending a reply. When
   * undefined the `✓` icon is hidden. Pattern matches the original
   * BallYoursBand's `onAcknowledge` so the operator's escape hatch
   * survives the band → badge migration.
   */
  onAcknowledge?: () => void;
  /** Mounted state — drives the AnimatePresence enter/exit. */
  show: boolean;
  className?: string;
}

export function FloatingYourTurnBadge({
  waitDuration,
  onAcknowledge,
  show,
  className,
}: FloatingYourTurnBadgeProps) {
  const { t } = useDictionary("inbox");
  const reduced = !!useReducedMotion();
  const variants = reduced
    ? floatingBadgeVariantsReduced
    : floatingBadgeVariants;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="floating-your-turn-badge"
          data-testid="floating-your-turn-badge"
          role="status"
          aria-label={t("floatingBadge.aria", "Your turn")}
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className={cn(
            "pointer-events-auto absolute left-1/2 top-2 z-[1500] -translate-x-1/2",
            className,
          )}
        >
          <div
            className={cn(
              "inline-flex items-center gap-1.5 rounded-chip border border-line",
              "bg-[rgba(18,18,20,0.78)] px-2.5 py-1.5",
              "backdrop-blur-[28px] [backdrop-saturate:1.3]",
            )}
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            <span
              className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.14em] text-ops-accent"
              data-testid="floating-your-turn-badge-label"
            >
              {t("floatingBadge.label", "// YOUR TURN")}
            </span>
            {waitDuration && (
              <>
                <span
                  aria-hidden
                  className="font-mono text-[11px] leading-none text-text-mute"
                >
                  ·
                </span>
                <span
                  data-testid="floating-your-turn-badge-wait"
                  className="font-mono text-[11px] uppercase leading-none tracking-[0.10em] text-text-2"
                >
                  {waitDuration}
                </span>
              </>
            )}
            {onAcknowledge && (
              <button
                type="button"
                onClick={onAcknowledge}
                aria-label={t(
                  "floatingBadge.acknowledge",
                  "Mark no reply needed",
                )}
                title={t(
                  "floatingBadge.acknowledge",
                  "Mark no reply needed",
                )}
                data-testid="floating-your-turn-badge-acknowledge"
                className={cn(
                  "ml-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[2px]",
                  "text-text-3 transition-colors",
                  "hover:bg-ops-accent/[0.18] hover:text-ops-accent",
                  "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent",
                )}
              >
                <Check aria-hidden className="h-3 w-3" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
