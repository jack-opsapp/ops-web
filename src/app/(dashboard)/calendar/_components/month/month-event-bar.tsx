"use client";

import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { type InternalCalendarEvent } from "@/lib/utils/calendar-utils";

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

// Spec v2 EASE_SMOOTH — single curve for all motion in OPS-Web.
const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

const tooltipVariantsMotion = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
};

// Reduced-motion alternative: same arrival beat, opacity only. The tooltip
// still appears with the same timing so the user still gets the feedback —
// just without any y-translate that could trigger vestibular discomfort.
const tooltipVariantsReduced = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

interface EventTooltipProps {
  event: InternalCalendarEvent;
  anchorRect: DOMRect;
}

/**
 * Rendered to document.body via portal so it escapes the calendar cell's
 * `overflow: hidden`. T17 replaces this with Radix HoverCard.
 *
 * Position strategy: above the anchor by default; if there's not enough
 * viewport above, flip below. `fixed` positioning so scroll doesn't displace.
 */
function EventTooltip({ event, anchorRect }: EventTooltipProps) {
  const reducedMotion = useReducedMotion();
  const tooltipVariants = reducedMotion ? tooltipVariantsReduced : tooltipVariantsMotion;
  const dateRangeStr = `${format(event.startDate, "MMM d")} - ${format(event.endDate, "MMM d, yyyy")}`;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number }>({
    top: anchorRect.top - 8,
    left: anchorRect.left,
  });

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 6;
    const above = anchorRect.top - tooltipRect.height - margin;
    const below = anchorRect.bottom + margin;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    let top = above >= 8 ? above : below;
    let left = anchorRect.left;

    // Clamp horizontally so the tooltip doesn't run off-screen
    if (left + tooltipRect.width > viewportW - 8) {
      left = viewportW - tooltipRect.width - 8;
    }
    if (left < 8) left = 8;

    // If below also overflows, pin to bottom and accept the clip
    if (below + tooltipRect.height > viewportH - 8 && above < 8) {
      top = viewportH - tooltipRect.height - 8;
    }

    setPlacement({ top, left });
  }, [anchorRect]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      ref={tooltipRef}
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={tooltipVariants}
      transition={{ duration: 0.15, ease: EASE_SMOOTH }}
      className="pointer-events-none z-dropdown"
      style={{
        position: "fixed",
        top: placement.top,
        left: placement.left,
        minWidth: 180,
        maxWidth: 240,
        background: "var(--glass-bg-dense)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        border: "1px solid var(--glass-border)",
        borderRadius: 12,
        padding: "8px 10px",
      }}
    >
      {/* Project name */}
      <div
        className="font-cakemono font-light text-[12px] uppercase leading-tight truncate"
        style={{ color: "var(--text)" }}
      >
        {event.projectTitle ?? event.taskTitle}
      </div>

      {/* Subtitle when distinct */}
      {event.projectTitle && event.taskTitle !== event.projectTitle && (
        <div
          className="font-mohave text-[12px] leading-tight truncate mt-[2px]"
          style={{ color: "var(--text-3)" }}
        >
          {event.taskTitle}
        </div>
      )}

      {/* Divider */}
      <div
        className="my-[6px]"
        style={{ height: 1, background: "var(--glass-border)" }}
      />

      {/* Type + status badges */}
      <div className="flex items-center gap-[6px]">
        <div
          className="px-[5px] py-[1px] font-cakemono font-light uppercase"
          style={{
            color: event.typeColors.text,
            background: event.typeColors.bg,
            border: `1px solid ${event.typeColors.border}`,
            borderRadius: 4,
            fontSize: 9,
            letterSpacing: "0.04em",
          }}
        >
          {event.typeLabel}
        </div>
        <div
          className="px-[5px] py-[1px] font-mono uppercase tracking-wider"
          style={{
            color: event.statusColors.text,
            background: event.statusColors.bg,
            border: `1px solid ${event.statusColors.border}`,
            borderRadius: 4,
            fontSize: 9,
          }}
        >
          {event.statusKey.replace("_", " ")}
        </div>
      </div>

      {/* Date range */}
      <div
        className="font-mono text-[10px] uppercase tracking-wider leading-tight mt-[6px] tabular-nums"
        style={{
          color: "var(--text-3)",
          fontFeatureSettings: '"tnum" 1, "zero" 1',
        }}
      >
        {dateRangeStr}
      </div>
    </motion.div>,
    document.body
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MonthEventBar({
  event,
  displayLevel,
  span,
  onClick,
}: MonthEventBarProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const handleEnter = () => {
    if (anchorRef.current) {
      setAnchorRect(anchorRef.current.getBoundingClientRect());
    }
    setIsHovered(true);
  };
  const handleLeave = () => {
    setIsHovered(false);
  };

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

  // ── Level 1: Compact — color dot only (no stripe — leave as-is) ──
  if (displayLevel === "compact") {
    return (
      <div
        ref={anchorRef}
        className="cursor-pointer transition-opacity duration-100 hover:opacity-80 shrink-0 relative"
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: event.typeColors.border,
        }}
        onClick={handleClick}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <AnimatePresence>
          {isHovered && anchorRect && (
            <EventTooltip event={event} anchorRect={anchorRect} />
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Stripe: 3px sibling div — replaces inset box-shadow ──
  // Box-shadow inset doesn't respect the border-radius, producing a
  // 'crescent moon' artifact at the corners. The sibling div with matching
  // border-radius gives pixel-perfect curve continuity.
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
          borderRadius: span.isSingleDay
            ? "4px 0 0 4px"
            : "4px 0 0 4px", // first segment always rounds the left
          pointerEvents: "none",
        }}
      />
    ) : null;

  // ── Level 2: Standard — short bar with single-line title ──
  if (displayLevel === "standard") {
    const showStripe = span.isFirstSegment || span.isSingleDay;
    return (
      <div
        ref={anchorRef}
        className="cursor-pointer truncate relative"
        style={{
          height: 14,
          background: event.statusColors.bg,
          border: `1px solid ${event.statusColors.border}`,
          borderRadius,
          color: event.statusColors.text,
          paddingLeft: showStripe ? 7 : 4,
          paddingRight: 4,
          display: "flex",
          alignItems: "center",
          overflow: "visible",
          transition: "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
          filter: isHovered ? "brightness(1.18)" : "none",
        }}
        onClick={handleClick}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {StripeAccent(showStripe)}
        <span
          className="font-mohave truncate"
          style={{ fontSize: 11, lineHeight: "14px", color: "var(--text)" }}
        >
          {event.projectTitle ?? event.taskTitle}
        </span>
        <AnimatePresence>
          {isHovered && anchorRect && (
            <EventTooltip event={event} anchorRect={anchorRect} />
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Level 3: Expanded ──

  // Multi-day events stay 14px even at expanded level
  if (!span.isSingleDay) {
    const showStripe = span.isFirstSegment;
    return (
      <div
        ref={anchorRef}
        className="cursor-pointer truncate relative"
        style={{
          height: 14,
          background: event.statusColors.bg,
          border: `1px solid ${event.statusColors.border}`,
          borderRadius,
          color: event.statusColors.text,
          paddingLeft: showStripe ? 7 : 4,
          paddingRight: 4,
          display: "flex",
          alignItems: "center",
          overflow: "visible",
          transition: "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
          filter: isHovered ? "brightness(1.18)" : "none",
        }}
        onClick={handleClick}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {StripeAccent(showStripe)}
        <span
          className="font-mohave truncate"
          style={{ fontSize: 11, lineHeight: "14px", color: "var(--text)" }}
        >
          {event.projectTitle ?? event.taskTitle}
        </span>
        <AnimatePresence>
          {isHovered && anchorRect && (
            <EventTooltip event={event} anchorRect={anchorRect} />
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Single-day expanded: 42px tall, 2 lines + badge
  const subtitle =
    event.projectTitle && event.taskTitle !== event.projectTitle
      ? event.taskTitle
      : null;

  return (
    <div
      ref={anchorRef}
      className="cursor-pointer relative"
      style={{
        height: 42,
        background: event.statusColors.bg,
        border: `1px solid ${event.statusColors.border}`,
        borderRadius: "4px",
        color: event.statusColors.text,
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
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
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

      {/* Type badge */}
      <div
        className="shrink-0 px-[5px] py-[1px] font-cakemono font-light uppercase"
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

      <AnimatePresence>
        {isHovered && anchorRect && (
          <EventTooltip event={event} anchorRect={anchorRect} />
        )}
      </AnimatePresence>
    </div>
  );
}
