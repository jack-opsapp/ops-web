"use client";

import { useMemo } from "react";
import { Loader2, FileText, FolderKanban, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Client } from "@/lib/types/models";
import type { Estimate } from "@/lib/types/pipeline";
import { useClients, useProjects, useEstimates } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClientActivityWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Activity Item Type
// ---------------------------------------------------------------------------

interface ActivityItem {
  id: string;
  type: "estimate-sent" | "estimate-created" | "project-created";
  description: string;
  clientName: string;
  date: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getActivityIcon(type: ActivityItem["type"]) {
  switch (type) {
    case "estimate-sent":
      return <Send className="w-[12px] h-[12px] text-ops-accent" />;
    case "estimate-created":
      return <FileText className="w-[12px] h-[12px] text-text-secondary" />;
    case "project-created":
      return <FolderKanban className="w-[12px] h-[12px] text-status-success" />;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientActivityWidget({ size }: ClientActivityWidgetProps) {
  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: projectsData, isLoading: projectsLoading } = useProjects();
  const { data: estimates, isLoading: estimatesLoading } = useEstimates();

  const isLoading = clientsLoading || projectsLoading || estimatesLoading;

  // Build client name lookup
  const clientNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!clientsData?.clients) return map;
    for (const c of clientsData.clients) {
      map[c.id] = c.name;
    }
    return map;
  }, [clientsData]);

  // Build activity items from estimates and projects
  const activities = useMemo(() => {
    const items: ActivityItem[] = [];

    // Estimates that were sent
    if (estimates) {
      for (const est of estimates) {
        if (est.deletedAt) continue;
        if (est.sentAt) {
          const sentDate = typeof est.sentAt === "string" ? new Date(est.sentAt) : est.sentAt;
          items.push({
            id: `est-sent-${est.id}`,
            type: "estimate-sent",
            description: `Estimate sent to ${clientNameMap[est.clientId] ?? "client"}`,
            clientName: clientNameMap[est.clientId] ?? "Unknown",
            date: sentDate,
          });
        } else {
          // Recently created estimate (not yet sent)
          const createdDate = typeof est.createdAt === "string" ? new Date(est.createdAt) : est.createdAt;
          items.push({
            id: `est-created-${est.id}`,
            type: "estimate-created",
            description: `New estimate for ${clientNameMap[est.clientId] ?? "client"}`,
            clientName: clientNameMap[est.clientId] ?? "Unknown",
            date: createdDate,
          });
        }
      }
    }

    // Projects with clientId
    if (projectsData?.projects) {
      for (const proj of projectsData.projects) {
        if (proj.deletedAt || !proj.clientId) continue;
        const startDate = proj.startDate
          ? typeof proj.startDate === "string"
            ? new Date(proj.startDate)
            : proj.startDate
          : null;
        if (startDate) {
          items.push({
            id: `proj-${proj.id}`,
            type: "project-created",
            description: `Project "${proj.title}" for ${clientNameMap[proj.clientId] ?? "client"}`,
            clientName: clientNameMap[proj.clientId] ?? "Unknown",
            date: startDate,
          });
        }
      }
    }

    // Sort by date descending
    items.sort((a, b) => b.date.getTime() - a.date.getTime());

    return items;
  }, [estimates, projectsData, clientNameMap]);

  // ── SM: Last activity summary ────────────────────────────────────────────
  if (size === "sm") {
    const latest = activities[0] ?? null;

    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">Client Activity</CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">
                Loading...
              </span>
            </div>
          ) : latest ? (
            <div className="flex flex-col gap-0.5">
              <p className="font-mohave text-body-sm text-text-primary truncate">
                {latest.description}
              </p>
              <span className="font-mono text-[11px] text-text-tertiary">
                {formatTimeAgo(latest.date)}
              </span>
            </div>
          ) : (
            <p className="font-mohave text-body-sm text-text-disabled">
              No recent activity
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG: Feed of recent activity items ──────────────────────────────
  const maxItems = size === "lg" ? 7 : 3;

  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Client Activity</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${activities.length} events`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              Loading activity...
            </span>
          </div>
        ) : activities.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            No recent client activity
          </p>
        ) : (
          <div className="space-y-[6px]">
            {activities.slice(0, maxItems).map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-1.5 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
              >
                {/* Type icon */}
                <div className="w-[20px] h-[20px] rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center shrink-0 mt-[1px]">
                  {getActivityIcon(item.type)}
                </div>

                {/* Description + timestamp */}
                <div className="flex-1 min-w-0">
                  <p className="font-mohave text-body-sm text-text-secondary truncate">
                    {item.description}
                  </p>
                  <span className="font-mono text-[11px] text-text-disabled">
                    {formatTimeAgo(item.date)}
                  </span>
                </div>
              </div>
            ))}
            {activities.length > maxItems && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{activities.length - maxItems} more
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
