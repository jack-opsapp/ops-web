"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { MotionConfig } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import {
  useProjects,
  useTasks,
  useClients,
  useTeamMembers,
  useCalendarEventsForRange,
} from "@/lib/hooks";
import {
  type ProjectTask,
  TaskStatus,
  isActiveProjectStatus,
} from "@/lib/types/models";
import {
  startOfWeek,
  endOfWeek,
  isSameDay,
  isAfter,
} from "@/lib/utils/date";

// Widget components
import { WidgetGrid } from "@/components/dashboard/widget-grid";
import { WidgetCustomizer } from "@/components/dashboard/widget-customizer";
import { StatsWidget } from "@/components/dashboard/widgets/stats-widget";
import { CalendarWidget } from "@/components/dashboard/widgets/calendar-widget";
import { CrewWidget } from "@/components/dashboard/widgets/crew-widget";
import { TasksWidget } from "@/components/dashboard/widgets/tasks-widget";
import { ActivityWidget } from "@/components/dashboard/widgets/activity-widget";
import { PipelineWidget } from "@/components/dashboard/widgets/pipeline-widget";
import { RevenueWidget } from "@/components/dashboard/widgets/revenue-widget";
import { AlertsWidget } from "@/components/dashboard/widgets/alerts-widget";

// ---------------------------------------------------------------------------
// Greeting helper
// ---------------------------------------------------------------------------
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const router = useRouter();

  const { currentUser } = useAuthStore();
  const firstName = currentUser?.firstName || "there";
  const widgetConfigs = usePreferencesStore((s) => s.widgetConfigs);

  const today = useMemo(() => new Date(), []);
  const weekStartDate = useMemo(() => startOfWeek(today, { weekStartsOn: 0 }), [today]);
  const weekEndDate = useMemo(() => endOfWeek(today, { weekStartsOn: 0 }), [today]);

  const { data: projectsData, isLoading: projectsLoading } = useProjects();
  const { data: tasksData, isLoading: tasksLoading } = useTasks();
  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: teamData, isLoading: teamLoading } = useTeamMembers();
  const { data: calendarEvents, isLoading: calendarLoading } = useCalendarEventsForRange(
    weekStartDate,
    weekEndDate
  );

  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);
  const tasks = useMemo(() => tasksData?.tasks ?? [], [tasksData]);
  const clients = useMemo(() => clientsData?.clients ?? [], [clientsData]);
  const teamMembers = teamData?.users ?? [];
  const weekEvents = useMemo(() => calendarEvents ?? [], [calendarEvents]);

  const activeProjectCount = useMemo(
    () => projects.filter((p) => isActiveProjectStatus(p.status) && !p.deletedAt).length,
    [projects]
  );

  const weekEventCount = useMemo(() => weekEvents.length, [weekEvents]);

  const totalClientCount = useMemo(
    () => clients.filter((c) => !c.deletedAt).length,
    [clients]
  );

  const upcomingTasks = useMemo(() => {
    const now = new Date();
    return tasks
      .filter((t: ProjectTask) => {
        if (t.deletedAt) return false;
        if (t.status === TaskStatus.Completed || t.status === TaskStatus.Cancelled) return false;
        if (t.calendarEvent?.startDate) {
          const eventDate = new Date(t.calendarEvent.startDate);
          return isSameDay(eventDate, now) || isAfter(eventDate, now);
        }
        return t.status === TaskStatus.Booked || t.status === TaskStatus.InProgress;
      })
      .sort((a: ProjectTask, b: ProjectTask) => {
        const aDate = a.calendarEvent?.startDate
          ? new Date(a.calendarEvent.startDate).getTime()
          : Infinity;
        const bDate = b.calendarEvent?.startDate
          ? new Date(b.calendarEvent.startDate).getTime()
          : Infinity;
        return aDate - bDate;
      })
      .slice(0, 10);
  }, [tasks]);

  const isDataLoading = projectsLoading || tasksLoading || clientsLoading || teamLoading || calendarLoading;

  useEffect(() => {
    setMounted(true);
  }, []);

  const navigate = (path: string) => router.push(path);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className={cn(
          "space-y-3 max-w-[1400px] transition-opacity duration-500",
          mounted ? "opacity-100" : "opacity-0"
        )}
      >
        {/* Header with greeting + customize toggle */}
        <div className="animate-fade-in flex items-start justify-between gap-2">
          <div>
            <p className="font-mohave text-body-lg text-text-secondary tracking-wide">
              <span
                className={mounted ? "typewriter" : ""}
                onAnimationEnd={(e) => {
                  (e.target as HTMLElement).classList.add("typewriter-done");
                }}
              >
                {getGreeting()}, {firstName}
              </span>
            </p>
            <p className="font-kosugi text-caption-sm text-text-tertiary mt-0.5 uppercase">
              Here&apos;s your operational overview for today.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-[6px] shrink-0"
            onClick={() => setShowCustomize(!showCustomize)}
          >
            <SlidersHorizontal className="w-[14px] h-[14px]" />
            Customize
          </Button>
        </div>

        {/* Widget customization panel */}
        <WidgetCustomizer open={showCustomize} />

        {/* Widget Grid */}
        <WidgetGrid isCustomizing={showCustomize}>
          {{
            stats: (
              <StatsWidget
                size={widgetConfigs.stats.size}
                activeProjectCount={activeProjectCount}
                totalProjectCount={projects.filter((p) => !p.deletedAt).length}
                weekEventCount={weekEventCount}
                totalClientCount={totalClientCount}
                projectsLoading={projectsLoading}
                calendarLoading={calendarLoading}
                clientsLoading={clientsLoading}
              />
            ),
            calendar: (
              <CalendarWidget
                size={widgetConfigs.calendar.size}
                events={weekEvents}
                isLoading={calendarLoading}
                onNavigate={navigate}
              />
            ),
            crew: (
              <CrewWidget
                size={widgetConfigs.crew.size}
                teamMembers={teamMembers}
                isLoading={teamLoading}
                onNavigate={navigate}
              />
            ),
            tasks: (
              <TasksWidget
                size={widgetConfigs.tasks.size}
                tasks={upcomingTasks}
                isLoading={tasksLoading}
                today={today}
                onNavigate={navigate}
              />
            ),
            activity: <ActivityWidget />,
            pipeline: (
              <PipelineWidget
                size={widgetConfigs.pipeline.size}
                projects={projects}
                isLoading={projectsLoading}
                onNavigate={navigate}
              />
            ),
            revenue: (
              <RevenueWidget size={widgetConfigs.revenue.size} />
            ),
            alerts: (
              <AlertsWidget
                activeProjectCount={activeProjectCount}
                weekEventCount={weekEventCount}
                teamMemberCount={teamMembers.length}
                isDataLoading={isDataLoading}
                onNavigate={navigate}
              />
            ),
          }}
        </WidgetGrid>
      </div>
    </MotionConfig>
  );
}
