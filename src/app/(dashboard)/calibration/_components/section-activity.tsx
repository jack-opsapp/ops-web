"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { useCalibrationDeck } from "./hooks/use-calibration-deck";
import { useCalibrationActivity } from "./hooks/use-calibration-activity";
import { SectionBreadcrumb } from "./section-breadcrumb";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import type {
  ActivityFilters,
  RecentEventType,
} from "@/lib/types/calibration";
import { cn } from "@/lib/utils/cn";

const FILTER_CHIPS: Array<{
  key: string;
  label: string;
  types: RecentEventType[] | "all";
}> = [
  { key: "all", label: "ALL", types: "all" },
  { key: "scans", label: "SCANS", types: ["scan", "scan_complete"] },
  { key: "extractions", label: "EXTRACTIONS", types: ["extraction"] },
  { key: "learnings", label: "LEARNINGS", types: ["learning"] },
  { key: "drafts", label: "DRAFTS", types: ["draft"] },
  { key: "suggestions", label: "SUGGESTIONS", types: ["suggestion"] },
];

const TIME_RANGES: Array<{
  key: ActivityFilters["timeRange"];
  labelKey: string;
}> = [
  { key: "hour", labelKey: "hour" },
  { key: "day", labelKey: "day" },
  { key: "week", labelKey: "week" },
  { key: "month", labelKey: "month" },
  { key: "all", labelKey: "all" },
];

function eventColor(type: RecentEventType): string {
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

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

export function SectionActivity() {
  const { t } = useDictionary("calibration");
  const { data: deck } = useCalibrationDeck();

  const [filterKey, setFilterKey] = useState<string>("all");
  const [timeRange, setTimeRange] =
    useState<ActivityFilters["timeRange"]>("day");

  const filters = useMemo<ActivityFilters>(() => {
    const chip = FILTER_CHIPS.find((f) => f.key === filterKey) ?? FILTER_CHIPS[0];
    return { types: chip.types, timeRange };
  }, [filterKey, timeRange]);

  const { data, isLoading } = useCalibrationActivity(filters, undefined, 100);

  const events = data?.events ?? [];

  return (
    <div className="px-11 py-9 max-w-[1320px] mx-auto">
      <SectionBreadcrumb currentSection="activity" />
      <h2 className="font-cakemono font-light uppercase text-[22px] text-text mb-4">
        <span className="text-text-mute mr-2">{"//"}</span>ACTIVITY
      </h2>

      {/* Live sensor strip */}
      <div className="glass-surface rounded-panel px-6 py-4 mb-4 flex items-center justify-between">
        {deck?.activity.status === "running" && deck.activity.currentJob ? (
          <span
            className="font-cakemono font-light uppercase text-[20px] leading-none"
            style={{ color: "#C4A868" }}
          >
            {deck.activity.currentJob.type} ·{" "}
            {Math.floor(deck.activity.currentJob.elapsedMs / 60000)}m
          </span>
        ) : deck?.activity.status === "error" ? (
          <span
            className="font-cakemono font-light uppercase text-[20px] leading-none"
            style={{ color: "#B58289" }}
          >
            {t("sections.activity.liveSensor.error")}
          </span>
        ) : (
          <span
            className="font-cakemono font-light uppercase text-[20px] leading-none"
            style={{ color: "#9DB582" }}
          >
            {t("sections.activity.liveSensor.nominal")}
          </span>
        )}
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          QUEUED {deck?.activity.queuedCount ?? 0} · COMPLETED{" "}
          {deck?.activity.completedTodayCount ?? 0} TODAY
        </span>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-1 flex-wrap">
          {FILTER_CHIPS.map((chip) => {
            const active = filterKey === chip.key;
            return (
              <button
                key={chip.key}
                onClick={() => setFilterKey(chip.key)}
                className={cn(
                  "px-3 py-1.5 rounded-chip font-mono text-micro uppercase tracking-wider transition-colors",
                  active
                    ? "bg-[rgba(255,255,255,0.08)] text-text border border-[rgba(255,255,255,0.14)]"
                    : "text-text-3 border border-transparent hover:text-text-2"
                )}
              >
                {t(`sections.activity.filters.${chip.key}`)}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {TIME_RANGES.map((tr) => {
            const active = timeRange === tr.key;
            return (
              <button
                key={tr.key}
                onClick={() => setTimeRange(tr.key)}
                className={cn(
                  "px-3 py-1.5 rounded-chip font-mono text-micro uppercase tracking-wider transition-colors",
                  active
                    ? "bg-[rgba(255,255,255,0.08)] text-text border border-[rgba(255,255,255,0.14)]"
                    : "text-text-3 border border-transparent hover:text-text-2"
                )}
              >
                {t(`sections.activity.timeRanges.${tr.labelKey}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Log table */}
      <div className="glass-surface rounded-panel overflow-hidden">
        <div className="grid grid-cols-[140px_140px_160px_1fr] px-4 py-2.5 border-b border-[rgba(255,255,255,0.08)]">
          <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
            {t("sections.activity.columns.time")}
          </span>
          <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
            {t("sections.activity.columns.type")}
          </span>
          <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
            {t("sections.activity.columns.source")}
          </span>
          <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
            {t("sections.activity.columns.detail")}
          </span>
        </div>

        {isLoading && events.length === 0 ? (
          <div className="p-8 text-center">
            <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
              SYS :: LOADING
            </span>
          </div>
        ) : events.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-3 text-center">
            <h3 className="font-cakemono font-light uppercase text-[18px] text-text">
              {t("sections.activity.empty.heading")}
            </h3>
            <p className="font-mohave text-body-sm text-text-2 max-w-[480px]">
              {t("sections.activity.empty.body")}
            </p>
            <a
              href="/calibration?section=inputs"
              className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors"
            >
              {t("sections.activity.empty.cta")}
            </a>
          </div>
        ) : (
          <div className="max-h-[640px] overflow-y-auto scrollbar-hide">
            {events.map((e, i) => (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.15,
                  ease: CAL_EASE,
                  delay: Math.min(i * 0.02, 0.3),
                }}
                className="grid grid-cols-[140px_140px_160px_1fr] px-4 py-2.5 border-b border-[rgba(255,255,255,0.04)] last:border-b-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
              >
                <span className="font-mono text-micro tabular-nums text-text-3">
                  {fmtTime(e.createdAt)}
                </span>
                <span
                  className="font-mono text-micro uppercase tracking-wider"
                  style={{ color: eventColor(e.type) }}
                >
                  {e.title}
                </span>
                <span className="font-mono text-micro uppercase tracking-wider text-text-mute truncate">
                  {e.sourceTable}
                </span>
                <span className="font-mohave text-body-sm text-text-2 truncate">
                  {e.detail ?? "—"}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
