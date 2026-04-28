"use client";

import { useMemo, useCallback, useState } from "react";
import { format, differenceInCalendarDays } from "date-fns";
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
}

// ── Component ──────────────────────────────────────────────────────────────

export function DayTaskCard({ event, index }: DayTaskCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const setSidePanelTask = useCalendarStore((s) => s.setSidePanelTask);
  const setInlineEdit = useCalendarStore((s) => s.setInlineEdit);

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

  // ── Time formatting (only when allDay = false; T9 + Phase 3) ──────────

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

  const primaryTitle = event.projectTitle ?? event.taskTitle;
  const showSubtitle =
    event.projectTitle !== null && event.taskTitle !== event.projectTitle;
  const subtitle = showSubtitle ? event.taskTitle : null;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <EventHoverPopover event={event} side="right">
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
        minHeight: 64,
        borderRadius: 4,
        overflow: "hidden",
        border: `1px solid ${event.statusColors.border}`,
        background: event.statusColors.bg,
        opacity: isHovered ? 1 : 0.94,
        transition: "border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Type stripe — sibling div, NOT box-shadow (avoids crescent at radius corners) */}
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
        }}
      />

      {/* Card body */}
      <div
        className="flex-1 flex flex-col justify-center min-w-0"
        style={{
          padding: "12px 14px 12px 18px",
        }}
      >
        {/* Line 1: Primary title (project ?? task) */}
        <div className="flex items-center gap-[6px] min-w-0">
          <span
            className="font-cakemono font-light text-[15px] uppercase truncate leading-tight"
            style={{ color: "var(--text)" }}
          >
            {primaryTitle}
          </span>
          {subtitle && (
            <>
              <span
                className="font-mono text-[12px] shrink-0"
                style={{ color: "var(--text-mute)" }}
              >
                /
              </span>
              <span
                className="font-mono text-[12px] truncate leading-tight"
                style={{ color: "var(--text-3)" }}
              >
                {subtitle}
              </span>
            </>
          )}
        </div>

        {/* Line 2: type badge + (optional) time range */}
        <div className="flex items-center justify-between mt-[6px] min-w-0 gap-2">
          <div
            className="shrink-0 flex items-center px-[6px] py-[2px] font-cakemono font-light text-[10px] uppercase leading-tight"
            style={{
              color: event.typeColors.text,
              background: event.typeColors.bg,
              border: `1px solid ${event.typeColors.border}`,
              borderRadius: 4,
              letterSpacing: "0.04em",
            }}
          >
            {event.typeLabel}
          </div>

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

        {/* Line 3: Crew avatars row (max 3 + [+N]) */}
        {visibleCrew.length > 0 && (
          <div className="flex items-center mt-[8px] min-w-0">
            <div className="flex items-center -space-x-[6px]">
              {visibleCrew.map((user) => (
                <UserAvatar
                  key={user.id}
                  name={`${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || (user.email ?? "?")}
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
        )}

        {/* When no crew assigned */}
        {visibleCrew.length === 0 && (
          <div className="mt-[6px] min-w-0">
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--text-mute)" }}
            >
              [UNASSIGNED]
            </span>
          </div>
        )}
      </div>
    </motion.div>
    </EventHoverPopover>
  );
}
