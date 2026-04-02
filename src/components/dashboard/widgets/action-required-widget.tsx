"use client";

import { useMemo, useRef } from "react";
import { CheckSquare, FileText, FileSpreadsheet, Phone, Check, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import type { ProjectTask } from "@/lib/types/models";
import { TaskStatus } from "@/lib/types/models";
import type { Invoice, Estimate, Opportunity } from "@/lib/types/pipeline";
import { InvoiceStatus, EstimateStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ActionItem {
  id: string;
  type: "overdue-task" | "past-due-invoice" | "expiring-estimate" | "stale-follow-up";
  priority: number;
  description: string;
  age: string;
  amount?: number;
  navigateTo: string;
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
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatAge(days: number, prefix: "overdue" | "due", t: (key: string) => string | undefined): string {
  if (days === 0) return t("actionRequired.today") ?? "today";
  const overdueLabel = t("actionRequired.overdueShort") ?? "overdue";
  const dueInLabel = t("actionRequired.dueIn") ?? "Due in";
  if (days < 7) return prefix === "overdue" ? `${days}d ${overdueLabel}` : `${dueInLabel} ${days}d`;
  const weeks = Math.floor(days / 7);
  return prefix === "overdue" ? `${weeks}w ${overdueLabel}` : `${dueInLabel} ${weeks}w`;
}

function formatCurrency(amount: number): string {
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
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
  isLoading,
  onNavigate,
}: ActionRequiredWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const compact = isCompact(size);

  const reducedMotion = useReducedMotion() ?? false;

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
      result.push({
        id: `task-${task.id}`,
        type: "overdue-task",
        priority: 2,
        description: task.customTitle || task.taskType?.display || "Task",
        age: formatAge(days, "overdue", t),
        navigateTo: `/projects/${task.projectId}`,
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
      result.push({
        id: `invoice-${inv.id}`,
        type: "past-due-invoice",
        priority,
        description: `#${inv.invoiceNumber}${inv.client?.name ? ` — ${inv.client.name}` : ""}`,
        age: formatAge(days, "overdue", t),
        amount: inv.balanceDue,
        navigateTo: `/invoices/${inv.id}`,
      });
    }

    // Expiring estimates (within 7 days, status Sent or Viewed)
    const expiringStatuses = new Set([EstimateStatus.Sent, EstimateStatus.Viewed]);
    for (const est of estimates) {
      if (est.deletedAt) continue;
      if (!expiringStatuses.has(est.status)) continue;
      if (!est.expirationDate) continue;
      const exp = new Date(est.expirationDate);
      const expDay = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());
      if (expDay > weekAhead || expDay < today) continue;
      const daysUntil = daysBetween(today, expDay);
      result.push({
        id: `estimate-${est.id}`,
        type: "expiring-estimate",
        priority: 4,
        description: `#${est.estimateNumber}${est.client?.name ? ` — ${est.client.name}` : ""}`,
        age: daysUntil === 0
          ? (t("actionRequired.expiresToday") ?? "Expires today")
          : `${t("actionRequired.expiresIn") ?? "Expires in"} ${daysUntil}d`,
        amount: est.total,
        navigateTo: `/estimates/${est.id}`,
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
      result.push({
        id: `followup-${opp.id}`,
        type: "stale-follow-up",
        priority: 5,
        description: opp.title || "Follow-up",
        age: formatAge(days, "overdue", t),
        amount: opp.estimatedValue ?? undefined,
        navigateTo: `/pipeline/${opp.id}`,
      });
    }

    return result.sort((a, b) => a.priority - b.priority);
  }, [tasks, invoices, estimates, opportunities, t]);

  // ── Category counts (for SM dots) ─────────────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  // ── Grouped items (LG only) ───────────────────────────────────────────
  const grouped = useMemo(() => {
    if (!showActions(size)) return null;
    const groups = new Map<string, ActionItem[]>();
    for (const item of items) {
      if (!groups.has(item.type)) groups.set(item.type, []);
      groups.get(item.type)!.push(item);
    }
    const result: { type: string; items: ActionItem[] }[] = [];
    for (const [type, groupItems] of groups) {
      const limit = type === "stale-follow-up" ? 2 : 3;
      result.push({ type, items: groupItems.slice(0, limit) });
    }
    return result;
  }, [items, size]);

  const totalColor = items.length > 5 ? WT.error : items.length > 0 ? WT.warning : WT.success;

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("actionRequired.title") ?? "Action Required"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="list" />
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("actionRequired.title") ?? "Action Required"}
          </span>
          <div className="flex-1 flex items-center gap-2">
            <Check className="w-4 h-4 text-status-success" />
            <span className="font-mohave text-caption-sm text-status-success">
              {t("actionRequired.allClear") ?? "All clear — no items need attention"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
              {t("actionRequired.viewAll") ?? "View All"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── XS: Header + Hero (count, colored by severity) ────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full cursor-pointer" onClick={() => items.length > 0 && onNavigate(items[0].navigateTo)}>
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span
            className="font-mono text-display font-bold leading-none"
            style={{ color: totalColor }}
          >
            {items.length}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("actionRequired.title") ?? "Action Required"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + category dots ────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none" style={{ color: totalColor }}>
              {items.length}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); if (items.length > 0) onNavigate(items[0].navigateTo); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("actionRequired.title") ?? "Action Required"}
          </span>
          {/* Row 3: Category dots */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {Object.entries(categoryCounts).map(([type, count]) => {
              const config = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];
              return (
                <div key={type} className="flex items-center gap-1">
                  <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: config.color }} />
                  <span className="font-mono text-micro-sm text-text-tertiary">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    );
  }

  // ── MD / LG ───────────────────────────────────────────────────────────
  const maxItems = showActions(size) ? undefined : 5;
  const displayItems = maxItems ? items.slice(0, maxItems) : items;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("actionRequired.title") ?? "Action Required"}
          </span>
          <span
            className="font-mono text-micro-sm px-1.5 py-0.5 rounded-sm"
            style={{ backgroundColor: `${totalColor}20`, color: totalColor }}
          >
            {items.length}
          </span>
        </div>

        {/* Detail zone — scrollable */}
        <ScrollFade>
          {showActions(size) && grouped ? (
            // LG: Grouped layout with inline actions
            <div className="flex flex-col gap-2">
              {grouped.map((group) => {
                const config = TYPE_CONFIG[group.type as keyof typeof TYPE_CONFIG];
                return (
                  <div key={group.type}>
                    <div className="flex items-center gap-1 mb-1">
                      <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: config.color }} />
                      <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                        {t(config.labelKey) ?? group.type} ({categoryCounts[group.type]})
                      </span>
                    </div>
                    {group.items.map((item, i) => (
                      <ActionRow
                        key={item.id}
                        item={item}
                        index={i}
                        isVisible={isVisible}
                        reducedMotion={reducedMotion}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            // MD: Flat priority list
            <div className="flex flex-col">
              {displayItems.map((item, i) => (
                <ActionRow
                  key={item.id}
                  item={item}
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                  onNavigate={onNavigate}
                />
              ))}
              {maxItems && items.length > maxItems && (
                <span className="font-kosugi text-micro-sm text-text-disabled mt-1">
                  +{items.length - maxItems} more
                </span>
              )}
            </div>
          )}
        </ScrollFade>

        {/* Footer */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/calendar")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("actionRequired.viewAll") ?? "View All"}
          </button>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Action Row
// ---------------------------------------------------------------------------
function ActionRow({
  item,
  index,
  isVisible,
  reducedMotion,
  onNavigate,
}: {
  item: ActionItem;
  index: number;
  isVisible: boolean;
  reducedMotion: boolean;
  onNavigate: (path: string) => void;
}) {
  const config = TYPE_CONFIG[item.type];
  const Icon = config.icon;

  return (
    <div
      className="flex items-center gap-2 py-1 px-1 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(4px)",
        transition: reducedMotion
          ? "opacity 200ms ease"
          : `opacity 300ms ease ${index * 50}ms, transform 300ms ease ${index * 50}ms`,
      }}
      onClick={() => onNavigate(item.navigateTo)}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: config.color }} />
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-caption-sm text-text-primary truncate">{item.description}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {item.amount !== undefined && (
          <span className="font-mono text-micro-sm text-text-secondary">{formatCurrency(item.amount)}</span>
        )}
        <span className="font-mono text-micro-sm text-text-tertiary whitespace-nowrap">{item.age}</span>
      </div>
    </div>
  );
}
