"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Client } from "@/lib/types/models";
import { useClients, useProjects } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClientListWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SortBy = "name" | "recent" | "project-count";

function formatDate(date: Date | string | null, locale: Locale): string {
  if (!date) return "--";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientListWidget({ size, config }: ClientListWidgetProps) {
  const { t } = useDictionary("dashboard");
  const sortBy = (config.sortBy as SortBy) ?? "name";
  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: projectsData, isLoading: projectsLoading } = useProjects();

  const isLoading = clientsLoading || projectsLoading;

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

  // Sort clients
  const sorted = useMemo(() => {
    const list = [...clients];
    switch (sortBy) {
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "recent":
        list.sort((a, b) => {
          const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bDate - aDate;
        });
        break;
      case "project-count":
        list.sort(
          (a, b) => (projectCountMap[b.id] ?? 0) - (projectCountMap[a.id] ?? 0)
        );
        break;
    }
    return list;
  }, [clients, sortBy, projectCountMap]);

  // Most recent client (used in SM)
  const mostRecent = useMemo(() => {
    if (clients.length === 0) return null;
    const byRecent = [...clients].sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
    return byRecent[0] ?? null;
  }, [clients]);

  // ── SM: Hero + title + latest client ────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
            {isLoading ? "—" : clients.length}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("clientList.title")}
          </span>
          {!isLoading && mostRecent && (
            <span className="font-mohave text-caption-sm text-text-tertiary truncate mt-0.5">
              {t("clientList.latest")}: {mostRecent.name}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: Scrollable client list ──────────────────────────────────────
  const maxItems = size === "lg" ? 7 : 3;

  return (
    <Card className="h-full p-0">
      <div className="h-full flex flex-col p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">{t("clientList.title")}</span>
          <span className="font-mono text-micro text-text-tertiary">
            {isLoading ? "..." : `${clients.length} ${t("clientList.total")}`}
          </span>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("clientList.loading")}
            </span>
          </div>
        ) : sorted.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("clientList.empty")}
          </p>
        ) : (
          <div className="space-y-[6px]">
            {sorted.slice(0, maxItems).map((client) => (
              <ClientRow
                key={client.id}
                client={client}
                projectCount={projectCountMap[client.id] ?? 0}
                showExtended={size === "lg"}
              />
            ))}
            {sorted.length > maxItems && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{sorted.length - maxItems} {t("clientList.more")}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Client Row
// ---------------------------------------------------------------------------

function ClientRow({
  client,
  projectCount,
  showExtended,
}: {
  client: Client;
  projectCount: number;
  showExtended: boolean;
}) {
  const { t } = useDictionary("dashboard");
  const { locale } = useLocale();
  const initial = client.name ? client.name[0].toUpperCase() : "?";
  const contact = client.email ?? client.phoneNumber ?? null;

  return (
    <div className="flex items-center gap-1.5 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group">
      {/* Avatar */}
      <div className="w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0 border border-[rgba(255,255,255,0.15)]">
        <span className="font-mohave text-[13px] text-text-secondary">
          {initial}
        </span>
      </div>

      {/* Name + Contact */}
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-body-sm text-text-primary truncate">
          {client.name}
        </p>
        {contact && (
          <span className="font-mono text-[11px] text-text-tertiary truncate block">
            {contact}
          </span>
        )}
        {showExtended && (
          <>
            {client.address && (
              <span className="font-mono text-[11px] text-text-disabled truncate block">
                {client.address}
              </span>
            )}
            {client.createdAt && (
              <span className="font-mono text-[11px] text-text-disabled block">
                {t("clientList.added")} {formatDate(client.createdAt, locale)}
              </span>
            )}
          </>
        )}
      </div>

      {/* Project count badge */}
      <span
        className={cn(
          "font-mohave text-status px-1.5 py-[2px] rounded-sm uppercase tracking-wider shrink-0 border",
          projectCount > 0
            ? "text-ops-accent bg-ops-accent/10 border-ops-accent/30"
            : "text-text-disabled bg-text-disabled/10 border-text-disabled/30"
        )}
      >
        {projectCount} {projectCount === 1 ? t("clientList.proj") : t("clientList.projs")}
      </span>
    </div>
  );
}
