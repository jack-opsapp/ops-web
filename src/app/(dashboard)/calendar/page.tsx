"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
} from "date-fns";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { trackScreenView } from "@/lib/analytics/analytics";
import {
  useScheduledTasks,
  useTeamMembers,
} from "@/lib/hooks";
import { useSchedulerShortcuts } from "@/lib/hooks/use-scheduler-shortcuts";
import {
  type InternalCalendarEvent,
  mapTaskToInternalEvent,
} from "@/lib/utils/calendar-utils";
import {
  calendarViewVariants,
  calendarViewVariantsReduced,
} from "@/lib/utils/motion";
import { useCalendarStore } from "@/stores/calendar-store";
import type { TeamMember } from "@/lib/types/models";

import { CalendarHeader } from "./_components/calendar-header";
import { CalendarToolbar } from "./_components/calendar-toolbar";
import { CalendarGridMonth } from "./_components/calendar-grid-month";
import { CalendarGridDay } from "./_components/calendar-grid-day";
import { TimelineGrid } from "./_components/timeline/timeline-grid";
import { FilterSidebar } from "./_components/filter-sidebar";
import { TaskDetailPanel } from "./_components/side-panel/task-detail-panel";
import { ProjectDrawerPanel } from "./_components/side-panel/project-drawer-panel";
import { CascadeConfirmBar } from "./_components/cascade/cascade-confirm-bar";
import { GhostOverlay } from "./_components/cascade/ghost-overlay";

export default function CalendarPage() {
  const { t } = useDictionary("calendar");
  const {
    currentDate,
    view,
    setView,
    setCurrentDate,
    setSidePanelTask,
    filterTaskTypes,
    filterTeamMemberIds,
    filterProjectIds,
    filterStatuses,
    isConfirmBarVisible,
    ghostPreviews,
  } = useCalendarStore();

  // Keyboard shortcuts (replaces inline handler)
  useSchedulerShortcuts();

  useEffect(() => {
    trackScreenView("calendar");
  }, []);

  // Animation: reduced motion preference
  const prefersReducedMotion = useReducedMotion();
  const viewVariants = prefersReducedMotion
    ? calendarViewVariantsReduced
    : calendarViewVariants;

  // Responsive: track window width
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isMobile = windowWidth < 768;

  // On mobile, force day view
  useEffect(() => {
    if (isMobile && view !== "day") {
      setView("day");
    }
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute date range for data fetching
  const { rangeStart, rangeEnd } = useMemo(() => {
    switch (view) {
      case "month": {
        const ms = startOfMonth(currentDate);
        const me = endOfMonth(currentDate);
        return { rangeStart: startOfWeek(ms), rangeEnd: endOfWeek(me) };
      }
      case "timeline":
        return {
          rangeStart: startOfWeek(currentDate),
          rangeEnd: endOfWeek(currentDate),
        };
      case "day":
      default:
        return {
          rangeStart: startOfDay(currentDate),
          rangeEnd: endOfDay(currentDate),
        };
    }
  }, [currentDate, view]);

  const { data: scheduledTasks, isLoading } = useScheduledTasks(
    rangeStart,
    rangeEnd
  );

  // Team members for timeline
  const { data: teamData } = useTeamMembers();
  const teamMembers: TeamMember[] = useMemo(() => {
    const users = teamData?.users ?? [];
    return users.map((u) => ({
      id: u.id,
      userId: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      profileImageURL: u.profileImageURL,
      role: u.role,
      userColor: u.userColor,
      isActive: u.isActive ?? true,
    }));
  }, [teamData]);

  // Map + filter events
  const events: InternalCalendarEvent[] = useMemo(() => {
    if (!scheduledTasks) return [];
    let mapped = scheduledTasks
      .map(mapTaskToInternalEvent)
      .filter((e): e is InternalCalendarEvent => e !== null);

    if (filterTaskTypes.length > 0) {
      mapped = mapped.filter((e) => filterTaskTypes.includes(e.taskType));
    }
    if (filterTeamMemberIds.length > 0) {
      mapped = mapped.filter((e) =>
        e.teamMemberIds.some((id) => filterTeamMemberIds.includes(id))
      );
    }
    if (filterProjectIds.length > 0) {
      mapped = mapped.filter(
        (e) => e.projectId && filterProjectIds.includes(e.projectId)
      );
    }
    if (filterStatuses.length > 0) {
      const now = new Date();
      mapped = mapped.filter((e) => {
        const isUpcoming = e.startDate > now;
        const isPast = e.endDate < now;
        const isInProgress = !isUpcoming && !isPast;
        return (
          (filterStatuses.includes("upcoming") && isUpcoming) ||
          (filterStatuses.includes("past") && isPast) ||
          (filterStatuses.includes("in-progress") && isInProgress)
        );
      });
    }

    return mapped;
  }, [
    scheduledTasks,
    filterTaskTypes,
    filterTeamMemberIds,
    filterProjectIds,
    filterStatuses,
  ]);

  // Handlers
  const handleSelectDate = useCallback(
    (date: Date) => {
      setCurrentDate(date);
      setView("day");
    },
    [setCurrentDate, setView]
  );

  const handleEventClick = useCallback(
    (event: InternalCalendarEvent) => {
      setSidePanelTask(event.id);
    },
    [setSidePanelTask]
  );

  // Timeline start date (week start)
  const timelineStartDate = useMemo(
    () => startOfWeek(currentDate),
    [currentDate]
  );

  return (
    <div className="flex flex-col h-full gap-1.5">
      <CalendarHeader t={t} />
      <CalendarToolbar events={events} t={t} />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 gap-1.5">
        {/* Filter sidebar (left) — hidden on mobile */}
        {!isMobile && <FilterSidebar />}

        {/* Main calendar grid */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
          {/* Cascade confirm bar — sits above the view */}
          {isConfirmBarVisible && (
            <div className="shrink-0 mb-1">
              <CascadeConfirmBar />
            </div>
          )}

          {/* View canvas */}
          <div
            className="flex-1 bg-background-panel border border-border rounded overflow-hidden flex flex-col min-h-0"
            style={{
              backgroundImage: [
                "linear-gradient(rgba(65, 115, 148, 0.015) 1px, transparent 1px)",
                "linear-gradient(90deg, rgba(65, 115, 148, 0.015) 1px, transparent 1px)",
              ].join(", "),
              backgroundSize: "24px 24px",
            }}
          >
            {isLoading && (
              <div className="flex flex-col items-center justify-center flex-1 min-h-[200px] gap-3">
                <Loader2 className="w-[32px] h-[32px] text-ops-accent animate-spin" />
                <p className="font-mohave text-body-sm text-text-tertiary">
                  {t("loading")}
                </p>
              </div>
            )}
            {!isLoading && (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={view}
                  variants={viewVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="flex flex-col flex-1 min-h-0"
                >
                  {view === "timeline" && (
                    <TimelineGrid
                      events={events}
                      teamMembers={teamMembers}
                      startDate={timelineStartDate}
                      onEventClick={handleEventClick}
                    />
                  )}
                  {view === "month" && (
                    <CalendarGridMonth
                      currentDate={currentDate}
                      events={events}
                      onSelectDate={handleSelectDate}
                      onEventClick={handleEventClick}
                      t={t}
                    />
                  )}
                  {view === "day" && (
                    <CalendarGridDay
                      currentDate={currentDate}
                      events={events}
                      onEventClick={handleEventClick}
                      t={t}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* Ghost overlay — only visible in timeline view with active previews */}
          {view === "timeline" && ghostPreviews.length > 0 && (
            <GhostOverlay
              startDate={timelineStartDate}
              daysShown={7}
              teamMembers={teamMembers}
              events={events}
            />
          )}
        </div>

        {/* Side panels (right) — hidden on mobile */}
        {!isMobile && (
          <>
            <TaskDetailPanel />
            <ProjectDrawerPanel />
          </>
        )}
      </div>
    </div>
  );
}
