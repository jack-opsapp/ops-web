"use client";

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

// ─── Component ──────────────────────────────────────────────────────────────

export function MonthEventBar({
  event,
  displayLevel,
  span,
  onClick,
}: MonthEventBarProps) {
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
        className="cursor-pointer transition-opacity duration-100 hover:opacity-80 shrink-0"
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: colors.border,
        }}
        onClick={handleClick}
        title={event.project || event.title}
      />
    );
  }

  // ── Level 2: Standard — short bar with single-line title ──
  if (displayLevel === "standard") {
    return (
      <div
        className="cursor-pointer transition-all duration-100 hover:brightness-125 truncate"
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
          overflow: "hidden",
        }}
        onClick={handleClick}
        title={event.project || event.title}
      >
        <span
          className="font-mohave truncate"
          style={{ fontSize: 11, lineHeight: "14px" }}
        >
          {event.project || event.title}
        </span>
      </div>
    );
  }

  // ── Level 3: Expanded ──

  // Multi-day events stay 14px even at expanded level
  if (!span.isSingleDay) {
    return (
      <div
        className="cursor-pointer transition-all duration-100 hover:brightness-125 truncate"
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
          overflow: "hidden",
        }}
        onClick={handleClick}
        title={event.project || event.title}
      >
        <span
          className="font-mohave truncate"
          style={{ fontSize: 11, lineHeight: "14px" }}
        >
          {event.project || event.title}
        </span>
      </div>
    );
  }

  // Single-day expanded: 42px tall, 2 lines (project name + task type)
  return (
    <div
      className="cursor-pointer transition-all duration-100 hover:brightness-125 overflow-hidden"
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
      }}
      onClick={handleClick}
      title={event.project || event.title}
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
    </div>
  );
}
