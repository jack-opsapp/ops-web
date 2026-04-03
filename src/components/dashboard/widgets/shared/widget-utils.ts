import { InvoiceStatus, EstimateStatus, OpportunityStage } from "@/lib/types/pipeline";
import { TaskStatus, ProjectStatus } from "@/lib/types/models";

// ── Currency Formatting ──────────────────────────────────────────────

/** Compact currency: $1.2M / $12.5K / $123 — used by hero numbers and chart labels */
export function formatCompactCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** Locale-aware currency: $12,345 or $12,345.00 — used by invoice/estimate list detail views */
export function formatLocaleCurrency(amount: number, locale = "en-US", decimals = 0): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

// ── Date Formatting ──────────────────────────────────────────────────

/** Compact date: "Today" / "Yesterday" / "3d ago" / "Mar 12" */
export function formatCompactDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor(
    (today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays <= 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Age formatting: "3d overdue" / "Due in 2w" */
export function formatAge(
  days: number,
  mode: "overdue" | "due",
  t?: (key: string) => string | undefined
): string {
  const overdueLabel = t?.("widgetAge.overdueShort") ?? "overdue";
  const dueInLabel = t?.("widgetAge.dueIn") ?? "Due in";
  const todayLabel = t?.("widgetAge.today") ?? "today";

  if (days === 0) return todayLabel;
  if (days < 7) {
    return mode === "overdue"
      ? `${days}d ${overdueLabel}`
      : `${dueInLabel} ${days}d`;
  }
  const weeks = Math.floor(days / 7);
  return mode === "overdue"
    ? `${weeks}w ${overdueLabel}`
    : `${dueInLabel} ${weeks}w`;
}

// ── Status Colors ────────────────────────────────────────────────────

type StatusColors = { text: string; bg: string; border: string };

const INVOICE_STATUS_COLORS: Record<string, StatusColors> = {
  [InvoiceStatus.Draft]: {
    text: "text-text-disabled",
    bg: "bg-text-disabled/15",
    border: "border-text-disabled/30",
  },
  [InvoiceStatus.Sent]: {
    text: "text-ops-accent",
    bg: "bg-ops-accent/15",
    border: "border-ops-accent/30",
  },
  [InvoiceStatus.AwaitingPayment]: {
    text: "text-ops-amber",
    bg: "bg-ops-amber/15",
    border: "border-ops-amber/30",
  },
  [InvoiceStatus.PartiallyPaid]: {
    text: "text-financial-receivables",
    bg: "bg-financial-receivables/15",
    border: "border-financial-receivables/30",
  },
  [InvoiceStatus.PastDue]: {
    text: "text-ops-error",
    bg: "bg-ops-error/15",
    border: "border-ops-error/30",
  },
  [InvoiceStatus.Paid]: {
    text: "text-status-success",
    bg: "bg-status-success/15",
    border: "border-status-success/30",
  },
  [InvoiceStatus.Void]: {
    text: "text-text-disabled",
    bg: "bg-text-disabled/15",
    border: "border-text-disabled/30",
  },
  [InvoiceStatus.WrittenOff]: {
    text: "text-text-disabled",
    bg: "bg-text-disabled/15",
    border: "border-text-disabled/30",
  },
};

const ESTIMATE_STATUS_COLORS: Record<string, StatusColors> = {
  [EstimateStatus.Draft]: {
    text: "text-text-disabled",
    bg: "bg-text-disabled/15",
    border: "border-text-disabled/30",
  },
  [EstimateStatus.Sent]: {
    text: "text-ops-accent",
    bg: "bg-ops-accent/15",
    border: "border-ops-accent/30",
  },
  [EstimateStatus.Viewed]: {
    text: "text-ops-amber",
    bg: "bg-ops-amber/15",
    border: "border-ops-amber/30",
  },
  [EstimateStatus.Approved]: {
    text: "text-status-success",
    bg: "bg-status-success/15",
    border: "border-status-success/30",
  },
  [EstimateStatus.ChangesRequested]: {
    text: "text-ops-amber",
    bg: "bg-ops-amber/15",
    border: "border-ops-amber/30",
  },
  [EstimateStatus.Declined]: {
    text: "text-ops-error",
    bg: "bg-ops-error/15",
    border: "border-ops-error/30",
  },
  [EstimateStatus.Expired]: {
    text: "text-text-disabled",
    bg: "bg-text-disabled/15",
    border: "border-text-disabled/30",
  },
  [EstimateStatus.Converted]: {
    text: "text-status-success",
    bg: "bg-status-success/15",
    border: "border-status-success/30",
  },
  [EstimateStatus.Superseded]: {
    text: "text-text-disabled",
    bg: "bg-text-disabled/15",
    border: "border-text-disabled/30",
  },
};

const TASK_STATUS_COLORS: Record<string, StatusColors> = {
  [TaskStatus.Booked]: {
    text: "text-status-accepted",
    bg: "bg-status-accepted/15",
    border: "border-status-accepted/30",
  },
  [TaskStatus.InProgress]: {
    text: "text-status-in-progress",
    bg: "bg-status-in-progress/15",
    border: "border-status-in-progress/30",
  },
  [TaskStatus.Completed]: {
    text: "text-status-success",
    bg: "bg-status-success/15",
    border: "border-status-success/30",
  },
  [TaskStatus.Cancelled]: {
    text: "text-ops-error",
    bg: "bg-ops-error/15",
    border: "border-ops-error/30",
  },
};

const PROJECT_STATUS_COLORS: Record<string, StatusColors> = {
  [ProjectStatus.RFQ]: {
    text: "text-status-rfq",
    bg: "bg-status-rfq/15",
    border: "border-status-rfq/30",
  },
  [ProjectStatus.Estimated]: {
    text: "text-status-estimated",
    bg: "bg-status-estimated/15",
    border: "border-status-estimated/30",
  },
  [ProjectStatus.Accepted]: {
    text: "text-status-accepted",
    bg: "bg-status-accepted/15",
    border: "border-status-accepted/30",
  },
  [ProjectStatus.InProgress]: {
    text: "text-status-in-progress",
    bg: "bg-status-in-progress/15",
    border: "border-status-in-progress/30",
  },
  [ProjectStatus.Completed]: {
    text: "text-status-completed",
    bg: "bg-status-completed/15",
    border: "border-status-completed/30",
  },
  [ProjectStatus.Closed]: {
    text: "text-status-closed",
    bg: "bg-status-closed/15",
    border: "border-status-closed/30",
  },
  [ProjectStatus.Archived]: {
    text: "text-status-archived",
    bg: "bg-status-archived/15",
    border: "border-status-archived/30",
  },
};

const OPPORTUNITY_STAGE_COLORS: Record<string, StatusColors> = {
  [OpportunityStage.NewLead]: {
    text: "text-ops-accent",
    bg: "bg-ops-accent/15",
    border: "border-ops-accent/30",
  },
  [OpportunityStage.Qualifying]: {
    text: "text-ops-accent",
    bg: "bg-ops-accent/15",
    border: "border-ops-accent/30",
  },
  [OpportunityStage.Quoting]: {
    text: "text-ops-amber",
    bg: "bg-ops-amber/15",
    border: "border-ops-amber/30",
  },
  [OpportunityStage.Quoted]: {
    text: "text-ops-amber",
    bg: "bg-ops-amber/15",
    border: "border-ops-amber/30",
  },
  [OpportunityStage.FollowUp]: {
    text: "text-financial-receivables",
    bg: "bg-financial-receivables/15",
    border: "border-financial-receivables/30",
  },
  [OpportunityStage.Negotiation]: {
    text: "text-financial-receivables",
    bg: "bg-financial-receivables/15",
    border: "border-financial-receivables/30",
  },
  [OpportunityStage.Won]: {
    text: "text-status-success",
    bg: "bg-status-success/15",
    border: "border-status-success/30",
  },
  [OpportunityStage.Lost]: {
    text: "text-ops-error",
    bg: "bg-ops-error/15",
    border: "border-ops-error/30",
  },
  [OpportunityStage.Discarded]: {
    text: "text-text-disabled",
    bg: "bg-text-disabled/15",
    border: "border-text-disabled/30",
  },
};

const DEFAULT_STATUS_COLORS: StatusColors = {
  text: "text-text-disabled",
  bg: "bg-text-disabled/15",
  border: "border-text-disabled/30",
};

const STATUS_MAP: Record<string, Record<string, StatusColors>> = {
  invoice: INVOICE_STATUS_COLORS,
  estimate: ESTIMATE_STATUS_COLORS,
  task: TASK_STATUS_COLORS,
  project: PROJECT_STATUS_COLORS,
  opportunity: OPPORTUNITY_STAGE_COLORS,
};

/** Get Tailwind class triplet for a status value */
export function getStatusColor(
  status: string,
  entity: "invoice" | "estimate" | "task" | "project" | "opportunity"
): StatusColors {
  return STATUS_MAP[entity]?.[status] ?? DEFAULT_STATUS_COLORS;
}

/** Get human-readable label for a status — uses i18n with fallback to title case */
export function getStatusLabel(
  status: string,
  entity: string,
  t?: (key: string) => string | undefined
): string {
  const key = `widgetStatus.${entity}.${status}`;
  const translated = t?.(key);
  if (translated && translated !== key) return translated;
  // Fallback: convert snake_case / camelCase / "In Progress" to Title Case
  return status
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
