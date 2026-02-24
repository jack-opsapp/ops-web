"use client";

import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, Check } from "lucide-react";
import { MotionConfig } from "framer-motion";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type DragCancelEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
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
import { WIDGET_TYPE_REGISTRY } from "@/lib/types/dashboard-widgets";

// Widget components
import { WidgetGrid } from "@/components/dashboard/widget-grid";
import { WidgetTray } from "@/components/dashboard/widget-tray";
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
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const router = useRouter();

  const { currentUser } = useAuthStore();
  const firstName = currentUser?.firstName || "there";
  const widgetInstances = usePreferencesStore((s) => s.widgetInstances);
  const reorderWidgetInstances = usePreferencesStore((s) => s.reorderWidgetInstances);
  const addWidgetInstance = usePreferencesStore((s) => s.addWidgetInstance);
  const addWidgetInstanceAt = usePreferencesStore((s) => s.addWidgetInstanceAt);

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

  // ── Escape key handling ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (trayOpen) {
          setTrayOpen(false);
        } else if (isCustomizing) {
          setIsCustomizing(false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [trayOpen, isCustomizing]);

  const navigate = (path: string) => router.push(path);

  // ── DnD sensors — slightly higher distance for tray cards to avoid conflicting with horizontal scroll ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ── DnD handlers ──
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverId(event.over?.id as string | null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setOverId(null);

      if (!over) return;

      const activeIdStr = active.id as string;

      // ── Tray → Grid drag ──
      if (activeIdStr.startsWith("tray__")) {
        const typeId = active.data.current?.typeId as WidgetTypeId | undefined;
        if (!typeId) return;

        const overIdStr = over.id as string;
        // If dropping over an existing widget instance, insert before it
        if (overIdStr.startsWith("wi_")) {
          addWidgetInstanceAt(typeId, overIdStr);
        } else {
          // Dropped somewhere else — append
          addWidgetInstance(typeId);
        }
        return;
      }

      // ── Grid reorder drag ──
      if (active.id === over.id) return;

      const allIds = widgetInstances.map((i: WidgetInstance) => i.id);
      const oldIndex = allIds.indexOf(active.id as string);
      const newIndex = allIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = [...allIds];
      newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, active.id as string);
      reorderWidgetInstances(newOrder);
    },
    [widgetInstances, reorderWidgetInstances, addWidgetInstance, addWidgetInstanceAt]
  );

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveId(null);
    setOverId(null);
  }, []);

  // ── Toggle customize mode ──
  const handleCustomizeToggle = () => {
    if (isCustomizing) {
      // "Done" — exit edit mode
      setIsCustomizing(false);
      setTrayOpen(false);
    } else {
      // Enter edit mode + open tray
      setIsCustomizing(true);
      setTrayOpen(true);
    }
  };

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

  // ── Build overlay content for DragOverlay ──
  const overlayContent = useMemo(() => {
    if (!activeId) return null;

    // Tray drag — show compact preview
    if (activeId.startsWith("tray__")) {
      const typeId = activeId.replace("tray__", "") as WidgetTypeId;
      const entry = WIDGET_TYPE_REGISTRY[typeId];
      if (!entry) return null;
      return (
        <div className="w-[160px] h-[120px] rounded-lg ring-2 ring-ops-accent bg-[rgba(10,10,10,0.95)] backdrop-blur-xl border border-ops-accent/30 p-[10px] flex flex-col items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-none">
          <span className="font-mohave text-[13px] text-text-primary">{entry.label}</span>
          <span className="font-mono text-[9px] text-text-disabled mt-[2px]">{entry.description}</span>
        </div>
      );
    }

    // Grid drag — show actual widget content
    return (
      <div
        className="rounded-md ring-2 ring-ops-accent shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-none"
        style={{ opacity: 0.95 }}
      >
        {childrenMap[activeId] ?? null}
      </div>
    );
  }, [activeId, childrenMap]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className={cn(
          "space-y-3 max-w-[1400px] transition-opacity duration-500",
          mounted ? "opacity-100" : "opacity-0",
          // Add bottom padding when tray is open so grid content isn't hidden behind it
          trayOpen && "pb-[340px]"
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
            variant={isCustomizing ? "default" : "ghost"}
            size="sm"
            className={cn(
              "gap-[6px] shrink-0",
              isCustomizing && "bg-ops-accent hover:bg-ops-accent/90 text-white"
            )}
            onClick={handleCustomizeToggle}
          >
            {isCustomizing ? (
              <>
                <Check className="w-[14px] h-[14px]" />
                Done
              </>
            ) : (
              <>
                <SlidersHorizontal className="w-[14px] h-[14px]" />
                Customize
              </>
            )}
          </Button>
        </div>

        {/* When customizing, DndContext wraps both grid and tray */}
        {isCustomizing ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <WidgetGrid isCustomizing activeId={activeId} overId={overId}>
              {childrenMap}
            </WidgetGrid>

            <WidgetTray open={trayOpen} onClose={() => setTrayOpen(false)} />

            <DragOverlay dropAnimation={null}>
              {overlayContent}
            </DragOverlay>
          </DndContext>
        ) : (
          <WidgetGrid>{childrenMap}</WidgetGrid>
        )}

        {/* When edit mode is active but tray is closed, show a small "Open Tray" button */}
        {isCustomizing && !trayOpen && (
          <button
            onClick={() => setTrayOpen(true)}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-[rgba(10,10,10,0.9)] backdrop-blur-xl border border-border text-text-secondary font-mohave text-body-sm hover:text-text-primary hover:border-border-medium transition-all duration-200 shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
          >
            Open Widget Tray
          </button>
        )}
      </div>
    </MotionConfig>
  );
}
