"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WT, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { Client, Project } from "@/lib/types/models";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface TopClientsWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  clients: Client[];
  invoices: Invoice[];
  projects: Project[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  const now = new Date();
  return Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

function activityDotColor(days: number | null): string {
  if (days === null) return WT.muted;
  if (days <= 7) return WT.success;
  if (days <= 30) return WT.warning;
  return WT.error;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function TopClientsWidget({
  size,
  config,
  clients,
  invoices,
  projects,
  isLoading,
  onNavigate,
}: TopClientsWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const metric = (config.metric as string) ?? "revenue";
  const period = (config.period as string) ?? "ytd";

  const reducedMotion = useReducedMotion();

  const rankedClients = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const clientMap = new Map<string, {
      client: Client;
      revenue: number;
      outstanding: number;
      projectCount: number;
      lastActivityAt: Date | null;
    }>();

    for (const client of clients) {
      if (client.deletedAt) continue;
      clientMap.set(client.id, {
        client,
        revenue: 0,
        outstanding: 0,
        projectCount: 0,
        lastActivityAt: null,
      });
    }

    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      const entry = clientMap.get(inv.clientId);
      if (!entry) continue;

      if (period === "ytd") {
        const paidDate = inv.paidAt ? new Date(inv.paidAt) : null;
        if (inv.status === InvoiceStatus.Paid && paidDate && paidDate >= yearStart) {
          entry.revenue += inv.amountPaid;
        }
      } else {
        if (inv.status === InvoiceStatus.Paid) {
          entry.revenue += inv.amountPaid;
        }
      }

      if (inv.status !== InvoiceStatus.Paid && inv.status !== InvoiceStatus.Void && inv.status !== InvoiceStatus.WrittenOff && inv.status !== InvoiceStatus.Draft) {
        entry.outstanding += inv.balanceDue;
      }

      const invDate = inv.updatedAt ? new Date(inv.updatedAt) : null;
      if (invDate && (!entry.lastActivityAt || invDate > entry.lastActivityAt)) {
        entry.lastActivityAt = invDate;
      }
    }

    for (const proj of projects) {
      if (proj.deletedAt || !proj.clientId) continue;
      const entry = clientMap.get(proj.clientId);
      if (entry) entry.projectCount++;
    }

    const entries = Array.from(clientMap.values()).filter((e) => {
      if (metric === "revenue") return e.revenue > 0;
      if (metric === "outstanding") return e.outstanding > 0;
      return e.projectCount > 0;
    });

    entries.sort((a, b) => {
      if (metric === "revenue") return b.revenue - a.revenue;
      if (metric === "outstanding") return b.outstanding - a.outstanding;
      return b.projectCount - a.projectCount;
    });

    return entries;
  }, [clients, invoices, projects, metric, period]);

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("topClients.title") ?? "Top Clients"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (rankedClients.length === 0) {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/clients")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("topClients.title") ?? "Top Clients"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mohave text-caption-sm text-text-disabled">
              {t("topClients.noData") ?? "No client data yet"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("topClients.viewClients") ?? "View Clients"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + top client name ──────────────────────────────────
  if (size === "sm") {
    const topClient = rankedClients[0];
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
              {rankedClients.length}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/clients"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("topClients.title") ?? "Top Clients"}
          </span>
          {/* Row 3: Top client name */}
          {topClient && (
            <span className="font-mohave text-caption-sm text-text-secondary truncate mt-0.5">
              #1: {topClient.client.name}
            </span>
          )}
        </div>
      </Card>
    );
  }

  const maxItems = size === "md" ? 5 : 15;
  const displayClients = rankedClients.slice(0, maxItems);
  const maxValue = displayClients[0]
    ? metric === "revenue" ? displayClients[0].revenue
      : metric === "outstanding" ? displayClients[0].outstanding
      : displayClients[0].projectCount
    : 1;

  function getMetricValue(entry: typeof displayClients[number]): number {
    if (metric === "revenue") return entry.revenue;
    if (metric === "outstanding") return entry.outstanding;
    return entry.projectCount;
  }

  function formatMetric(entry: typeof displayClients[number]): string {
    if (metric === "projects") return `${entry.projectCount}`;
    return formatCurrency(getMetricValue(entry));
  }

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("topClients.title") ?? "Top Clients"}
          </span>
        </div>

        {/* CLIENT LIST */}
        <ScrollFade>
          <div className="flex flex-col gap-[4px]">
            {displayClients.map((entry, i) => {
              const val = getMetricValue(entry);
              const barPct = maxValue > 0 ? (val / maxValue) * 100 : 0;
              const days = daysSince(entry.lastActivityAt);
              const dotColor = activityDotColor(days);

              return (
                <div
                  key={entry.client.id}
                  className="flex items-center gap-1.5 py-[3px] px-1 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors relative"
                  style={{
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? "translateX(0)" : "translateX(-8px)",
                    transition: reducedMotion
                      ? "opacity 200ms ease"
                      : `opacity 300ms ease ${i * 50}ms, transform 300ms ease ${i * 50}ms`,
                  }}
                  onClick={() => onNavigate(`/clients/${entry.client.id}`)}
                >
                  {/* Rank number */}
                  <span className="font-mono text-micro text-text-tertiary w-[14px] shrink-0">{i + 1}</span>

                  {/* Name + bar container */}
                  <div className="flex-1 min-w-0 relative">
                    <div className="flex items-center justify-between relative z-10">
                      <span className="font-mohave text-caption-sm text-text-primary truncate">
                        {entry.client.name}
                      </span>
                      <span className="font-mono text-micro text-text-primary font-medium ml-2 shrink-0">
                        {formatMetric(entry)}
                      </span>
                    </div>

                    {/* Proportional bar behind */}
                    <div
                      className="absolute bottom-0 left-0 rounded-sm transition-all"
                      style={{
                        height: isCompact(size) ? "4px" : "8px",
                        width: isVisible ? `${barPct}%` : "0%",
                        backgroundColor: WT.accentSubtle,
                        transitionDuration: reducedMotion ? "200ms" : "500ms",
                        transitionDelay: reducedMotion ? "0ms" : `${i * 50 + 100}ms`,
                        transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                      }}
                    />

                    {/* Secondary line for lg */}
                    {showActions(size) && (
                      <div className="flex items-center gap-1 mt-[1px]">
                        <span className="font-mono text-micro-sm text-text-tertiary">
                          {entry.projectCount} {t("topClients.projects") ?? "projects"}
                        </span>
                        {days !== null && (
                          <>
                            <span className="text-text-disabled text-micro-sm">·</span>
                            <span className="font-mono text-micro-sm text-text-tertiary">
                              {t("topClients.lastActive") ?? "Last active"} {days}d ago
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Activity dot (md only) */}
                  {showDetail(size) && !showActions(size) && (
                    <span
                      className="w-[6px] h-[6px] rounded-full shrink-0"
                      style={{ backgroundColor: dotColor }}
                      title={days !== null ? `${days}d since last activity` : "No activity recorded"}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </ScrollFade>

        {/* FOOTER */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/clients")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("topClients.viewClients") ?? "View Clients"}
          </button>
        )}
      </div>
    </Card>
  );
}
