"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  addHours,
  addMonths,
  addWeeks,
  addDays,
  subMonths,
  subWeeks,
  subDays,
} from "date-fns";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { trackScreenView } from "@/lib/analytics/analytics";
import { useCalendarEventsForRange, useDeleteCalendarEvent, useUpdateCalendarEvent } from "@/lib/hooks";
import {
  type InternalCalendarEvent,
  mapApiEventToInternal,
  snapToGrid,
  detectConflicts,
} from "@/lib/utils/calendar-utils";
import {
  calendarViewVariants,
  calendarViewVariantsReduced,
} from "@/lib/utils/motion";
import { useCalendarStore } from "@/stores/calendar-store";

import { CalendarHeader } from "./_components/calendar-header";
import { CalendarToolbar } from "./_components/calendar-toolbar";
import { CalendarGridMonth } from "./_components/calendar-grid-month";
import { CalendarGridWeek } from "./_components/calendar-grid-week";
import { CalendarGridDay } from "./_components/calendar-grid-day";
import { CalendarGridTeam } from "./_components/calendar-grid-team";
import { CalendarAgenda } from "./_components/calendar-agenda";
import { EventDetailPanel } from "./_components/event-detail-panel";
import { EventQuickCreate } from "./_components/event-quick-create";
import { CalendarDndContext } from "./_components/calendar-dnd-context";
import { EventContextMenu } from "./_components/event-context-menu";
import { FilterSidebar } from "./_components/filter-sidebar";

export default function CalendarPage() {
  const { t } = useDictionary("calendar");
  const {
    currentDate,
    view,
    setView,
    setCurrentDate,
    goToToday,
    selectedEventId,
    selectEvent,
    setQuickCreateAnchor,
    filterTaskTypes,
    filterTeamMemberIds,
    filterProjectIds,
    filterStatuses,
  } = useCalendarStore();

  const deleteMutation = useDeleteCalendarEvent();
  const updateMutation = useUpdateCalendarEvent();

  // Context menu state
  const [contextMenuEvent, setContextMenuEvent] = useState<InternalCalendarEvent | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => { trackScreenView("calendar"); }, []);

  // Animation: reduced motion preference + view direction tracking
  const prefersReducedMotion = useReducedMotion();
  const viewVariants = prefersReducedMotion ? calendarViewVariantsReduced : calendarViewVariants;

  // Responsive: track window width for layout adjustments
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isMobile = windowWidth < 768;
  const isTablet = windowWidth >= 768 && windowWidth < 1200;

  // On mobile, default to agenda view
  useEffect(() => {
    if (isMobile && view !== "agenda") {
      setView("agenda");
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
      case "week":
        return { rangeStart: startOfWeek(currentDate), rangeEnd: endOfWeek(currentDate) };
      case "agenda":
        return { rangeStart: startOfDay(currentDate), rangeEnd: endOfDay(addDays(currentDate, 13)) };
      case "day":
      case "team":
      default:
        return { rangeStart: startOfDay(currentDate), rangeEnd: endOfDay(currentDate) };
    }
  }, [currentDate, view]);

  const { data: apiEvents, isLoading } = useCalendarEventsForRange(rangeStart, rangeEnd);

  // Map + filter events
  const events: InternalCalendarEvent[] = useMemo(() => {
    if (!apiEvents) return [];
    let mapped = apiEvents
      .map(mapApiEventToInternal)
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
      mapped = mapped.filter((e) => e.projectId && filterProjectIds.includes(e.projectId));
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
  }, [apiEvents, filterTaskTypes, filterTeamMemberIds, filterProjectIds, filterStatuses]);

  // Conflict detection
  const conflictIds = useMemo(() => detectConflicts(events), [events]);

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
      selectEvent(event.id);
    },
    [selectEvent]
  );

  const handleEventContextMenu = useCallback(
    (event: InternalCalendarEvent, x: number, y: number) => {
      setContextMenuEvent(event);
      setContextMenuPos({ x, y });
    },
    []
  );

  const handleEmptySlotClick = useCallback(
    (date: Date, clientX: number, clientY: number) => {
      const snapped = snapToGrid(date);
      setQuickCreateAnchor({
        x: clientX,
        y: clientY,
        date: snapped,
        endDate: addHours(snapped, 1),
      });
    },
    [setQuickCreateAnchor]
  );

  const handleRangeSelect = useCallback(
    (startDate: Date, endDate: Date, clientX: number, clientY: number) => {
      setQuickCreateAnchor({
        x: clientX,
        y: clientY,
        date: startDate,
        endDate,
      });
    },
    [setQuickCreateAnchor]
  );

  const handleEventResize = useCallback(
    (event: InternalCalendarEvent, newEndDate: Date) => {
      updateMutation.mutate({
        id: event.id,
        data: { endDate: newEndDate },
      });
    },
    [updateMutation]
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case "ArrowLeft": e.preventDefault(); {
          const d = useCalendarStore.getState().currentDate;
          if (view === "month") setCurrentDate(subMonths(d, 1));
          else if (view === "week") setCurrentDate(subWeeks(d, 1));
          else setCurrentDate(subDays(d, 1));
        } break;
        case "ArrowRight": e.preventDefault(); {
          const d = useCalendarStore.getState().currentDate;
          if (view === "month") setCurrentDate(addMonths(d, 1));
          else if (view === "week") setCurrentDate(addWeeks(d, 1));
          else setCurrentDate(addDays(d, 1));
        } break;
        // View switching: D/W/M/T/A
        case "d": case "D": if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setView("day"); } break;
        case "w": case "W": if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setView("week"); } break;
        case "m": case "M": if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setView("month"); } break;
        case "t": case "T": if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setView("team"); } break;
        case "a": case "A": if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setView("agenda"); } break;
        // Navigation
        case "y": case "Y": if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); goToToday(); } break;
        // Create — open quick-create at current date center of viewport
        case "c": case "C": if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const now = new Date();
          const snapped = snapToGrid(now);
          setQuickCreateAnchor({
            x: window.innerWidth / 2,
            y: window.innerHeight / 3,
            date: snapped,
            endDate: addHours(snapped, 1),
          });
        } break;
        // Edit — open detail panel for selected event
        case "e": case "E": if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const { selectedEventId, isDetailPanelOpen } = useCalendarStore.getState();
          if (selectedEventId && !isDetailPanelOpen) {
            selectEvent(selectedEventId); // re-trigger to open panel
          }
        } break;
        // Tab — cycle through events
        case "Tab": {
          if (events.length === 0) break;
          e.preventDefault();
          const { selectedEventId } = useCalendarStore.getState();
          const currentIndex = selectedEventId
            ? events.findIndex((ev) => ev.id === selectedEventId)
            : -1;
          const direction = e.shiftKey ? -1 : 1;
          const nextIndex = (currentIndex + direction + events.length) % events.length;
          selectEvent(events[nextIndex].id);
        } break;
        // Enter — open detail panel for selected event
        case "Enter": {
          const { selectedEventId } = useCalendarStore.getState();
          if (selectedEventId) {
            e.preventDefault();
            selectEvent(selectedEventId);
          }
        } break;
        // Delete — delete selected event
        case "Delete": case "Backspace": {
          const { selectedEventId } = useCalendarStore.getState();
          if (selectedEventId) {
            e.preventDefault();
            deleteMutation.mutate(selectedEventId);
            selectEvent(null);
          }
        } break;
        case "Escape":
          selectEvent(null);
          setQuickCreateAnchor(null);
          setContextMenuEvent(null);
          setContextMenuPos(null);
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, setCurrentDate, goToToday, setView, selectEvent, setQuickCreateAnchor, deleteMutation]);

  return (
    <div className="flex flex-col h-full gap-1.5">
      <CalendarHeader t={t} />
      <CalendarToolbar events={events} t={t} />

      {/* Calendar Content — wrapped in DnD context */}
      <CalendarDndContext events={events}>
        <div className="flex flex-1 min-h-0 gap-1.5">
          {/* Filter sidebar (left) — hidden on mobile */}
          {!isMobile && <FilterSidebar />}

          {/* Main calendar grid */}
          <div
            className="flex-1 bg-background-panel border border-border rounded-lg overflow-hidden flex flex-col min-h-0"
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
                <p className="font-mohave text-body-sm text-text-tertiary">{t("loading")}</p>
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
                  {view === "month" && (
                    <CalendarGridMonth
                      currentDate={currentDate}
                      events={events}
                      onSelectDate={handleSelectDate}
                      onEventClick={handleEventClick}
                      t={t}
                    />
                  )}
                  {view === "week" && (
                    <CalendarGridWeek
                      currentDate={currentDate}
                      events={events}
                      conflictIds={conflictIds}
                      onSelectDate={handleSelectDate}
                      onEventClick={handleEventClick}
                      onEventContextMenu={handleEventContextMenu}
                      onEventResize={handleEventResize}
                      onEmptySlotClick={handleEmptySlotClick}
                      onRangeSelect={handleRangeSelect}
                      selectedEventId={selectedEventId}
                      t={t}
                    />
                  )}
                  {view === "day" && (
                    <CalendarGridDay
                      currentDate={currentDate}
                      events={events}
                      conflictIds={conflictIds}
                      onEventClick={handleEventClick}
                      onEventContextMenu={handleEventContextMenu}
                      onEventResize={handleEventResize}
                      onEmptySlotClick={handleEmptySlotClick}
                      onRangeSelect={handleRangeSelect}
                      selectedEventId={selectedEventId}
                      t={t}
                    />
                  )}
                  {view === "team" && (
                    <CalendarGridTeam
                      currentDate={currentDate}
                      events={events}
                      conflictIds={conflictIds}
                      onEventClick={handleEventClick}
                      onEventContextMenu={handleEventContextMenu}
                      t={t}
                    />
                  )}
                  {view === "agenda" && (
                    <CalendarAgenda
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
        </div>
      </CalendarDndContext>

      {/* Interactive overlays */}
      <EventDetailPanel />
      <EventQuickCreate />
      <EventContextMenu
        event={contextMenuEvent}
        position={contextMenuPos}
        onClose={() => {
          setContextMenuEvent(null);
          setContextMenuPos(null);
        }}
      />
    </div>
  );
}
