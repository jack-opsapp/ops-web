"use client";

import { useMemo, useRef } from "react";
import {
  CheckSquare, FileText, FileSpreadsheet, Phone, Check,
  CalendarDays, Mail, ArrowUpRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetInlineAction } from "./shared/widget-inline-action";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { WidgetTitle } from "./shared/widget-title";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { ScrollFade } from "./shared/scroll-fade";
import { formatCompactCurrency } from "./shared/widget-utils";
import type { ProjectTask, Project, Client } from "@/lib/types/models";
import { TaskStatus } from "@/lib/types/models";
import type { Invoice, Estimate, Opportunity } from "@/lib/types/pipeline";
import { InvoiceStatus, EstimateStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WT, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
import { useDictionary } from "@/i18n/client";
import { useWindowStore } from "@/stores/window-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ActionItem {
  id: string;
  type: "overdue-task" | "past-due-invoice" | "expiring-estimate" | "stale-follow-up";
  priority: number;
  description: string;
  reason: string;
  age: string;
  amount?: number;
  navigateTo: string;
  /** Present on overdue-task items so the click can open the floating project
   *  workspace window instead of full-page navigating. */
  projectId?: string;
}

const TYPE_CONFIG = {
  "overdue-task": { icon: CheckSquare, color: WT.error, labelKey: "actionRequired.groupOverdueTasks" },
  "past-due-invoice": { icon: FileText, color: WT.receivables, labelKey: "actionRequired.groupPastDueInvoices" },
  "expiring-estimate": { icon: FileSpreadsheet, color: WT.warning, labelKey: "actionRequired.groupExpiringEstimates" },
  "stale-follow-up": { icon: Phone, color: WT.accent, labelKey: "actionRequired.groupStaleFollowUps" },
} as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ActionRequiredWidgetProps {
  size: WidgetSize;
  tasks: ProjectTask[];
  invoices: Invoice[];
  opportunities: Opportunity[];
  estimates: Estimate[];
  projects?: Project[];
  clients?: Client[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatAgeDays(days: number, prefix: "overdue" | "due", t: (key: string) => string | undefined): string {
  if (days === 0) return t("actionRequired.today") ?? "today";
  const overdueLabel = t("actionRequired.overdueShort") ?? "overdue";
  const dueInLabel = t("actionRequired.dueIn") ?? "Due in";
  if (days < 7) return prefix === "overdue" ? `${days}d ${overdueLabel}` : `${dueInLabel} ${days}d`;
  const weeks = Math.floor(days / 7);
  return prefix === "overdue" ? `${weeks}w ${overdueLabel}` : `${dueInLabel} ${weeks}w`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ActionRequiredWidget({
  size,
  tasks,
  invoices,
  opportunities,
  estimates,
  projects = [],
  clients = [],
  isLoading,
  onNavigate,
}: ActionRequiredWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);

  // Route a click to the floating project workspace window when the item is an
  // overdue task tied to a project; otherwise honor the generic navigateTo.
  const handleItemNavigate = (item: ActionItem) => {
    if (item.type === "overdue-task" && item.projectId) {
      openProjectWindow({ projectId: item.projectId, mode: "viewing" });
      return;
    }
    onNavigate(item.navigateTo);
  };

  // Build lookup maps
  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);
  const clientMap = useMemo(() => {
    const map = new Map<string, Client>();
    for (const c of clients) map.set(c.id, c);
    return map;
  }, [clients]);

  // ── Build action items ────────────────────────────────────────────────
  const items = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAhead = new Date(today);
    weekAhead.setDate(weekAhead.getDate() + 7);
    const result: ActionItem[] = [];

    // Overdue tasks
    for (const task of tasks) {
      if (task.deletedAt) continue;
      if (task.status === TaskStatus.Completed || task.status === TaskStatus.Cancelled) continue;
      const start = task.startDate ? new Date(task.startDate) : null;
      if (!start) continue;
      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      if (startDay >= today) continue;
      const days = daysBetween(startDay, today);
      const hasStartDate = !!task.startDate;
      const reasonKey = hasStartDate ? "actionRequired.pastStartDate" : "actionRequired.unscheduled";
      const proj = task.projectId ? projectMap.get(task.projectId) : null;
      const cli = proj?.clientId ? clientMap.get(proj.clientId) : null;
      const clientName = cli?.name ?? task.project?.client?.name;
      const projectName = proj?.title ?? task.project?.title;
      const contextParts = [projectName, clientName].filter(Boolean);
      const contextStr = contextParts.length > 0 ? `${contextParts.join(" · ")} · ` : "";
      result.push({
        id: `task-${task.id}`,
        type: "overdue-task",
        priority: 2,
        description: task.customTitle || task.taskType?.display || t("actionRequired.taskFallback"),
        reason: `${contextStr}${t(reasonKey) ?? "Past start date"}, ${days}d ${t("actionRequired.overdueShort") ?? "overdue"}`,
        age: formatAgeDays(days, "overdue", t),
        navigateTo: `/projects/${task.projectId}`,
        projectId: task.projectId,
      });
    }

    // Past-due invoices
    const excludeStatuses = new Set([InvoiceStatus.Paid, InvoiceStatus.Void, InvoiceStatus.WrittenOff, InvoiceStatus.Draft]);
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (excludeStatuses.has(inv.status)) continue;
      const due = new Date(inv.dueDate);
      const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      if (dueDay >= today) continue;
      const days = daysBetween(dueDay, today);
      let priority: number;
      if (days > 90) priority = 1;
      else if (days >= 30) priority = 3;
      else priority = 6;
      const isPartial = inv.status === InvoiceStatus.PartiallyPaid;
      const reasonLabel = isPartial
        ? (t("actionRequired.partiallyPaid") ?? "Partially paid")
        : (t("actionRequired.unpaid") ?? "Unpaid");
      result.push({
        id: `invoice-${inv.id}`,
        type: "past-due-invoice",
        priority,
        description: `#${inv.invoiceNumber}${inv.client?.name ? ` — ${inv.client.name}` : ""}`,
        reason: `${reasonLabel}, ${days}d ${t("actionRequired.pastDue") ?? "past due"}`,
        age: formatAgeDays(days, "overdue", t),
        amount: inv.balanceDue,
        navigateTo: "/books?segment=invoices",
      });
    }

    // Expiring estimates
    const expiringStatuses = new Set([EstimateStatus.Sent, EstimateStatus.Viewed]);
    for (const est of estimates) {
      if (est.deletedAt) continue;
      if (!expiringStatuses.has(est.status)) continue;
      if (!est.expirationDate) continue;
      const exp = new Date(est.expirationDate);
      const expDay = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());
      if (expDay > weekAhead || expDay < today) continue;
      const daysUntil = daysBetween(today, expDay);
      const isViewed = est.status === EstimateStatus.Viewed;
      const reasonLabel = isViewed
        ? (t("actionRequired.viewedUnsigned") ?? "Viewed but unsigned")
        : (t("actionRequired.noResponse") ?? "No response");
      const expiresText = daysUntil === 0
        ? (t("actionRequired.expiresToday") ?? "Expires today")
        : `${t("actionRequired.expiresIn") ?? "expires in"} ${daysUntil}d`;
      result.push({
        id: `estimate-${est.id}`,
        type: "expiring-estimate",
        priority: 4,
        description: `#${est.estimateNumber}${est.client?.name ? ` — ${est.client.name}` : ""}`,
        reason: `${reasonLabel}, ${expiresText}`,
        age: expiresText,
        amount: est.total,
        navigateTo: "/books?segment=estimates",
      });
    }

    // Stale follow-ups
    for (const opp of opportunities) {
      if (opp.deletedAt) continue;
      if (!opp.nextFollowUpAt) continue;
      const followUp = new Date(opp.nextFollowUpAt);
      const followUpDay = new Date(followUp.getFullYear(), followUp.getMonth(), followUp.getDate());
      if (followUpDay >= today) continue;
      const days = daysBetween(followUpDay, today);
      const lastActivity = opp.lastActivityAt ? new Date(opp.lastActivityAt) : null;
      let reason: string;
      if (lastActivity) {
        const activityDays = daysBetween(lastActivity, now);
        const activityWeeks = Math.floor(activityDays / 7);
        reason = activityWeeks > 0
          ? `${t("actionRequired.lastContact") ?? "Last contact"} ${activityWeeks}w ago`
          : `${t("actionRequired.lastContact") ?? "Last contact"} ${activityDays}d ago`;
      } else {
        reason = t("actionRequired.noContact") ?? "No contact recorded";
      }
      result.push({
        id: `followup-${opp.id}`,
        type: "stale-follow-up",
        priority: 5,
        description: opp.title || t("actionRequired.followUpFallback"),
        reason,
        age: formatAgeDays(days, "overdue", t),
        amount: opp.estimatedValue ?? undefined,
        navigateTo: "/pipeline",
      });
    }

    return result.sort((a, b) => a.priority - b.priority);
  }, [tasks, invoices, estimates, opportunities, t]);

  // ── Category counts ───────────────────────────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  const totalColor = items.length > 5 ? WT.error : items.length > 0 ? WT.warning : WT.success;

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <WidgetTitle>
            {t("actionRequired.title") ?? "Action Required"}
          </WidgetTitle>
          <WidgetSkeleton variant="list" />
        </div>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <WidgetTitle>
            {t("actionRequired.title") ?? "Action Required"}
          </WidgetTitle>
          <WidgetEmptyState
            icon={Check}
            message={t("actionRequired.allClear") ?? "All clear — no items need attention"}
            className="flex-1"
          />
        </div>
      </Card>
    );
  }

  // ── XS: Popover with action items ─────────────────────────────────────
  if (size === "xs") {
    const previewItems = items.slice(0, 5);
    return (
      <Card className="h-full" ref={ref}>
        <div className="h-full flex flex-col pt-3">
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-left cursor-pointer">
                <span
                  className="font-mono text-display font-bold leading-none block text-text"
                >
                  {items.length}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" collisionPadding={8} className="w-auto p-1 min-w-[200px] max-w-[280px]">
              <div className="flex flex-col">
                {previewItems.map((item) => {
                  const config = TYPE_CONFIG[item.type];
                  const Icon = config.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleItemNavigate(item)}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-surface-hover transition-colors rounded-sm text-left"
                    >
                      <Icon className="w-[14px] h-[14px] shrink-0" style={{ color: config.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="font-mohave text-caption-sm text-text truncate">{item.description}</p>
                        <span className="font-mono text-micro text-text-3">{item.age}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          <WidgetTitle className="mt-1">
            {t("actionRequired.title") ?? "Action Required"}
          </WidgetTitle>
          <WidgetTrendContext
            variant="health"
            color={items.length > 0 ? WT.error : WT.success}
            label={items.length > 0 ? (t("trend.needsAction") ?? "Needs Action") : (t("trend.allClear") ?? "All Clear")}
          />
        </div>
      </Card>
    );
  }

  // ── SM: Clickable category dots with popovers ─────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text">
              {items.length}
            </span>
            <button
              onClick={() => onNavigate("/schedule")}
              className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          {/* Row 2: Title */}
          <WidgetTitle className="mt-1">
            {t("actionRequired.title") ?? "Action Required"}
          </WidgetTitle>
          {/* Row 3: Health indicator */}
          <WidgetTrendContext
            variant="health"
            color={items.length > 0 ? WT.error : WT.success}
            label={items.length > 0 ? (t("trend.needsAction") ?? "Needs Action") : (t("trend.allClear") ?? "All Clear")}
          />
          {/* Row 4: Clickable category dots */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {Object.entries(categoryCounts).map(([type, count]) => {
              const config = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];
              const categoryItems = items.filter((item) => item.type === type);
              return (
                <Popover key={type}>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity">
                      <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: config.color }} />
                      <span className="font-mono text-micro text-text-3">{count}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" side="bottom" collisionPadding={8} className="w-auto p-1 min-w-[200px] max-w-[280px]">
                    <div className="px-2 py-1 border-b border-border-subtle mb-1">
                      <span className="font-mono text-micro text-text-mute uppercase">
                        {t(config.labelKey) ?? type}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      {categoryItems.slice(0, 6).map((item) => (
                        <button
                          key={item.id}
                          onClick={() => handleItemNavigate(item)}
                          className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-surface-hover transition-colors rounded-sm text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-mohave text-caption-sm text-text truncate">{item.description}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {item.amount !== undefined && (
                              <span className="font-mono text-micro text-text-2">{formatCompactCurrency(item.amount)}</span>
                            )}
                            <span className="font-mono text-micro text-text-3 whitespace-nowrap">{item.age}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        </div>
      </Card>
    );
  }

  // ── MD / LG ───────────────────────────────────────────────────────────
  const isLg = showActions(size);

  // Build inline actions per item type
  const getInlineActions = (item: ActionItem) => {
    if (!showDetail(size)) return undefined;

    switch (item.type) {
      case "overdue-task":
        return (
          <WidgetInlineAction
            icon={CalendarDays}
            actions={[
              { icon: CalendarDays, label: t("actionRequired.openScheduler") ?? "Open Scheduler", onAction: () => onNavigate("/schedule") },
              { icon: Check, label: t("actionRequired.markComplete") ?? "Mark Complete", onAction: () => handleItemNavigate(item) },
            ]}
          />
        );
      case "past-due-invoice":
        return (
          <WidgetInlineAction
            icon={Mail}
            actions={[
              { icon: Mail, label: t("actionRequired.sendReminder") ?? "Send Reminder", onAction: () => onNavigate(item.navigateTo) },
              { icon: FileText, label: t("actionRequired.viewInvoice") ?? "View Invoice", onAction: () => onNavigate(item.navigateTo) },
            ]}
          />
        );
      case "expiring-estimate":
        return (
          <WidgetInlineAction
            icon={Phone}
            actions={[
              { icon: Phone, label: t("actionRequired.followUp") ?? "Follow Up", onAction: () => onNavigate(item.navigateTo) },
              { icon: FileSpreadsheet, label: t("actionRequired.viewEstimate") ?? "View Estimate", onAction: () => onNavigate(item.navigateTo) },
            ]}
          />
        );
      case "stale-follow-up":
        return (
          <WidgetInlineAction
            icon={Phone}
            actions={[
              { icon: Phone, label: t("actionRequired.followUp") ?? "Follow Up", onAction: () => onNavigate(item.navigateTo) },
              { icon: ArrowUpRight, label: t("actionRequired.viewLead") ?? "View Lead", onAction: () => onNavigate(item.navigateTo) },
            ]}
          />
        );
    }
  };

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <WidgetTitle>
            {t("actionRequired.title") ?? "Action Required"}
          </WidgetTitle>
          <span
            className="font-mono text-micro px-1.5 py-0.5 rounded-sm"
            style={{ backgroundColor: `${totalColor}20`, color: totalColor }}
          >
            {items.length}
          </span>
        </div>

        {/* LG: Hero category counts (collapsible) */}
        {isLg && (
          <WidgetHeroCollapse collapsed={false} collapsedHeight="0px" expandedHeight="80px" className="mb-2">
            <div className="grid grid-cols-4 gap-2 pb-2 border-b border-border-subtle">
              {(Object.entries(TYPE_CONFIG) as [keyof typeof TYPE_CONFIG, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([type, config]) => {
                const count = categoryCounts[type] ?? 0;
                return (
                  <div key={type} className="flex flex-col items-center py-1">
                    <config.icon className="w-3.5 h-3.5 mb-0.5" style={{ color: config.color }} />
                    <span className="font-mono text-data-sm font-bold" style={{ color: count > 0 ? config.color : "var(--text-disabled)" }}>
                      {count}
                    </span>
                    <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em] text-center leading-tight">
                      {t(config.labelKey) ?? type}
                    </span>
                  </div>
                );
              })}
            </div>
          </WidgetHeroCollapse>
        )}

        {/* Detail zone — scrollable */}
        <ScrollFade>
          <div className="flex flex-col">
            {items.map((item, i) => {
              const config = TYPE_CONFIG[item.type];
              return (
                <WidgetLineItem
                  key={item.id}
                  indicator={{ type: "icon", icon: config.icon, color: config.color }}
                  primary={item.description}
                  secondary={showDetail(size) ? item.reason : undefined}
                  metric={
                    <div className="flex items-center gap-1">
                      {item.amount !== undefined && (
                        <span className="font-mono text-micro text-text-2">{formatCompactCurrency(item.amount)}</span>
                      )}
                      {!showDetail(size) && (
                        <span className="font-mono text-micro text-text-3 whitespace-nowrap">{item.age}</span>
                      )}
                    </div>
                  }
                  action={getInlineActions(item)}
                  onClick={() => handleItemNavigate(item)}
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                />
              );
            })}
          </div>
        </ScrollFade>

      </div>
    </Card>
  );
}
