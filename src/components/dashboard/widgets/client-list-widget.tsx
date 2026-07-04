"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, FolderPlus, Receipt, FileText, ClipboardList, ArrowUpRight, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetInlineAction } from "./shared/widget-inline-action";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
// WidgetHeroCollapse removed — static metrics eliminate scroll jitter
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetTitle } from "./shared/widget-title";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { useScrollFadeScroll } from "./shared/use-scroll-fade-scroll";
import { widgetLineItemStyle } from "./shared/widget-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WT, showActions } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useClients, useProjects, useInvoices } from "@/lib/hooks";
import { InvoiceStatus } from "@/lib/types/pipeline";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
import { useWidgetEntityOpen } from "./shared/use-widget-entity-open";
import { useWindowStore } from "@/stores/window-store";
import { useWidgetActionQueue } from "@/stores/widget-action-queue";
import { ClientService } from "@/lib/api/services";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ClientListWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sort type
// ---------------------------------------------------------------------------
type SortBy = "recent" | "name" | "revenue";


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ClientListWidget({ size, config }: ClientListWidgetProps) {
  const { t } = useDictionary("dashboard");
  const router = useRouter();
  const navigate = useCallback((path: string) => router.push(path), [router]);
  const openEntity = useWidgetEntityOpen();
  // Same idiom as useWidgetEntityOpen's client path — creating mode goes
  // straight onto the workspace window instead of hopping through the
  // /clients/new redirect (create-entry consistency 2026-07-04).
  const openClientWindow = useWindowStore((s) => s.openClientWindow);
  const queryClient = useQueryClient();
  const { queueAction } = useWidgetActionQueue();

  const ref = useRef<HTMLDivElement>(null);
  // scrollContainerRef removed — ScrollFade manages its own scroll
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const [sortBy, setSortBy] = useState<SortBy>(
    (config.sortBy as SortBy) ?? "recent"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [listExpanded, setListExpanded] = useState(false);

  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: projectsData, isLoading: projectsLoading } = useProjects();
  const { data: invoicesData, isLoading: invoicesLoading } = useInvoices();

  const isLoading = clientsLoading || projectsLoading || invoicesLoading;

  const clients = useMemo(() => {
    if (!clientsData?.clients) return [];
    return clientsData.clients.filter((c) => !c.deletedAt);
  }, [clientsData]);

  // Build project count map
  const projectCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!projectsData?.projects) return map;
    for (const p of projectsData.projects) {
      if (p.clientId && !p.deletedAt) {
        map[p.clientId] = (map[p.clientId] ?? 0) + 1;
      }
    }
    return map;
  }, [projectsData]);

  // Build revenue map (sum of paid invoices per client)
  const revenueMap = useMemo(() => {
    const map: Record<string, number> = {};
    const invoices = Array.isArray(invoicesData) ? invoicesData : [];
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (inv.status === InvoiceStatus.Paid) {
        map[inv.clientId] = (map[inv.clientId] ?? 0) + inv.amountPaid;
      }
    }
    return map;
  }, [invoicesData]);

  // Build outstanding balance map (sum of balanceDue on unpaid invoices)
  const outstandingMap = useMemo(() => {
    const map: Record<string, number> = {};
    const invoices = Array.isArray(invoicesData) ? invoicesData : [];
    const skipStatuses = new Set([InvoiceStatus.Paid, InvoiceStatus.Void, InvoiceStatus.WrittenOff, InvoiceStatus.Draft]);
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (skipStatuses.has(inv.status)) continue;
      if (inv.balanceDue > 0) {
        map[inv.clientId] = (map[inv.clientId] ?? 0) + inv.balanceDue;
      }
    }
    return map;
  }, [invoicesData]);

  // Build last activity map (most recent updatedAt across invoices/projects)
  const lastActivityMap = useMemo(() => {
    const map: Record<string, Date> = {};

    const updateMap = (clientId: string, date: Date | string | null) => {
      if (!date || !clientId) return;
      const d = typeof date === "string" ? new Date(date) : date;
      if (!map[clientId] || d > map[clientId]) {
        map[clientId] = d;
      }
    };

    const invoices = Array.isArray(invoicesData) ? invoicesData : [];
    for (const inv of invoices) {
      if (!inv.deletedAt) updateMap(inv.clientId, inv.updatedAt);
    }
    if (projectsData?.projects) {
      for (const p of projectsData.projects) {
        if (!p.deletedAt && p.clientId) updateMap(p.clientId, p.lastSyncedAt ?? p.createdAt);
      }
    }

    return map;
  }, [invoicesData, projectsData]);

  // LG metrics
  const lgMetrics = useMemo(() => {
    if (!showActions(size)) return null;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let activeThisMonth = 0;
    let newThisMonth = 0;

    for (const c of clients) {
      const lastActivity = lastActivityMap[c.id];
      if (lastActivity && lastActivity >= monthStart) {
        activeThisMonth++;
      }
      if (c.createdAt) {
        const created = typeof c.createdAt === "string" ? new Date(c.createdAt) : c.createdAt;
        if (created >= monthStart) {
          newThisMonth++;
        }
      }
    }

    return { total: clients.length, activeThisMonth, newThisMonth };
  }, [clients, lastActivityMap, size]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return clients;
    const q = searchQuery.toLowerCase();
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, searchQuery]);

  // Sort
  const sorted = useMemo(() => {
    const list = [...filtered];
    switch (sortBy) {
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "revenue":
        list.sort((a, b) => (revenueMap[b.id] ?? 0) - (revenueMap[a.id] ?? 0));
        break;
      case "recent":
      default:
        list.sort((a, b) => {
          const aTime = lastActivityMap[a.id]?.getTime() ?? 0;
          const bTime = lastActivityMap[b.id]?.getTime() ?? 0;
          return bTime - aTime;
        });
        break;
    }
    return list;
  }, [filtered, sortBy, revenueMap, lastActivityMap]);

  // Most recent client (SM)
  const mostRecent = useMemo(() => {
    if (clients.length === 0) return null;
    const byRecent = [...clients].sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
    return byRecent[0] ?? null;
  }, [clients]);

  // Hero collapse removed — static metrics, no scroll jitter

  // Delete client with undo window
  const handleDeleteClient = useCallback(
    (clientId: string, clientName: string) => {
      queueAction(
        {
          type: "delete-client",
          label: `${clientName} ${t("clientList.deleted") ?? "deleted"}`,
          entityId: clientId,
          executeFn: async () => {
            await ClientService.softDeleteClient(clientId);
            queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
          },
        },
        5_000
      );
    },
    [queueAction, queryClient, t]
  );

  // ── SM: Hero + title + latest client ────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text">
              {isLoading ? "—" : clients.length}
            </span>
            <button
              onClick={() => navigate("/clients")}
              className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <WidgetTitle className="mt-1">
            {t("clientList.title")}
          </WidgetTitle>
          <WidgetTrendContext variant="snapshot" label={t("trend.active") ?? "Active"} />
          {!isLoading && mostRecent && (
            <span className="font-mohave text-caption-sm text-text-3 truncate mt-0.5">
              {t("clientList.latest")}: {mostRecent.name}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG ─────────────────────────────────────────────────────────────
  const sortOptions = [
    { value: "recent", label: t("clientList.sortRecent") ?? "Recent" },
    { value: "name", label: t("clientList.sortName") ?? "Name" },
    { value: "revenue", label: t("clientList.sortRevenue") ?? "Revenue" },
  ];

  const isLg = showActions(size);
  const defaultMax = isLg ? 10 : 5;
  const visibleClients = listExpanded ? sorted : sorted.slice(0, defaultMax);
  const clientsRemaining = sorted.length - defaultMax;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER: Title + Sort + New Client */}
        <div className="flex items-center justify-between mb-2 shrink-0">
          <WidgetTitle>
            {t("clientList.title")}
          </WidgetTitle>
          <div className="flex items-center gap-1">
            <WidgetPeriodPicker
              options={sortOptions}
              value={sortBy}
              onChange={(v) => setSortBy(v as SortBy)}
              size={size}
            />
            <button
              onClick={() => openClientWindow({ clientId: null, mode: "creating" })}
              className="w-[20px] h-[20px] flex items-center justify-center rounded-sm hover:bg-surface-hover transition-colors text-text-mute hover:text-text-2"
              title={t("clientList.newClient") ?? "New Client"}
            >
              <Plus className="w-[14px] h-[14px]" />
            </button>
          </div>
        </div>

        {/* LG METRICS — static, no collapse (eliminates scroll jitter) */}
        {lgMetrics && isLg && (
          <div className="flex items-start gap-4 mb-2 shrink-0">
            <div>
              <span className="font-mono text-data-lg font-bold text-text block leading-none">
                {lgMetrics.total}
              </span>
              <span className="font-mono text-micro text-text-3 uppercase">
                {t("clientList.total")}
              </span>
            </div>
            <div>
              <span className="font-mono text-data-lg font-bold text-text block leading-none">
                {lgMetrics.activeThisMonth}
              </span>
              <span className="font-mono text-micro text-text-3 uppercase">
                {t("clientList.activeMonth")}
              </span>
            </div>
            <div>
              <span className="font-mono text-data-lg font-bold text-text block leading-none">
                {lgMetrics.newThisMonth}
              </span>
              <span className="font-mono text-micro text-text-3 uppercase">
                {t("clientList.newMonth")}
              </span>
            </div>
          </div>
        )}

        {/* SEARCH BOX */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("clientList.search") ?? "Search clients..."}
          className="w-full bg-surface-input border border-border-input font-mohave text-caption-sm placeholder:text-text-3 rounded-sm px-2 py-1 outline-none focus:border-[rgba(255,255,255,0.20)]/50 transition-colors mb-2 shrink-0"
        />

        {/* CLIENT LIST */}
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-mute animate-spin" />
            <span className="font-mono text-[11px] text-text-mute ml-1">
              {t("clientList.loading")}
            </span>
          </div>
        ) : sorted.length === 0 ? (
          <WidgetEmptyState
            message={searchQuery ? (t("clientList.noMatch") ?? "No clients match your search") : (t("clientList.empty") ?? "No clients yet")}
          />
        ) : (
          <ScrollFade>
            <div className="flex flex-col gap-[2px]">
              {visibleClients.map((client, i) => {
                const contact = client.email ?? client.phoneNumber ?? undefined;
                const revenue = revenueMap[client.id] ?? 0;
                const outstanding = outstandingMap[client.id] ?? 0;
                const projCount = projectCountMap[client.id] ?? 0;

                const financialMetric = outstanding > 0 ? (
                  <div className="flex flex-col items-end">
                    {revenue > 0 && (
                      <span className="font-mono text-micro text-text-2">
                        {formatCompactCurrency(revenue)}
                      </span>
                    )}
                    <span className="font-mono text-micro text-status-warning">
                      {formatCompactCurrency(outstanding)} {t("clientList.due") ?? "due"}
                    </span>
                  </div>
                ) : revenue > 0 ? (
                  <span className="font-mono text-micro text-text-2">
                    {formatCompactCurrency(revenue)}
                  </span>
                ) : (
                  <span className="font-mono text-micro text-text-mute">
                    {projCount} {projCount === 1 ? t("clientList.proj") : t("clientList.projs")}
                  </span>
                );

                return (
                  <div
                    key={client.id}
                    className="flex items-center"
                    style={widgetLineItemStyle(i, isVisible, reducedMotion ?? null)}
                  >
                    <div
                      className="flex-1 min-w-0 cursor-pointer rounded-sm hover:bg-surface-hover transition-colors"
                      onClick={(e) => openEntity({
                        entityType: "client",
                        entityId: client.id,
                        title: client.name,
                        color: WT.accent,
                        event: e,
                        fallbackPath: `/clients/${client.id}`,
                      })}
                    >
                      <WidgetLineItem
                        indicator={{
                          type: "avatar",
                          initials: client.name ? client.name[0].toUpperCase() : "?",
                          color: WT.accent,
                        }}
                        primary={client.name}
                        secondary={[contact, projCount > 0 ? `${projCount} ${projCount === 1 ? "project" : "projects"}` : null].filter(Boolean).join(" · ") || undefined}
                        metric={financialMetric}
                      />
                    </div>
                    {isLg && (
                      <div className="shrink-0 ml-0.5">
                        <WidgetInlineAction
                          icon={Plus}
                          actions={[
                            { icon: FolderPlus, label: t("clientList.createProject") ?? "Create Project", onAction: () => navigate(`/projects/new?clientId=${client.id}`) },
                            { icon: Receipt, label: t("clientList.createInvoice") ?? "Create Invoice", onAction: () => navigate(`/books?segment=invoices&action=new&clientId=${client.id}`) },
                            { icon: FileText, label: t("clientList.createEstimate") ?? "Create Estimate", onAction: () => navigate(`/books?segment=estimates&action=new&clientId=${client.id}`) },
                            { icon: ClipboardList, label: t("clientList.createTask") ?? "Create Task", onAction: () => navigate(`/tasks/new?clientId=${client.id}`) },
                            { icon: Trash2, label: t("clientList.deleteClient") ?? "Delete Client", onAction: () => handleDeleteClient(client.id, client.name) },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {clientsRemaining > 0 && (
                <WidgetMoreButton
                  remaining={clientsRemaining}
                  expanded={listExpanded}
                  onToggle={() => setListExpanded(!listExpanded)}
                />
              )}
            </div>
          </ScrollFade>
        )}
      </div>
    </Card>
  );
}
