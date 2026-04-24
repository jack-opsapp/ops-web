"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import type { InputState, InputStatus } from "@/lib/types/calibration";
import { useDictionary } from "@/i18n/client";

interface Props {
  source: "interview" | "scan" | "mining";
  state: InputState;
  isExpanded: boolean;
  onEngage: () => void;
  onSkip: () => void;
  children?: React.ReactNode;
}

const GLYPH: Record<InputStatus, string> = {
  not_run: "◯",
  running: "◐",
  complete: "●",
  failed: "⊗",
  skipped: "⊗",
};

const GLYPH_COLOR: Record<InputStatus, string> = {
  not_run: "#8A8A8A",
  running: "#C4A868",
  complete: "#9DB582",
  failed: "#B58289",
  skipped: "#6A6A6A",
};

export function FirstRunStation({
  source,
  state,
  isExpanded,
  onEngage,
  onSkip,
  children,
}: Props) {
  const { t } = useDictionary("calibration");
  const done = state.status === "complete" || state.status === "skipped";
  const busy = state.status === "running";

  const stationKey =
    source === "scan"
      ? "emailScan"
      : source === "mining"
        ? "databaseMining"
        : "interview";
  const title = t(`firstRun.stations.${stationKey}.title`);
  const description = t(`firstRun.stations.${stationKey}.description`);

  return (
    <motion.div
      className="glass-surface rounded-panel overflow-hidden"
      animate={{ height: isExpanded ? "auto" : done ? 48 : "auto" }}
      transition={{ duration: 0.3, ease: CAL_EASE }}
    >
      <div
        className={cn(
          "flex items-center gap-3 p-6",
          done && !isExpanded && "py-2 px-6"
        )}
      >
        <span
          className="font-mohave text-[18px] leading-none"
          style={{ color: GLYPH_COLOR[state.status], width: 20 }}
          aria-hidden="true"
        >
          {GLYPH[state.status]}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-cakemono font-light uppercase text-[20px] leading-tight text-text">
            {title}
          </h3>
          {!done && (
            <p className="font-mohave text-body-sm text-text-2 mt-1 max-w-[560px]">
              {description}
            </p>
          )}
        </div>
        {!busy && !done && !isExpanded && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onEngage}
              className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors"
            >
              {t(`firstRun.stations.${stationKey}.actionEngage`)}
            </button>
            <button
              onClick={onSkip}
              className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] text-text-mute hover:text-text-2 transition-colors"
            >
              {t(`firstRun.stations.${stationKey}.actionSkip`)}
            </button>
          </div>
        )}
      </div>
      <AnimatePresence>
        {isExpanded && children && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-6 pb-6"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
