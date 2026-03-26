"use client";

import { useMemo, useRef } from "react";
import { Award } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { Client, Project } from "@/lib/types/models";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

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
  if (days === null) return "rgba(255,255,255,0.15)";
  if (days <= 7) return "#6B8F71";
  if (days <= 30) return "#C4A868";
  return "#B58289";
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

  const rankedClients = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Build per-client aggregations
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

    // Aggregate invoices
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

      // Track last activity
      const invDate = inv.updatedAt ? new Date(inv.updatedAt) : null;
      if (invDate && (!entry.lastActivityAt || invDate > entry.lastActivityAt)) {
        entry.lastActivityAt = invDate;
      }
    }

    // Count projects per client
    for (const proj of projects) {
      if (proj.deletedAt || !proj.clientId) continue;
      const entry = clientMap.get(proj.clientId);
      if (entry) entry.projectCount++;
    }

    // Sort by chosen metric
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

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("topClients.title") ?? "Top Clients"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </CardContent>
      </Card>
    );
  }

  if (rankedClients.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("topClients.title") ?? "Top Clients"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 flex items-center justify-center h-[calc(100%-28px)]">
          <span className="font-mohave text-[13px] text-text-tertiary">
            {t("topClients.noData") ?? "No client data yet"}
          </span>
        </CardContent>
      </Card>
    );
  }

  const maxItems = size === "sm" ? 3 : size === "md" ? 5 : 8;
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
    <Card className="h-full" ref={ref}>
      <CardHeader className="pb-1 pt-2 px-3">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("topClients.title") ?? "Top Clients"}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden">
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
                <span className="font-mono text-[11px] text-text-tertiary w-[14px] shrink-0">{i + 1}</span>

                {/* Name + bar container */}
                <div className="flex-1 min-w-0 relative">
                  <div className="flex items-center justify-between relative z-10">
                    <span className="font-mohave text-[12px] text-text-primary truncate">
                      {entry.client.name}
                    </span>
                    <span className="font-mono text-[11px] text-text-primary font-medium ml-2 shrink-0">
                      {formatMetric(entry)}
                    </span>
                  </div>

                  {/* Proportional bar behind */}
                  <div
                    className="absolute bottom-0 left-0 rounded-sm transition-all"
                    style={{
                      height: size === "sm" ? "4px" : "8px",
                      width: isVisible ? `${barPct}%` : "0%",
                      backgroundColor: "rgba(89, 119, 148, 0.15)",
                      transitionDuration: reducedMotion ? "200ms" : "500ms",
                      transitionDelay: reducedMotion ? "0ms" : `${i * 50 + 100}ms`,
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  />

                  {/* Secondary line for lg */}
                  {size === "lg" && (
                    <div className="flex items-center gap-1 mt-[1px]">
                      <span className="font-mono text-[10px] text-text-tertiary">
                        {entry.projectCount} {t("topClients.projects") ?? "projects"}
                      </span>
                      {days !== null && (
                        <>
                          <span className="text-text-quaternary text-[10px]">·</span>
                          <span className="font-mono text-[10px] text-text-tertiary">
                            {t("topClients.lastActive") ?? "Last active"} {days}d ago
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Activity dot (md only) */}
                {size === "md" && (
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
      </CardContent>
    </Card>
  );
}
