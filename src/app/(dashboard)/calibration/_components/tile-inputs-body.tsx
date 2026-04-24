"use client";

import { motion } from "framer-motion";
import { ProgressRing } from "./progress-ring";
import { useDictionary } from "@/i18n/client";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import type { DeckState, InputStatus } from "@/lib/types/calibration";

interface Props {
  inputs: DeckState["inputs"];
}

const COLOR_BY_STATUS: Record<InputStatus, string> = {
  complete: "#9DB582",
  running: "#C4A868",
  failed: "#B58289",
  not_run: "#6A6A6A",
  skipped: "#6A6A6A",
};

export function TileInputsBody({ inputs }: Props) {
  const { t } = useDictionary("calibration");
  const sources: Array<{
    key: "interview" | "scan" | "mining";
    state: DeckState["inputs"]["interview"];
    label: string;
  }> = [
    {
      key: "interview",
      state: inputs.interview,
      label: t("tiles.inputs.labels.interview"),
    },
    {
      key: "scan",
      state: inputs.scan,
      label: t("tiles.inputs.labels.scan"),
    },
    {
      key: "mining",
      state: inputs.mining,
      label: t("tiles.inputs.labels.mining"),
    },
  ];

  return (
    <div className="flex items-center justify-around gap-3 h-full">
      {sources.map((s, i) => (
        <motion.div
          key={s.key}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.15,
            ease: CAL_EASE,
            delay: 0.15 + i * 0.12,
          }}
          className="flex flex-col items-center gap-2"
        >
          <ProgressRing
            percent={s.state.percent}
            size={44}
            stroke={3}
            color={COLOR_BY_STATUS[s.state.status]}
            label={`${s.label} ${s.state.percent}%`}
          >
            <span
              className="font-mohave font-light text-body leading-none"
              style={{ color: COLOR_BY_STATUS[s.state.status] }}
            >
              {s.state.percent}%
            </span>
          </ProgressRing>
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {s.label}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
