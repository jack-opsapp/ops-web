"use client";

import { ReactNode } from "react";
import { format } from "date-fns";
import * as HoverCard from "@radix-ui/react-hover-card";
import { useTeamMembers } from "@/lib/hooks";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";

// ─── Props ──────────────────────────────────────────────────────────────────

interface EventHoverPopoverProps {
  event: InternalCalendarEvent;
  children: ReactNode;
  /** Optional explicit side. Defaults to top with auto-flip. */
  side?: "top" | "right" | "bottom" | "left";
  /** Open delay in ms. Default 200. */
  openDelay?: number;
  /** Close delay in ms. Default 100. */
  closeDelay?: number;
  /** Disable the popover (e.g. while dragging) */
  disabled?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * T17 — Standardized event hover popover via Radix HoverCard.
 *
 * Replaces the inline `<EventTooltip>` portal pattern in month-event-bar
 * (and the reduced-motion-aware variant in crew-task-block). Single API,
 * portal-rendered to document.body, glass-dense surface, var(--z-dropdown).
 *
 * Honors prefers-reduced-motion natively via Radix HoverCard (it skips
 * its own animation when set; we don't add Framer Motion on top).
 */
export function EventHoverPopover({
  event,
  children,
  side = "top",
  openDelay = 200,
  closeDelay = 100,
  disabled = false,
}: EventHoverPopoverProps) {
  if (disabled) {
    // When dragging or otherwise disabled, render children straight through
    // so we don't accidentally trigger the popover during interactions.
    return <>{children}</>;
  }

  return (
    <HoverCard.Root openDelay={openDelay} closeDelay={closeDelay}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side={side}
          sideOffset={6}
          align="start"
          collisionPadding={8}
          avoidCollisions
          className="z-dropdown"
          style={{
            width: 320,
            padding: "12px 14px",
            background: "var(--glass-bg-dense)",
            backdropFilter: "blur(28px) saturate(1.3)",
            WebkitBackdropFilter: "blur(28px) saturate(1.3)",
            border: "1px solid var(--glass-border)",
            borderRadius: 12,
            outline: "none",
          }}
        >
          <PopoverBody event={event} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

// ─── Body ───────────────────────────────────────────────────────────────────

function PopoverBody({ event }: { event: InternalCalendarEvent }) {
  // Crew name resolution from cached useTeamMembers
  const { data: teamData } = useTeamMembers();
  const allUsers = teamData?.users ?? [];
  const userMap = new Map(allUsers.map((u) => [u.id, u]));

  const crewNames = event.crewIds
    .map((id) => {
      const u = userMap.get(id);
      if (!u) return null;
      return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || null;
    })
    .filter((n): n is string => Boolean(n));

  const subtitle =
    event.projectTitle && event.taskTitle !== event.projectTitle
      ? event.taskTitle
      : null;

  // Date range
  const sameDay =
    event.startDate.toDateString() === event.endDate.toDateString();
  const dateRange = sameDay
    ? format(event.startDate, "MMM d, yyyy")
    : `${format(event.startDate, "MMM d")} → ${format(event.endDate, "MMM d, yyyy")}`;

  // Time range — only when allDay = false (Phase 3)
  const timeRange = event.allDay
    ? null
    : `${format(event.startDate, "HH:mm")} → ${format(event.endDate, "HH:mm")}`;

  return (
    <>
      {/* Project title (Cake Mono Light, uppercase) */}
      <div
        className="font-cakemono font-light leading-tight truncate"
        style={{
          color: "var(--text)",
          fontSize: 13,
          letterSpacing: 0,
          textTransform: "uppercase",
        }}
      >
        {event.projectTitle ?? event.taskTitle}
      </div>

      {/* Task title (Mohave 14px) — only when distinct from project */}
      {subtitle && (
        <div
          className="font-mohave leading-tight mt-[3px] truncate"
          style={{ color: "var(--text-3)", fontSize: 14 }}
        >
          {subtitle}
        </div>
      )}

      {/* Type + status row. Status badge is only shown for completed/cancelled
          (matches iOS card rule); active states ride entirely on the type. */}
      <div className="flex items-center gap-[6px] mt-[8px] flex-wrap">
        <div
          className="px-[6px] py-[2px] font-cakemono font-light uppercase"
          style={{
            color: event.typeColors.text,
            background: event.typeColors.bg,
            border: `1px solid ${event.typeColors.border}`,
            borderRadius: 4,
            fontSize: 10,
            letterSpacing: "0.04em",
          }}
        >
          {event.typeLabel}
        </div>
        {(event.statusKey === "completed" || event.statusKey === "cancelled") && (
          <div
            className="px-[6px] py-[2px] font-mono uppercase tracking-wider"
            style={{
              color: "#000",
              background:
                event.statusKey === "completed" ? "#9DB582" : "#6A6A6A",
              borderRadius: 4,
              fontSize: 10,
            }}
          >
            {event.statusKey === "completed" ? "completed" : "cancelled"}
          </div>
        )}
      </div>

      {/* Divider */}
      <div
        style={{
          height: 1,
          background: "var(--glass-border)",
          margin: "10px 0",
        }}
      />

      {/* Client */}
      {event.clientName && (
        <div className="mb-[6px]">
          <div
            className="font-mono uppercase tracking-wider mb-[2px]"
            style={{ color: "var(--text-mute)", fontSize: 10 }}
          >
            // CLIENT
          </div>
          <div
            className="font-mohave"
            style={{ color: "var(--text-2)", fontSize: 13 }}
          >
            {event.clientName}
          </div>
        </div>
      )}

      {/* Time range (Phase 3) */}
      {timeRange && (
        <div
          className="font-mono mb-[4px] tabular-nums"
          style={{
            color: "var(--text)",
            fontSize: 12,
            fontFeatureSettings: '"tnum" 1, "zero" 1',
          }}
        >
          {timeRange}
        </div>
      )}

      {/* Date range */}
      <div
        className="font-mono uppercase tracking-wider tabular-nums"
        style={{
          color: "var(--text-3)",
          fontSize: 11,
          fontFeatureSettings: '"tnum" 1, "zero" 1',
        }}
      >
        {dateRange}
      </div>

      {/* Crew */}
      {crewNames.length > 0 && (
        <div className="mt-[10px]">
          <div
            className="font-mono uppercase tracking-wider mb-[4px]"
            style={{ color: "var(--text-mute)", fontSize: 10 }}
          >
            // CREW
          </div>
          <div
            className="font-mohave"
            style={{
              color: "var(--text-2)",
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            {crewNames.join(", ")}
          </div>
        </div>
      )}

      {/* Address */}
      {event.address && (
        <div className="mt-[8px]">
          <div
            className="font-mono uppercase tracking-wider mb-[2px]"
            style={{ color: "var(--text-mute)", fontSize: 10 }}
          >
            // SITE
          </div>
          <div
            className="font-mono"
            style={{
              color: "var(--text-3)",
              fontSize: 11,
              lineHeight: 1.4,
            }}
          >
            {event.address}
          </div>
        </div>
      )}
    </>
  );
}
