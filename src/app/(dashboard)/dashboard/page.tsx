"use client";

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, Check } from "lucide-react";
import { motion, MotionConfig } from "framer-motion";
import {
  DndContext,
  pointerWithin,
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
  type CollisionDetection,
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
import { WIDGET_TYPE_REGISTRY, generateInstanceId } from "@/lib/types/dashboard-widgets";
import {
  SPRING_REORDER,
  DRAG_GRABBED_SCALE,
  DRAG_GRABBED_SHADOW,
} from "@/lib/utils/motion";

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
// Custom collision detection: prefer widget targets over placeholders
// ---------------------------------------------------------------------------
const customCollisionDetection: CollisionDetection = (args) => {
  // First try pointerWithin (more precise for mixed-size grids)
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    // Prioritize widget instances over placeholder cells
    const widgetCollision = pointerCollisions.find(
      (c) => typeof c.id === "string" && c.id.startsWith("wi_")
    );
    if (widgetCollision) return [widgetCollision];
    // Ghost widgets also count as valid targets
    const ghostCollision = pointerCollisions.find(
      (c) => typeof c.id === "string" && c.id.startsWith("ghost__")
    );
    if (ghostCollision) return [ghostCollision];
    return pointerCollisions;
  }
  // Fallback to closestCenter
  return closestCenter(args);
};

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // overId removed — was dead state causing unnecessary re-renders during drag
  const router = useRouter();

  // ── Tentative order state for real-time shifting ──
  const [tentativeOrder, setTentativeOrder] = useState<WidgetInstance[] | null>(null);
  const [ghostWidget, setGhostWidget] = useState<WidgetInstance | null>(null);
  const dragSourceRef = useRef<"grid" | "tray" | null>(null);
  const ghostWidgetIdRef = useRef<string | null>(null);
  const tentativeOrderRef = useRef<WidgetInstance[] | null>(null);
  const lastReorderOverIdRef = useRef<string | null>(null);
  const reorderCooldownRef = useRef(false);

  // Keep ref in sync with state for stable callbacks
  const updateTentativeOrder = useCallback((value: WidgetInstance[] | null | ((prev: WidgetInstance[] | null) => WidgetInstance[] | null)) => {
    if (typeof value === "function") {
      setTentativeOrder((prev) => {
        const next = value(prev);
        tentativeOrderRef.current = next;
        return next;
      });
    } else {
      tentativeOrderRef.current = value;
      setTentativeOrder(value);
    }
  }, []);

  const { currentUser } = useAuthStore();
  const firstName = currentUser?.firstName || "there";
  const widgetInstances = usePreferencesStore((s) => s.widgetInstances);
  const reorderWidgetInstances = usePreferencesStore((s) => s.reorderWidgetInstances);
  const addWidgetInstance = usePreferencesStore((s) => s.addWidgetInstance);
  const addWidgetInstanceAt = usePreferencesStore((s) => s.addWidgetInstanceAt);

  // The display order: tentative (during drag) or store (at rest)
  const displayOrder = tentativeOrder ?? widgetInstances;

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

  // ── DnD sensors ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ── DnD handlers ──
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = event.active.id as string;
      setActiveId(id);
      lastReorderOverIdRef.current = null;

      if (id.startsWith("tray__")) {
        // Tray → Grid: create ghost widget and inject into tentative order
        dragSourceRef.current = "tray";
        const typeId = event.active.data.current?.typeId as WidgetTypeId | undefined;
        if (typeId) {
          const entry = WIDGET_TYPE_REGISTRY[typeId];
          const ghost: WidgetInstance = {
            id: `ghost__${typeId}__${generateInstanceId()}`,
            typeId,
            size: entry?.defaultSize ?? "sm",
            visible: true,
            config: {},
          };
          setGhostWidget(ghost);
          ghostWidgetIdRef.current = ghost.id;
          // Append ghost at end of current order
          updateTentativeOrder([...widgetInstances, ghost]);
        } else {
          updateTentativeOrder([...widgetInstances]);
        }
      } else {
        // Grid reorder: snapshot current order
        dragSourceRef.current = "grid";
        updateTentativeOrder([...widgetInstances]);
      }
    },
    [widgetInstances, updateTentativeOrder]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const overIdRaw = event.over?.id as string | null;
      if (!overIdRaw) return;

      // Skip placeholder targets — they just highlight, don't reorder
      if (overIdRaw.startsWith("placeholder__")) return;

      // Guard 1: skip if we already reordered for this exact overId.
      if (overIdRaw === lastReorderOverIdRef.current) return;

      // Guard 2: cooldown — when the pointer sits on the border between
      // two widgets, snapping items to new positions causes collision
      // detection to alternate between targets (A→B→A→B). The single-ID
      // guard above can't catch this oscillation. A short cooldown after
      // each reorder breaks the loop while remaining imperceptible to the
      // user (~6-7 reorders/sec is plenty for smooth drag UX).
      if (reorderCooldownRef.current) return;

      lastReorderOverIdRef.current = overIdRaw;

      const activeIdStr = event.active.id as string;
      let didReorder = false;

      if (dragSourceRef.current === "grid") {
        // Grid reorder: splice active to over's position
        updateTentativeOrder((prev) => {
          if (!prev) return prev;
          const activeIdx = prev.findIndex((i) => i.id === activeIdStr);
          const overIdx = prev.findIndex((i) => i.id === overIdRaw);
          if (activeIdx === -1 || overIdx === -1 || activeIdx === overIdx) return prev;
          didReorder = true;
          const next = [...prev];
          const [moved] = next.splice(activeIdx, 1);
          next.splice(overIdx, 0, moved);
          return next;
        });
      } else if (dragSourceRef.current === "tray" && ghostWidgetIdRef.current) {
        // Tray-to-grid: move ghost to hovered widget's position
        const gId = ghostWidgetIdRef.current;
        updateTentativeOrder((prev) => {
          if (!prev) return prev;
          const ghostIdx = prev.findIndex((i) => i.id === gId);
          const overIdx = prev.findIndex((i) => i.id === overIdRaw);
          if (ghostIdx === -1 || overIdx === -1 || ghostIdx === overIdx) return prev;
          didReorder = true;
          const next = [...prev];
          const [moved] = next.splice(ghostIdx, 1);
          next.splice(overIdx, 0, moved);
          return next;
        });
      }

      // Start cooldown only if we actually reordered
      if (didReorder) {
        reorderCooldownRef.current = true;
        setTimeout(() => { reorderCooldownRef.current = false; }, 150);
      }
    },
    [updateTentativeOrder] // Stable — uses refs and functional updaters only
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      const currentOrder = tentativeOrderRef.current;
      const gId = ghostWidgetIdRef.current;

      if (dragSourceRef.current === "grid" && currentOrder) {
        // Commit tentative order to store — filter out any ghost IDs
        const newOrder = currentOrder
          .filter((i) => !i.id.startsWith("ghost__"))
          .map((i) => i.id);
        reorderWidgetInstances(newOrder);
      } else if (dragSourceRef.current === "tray" && gId && currentOrder) {
        const typeId = active.data.current?.typeId as WidgetTypeId | undefined;
        const overIdStr = over?.id as string | undefined;
        // Only add if dropped on a valid grid target (widget or placeholder), not back on tray / nowhere
        const isValidDrop = overIdStr && (overIdStr.startsWith("wi_") || overIdStr.startsWith("placeholder__") || overIdStr.startsWith("ghost__"));
        if (typeId && isValidDrop) {
          // Find ghost's position in tentative order to know where to insert
          const ghostIdx = currentOrder.findIndex((i) => i.id === gId);
          // Get the widget immediately after the ghost — this is the "before" reference for the store API
          const insertBeforeRef = currentOrder[ghostIdx + 1];
          if (insertBeforeRef && insertBeforeRef.id.startsWith("wi_")) {
            addWidgetInstanceAt(typeId, insertBeforeRef.id);
          } else if (ghostIdx === 0 && currentOrder.length > 1) {
            // Ghost is at the very beginning — insert before first real widget
            const firstReal = currentOrder.find((i) => i.id.startsWith("wi_"));
            if (firstReal) {
              addWidgetInstanceAt(typeId, firstReal.id);
            } else {
              addWidgetInstance(typeId);
            }
          } else {
            addWidgetInstance(typeId);
          }
        }
        // If not a valid drop target, widget is NOT added (drag cancelled back to tray)
      }

      // Clear all drag state
      updateTentativeOrder(null);
      setGhostWidget(null);
      ghostWidgetIdRef.current = null;
      dragSourceRef.current = null;
      lastReorderOverIdRef.current = null;
      reorderCooldownRef.current = false;
    },
    [reorderWidgetInstances, addWidgetInstance, addWidgetInstanceAt, updateTentativeOrder]
  );

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveId(null);
    updateTentativeOrder(null);
    setGhostWidget(null);
    ghostWidgetIdRef.current = null;
    dragSourceRef.current = null;
    lastReorderOverIdRef.current = null;
    reorderCooldownRef.current = false;
  }, [updateTentativeOrder]);

  // ── Toggle customize mode ──
  const handleCustomizeToggle = () => {
    if (isCustomizing) {
      setIsCustomizing(false);
      setTrayOpen(false);
    } else {
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
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: DRAG_GRABBED_SCALE, opacity: 0.95 }}
          transition={SPRING_REORDER}
          className="w-[160px] h-[120px] rounded-lg ring-2 ring-ops-accent bg-[rgba(10,10,10,0.95)] backdrop-blur-xl border border-ops-accent/30 p-[10px] flex flex-col items-center justify-center pointer-events-none"
          style={{ boxShadow: DRAG_GRABBED_SHADOW }}
        >
          <span className="font-mohave text-[13px] text-text-primary">{entry.label}</span>
          <span className="font-mono text-[9px] text-text-disabled mt-[2px]">{entry.description}</span>
        </motion.div>
      );
    }

    // Grid drag — show actual widget content with "grabbed" feedback
    return (
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: DRAG_GRABBED_SCALE, opacity: 0.95 }}
        transition={SPRING_REORDER}
        className="rounded-md ring-2 ring-ops-accent pointer-events-none"
        style={{ boxShadow: DRAG_GRABBED_SHADOW }}
      >
        {childrenMap[activeId] ?? null}
      </motion.div>
    );
  }, [activeId, childrenMap]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className={cn(
          "space-y-3 max-w-[1400px] transition-opacity duration-500",
          mounted ? "opacity-100" : "opacity-0",
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
            collisionDetection={customCollisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <WidgetGrid
              isCustomizing
              activeId={activeId}
              orderedInstances={displayOrder}
              ghostId={ghostWidget?.id ?? null}
            >
              {childrenMap}
            </WidgetGrid>

            <WidgetTray open={trayOpen} onClose={() => setTrayOpen(false)} />

            <DragOverlay dropAnimation={null}>
              {overlayContent}
            </DragOverlay>
          </DndContext>
        ) : (
          <WidgetGrid orderedInstances={displayOrder}>{childrenMap}</WidgetGrid>
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
