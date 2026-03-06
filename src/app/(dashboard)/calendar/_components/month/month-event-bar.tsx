"use client";

import { useState } from "react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { type InternalCalendarEvent, getEventColors } from "@/lib/utils/calendar-utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DisplayLevel = "compact" | "standard" | "expanded";

export interface MonthEventBarSpan {
  startDayIndex: number;   // 0-6 within the week
  endDayIndex: number;     // 0-6
  isFirstSegment: boolean; // first week of multi-day
  isLastSegment: boolean;  // last week of multi-day
  isSingleDay: boolean;
}

interface MonthEventBarProps {
  event: InternalCalendarEvent;
  displayLevel: DisplayLevel;
  span: MonthEventBarSpan;
  onClick?: (event: InternalCalendarEvent) => void;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

const tooltipVariants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
};

function EventTooltip({ event }: { event: InternalCalendarEvent }) {
  const colors = getEventColors(event.taskType);
  const dateRangeStr = `${format(event.startDate, "MMM d")} - ${format(event.endDate, "MMM d, yyyy")}`;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={tooltipVariants}
      transition={{ duration: 0.15 }}
      className="absolute z-50 pointer-events-none"
      style={{
        bottom: "calc(100% + 6px)",
        left: 0,
        minWidth: 180,
        maxWidth: 240,
        background: "rgba(10, 10, 10, 0.70)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 3,
        padding: "8px 10px",
      }}
    >
      {/* Project name */}
      <div
        className="font-mohave font-semibold text-[12px] leading-tight truncate"
        style={{ color: "#FFFFFF" }}
      >
        {event.project || event.title}
      </div>

      {/* Divider */}
      <div
        className="my-[4px]"
        style={{ height: 1, background: "rgba(255, 255, 255, 0.08)" }}
      />

      {/* Task type */}
      <div className="flex items-center gap-[6px]">
        <div
          className="w-[6px] h-[6px] rounded-[1px] shrink-0"
          style={{ background: colors.border }}
        />
        <span
          className="font-kosugi text-[10px] uppercase tracking-wider leading-tight"
          style={{ color: colors.text }}
        >
          {event.taskType.toUpperCase()}
        </span>
      </div>

      {/* Date range */}
      <div
        className="font-kosugi text-[10px] uppercase tracking-wider leading-tight mt-[3px]"
        style={{ color: "#999999" }}
      >
        {dateRangeStr}
      </div>
    </motion.div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MonthEventBar({
  event,
  displayLevel,
  span,
  onClick,
}: MonthEventBarProps) {
  const [isHovered, setIsHovered] = useState(false);
  const colors = getEventColors(event.taskType);

  // Corner rounding logic for multi-day bars
  const borderRadius = (() => {
    if (span.isSingleDay) return "3px";
    const left = span.isFirstSegment ? "3px" : "0px";
    const right = span.isLastSegment ? "3px" : "0px";
    return `${left} ${right} ${right} ${left}`;
  })();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(event);
  };

  // ── Level 1: Compact — color dot only ──
  if (displayLevel === "compact") {
    return (
      <div
        className="cursor-pointer transition-opacity duration-100 hover:opacity-80 shrink-0 relative"
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: colors.border,
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <AnimatePresence>
          {isHovered && <EventTooltip event={event} />}
        </AnimatePresence>
      </div>
    );
  }

  // ── Level 2: Standard — short bar with single-line title ──
  if (displayLevel === "standard") {
    return (
      <div
        className="cursor-pointer transition-all duration-100 hover:brightness-125 truncate relative"
        style={{
          height: 14,
          backgroundColor: colors.bg,
          borderLeft: span.isFirstSegment || span.isSingleDay ? `2px solid ${colors.border}` : undefined,
          borderRadius,
          color: colors.text,
          paddingLeft: 4,
          paddingRight: 4,
          display: "flex",
          alignItems: "center",
          overflow: "visible",
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span
          className="font-mohave truncate"
          style={{ fontSize: 11, lineHeight: "14px" }}
        >
          {event.project || event.title}
        </span>
        <AnimatePresence>
          {isHovered && <EventTooltip event={event} />}
        </AnimatePresence>
      </div>
    );
  }

  // ── Level 3: Expanded ──

  // Multi-day events stay 14px even at expanded level
  if (!span.isSingleDay) {
    return (
      <div
        className="cursor-pointer transition-all duration-100 hover:brightness-125 truncate relative"
        style={{
          height: 14,
          backgroundColor: colors.bg,
          borderLeft: span.isFirstSegment ? `2px solid ${colors.border}` : undefined,
          borderRadius,
          color: colors.text,
          paddingLeft: 4,
          paddingRight: 4,
          display: "flex",
          alignItems: "center",
          overflow: "visible",
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span
          className="font-mohave truncate"
          style={{ fontSize: 11, lineHeight: "14px" }}
        >
          {event.project || event.title}
        </span>
        <AnimatePresence>
          {isHovered && <EventTooltip event={event} />}
        </AnimatePresence>
      </div>
    );
  }

  // Single-day expanded: 42px tall, 2 lines (project name + task type)
  return (
    <div
      className="cursor-pointer transition-all duration-100 hover:brightness-125 relative"
      style={{
        height: 42,
        backgroundColor: colors.bg,
        borderLeft: `2px solid ${colors.border}`,
        borderRadius: "3px",
        color: colors.text,
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 2,
        paddingBottom: 2,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        overflow: "visible",
      }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span
        className="font-mohave truncate"
        style={{ fontSize: 11, lineHeight: "14px" }}
      >
        {event.project || event.title}
      </span>
      <span
        className="font-kosugi uppercase truncate"
        style={{ fontSize: 9, lineHeight: "12px", color: "#999999", letterSpacing: "0.08em" }}
      >
        {event.taskType}
      </span>
      <AnimatePresence>
        {isHovered && <EventTooltip event={event} />}
      </AnimatePresence>
    </div>
  );
}
