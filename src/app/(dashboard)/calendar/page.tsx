"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  addMonths,
  addWeeks,
  addDays,
} from "date-fns";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { trackScreenView } from "@/lib/analytics/analytics";
import {
  useScheduledTasks,
  useTeamMembers,
  useCalendarMetrics,
} from "@/lib/hooks";
import { useScheduledUserEvents } from "@/lib/hooks/use-calendar-user-events";
import { MetricsHeader } from "@/components/metrics";
import { useSchedulerShortcuts } from "@/lib/hooks/use-scheduler-shortcuts";
import {
  type InternalCalendarEvent,
  mapTaskToInternalEvent,
  mapUserEventToInternalEvent,
} from "@/lib/utils/calendar-utils";
import {
  calendarViewVariants,
  calendarViewVariantsReduced,
} from "@/lib/utils/motion";
import { useCalendarStore } from "@/stores/calendar-store";
import { UserRole, type TeamMember } from "@/lib/types/models";

import { CalendarHeader } from "./_components/calendar-header";
import { CalendarToolbar } from "./_components/calendar-toolbar";
import { CrewScrollContainer } from "./_components/crew/crew-scroll-container";
import { MonthScrollContainer } from "./_components/month/month-scroll-container";
import { WeekScrollContainer } from "./_components/week/week-scroll-container";
import { DayScrollContainer } from "./_components/day/day-scroll-container";
import { UnscheduledTray } from "./_components/unscheduled-tray";
import { FilterSidebar } from "./_components/filter-sidebar";
import { CascadeConfirmBar } from "./_components/cascade/cascade-confirm-bar";
import { GhostOverlay } from "./_components/cascade/ghost-overlay";
import { CalendarDndShell } from "./_components/calendar-dnd-shell";
import { TaskDetailPanel } from "./_components/side-panel/task-detail-panel";
import { ProjectDrawerPanel } from "./_components/side-panel/project-drawer-panel";

export default function CalendarPage() {
  usePageTitle("Schedule");
  const { t } = useDictionary("calendar");
  const {
    currentDate,
    view,
    setView,
    setCurrentDate,
    filterTaskTypes,
    filterTeamMemberIds,
    filterProjectIds,
    filterStatuses,
    isConfirmBarVisible,
    ghostPreviews,
  } = useCalendarStore();

  const router = useRouter();

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

  // Compute date range for data fetching. Continuous-scroll views (Month /
  // Week / Day) buffer extra panels in each direction; we match the fetch
  // window to the scroll buffer so events for the off-screen panels are
  // already cached when the user scrolls them into view. The scroll
  // containers extend their buffers when the user nears an edge — the fetch
  // range follows because the active date updates on snap, which re-runs
  // this useMemo and refetches.
  //
  // Buffer matches the scroll containers:
  //   - Month: ±6 months
  //   - Week:  ±6 weeks
  //   - Day:   ±14 days
  // Crew is not virtualized — keeps the single-week range.
  const { rangeStart, rangeEnd } = useMemo(() => {
    switch (view) {
      case "month": {
        const ms = startOfMonth(currentDate);
        const me = endOfMonth(currentDate);
        return {
          rangeStart: startOfWeek(addMonths(ms, -6)),
          rangeEnd: endOfWeek(addMonths(me, 6)),
        };
      }
      case "week":
        return {
          rangeStart: startOfWeek(addWeeks(currentDate, -6), {
            weekStartsOn: 1,
          }),
          rangeEnd: endOfWeek(addWeeks(currentDate, 6), { weekStartsOn: 1 }),
        };
      case "crew":
        // Crew now uses horizontal infinite scroll (±6 weeks like Week view).
        return {
          rangeStart: startOfWeek(addWeeks(currentDate, -6), {
            weekStartsOn: 1,
          }),
          rangeEnd: endOfWeek(addWeeks(currentDate, 6), { weekStartsOn: 1 }),
        };
      case "day":
      default:
        return {
          rangeStart: startOfDay(addDays(currentDate, -14)),
          rangeEnd: endOfDay(addDays(currentDate, 14)),
        };
    }
  }, [currentDate, view]);

  const { data: calendarMetrics = [], isLoading: calendarMetricsLoading } = useCalendarMetrics();

  const { data: scheduledTasks, isLoading } = useScheduledTasks(
    rangeStart,
    rangeEnd
  );

  // Personal events + time-off requests in the visible range. Mirrors the iOS
  // CalendarViewModel, which renders ProjectTask + CalendarUserEvent together.
  const { data: scheduledUserEvents } = useScheduledUserEvents(
    rangeStart,
    rangeEnd
  );

  // Team members for timeline
  const { data: teamData } = useTeamMembers();
  const teamMembers: TeamMember[] = useMemo(() => {
    const users = teamData?.users ?? [];
    return users
      .filter((u) => u.role !== UserRole.Unassigned)
      .map((u) => ({
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

  // Map + filter events. Combines ProjectTasks and CalendarUserEvents so the
  // grid renders both, matching iOS schedule parity.
  const events: InternalCalendarEvent[] = useMemo(() => {
    const taskEvents = (scheduledTasks ?? [])
      .map(mapTaskToInternalEvent)
      .filter((e): e is InternalCalendarEvent => e !== null);

    const userEvents = (scheduledUserEvents ?? []).map(
      mapUserEventToInternalEvent
    );

    let mapped: InternalCalendarEvent[] = [...taskEvents, ...userEvents];

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
    scheduledUserEvents,
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
      if (event.projectId) {
        router.push(`/projects/${event.projectId}`);
      }
    },
    [router]
  );

  // Crew swimlane start date (week start, Mon)
  const timelineStartDate = useMemo(
    () => startOfWeek(currentDate, { weekStartsOn: 1 }),
    [currentDate]
  );

  return (
    <div className="flex flex-col h-full gap-3" data-calendar-motion-scope>
      <MetricsHeader variant="compact" tabId="calendar" title="Schedule" metrics={calendarMetrics} isLoading={calendarMetricsLoading} />
      <div className="flex flex-col flex-1 min-h-0 gap-1.5">
      <CalendarHeader t={t} />
      <CalendarToolbar events={events} t={t} />

      {/* Main content area — wrapped in a single dnd-kit context so the
          unscheduled tray, project drawer, and continuous-scroll calendar
          panels all share one drag surface. */}
      <CalendarDndShell>
      <div className="flex flex-1 min-h-0 gap-1.5">
        {/* Filter sidebar (left) — hidden on mobile */}
        {!isMobile && <FilterSidebar />}

        {/* Day view: tray docks LEFT (mirrors Jobber/Housecall) */}
        {!isMobile && view === "day" && <UnscheduledTray view={view} />}

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
            className="flex-1 bg-glass glass-surface border border-border rounded overflow-hidden flex flex-col min-h-0"
            style={{
              backgroundImage: [
                "linear-gradient(rgba(65, 115, 148, 0.015) 1px, transparent 1px)",
                "linear-gradient(90deg, rgba(65, 115, 148, 0.015) 1px, transparent 1px)",
              ].join(", "),
              backgroundSize: "24px 24px",
            }}
          >
            {/* Loader appears only on the very first mount (no cached
                events yet). Once any data has been seen, scroll to a new
                month/week/day reuses the previous range's data via
                placeholderData on useScheduledTasks — so the calendar stays
                mounted and the user never sees a flash. */}
            {isLoading && events.length === 0 && (
              <div className="flex flex-col items-center justify-center flex-1 min-h-[200px] gap-3">
                <Loader2 className="w-[32px] h-[32px] text-text-2 animate-spin" />
                <p className="font-mohave text-body-sm text-text-3">
                  {t("loading")}
                </p>
              </div>
            )}
            {(!isLoading || events.length > 0) && (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={view}
                  variants={viewVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="flex flex-col flex-1 min-h-0"
                >
                  {view === "crew" && (
                    <CrewScrollContainer
                      currentDate={currentDate}
                      events={events}
                      teamMembers={teamMembers}
                      onCurrentDateChange={setCurrentDate}
                      onEventClick={handleEventClick}
                    />
                  )}
                  {view === "week" && (
                    <WeekScrollContainer
                      currentDate={currentDate}
                      events={events}
                      onCurrentDateChange={setCurrentDate}
                    />
                  )}
                  {view === "month" && (
                    <MonthScrollContainer
                      currentDate={currentDate}
                      events={events}
                      onCurrentDateChange={setCurrentDate}
                      onSelectDate={handleSelectDate}
                      onEventClick={handleEventClick}
                      t={t}
                    />
                  )}
                  {view === "day" && (
                    <DayScrollContainer
                      currentDate={currentDate}
                      events={events}
                      onCurrentDateChange={setCurrentDate}
                      onEventClick={handleEventClick}
                      t={t}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* Ghost overlay — only visible in crew view with active previews */}
          {view === "crew" && ghostPreviews.length > 0 && (
            <GhostOverlay
              startDate={timelineStartDate}
              daysShown={7}
              teamMembers={teamMembers}
              events={events}
            />
          )}
        </div>

        {/* Week / Month / Crew view: tray docks RIGHT */}
        {!isMobile && view !== "day" && <UnscheduledTray view={view} />}

      </div>

      {/* Side panels — read sidePanelMode from the calendar store. Click on
          an event card opens TaskDetailPanel; clicking a project name opens
          ProjectDrawerPanel. Mounted inside the dnd shell so the
          project-drawer-task draggable participates in the same context as
          calendar droppables. */}
      <TaskDetailPanel />
      <ProjectDrawerPanel />
      </CalendarDndShell>
      </div>
    </div>
  );
}
