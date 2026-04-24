"use client";

import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
 * `overflow: hidden` (which is load-bearing for the drop indicator and hover
 * border on day cells). Bug 10ed5e3f.
 *
 * Position strategy: above the anchor by default; if there's not enough
 * viewport above, flip below. `fixed` positioning so scroll doesn't displace.
 */
function EventTooltip({ event, anchorRect }: EventTooltipProps) {
  const reducedMotion = useReducedMotion();
  const tooltipVariants = reducedMotion ? tooltipVariantsReduced : tooltipVariantsMotion;
  const colors = getEventColors(event.taskType);
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
      className="pointer-events-none"
      style={{
        position: "fixed",
        top: placement.top,
        left: placement.left,
        zIndex: 1000, // dropdown layer per spec v2 z-index scale
        minWidth: 180,
        maxWidth: 240,
        background: "var(--glass-bg-dense)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        border: "1px solid var(--glass-border)",
        borderRadius: 12, // rounded-modal per spec v2 (popover/dropdown tier)
        padding: "8px 10px",
      }}
    >
      {/* Project name */}
      <div
        className="font-mohave font-semibold text-[12px] leading-tight truncate"
        style={{ color: "var(--text-primary, #EDEDED)" }}
      >
        {event.project || event.title}
      </div>

      {/* Divider */}
      <div
        className="my-[4px]"
        style={{ height: 1, background: "var(--glass-border)" }}
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
        style={{ color: "var(--text-3, #8A8A8A)" }}
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
    // Keep anchorRect around one frame so the exit animation has a position;
    // cleared the next time the tooltip opens on a different bar.
  };

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
        ref={anchorRef}
        className="cursor-pointer transition-opacity duration-100 hover:opacity-80 shrink-0 relative"
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: colors.border,
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

  // ── Level 2: Standard — short bar with single-line title ──
  // Use inset box-shadow (not borderLeft) so the accent stripe respects the
  // bar's rounded corners instead of clipping against them — that corner
  // clip is the "funny" left-edge line the bug flagged.
  if (displayLevel === "standard") {
    return (
      <div
        ref={anchorRef}
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
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <span
          className="font-mohave truncate"
          style={{ fontSize: 11, lineHeight: "14px" }}
        >
          {event.project || event.title}
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
    return (
      <div
        ref={anchorRef}
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
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <span
          className="font-mohave truncate"
          style={{ fontSize: 11, lineHeight: "14px" }}
        >
          {event.project || event.title}
        </span>
        <AnimatePresence>
          {isHovered && anchorRect && (
            <EventTooltip event={event} anchorRect={anchorRect} />
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Single-day expanded: 42px tall, 2 lines (project name + task type)
  return (
    <div
      ref={anchorRef}
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
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
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
        {isHovered && anchorRect && (
          <EventTooltip event={event} anchorRect={anchorRect} />
        )}
      </AnimatePresence>
    </div>
  );
}
