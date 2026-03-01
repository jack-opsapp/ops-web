"use client";

import { useMemo } from "react";
import { useDictionary } from "@/i18n/client";
import { Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useInvoices, useClients, useProjects } from "@/lib/hooks";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
interface RankingEntry {
  id: string;
  name: string;
  amount: number;
}

type RankingMetric = "outstanding" | "collected" | "invoiced";

// ---------------------------------------------------------------------------
// Client Ranking Widget
// ---------------------------------------------------------------------------
interface ClientRankingWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

export function ClientRankingWidget({ size, config }: ClientRankingWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { data: invoicesData } = useInvoices();
  const { data: clientsData } = useClients();
  const metric = (config.metric as RankingMetric) ?? "outstanding";

  const invoices = invoicesData ?? [];
  const clients = clientsData?.clients ?? [];

  const ranked = useMemo(() => {
    const clientMap = new Map(clients.filter((c) => !c.deletedAt).map((c) => [c.id, c.name]));
    const agg = new Map<string, number>();

    for (const inv of invoices) {
      if (inv.deletedAt || !inv.clientId) continue;

      let amount = 0;
      switch (metric) {
        case "outstanding":
          if (inv.status !== InvoiceStatus.Paid && inv.status !== InvoiceStatus.Void) {
            amount = inv.balanceDue ?? 0;
          }
          break;
        case "collected":
          amount = inv.amountPaid ?? 0;
          break;
        case "invoiced":
          amount = inv.total ?? 0;
          break;
      }

      if (amount > 0) {
        agg.set(inv.clientId, (agg.get(inv.clientId) ?? 0) + amount);
      }
    }

    const entries: RankingEntry[] = [];
    for (const [id, amount] of agg) {
      const name = clientMap.get(id) ?? t("ranking.unknown");
      entries.push({ id, name, amount });
    }
    entries.sort((a, b) => b.amount - a.amount);
    return entries;
  }, [invoices, clients, metric, t]);

  const metricLabels: Record<RankingMetric, string> = {
    outstanding: t("ranking.outstanding"),
    collected: t("ranking.collected"),
    invoiced: t("ranking.invoiced"),
  };

  return (
    <RankingDisplay
      title={t("ranking.topClients")}
      subtitle={metricLabels[metric]}
      entries={ranked}
      size={size}
      accentColor="#C4A868"
    />
  );
}

// ---------------------------------------------------------------------------
// Project Ranking Widget
// ---------------------------------------------------------------------------
interface ProjectRankingWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

export function ProjectRankingWidget({ size, config }: ProjectRankingWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { data: invoicesData } = useInvoices();
  const { data: projectsData } = useProjects();
  const metric = (config.metric as RankingMetric) ?? "outstanding";

  const invoices = invoicesData ?? [];
  const projects = projectsData?.projects ?? [];

  const ranked = useMemo(() => {
    const projectMap = new Map(projects.filter((p) => !p.deletedAt).map((p) => [p.id, p.title]));
    const agg = new Map<string, number>();

    for (const inv of invoices) {
      if (inv.deletedAt || !inv.projectId) continue;

      let amount = 0;
      switch (metric) {
        case "outstanding":
          if (inv.status !== InvoiceStatus.Paid && inv.status !== InvoiceStatus.Void) {
            amount = inv.balanceDue ?? 0;
          }
          break;
        case "collected":
          amount = inv.amountPaid ?? 0;
          break;
        case "invoiced":
          amount = inv.total ?? 0;
          break;
      }

      if (amount > 0) {
        agg.set(inv.projectId, (agg.get(inv.projectId) ?? 0) + amount);
      }
    }

    const entries: RankingEntry[] = [];
    for (const [id, amount] of agg) {
      const name = projectMap.get(id) ?? t("ranking.unknown");
      entries.push({ id, name, amount });
    }
    entries.sort((a, b) => b.amount - a.amount);
    return entries;
  }, [invoices, projects, metric, t]);

  const metricLabels: Record<RankingMetric, string> = {
    outstanding: t("ranking.outstanding"),
    collected: t("ranking.collected"),
    invoiced: t("ranking.invoiced"),
  };

  return (
    <RankingDisplay
      title={t("ranking.topProjects")}
      subtitle={metricLabels[metric]}
      entries={ranked}
      size={size}
      accentColor="#8195B5"
    />
  );
}

// ---------------------------------------------------------------------------
// Shared Ranking Display — size-dependent rendering
// ---------------------------------------------------------------------------
interface RankingDisplayProps {
  title: string;
  subtitle: string;
  entries: RankingEntry[];
  size: WidgetSize;
  accentColor: string;
}

function RankingDisplay({ title, subtitle, entries, size, accentColor }: RankingDisplayProps) {
  const { t } = useDictionary("dashboard");

  // XS — single top entry, left-aligned
  if (size === "xs") {
    const top = entries[0];
    return (
      <div
        className="h-full w-full flex flex-col items-start justify-end rounded-md overflow-hidden p-[10px]"
        style={{
          background: `linear-gradient(135deg, ${accentColor}18, ${accentColor}08)`,
          borderLeft: `3px solid ${accentColor}`,
        }}
      >
        <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-widest mb-auto">
          {title}
        </span>
        {top ? (
          <>
            <p className="font-mono text-[13px] text-text-primary leading-tight truncate w-full">
              {top.name}
            </p>
            <p className="font-mono text-[20px] leading-none font-semibold" style={{ color: accentColor }}>
              ${top.amount.toLocaleString()}
            </p>
          </>
        ) : (
          <p className="font-mono text-[11px] text-text-disabled">{t("ranking.noData")}</p>
        )}
      </div>
    );
  }

  // SM — top 3 list with rank numbers
  if (size === "sm") {
    const top3 = entries.slice(0, 3);
    return (
      <Card
        className="p-2 h-full flex flex-col overflow-hidden"
        style={{ borderLeft: `3px solid ${accentColor}` }}
      >
        <div className="flex items-center justify-between mb-[6px]">
          <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
            {title}
          </span>
          <div
            className="w-[28px] h-[28px] rounded-md flex items-center justify-center shrink-0"
            style={{ background: `${accentColor}15` }}
          >
            <Trophy className="w-[14px] h-[14px]" style={{ color: accentColor }} />
          </div>
        </div>
        <span className="font-mono text-[9px] text-text-disabled uppercase mb-[4px]">{subtitle}</span>
        <div className="flex flex-col gap-[3px] flex-1 min-h-0">
          {top3.length === 0 && (
            <p className="font-mono text-[11px] text-text-disabled">{t("ranking.noData")}</p>
          )}
          {top3.map((entry, i) => (
            <div key={entry.id} className="flex items-center gap-[6px]">
              <span
                className="font-mono text-[10px] font-semibold w-[16px] text-center shrink-0"
                style={{ color: i === 0 ? accentColor : "var(--text-tertiary)" }}
              >
                {i + 1}
              </span>
              <span className="font-mono text-[11px] text-text-secondary truncate flex-1">
                {entry.name}
              </span>
              <span className="font-mono text-[11px] text-text-primary shrink-0">
                ${entry.amount.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  // MD — scrollable full list
  return (
    <Card
      className="p-3 h-full flex flex-col overflow-hidden"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="flex items-center justify-between mb-[8px]">
        <div>
          <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
            {title}
          </span>
          <span className="font-mono text-[9px] text-text-disabled uppercase ml-[8px]">{subtitle}</span>
        </div>
        <div
          className="w-[32px] h-[32px] rounded-md flex items-center justify-center shrink-0"
          style={{ background: `${accentColor}15` }}
        >
          <Trophy className="w-[16px] h-[16px]" style={{ color: accentColor }} />
        </div>
      </div>
      <div className="flex flex-col gap-[4px] flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {entries.length === 0 && (
          <p className="font-mono text-[11px] text-text-disabled">{t("ranking.noData")}</p>
        )}
        {entries.map((entry, i) => (
          <div key={entry.id} className="flex items-center gap-[8px] py-[2px]">
            <span
              className="font-mono text-[10px] font-semibold w-[20px] text-center shrink-0"
              style={{ color: i < 3 ? accentColor : "var(--text-tertiary)" }}
            >
              {i + 1}
            </span>
            <span className="font-mono text-[12px] text-text-secondary truncate flex-1">
              {entry.name}
            </span>
            <span className="font-mono text-[12px] text-text-primary shrink-0 font-medium">
              ${entry.amount.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
