"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useCalibrationDeck } from "./hooks/use-calibration-deck";
import { SectionBreadcrumb } from "./section-breadcrumb";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import { cn } from "@/lib/utils/cn";
import type {
  DomainHealthStatus,
  LadderPosition,
} from "@/lib/types/calibration";

const DOMAINS = ["email", "projects", "invoice", "schedule", "comms"] as const;

const DOT_COLOR: Record<DomainHealthStatus, string> = {
  nominal: "#9DB582",
  learning: "#C4A868",
  gated: "#6A6A6A",
  unavailable: "#6A6A6A",
};

const LADDER_GLYPH: Record<LadderPosition["status"], string> = {
  complete: "●",
  in_training: "◐",
  gated: "◯",
};

const LADDER_COLOR: Record<LadderPosition["status"], string> = {
  complete: "#9DB582",
  in_training: "#C4A868",
  gated: "#6A6A6A",
};

const LADDER_STATUS_KEY: Record<LadderPosition["status"], string> = {
  complete: "complete",
  in_training: "inTraining",
  gated: "gated",
};

/**
 * Ladder rows that fire persistent notifications on transition. Matches
 * the LadderPosition.persistent flag from calibration-service. When a row
 * flips to complete, it pulses once via layoutId keyframes.
 */
export function SectionMilestones() {
  const { t } = useDictionary("calibration");
  const { data: deck } = useCalibrationDeck();
  const company = useAuthStore((s) => s.company);
  const companyId = company?.id ?? "";
  const [pulsePosition, setPulsePosition] = useState<number | null>(null);
  const lastMilestonesRef = useRef<Record<string, boolean>>({});

  // Supabase realtime — pulse the ladder row when its milestone flips true.
  useEffect(() => {
    if (!companyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`calibration-milestones-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "email_connections",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const settings = (row.auto_send_settings ?? {}) as Record<
            string,
            unknown
          >;
          const milestones = (settings.milestones ?? {}) as Record<
            string,
            boolean
          >;

          const prev = lastMilestonesRef.current;
          if (
            !prev.draft_available_shown &&
            milestones.draft_available_shown
          ) {
            setPulsePosition(3);
          } else if (
            !prev.auto_draft_suggested &&
            milestones.auto_draft_suggested
          ) {
            setPulsePosition(4);
          } else if (
            !prev.auto_send_suggested &&
            milestones.auto_send_suggested
          ) {
            setPulsePosition(8);
          }
          lastMilestonesRef.current = milestones;

          // Clear pulse after the one-beat animation completes.
          setTimeout(() => setPulsePosition(null), 900);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  if (!deck) return null;

  return (
    <div className="px-11 py-9 max-w-[1320px] mx-auto">
      <SectionBreadcrumb currentSection="milestones" />
      <div className="flex items-baseline justify-between mb-6">
        <h2 className="font-cakemono font-light uppercase text-[22px] text-text">
          <span className="text-text-mute mr-2">{"//"}</span>MILESTONES
        </h2>
        <span className="font-mono text-data text-text-2 tabular-nums">
          {t("sections.milestones.overallHeader").replace(
            "{reached}",
            String(deck.milestones.reachedCount)
          )}
        </span>
      </div>

      {/* 5-domain health grid */}
      <div className="glass-surface rounded-panel p-6 mb-4">
        <div className="grid grid-cols-5 gap-4">
          {DOMAINS.map((d, i) => {
            const domain = deck.milestones.domains[d];
            const color = DOT_COLOR[domain.status];
            return (
              <motion.div
                key={d}
                className="flex flex-col items-center gap-2 text-center"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.2,
                  ease: CAL_EASE,
                  delay: 0.1 + i * 0.05,
                }}
              >
                <span className="font-mono text-micro uppercase tracking-wider text-text-3">
                  {t(`sections.milestones.domains.${d}`)}
                </span>
                <div
                  className="rounded-full"
                  style={{
                    width: 12,
                    height: 12,
                    backgroundColor: color,
                  }}
                  aria-hidden="true"
                />
                <span
                  className="font-mono text-micro uppercase tracking-wider"
                  style={{ color }}
                >
                  {t(`sections.milestones.statuses.${domain.status}`)}
                </span>
                {domain.metric && (
                  <span className="font-mohave text-body tabular-nums text-text-2">
                    {domain.metric}
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* 9-step ladder */}
      <div className="glass-surface rounded-panel p-4">
        <ol className="flex flex-col gap-0.5" aria-label="Autonomy ladder">
          {deck.milestones.ladder.map((l, i) => {
            const key = `${l.position}`;
            const isPulsing = pulsePosition === l.position;
            return (
              <motion.li
                key={key}
                id={`milestone-${l.position}`}
                className={cn(
                  "grid grid-cols-[36px_40px_1fr_140px] items-center px-4 py-3 rounded-sidebar transition-colors",
                  l.status === "complete" && "text-text",
                  l.status === "in_training" && "text-text-2",
                  l.status === "gated" && "text-text-3"
                )}
                initial={{ opacity: 0, y: 4 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  backgroundColor: isPulsing
                    ? "rgba(111, 148, 176, 0.12)"
                    : "transparent",
                }}
                transition={{
                  duration: 0.2,
                  ease: CAL_EASE,
                  delay: 0.15 + i * 0.03,
                  backgroundColor: { duration: 0.24 },
                }}
              >
                <span className="font-mono text-data-sm tabular-nums text-text-mute">
                  {String(l.position).padStart(2, "0")}
                </span>
                <span
                  className="font-mohave text-[18px] leading-none"
                  style={{ color: LADDER_COLOR[l.status] }}
                  aria-hidden="true"
                >
                  {LADDER_GLYPH[l.status]}
                </span>
                <span className="font-cakemono font-light uppercase text-[15px]">
                  {t(`sections.milestones.ladder.${l.position}`)}
                </span>
                <span
                  className="font-mono text-micro uppercase tracking-wider justify-self-end"
                  style={{ color: LADDER_COLOR[l.status] }}
                >
                  {t(
                    `sections.milestones.ladderStatuses.${LADDER_STATUS_KEY[l.status]}`
                  )}
                </span>
              </motion.li>
            );
          })}
        </ol>
      </div>

      <AnimatePresence>
        {pulsePosition !== null && (
          <motion.div
            key={`pulse-overlay-${pulsePosition}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed top-20 right-6 z-[2000] pointer-events-none"
          >
            <div className="glass-dense rounded-modal px-4 py-2">
              <span
                className="font-mono text-micro uppercase tracking-wider"
                style={{ color: "#6F94B0" }}
              >
                SYS :: AUTONOMY UNLOCK
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
