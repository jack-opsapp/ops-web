"use client";

import { useMemo } from "react";
import {
  FolderKanban,
  ClipboardCheck,
  CalendarDays,
  Users,
  UserCheck,
  DollarSign,
  FileText,
  Calculator,
  Target,
} from "lucide-react";
import { StatCard } from "./stat-card";
import {
  useProjects,
  useTasks,
  useClients,
  useTeamMembers,
  useCalendarEventsForRange,
  useInvoices,
  useEstimates,
  useOpportunities,
} from "@/lib/hooks";
import {
  type ProjectTask,
  TaskStatus,
  ProjectStatus,
  isActiveProjectStatus,
} from "@/lib/types/models";
import {
  InvoiceStatus,
  EstimateStatus,
  OpportunityStage,
} from "@/lib/types/pipeline";
import type { WidgetTypeId } from "@/lib/types/dashboard-widgets";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  isSameDay,
  isBefore,
  isAfter,
} from "@/lib/utils/date";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface StatWidgetProps {
  typeId: WidgetTypeId;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function StatWidget({ typeId, config }: StatWidgetProps) {
  switch (typeId) {
    case "stat-projects":
      return <StatProjects config={config} />;
    case "stat-tasks":
      return <StatTasks config={config} />;
    case "stat-events":
      return <StatEvents config={config} />;
    case "stat-clients":
      return <StatClients config={config} />;
    case "stat-team":
      return <StatTeam config={config} />;
    case "stat-revenue":
      return <StatRevenue config={config} />;
    case "stat-invoices":
      return <StatInvoices config={config} />;
    case "stat-estimates":
      return <StatEstimatesCount config={config} />;
    case "stat-opportunities":
      return <StatOpportunities config={config} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Individual stat implementations
// ---------------------------------------------------------------------------

function StatProjects({ config }: { config: Record<string, unknown> }) {
  const { data, isLoading } = useProjects();
  const projects = data?.projects ?? [];
  const statusFilter = (config.statusFilter as string) ?? "all";

  const { value, subValue, label } = useMemo(() => {
    const active = projects.filter((p) => !p.deletedAt);
    if (statusFilter === "all") {
      const count = active.filter((p) => isActiveProjectStatus(p.status)).length;
      return { value: count, subValue: `of ${active.length} total`, label: "Active Projects" };
    }
    const statusMap: Record<string, ProjectStatus> = {
      rfq: ProjectStatus.RFQ,
      estimated: ProjectStatus.Estimated,
      accepted: ProjectStatus.Accepted,
      in_progress: ProjectStatus.InProgress,
      completed: ProjectStatus.Completed,
    };
    const status = statusMap[statusFilter];
    const count = active.filter((p) => p.status === status).length;
    const statusLabel = status ?? statusFilter;
    return { value: count, subValue: `${statusLabel} projects`, label: `${statusLabel} Projects` };
  }, [projects, statusFilter]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={FolderKanban} isLoading={isLoading} />
  );
}

function StatTasks({ config }: { config: Record<string, unknown> }) {
  const { data, isLoading } = useTasks();
  const tasks = data?.tasks ?? [];
  const filter = (config.filter as string) ?? "due-today";

  const { value, subValue, label } = useMemo(() => {
    const today = new Date();
    const weekEnd = endOfWeek(today, { weekStartsOn: 0 });
    const open = tasks.filter(
      (t: ProjectTask) =>
        !t.deletedAt && t.status !== TaskStatus.Completed && t.status !== TaskStatus.Cancelled
    );

    switch (filter) {
      case "due-today": {
        const count = open.filter((t: ProjectTask) => {
          if (!t.calendarEvent?.startDate) return false;
          return isSameDay(new Date(t.calendarEvent.startDate), today);
        }).length;
        return { value: count, subValue: "due today", label: "Tasks Due Today" };
      }
      case "due-this-week": {
        const count = open.filter((t: ProjectTask) => {
          if (!t.calendarEvent?.startDate) return false;
          const d = new Date(t.calendarEvent.startDate);
          return !isAfter(d, weekEnd) && !isBefore(d, today);
        }).length;
        return { value: count, subValue: "this week", label: "Tasks This Week" };
      }
      case "overdue": {
        const count = open.filter((t: ProjectTask) => {
          if (!t.calendarEvent?.startDate) return false;
          return isBefore(new Date(t.calendarEvent.startDate), today) &&
            !isSameDay(new Date(t.calendarEvent.startDate), today);
        }).length;
        return { value: count, subValue: "overdue", label: "Overdue Tasks" };
      }
      case "in-progress": {
        const count = open.filter((t: ProjectTask) => t.status === TaskStatus.InProgress).length;
        return { value: count, subValue: "in progress", label: "In Progress" };
      }
      case "all-open":
      default: {
        return { value: open.length, subValue: "open tasks", label: "Open Tasks" };
      }
    }
  }, [tasks, filter]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={ClipboardCheck} isLoading={isLoading} />
  );
}

function StatEvents({ config }: { config: Record<string, unknown> }) {
  const range = (config.range as string) ?? "this-week";
  const today = useMemo(() => new Date(), []);

  const { start, end } = useMemo(() => {
    switch (range) {
      case "today":
        return { start: today, end: today };
      case "this-month":
        return { start: startOfMonth(today), end: endOfMonth(today) };
      case "this-week":
      default:
        return { start: startOfWeek(today, { weekStartsOn: 0 }), end: endOfWeek(today, { weekStartsOn: 0 }) };
    }
  }, [range, today]);

  const { data, isLoading } = useCalendarEventsForRange(start, end);
  const events = data ?? [];

  const rangeLabels: Record<string, string> = {
    today: "today",
    "this-week": "this week",
    "this-month": "this month",
  };

  return (
    <StatCard
      label={`Events ${rangeLabels[range] ?? ""}`}
      value={events.length}
      subValue={rangeLabels[range]}
      icon={CalendarDays}
      isLoading={isLoading}
    />
  );
}

function StatClients({ config }: { config: Record<string, unknown> }) {
  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: projectsData } = useProjects();
  const filter = (config.filter as string) ?? "all";

  const clients = clientsData?.clients ?? [];
  const projects = projectsData?.projects ?? [];

  const { value, subValue, label } = useMemo(() => {
    const active = clients.filter((c) => !c.deletedAt);
    if (filter === "active") {
      const clientsWithActiveProjects = new Set(
        projects
          .filter((p) => isActiveProjectStatus(p.status) && !p.deletedAt && p.clientId)
          .map((p) => p.clientId)
      );
      const count = active.filter((c) => clientsWithActiveProjects.has(c.id)).length;
      return { value: count, subValue: `of ${active.length} total`, label: "Active Clients" };
    }
    return { value: active.length, subValue: "total clients", label: "Total Clients" };
  }, [clients, projects, filter]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={Users} isLoading={clientsLoading} />
  );
}

function StatTeam({ config }: { config: Record<string, unknown> }) {
  const { data, isLoading } = useTeamMembers();
  const members = data?.users ?? [];
  const filter = (config.filter as string) ?? "active";

  const { value, subValue, label } = useMemo(() => {
    if (filter === "active") {
      const count = members.filter((m) => m.isActive).length;
      return { value: count, subValue: `of ${members.length} total`, label: "Active Crew" };
    }
    return { value: members.length, subValue: "team members", label: "All Crew" };
  }, [members, filter]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={UserCheck} isLoading={isLoading} />
  );
}

function StatRevenue({ config }: { config: Record<string, unknown> }) {
  const { data } = useInvoices();
  const invoices = data ?? [];
  const metric = (config.metric as string) ?? "mtd-invoiced";

  const { value, subValue, label } = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    switch (metric) {
      case "mtd-invoiced": {
        const total = invoices
          .filter((inv) => !inv.deletedAt && inv.issueDate && new Date(inv.issueDate) >= monthStart)
          .reduce((sum, inv) => sum + (inv.total ?? 0), 0);
        return { value: Math.round(total), subValue: "invoiced this month", label: "Revenue MTD" };
      }
      case "mtd-collected": {
        const total = invoices
          .filter((inv) => !inv.deletedAt && inv.paidAt && new Date(inv.paidAt) >= monthStart)
          .reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);
        return { value: Math.round(total), subValue: "collected this month", label: "Collected MTD" };
      }
      case "outstanding": {
        const total = invoices
          .filter((inv) => !inv.deletedAt && inv.status !== InvoiceStatus.Paid && inv.status !== InvoiceStatus.Void)
          .reduce((sum, inv) => sum + (inv.balanceDue ?? 0), 0);
        return { value: Math.round(total), subValue: "outstanding", label: "Outstanding" };
      }
      case "ytd": {
        const total = invoices
          .filter((inv) => !inv.deletedAt && inv.paidAt && new Date(inv.paidAt) >= yearStart)
          .reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);
        return { value: Math.round(total), subValue: "year to date", label: "Revenue YTD" };
      }
      default:
        return { value: 0, subValue: "", label: "Revenue" };
    }
  }, [invoices, metric]);

  return (
    <StatCard label={label} value={value} displayPrefix="$" subValue={subValue} icon={DollarSign} />
  );
}

function StatInvoices({ config }: { config: Record<string, unknown> }) {
  const { data } = useInvoices();
  const invoices = data ?? [];
  const statusFilter = (config.statusFilter as string) ?? "all-open";

  const { value, subValue, label } = useMemo(() => {
    const active = invoices.filter((inv) => !inv.deletedAt);

    if (statusFilter === "all-open") {
      const open = active.filter(
        (inv) => inv.status !== InvoiceStatus.Paid && inv.status !== InvoiceStatus.Void && inv.status !== InvoiceStatus.WrittenOff
      );
      return { value: open.length, subValue: "open invoices", label: "Open Invoices" };
    }

    const statusMap: Record<string, InvoiceStatus> = {
      draft: InvoiceStatus.Draft,
      sent: InvoiceStatus.Sent,
      viewed: InvoiceStatus.AwaitingPayment,
      past_due: InvoiceStatus.PastDue,
    };
    const status = statusMap[statusFilter];
    const count = active.filter((inv) => inv.status === status).length;
    return { value: count, subValue: `${statusFilter} invoices`, label: `${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Invoices` };
  }, [invoices, statusFilter]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={FileText} />
  );
}

function StatEstimatesCount({ config }: { config: Record<string, unknown> }) {
  const { data } = useEstimates();
  const estimates = data ?? [];
  const statusFilter = (config.statusFilter as string) ?? "all-open";

  const { value, subValue, label } = useMemo(() => {
    const active = estimates.filter((est) => !est.deletedAt);

    if (statusFilter === "all-open") {
      const open = active.filter(
        (est) =>
          est.status !== EstimateStatus.Converted &&
          est.status !== EstimateStatus.Declined &&
          est.status !== EstimateStatus.Expired &&
          est.status !== EstimateStatus.Superseded
      );
      return { value: open.length, subValue: "open estimates", label: "Open Estimates" };
    }

    const statusMap: Record<string, EstimateStatus> = {
      draft: EstimateStatus.Draft,
      sent: EstimateStatus.Sent,
      viewed: EstimateStatus.Viewed,
      approved: EstimateStatus.Approved,
    };
    const status = statusMap[statusFilter];
    const count = active.filter((est) => est.status === status).length;
    return { value: count, subValue: `${statusFilter} estimates`, label: `${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Estimates` };
  }, [estimates, statusFilter]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={Calculator} />
  );
}

function StatOpportunities({ config }: { config: Record<string, unknown> }) {
  const { data } = useOpportunities();
  const opportunities = data ?? [];
  const stageFilter = (config.stageFilter as string) ?? "all-active";
  const metric = (config.metric as string) ?? "count";

  const { value, subValue, label, prefix } = useMemo(() => {
    const active = opportunities.filter(
      (opp) => !opp.deletedAt && opp.stage !== OpportunityStage.Won && opp.stage !== OpportunityStage.Lost
    );

    const closedStages = new Set([OpportunityStage.Won, OpportunityStage.Lost]);

    if (stageFilter === "all-active") {
      if (metric === "value") {
        const total = active.reduce((sum, opp) => sum + (opp.estimatedValue ?? 0), 0);
        return { value: Math.round(total), subValue: "pipeline value", label: "Pipeline Value", prefix: "$" };
      }
      return { value: active.length, subValue: "active opportunities", label: "Opportunities", prefix: "" };
    }

    const stageMap: Record<string, OpportunityStage> = {
      new_lead: OpportunityStage.NewLead,
      contacted: OpportunityStage.Qualifying,
      qualified: OpportunityStage.Quoting,
      proposal_sent: OpportunityStage.Quoted,
      negotiation: OpportunityStage.Negotiation,
    };
    const stage = stageMap[stageFilter];
    const filtered = opportunities.filter((opp) => !opp.deletedAt && opp.stage === stage);

    if (metric === "value") {
      const total = filtered.reduce((sum, opp) => sum + (opp.estimatedValue ?? 0), 0);
      return { value: Math.round(total), subValue: `${stageFilter} value`, label: `${stageFilter} Value`, prefix: "$" };
    }
    return { value: filtered.length, subValue: `${stageFilter}`, label: `${stageFilter.charAt(0).toUpperCase() + stageFilter.slice(1)}`, prefix: "" };
  }, [opportunities, stageFilter, metric]);

  return (
    <StatCard label={label} value={value} displayPrefix={prefix} subValue={subValue} icon={Target} />
  );
}
