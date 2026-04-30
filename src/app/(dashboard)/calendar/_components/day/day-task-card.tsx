"use client";

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { format, differenceInCalendarDays, addDays } from "date-fns";
import { motion } from "framer-motion";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { useCalendarStore } from "@/stores/calendar-store";
import { useTeamMembers } from "@/lib/hooks";
import { UserAvatar } from "@/components/ops/user-avatar";
import { EventHoverPopover } from "../event-hover-popover";

// ── Props ──────────────────────────────────────────────────────────────────

interface DayTaskCardProps {
  event: InternalCalendarEvent;
  index: number;
  /**
   * When provided, the card grows a bottom-edge resize handle. Drag the
   * handle vertically — pixel delta snaps to whole-day increments and
   * commits via this callback on mouseup. Pass `undefined` (or omit) to
   * keep the card non-resizable (e.g. for completed/cancelled events).
   */
  onResize?: (event: InternalCalendarEvent, newEndDate: Date) => void;
  /** Pixels per day for the resize gesture (default 32). */
  pxPerDay?: number;
}

// Resize-handle hit zone (matches crew-task-block).
const RESIZE_HANDLE_PX = 8;
const DEFAULT_PX_PER_DAY = 32;
// Visual extension during drag — keeps the snap legible without making the
// card grow off the bottom of the viewport.
const PREVIEW_PX_PER_DAY = 16;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Match iOS CalendarEventCard.formattedAddress: show street + municipality only.
 * Falls back gracefully when the address only has one component.
 */
function formatShortAddress(address: string | null): string | null {
  if (!address) return null;
  const components = address.split(",").map((c) => c.trim()).filter(Boolean);
  if (components.length >= 2) return `${components[0]}, ${components[1]}`;
  if (components.length === 1) return components[0];
  return null;
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Day calendar card. Mirrors the iOS CalendarEventCard layout so the two
 * surfaces stay in sync.
 *
 * Visual design (per iOS CalendarEventCard.swift):
 *   - Body: dark card bg (var(--bg-card)) — NOT a status fill
 *   - Left stripe: 4px, type color
 *   - Top stripe (multi-day only): 2px type color
 *   - Lines:
 *       1. project.title (Cake Mono Light uppercase, primary text)
 *       2. client.name (mono caption, secondary text)
 *       3. formatted address (mono micro, 45% primary text)
 *   - Type badge top-right (type color text + soft fill + line)
 *   - Status badge bottom-right ONLY for completed/cancelled
 *   - Dimming overlay covers the card when completed/cancelled
 *
 * For CalendarUserEvents (kind = personal / time_off): no project/client/
 * address, just title + (for time-off) approval-state badge.
 */
export function DayTaskCard({
  event,
  index,
  onResize,
  pxPerDay = DEFAULT_PX_PER_DAY,
}: DayTaskCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const setSidePanelTask = useCalendarStore((s) => s.setSidePanelTask);
  const setInlineEdit = useCalendarStore((s) => s.setInlineEdit);

  // Legend hover-to-highlight integration. Same combined logic as the month
  // bar — match either the highlighted task type or the highlighted team
  // member, dim everything that matches neither when one is set.
  const highlightedTaskType = useCalendarStore((s) => s.highlightedTaskType);
  const highlightedTeamMemberId = useCalendarStore(
    (s) => s.highlightedTeamMemberId
  );
  const matchesType =
    highlightedTaskType !== null && event.typeLabel === highlightedTaskType;
  const matchesMember =
    highlightedTeamMemberId !== null &&
    event.crewIds.includes(highlightedTeamMemberId);
  const dimmedByLegend =
    (highlightedTaskType !== null && !matchesType) ||
    (highlightedTeamMemberId !== null && !matchesMember);
  const highlightedByLegend = matchesType || matchesMember;

  // ── Resize state — bottom-edge drag for all-day duration ──────────────
  const [resize, setResize] = useState<{
    initialY: number;
    deltaPx: number;
  } | null>(null);
  const resizeRef = useRef(resize);
  resizeRef.current = resize;

  // Inclusive day count: a bar that runs May 7 → May 8 covers 2 calendar
  // days (diff = 1 + the start day = 2). Clamp to at least 1 so a same-day
  // event can never shrink past the start.
  const baseDurationDays =
    differenceInCalendarDays(event.endDate, event.startDate) + 1;

  // Snap deltaPx → integer dayDelta. Clamp so duration stays >= 1 day.
  const snapDayDelta = useCallback(
    (deltaPx: number): number => {
      const raw = Math.round(deltaPx / pxPerDay);
      const minDelta = -(baseDurationDays - 1);
      return Math.max(raw, minDelta);
    },
    [pxPerDay, baseDurationDays]
  );

  const previewDayDelta = resize ? snapDayDelta(resize.deltaPx) : 0;
  const previewExtraPx = Math.max(previewDayDelta, 0) * PREVIEW_PX_PER_DAY;
  const previewShrinkPx = Math.min(previewDayDelta, 0) * PREVIEW_PX_PER_DAY; // negative

  // Keep latest event refs so global handlers commit against current data
  const eventRef = useRef(event);
  eventRef.current = event;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const snapRef = useRef(snapDayDelta);
  snapRef.current = snapDayDelta;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResize({ initialY: e.clientY, deltaPx: 0 });
  }, []);

  // Global mousemove/mouseup for resize
  useEffect(() => {
    if (!resize) return;
    const onMouseMove = (mv: MouseEvent) => {
      setResize((prev) =>
        prev ? { ...prev, deltaPx: mv.clientY - prev.initialY } : null
      );
    };
    const onMouseUp = () => {
      const state = resizeRef.current;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setResize(null);
      if (!state) return;
      const dayDelta = snapRef.current(state.deltaPx);
      if (dayDelta === 0) return;
      const cb = onResizeRef.current;
      if (!cb) return;
      const newEnd = addDays(eventRef.current.endDate, dayDelta);
      cb(eventRef.current, newEnd);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resize]);

  // Team members — read from TanStack Query cache (CalendarPage already fetched)
  const { data: teamData } = useTeamMembers();
  const allUsers = teamData?.users ?? [];

  // Resolve crew users (max 3 visible) + remainder count
  const { visibleCrew, remainingCrew } = useMemo(() => {
    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const resolved = event.crewIds
      .map((id) => userMap.get(id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u));
    return {
      visibleCrew: resolved.slice(0, 3),
      remainingCrew: Math.max(0, resolved.length - 3),
    };
  }, [event.crewIds, allUsers]);

  // ── Multi-day detection ───────────────────────────────────────────────

  const multiDayInfo = useMemo(() => {
    const totalDays = differenceInCalendarDays(event.endDate, event.startDate);
    if (totalDays <= 1) return null;

    const dayOfTask = differenceInCalendarDays(new Date(), event.startDate) + 1;
    const clampedDay = Math.max(1, Math.min(dayOfTask, totalDays));
    return { current: clampedDay, total: totalDays };
  }, [event.startDate, event.endDate]);

  // ── Time formatting (only when allDay = false; Phase 3) ───────────────

  const timeRange = useMemo(() => {
    if (event.allDay) return null;
    if (multiDayInfo) return null;
    const start = format(event.startDate, "HH:mm");
    const end = format(event.endDate, "HH:mm");
    return `${start} → ${end}`;
  }, [event.allDay, event.startDate, event.endDate, multiDayInfo]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleClick = useCallback(() => {
    setSidePanelTask(event.id);
  }, [event.id, setSidePanelTask]);

  const handleDoubleClick = useCallback(() => {
    setInlineEdit({ taskId: event.id, field: "title" });
  }, [event.id, setInlineEdit]);

  // ── Display values ────────────────────────────────────────────────────

  const isUserEvent = event.kind !== "task";
  const primaryTitle = event.projectTitle ?? event.taskTitle;
  const formattedAddress = formatShortAddress(event.address);

  // Status badge — only for completed/cancelled (matches iOS rule).
  const statusBadge = useMemo<{
    label: string;
    bg: string;
    text: string;
  } | null>(() => {
    if (event.statusKey === "completed") {
      return {
        label: "COMPLETED",
        bg: "#9DB582", // olive solid (iOS statusColor for .completed)
        text: "#000",
      };
    }
    if (event.statusKey === "cancelled") {
      return {
        label: "CANCELLED",
        bg: "#6A6A6A", // text-mute solid (iOS inactiveStatus)
        text: "#000",
      };
    }
    // Time-off: surface approval state in the same slot.
    if (event.kind === "time_off") {
      if (event.statusKey === "in_progress") {
        return { label: "PENDING", bg: "#C4A868", text: "#000" };
      }
    }
    return null;
  }, [event.statusKey, event.kind]);

  const dimmed =
    event.statusKey === "completed" || event.statusKey === "cancelled";

  // ── Render ────────────────────────────────────────────────────────────

  // Resize is gated by onResize being provided AND the event not being in a
  // completed/cancelled state — those are display-only (matches iOS).
  const canResize = !!onResize && !dimmed;

  // Live duration preview during drag — used for the "+N DAY(S)" label.
  const previewDuration = baseDurationDays + previewDayDelta;

  // Effective extra height during drag. Negative values shrink the card,
  // bottom-clamped at 64px so the body content never collapses.
  const heightOffset = previewExtraPx + previewShrinkPx;

  return (
    <EventHoverPopover event={event} side="right" disabled={!!resize}>
      <motion.div
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{
          duration: 0.22,
          ease: [0.22, 1, 0.36, 1],
          delay: index * 0.06,
        }}
        className="relative cursor-pointer"
        style={{
          display: "flex",
          minHeight: Math.max(64 + heightOffset, 64),
          borderRadius: 4,
          overflow: "hidden",
          // Dark card body (matches iOS cardBackgroundDark). Type drives the
          // stripe + badge — never the fill.
          background: "var(--bg-card)",
          border: resize
            ? `1px solid ${event.typeColors.border}`
            : highlightedByLegend
              ? `1px solid ${event.typeColors.border}`
              : "1px solid rgba(255, 255, 255, 0.10)",
          opacity: dimmedByLegend ? 0.18 : isHovered ? 1 : 0.96,
          filter: highlightedByLegend ? "brightness(1.2)" : "none",
          transition: resize
            ? "min-height 0.05s linear, border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1)"
            : "min-height 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1), filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Left stripe — 4px, task type color */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: event.typeColors.border,
          }}
        />

        {/* Top stripe — only on multi-day events */}
        {multiDayInfo && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: 2,
              background: event.typeColors.border,
            }}
          />
        )}

        {/* Card body */}
        <div
          className="flex-1 flex flex-col justify-center min-w-0"
          style={{
            padding: "12px 14px 12px 18px",
          }}
        >
          {/* Line 1 — project.title (or user-event title) */}
          <span
            className="font-cakemono font-light text-[15px] uppercase truncate leading-tight"
            style={{ color: "var(--text)" }}
          >
            {primaryTitle}
          </span>

          {/* Line 2 — client.name */}
          {!isUserEvent && event.clientName && (
            <span
              className="font-mono text-[12px] truncate leading-tight mt-[3px]"
              style={{ color: "var(--text-2)" }}
            >
              {event.clientName}
            </span>
          )}

          {/* Line 3 — short address (street, municipality) */}
          {!isUserEvent && formattedAddress && (
            <span
              className="font-mono text-[11px] uppercase tracking-wider truncate leading-tight mt-[2px]"
              style={{
                color: "rgba(237, 237, 237, 0.45)",
                letterSpacing: "0.06em",
              }}
            >
              {formattedAddress}
            </span>
          )}

          {/* User-event subtitle (notes) when present */}
          {isUserEvent && event.taskTitle !== primaryTitle && (
            <span
              className="font-mono text-[11px] truncate leading-tight mt-[2px]"
              style={{ color: "var(--text-3)" }}
            >
              {event.taskTitle}
            </span>
          )}

          {/* Bottom row — crew avatars + (optional) time / multi-day */}
          {(visibleCrew.length > 0 || timeRange || multiDayInfo) && (
            <div className="flex items-center justify-between mt-[8px] min-w-0 gap-2">
              {visibleCrew.length > 0 ? (
                <div className="flex items-center min-w-0">
                  <div className="flex items-center -space-x-[6px]">
                    {visibleCrew.map((user) => (
                      <UserAvatar
                        key={user.id}
                        name={
                          `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
                          user.email ||
                          "?"
                        }
                        imageUrl={user.profileImageURL}
                        size="sm"
                        showTooltip
                      />
                    ))}
                  </div>
                  {remainingCrew > 0 && (
                    <span
                      className="ml-[8px] font-mono text-[11px] tabular-nums"
                      style={{
                        color: "var(--text-3)",
                        fontFeatureSettings: '"tnum" 1, "zero" 1',
                      }}
                    >
                      {`+${remainingCrew}`}
                    </span>
                  )}
                </div>
              ) : (
                <span
                  className="font-mono text-[10px] uppercase tracking-wider"
                  style={{
                    color: "var(--text-mute)",
                    letterSpacing: "0.06em",
                  }}
                >
                  [UNASSIGNED]
                </span>
              )}

              {timeRange && (
                <span
                  className="font-mono text-[11px] shrink-0 leading-tight tabular-nums"
                  style={{
                    color: "var(--text-3)",
                    fontFeatureSettings: '"tnum" 1, "zero" 1',
                  }}
                >
                  {timeRange}
                </span>
              )}
              {!timeRange && multiDayInfo && (
                <span
                  className="font-mono text-[11px] shrink-0 leading-tight tabular-nums"
                  style={{
                    color: "var(--text-3)",
                    fontFeatureSettings: '"tnum" 1, "zero" 1',
                  }}
                >
                  {`Day ${multiDayInfo.current} / ${multiDayInfo.total}`}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Type badge — top-right */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            padding: "2px 6px",
            borderRadius: 2,
            background: event.typeColors.bg,
            border: `1px solid ${event.typeColors.border}`,
            color: event.typeColors.text,
            fontFamily: "var(--font-cakemono), sans-serif",
            fontWeight: 300,
            fontSize: 10,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            lineHeight: 1.4,
          }}
        >
          {event.typeLabel}
        </div>

        {/* Status badge — bottom-right (completed/cancelled or time-off pending) */}
        {statusBadge && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              padding: "3px 8px",
              borderRadius: 2,
              background: statusBadge.bg,
              color: statusBadge.text,
              fontFamily: "var(--font-mono), monospace",
              fontWeight: 600,
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              lineHeight: 1.2,
            }}
          >
            {statusBadge.label}
          </div>
        )}

        {/* Dimming overlay — completed / cancelled cards. Mirrors iOS modalOverlay */}
        {dimmed && (
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ background: "rgba(0, 0, 0, 0.40)" }}
          />
        )}

        {/* Bottom resize handle — only when caller wires onResize */}
        {canResize && (
          <div
            onMouseDown={handleResizeStart}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 right-0 bottom-0"
            style={{
              height: RESIZE_HANDLE_PX,
              cursor: "ns-resize",
              zIndex: 6,
              // 2px hairline at the very bottom — visible on hover, full-color
              // during drag. Honors prefers-reduced-motion via short transition.
              background:
                resize || isHovered
                  ? `linear-gradient(to top, ${event.typeColors.border} 0 2px, transparent 2px)`
                  : "transparent",
              transition: "background 0.12s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
            aria-label="Resize event duration"
            role="separator"
          />
        )}

        {/* Resize live label — bottom-right floating chip during drag */}
        {resize && previewDayDelta !== 0 && (
          <div
            aria-hidden="true"
            className="glass-dense absolute pointer-events-none font-mono tabular-nums"
            style={{
              right: 8,
              bottom: RESIZE_HANDLE_PX + 6,
              padding: "2px 6px",
              borderRadius: 4,
              border: `1px solid ${event.typeColors.border}`,
              color: "var(--text)",
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontFeatureSettings: '"tnum" 1, "zero" 1',
              zIndex: 7,
            }}
          >
            {`${previewDuration} DAY${previewDuration === 1 ? "" : "S"}`}
          </div>
        )}
      </motion.div>
    </EventHoverPopover>
  );
}
