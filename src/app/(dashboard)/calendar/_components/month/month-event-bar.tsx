"use client";

import { useState } from "react";
import { format } from "date-fns";
import { type InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { EventHoverPopover } from "../event-hover-popover";

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
  const [isHovered, setIsHovered] = useState(false);

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

  // ── Stripe accent — sibling div, NOT box-shadow (avoids crescent at radius corners) ──
  const StripeAccent = (visible: boolean) =>
    visible ? (
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: event.typeColors.border,
          borderRadius: "4px 0 0 4px",
          pointerEvents: "none",
        }}
      />
    ) : null;

  // ── Level 1: Compact — color dot only (no stripe — leave as-is) ──
  if (displayLevel === "compact") {
    return (
      <EventHoverPopover event={event} side="top">
        <div
          className="cursor-pointer transition-opacity duration-100 hover:opacity-80 shrink-0"
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: event.typeColors.border,
          }}
          onClick={handleClick}
        />
      </EventHoverPopover>
    );
  }

  // ── Level 2: Standard — short bar with single-line title ──
  if (displayLevel === "standard") {
    const showStripe = span.isFirstSegment || span.isSingleDay;
    return (
      <EventHoverPopover event={event} side="top">
        <div
          className="cursor-pointer truncate relative"
          style={{
            height: 14,
            background: event.typeColors.bg,
            border: `1px solid ${event.typeColors.border}`,
            borderRadius,
            color: event.typeColors.text,
            paddingLeft: showStripe ? 7 : 4,
            paddingRight: 4,
            display: "flex",
            alignItems: "center",
            overflow: "visible",
            transition: "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: isHovered ? "brightness(1.18)" : "none",
          }}
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {StripeAccent(showStripe)}
          <span
            className="font-mohave truncate"
            style={{ fontSize: 11, lineHeight: "14px", color: "var(--text)" }}
          >
            {event.projectTitle ?? event.taskTitle}
          </span>
        </div>
      </EventHoverPopover>
    );
  }

  // ── Level 3: Expanded ──

  // Multi-day events stay 14px even at expanded level
  if (!span.isSingleDay) {
    const showStripe = span.isFirstSegment;
    return (
      <EventHoverPopover event={event} side="top">
        <div
          className="cursor-pointer truncate relative"
          style={{
            height: 14,
            background: event.typeColors.bg,
            border: `1px solid ${event.typeColors.border}`,
            borderRadius,
            color: event.typeColors.text,
            paddingLeft: showStripe ? 7 : 4,
            paddingRight: 4,
            display: "flex",
            alignItems: "center",
            overflow: "visible",
            transition: "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: isHovered ? "brightness(1.18)" : "none",
          }}
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {StripeAccent(showStripe)}
          <span
            className="font-mohave truncate"
            style={{ fontSize: 11, lineHeight: "14px", color: "var(--text)" }}
          >
            {event.projectTitle ?? event.taskTitle}
          </span>
        </div>
      </EventHoverPopover>
    );
  }

  // Single-day expanded: 42px tall, 2 lines + badge
  const subtitle =
    event.projectTitle && event.taskTitle !== event.projectTitle
      ? event.taskTitle
      : null;

  // Phase 3 — show time range only when not all-day
  const timeLabel = event.allDay
    ? null
    : `${format(event.startDate, "HH:mm")} → ${format(event.endDate, "HH:mm")}`;

  return (
    <EventHoverPopover event={event} side="top">
      <div
        className="cursor-pointer relative"
        style={{
          height: 42,
          background: event.typeColors.bg,
          border: `1px solid ${event.typeColors.border}`,
          borderRadius: "4px",
          color: event.typeColors.text,
          paddingLeft: 9,
          paddingRight: 6,
          paddingTop: 4,
          paddingBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
          overflow: "visible",
          transition: "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
          filter: isHovered ? "brightness(1.18)" : "none",
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {StripeAccent(true)}

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span
            className="font-mohave truncate"
            style={{
              fontSize: 11,
              lineHeight: "14px",
              color: "var(--text)",
            }}
          >
            {event.projectTitle ?? event.taskTitle}
          </span>
          {subtitle && (
            <span
              className="font-mono truncate"
              style={{
                fontSize: 10,
                lineHeight: "12px",
                color: "var(--text-3)",
              }}
            >
              {subtitle}
            </span>
          )}
        </div>

        {/* Right cluster: optional time + type badge */}
        <div className="flex items-center gap-[5px] shrink-0">
          {timeLabel && (
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: 10,
                lineHeight: "12px",
                color: "var(--text-3)",
                fontFeatureSettings: '"tnum" 1, "zero" 1',
              }}
            >
              {timeLabel}
            </span>
          )}
          <div
            className="px-[5px] py-[1px] font-cakemono font-light uppercase"
            style={{
              color: event.typeColors.text,
              background: event.typeColors.bg,
              border: `1px solid ${event.typeColors.border}`,
              borderRadius: 4,
              fontSize: 9,
              letterSpacing: "0.04em",
              lineHeight: "12px",
            }}
          >
            {event.typeLabel}
          </div>
        </div>
      </div>
    </EventHoverPopover>
  );
}
