"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { widgetLineItemStyle, WIDGET_EASE_CSS } from "./shared/widget-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WT, isCompact } from "@/lib/widget-tokens";
import type { Client, Project } from "@/lib/types/models";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
import { useWidgetEntityOpen } from "./shared/use-widget-entity-open";
import { WidgetTrendContext } from "./shared/widget-trend-context";

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
function daysSince(date: Date | null): number | null {
  if (!date) return null;
  const now = new Date();
  return Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
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
  const openEntity = useWidgetEntityOpen();
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const metric = (config.metric as string) ?? "revenue";
  const period = (config.period as string) ?? "ytd";

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

      if (
        inv.status !== InvoiceStatus.Paid &&
        inv.status !== InvoiceStatus.Void &&
        inv.status !== InvoiceStatus.WrittenOff &&
        inv.status !== InvoiceStatus.Draft
      ) {
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
        <div className="pb-1 pt-2 px-3">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-3">
            {t("topClients.title") ?? "Top Clients"}
          </span>
        </div>
        <div className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </div>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (rankedClients.length === 0) {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-3 uppercase tracking-wider">
            {t("topClients.title") ?? "Top Clients"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mohave text-caption-sm text-text-mute">
              {t("topClients.noData") ?? "No client data yet"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── XS: Hero count + title + context ────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          <span className="font-mono text-display font-bold leading-none text-text">
            {rankedClients.length}
          </span>
          <span className="font-kosugi text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("topClients.title") ?? "Top Clients"}
          </span>
          <WidgetTrendContext variant="snapshot" label={t("trend.byRevenue") ?? "By Revenue"} />
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + top client with revenue ─────────────────────────
  if (size === "sm") {
    const topClient = rankedClients[0];
    const topRevenue = topClient
      ? metric === "revenue"
        ? topClient.revenue
        : metric === "outstanding"
          ? topClient.outstanding
          : topClient.projectCount
      : 0;

    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text">
              {rankedClients.length}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/clients"); }}
              className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <span className="font-kosugi text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("topClients.title") ?? "Top Clients"}
          </span>
          <WidgetTrendContext variant="snapshot" label={t("trend.byRevenue") ?? "By Revenue"} />
          {topClient && (
            <span className="font-mohave text-caption-sm text-text-2 truncate mt-0.5">
              #1: {topClient.client.name} · {metric === "projects" ? `${topRevenue}` : formatCompactCurrency(topRevenue)}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: Ranked list with WidgetLineItem + proportional bars ──────
  const maxItems = size === "md" ? 5 : 15;
  const displayClients = rankedClients.slice(0, maxItems);
  const maxValue = displayClients[0]
    ? metric === "revenue"
      ? displayClients[0].revenue
      : metric === "outstanding"
        ? displayClients[0].outstanding
        : displayClients[0].projectCount
    : 1;

  function getMetricValue(entry: (typeof displayClients)[number]): number {
    if (metric === "revenue") return entry.revenue;
    if (metric === "outstanding") return entry.outstanding;
    return entry.projectCount;
  }

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-3">
            {t("topClients.title") ?? "Top Clients"}
          </span>
        </div>

        {/* CLIENT LIST — flex-1 so list fills remaining vertical space */}
        <ScrollFade className="flex-1 min-h-0">
          <div className="flex flex-col gap-[4px]">
            {displayClients.map((entry, i) => {
              const val = getMetricValue(entry);
              const barPct = maxValue > 0 ? (val / maxValue) * 100 : 0;
              const days = daysSince(entry.lastActivityAt);

              const secondary = `${entry.projectCount} ${t("topClients.projects") ?? "projects"}${days !== null ? ` · ${t("topClients.lastActive") ?? "Last active"} ${days}d ago` : ""}`;

              return (
                <div
                  key={entry.client.id}
                  className="flex items-center gap-1.5 relative"
                  style={widgetLineItemStyle(i, isVisible, reducedMotion)}
                >
                  {/* Rank number */}
                  <span className="font-mono text-micro text-text-3 w-[14px] shrink-0">
                    {i + 1}
                  </span>

                  {/* Line item + proportional bar */}
                  <div className="flex-1 min-w-0 relative">
                    <WidgetLineItem
                      indicator={{ type: "bar", color: WT.accent, label: `#${i + 1}` }}
                      primary={entry.client.name}
                      secondary={secondary}
                      metric={metric === "projects" ? `${val}` : formatCompactCurrency(val)}
                      onClick={(e) => openEntity({
                        entityType: "client",
                        entityId: entry.client.id,
                        title: entry.client.name,
                        color: WT.accent,
                        event: e,
                        fallbackPath: `/clients/${entry.client.id}`,
                      })}
                    />

                    {/* Proportional bar behind */}
                    <div
                      className="absolute bottom-0 left-0 rounded-sm pointer-events-none"
                      style={{
                        height: isCompact(size) ? "4px" : "8px",
                        width: isVisible ? `${barPct}%` : "0%",
                        backgroundColor: WT.accentSubtle,
                        transitionDuration: reducedMotion ? "200ms" : "500ms",
                        transitionDelay: reducedMotion ? "0ms" : `${i * 50 + 100}ms`,
                        transitionTimingFunction: WIDGET_EASE_CSS,
                        transitionProperty: "width",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollFade>

      </div>
    </Card>
  );
}
