"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  CalendarDays,
  FileText,
  Send,
  ExternalLink,
  CheckCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetInlineAction } from "./shared/widget-inline-action";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { useScrollFadeScroll } from "./shared/use-scroll-fade-scroll";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WT, isCompact, showActions } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { TaskStatus } from "@/lib/types/models";
import {
  InvoiceStatus,
  EstimateStatus,
  OpportunityStage,
} from "@/lib/types/pipeline";
import {
  useClients,
  useInvoices,
  useEstimates,
  useTasks,
  useOpportunities,
  useProjects,
} from "@/lib/hooks";
import { useWidgetActionQueue } from "@/stores/widget-action-queue";
import { useWidgetEntityOpen } from "./shared/use-widget-entity-open";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ClientAttentionWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AttentionReason =
  | "unassigned-tasks"
  | "unscheduled-tasks"
  | "stale-quoting"
  | "estimate-no-response"
  | "past-due-invoice"
  | "estimate-expiring";

interface AttentionItem {
  clientId: string;
  clientName: string;
  reason: AttentionReason;
  detail: string;
  entityId: string;
  secondaryEntityId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REASON_PRIORITY: Record<AttentionReason, number> = {
  "past-due-invoice": 0,
  "unassigned-tasks": 1,
  "unscheduled-tasks": 2,
  "stale-quoting": 3,
  "estimate-no-response": 4,
  "estimate-expiring": 5,
};

const REASON_COLORS: Record<AttentionReason, string> = {
  "past-due-invoice": WT.error,
  "unassigned-tasks": WT.warning,
  "unscheduled-tasks": WT.warning,
  "stale-quoting": WT.accent,
  "estimate-no-response": WT.accent,
  "estimate-expiring": WT.warning,
};

const REASON_ICONS: Record<AttentionReason, typeof Users> = {
  "unassigned-tasks": Users,
  "unscheduled-tasks": CalendarDays,
  "stale-quoting": FileText,
  "estimate-no-response": Send,
  "past-due-invoice": ExternalLink,
  "estimate-expiring": ExternalLink,
};

const REASON_LABELS: Record<AttentionReason, string> = {
  "past-due-invoice": "Past Due",
  "unassigned-tasks": "Unassigned",
  "unscheduled-tasks": "Unscheduled",
  "stale-quoting": "Stale Quote",
  "estimate-no-response": "No Response",
  "estimate-expiring": "Expiring",
};

// ---------------------------------------------------------------------------
// SVG Ring Chart (SM)
// ---------------------------------------------------------------------------
function AttentionRing({
  segments,
  isVisible,
  reducedMotion,
}: {
  segments: { count: number; color: string }[];
  isVisible: boolean;
  reducedMotion: boolean | null;
}) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) return null;

  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0">
      {segments
        .filter((s) => s.count > 0)
        .map((seg, i) => {
          const segLen = (seg.count / total) * circumference;
          const currentOffset = offset;
          offset += segLen;

          return (
            <circle
              key={i}
              cx="28"
              cy="28"
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth="5"
              strokeDasharray={`${segLen} ${circumference - segLen}`}
              strokeDashoffset={-currentOffset}
              strokeLinecap="round"
              style={{
                opacity: isVisible ? 1 : 0,
                transition:
                  reducedMotion
                    ? "opacity 150ms ease"
                    : `opacity 500ms ${WIDGET_EASE_CSS}, stroke-dashoffset 500ms ${WIDGET_EASE_CSS}`,
              }}
              transform="rotate(-90 28 28)"
            />
          );
        })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ClientAttentionWidget({ size }: ClientAttentionWidgetProps) {
  const { t } = useDictionary("dashboard");
  const router = useRouter();
  const navigate = useCallback((path: string) => router.push(path), [router]);
  const openEntity = useWidgetEntityOpen();
  const queueAction = useWidgetActionQueue((s) => s.queueAction);

  const ref = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const [expanded, setExpanded] = useState(false);
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: invoicesData, isLoading: invoicesLoading } = useInvoices();
  const { data: estimatesData, isLoading: estimatesLoading } = useEstimates();
  const { data: tasksData, isLoading: tasksLoading } = useTasks();
  const { data: opportunitiesData, isLoading: oppsLoading } = useOpportunities();
  const { data: projectsData, isLoading: projectsLoading } = useProjects();

  const isLoading =
    clientsLoading || invoicesLoading || estimatesLoading ||
    tasksLoading || oppsLoading || projectsLoading;

  // Hero collapse via scroll listener
  const handleScrollTop = useCallback((scrollTop: number) => {
    setHeroCollapsed(scrollTop > 20);
  }, []);

  useScrollFadeScroll(scrollContainerRef, showActions(size), handleScrollTop);

  // ── Attention items ────────────────────────────────────────────────────
  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = [];
    const now = new Date();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // Build lookups
    const clientNameMap: Record<string, string> = {};
    if (clientsData?.clients) {
      for (const c of clientsData.clients) {
        if (!c.deletedAt) clientNameMap[c.id] = c.name;
      }
    }

    const projectClientMap: Record<string, string> = {};
    if (projectsData?.projects) {
      for (const p of projectsData.projects) {
        if (!p.deletedAt && p.clientId) {
          projectClientMap[p.id] = p.clientId;
        }
      }
    }

    // Track which opportunityIds have a sent estimate
    const oppHasSentEstimate = new Set<string>();
    const estimates = Array.isArray(estimatesData) ? estimatesData : [];
    for (const est of estimates) {
      if (est.deletedAt) continue;
      if (est.opportunityId && est.sentAt) {
        oppHasSentEstimate.add(est.opportunityId);
      }
    }

    // 1. Unassigned tasks — group by client
    const unassignedByClient: Record<string, { count: number; projectId: string }> = {};
    const unscheduledByClient: Record<string, { count: number; projectId: string }> = {};

    const tasks = tasksData?.tasks ?? [];
    for (const task of tasks) {
      if (task.deletedAt) continue;
      if (task.status === TaskStatus.Completed || task.status === TaskStatus.Cancelled) continue;

      const clientId = projectClientMap[task.projectId];
      if (!clientId || !clientNameMap[clientId]) continue;

      if (task.teamMemberIds.length === 0) {
        if (!unassignedByClient[clientId]) {
          unassignedByClient[clientId] = { count: 0, projectId: task.projectId };
        }
        unassignedByClient[clientId].count++;
      }

      if (task.startDate === null) {
        if (!unscheduledByClient[clientId]) {
          unscheduledByClient[clientId] = { count: 0, projectId: task.projectId };
        }
        unscheduledByClient[clientId].count++;
      }
    }

    for (const [clientId, data] of Object.entries(unassignedByClient)) {
      items.push({
        clientId,
        clientName: clientNameMap[clientId],
        reason: "unassigned-tasks",
        detail: (t("clientAttention.unassignedTasks") ?? "{count} unassigned tasks").replace("{count}", String(data.count)),
        entityId: data.projectId,
      });
    }

    for (const [clientId, data] of Object.entries(unscheduledByClient)) {
      items.push({
        clientId,
        clientName: clientNameMap[clientId],
        reason: "unscheduled-tasks",
        detail: (t("clientAttention.unscheduledTasks") ?? "{count} unscheduled tasks").replace("{count}", String(data.count)),
        entityId: data.projectId,
      });
    }

    // 3. Stale quoting
    const opportunities = Array.isArray(opportunitiesData) ? opportunitiesData : [];
    for (const opp of opportunities) {
      if (!opp.clientId || !clientNameMap[opp.clientId]) continue;
      if (opp.stage !== OpportunityStage.Quoting) continue;

      const stageAge = now.getTime() - new Date(opp.stageEnteredAt).getTime();
      if (stageAge <= twoDaysMs) continue;
      if (oppHasSentEstimate.has(opp.id)) continue;

      const days = Math.floor(stageAge / (24 * 60 * 60 * 1000));
      items.push({
        clientId: opp.clientId,
        clientName: clientNameMap[opp.clientId],
        reason: "stale-quoting",
        detail: (t("clientAttention.staleQuoting") ?? "In Quoting {days}d — no estimate sent").replace("{days}", String(days)),
        entityId: opp.id,
      });
    }

    // 4. Estimate no response
    for (const est of estimates) {
      if (est.deletedAt) continue;
      if (est.status !== EstimateStatus.Sent && est.status !== EstimateStatus.Viewed) continue;
      if (!est.sentAt) continue;
      if (!clientNameMap[est.clientId]) continue;

      const sentAge = now.getTime() - new Date(est.sentAt).getTime();
      if (sentAge <= threeDaysMs) continue;

      const days = Math.floor(sentAge / (24 * 60 * 60 * 1000));
      const statusLabel = est.status === EstimateStatus.Sent ? "sent" : "viewed";
      items.push({
        clientId: est.clientId,
        clientName: clientNameMap[est.clientId],
        reason: "estimate-no-response",
        detail: (t("clientAttention.estimateNoResponse") ?? "Estimate {number} — {status} {days}d, no response")
          .replace("{number}", est.estimateNumber)
          .replace("{status}", statusLabel)
          .replace("{days}", String(days)),
        entityId: est.id,
        secondaryEntityId: est.opportunityId ?? undefined,
      });
    }

    // 5. Past-due invoices — group by client
    const pastDueByClient: Record<string, { count: number; invoiceId: string }> = {};
    const invoices = Array.isArray(invoicesData) ? invoicesData : [];
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (inv.status !== InvoiceStatus.PastDue) continue;
      if (!clientNameMap[inv.clientId]) continue;

      if (!pastDueByClient[inv.clientId]) {
        pastDueByClient[inv.clientId] = { count: 0, invoiceId: inv.id };
      }
      pastDueByClient[inv.clientId].count++;
    }

    for (const [clientId, data] of Object.entries(pastDueByClient)) {
      items.push({
        clientId,
        clientName: clientNameMap[clientId],
        reason: "past-due-invoice",
        detail: t("clientAttention.pastDueInvoice") ?? "Past Due Invoice",
        entityId: data.invoiceId,
      });
    }

    // 6. Expiring estimates
    for (const est of estimates) {
      if (est.deletedAt) continue;
      if (
        est.status === EstimateStatus.Approved ||
        est.status === EstimateStatus.Converted ||
        est.status === EstimateStatus.Declined ||
        est.status === EstimateStatus.Expired ||
        est.status === EstimateStatus.Superseded
      ) continue;
      if (!est.expirationDate) continue;
      if (!clientNameMap[est.clientId]) continue;

      const expDate = typeof est.expirationDate === "string"
        ? new Date(est.expirationDate)
        : est.expirationDate;

      if (expDate <= now || expDate.getTime() - now.getTime() > sevenDaysMs) continue;

      const days = Math.ceil((expDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      items.push({
        clientId: est.clientId,
        clientName: clientNameMap[est.clientId],
        reason: "estimate-expiring",
        detail: (t("clientAttention.estimateExpiring") ?? "Estimate Expiring").replace("{days}", String(days)),
        entityId: est.id,
      });
    }

    // Sort by priority, then client name
    items.sort((a, b) => {
      const priDiff = REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason];
      if (priDiff !== 0) return priDiff;
      return a.clientName.localeCompare(b.clientName);
    });

    return items;
  }, [clientsData, invoicesData, estimatesData, tasksData, opportunitiesData, projectsData, t]);

  const count = attentionItems.length;

  // ── Category counts for ring chart / legend ────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of attentionItems) {
      counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    }
    return counts;
  }, [attentionItems]);

  const ringSegments = useMemo(() => {
    const red = categoryCounts["past-due-invoice"] ?? 0;
    const amber =
      (categoryCounts["unassigned-tasks"] ?? 0) +
      (categoryCounts["unscheduled-tasks"] ?? 0) +
      (categoryCounts["estimate-expiring"] ?? 0);
    const accent =
      (categoryCounts["stale-quoting"] ?? 0) +
      (categoryCounts["estimate-no-response"] ?? 0);

    return [
      { count: red, color: WT.error },
      { count: amber, color: WT.warning },
      { count: accent, color: WT.accent },
    ].filter((s) => s.count > 0);
  }, [categoryCounts]);

  // ── Inline action handler ──────────────────────────────────────────────
  function getActionForItem(item: AttentionItem) {
    const Icon = REASON_ICONS[item.reason];
    const labels: Record<AttentionReason, string> = {
      "unassigned-tasks": t("clientAttention.assignCrew") ?? "Assign crew",
      "unscheduled-tasks": t("clientAttention.schedule") ?? "Schedule",
      "stale-quoting": t("clientAttention.createEstimate") ?? "Create estimate",
      "estimate-no-response": t("clientAttention.sendFollowUp") ?? "Send follow-up",
      "past-due-invoice": t("clientAttention.viewInvoice") ?? "View invoice",
      "estimate-expiring": t("clientAttention.viewEstimate") ?? "View estimate",
    };

    const onAction = () => {
      switch (item.reason) {
        case "unassigned-tasks":
        case "unscheduled-tasks":
          navigate(`/projects/${item.entityId}`);
          break;
        case "stale-quoting":
          navigate(`/books?segment=estimates&action=new&opportunityId=${item.entityId}`);
          break;
        case "estimate-no-response":
          queueAction({
            type: "follow-up",
            label: t("clientAttention.followUpQueued") ?? "Follow-up queued — sending in 5m",
            entityId: item.entityId,
            executeFn: async () => {
              // The queue will execute after 5 minutes
              // In production this would call an API to send the follow-up
            },
          });
          break;
        case "past-due-invoice":
          navigate("/books?segment=invoices");
          break;
        case "estimate-expiring":
          navigate("/books?segment=estimates");
          break;
      }
    };

    return (
      <WidgetInlineAction
        icon={Icon}
        label={labels[item.reason]}
        onAction={onAction}
      />
    );
  }

  // ── SM ─────────────────────────────────────────────────────────────────
  if (isCompact(size)) {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={
            <div className="h-full flex items-center justify-end pr-2">
              <AttentionRing
                segments={ringSegments}
                isVisible={isVisible}
                reducedMotion={reducedMotion}
              />
            </div>
          }
          opacity={0.4}
        >
          <div className="h-full flex flex-col p-3">
            <span
              className={cn(
                "font-mono text-data-lg font-bold leading-none",
                isLoading ? "text-text-mute" : count > 0 ? "text-ops-error" : "text-status-success"
              )}
            >
              {isLoading ? "—" : count}
            </span>
            <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
              {t("clientAttention.title")}
            </span>
            {!isLoading && count > 0 && (
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {(categoryCounts["past-due-invoice"] ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.error }} />
                    <span className="font-mono text-micro text-text-mute uppercase">
                      {categoryCounts["past-due-invoice"]} {t("clientAttention.overdue")}
                    </span>
                  </span>
                )}
                {((categoryCounts["unassigned-tasks"] ?? 0) + (categoryCounts["unscheduled-tasks"] ?? 0)) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.warning }} />
                    <span className="font-mono text-micro text-text-mute uppercase">
                      {(categoryCounts["unassigned-tasks"] ?? 0) + (categoryCounts["unscheduled-tasks"] ?? 0)} {t("clientAttention.tasks")}
                    </span>
                  </span>
                )}
                {((categoryCounts["stale-quoting"] ?? 0) + (categoryCounts["estimate-no-response"] ?? 0)) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.accent }} />
                    <span className="font-mono text-micro text-text-mute uppercase">
                      {(categoryCounts["stale-quoting"] ?? 0) + (categoryCounts["estimate-no-response"] ?? 0)} {t("clientAttention.staleQuotes")}
                    </span>
                  </span>
                )}
              </div>
            )}
            {!isLoading && count === 0 && (
              <span className="font-mono text-micro text-text-mute uppercase mt-0.5">
                {t("clientAttention.allGood")}
              </span>
            )}
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }

  // ── MD / LG ────────────────────────────────────────────────────────────
  const maxItems = showActions(size) ? attentionItems.length : 5;
  const displayItems = expanded ? attentionItems : attentionItems.slice(0, maxItems);
  const remaining = attentionItems.length - maxItems;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {t("clientAttention.title")}
          </span>
          <span
            className={cn(
              "font-mono text-micro uppercase",
              isLoading ? "text-text-3" : count > 0 ? "text-ops-error" : "text-text-3"
            )}
          >
            {isLoading
              ? "..."
              : `${count} ${count === 1 ? t("clientAttention.client") : t("clientAttention.clients")}`}
          </span>
        </div>

        {/* LG HERO */}
        {showActions(size) && count > 0 && (
          <WidgetHeroCollapse collapsed={heroCollapsed} collapsedHeight="0px" expandedHeight="50px">
            <div className="mb-2">
              <span className="font-mono text-data-lg font-bold text-ops-error leading-none">
                {count}
              </span>
              <span className="font-mono text-micro text-text-3 uppercase ml-1">
                {t("clientAttention.needAttention")}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                {(categoryCounts["past-due-invoice"] ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.error }} />
                    <span className="font-mono text-micro text-text-mute uppercase">
                      {categoryCounts["past-due-invoice"]} {t("clientAttention.overdue")}
                    </span>
                  </span>
                )}
                {((categoryCounts["unassigned-tasks"] ?? 0) + (categoryCounts["unscheduled-tasks"] ?? 0)) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.warning }} />
                    <span className="font-mono text-micro text-text-mute uppercase">
                      {(categoryCounts["unassigned-tasks"] ?? 0) + (categoryCounts["unscheduled-tasks"] ?? 0)} {t("clientAttention.tasks")}
                    </span>
                  </span>
                )}
                {((categoryCounts["stale-quoting"] ?? 0) + (categoryCounts["estimate-no-response"] ?? 0)) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.accent }} />
                    <span className="font-mono text-micro text-text-mute uppercase">
                      {(categoryCounts["stale-quoting"] ?? 0) + (categoryCounts["estimate-no-response"] ?? 0)} {t("clientAttention.staleQuotes")}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </WidgetHeroCollapse>
        )}

        {/* LIST */}
        <div ref={scrollContainerRef} className="flex-1 min-h-0 flex flex-col">
          <ScrollFade>
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <span className="font-mono text-[11px] text-text-mute">
                  {t("clientAttention.loading")}
                </span>
              </div>
            ) : count === 0 ? (
              <WidgetEmptyState
                icon={CheckCircle}
                message={t("clientAttention.allGood") ?? "All clients in good standing"}
              />
            ) : (
              <div className="flex flex-col gap-[2px]">
                {displayItems.map((item, i) => (
                  <WidgetLineItem
                    key={`${item.clientId}-${item.reason}-${item.entityId}`}
                    indicator={{ type: "bar", color: REASON_COLORS[item.reason], label: REASON_LABELS[item.reason] }}
                    primary={item.clientName}
                    secondary={item.detail}
                    action={getActionForItem(item)}
                    onClick={(e) => openEntity({
                      entityType: "client",
                      entityId: item.clientId,
                      title: item.clientName,
                      color: REASON_COLORS[item.reason],
                      event: e,
                      fallbackPath: `/clients/${item.clientId}`,
                    })}
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                ))}
                {!showActions(size) && remaining > 0 && (
                  <WidgetMoreButton
                    remaining={remaining}
                    expanded={expanded}
                    onToggle={() => setExpanded(!expanded)}
                  />
                )}
              </div>
            )}
          </ScrollFade>
        </div>
      </div>
    </Card>
  );
}
