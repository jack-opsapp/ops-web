"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
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
  useScheduleMetrics,
} from "@/lib/hooks";
import { useScheduledUserEvents } from "@/lib/hooks/use-calendar-user-events";
import { MetricsHeader } from "@/components/metrics";
import { useSchedulerShortcuts } from "@/lib/hooks/use-scheduler-shortcuts";
import {
  type InternalScheduleEvent,
  mapTaskToInternalEvent,
  mapUserEventToInternalEvent,
} from "@/lib/utils/schedule-utils";
import {
  scheduleViewVariants,
  scheduleViewVariantsReduced,
} from "@/lib/utils/motion";
import { useScheduleStore } from "@/stores/schedule-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { queryKeys } from "@/lib/api/query-client";
import { getSupabaseClient } from "@/lib/supabase/client";
import { UserRole, type TeamMember } from "@/lib/types/models";

import { ScheduleHeader } from "./_components/schedule-header";
import { ScheduleToolbar } from "./_components/schedule-toolbar";
import { CrewScrollContainer } from "./_components/crew/crew-scroll-container";
import { MonthScrollContainer } from "./_components/month/month-scroll-container";
import { WeekScrollContainer } from "./_components/week/week-scroll-container";
import { DayScrollContainer } from "./_components/day/day-scroll-container";
import { UnscheduledTray } from "./_components/unscheduled-tray";
import { FilterSidebar } from "./_components/filter-sidebar";
import { CascadeConfirmBar } from "./_components/cascade/cascade-confirm-bar";
import { GhostOverlay } from "./_components/cascade/ghost-overlay";
import { ScheduleDndShell } from "./_components/schedule-dnd-shell";
import { TaskDetailPanel } from "./_components/side-panel/task-detail-panel";
import { ProjectDrawerPanel } from "./_components/side-panel/project-drawer-panel";

export default function SchedulePage() {
  usePageTitle("Schedule");
  const { t } = useDictionary("schedule");
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
  } = useScheduleStore();

  const router = useRouter();

  // Keyboard shortcuts (replaces inline handler)
  useSchedulerShortcuts();

  useEffect(() => {
    trackScreenView("schedule");
  }, []);

  // ── Realtime sync (bug 71308894) ────────────────────────────────────────
  //
  // The calendar reads from `project_tasks` (via TanStack Query
  // calendar.scheduled key) and `calendar_user_events` (via the user-events
  // hook). Without realtime, edits made on the iOS app or by another
  // operator only show up here on a manual refetch — which produces the
  // "stale schedule" bug.
  //
  // Subscribe to both tables, scoped to the current company. On any
  // INSERT / UPDATE / DELETE, invalidate the calendar.all tree so every
  // visible window re-fetches. Tasks list is invalidated too because
  // useScheduledTasks reads from the same task records as useTasks.
  const company = useAuthStore((s) => s.company);
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!companyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`schedule-realtime-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_tasks",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
          queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_user_events",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  // Animation: reduced motion preference
  const prefersReducedMotion = useReducedMotion();
  const viewVariants = prefersReducedMotion
    ? scheduleViewVariantsReduced
    : scheduleViewVariants;

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

  const { data: scheduleMetrics = [], isLoading: scheduleMetricsLoading } = useScheduleMetrics();

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
  const events: InternalScheduleEvent[] = useMemo(() => {
    const taskEvents = (scheduledTasks ?? [])
      .map(mapTaskToInternalEvent)
      .filter((e): e is InternalScheduleEvent => e !== null);

    const userEvents = (scheduledUserEvents ?? []).map(
      mapUserEventToInternalEvent
    );

    let mapped: InternalScheduleEvent[] = [...taskEvents, ...userEvents];

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
    (event: InternalScheduleEvent) => {
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
    <div className="flex flex-col h-full min-w-0 overflow-hidden gap-3" data-schedule-motion-scope>
      <MetricsHeader
        variant="compact"
        tabId="schedule"
        title="Schedule"
        metrics={scheduleMetrics}
        isLoading={scheduleMetricsLoading}
      />
      <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-1.5">
      <ScheduleHeader t={t} />
      <ScheduleToolbar events={events} t={t} />

      {/* Main content area — wrapped in a single dnd-kit context so the
          unscheduled tray, project drawer, and continuous-scroll calendar
          panels all share one drag surface. */}
      <ScheduleDndShell>
      <div className="flex flex-1 min-h-0 min-w-0 gap-1.5">
        {/* Filter sidebar (left) — hidden on mobile */}
        {!isMobile && <FilterSidebar />}

        {/* Unscheduled tray — docks LEFT in every view (bug 8620c037).
            Was previously LEFT only in day view and RIGHT in week/month/crew,
            which made the tray feel like it was bouncing across views. The
            tray is a secondary panel — left-side placement matches the
            sidebar / filter rail mental model. Documented in
            `.interface-design/system.md` § Calendar. */}
        {!isMobile && <UnscheduledTray view={view} />}

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

      </div>

      {/* Side panels — read sidePanelMode from the calendar store. Click on
          an event card opens TaskDetailPanel; clicking a project name opens
          ProjectDrawerPanel. Mounted inside the dnd shell so the
          project-drawer-task draggable participates in the same context as
          calendar droppables. */}
      <TaskDetailPanel />
      <ProjectDrawerPanel />
      </ScheduleDndShell>
      </div>
    </div>
  );
}
