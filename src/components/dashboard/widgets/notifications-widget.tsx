"use client";

import { useMemo } from "react";
import { Bell, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { useNotifications, useDismissNotification } from "@/lib/hooks/use-notifications";
import { isCompact, WT } from "@/lib/widget-tokens";
import type { AppNotification, NotificationType } from "@/lib/api/services/notification-service";
import { ScrollFade } from "./shared/scroll-fade";

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
      return WT.success;
    case "mention":
    case "role_needed":
      return WT.error;
    default:
      return WT.muted;
  }
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
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
        // Persistent first, then by createdAt descending
        if (a.persistent !== b.persistent) return a.persistent ? -1 : 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

    case "type":
      return copy.sort((a, b) => {
        // Group by type alphabetically, then by createdAt descending within group
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
  const { data: notifications, isLoading } = useNotifications();
  const dismissMutation = useDismissNotification();
  const sortBy = (config.sortBy as string) ?? "recent";

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
        <div className="h-full flex flex-col items-center justify-center p-3 gap-1">
          <Bell className="w-[16px] h-[16px] text-text-disabled" />
          <span className="font-mohave text-body-sm text-text-primary">
            {isLoading ? "—" : count}
          </span>
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("notifications.title")}
          </span>
        </div>
      </Card>
    );
  }

  // ── Expanded rendering (MD / LG) ─────────────────────────────────────────
  return (
    <Card className="h-full p-0">
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("notifications.title")}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {sortLabel}
          </span>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <p className="font-mohave text-body-sm text-text-disabled">
              {t("notifications.loading")}
            </p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && sorted.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <Bell className="w-[20px] h-[20px] text-text-disabled" />
            <p className="font-mohave text-body-sm text-text-disabled text-center">
              {t("notifications.allClear")}
            </p>
          </div>
        )}

        {/* Notification list */}
        {!isLoading && sorted.length > 0 && (
          <ScrollFade>
            {sorted.map((notification) => (
              <div
                key={notification.id}
                className="flex items-start gap-2 px-1 py-2 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors"
              >
                {/* Type indicator dot */}
                <span
                  className="w-[6px] h-[6px] rounded-full shrink-0 mt-[6px]"
                  style={{ backgroundColor: getTypeColor(notification.type) }}
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="font-mohave text-body-sm text-text-primary truncate">
                    {notification.title}
                  </p>
                  {notification.body && (
                    <p className="font-mohave text-caption-sm text-text-tertiary truncate">
                      {notification.body}
                    </p>
                  )}
                  <span className="font-mono text-[10px] text-text-disabled">
                    {formatTimeAgo(notification.createdAt)}
                  </span>
                </div>

                {/* Dismiss button (non-persistent only) */}
                {!notification.persistent && (
                  <button
                    onClick={() => dismissMutation.mutate(notification.id)}
                    className="p-0.5 text-text-disabled hover:text-text-secondary transition-colors shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </ScrollFade>
        )}
      </div>
    </Card>
  );
}
