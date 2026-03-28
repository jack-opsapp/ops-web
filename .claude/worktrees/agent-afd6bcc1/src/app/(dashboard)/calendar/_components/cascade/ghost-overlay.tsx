"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { differenceInCalendarDays } from "date-fns";
import { useCalendarStore } from "@/stores/calendar-store";
import { TimelineTaskBlock } from "../timeline/timeline-task-block";
import type { TeamMember } from "@/lib/types/models";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";

// ─── Props ──────────────────────────────────────────────────────────────────

interface GhostOverlayProps {
  startDate: Date;
  daysShown: number;
  teamMembers: TeamMember[];
  events: InternalCalendarEvent[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * GhostOverlay — renders ghost task blocks on the timeline for cascade preview.
 *
 * Reads `ghostPreviews` from the calendar store and positions a transparent,
 * pulsing ghost version of each affected task at its new cascade position.
 * Must be rendered inside the scrollable timeline body, after the team member rows.
 */
export function GhostOverlay({
  startDate,
  daysShown,
  teamMembers,
  events,
}: GhostOverlayProps) {
  const ghostPreviews = useCalendarStore((s) => s.ghostPreviews);

  // Build a lookup: eventId → InternalCalendarEvent
  const eventMap = useMemo(() => {
    const map = new Map<string, InternalCalendarEvent>();
    for (const ev of events) {
      map.set(ev.id, ev);
    }
    return map;
  }, [events]);

  // Build a lookup: teamMemberId → row index (0-based, matching the rendered order)
  const memberRowIndex = useMemo(() => {
    const map = new Map<string, number>();
    teamMembers.forEach((member, idx) => {
      map.set(member.id, idx);
    });
    // Unassigned row is always after all team member rows
    map.set("__unassigned__", teamMembers.length);
    return map;
  }, [teamMembers]);

  // Filter to only ghosts whose new position is at least partly visible
  const visibleGhosts = useMemo(() => {
    return ghostPreviews
      .map((ghost) => {
        const originalEvent = eventMap.get(ghost.taskId);
        if (!originalEvent) return null;

        // Determine which row this ghost belongs in
        const memberIds = originalEvent.teamMemberIds;
        let rowIdx: number;
        if (memberIds.length === 0) {
          rowIdx = memberRowIndex.get("__unassigned__") ?? teamMembers.length;
        } else {
          // Place ghost in the first team member's row (same as real block)
          rowIdx = memberRowIndex.get(memberIds[0]) ?? -1;
          if (rowIdx === -1) return null;
        }

        // Calculate horizontal positioning (same logic as TimelineTaskBlock)
        const eventStart = differenceInCalendarDays(ghost.newStart, startDate);
        const eventEnd = differenceInCalendarDays(ghost.newEnd, startDate);
        const durationDays = Math.max(eventEnd - eventStart, 1);

        const clampedStart = clamp(eventStart, 0, daysShown);
        const clampedEnd = clamp(eventStart + durationDays, 0, daysShown);
        const widthPercent = ((clampedEnd - clampedStart) / daysShown) * 100;

        // Skip if completely out of view
        if (widthPercent <= 0) return null;

        // Build a synthetic InternalCalendarEvent with the ghost's new dates
        const ghostEvent: InternalCalendarEvent = {
          ...originalEvent,
          startDate: ghost.newStart,
          endDate: ghost.newEnd,
        };

        return { ghost, ghostEvent, rowIdx };
      })
      .filter(Boolean) as Array<{
        ghost: (typeof ghostPreviews)[number];
        ghostEvent: InternalCalendarEvent;
        rowIdx: number;
      }>;
  }, [ghostPreviews, eventMap, memberRowIndex, startDate, daysShown, teamMembers.length]);

  if (visibleGhosts.length === 0) return null;

  // ROW_HEIGHT from timeline-constants (72px)
  const ROW_HEIGHT = 72;

  return (
    <>
      {visibleGhosts.map(({ ghost, ghostEvent, rowIdx }) => (
        <motion.div
          key={`ghost-${ghost.taskId}`}
          className="absolute pointer-events-none"
          style={{
            top: rowIdx * ROW_HEIGHT,
            height: ROW_HEIGHT,
            // Skip the gutter (200px) — ghosts position within the grid area
            left: 200,
            right: 0,
            zIndex: 10,
          }}
          animate={{ opacity: [0.3, 0.5, 0.3] }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <div className="relative w-full h-full">
            <TimelineTaskBlock
              event={ghostEvent}
              startDate={startDate}
              daysShown={daysShown}
              isGhost
            />
          </div>
        </motion.div>
      ))}
    </>
  );
}
