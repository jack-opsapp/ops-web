"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import type { DeckState } from "@/lib/types/calibration";

interface Props {
  config: DeckState["config"];
}

const ORDER = ["auto_send", "auto_draft", "draft", "off"] as const;
const COLOR: Record<(typeof ORDER)[number], string> = {
  auto_send: "#9DB582",
  auto_draft: "#B5B5B5",
  draft: "#8A8A8A",
  off: "#6A6A6A",
};

function labelKeyFor(level: (typeof ORDER)[number]) {
  if (level === "auto_send") return "autoSend";
  if (level === "auto_draft") return "autoDraft";
  return level;
}

export function TileConfigBody({ config }: Props) {
  const { t } = useDictionary("calibration");
  const reduced = useReducedMotion();
  const total =
    Object.values(config.emailTypeCounts).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="flex flex-col gap-[6px] h-full justify-center pr-2">
      {ORDER.map((level, i) => {
        const count = config.emailTypeCounts[level];
        const pct = (count / total) * 100;
        return (
          <div key={level} className="flex items-center gap-2">
            <span
              className="font-mono text-micro uppercase tracking-wider text-text-3 shrink-0"
              style={{ width: 88 }}
            >
              {t(`tiles.config.barLabels.${labelKeyFor(level)}`)}
            </span>
            <div
              className="relative rounded-bar bg-[rgba(255,255,255,0.06)]"
              style={{ width: 140, height: 6 }}
            >
              <motion.div
                className="rounded-bar h-full"
                style={{ backgroundColor: COLOR[level] }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{
                  duration: reduced ? 0 : 0.4,
                  ease: CAL_EASE,
                  delay: reduced ? 0 : 0.15 + i * 0.08,
                }}
              />
            </div>
            <span
              className="font-mono text-data-sm tabular-nums ml-auto"
              style={{ color: COLOR[level] }}
            >
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
