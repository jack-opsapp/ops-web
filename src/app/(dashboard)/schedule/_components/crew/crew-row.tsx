"use client";

import { type ReactNode } from "react";
import { addDays, isToday } from "date-fns";
import { Star } from "lucide-react";
import type { TeamMember } from "@/lib/types/models";
import { getInitials, getUserRoleDisplay } from "@/lib/types/models";
import {
  CREW_ROW_HEIGHT,
  CREW_GUTTER_WIDTH,
  CREW_DAY_MIN_WIDTH,
} from "@/lib/utils/crew-constants";

// Sentinel id for the special-events row (must match
// SPECIAL_EVENTS_MEMBER.id in crew-grid.tsx). When the gutter renders this
// row, it swaps the avatar/name/role for a `// SPECIAL EVENTS` label per
// bug 1ceb0789.
const SPECIAL_EVENTS_ID = "__special_events__";

// ─── Props ──────────────────────────────────────────────────────────────────

interface CrewRowProps {
  teamMember: TeamMember;
  startDate: Date;
  daysShown: number;
  isLast?: boolean;
  /** Optional row height override — used by lane stacking when overlaps push the row taller. */
  rowHeight?: number;
  children?: ReactNode;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CrewRow({
  teamMember,
  startDate,
  daysShown,
  isLast = false,
  rowHeight,
  children,
}: CrewRowProps) {
  const isSpecialEvents = teamMember.id === SPECIAL_EVENTS_ID;
  const fullName = `${teamMember.firstName} ${teamMember.lastName}`.trim() || "Unknown";
  const initials = getInitials(fullName);
  const roleLabel = getUserRoleDisplay(teamMember.role);
  const days = Array.from({ length: daysShown }, (_, i) => addDays(startDate, i));

  return (
    <div
      className="flex group transition-colors duration-150"
      style={{
        height: rowHeight ?? CREW_ROW_HEIGHT,
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
        background: "transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.02)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Sticky left gutter — team member info, or // SPECIAL EVENTS label */}
      <div
        className="shrink-0 flex items-center gap-[8px] px-[12px] sticky left-0 z-10"
        style={{
          width: CREW_GUTTER_WIDTH,
          background: "#0A0A0A",
          borderRight: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        {isSpecialEvents ? (
          <>
            {/* Star glyph in the avatar slot — same 28px footprint so the
                row aligns with crew rows. */}
            <div
              className="shrink-0 flex items-center justify-center rounded-full"
              style={{
                width: 28,
                height: 28,
                border: "1px solid rgba(255, 255, 255, 0.18)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "rgba(255, 255, 255, 0.9)",
              }}
              aria-hidden="true"
            >
              <Star size={12} strokeWidth={1.5} fill="currentColor" />
            </div>

            {/* `// SPECIAL EVENTS` — Cake Mono Light uppercase per spec
                voice (bug 1ceb0789). */}
            <div className="flex flex-col min-w-0">
              <span
                className="font-cakemono font-light uppercase truncate leading-tight"
                style={{
                  fontSize: 12,
                  color: "var(--text)",
                  letterSpacing: 0,
                }}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    color: "var(--text-mute)",
                    letterSpacing: "0.16em",
                    marginRight: 4,
                  }}
                >
                  {"//"}
                </span>
                {"SPECIAL EVENTS"}
              </span>
              <span
                className="font-mono text-micro uppercase tracking-wider leading-tight"
                style={{ color: "var(--text-3)" }}
              >
                personal · time off
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Initials circle or profile image */}
            {teamMember.profileImageURL ? (
              <img
                src={teamMember.profileImageURL}
                alt={fullName}
                className="rounded-full object-cover shrink-0"
                style={{
                  width: 28,
                  height: 28,
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              />
            ) : (
              <div
                className="shrink-0 flex items-center justify-center rounded-full font-mohave font-semibold text-[11px]"
                style={{
                  width: 28,
                  height: 28,
                  border: "2px solid #59779F",
                  color: "#59779F",
                }}
              >
                {initials}
              </div>
            )}

            {/* Name + Role */}
            <div className="flex flex-col min-w-0">
              <span className="font-mohave font-semibold text-[13px] text-text truncate leading-tight">
                {fullName}
              </span>
              <span className="font-mono text-micro uppercase tracking-wider text-text-2 leading-tight">
                {roleLabel}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Day cells area — relative container for task block children */}
      <div className="flex flex-1 min-w-0 relative">
        {days.map((day, idx) => {
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className="relative min-w-0"
              style={{
                flex: "1 1 0%",
                borderRight:
                  idx < daysShown - 1
                    ? "1px solid rgba(255,255,255,0.05)"
                    : "none",
                // Today column tint bumped 0.06 → var(--ops-accent-soft)
                // (0.12) so the column reads cleanly under crew rows
                // (bug a561f726).
                background: today
                  ? "var(--ops-accent-soft)"
                  : "transparent",
              }}
            />
          );
        })}

        {/* Children (task blocks) are positioned absolutely over the day cells */}
        {children}
      </div>
    </div>
  );
}
