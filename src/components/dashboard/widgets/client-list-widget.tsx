"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Client } from "@/lib/types/models";
import { useClients, useProjects } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";

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

function formatDate(date: Date | string | null): string {
  if (!date) return "--";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientListWidget({ size, config }: ClientListWidgetProps) {
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

  // ── SM: Total client count + most recent client ──────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">Clients</CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">
                Loading...
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-data-lg text-text-primary">
                {clients.length}
              </span>
              {mostRecent && (
                <span className="font-mono text-[11px] text-text-tertiary truncate">
                  Latest: {mostRecent.name}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG: Scrollable client list ──────────────────────────────────────
  const maxItems = size === "lg" ? 7 : 3;

  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Clients</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${clients.length} total`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              Loading clients...
            </span>
          </div>
        ) : sorted.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            No clients yet
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
                +{sorted.length - maxItems} more
              </span>
            )}
          </div>
        )}
      </CardContent>
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
  const initial = client.name ? client.name[0].toUpperCase() : "?";
  const contact = client.email ?? client.phoneNumber ?? null;

  return (
    <div className="flex items-center gap-1.5 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group">
      {/* Avatar */}
      <div className="w-[28px] h-[28px] rounded-full bg-[rgba(255,255,255,0.08)] flex items-center justify-center shrink-0">
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
                Added {formatDate(client.createdAt)}
              </span>
            )}
          </>
        )}
      </div>

      {/* Project count badge */}
      <span
        className={cn(
          "font-mono text-[11px] px-1.5 py-[1px] rounded-full shrink-0",
          projectCount > 0
            ? "text-ops-accent bg-ops-accent/10"
            : "text-text-disabled bg-text-disabled/10"
        )}
      >
        {projectCount} {projectCount === 1 ? "proj" : "projs"}
      </span>
    </div>
  );
}
