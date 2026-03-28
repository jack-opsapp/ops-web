"use client";

import { useMemo, useCallback, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { useCalendarStore } from "@/stores/calendar-store";

// ── Types ──────────────────────────────────────────────────────────────────

type TimeOffStatus = "pending" | "approved" | "denied";

interface DayTimeOffCardProps {
  event: InternalCalendarEvent;
  index: number;
  status?: TimeOffStatus;
  reason?: string;
}

// ── Status color map ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<TimeOffStatus, string> = {
  pending: "#999999",
  approved: "#A5B368",
  denied: "#93321A",
};

// ── Component ──────────────────────────────────────────────────────────────

export function DayTimeOffCard({
  event,
  index,
  status = "pending",
  reason,
}: DayTimeOffCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const setSidePanelTask = useCalendarStore((s) => s.setSidePanelTask);

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
      initial={{ y: 14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.22, ease: "easeOut", delay: index * 0.06 }}
      className="cursor-pointer"
      style={{
        minHeight: 52,
        borderRadius: 2,
        background: "rgba(196, 168, 104, 0.12)",
        border: `1px solid rgba(196, 168, 104, ${isHovered ? 0.5 : 0.35})`,
        padding: "14px 16px",
        transition: "border-color 0.15s ease-out",
      }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Line 1: Title + Status badge */}
      <div className="flex items-center justify-between min-w-0">
        <span
          className="font-mohave font-semibold text-[15px] uppercase truncate leading-tight"
          style={{ color: "#FFFFFF" }}
        >
          TIME OFF REQUEST
        </span>

        {/* Status badge */}
        <div
          className="shrink-0 flex items-center px-[6px] py-[2px] font-kosugi text-[9px] uppercase tracking-wider leading-tight ml-[8px]"
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
          className="font-kosugi text-[11px] leading-tight"
          style={{ color: "rgba(255, 255, 255, 0.45)" }}
        >
          {dateRange}
        </span>
      </div>

      {/* Line 3: Reason (optional) */}
      {reason && (
        <div className="mt-[4px]">
          <span
            className="font-kosugi text-[11px] leading-tight"
            style={{ color: "#999999" }}
          >
            {reason}
          </span>
        </div>
      )}
    </motion.div>
  );
}
