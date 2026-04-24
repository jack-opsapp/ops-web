"use client";

import { useDictionary } from "@/i18n/client";
import type { DeckState } from "@/lib/types/calibration";

interface Props {
  activity: DeckState["activity"];
}

function formatElapsed(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function TileActivityBody({ activity }: Props) {
  const { t } = useDictionary("calibration");

  if (activity.status === "running" && activity.currentJob) {
    const { type, elapsedMs, progress } = activity.currentJob;
    const percent =
      progress && progress.total > 0
        ? Math.round((progress.processed / progress.total) * 100)
        : 0;
    return (
      <div className="flex flex-col gap-2 h-full justify-center">
        <span
          className="font-cakemono font-light uppercase text-[20px] leading-none"
          style={{ color: "#C4A868" }}
        >
          {type} · {formatElapsed(elapsedMs)}
        </span>
        {progress && (
          <>
            <div
              className="rounded-bar bg-[rgba(255,255,255,0.06)]"
              style={{ height: 4 }}
            >
              <div
                className="rounded-bar h-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${percent}%`,
                  backgroundColor: "#C4A868",
                }}
              />
            </div>
            <span className="font-mono text-data-sm text-text-2 tabular-nums">
              {progress.processed.toLocaleString()} /{" "}
              {progress.total.toLocaleString()} threads
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 h-full justify-center">
      <span
        className="font-cakemono font-light uppercase text-[20px] leading-none"
        style={{ color: "#9DB582" }}
      >
        {t("tiles.activity.idleLabel")}
      </span>
      <span className="font-mono text-micro uppercase tracking-wider text-text-3">
        Last 24h: {activity.completedTodayCount} events ·{" "}
        {activity.queuedCount} queued
      </span>
    </div>
  );
}
