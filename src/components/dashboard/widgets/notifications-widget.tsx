"use client";

import { useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { useNotifications, useDismissNotification } from "@/lib/hooks/use-notifications";
import { isCompact, WT } from "@/lib/widget-tokens";
import type { AppNotification, NotificationType } from "@/lib/api/services/notification-service";
import { ScrollFade } from "./shared/scroll-fade";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WidgetTitle } from "./shared/widget-title";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface NotificationsWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTypeColor(type: NotificationType): string {
  switch (type) {
    case "task_assigned":
    case "task_completed":
      return WT.accent;
    case "expense_submitted":
    case "expense_approved":
      return WT.warning;
    case "pipeline_complete":
    case "gmail_sync":
    case "lead_follow_up_sent":
      return WT.success;
    case "mention":
    case "role_needed":
      return WT.error;
    default:
      return WT.muted;
  }
}

function getTypeLabel(type: NotificationType): string {
  switch (type) {
    case "task_assigned": return "Task Assigned";
    case "task_completed": return "Task Done";
    case "expense_submitted": return "Expense";
    case "expense_approved": return "Approved";
    case "pipeline_complete": return "Pipeline";
    case "gmail_sync": return "Gmail Sync";
    case "mention": return "Mention";
    case "role_needed": return "Role Needed";
    case "intel_available": return "Intel";
    case "setup_prompt": return "Setup";
    case "leads_waiting": return "Leads";
    case "lead_follow_up_sent": return "Follow-up sent";
    case "system": return "System";
    case "project_assigned": return "Project";
    case "schedule_change": return "Schedule";
    case "duplicates_found": return "Duplicates";
    default: return type;
  }
}

function formatTimeAgo(date: Date, t: (key: string) => string): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t("activity.justNow");
  if (seconds < 3600) return (t("activity.minutesAgo") ?? "{count}m ago").replace("{count}", String(Math.floor(seconds / 60)));
  if (seconds < 86400) return (t("activity.hoursAgo") ?? "{count}h ago").replace("{count}", String(Math.floor(seconds / 3600)));
  if (seconds < 604800) return (t("activity.daysAgo") ?? "{count}d ago").replace("{count}", String(Math.floor(seconds / 86400)));
  return date.toLocaleDateString();
}

function sortNotifications(
  notifications: AppNotification[],
  sortBy: string
): AppNotification[] {
  const copy = [...notifications];
  switch (sortBy) {
    case "priority":
      return copy.sort((a, b) => {
        if (a.persistent !== b.persistent) return a.persistent ? -1 : 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    case "type":
      return copy.sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    case "recent":
    default:
      return copy.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function NotificationsWidget({ size, config }: NotificationsWidgetProps) {
  const { t } = useDictionary("dashboard");
  const router = useRouter();
  const navigate = useCallback((path: string) => router.push(path), [router]);

  const { data: notifications, isLoading } = useNotifications();
  const dismissMutation = useDismissNotification();
  const sortBy = (config.sortBy as string) ?? "recent";

  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const sortLabel =
    sortBy === "priority"
      ? t("notifications.sortPriority")
      : sortBy === "type"
        ? t("notifications.sortType")
        : t("notifications.sortRecent");

  const sorted = useMemo(
    () => sortNotifications(notifications ?? [], sortBy),
    [notifications, sortBy]
  );

  // ── Compact rendering (XS / SM) ──────────────────────────────────────────
  if (isCompact(size)) {
    const count = sorted.length;
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <span className="font-mono text-display font-bold text-text leading-none">
            {isLoading ? "—" : count}
          </span>
          <WidgetTitle className="mt-1">
            {t("notifications.title")}
          </WidgetTitle>
          <WidgetTrendContext variant="snapshot" label={t("trend.unread") ?? "Unread"} />
        </div>
      </Card>
    );
  }

  // ── Expanded rendering (MD / LG) ─────────────────────────────────────────
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <WidgetTitle>
            {t("notifications.title")}
          </WidgetTitle>
          <span className="font-mono text-micro text-text-3">
            {sortLabel}
          </span>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <p className="font-mohave text-body-sm text-text-mute">
              {t("notifications.loading")}
            </p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && sorted.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <Bell className="w-[20px] h-[20px] text-text-mute" />
            <p className="font-mohave text-body-sm text-text-mute text-center">
              {t("notifications.allClear")}
            </p>
          </div>
        )}

        {/* Notification list */}
        {!isLoading && sorted.length > 0 && (
          <ScrollFade>
            <div className="flex flex-col gap-[2px]">
              {sorted.map((notification, i) => (
                <WidgetLineItem
                  key={notification.id}
                  indicator={{
                    type: "bar",
                    color: getTypeColor(notification.type),
                    label: getTypeLabel(notification.type),
                  }}
                  primary={notification.title}
                  secondary={notification.body ?? undefined}
                  metric={formatTimeAgo(notification.createdAt, t)}
                  onClick={
                    notification.actionUrl
                      ? () => navigate(notification.actionUrl!)
                      : undefined
                  }
                  action={
                    !notification.persistent ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissMutation.mutate(notification.id);
                        }}
                        className="w-[20px] h-[20px] flex items-center justify-center rounded-sm hover:bg-surface-hover transition-colors text-text-mute hover:text-text-2"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    ) : undefined
                  }
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                />
              ))}
            </div>
          </ScrollFade>
        )}
      </div>
    </Card>
  );
}
