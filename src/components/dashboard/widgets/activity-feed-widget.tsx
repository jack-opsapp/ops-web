"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { isCompact, showFooter } from "@/lib/widget-tokens";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  ActivityType,
  ACTIVITY_TYPE_COLORS,
} from "@/lib/types/pipeline";
import type { Activity } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { parseDateRequired } from "@/lib/supabase/helpers";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Inline hook — company-wide recent activities
// ---------------------------------------------------------------------------

function useRecentActivities(companyId: string | undefined) {
  return useQuery<Activity[]>({
    queryKey: ["activities", "company-feed", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        throw new Error(`Failed to fetch activities: ${error.message}`);
      }

      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        companyId: row.company_id as string,
        opportunityId: (row.opportunity_id as string) ?? null,
        clientId: (row.client_id as string) ?? null,
        estimateId: (row.estimate_id as string) ?? null,
        invoiceId: (row.invoice_id as string) ?? null,
        projectId: (row.project_id as string) ?? null,
        siteVisitId: (row.site_visit_id as string) ?? null,
        type: row.type as ActivityType,
        subject: row.subject as string,
        content: (row.content as string) ?? null,
        outcome: (row.outcome as string) ?? null,
        direction: (row.direction as Activity["direction"]) ?? null,
        durationMinutes:
          row.duration_minutes != null ? Number(row.duration_minutes) : null,
        attachments: (row.attachments as string[]) ?? [],
        emailThreadId: (row.email_thread_id as string) ?? null,
        emailMessageId: (row.email_message_id as string) ?? null,
        isRead: (row.is_read as boolean) ?? true,
        fromEmail: (row.from_email as string) ?? null,
        createdBy: (row.created_by as string) ?? null,
        createdAt: parseDateRequired(row.created_at),
      }));
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function activityColor(type: ActivityType): string {
  return ACTIVITY_TYPE_COLORS[type] ?? "#6B7280";
}

function activityTypeLabel(
  type: ActivityType,
  t: (key: string) => string
): string {
  return t(`activity.type.${type}`) ?? type;
}

function timeAgo(
  date: Date,
  t: (key: string) => string
): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return t("activity.justNow");
  if (diffMinutes < 60)
    return t("activity.minutesAgo").replace("{count}", String(diffMinutes));
  if (diffHours < 24)
    return t("activity.hoursAgo").replace("{count}", String(diffHours));
  if (diffDays === 0) return t("activity.today");
  return t("activity.daysAgo").replace("{count}", String(diffDays));
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActivityWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityWidget({
  size,
  config,
  onNavigate,
}: ActivityWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { company } = useAuthStore();
  const companyId = company?.id;
  const { data: activities, isLoading } = useRecentActivities(companyId);

  const count = activities?.length ?? 0;

  // ── XS / SM: Hero-first compact card ─────────────────────────────────────
  if (isCompact(size)) {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero count + tiny nav icon (SM only) */}
          <div className="flex items-baseline justify-between">
            <span
              className={`font-mono text-data-lg font-bold leading-none ${
                isLoading
                  ? "text-text-disabled"
                  : count > 0
                    ? "text-text-primary"
                    : "text-text-disabled"
              }`}
            >
              {isLoading ? "—" : count}
            </span>
            {showFooter(size) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate("/activity");
                }}
                className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
              </button>
            )}
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("activity.title")}
          </span>
          {/* Row 3: Subtitle — latest activity type or empty state */}
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase mt-0.5 truncate">
            {isLoading
              ? "..."
              : activities && activities.length > 0
                ? activities[0].subject || activityTypeLabel(activities[0].type, t)
                : t("activity.empty")}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD+: Scrollable activity feed ──────────────────────────────────────
  const maxItems = size === "lg" || size === "xl" ? 12 : 6;

  return (
    <Card className="h-full p-0">
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("activity.title")}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {isLoading
              ? "..."
              : `${count} ${t("activity.events")}`}
          </span>
        </div>

        {/* Feed list */}
        <ScrollFade>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled ml-1">
                {t("activity.loading")}
              </span>
            </div>
          ) : !activities || activities.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled py-2">
              {t("activity.empty")}
            </p>
          ) : (
            <div className="space-y-[2px]">
              {activities.slice(0, maxItems).map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-2 px-1 py-2 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                  {/* Color dot */}
                  <span
                    className="w-[6px] h-[6px] rounded-full shrink-0 mt-[6px]"
                    style={{ backgroundColor: activityColor(activity.type) }}
                  />
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="font-mohave text-body-sm text-text-primary truncate">
                      {activity.subject || activityTypeLabel(activity.type, t)}
                    </p>
                    <span className="font-mono text-[10px] text-text-disabled">
                      {activityTypeLabel(activity.type, t)} · {timeAgo(activity.createdAt, t)}
                    </span>
                  </div>
                </div>
              ))}
              {activities.length > maxItems && (
                <span className="font-mono text-[11px] text-text-disabled block px-1 pt-1">
                  +{activities.length - maxItems} more
                </span>
              )}
            </div>
          )}
        </ScrollFade>

        {/* Footer nav */}
        <button
          onClick={() => onNavigate("/activity")}
          className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
        >
          {t("activity.viewAll")}
        </button>
      </div>
    </Card>
  );
}
