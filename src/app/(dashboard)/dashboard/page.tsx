"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  FolderKanban,
  CalendarDays,
  Users,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Plus,
  FileText,
  UserPlus,
  CalendarPlus,
  ChevronRight,
  MapPin,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ops/user-avatar";
import type { UserRole as AvatarUserRole } from "@/components/ops/user-avatar";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useProjects,
  useTasks,
  useClients,
  useTeamMembers,
  useCalendarEventsForRange,
} from "@/lib/hooks";
import {
  type Project,
  type CalendarEvent,
  type User,
  ProjectStatus,
  TaskStatus,
  UserRole,
  isActiveProjectStatus,
  getUserFullName,
  getTaskDisplayTitle,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";
import {
  startOfWeek,
  endOfWeek,
  format,
  isSameDay,
  isAfter,
} from "@/lib/utils/date";

// ---------------------------------------------------------------------------
// Animated counter hook
// ---------------------------------------------------------------------------
function useAnimatedValue(target: number, duration = 1200) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let start: number | null = null;
    let raf: number;

    const step = (ts: number) => {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(Math.round(eased * target));
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

// ---------------------------------------------------------------------------
// Map model UserRole to UserAvatar component role type
// ---------------------------------------------------------------------------
function toAvatarRole(role: UserRole): AvatarUserRole {
  switch (role) {
    case UserRole.Admin:
      return "admin";
    case UserRole.OfficeCrew:
      return "manager";
    case UserRole.FieldCrew:
    default:
      return "field-crew";
  }
}

// ---------------------------------------------------------------------------
// Stat Card with animated value
// ---------------------------------------------------------------------------
interface StatCardProps {
  label: string;
  value: number;
  displayPrefix?: string;
  displaySuffix?: string;
  subValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  delay?: number;
  isLoading?: boolean;
}

function StatCard({
  label,
  value,
  displayPrefix = "",
  displaySuffix = "",
  subValue,
  icon: Icon,
  trend,
  trendValue,
  isLoading,
}: StatCardProps) {
  const animatedVal = useAnimatedValue(value);

  return (
    <Card className="p-2">
      <div className="flex items-start justify-between">
        <div>
          <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
            {label}
          </span>
          {isLoading ? (
            <div className="flex items-center gap-1 mt-[4px]">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-body-sm text-text-disabled uppercase">Loading...</span>
            </div>
          ) : (
            <>
              <p className="font-mono text-data-lg text-text-primary mt-[4px]">
                {displayPrefix}
                {animatedVal.toLocaleString()}
                {displaySuffix}
              </p>
              {subValue && (
                <p className="font-mono text-[11px] text-text-tertiary mt-[2px]">{subValue}</p>
              )}
            </>
          )}
        </div>
        <div className="w-[40px] h-[40px] rounded-lg bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
          <Icon className="w-[20px] h-[20px] text-text-secondary" />
        </div>
      </div>
      {trend && trendValue && !isLoading && (
        <div className="mt-1 flex items-center gap-[4px]">
          <TrendingUp
            className={cn(
              "w-[14px] h-[14px]",
              trend === "up" && "text-status-success",
              trend === "down" && "text-ops-error rotate-180",
              trend === "neutral" && "text-text-tertiary"
            )}
          />
          <span
            className={cn(
              "font-mono text-[11px]",
              trend === "up" && "text-status-success",
              trend === "down" && "text-ops-error",
              trend === "neutral" && "text-text-tertiary"
            )}
          >
            {trendValue}
          </span>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Mini Calendar Widget - wired to useCalendarEventsForRange
// ---------------------------------------------------------------------------
function MiniCalendar({ events, isLoading }: { events: CalendarEvent[]; isLoading: boolean }) {
  const today = useMemo(() => new Date(), []);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  // Generate days of current week
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  // Determine which days have events
  const eventDaySet = useMemo(() => {
    const daySet = new Set<string>();
    for (const ev of events) {
      if (ev.startDate) {
        const d = new Date(ev.startDate);
        daySet.add(d.toDateString());
      }
    }
    return daySet;
  }, [events]);

  // Events for today
  const todayEvents = useMemo(() => {
    return events
      .filter((ev) => {
        if (!ev.startDate) return false;
        const d = new Date(ev.startDate);
        return isSameDay(d, today);
      })
      .sort((a, b) => {
        const aDate = a.startDate ? new Date(a.startDate).getTime() : 0;
        const bDate = b.startDate ? new Date(b.startDate).getTime() : 0;
        return aDate - bDate;
      })
      .slice(0, 6);
  }, [events, today]);

  return (
    <Card className="p-2">
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">
            {monthNames[today.getMonth()]} {today.getFullYear()}
          </CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">Today</span>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        {/* Week strip */}
        <div className="grid grid-cols-7 gap-[2px] mb-1.5">
          {weekDays.map((d, i) => {
            const isToday = d.toDateString() === today.toDateString();
            const hasEvent = eventDaySet.has(d.toDateString());
            return (
              <div
                key={i}
                className={cn(
                  "flex flex-col items-center py-[6px] rounded transition-colors cursor-pointer",
                  isToday
                    ? "bg-[rgba(255,255,255,0.1)] text-text-primary"
                    : "hover:bg-[rgba(255,255,255,0.04)]"
                )}
              >
                <span
                  className={cn(
                    "font-kosugi text-[9px] uppercase",
                    isToday ? "text-text-secondary" : "text-text-disabled"
                  )}
                >
                  {dayNames[i]}
                </span>
                <span
                  className={cn(
                    "font-mono text-body-sm font-medium",
                    isToday ? "text-text-primary" : "text-text-secondary"
                  )}
                >
                  {d.getDate()}
                </span>
                {hasEvent && (
                  <span className={cn(
                    "w-[4px] h-[4px] rounded-full mt-[2px]",
                    isToday ? "bg-text-primary" : "bg-[#5C6070]"
                  )} />
                )}
              </div>
            );
          })}
        </div>

        {/* Today's events */}
        <div className="border-t border-border pt-1.5 space-y-[4px]">
          <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
            Today&apos;s Schedule
          </span>
          {isLoading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled ml-1">Loading events...</span>
            </div>
          ) : todayEvents.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled py-1">
              No events scheduled today
            </p>
          ) : (
            todayEvents.map((ev, i) => {
              const eventTime = ev.startDate
                ? format(new Date(ev.startDate), "h:mm a")
                : "";
              return (
                <div
                  key={ev.id || i}
                  className="flex items-center gap-1 px-[6px] py-[5px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
                >
                  <span className="font-mono text-[10px] text-text-disabled w-[60px] shrink-0">
                    {eventTime}
                  </span>
                  <div
                    className="w-[3px] h-[16px] rounded-full shrink-0"
                    style={{ backgroundColor: ev.color || "#5C6070" }}
                  />
                  <span className="font-mohave text-body-sm text-text-secondary truncate">
                    {ev.title}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Crew Status Widget - wired to useTeamMembers
// ---------------------------------------------------------------------------
function CrewStatus({
  teamMembers,
  isLoading,
}: {
  teamMembers: User[];
  isLoading: boolean;
}) {
  const activeCount = teamMembers.filter((m) => m.isActive).length;

  return (
    <Card className="p-2">
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Crew Status</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {activeCount} active
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">Loading crew...</span>
          </div>
        ) : teamMembers.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            No team members found
          </p>
        ) : (
          <div className="space-y-[6px]">
            {teamMembers.map((member) => {
              const fullName = getUserFullName(member);
              const isOnline = member.isActive ?? false;
              const statusLabel = isOnline ? "Active" : "Off Duty";

              return (
                <div
                  key={member.id}
                  className="flex items-center gap-1.5 px-[6px] py-1 rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
                >
                  <UserAvatar
                    name={fullName}
                    role={toAvatarRole(member.role)}
                    online={isOnline}
                    color={member.userColor ?? undefined}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-mohave text-body-sm text-text-primary truncate">
                        {fullName}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-[9px] px-[5px] py-[1px] rounded-sm uppercase tracking-wider",
                          isOnline
                            ? "bg-[rgba(107,143,113,0.15)] text-[#6B8F71]"
                            : "bg-[rgba(255,255,255,0.04)] text-text-disabled"
                        )}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <p className="font-kosugi text-[10px] text-text-tertiary truncate">
                      {member.role}
                    </p>
                  </div>
                  {member.locationName && (
                    <div className="flex items-center gap-[3px] shrink-0">
                      <MapPin className="w-[10px] h-[10px] text-text-disabled" />
                      <span className="font-mono text-[9px] text-text-disabled">
                        {member.locationName}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Mini View - wired to useProjects
// ---------------------------------------------------------------------------
function PipelineMiniView({
  projects,
  isLoading,
}: {
  projects: Project[];
  isLoading: boolean;
}) {
  const stages = useMemo(() => {
    const activeProjects = projects.filter(
      (p) => !p.deletedAt && isActiveProjectStatus(p.status)
    );
    const total = activeProjects.length;

    const pipelineStatuses = [
      ProjectStatus.RFQ,
      ProjectStatus.Estimated,
      ProjectStatus.Accepted,
      ProjectStatus.InProgress,
    ];

    return pipelineStatuses.map((status) => {
      const count = activeProjects.filter((p) => p.status === status).length;
      const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
      return {
        label: status === ProjectStatus.InProgress ? "In Progress" : status,
        count,
        color: PROJECT_STATUS_COLORS[status],
        percentage,
      };
    });
  }, [projects]);

  const totalProjects = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <Card className="p-2">
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Pipeline</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${totalProjects} active`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">Loading pipeline...</span>
          </div>
        ) : (
          <>
            {/* Stacked bar */}
            <div className="flex h-[8px] rounded-full overflow-hidden mb-2">
              {stages.map((stage, i) => (
                <div
                  key={i}
                  className="h-full transition-all duration-500"
                  style={{
                    width: totalProjects > 0 ? `${stage.percentage}%` : "25%",
                    backgroundColor: stage.color,
                    marginRight: i < stages.length - 1 ? "1px" : "0",
                    opacity: totalProjects > 0 ? 1 : 0.2,
                  }}
                />
              ))}
            </div>

            {/* Stage breakdown */}
            <div className="space-y-[6px]">
              {stages.map((stage, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span
                      className="w-[8px] h-[8px] rounded-sm shrink-0"
                      style={{ backgroundColor: stage.color }}
                    />
                    <span className="font-mohave text-body-sm text-text-secondary">
                      {stage.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-body-sm text-text-primary font-medium">
                      {stage.count}
                    </span>
                    <span className="font-mono text-[10px] text-text-disabled">
                      ({stage.percentage}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Revenue Chart (mock - no financial data API in Bubble)
// ---------------------------------------------------------------------------
function RevenueChart() {
  const months = [
    { label: "Sep", value: 0, target: 0 },
    { label: "Oct", value: 0, target: 0 },
    { label: "Nov", value: 0, target: 0 },
    { label: "Dec", value: 0, target: 0 },
    { label: "Jan", value: 0, target: 0 },
    { label: "Feb", value: 0, target: 0, isCurrent: true },
  ];

  const maxValue = 1;

  return (
    <Card className="p-2">
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Revenue</CardTitle>
          <span className="font-kosugi text-[9px] text-text-disabled">Coming Soon</span>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        <div className="flex items-end gap-[6px] h-[120px]">
          {months.map((month, i) => {
            const barHeight = (month.value / maxValue) * 100;

            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-[4px] h-full">
                <div className="flex-1 w-full flex items-end justify-center relative">
                  <div
                    className="w-[70%] rounded-t-sm transition-all duration-700 bg-[rgba(255,255,255,0.06)]"
                    style={{
                      height: barHeight > 0 ? `${barHeight}%` : "2px",
                      animationDelay: `${i * 100}ms`,
                    }}
                  />
                </div>
                <span className="font-mono text-[9px] text-text-disabled">--</span>
                <span
                  className={cn(
                    "font-kosugi text-[9px]",
                    month.isCurrent ? "text-text-secondary font-medium" : "text-text-disabled"
                  )}
                >
                  {month.label}
                </span>
              </div>
            );
          })}
        </div>
        {/* Summary line */}
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border">
          <div>
            <span className="font-kosugi text-[10px] text-text-tertiary">MTD Revenue</span>
            <p className="font-mono text-body text-text-disabled">--</p>
          </div>
          <div className="text-right">
            <span className="font-kosugi text-[10px] text-text-tertiary">Monthly Target</span>
            <p className="font-mono text-body text-text-disabled">--</p>
          </div>
          <div className="text-right">
            <span className="font-kosugi text-[10px] text-text-tertiary">Progress</span>
            <p className="font-mono text-body text-text-disabled">--</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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
  const router = useRouter();

  const { currentUser } = useAuthStore();
  const firstName = currentUser?.firstName || "there";

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
      .filter((t) => {
        if (t.deletedAt) return false;
        if (t.status === TaskStatus.Completed || t.status === TaskStatus.Cancelled) return false;
        if (t.calendarEvent?.startDate) {
          const eventDate = new Date(t.calendarEvent.startDate);
          return isSameDay(eventDate, now) || isAfter(eventDate, now);
        }
        return t.status === TaskStatus.Booked || t.status === TaskStatus.InProgress;
      })
      .sort((a, b) => {
        const aDate = a.calendarEvent?.startDate
          ? new Date(a.calendarEvent.startDate).getTime()
          : Infinity;
        const bDate = b.calendarEvent?.startDate
          ? new Date(b.calendarEvent.startDate).getTime()
          : Infinity;
        return aDate - bDate;
      })
      .slice(0, 5);
  }, [tasks]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDataLoading = projectsLoading || tasksLoading || clientsLoading || teamLoading || calendarLoading;

  return (
    <div
      className={cn(
        "space-y-3 max-w-[1400px] transition-opacity duration-500",
        mounted ? "opacity-100" : "opacity-0"
      )}
    >
      {/* Header with greeting - typewriter animation */}
      <div className="animate-fade-in">
        <p className="font-mohave text-body-lg text-text-secondary tracking-wide">
          <span className={mounted ? "typewriter" : ""} onAnimationEnd={(e) => {
            (e.target as HTMLElement).classList.add("typewriter-done");
          }}>
            {getGreeting()}, {firstName}
          </span>
        </p>
        <p className="font-kosugi text-caption-sm text-text-tertiary mt-0.5 uppercase">
          Here&apos;s your operational overview for today.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <StatCard
          label="Active Projects"
          value={activeProjectCount}
          subValue={`of ${projects.filter((p) => !p.deletedAt).length} total`}
          icon={FolderKanban}
          isLoading={projectsLoading}
        />
        <StatCard
          label="This Week"
          value={weekEventCount}
          subValue="events scheduled"
          icon={CalendarDays}
          isLoading={calendarLoading}
        />
        <StatCard
          label="Total Clients"
          value={totalClientCount}
          subValue={`across all projects`}
          icon={Users}
          isLoading={clientsLoading}
        />
        <StatCard
          label="Revenue MTD"
          value={0}
          displayPrefix="$"
          subValue="Coming soon"
          icon={DollarSign}
          isLoading={false}
        />
      </div>

      {/* Quick Actions - minimal horizontal ghost buttons */}
      <div>
        <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest mb-1 block">
          Quick Actions
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="ghost" className="gap-1.5" onClick={() => router.push("/projects")}>
            <Plus className="w-[16px] h-[16px]" />
            New Project
          </Button>
          <Button variant="ghost" className="gap-1.5" onClick={() => router.push("/clients")}>
            <UserPlus className="w-[16px] h-[16px]" />
            New Client
          </Button>
          <Button variant="ghost" className="gap-1.5" onClick={() => router.push("/invoices")}>
            <FileText className="w-[16px] h-[16px]" />
            Create Invoice
          </Button>
          <Button variant="ghost" className="gap-1.5" onClick={() => router.push("/calendar")}>
            <CalendarPlus className="w-[16px] h-[16px]" />
            Schedule Task
          </Button>
        </div>
      </div>

      {/* Main content: 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {/* Column 1: Calendar + Crew */}
        <div className="space-y-2">
          <MiniCalendar events={weekEvents} isLoading={calendarLoading} />
          <CrewStatus teamMembers={teamMembers} isLoading={teamLoading} />
        </div>

        {/* Column 2: Upcoming Tasks + Recent Activity */}
        <div className="space-y-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-card-subtitle">Upcoming Tasks</CardTitle>
                <span className="font-mono text-[11px] text-text-tertiary">Today + 7 days</span>
              </div>
            </CardHeader>
            <CardContent>
              {tasksLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
                  <span className="font-mono text-[11px] text-text-disabled ml-1">
                    Loading tasks...
                  </span>
                </div>
              ) : upcomingTasks.length === 0 ? (
                <p className="font-mohave text-body-sm text-text-disabled py-2">
                  No upcoming tasks
                </p>
              ) : (
                <div className="space-y-[4px]">
                  {upcomingTasks.map((task) => {
                    const isInProgress = task.status === TaskStatus.InProgress;
                    const displayTitle = getTaskDisplayTitle(task, task.taskType);
                    const eventDate = task.calendarEvent?.startDate
                      ? new Date(task.calendarEvent.startDate)
                      : null;
                    const timeDisplay = eventDate
                      ? isSameDay(eventDate, today)
                        ? `Today ${format(eventDate, "h:mm a")}`
                        : format(eventDate, "EEE h:mm a")
                      : "Unscheduled";

                    return (
                      <div
                        key={task.id}
                        className="flex items-center gap-1 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group"
                      >
                        {isInProgress ? (
                          <Clock className="w-[16px] h-[16px] text-text-secondary shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-[16px] h-[16px] text-text-disabled shrink-0" />
                        )}
                        <div
                          className="w-[3px] h-[16px] rounded-full shrink-0"
                          style={{ backgroundColor: task.taskColor || "#5C6070" }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-mohave text-body-sm text-text-primary truncate">
                            {displayTitle}
                          </p>
                        </div>
                        <span className="font-mono text-[11px] text-text-tertiary shrink-0">
                          {timeDisplay}
                        </span>
                        <ChevronRight className="w-[12px] h-[12px] text-text-disabled opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-card-subtitle">Recent Activity</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-[4px]">
                {[
                  {
                    text: "Activity feed coming soon",
                    time: "--",
                    type: "update",
                  },
                ].map((activity, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-1 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
                  >
                    <div
                      className={cn(
                        "w-[8px] h-[8px] rounded-full shrink-0 mt-[5px]",
                        "bg-[rgba(255,255,255,0.15)]"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-mohave text-body-sm text-text-secondary">
                        {activity.text}
                      </p>
                      <span className="font-mono text-[10px] text-text-disabled">
                        {activity.time}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Column 3: Pipeline + Revenue */}
        <div className="space-y-2">
          <PipelineMiniView projects={projects} isLoading={projectsLoading} />
          <RevenueChart />
        </div>
      </div>

      {/* Alerts footer - simplified */}
      <Card variant="accent">
        <CardContent className="p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-[20px] h-[20px] text-text-secondary shrink-0" />
              <div>
                <p className="font-mohave text-body text-text-primary">System alerts</p>
                <p className="font-kosugi text-[11px] text-text-tertiary">
                  {isDataLoading
                    ? "Loading your data..."
                    : `${activeProjectCount} active projects, ${weekEventCount} events this week, ${teamMembers.length} team members`}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 gap-[4px]"
              onClick={() => router.push("/projects")}
            >
              View All
              <ArrowRight className="w-[14px] h-[14px]" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
