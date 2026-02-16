"use client";

import { useState, useEffect } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LiveIndicator } from "@/components/ops/live-indicator";
import { UserAvatar } from "@/components/ops/user-avatar";

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
}: StatCardProps) {
  const animatedVal = useAnimatedValue(value);

  return (
    <Card withGrid className="p-2">
      <div className="flex items-start justify-between">
        <div>
          <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
            {label}
          </span>
          <p className="font-mono text-data-lg text-text-primary mt-[4px]">
            {displayPrefix}
            {animatedVal.toLocaleString()}
            {displaySuffix}
          </p>
          {subValue && (
            <p className="font-mono text-[11px] text-text-tertiary mt-[2px]">{subValue}</p>
          )}
        </div>
        <div className="w-[40px] h-[40px] rounded-lg bg-ops-accent-muted flex items-center justify-center">
          <Icon className="w-[20px] h-[20px] text-ops-accent" />
        </div>
      </div>
      {trend && trendValue && (
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
// Quick Action Card
// ---------------------------------------------------------------------------
interface QuickActionProps {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  glowColor: string;
  onClick?: () => void;
}

function QuickActionCard({ label, icon: Icon, color, glowColor, onClick }: QuickActionProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 p-2 rounded-lg",
        "bg-background-card border border-border",
        "cursor-pointer transition-all duration-200",
        "hover:border-opacity-60 hover:scale-[1.02] active:scale-[0.98]",
        "group"
      )}
      style={{
        ["--action-color" as string]: color,
        ["--action-glow" as string]: glowColor,
      }}
    >
      <div
        className="w-[44px] h-[44px] rounded-lg flex items-center justify-center transition-shadow duration-200 group-hover:shadow-[0_0_16px_var(--action-glow)]"
        style={{ backgroundColor: `${color}15` }}
      >
        <Icon className="w-[22px] h-[22px]" style={{ color }} />
      </div>
      <span className="font-mohave text-body-sm text-text-secondary group-hover:text-text-primary transition-colors">
        {label}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Mini Calendar Widget
// ---------------------------------------------------------------------------
function MiniCalendar() {
  const today = new Date();
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
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  // Events for today
  const todayEvents = [
    { time: "9:00 AM", title: "Kitchen Demo - Smith", type: "task" as const },
    { time: "11:30 AM", title: "Client Call - Johnson", type: "call" as const },
    { time: "2:00 PM", title: "Material Pickup", type: "task" as const },
    { time: "4:30 PM", title: "Estimate Review", type: "meeting" as const },
  ];

  // Days with events (for dots)
  const eventDays = [today.getDate(), today.getDate() + 1, today.getDate() + 3];

  return (
    <Card className="p-2">
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">
            {monthNames[today.getMonth()]} {today.getFullYear()}
          </CardTitle>
          <span className="font-mono text-[11px] text-ops-accent">Today</span>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        {/* Week strip */}
        <div className="grid grid-cols-7 gap-[2px] mb-1.5">
          {weekDays.map((d, i) => {
            const isToday = d.toDateString() === today.toDateString();
            const hasEvent = eventDays.includes(d.getDate());
            return (
              <div
                key={i}
                className={cn(
                  "flex flex-col items-center py-[6px] rounded transition-colors cursor-pointer",
                  isToday
                    ? "bg-ops-accent text-white shadow-glow-accent"
                    : "hover:bg-background-elevated"
                )}
              >
                <span
                  className={cn(
                    "font-kosugi text-[9px] uppercase",
                    isToday ? "text-white/70" : "text-text-disabled"
                  )}
                >
                  {dayNames[i]}
                </span>
                <span
                  className={cn(
                    "font-mono text-body-sm font-medium",
                    isToday ? "text-white" : "text-text-secondary"
                  )}
                >
                  {d.getDate()}
                </span>
                {hasEvent && !isToday && (
                  <span className="w-[4px] h-[4px] rounded-full bg-ops-amber mt-[2px]" />
                )}
                {hasEvent && isToday && (
                  <span className="w-[4px] h-[4px] rounded-full bg-white mt-[2px]" />
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
          {todayEvents.map((ev, i) => (
            <div
              key={i}
              className="flex items-center gap-1 px-[6px] py-[5px] rounded hover:bg-background-elevated cursor-pointer transition-colors"
            >
              <span className="font-mono text-[10px] text-text-disabled w-[60px] shrink-0">
                {ev.time}
              </span>
              <div
                className={cn(
                  "w-[3px] h-[16px] rounded-full shrink-0",
                  ev.type === "task" && "bg-ops-accent",
                  ev.type === "call" && "bg-ops-amber",
                  ev.type === "meeting" && "bg-status-estimated"
                )}
              />
              <span className="font-mohave text-body-sm text-text-secondary truncate">
                {ev.title}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Crew Status Widget
// ---------------------------------------------------------------------------
function CrewStatus() {
  const crew = [
    {
      name: "Mike Davidson",
      role: "field-crew" as const,
      status: "On Site",
      task: "Kitchen Demo - Smith",
      location: "123 Oak St",
      online: true,
    },
    {
      name: "Sarah Lawson",
      role: "field-crew" as const,
      status: "Driving",
      task: "Material Pickup",
      location: "En route",
      online: true,
    },
    {
      name: "Tom Barrett",
      role: "field-crew" as const,
      status: "Available",
      task: null,
      location: "Office",
      online: true,
    },
    {
      name: "Chris Park",
      role: "field-crew" as const,
      status: "Off Duty",
      task: null,
      location: null,
      online: false,
    },
  ];

  return (
    <Card className="p-2">
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Crew Status</CardTitle>
          <div className="flex items-center gap-[6px]">
            <span className="font-mono text-[11px] text-status-success">
              {crew.filter((c) => c.online).length} active
            </span>
            <LiveIndicator size="sm" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        <div className="space-y-[6px]">
          {crew.map((member, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-[6px] py-1 rounded hover:bg-background-elevated cursor-pointer transition-colors"
            >
              <UserAvatar
                name={member.name}
                role={member.role}
                online={member.online}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="font-mohave text-body-sm text-text-primary truncate">
                    {member.name}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[9px] px-[5px] py-[1px] rounded-sm uppercase tracking-wider",
                      member.status === "On Site" &&
                        "bg-status-success/15 text-status-success",
                      member.status === "Driving" &&
                        "bg-ops-amber-muted text-ops-amber",
                      member.status === "Available" &&
                        "bg-ops-accent-muted text-ops-accent",
                      member.status === "Off Duty" &&
                        "bg-background-elevated text-text-disabled"
                    )}
                  >
                    {member.status}
                  </span>
                </div>
                {member.task && (
                  <p className="font-kosugi text-[10px] text-text-tertiary truncate">
                    {member.task}
                  </p>
                )}
              </div>
              {member.location && (
                <div className="flex items-center gap-[3px] shrink-0">
                  <MapPin className="w-[10px] h-[10px] text-text-disabled" />
                  <span className="font-mono text-[9px] text-text-disabled">{member.location}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Mini View
// ---------------------------------------------------------------------------
function PipelineMiniView() {
  const stages = [
    { label: "RFQ", count: 5, color: "#6B7280", percentage: 22 },
    { label: "Estimated", count: 8, color: "#D97706", percentage: 35 },
    { label: "Accepted", count: 4, color: "#9DB582", percentage: 17 },
    { label: "In Progress", count: 6, color: "#8195B5", percentage: 26 },
  ];

  const totalProjects = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <Card withGrid className="p-2">
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Pipeline</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {totalProjects} active
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        {/* Stacked bar */}
        <div className="flex h-[8px] rounded-full overflow-hidden mb-2">
          {stages.map((stage, i) => (
            <div
              key={i}
              className="h-full transition-all duration-500"
              style={{
                width: `${stage.percentage}%`,
                backgroundColor: stage.color,
                marginRight: i < stages.length - 1 ? "1px" : "0",
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
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Revenue Chart (styled div bars)
// ---------------------------------------------------------------------------
function RevenueChart() {
  const months = [
    { label: "Sep", value: 18400, target: 28000 },
    { label: "Oct", value: 22100, target: 28000 },
    { label: "Nov", value: 31500, target: 28000 },
    { label: "Dec", value: 19800, target: 28000 },
    { label: "Jan", value: 26700, target: 28000 },
    { label: "Feb", value: 24350, target: 36000, isCurrent: true },
  ];

  const maxValue = Math.max(...months.map((m) => Math.max(m.value, m.target)));

  return (
    <Card withGrid className="p-2">
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Revenue</CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-[4px]">
              <span className="w-[8px] h-[3px] rounded-full bg-ops-accent" />
              <span className="font-kosugi text-[9px] text-text-disabled">Actual</span>
            </div>
            <div className="flex items-center gap-[4px]">
              <span className="w-[8px] h-[3px] rounded-full bg-text-disabled opacity-50" />
              <span className="font-kosugi text-[9px] text-text-disabled">Target</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        <div className="flex items-end gap-[6px] h-[120px]">
          {months.map((month, i) => {
            const barHeight = (month.value / maxValue) * 100;
            const targetHeight = (month.target / maxValue) * 100;
            const hitTarget = month.value >= month.target;

            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-[4px] h-full">
                {/* Bar container */}
                <div className="flex-1 w-full flex items-end justify-center relative">
                  {/* Target line */}
                  <div
                    className="absolute w-full border-t border-dashed border-text-disabled/30"
                    style={{ bottom: `${targetHeight}%` }}
                  />
                  {/* Actual bar */}
                  <div
                    className={cn(
                      "w-[70%] rounded-t-sm transition-all duration-700 relative",
                      month.isCurrent
                        ? "bg-ops-amber shadow-glow-amber"
                        : hitTarget
                          ? "bg-ops-accent"
                          : "bg-ops-accent/70"
                    )}
                    style={{
                      height: `${barHeight}%`,
                      animationDelay: `${i * 100}ms`,
                    }}
                  >
                    {/* Glow top line */}
                    {month.isCurrent && (
                      <div className="absolute top-0 left-0 right-0 h-[2px] bg-ops-amber shadow-[0_0_8px_rgba(196,168,104,0.6)]" />
                    )}
                  </div>
                </div>
                {/* Value */}
                <span
                  className={cn(
                    "font-mono text-[9px]",
                    month.isCurrent ? "text-ops-amber" : "text-text-disabled"
                  )}
                >
                  ${(month.value / 1000).toFixed(0)}k
                </span>
                {/* Month label */}
                <span
                  className={cn(
                    "font-kosugi text-[9px]",
                    month.isCurrent ? "text-ops-amber font-medium" : "text-text-disabled"
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
            <p className="font-mono text-body text-text-primary">$24,350</p>
          </div>
          <div className="text-right">
            <span className="font-kosugi text-[10px] text-text-tertiary">Monthly Target</span>
            <p className="font-mono text-body text-text-secondary">$36,000</p>
          </div>
          <div className="text-right">
            <span className="font-kosugi text-[10px] text-text-tertiary">Progress</span>
            <p className="font-mono text-body text-ops-amber">67%</p>
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

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      className={cn(
        "space-y-3 max-w-[1400px] transition-opacity duration-500",
        mounted ? "opacity-100" : "opacity-0"
      )}
    >
      {/* Header with greeting + Command Center status */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mohave text-display-lg text-text-primary tracking-wide">
            {getGreeting()}, Mike
          </h1>
          <p className="font-kosugi text-caption-sm text-text-tertiary">
            Here&apos;s your operational overview for today.
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg bg-background-card border border-border">
          <LiveIndicator size="sm" />
          <span className="font-mohave text-caption-sm text-ops-live uppercase tracking-wider">
            Command Center Online
          </span>
        </div>
      </div>

      {/* Stats Grid - animated counters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <StatCard
          label="Active Projects"
          value={12}
          subValue="3 starting this week"
          icon={FolderKanban}
          trend="up"
          trendValue="+2 from last week"
        />
        <StatCard
          label="This Week"
          value={18}
          subValue="events scheduled"
          icon={CalendarDays}
          trend="neutral"
          trendValue="Same as last week"
        />
        <StatCard
          label="Total Clients"
          value={47}
          subValue="4 new this month"
          icon={Users}
          trend="up"
          trendValue="+8.5% growth"
        />
        <StatCard
          label="Revenue MTD"
          value={24350}
          displayPrefix="$"
          subValue="67% of target"
          icon={DollarSign}
          trend="up"
          trendValue="+12% from last month"
        />
      </div>

      {/* Quick Actions Row */}
      <div>
        <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest mb-1 block">
          Quick Actions
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <QuickActionCard
            label="New Project"
            icon={Plus}
            color="#417394"
            glowColor="rgba(65, 115, 148, 0.4)"
          />
          <QuickActionCard
            label="New Client"
            icon={UserPlus}
            color="#9DB582"
            glowColor="rgba(157, 181, 130, 0.4)"
          />
          <QuickActionCard
            label="Create Invoice"
            icon={FileText}
            color="#C4A868"
            glowColor="rgba(196, 168, 104, 0.4)"
          />
          <QuickActionCard
            label="Schedule Task"
            icon={CalendarPlus}
            color="#8195B5"
            glowColor="rgba(129, 149, 181, 0.4)"
          />
        </div>
      </div>

      {/* Main content: 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {/* Column 1: Calendar + Crew */}
        <div className="space-y-2">
          <MiniCalendar />
          <CrewStatus />
        </div>

        {/* Column 2: Upcoming Tasks + Recent Activity */}
        <div className="space-y-2">
          {/* Upcoming tasks */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-card-subtitle">Upcoming Tasks</CardTitle>
                <span className="font-mono text-[11px] text-text-tertiary">Today + 7 days</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-[4px]">
                {[
                  {
                    title: "Kitchen Demo - Smith",
                    time: "Today 9:00 AM",
                    status: "in-progress",
                    assignee: "Mike D",
                    priority: "high",
                  },
                  {
                    title: "Material Pickup",
                    time: "Today 2:00 PM",
                    status: "pending",
                    assignee: "Sarah L",
                    priority: "medium",
                  },
                  {
                    title: "Estimate - Doe Property",
                    time: "Tue 10:00 AM",
                    status: "pending",
                    assignee: "Mike D",
                    priority: "medium",
                  },
                  {
                    title: "Inspection - Johnson",
                    time: "Fri 8:00 AM",
                    status: "pending",
                    assignee: "Sarah L",
                    priority: "low",
                  },
                  {
                    title: "Cabinet Install",
                    time: "Next Mon 8:00 AM",
                    status: "pending",
                    assignee: "Mike D",
                    priority: "high",
                  },
                ].map((task, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 px-1 py-[7px] rounded hover:bg-background-elevated cursor-pointer transition-colors group"
                  >
                    {task.status === "in-progress" ? (
                      <Clock className="w-[16px] h-[16px] text-ops-amber shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-[16px] h-[16px] text-text-disabled shrink-0" />
                    )}
                    <div
                      className={cn(
                        "w-[3px] h-[16px] rounded-full shrink-0",
                        task.priority === "high" && "bg-ops-error",
                        task.priority === "medium" && "bg-ops-amber",
                        task.priority === "low" && "bg-text-disabled"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-mohave text-body-sm text-text-primary truncate">
                        {task.title}
                      </p>
                    </div>
                    <span className="font-kosugi text-[10px] text-text-tertiary shrink-0">
                      {task.assignee}
                    </span>
                    <span className="font-mono text-[11px] text-text-tertiary shrink-0">
                      {task.time}
                    </span>
                    <ChevronRight className="w-[12px] h-[12px] text-text-disabled opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-card-subtitle">Recent Activity</CardTitle>
                <LiveIndicator size="sm" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-[4px]">
                {[
                  {
                    text: "Mike D completed Kitchen Demo task",
                    time: "2 min ago",
                    type: "success",
                  },
                  {
                    text: "New RFQ from Tom Clark - Fence Install",
                    time: "15 min ago",
                    type: "new",
                  },
                  {
                    text: "Sarah L uploaded 3 photos to Bathroom Remodel",
                    time: "1 hr ago",
                    type: "update",
                  },
                  {
                    text: "Invoice #2047 sent to John Smith",
                    time: "2 hr ago",
                    type: "invoice",
                  },
                  {
                    text: "Deck Installation moved to Accepted",
                    time: "3 hr ago",
                    type: "update",
                  },
                ].map((activity, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-1 px-1 py-[7px] rounded hover:bg-background-elevated cursor-pointer transition-colors"
                  >
                    <div
                      className={cn(
                        "w-[8px] h-[8px] rounded-full shrink-0 mt-[5px]",
                        activity.type === "success" && "bg-status-success",
                        activity.type === "new" && "bg-ops-amber",
                        activity.type === "update" && "bg-ops-accent",
                        activity.type === "invoice" && "bg-status-estimated"
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
          <PipelineMiniView />
          <RevenueChart />
        </div>
      </div>

      {/* Alerts */}
      <Card variant="accent">
        <CardContent className="p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-[20px] h-[20px] text-ops-amber shrink-0" />
              <div>
                <p className="font-mohave text-body text-text-primary">3 invoices overdue</p>
                <p className="font-kosugi text-[11px] text-text-tertiary">
                  Total outstanding: $4,250 - Send reminders to keep cash flow healthy
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 gap-[4px] text-ops-amber">
              View All
              <ArrowRight className="w-[14px] h-[14px]" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
