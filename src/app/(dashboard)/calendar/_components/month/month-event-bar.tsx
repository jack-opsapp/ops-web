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
        background: "var(--surface-glass)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
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
          className="font-mono text-micro uppercase tracking-wider leading-tight"
          style={{ color: colors.text }}
        >
          {event.taskType.toUpperCase()}
        </span>
      </div>

      {/* Date range */}
      <div
        className="font-mono text-micro uppercase tracking-wider leading-tight mt-[3px]"
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

  // Spec v2: event bars follow chip radii (4px). Multi-day bars square off
  // the interior corners so consecutive weeks read as one continuous strip.
  const borderRadius = (() => {
    if (span.isSingleDay) return "4px";
    const left = span.isFirstSegment ? "4px" : "0px";
    const right = span.isLastSegment ? "4px" : "0px";
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
  // Use inset box-shadow (not borderLeft) so the accent stripe respects the
  // bar's rounded corners instead of clipping against them — that corner
  // clip is the "funny" left-edge line the bug flagged.
  if (displayLevel === "standard") {
    return (
      <div
        className="cursor-pointer transition-all duration-100 hover:brightness-125 truncate relative"
        style={{
          height: 14,
          backgroundColor: colors.bg,
          boxShadow:
            span.isFirstSegment || span.isSingleDay
              ? `inset 3px 0 0 0 ${colors.border}`
              : undefined,
          borderRadius,
          color: colors.text,
          paddingLeft: span.isFirstSegment || span.isSingleDay ? 7 : 4,
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
          boxShadow: span.isFirstSegment
            ? `inset 3px 0 0 0 ${colors.border}`
            : undefined,
          borderRadius,
          color: colors.text,
          paddingLeft: span.isFirstSegment ? 7 : 4,
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
        boxShadow: `inset 3px 0 0 0 ${colors.border}`,
        borderRadius: "4px",
        color: colors.text,
        paddingLeft: 7,
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
        className="font-mono uppercase truncate"
        style={{
          fontSize: 9,
          lineHeight: "12px",
          color: "var(--text-3, #8A8A8A)",
          letterSpacing: "0.08em",
        }}
      >
        {event.taskType}
      </span>
      <AnimatePresence>
        {isHovered && <EventTooltip event={event} />}
      </AnimatePresence>
    </div>
  );
}
