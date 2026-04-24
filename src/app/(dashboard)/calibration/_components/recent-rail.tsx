"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import { useCalibrationRecent } from "./hooks/use-calibration-recent";
import { useRouter } from "next/navigation";
import type { RecentEventType } from "@/lib/types/calibration";

function colorForEvent(type: RecentEventType): string {
  switch (type) {
    case "scan":
    case "scan_complete":
      return "#9DB582";
    case "extraction":
    case "learning":
      return "#C4A868";
    case "confidence":
    case "milestone":
      return "#6F94B0";
    default:
      return "#B5B5B5";
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

export function RecentRail() {
  const { t } = useDictionary("calibration");
  const events = useCalibrationRecent();
  const router = useRouter();
  const reduced = useReducedMotion();

  return (
    <div
      className="deck-recent-rail glass-surface rounded-panel h-[56px] flex items-center px-5 gap-4 overflow-hidden"
      role="log"
      aria-label="Recent activity"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          <span className="text-text-mute mr-[6px]">//</span>
          {t("recent.title").slice(3).trim()}
        </span>
        <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
          {t("recent.stream")}
        </span>
      </div>

      {events.length === 0 ? (
        <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
          {t("recent.empty")}
        </span>
      ) : (
        <AnimatePresence mode="popLayout">
          {events.map((e) => (
            <motion.button
              key={e.id}
              layout
              initial={{ opacity: 0, x: reduced ? 0 : -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reduced ? 0 : 12 }}
              transition={{
                duration: reduced ? 0.15 : 0.25,
                ease: CAL_EASE,
              }}
              className="shrink-0 font-mono text-micro uppercase tracking-wider text-text-2 px-2 py-1 rounded-chip border border-[rgba(255,255,255,0.08)] hover:bg-surface-hover transition-colors"
              onClick={() =>
                router.push(`/calibration?section=activity&event=${e.id}`)
              }
            >
              <span className="text-text-mute mr-1">SYS ::</span>
              <span style={{ color: colorForEvent(e.type) }}>{e.title}</span>
              <span className="text-text-mute ml-2">
                · {formatTime(e.createdAt)}
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
