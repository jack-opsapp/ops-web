"use client";

import { useMemo, useCallback, useState } from "react";
import { format } from "date-fns";
import { motion, useReducedMotion } from "framer-motion";
import type { InternalScheduleEvent } from "@/lib/utils/schedule-utils";
import { useScheduleStore } from "@/stores/schedule-store";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";

// ── Types ──────────────────────────────────────────────────────────────────

type TimeOffStatus = "pending" | "approved" | "denied";

interface DayTimeOffCardProps {
  event: InternalScheduleEvent;
  index: number;
  status?: TimeOffStatus;
  reason?: string;
}

// ── Status color map ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<TimeOffStatus, string> = {
  pending: "var(--text-3)",
  approved: "var(--olive)",
  denied: "var(--brick)",
};

// ── Component ──────────────────────────────────────────────────────────────

export function DayTimeOffCard({
  event,
  index,
  status = "pending",
  reason,
}: DayTimeOffCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const setSidePanelTask = useScheduleStore((s) => s.setSidePanelTask);
  const reducedMotion = useReducedMotion();
  const { t } = useDictionary("schedule");

  // ── Date formatting ───────────────────────────────────────────────────

  const dateRange = useMemo(() => {
    const start = format(event.startDate, "MMM d");
    const end = format(event.endDate, "MMM d, yyyy");
    return `${start} - ${end}`;
  }, [event.startDate, event.endDate]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleClick = useCallback(() => {
    setSidePanelTask(event.id);
  }, [event.id, setSidePanelTask]);

  // ── Status label and color ────────────────────────────────────────────

  const statusLabel = status.toUpperCase();
  const statusColor = STATUS_COLORS[status];

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={reducedMotion ? { opacity: 0 } : { y: 14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{
        duration: reducedMotion ? 0.15 : 0.22,
        ease: EASE_SMOOTH,
        delay: reducedMotion ? 0 : index * 0.06,
      }}
      className="cursor-pointer"
      style={{
        minHeight: 52,
        borderRadius: 2,
        background: "var(--tan-soft)",
        border: `1px solid rgba(196, 168, 104, ${isHovered ? 0.5 : 0.35})`,
        padding: "14px 16px",
        transition: "border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Line 1: Title + Status badge */}
      <div className="flex items-center justify-between min-w-0">
        <span
          className="font-cakemono font-light text-[15px] uppercase truncate leading-tight"
          style={{ color: "#FFFFFF" }}
        >
          {t("grid.timeOffRequest")}
        </span>

        {/* Status badge */}
        <div
          className="shrink-0 flex items-center px-[6px] py-[2px] font-mono text-micro uppercase tracking-[0.16em] leading-tight ml-[8px]"
          style={{
            color: statusColor,
            borderRadius: 2,
            border: `1px solid ${statusColor}`,
            background: "rgba(0, 0, 0, 0.2)",
          }}
        >
          {statusLabel}
        </div>
      </div>

      {/* Line 2: Date range */}
      <div className="mt-[4px]">
        <span
          className="font-mono text-[11px] leading-tight"
          style={{ color: "rgba(255, 255, 255, 0.45)" }}
        >
          {dateRange}
        </span>
      </div>

      {/* Line 3: Reason (optional) */}
      {reason && (
        <div className="mt-[4px]">
          <span
            className="font-mono text-[11px] leading-tight"
            style={{ color: "var(--text-3)" }}
          >
            {reason}
          </span>
        </div>
      )}
    </motion.div>
  );
}
