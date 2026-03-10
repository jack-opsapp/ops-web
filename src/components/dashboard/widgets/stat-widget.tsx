"use client";

import { useMemo } from "react";
import { useDictionary } from "@/i18n/client";
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
  useScheduledTasks,
  useInvoices,
  useInvoiceLineItems,
  useEstimates,
  useOpportunities,
} from "@/lib/hooks";
import {
  type ProjectTask,
  TaskStatus,
  ProjectStatus,
  isActiveProjectStatus,
  PROJECT_STATUS_COLORS,
  TASK_STATUS_COLORS,
} from "@/lib/types/models";
import {
  InvoiceStatus,
  EstimateStatus,
  OpportunityStage,
} from "@/lib/types/pipeline";
import type { WidgetTypeId, WidgetSize } from "@/lib/types/dashboard-widgets";
import type { LineItem } from "@/lib/types/pipeline";
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
// Accent color map — explicit per widget type
// ---------------------------------------------------------------------------
const STAT_ACCENT_COLORS: Partial<Record<WidgetTypeId, string | null>> = {
  // Generic stats
  "stat-projects": "#9DB582",       // accepted green (all active)
  "stat-tasks": null,               // neutral
  "stat-events": null,              // neutral
  "stat-clients": null,             // neutral
  "stat-team": null,                // neutral
  "stat-revenue": "#C4A868",        // amber
  "stat-invoices": "#B5A381",       // warm
  "stat-estimates": "#7B68A6",      // violet
  "stat-opportunities": "#B58289",  // rose

  // Per-status projects — use PROJECT_STATUS_COLORS
  "stat-projects-rfq": PROJECT_STATUS_COLORS[ProjectStatus.RFQ],
  "stat-projects-estimated": PROJECT_STATUS_COLORS[ProjectStatus.Estimated],
  "stat-projects-accepted": PROJECT_STATUS_COLORS[ProjectStatus.Accepted],
  "stat-projects-in-progress": PROJECT_STATUS_COLORS[ProjectStatus.InProgress],
  "stat-projects-completed": PROJECT_STATUS_COLORS[ProjectStatus.Completed],

  // Per-status tasks — use TASK_STATUS_COLORS
  "stat-tasks-booked": TASK_STATUS_COLORS[TaskStatus.Booked],
  "stat-tasks-in-progress": TASK_STATUS_COLORS[TaskStatus.InProgress],
  "stat-tasks-completed": TASK_STATUS_COLORS[TaskStatus.Completed],
  "stat-tasks-overdue": "#93321A",  // error red

  // Client segment
  "stat-clients-active": "#9DB582", // accepted green

  // Financial
  "stat-receivables": "#C4A868",    // amber
  "stat-collect": "#B58289",        // completed rose
  "stat-profit-mtd": "#9DB582",     // profit green
  "stat-projected-profit": "#9DB582", // profit green
};

function getAccentColor(typeId: WidgetTypeId): string | null {
  const color = STAT_ACCENT_COLORS[typeId];
  return color === undefined ? null : color;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface StatWidgetProps {
  typeId: WidgetTypeId;
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function StatWidget({ typeId, size, config }: StatWidgetProps) {
  switch (typeId) {
    case "stat-projects":
      return <StatProjects typeId={typeId} size={size} config={config} />;
    case "stat-tasks":
      return <StatTasks typeId={typeId} size={size} config={config} />;
    case "stat-events":
      return <StatEvents typeId={typeId} size={size} config={config} />;
    case "stat-clients":
      return <StatClients typeId={typeId} size={size} config={config} />;
    case "stat-team":
      return <StatTeam typeId={typeId} size={size} config={config} />;
    case "stat-revenue":
      return <StatRevenue typeId={typeId} size={size} config={config} />;
    case "stat-invoices":
      return <StatInvoices typeId={typeId} size={size} config={config} />;
    case "stat-estimates":
      return <StatEstimatesCount typeId={typeId} size={size} config={config} />;
    case "stat-opportunities":
      return <StatOpportunities typeId={typeId} size={size} config={config} />;

    // Per-status projects
    case "stat-projects-rfq":
    case "stat-projects-estimated":
    case "stat-projects-accepted":
    case "stat-projects-in-progress":
    case "stat-projects-completed":
      return <StatProjectsByStatus typeId={typeId} size={size} />;

    // Per-status tasks
    case "stat-tasks-booked":
    case "stat-tasks-in-progress":
    case "stat-tasks-completed":
    case "stat-tasks-overdue":
      return <StatTasksByStatus typeId={typeId} size={size} />;

    // Client segment
    case "stat-clients-active":
      return <StatClientsActive typeId={typeId} size={size} />;

    // Financial
    case "stat-receivables":
      return <StatReceivables typeId={typeId} size={size} />;
    case "stat-collect":
      return <StatToCollect typeId={typeId} size={size} />;
    case "stat-profit-mtd":
      return <StatProfitMTD typeId={typeId} size={size} />;
    case "stat-projected-profit":
      return <StatProjectedProfit typeId={typeId} size={size} />;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Shared inner props
// ---------------------------------------------------------------------------
interface InnerStatProps {
  typeId: WidgetTypeId;
  size: WidgetSize;
  config: Record<string, unknown>;
}

interface SimpleStatProps {
  typeId: WidgetTypeId;
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Per-status project stat
// ---------------------------------------------------------------------------
const PROJECT_STATUS_MAP: Partial<Record<WidgetTypeId, ProjectStatus>> = {
  "stat-projects-rfq": ProjectStatus.RFQ,
  "stat-projects-estimated": ProjectStatus.Estimated,
  "stat-projects-accepted": ProjectStatus.Accepted,
  "stat-projects-in-progress": ProjectStatus.InProgress,
  "stat-projects-completed": ProjectStatus.Completed,
};

function useProjectStatusLabels(): Record<ProjectStatus, string> {
  const { t } = useDictionary("dashboard");
  return {
    [ProjectStatus.RFQ]: t("stat.statusRfq"),
    [ProjectStatus.Estimated]: t("stat.statusEstimated"),
    [ProjectStatus.Accepted]: t("stat.statusAccepted"),
    [ProjectStatus.InProgress]: t("stat.statusInProgress"),
    [ProjectStatus.Completed]: t("stat.statusCompleted"),
    [ProjectStatus.Closed]: t("stat.statusClosed"),
    [ProjectStatus.Archived]: t("stat.statusArchived"),
  };
}

function StatProjectsByStatus({ typeId, size }: SimpleStatProps) {
  const { t } = useDictionary("dashboard");
  const PROJECT_STATUS_LABELS = useProjectStatusLabels();
  const { data, isLoading } = useProjects();
  const projects = data?.projects ?? [];
  const status = PROJECT_STATUS_MAP[typeId]!;

  const PROJECT_STATUS_LABEL_KEYS: Record<ProjectStatus, string> = {
    [ProjectStatus.RFQ]: t("stat.rfqProjects"),
    [ProjectStatus.Estimated]: t("stat.estimatedProjects"),
    [ProjectStatus.Accepted]: t("stat.acceptedProjects"),
    [ProjectStatus.InProgress]: t("stat.inProgressProjects"),
    [ProjectStatus.Completed]: t("stat.completedProjects"),
    [ProjectStatus.Closed]: t("stat.closedProjects"),
    [ProjectStatus.Archived]: t("stat.archivedProjects"),
  };

  const count = useMemo(
    () => projects.filter((p) => !p.deletedAt && p.status === status).length,
    [projects, status]
  );

  return (
    <StatCard
      label={PROJECT_STATUS_LABEL_KEYS[status]}
      value={count}
      subValue={PROJECT_STATUS_LABELS[status]}
      icon={FolderKanban}
      isLoading={isLoading}
      accentColor={getAccentColor(typeId)}
      size={size}
    />
  );
}

// ---------------------------------------------------------------------------
// Per-status task stat
// ---------------------------------------------------------------------------
const TASK_STATUS_MAP: Partial<Record<WidgetTypeId, TaskStatus | "overdue">> = {
  "stat-tasks-booked": TaskStatus.Booked,
  "stat-tasks-in-progress": TaskStatus.InProgress,
  "stat-tasks-completed": TaskStatus.Completed,
  "stat-tasks-overdue": "overdue",
};

function useTaskStatusLabels(): Record<string, string> {
  const { t } = useDictionary("dashboard");
  return {
    [TaskStatus.Booked]: t("stat.statusBooked"),
    [TaskStatus.InProgress]: t("stat.statusInProgress"),
    [TaskStatus.Completed]: t("stat.statusCompleted"),
    overdue: t("stat.statusOverdue"),
  };
}

function StatTasksByStatus({ typeId, size }: SimpleStatProps) {
  const { t } = useDictionary("dashboard");
  const TASK_STATUS_LABELS = useTaskStatusLabels();
  const { data, isLoading } = useTasks();
  const tasks = data?.tasks ?? [];
  const statusOrOverdue = TASK_STATUS_MAP[typeId]!;

  const TASK_STATUS_LABEL_KEYS: Record<string, string> = {
    [TaskStatus.Booked]: t("stat.bookedTasks"),
    [TaskStatus.InProgress]: t("stat.inProgressTasks"),
    [TaskStatus.Completed]: t("stat.completedTasks"),
    overdue: t("stat.overdueTasks"),
  };

  const count = useMemo(() => {
    const active = tasks.filter((tk: ProjectTask) => !tk.deletedAt);

    if (statusOrOverdue === "overdue") {
      const today = new Date();
      return active.filter((tk: ProjectTask) => {
        if (tk.status === TaskStatus.Completed || tk.status === TaskStatus.Cancelled) return false;
        if (!tk.startDate) return false;
        return isBefore(new Date(tk.startDate), today) &&
          !isSameDay(new Date(tk.startDate), today);
      }).length;
    }

    return active.filter((tk: ProjectTask) => tk.status === statusOrOverdue).length;
  }, [tasks, statusOrOverdue]);

  const label = TASK_STATUS_LABELS[statusOrOverdue] ?? t("stat.tasks");
  const composedLabel = TASK_STATUS_LABEL_KEYS[statusOrOverdue] ?? t("stat.tasks");

  return (
    <StatCard
      label={composedLabel}
      value={count}
      subValue={label.toLowerCase()}
      icon={ClipboardCheck}
      isLoading={isLoading}
      accentColor={getAccentColor(typeId)}
      size={size}
    />
  );
}

// ---------------------------------------------------------------------------
// Active clients (cross-reference with projects)
// ---------------------------------------------------------------------------
function StatClientsActive({ typeId, size }: SimpleStatProps) {
  const { t } = useDictionary("dashboard");
  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: projectsData } = useProjects();

  const clients = clientsData?.clients ?? [];
  const projects = projectsData?.projects ?? [];

  const { value, subValue } = useMemo(() => {
    const active = clients.filter((c) => !c.deletedAt);
    const clientsWithActiveProjects = new Set(
      projects
        .filter((p) => isActiveProjectStatus(p.status) && !p.deletedAt && p.clientId)
        .map((p) => p.clientId)
    );
    const count = active.filter((c) => clientsWithActiveProjects.has(c.id)).length;
    return { value: count, subValue: `${t("stat.of")} ${active.length} ${t("stat.total")}` };
  }, [clients, projects, t]);

  return (
    <StatCard
      label={t("stat.activeClients")}
      value={value}
      subValue={subValue}
      icon={Users}
      isLoading={clientsLoading}
      accentColor={getAccentColor(typeId)}
      size={size}
    />
  );
}

// ---------------------------------------------------------------------------
// Receivables — sum balanceDue on all open invoices
// ---------------------------------------------------------------------------
function StatReceivables({ typeId, size }: SimpleStatProps) {
  const { t } = useDictionary("dashboard");
  const { data } = useInvoices();
  const invoices = data ?? [];

  const total = useMemo(
    () =>
      invoices
        .filter(
          (inv) =>
            !inv.deletedAt &&
            inv.status !== InvoiceStatus.Paid &&
            inv.status !== InvoiceStatus.Void
        )
        .reduce((sum, inv) => sum + (inv.balanceDue ?? 0), 0),
    [invoices]
  );

  return (
    <StatCard
      label={t("stat.receivables")}
      value={Math.round(total)}
      displayPrefix="$"
      subValue={t("stat.outstanding")}
      icon={DollarSign}
      accentColor={getAccentColor(typeId)}
      size={size}
    />
  );
}

// ---------------------------------------------------------------------------
// To Collect — sum balanceDue on invoices linked to completed projects
// ---------------------------------------------------------------------------
function StatToCollect({ typeId, size }: SimpleStatProps) {
  const { t } = useDictionary("dashboard");
  const { data: invoicesData } = useInvoices();
  const { data: projectsData } = useProjects();

  const invoices = invoicesData ?? [];
  const projects = projectsData?.projects ?? [];

  const total = useMemo(() => {
    const completedProjectIds = new Set(
      projects
        .filter((p) => !p.deletedAt && p.status === ProjectStatus.Completed)
        .map((p) => p.id)
    );

    return invoices
      .filter(
        (inv) =>
          !inv.deletedAt &&
          inv.projectId &&
          completedProjectIds.has(inv.projectId) &&
          inv.status !== InvoiceStatus.Paid &&
          inv.status !== InvoiceStatus.Void
      )
      .reduce((sum, inv) => sum + (inv.balanceDue ?? 0), 0);
  }, [invoices, projects]);

  return (
    <StatCard
      label={t("stat.toCollect")}
      value={Math.round(total)}
      displayPrefix="$"
      subValue={t("stat.onCompletedProjects")}
      icon={DollarSign}
      accentColor={getAccentColor(typeId)}
      size={size}
    />
  );
}

// ---------------------------------------------------------------------------
// Original stat implementations (updated to pass accentColor)
// ---------------------------------------------------------------------------

function StatProjects({ typeId, size, config }: InnerStatProps) {
  const { t } = useDictionary("dashboard");
  const PROJECT_STATUS_LABELS = useProjectStatusLabels();
  const { data, isLoading } = useProjects();
  const projects = data?.projects ?? [];
  const statusFilter = (config.statusFilter as string) ?? "all";

  const { value, subValue, label } = useMemo(() => {
    const active = projects.filter((p) => !p.deletedAt);
    if (statusFilter === "all") {
      const count = active.filter((p) => isActiveProjectStatus(p.status)).length;
      return { value: count, subValue: `${t("stat.of")} ${active.length} ${t("stat.total")}`, label: t("stat.activeProjects") };
    }
    const statusMap: Record<string, ProjectStatus> = {
      rfq: ProjectStatus.RFQ,
      estimated: ProjectStatus.Estimated,
      accepted: ProjectStatus.Accepted,
      in_progress: ProjectStatus.InProgress,
      completed: ProjectStatus.Completed,
    };
    const status = statusMap[statusFilter];
    const PROJECT_LABEL_BY_STATUS: Record<ProjectStatus, string> = {
      [ProjectStatus.RFQ]: t("stat.rfqProjects"),
      [ProjectStatus.Estimated]: t("stat.estimatedProjects"),
      [ProjectStatus.Accepted]: t("stat.acceptedProjects"),
      [ProjectStatus.InProgress]: t("stat.inProgressProjects"),
      [ProjectStatus.Completed]: t("stat.completedProjects"),
      [ProjectStatus.Closed]: t("stat.closedProjects"),
      [ProjectStatus.Archived]: t("stat.archivedProjects"),
    };
    const PROJECT_SUBVALUE_BY_STATUS: Record<ProjectStatus, string> = {
      [ProjectStatus.RFQ]: t("stat.rfqProjectsSub"),
      [ProjectStatus.Estimated]: t("stat.estimatedProjectsSub"),
      [ProjectStatus.Accepted]: t("stat.acceptedProjectsSub"),
      [ProjectStatus.InProgress]: t("stat.inProgressProjectsSub"),
      [ProjectStatus.Completed]: t("stat.completedProjectsSub"),
      [ProjectStatus.Closed]: t("stat.closedProjectsSub"),
      [ProjectStatus.Archived]: t("stat.archivedProjectsSub"),
    };
    const count = active.filter((p) => p.status === status).length;
    const composedLabel = status ? PROJECT_LABEL_BY_STATUS[status] : statusFilter;
    const composedSub = status ? PROJECT_SUBVALUE_BY_STATUS[status] : statusFilter;
    return { value: count, subValue: composedSub, label: composedLabel };
  }, [projects, statusFilter, t, PROJECT_STATUS_LABELS]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={FolderKanban} isLoading={isLoading} accentColor={getAccentColor(typeId)} size={size} />
  );
}

function StatTasks({ typeId, size, config }: InnerStatProps) {
  const { t } = useDictionary("dashboard");
  const { data, isLoading } = useTasks();
  const tasks = data?.tasks ?? [];
  const filter = (config.filter as string) ?? "due-today";

  const { value, subValue, label } = useMemo(() => {
    const today = new Date();
    const weekEnd = endOfWeek(today, { weekStartsOn: 0 });
    const open = tasks.filter(
      (tk: ProjectTask) =>
        !tk.deletedAt && tk.status !== TaskStatus.Completed && tk.status !== TaskStatus.Cancelled
    );

    switch (filter) {
      case "due-today": {
        const count = open.filter((tk: ProjectTask) => {
          if (!tk.startDate) return false;
          return isSameDay(new Date(tk.startDate), today);
        }).length;
        return { value: count, subValue: t("stat.dueToday"), label: t("stat.tasksDueToday") };
      }
      case "due-this-week": {
        const count = open.filter((tk: ProjectTask) => {
          if (!tk.startDate) return false;
          const d = new Date(tk.startDate);
          return !isAfter(d, weekEnd) && !isBefore(d, today);
        }).length;
        return { value: count, subValue: t("stat.thisWeek"), label: t("stat.tasksThisWeek") };
      }
      case "overdue": {
        const count = open.filter((tk: ProjectTask) => {
          if (!tk.startDate) return false;
          return isBefore(new Date(tk.startDate), today) &&
            !isSameDay(new Date(tk.startDate), today);
        }).length;
        return { value: count, subValue: t("stat.overdue"), label: t("stat.overdueTasks") };
      }
      case "in-progress": {
        const count = open.filter((tk: ProjectTask) => tk.status === TaskStatus.InProgress).length;
        return { value: count, subValue: t("stat.inProgress"), label: t("stat.inProgressLabel") };
      }
      case "all-open":
      default: {
        return { value: open.length, subValue: t("stat.openTasks"), label: t("stat.openTasksLabel") };
      }
    }
  }, [tasks, filter, t]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={ClipboardCheck} isLoading={isLoading} accentColor={getAccentColor(typeId)} size={size} />
  );
}

function StatEvents({ typeId, size, config }: InnerStatProps) {
  const { t } = useDictionary("dashboard");
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

  const { data: scheduledTasks, isLoading } = useScheduledTasks(start, end);
  const events = scheduledTasks ?? [];

  const rangeLabels: Record<string, string> = {
    today: t("stat.today"),
    "this-week": t("stat.thisWeek"),
    "this-month": t("stat.thisMonth"),
  };

  const rangeTitles: Record<string, string> = {
    today: t("stat.eventsToday"),
    "this-week": t("stat.eventsThisWeek"),
    "this-month": t("stat.eventsThisMonth"),
  };

  return (
    <StatCard
      label={rangeTitles[range] ?? ""}
      value={events.length}
      subValue={rangeLabels[range]}
      icon={CalendarDays}
      isLoading={isLoading}
      accentColor={getAccentColor(typeId)}
      size={size}
    />
  );
}

function StatClients({ typeId, size, config }: InnerStatProps) {
  const { t } = useDictionary("dashboard");
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
      return { value: count, subValue: `${t("stat.of")} ${active.length} ${t("stat.total")}`, label: t("stat.activeClients") };
    }
    return { value: active.length, subValue: t("stat.totalClients"), label: t("stat.totalClientsLabel") };
  }, [clients, projects, filter, t]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={Users} isLoading={clientsLoading} accentColor={getAccentColor(typeId)} size={size} />
  );
}

function StatTeam({ typeId, size, config }: InnerStatProps) {
  const { t } = useDictionary("dashboard");
  const { data, isLoading } = useTeamMembers();
  const members = data?.users ?? [];
  const filter = (config.filter as string) ?? "active";

  const { value, subValue, label } = useMemo(() => {
    if (filter === "active") {
      const count = members.filter((m) => m.isActive).length;
      return { value: count, subValue: `${t("stat.of")} ${members.length} ${t("stat.total")}`, label: t("stat.activeCrew") };
    }
    return { value: members.length, subValue: t("stat.teamMembers"), label: t("stat.allCrew") };
  }, [members, filter, t]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={UserCheck} isLoading={isLoading} accentColor={getAccentColor(typeId)} size={size} />
  );
}

function StatRevenue({ typeId, size, config }: InnerStatProps) {
  const { t } = useDictionary("dashboard");
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
        return { value: Math.round(total), subValue: t("stat.invoicedThisMonth"), label: t("stat.revenueMtd") };
      }
      case "mtd-collected": {
        const total = invoices
          .filter((inv) => !inv.deletedAt && inv.paidAt && new Date(inv.paidAt) >= monthStart)
          .reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);
        return { value: Math.round(total), subValue: t("stat.collectedThisMonth"), label: t("stat.collectedMtd") };
      }
      case "outstanding": {
        const total = invoices
          .filter((inv) => !inv.deletedAt && inv.status !== InvoiceStatus.Paid && inv.status !== InvoiceStatus.Void)
          .reduce((sum, inv) => sum + (inv.balanceDue ?? 0), 0);
        return { value: Math.round(total), subValue: t("stat.outstanding"), label: t("stat.outstandingLabel") };
      }
      case "ytd": {
        const total = invoices
          .filter((inv) => !inv.deletedAt && inv.paidAt && new Date(inv.paidAt) >= yearStart)
          .reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);
        return { value: Math.round(total), subValue: t("stat.yearToDate"), label: t("stat.revenueYtd") };
      }
      default:
        return { value: 0, subValue: "", label: t("stat.revenue") };
    }
  }, [invoices, metric, t]);

  return (
    <StatCard label={label} value={value} displayPrefix="$" subValue={subValue} icon={DollarSign} accentColor={getAccentColor(typeId)} size={size} />
  );
}

function StatInvoices({ typeId, size, config }: InnerStatProps) {
  const { t } = useDictionary("dashboard");
  const { data } = useInvoices();
  const invoices = data ?? [];
  const statusFilter = (config.statusFilter as string) ?? "all-open";

  const { value, subValue, label } = useMemo(() => {
    const active = invoices.filter((inv) => !inv.deletedAt);

    if (statusFilter === "all-open") {
      const open = active.filter(
        (inv) => inv.status !== InvoiceStatus.Paid && inv.status !== InvoiceStatus.Void && inv.status !== InvoiceStatus.WrittenOff
      );
      return { value: open.length, subValue: t("stat.openInvoices"), label: t("stat.openInvoicesLabel") };
    }

    const statusMap: Record<string, InvoiceStatus> = {
      draft: InvoiceStatus.Draft,
      sent: InvoiceStatus.Sent,
      viewed: InvoiceStatus.AwaitingPayment,
      past_due: InvoiceStatus.PastDue,
    };
    const invoiceStatusLabels: Record<string, { label: string; sub: string }> = {
      draft: { label: t("stat.draftInvoicesLabel"), sub: t("stat.draftInvoices") },
      sent: { label: t("stat.sentInvoicesLabel"), sub: t("stat.sentInvoices") },
      viewed: { label: t("stat.viewedInvoicesLabel"), sub: t("stat.viewedInvoices") },
      past_due: { label: t("stat.pastDueInvoicesLabel"), sub: t("stat.pastDueInvoices") },
    };
    const status = statusMap[statusFilter];
    const count = active.filter((inv) => inv.status === status).length;
    const labels = invoiceStatusLabels[statusFilter];
    return { value: count, subValue: labels?.sub ?? statusFilter, label: labels?.label ?? statusFilter };
  }, [invoices, statusFilter, t]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={FileText} accentColor={getAccentColor(typeId)} size={size} />
  );
}

function StatEstimatesCount({ typeId, size, config }: InnerStatProps) {
  const { t } = useDictionary("dashboard");
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
      return { value: open.length, subValue: t("stat.openEstimates"), label: t("stat.openEstimatesLabel") };
    }

    const statusMap: Record<string, EstimateStatus> = {
      draft: EstimateStatus.Draft,
      sent: EstimateStatus.Sent,
      viewed: EstimateStatus.Viewed,
      approved: EstimateStatus.Approved,
    };
    const estimateStatusLabels: Record<string, { label: string; sub: string }> = {
      draft: { label: t("stat.draftEstimatesLabel"), sub: t("stat.draftEstimates") },
      sent: { label: t("stat.sentEstimatesLabel"), sub: t("stat.sentEstimates") },
      viewed: { label: t("stat.viewedEstimatesLabel"), sub: t("stat.viewedEstimates") },
      approved: { label: t("stat.approvedEstimatesLabel"), sub: t("stat.approvedEstimates") },
    };
    const status = statusMap[statusFilter];
    const count = active.filter((est) => est.status === status).length;
    const labels = estimateStatusLabels[statusFilter];
    return { value: count, subValue: labels?.sub ?? statusFilter, label: labels?.label ?? statusFilter };
  }, [estimates, statusFilter, t]);

  return (
    <StatCard label={label} value={value} subValue={subValue} icon={Calculator} accentColor={getAccentColor(typeId)} size={size} />
  );
}

function StatOpportunities({ typeId, size, config }: InnerStatProps) {
  const { t } = useDictionary("dashboard");
  const { data } = useOpportunities();
  const opportunities = data ?? [];
  const stageFilter = (config.stageFilter as string) ?? "all-active";
  const metric = (config.metric as string) ?? "count";

  const { value, subValue, label, prefix } = useMemo(() => {
    const active = opportunities.filter(
      (opp) => !opp.deletedAt && opp.stage !== OpportunityStage.Won && opp.stage !== OpportunityStage.Lost
    );

    if (stageFilter === "all-active") {
      if (metric === "value") {
        const total = active.reduce((sum, opp) => sum + (opp.estimatedValue ?? 0), 0);
        return { value: Math.round(total), subValue: t("stat.pipelineValue"), label: t("stat.pipelineValueLabel"), prefix: "$" };
      }
      return { value: active.length, subValue: t("stat.activeOpportunities"), label: t("stat.opportunities"), prefix: "" };
    }

    const stageMap: Record<string, OpportunityStage> = {
      new_lead: OpportunityStage.NewLead,
      contacted: OpportunityStage.Qualifying,
      qualified: OpportunityStage.Quoting,
      proposal_sent: OpportunityStage.Quoted,
      negotiation: OpportunityStage.Negotiation,
    };
    const stageLabels: Record<string, { label: string; valueSub: string; valueLabel: string }> = {
      new_lead: { label: t("stat.newLead"), valueSub: t("stat.newLeadValue"), valueLabel: t("stat.newLeadValueLabel") },
      contacted: { label: t("stat.contacted"), valueSub: t("stat.contactedValue"), valueLabel: t("stat.contactedValueLabel") },
      qualified: { label: t("stat.qualified"), valueSub: t("stat.qualifiedValue"), valueLabel: t("stat.qualifiedValueLabel") },
      proposal_sent: { label: t("stat.proposalSent"), valueSub: t("stat.proposalSentValue"), valueLabel: t("stat.proposalSentValueLabel") },
      negotiation: { label: t("stat.negotiation"), valueSub: t("stat.negotiationValue"), valueLabel: t("stat.negotiationValueLabel") },
    };
    const stage = stageMap[stageFilter];
    const filtered = opportunities.filter((opp) => !opp.deletedAt && opp.stage === stage);
    const labels = stageLabels[stageFilter];

    if (metric === "value") {
      const total = filtered.reduce((sum, opp) => sum + (opp.estimatedValue ?? 0), 0);
      return { value: Math.round(total), subValue: labels?.valueSub ?? stageFilter, label: labels?.valueLabel ?? stageFilter, prefix: "$" };
    }
    return { value: filtered.length, subValue: labels?.label ?? stageFilter, label: labels?.label ?? stageFilter, prefix: "" };
  }, [opportunities, stageFilter, metric, t]);

  return (
    <StatCard label={label} value={value} displayPrefix={prefix} subValue={subValue} icon={Target} accentColor={getAccentColor(typeId)} size={size} />
  );
}

// ---------------------------------------------------------------------------
// Profit MTD — revenue minus costs on paid invoices this month
// ---------------------------------------------------------------------------
function StatProfitMTD({ typeId, size }: SimpleStatProps) {
  const { t } = useDictionary("dashboard");
  const { data: invoicesData } = useInvoices();
  const { data: lineItemsData } = useInvoiceLineItems();

  const invoices = invoicesData ?? [];
  const lineItems = lineItemsData ?? [];

  const profit = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);

    // Paid invoices this month
    const paidThisMonth = invoices.filter(
      (inv) =>
        !inv.deletedAt &&
        inv.status === InvoiceStatus.Paid &&
        inv.paidAt &&
        new Date(inv.paidAt) >= monthStart
    );

    const paidIds = new Set(paidThisMonth.map((inv) => inv.id));
    const revenue = paidThisMonth.reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);

    const cost = lineItems
      .filter((li: LineItem) => li.invoiceId && paidIds.has(li.invoiceId))
      .reduce((sum, li: LineItem) => sum + ((li.unitCost ?? 0) * li.quantity), 0);

    return revenue - cost;
  }, [invoices, lineItems]);

  return (
    <StatCard
      label={t("stat.profitMtd")}
      value={Math.round(profit)}
      displayPrefix="$"
      subValue={t("stat.thisMonth")}
      icon={DollarSign}
      accentColor={getAccentColor(typeId)}
      size={size}
    />
  );
}

// ---------------------------------------------------------------------------
// Projected Profit — expected profit on open invoices
// ---------------------------------------------------------------------------
function StatProjectedProfit({ typeId, size }: SimpleStatProps) {
  const { t } = useDictionary("dashboard");
  const { data: invoicesData } = useInvoices();
  const { data: lineItemsData } = useInvoiceLineItems();

  const invoices = invoicesData ?? [];
  const lineItems = lineItemsData ?? [];

  const projectedProfit = useMemo(() => {
    // Open invoices (not Paid, Void, or WrittenOff)
    const openInvoices = invoices.filter(
      (inv) =>
        !inv.deletedAt &&
        inv.status !== InvoiceStatus.Paid &&
        inv.status !== InvoiceStatus.Void &&
        inv.status !== InvoiceStatus.WrittenOff
    );

    const openIds = new Set(openInvoices.map((inv) => inv.id));
    const revenue = openInvoices.reduce((sum, inv) => sum + (inv.total ?? 0), 0);

    const cost = lineItems
      .filter((li: LineItem) => li.invoiceId && openIds.has(li.invoiceId))
      .reduce((sum, li: LineItem) => sum + ((li.unitCost ?? 0) * li.quantity), 0);

    return revenue - cost;
  }, [invoices, lineItems]);

  return (
    <StatCard
      label={t("stat.projectedProfit")}
      value={Math.round(projectedProfit)}
      displayPrefix="$"
      subValue={t("stat.onOpenInvoices")}
      icon={DollarSign}
      accentColor={getAccentColor(typeId)}
      size={size}
    />
  );
}
