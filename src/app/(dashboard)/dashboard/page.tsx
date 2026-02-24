"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
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
import type { WidgetInstance, WidgetTypeId } from "@/lib/types/dashboard-widgets";

// Widget components
import { WidgetGrid } from "@/components/dashboard/widget-grid";
import { WidgetSidebar } from "@/components/dashboard/widget-sidebar";
import { StatWidget } from "@/components/dashboard/widgets/stat-widget";
import { CalendarWidget } from "@/components/dashboard/widgets/calendar-widget";
import { CrewWidget } from "@/components/dashboard/widgets/crew-status-widget";
import { TaskListWidget } from "@/components/dashboard/widgets/task-list-widget";
import { ActivityWidget } from "@/components/dashboard/widgets/activity-feed-widget";
import { PipelineWidget } from "@/components/dashboard/widgets/pipeline-funnel-widget";
import { RevenueWidget } from "@/components/dashboard/widgets/revenue-chart-widget";
import { AlertsWidget } from "@/components/dashboard/widgets/action-bar-widget";
import { InvoiceListWidget } from "@/components/dashboard/widgets/invoice-list-widget";
import { InvoiceAgingWidget } from "@/components/dashboard/widgets/invoice-aging-widget";
import { PaymentsRecentWidget } from "@/components/dashboard/widgets/payments-recent-widget";
import { ExpenseSummaryWidget } from "@/components/dashboard/widgets/expense-summary-widget";
import { PipelineListWidget } from "@/components/dashboard/widgets/pipeline-list-widget";
import { PipelineValueWidget } from "@/components/dashboard/widgets/pipeline-value-widget";
import { PipelineVelocityWidget } from "@/components/dashboard/widgets/pipeline-velocity-widget";
import { PipelineSourcesWidget } from "@/components/dashboard/widgets/pipeline-sources-widget";
import { ClientListWidget } from "@/components/dashboard/widgets/client-list-widget";
import { ClientRevenueWidget } from "@/components/dashboard/widgets/client-revenue-widget";
import { ClientActivityWidget } from "@/components/dashboard/widgets/client-activity-widget";
import { ClientAttentionWidget } from "@/components/dashboard/widgets/client-attention-widget";
import { EstimatesOverviewWidget } from "@/components/dashboard/widgets/estimates-overview-widget";
import { EstimatesFunnelWidget } from "@/components/dashboard/widgets/estimates-funnel-widget";
import { OverdueTasksWidget } from "@/components/dashboard/widgets/overdue-tasks-widget";
import { PastDueInvoicesWidget } from "@/components/dashboard/widgets/past-due-invoices-widget";
import { NotificationsWidget } from "@/components/dashboard/widgets/notifications-widget";
import { FollowUpsDueWidget } from "@/components/dashboard/widgets/follow-ups-due-widget";
import { SiteVisitsWidget } from "@/components/dashboard/widgets/site-visits-widget";
import { CrewLocationsWidget } from "@/components/dashboard/widgets/crew-locations-widget";

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
// Placeholder widget for types not yet implemented
// ---------------------------------------------------------------------------
function PlaceholderWidget({ typeId, label }: { typeId: string; label: string }) {
  return (
    <div className="h-full rounded-lg bg-background-card border border-border p-2 flex flex-col items-center justify-center">
      <span className="font-mono text-micro text-text-disabled uppercase">{typeId}</span>
      <span className="font-mohave text-body-sm text-text-tertiary mt-[4px]">{label}</span>
      <span className="font-mono text-[9px] text-text-disabled mt-1">Coming soon</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

  const { currentUser } = useAuthStore();
  const firstName = currentUser?.firstName || "there";
  const widgetInstances = usePreferencesStore((s) => s.widgetInstances);

  // ── Data hooks for non-stat widgets that receive props ──
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
  const teamMembers = teamData?.users ?? [];
  const weekEvents = useMemo(() => calendarEvents ?? [], [calendarEvents]);

  // Computed values for legacy widgets that still need props
  const activeProjectCount = useMemo(
    () => projects.filter((p) => isActiveProjectStatus(p.status) && !p.deletedAt).length,
    [projects]
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

  // ---------------------------------------------------------------------------
  // Render widget content by type
  // ---------------------------------------------------------------------------
  function renderWidgetContent(instance: WidgetInstance): ReactNode {
    const { typeId, size, config } = instance;

    switch (typeId as WidgetTypeId) {
      // ── STAT WIDGETS (self-contained — fetch own data) ──
      case "stat-projects":
      case "stat-tasks":
      case "stat-events":
      case "stat-clients":
      case "stat-team":
      case "stat-revenue":
      case "stat-invoices":
      case "stat-estimates":
      case "stat-opportunities":
        return <StatWidget typeId={typeId} config={config} />;

      // ── SCHEDULE ──
      case "calendar":
        return (
          <CalendarWidget
            size={size}
            events={weekEvents}
            isLoading={calendarLoading}
            onNavigate={navigate}
          />
        );
      case "task-list":
        return (
          <TaskListWidget
            size={size}
            tasks={upcomingTasks}
            isLoading={tasksLoading}
            today={today}
            onNavigate={navigate}
          />
        );

      // ── TEAM ──
      case "crew-status":
        return (
          <CrewWidget
            size={size}
            teamMembers={teamMembers}
            isLoading={teamLoading}
            onNavigate={navigate}
          />
        );
      case "crew-locations":
        return <CrewLocationsWidget size={size} />;

      // ── PIPELINE ──
      case "pipeline-funnel":
        return (
          <PipelineWidget
            size={size}
            projects={projects}
            isLoading={projectsLoading}
            onNavigate={navigate}
          />
        );
      case "pipeline-list":
        return <PipelineListWidget size={size} config={config} />;
      case "pipeline-value":
        return <PipelineValueWidget size={size} />;
      case "pipeline-velocity":
        return <PipelineVelocityWidget size={size} />;
      case "pipeline-sources":
        return <PipelineSourcesWidget size={size} />;

      // ── FINANCIAL ──
      case "revenue-chart":
        return <RevenueWidget size={size} />;
      case "invoice-list":
        return <InvoiceListWidget size={size} config={config} />;
      case "invoice-aging":
        return <InvoiceAgingWidget size={size} />;
      case "payments-recent":
        return <PaymentsRecentWidget size={size} />;
      case "expense-summary":
        return <ExpenseSummaryWidget size={size} config={config} />;

      // ── CLIENTS ──
      case "client-list":
        return <ClientListWidget size={size} config={config} />;
      case "client-revenue":
        return <ClientRevenueWidget size={size} config={config} />;
      case "client-activity":
        return <ClientActivityWidget size={size} />;
      case "client-attention":
        return <ClientAttentionWidget size={size} />;

      // ── ESTIMATES ──
      case "estimates-overview":
        return <EstimatesOverviewWidget size={size} config={config} />;
      case "estimates-funnel":
        return <EstimatesFunnelWidget size={size} />;

      // ── ACTIVITY ──
      case "activity-feed":
        return <ActivityWidget />;
      case "follow-ups-due":
        return <FollowUpsDueWidget size={size} />;
      case "site-visits":
        return <SiteVisitsWidget size={size} config={config} />;

      // ── ALERTS ──
      case "action-bar":
        return (
          <AlertsWidget
            activeProjectCount={activeProjectCount}
            weekEventCount={weekEvents.length}
            teamMemberCount={teamMembers.length}
            isDataLoading={isDataLoading}
            onNavigate={navigate}
          />
        );
      case "overdue-tasks":
        return <OverdueTasksWidget size={size} />;
      case "past-due-invoices":
        return <PastDueInvoicesWidget size={size} />;
      case "notifications":
        return <NotificationsWidget size={size} config={config} />;

      // ── PLACEHOLDER — not yet implemented ──
      default:
        return (
          <PlaceholderWidget
            typeId={typeId}
            label={
              typeId
                .split("-")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ")
            }
          />
        );
    }
  }

  // Build children map: instanceId → rendered content
  const childrenMap = useMemo(() => {
    const map: Record<string, ReactNode> = {};
    for (const instance of widgetInstances) {
      if (instance.visible) {
        map[instance.id] = renderWidgetContent(instance);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    widgetInstances,
    projects,
    projectsLoading,
    calendarLoading,
    tasksLoading,
    teamLoading,
    weekEvents,
    upcomingTasks,
    today,
    teamMembers,
    isDataLoading,
    activeProjectCount,
  ]);

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
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <SlidersHorizontal className="w-[14px] h-[14px]" />
            Customize
          </Button>
        </div>

        {/* Widget sidebar */}
        <WidgetSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Widget Grid */}
        <WidgetGrid isCustomizing={sidebarOpen}>
          {childrenMap}
        </WidgetGrid>
      </div>
    </MotionConfig>
  );
}
