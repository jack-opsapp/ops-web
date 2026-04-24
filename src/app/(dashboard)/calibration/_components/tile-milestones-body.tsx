"use client";

import { motion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import type {
  DeckState,
  DomainHealthStatus,
} from "@/lib/types/calibration";

interface Props {
  milestones: DeckState["milestones"];
}

const DOT_COLOR: Record<DomainHealthStatus, string> = {
  nominal: "#9DB582",
  learning: "#C4A868",
  gated: "#6A6A6A",
  unavailable: "#6A6A6A",
};

const DOMAINS = ["email", "projects", "invoice", "schedule", "comms"] as const;

export function TileMilestonesBody({ milestones }: Props) {
  const { t } = useDictionary("calibration");
  return (
    <div className="grid grid-cols-5 gap-3 h-full items-center">
      {DOMAINS.map((d, i) => {
        const domain = milestones.domains[d];
        const color = DOT_COLOR[domain.status];
        return (
          <motion.div
            key={d}
            className="flex flex-col items-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15, ease: CAL_EASE, delay: 0.2 + i * 0.05 }}
          >
            <span className="font-mono text-micro uppercase tracking-wider text-text-3">
              {t(`tiles.milestones.domains.${d}`)}
            </span>
            <motion.div
              className="rounded-full"
              style={{
                width: 10,
                height: 10,
                backgroundColor: color,
              }}
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: [0.3, 1.15, 1], opacity: 1 }}
              transition={{
                duration: 0.2,
                ease: CAL_EASE,
                delay: 0.25 + i * 0.05,
              }}
            />
            <span
              className="font-mono text-micro uppercase tracking-wider"
              style={{ color }}
            >
              {t(`tiles.milestones.statuses.${domain.status}`)}
            </span>
            {domain.metric && (
              <span className="font-mohave text-body-sm tabular-nums text-text-2">
                {domain.metric}
              </span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
